// =============================================================================
// rentalService.js — Orquestração TRANSACIONAL da locação (§4/§10).
//
// Operações que tocam mais de uma tabela crítica (locação + veículo) rodam numa
// única transação, com trava de linha (FOR UPDATE) e validação de conflito de
// período (§3) DENTRO da transação. Se qualquer etapa falhar → ROLLBACK e nada
// fica inconsistente (veículo nunca livre com locação ativa, nem locação
// finalizada sem atualizar o veículo).
//
// O histórico (activity_logs) é registrado pela rota APÓS o commit (best-effort),
// preservando o padrão do projeto — a atomicidade crítica é locação + veículo.
//
// Injeta-se `withTransaction` para permitir testes com pg-mem.
// =============================================================================

const rentalModel = require('../models/rentalModels');
const vehicleModel = require('../models/vehicleModels');
const rentalExtraModel = require('../models/rentalExtraModels');
const billingModel = require('../models/serviceBillingModels');
const defaultWithTransaction = require('./tx').withTransaction;

class HttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; this.name = 'HttpError'; }
}

// Monta a mensagem 409 de conflito sem vazar dados de outro tenant.
function conflictError(conflicts) {
  const c = conflicts[0];
  const ymd = (v) => (v == null ? '' : (typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10)));
  const periodo = c ? ` (${ymd(c.start_date)} a ${ymd(c.end_date)}, ${c.status})` : '';
  const numero = c && c.rental_number ? ` ${c.rental_number}` : '';
  return new HttpError(409, `Este veículo já possui uma locação${numero} no período selecionado${periodo}.`);
}

// Verifica conflito de período para o veículo, dentro da transação.
async function assertNoConflict(db, { tenant_id, vehicle_id, start_date, end_date, exclude_rental_id }) {
  const conflicts = await rentalModel.findConflictingRentals(
    { tenant_id, vehicle_id, start_date, end_date, exclude_rental_id }, db,
  );
  if (conflicts.length) throw conflictError(conflicts);
}

function factory(withTransaction = defaultWithTransaction) {
  return {
    // Criação atômica: valida conflito, insere locação e sincroniza o veículo.
    async create(input) {
      return withTransaction(async (db) => {
        if (input.vehicle_id) {
          // Trava o veículo para serializar reservas concorrentes do mesmo carro.
          const veh = await vehicleModel.getVehicleByIdForUpdate(input.vehicle_id, input.tenant_id, db);
          // Veículo em manutenção/inativo não é elegível para locação (§27).
          if (veh && (veh.status === 'manutencao' || veh.status === 'inativo')) {
            throw new HttpError(409, `Veículo indisponível para locação (${veh.status}).`);
          }
          const status = rentalModel.STATUSES.includes(input.status) ? input.status : 'reservado';
          if (rentalModel.BLOCKING_STATUSES.includes(status)) {
            await assertNoConflict(db, {
              tenant_id: input.tenant_id, vehicle_id: input.vehicle_id,
              start_date: input.start_date, end_date: input.end_date,
            });
          }
        }
        const rental = await rentalModel.createRental(input, db);
        await vehicleModel.refreshVehicleStatus(rental.vehicle_id, input.tenant_id, db);
        return rental;
      });
    },

    // Edição atômica: recheca conflito (período/veículo) excluindo a própria locação.
    async update(id, payload, tenant_id) {
      return withTransaction(async (db) => {
        const current = await rentalModel.getRentalByIdForUpdate(id, tenant_id, db);
        if (!current) throw new HttpError(404, 'Locação não encontrada');

        const nextVehicle = payload.vehicle_id !== undefined ? payload.vehicle_id : current.vehicle_id;
        const nextStart = payload.start_date !== undefined ? payload.start_date : current.start_date;
        const nextEnd = payload.end_date !== undefined ? payload.end_date : current.end_date;
        const nextStatus = payload.status !== undefined ? payload.status : current.status;

        if (nextVehicle && rentalModel.BLOCKING_STATUSES.includes(nextStatus)) {
          await vehicleModel.getVehicleByIdForUpdate(nextVehicle, tenant_id, db);
          await assertNoConflict(db, {
            tenant_id, vehicle_id: nextVehicle, start_date: nextStart, end_date: nextEnd, exclude_rental_id: id,
          });
        }
        const rental = await rentalModel.updateRental(id, payload, tenant_id, db);
        // Sincroniza o veículo atual e o anterior (se houve troca).
        await vehicleModel.refreshVehicleStatus(rental.vehicle_id, tenant_id, db);
        if (current.vehicle_id && current.vehicle_id !== rental.vehicle_id) {
          await vehicleModel.refreshVehicleStatus(current.vehicle_id, tenant_id, db);
        }
        return rental;
      });
    },

    // Mudança de status com guarda de transição (§10). Ao iniciar, revalida conflito.
    async changeStatus(id, status, tenant_id) {
      if (!rentalModel.STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
      return withTransaction(async (db) => {
        const current = await rentalModel.getRentalByIdForUpdate(id, tenant_id, db);
        if (!current) throw new HttpError(404, 'Locação não encontrada');
        if (!rentalModel.canTransition(current.status, status)) {
          throw new HttpError(409, `Transição de status inválida: "${current.status}" → "${status}".`);
        }
        if (status === 'em_andamento' && current.vehicle_id) {
          await vehicleModel.getVehicleByIdForUpdate(current.vehicle_id, tenant_id, db);
          await assertNoConflict(db, {
            tenant_id, vehicle_id: current.vehicle_id,
            start_date: current.start_date, end_date: current.end_date, exclude_rental_id: id,
          });
        }
        const rental = await rentalModel.setRentalStatus(id, status, tenant_id, db);
        await vehicleModel.refreshVehicleStatus(rental.vehicle_id, tenant_id, db);
        return { rental, previous: current.status };
      });
    },

    // Devolução atômica: valida status, registra devolução, atualiza hodômetro e libera o veículo.
    async returnRental(id, data, tenant_id) {
      return withTransaction(async (db) => {
        const current = await rentalModel.getRentalByIdForUpdate(id, tenant_id, db);
        if (!current) throw new HttpError(404, 'Locação não encontrada');
        if (current.status === 'finalizado') throw new HttpError(409, 'Locação já finalizada.');
        if (current.status === 'cancelado') throw new HttpError(409, 'Locação cancelada não pode ser devolvida.');
        if (current.status === 'reservado') throw new HttpError(409, 'Locação ainda não iniciada; inicie antes de registrar a devolução.');

        // Hodômetro de devolução não pode ser menor que o de retirada.
        const ret = data.return_odometer;
        if (ret !== undefined && ret !== null && ret !== '' && current.pickup_odometer != null
            && Number(ret) < Number(current.pickup_odometer)) {
          throw new HttpError(400, `O hodômetro de devolução (${ret}) não pode ser menor que o de retirada (${current.pickup_odometer}).`);
        }

        const rental = await rentalModel.closeRental(id, data, tenant_id, db);
        if (ret !== undefined && ret !== null && ret !== '' && rental.vehicle_id) {
          await vehicleModel.updateVehicle(rental.vehicle_id, { odometer: ret }, tenant_id, db);
        }
        await vehicleModel.refreshVehicleStatus(rental.vehicle_id, tenant_id, db);
        return { rental, previous: current.status };
      });
    },

    // Adiciona um extra e recalcula o total da locação, atomicamente.
    async addExtra(rental_id, data, tenant_id) {
      return withTransaction(async (db) => {
        const rental = await rentalModel.getRentalByIdForUpdate(rental_id, tenant_id, db);
        if (!rental) throw new HttpError(404, 'Locação não encontrada');
        const extra = await rentalExtraModel.create({ ...data, tenant_id, rental_id }, db);
        const updated = await rentalModel.recomputeTotals(rental_id, tenant_id, db);
        return { extra, rental: updated };
      });
    },

    // Baixa lógica de um extra e recalcula o total, atomicamente.
    async cancelExtra(rental_id, extra_id, tenant_id) {
      return withTransaction(async (db) => {
        const rental = await rentalModel.getRentalByIdForUpdate(rental_id, tenant_id, db);
        if (!rental) throw new HttpError(404, 'Locação não encontrada');
        const extra = await rentalExtraModel.getById(extra_id, tenant_id, db);
        if (!extra || String(extra.rental_id) !== String(rental_id)) throw new HttpError(404, 'Adicional não encontrado nesta locação');
        await rentalExtraModel.cancel(extra_id, tenant_id, db);
        const updated = await rentalModel.recomputeTotals(rental_id, tenant_id, db);
        return { rental: updated };
      });
    },

    // Cancelamento atômico (com motivo). Preserva histórico e libera o veículo.
    // Cancelamento (§11). O faturamento vinculado é cancelado JUNTO, na mesma
    // transação — antes o sistema bloqueava e mandava o usuário "tratar o
    // faturamento no Financeiro", o que na prática impedia o cancelamento.
    //
    // A única trava que permanece é quando já houve DINHEIRO recebido: aí o
    // caminho correto é estornar o pagamento (que gera o lançamento contrário),
    // não apagar o faturamento por baixo.
    async cancelRental(id, { reason } = {}, tenant_id) {
      return withTransaction(async (db) => {
        const current = await rentalModel.getRentalByIdForUpdate(id, tenant_id, db);
        if (!current) throw new HttpError(404, 'Locação não encontrada');
        if (current.status === 'cancelado') throw new HttpError(409, 'Locação já cancelada.');
        if (current.status === 'finalizado') throw new HttpError(409, 'Locação finalizada não pode ser cancelada.');

        // Trava os faturamentos ativos para ninguém pagar no meio do caminho.
        const ativos = await billingModel.getActiveBillingsByRentalForUpdate(id, tenant_id, db);
        const pagos = ativos.filter((b) => Number(b.paid_amount) > 0);
        if (pagos.length) {
          const total = pagos.reduce((a, b) => a + Number(b.paid_amount), 0);
          throw new HttpError(409,
            `Esta locação já recebeu ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} `
            + 'em pagamentos. Estorne o pagamento no Financeiro antes de cancelar — assim o estorno fica registrado.');
        }

        for (const b of ativos) await billingModel.cancelBilling(b.id, tenant_id, db);

        const rental = await rentalModel.cancelRental(id, { reason }, tenant_id, db);
        await vehicleModel.refreshVehicleStatus(rental.vehicle_id, tenant_id, db);
        return { rental, previous: current.status, canceledBillings: ativos.length };
      });
    },
  };
}

module.exports = Object.assign(factory(), { factory, HttpError });
