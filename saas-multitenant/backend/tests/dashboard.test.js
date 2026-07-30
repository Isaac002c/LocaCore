'use strict';
// =============================================================================
// PAINEL (§5) — indicadores e séries dos gráficos.
//
// Cobre o que o Painel promete: cálculo no BACKEND, filtro por tenant, filtro
// por período, zero exibido como zero (e não omitido), inadimplência, alertas
// de manutenção/automação e as 5 séries dos gráficos.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, reports;
const T = 'tenant-a';
const OUTRO = 'tenant-b';

const hoje = () => new Date().toISOString().substring(0, 10);
const shift = (d) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().substring(0, 10);
};

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT, brand TEXT, model TEXT, status TEXT DEFAULT 'disponivel' );
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'em_andamento', start_date DATE, end_date DATE, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0 );
    CREATE TABLE rental_fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, total_amount NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'identificada' );
    CREATE TABLE inventory_items ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, active BOOLEAN DEFAULT TRUE, quantity NUMERIC(15,3) DEFAULT 0, min_quantity NUMERIC(15,3) DEFAULT 0 );
    CREATE TABLE service_billings ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, client_id UUID, rental_id UUID, description TEXT, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0, due_date DATE, financial_status TEXT DEFAULT 'faturado', created_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE vehicle_maintenances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, vehicle_id UUID, status TEXT DEFAULT 'agendada', scheduled_date DATE );
    CREATE TABLE message_outbox ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, status TEXT DEFAULT 'pending' );
    CREATE TABLE fiscal_documents ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, status TEXT DEFAULT 'pending_configuration' );
    CREATE TABLE calendar_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, event_date DATE, status TEXT DEFAULT 'agendado' );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  reports = require('../models/reportModels');

  const cli = (await pool.query(`INSERT INTO clients (tenant_id,name) VALUES ($1,'Ana') RETURNING *`, [T])).rows[0];

  // Frota: 1 alugado, 2 disponíveis, 1 em manutenção  → 4 veículos, 25% ocupação
  const alugado = (await pool.query(`INSERT INTO vehicles (tenant_id,plate,brand,model,status) VALUES ($1,'AAA1A11','Fiat','Argo','alugado') RETURNING *`, [T])).rows[0];
  const livre = (await pool.query(`INSERT INTO vehicles (tenant_id,plate,brand,model,status) VALUES ($1,'BBB2B22','Chevrolet','Onix','disponivel') RETURNING *`, [T])).rows[0];
  await pool.query(`INSERT INTO vehicles (tenant_id,plate,status) VALUES ($1,'CCC3C33','disponivel'),($1,'DDD4D44','manutencao')`, [T]);

  // Locações: 1 em andamento (retirada hoje), 1 reservada (no veículo livre), 1 atrasada
  const loc1 = (await pool.query(
    `INSERT INTO rentals (tenant_id,rental_number,client_id,vehicle_id,status,start_date,end_date,total_amount,deposit_amount)
     VALUES ($1,'LOC-1',$2,$3,'em_andamento',$4,$5,900,300) RETURNING *`,
    [T, cli.id, alugado.id, hoje(), shift(5)])).rows[0];
  await pool.query(
    `INSERT INTO rentals (tenant_id,rental_number,client_id,vehicle_id,status,start_date,end_date,total_amount,deposit_amount)
     VALUES ($1,'LOC-2',$2,$3,'reservado',$4,$5,400,100)`,
    [T, cli.id, livre.id, shift(3), shift(8)]);
  await pool.query(
    `INSERT INTO rentals (tenant_id,rental_number,client_id,status,start_date,end_date,total_amount)
     VALUES ($1,'LOC-3',$2,'atrasado',$3,$4,250)`,
    [T, cli.id, shift(-10), hoje()]);

  // Financeiro: 1 faturamento pago pela metade no período + 1 vencido (inadimplência)
  await pool.query(
    `INSERT INTO service_billings (tenant_id,client_id,rental_id,description,final_amount,paid_amount,due_date,financial_status)
     VALUES ($1,$2,$3,'Locação LOC-1',900,300,$4,'faturado')`,
    [T, cli.id, loc1.id, shift(5)]);
  await pool.query(
    `INSERT INTO service_billings (tenant_id,client_id,rental_id,description,final_amount,paid_amount,due_date,financial_status)
     VALUES ($1,$2,$3,'Locação vencida',500,100,$4,'faturado')`,
    [T, cli.id, loc1.id, shift(-20)]);

  // Alertas
  await pool.query(`INSERT INTO rental_fines (tenant_id,total_amount,status) VALUES ($1,150,'identificada'),($1,80,'paga')`, [T]);
  await pool.query(`INSERT INTO inventory_items (tenant_id,active,quantity,min_quantity) VALUES ($1,true,2,5),($1,true,10,3)`, [T]);
  await pool.query(`INSERT INTO vehicle_maintenances (tenant_id,vehicle_id,status,scheduled_date) VALUES ($1,$2,'agendada',$3)`, [T, alugado.id, shift(3)]);
  await pool.query(`INSERT INTO vehicle_maintenances (tenant_id,vehicle_id,status,scheduled_date) VALUES ($1,$2,'agendada',$3)`, [T, alugado.id, shift(-4)]);
  await pool.query(`INSERT INTO message_outbox (tenant_id,status) VALUES ($1,'failed'),($1,'dead'),($1,'pending'),($1,'sent')`, [T]);
  await pool.query(`INSERT INTO fiscal_documents (tenant_id,status) VALUES ($1,'pending_configuration'),($1,'issued')`, [T]);
  await pool.query(`INSERT INTO calendar_events (tenant_id,event_date,status) VALUES ($1,$2,'agendado')`, [T, hoje()]);

  // ── Ruído de OUTRO tenant (não pode vazar em nenhum indicador) ────────────
  await pool.query(`INSERT INTO vehicles (tenant_id,plate,status) VALUES ($1,'ZZZ9Z99','alugado')`, [OUTRO]);
  await pool.query(`INSERT INTO rentals (tenant_id,rental_number,status,start_date,end_date,total_amount) VALUES ($1,'X-1','atrasado',$2,$2,9999)`, [OUTRO, hoje()]);
  await pool.query(`INSERT INTO service_billings (tenant_id,description,final_amount,paid_amount,due_date,financial_status) VALUES ($1,'ruido',7777,0,$2,'faturado')`, [OUTRO, shift(-30)]);
  await pool.query(`INSERT INTO message_outbox (tenant_id,status) VALUES ($1,'failed')`, [OUTRO]);
});

// ── Indicadores ─────────────────────────────────────────────────────────────
test('frota: conta por status e calcula taxa de ocupação', async () => {
  const o = await reports.overview(T);
  assert.equal(o.fleet.total, 4);
  assert.equal(o.fleet.alugado, 1);
  assert.equal(o.fleet.disponivel, 2);
  assert.equal(o.fleet.manutencao, 1);
  assert.equal(o.fleet.taxa_ocupacao, 25, '1 alugado de 4 = 25%');
});

test('frota: "reservado" é derivado de reserva em aberto, não do status do veículo', async () => {
  const o = await reports.overview(T);
  assert.equal(o.fleet.reservado, 1, 'o veículo com locação reservada conta como reservado');
});

test('locações: status, ativas e retiradas/devoluções de hoje', async () => {
  const o = await reports.overview(T);
  assert.equal(o.rentals.em_andamento, 1);
  assert.equal(o.rentals.reservado, 1);
  assert.equal(o.rentals.atrasado, 1);
  assert.equal(o.rentals.ativas, 2, 'em andamento + atrasadas');
  assert.equal(o.hoje.retiradas, 1, 'LOC-1 começa hoje');
  assert.equal(o.hoje.devolucoes, 1, 'LOC-3 vence hoje');
  assert.equal(o.hoje.compromissos, 3, 'retiradas + devoluções + eventos do dia');
});

test('alertas: manutenções vencidas/próximas, multas, estoque, mensagens e fiscal', async () => {
  const o = await reports.overview(T);
  assert.equal(o.manutencoes.vencidas, 1);
  assert.equal(o.manutencoes.proximas, 1);
  assert.equal(o.manutencoes.abertas, 2);
  assert.equal(o.multas.abertas, 1, 'multa paga não conta');
  assert.equal(o.multas.valor, 150);
  assert.equal(o.estoque.abaixo_minimo, 1);
  assert.equal(o.automacoes.mensagens_falha, 2, 'failed + dead');
  assert.equal(o.automacoes.mensagens_pendentes, 1);
  assert.equal(o.automacoes.fiscais_pendentes, 1, 'emitido não é pendente');
});

test('financeiro: faturado, recebido, pendente e inadimplência', async () => {
  const o = await reports.overview(T);
  assert.equal(o.financeiro.faturado_periodo, 1400, '900 + 500 criados hoje');
  assert.equal(o.financeiro.recebido_periodo, 400, '300 + 100');
  assert.equal(o.financeiro.pendente_periodo, 1000);
  assert.equal(o.financeiro.inadimplencia_qtd, 1, 'só a cobrança vencida com saldo');
  assert.equal(o.financeiro.inadimplencia_valor, 400, '500 - 100');
  assert.equal(o.financeiro.valor_em_aberto, 1550, 'reservado + em andamento + atrasado');
  assert.equal(o.financeiro.caucao_retida, 400);
});

test('pendente nunca é negativo (recebido acima do faturado não vira dívida)', async () => {
  const o = await reports.overview(T, { from: '2000-01-01', to: '2000-01-02' });
  assert.equal(o.financeiro.faturado_periodo, 0);
  assert.equal(o.financeiro.pendente_periodo, 0);
});

test('período: filtro vazio zera o financeiro mas preserva o operacional', async () => {
  const o = await reports.overview(T, { from: '2001-01-01', to: '2001-12-31' });
  assert.equal(o.periodo.from, '2001-01-01');
  assert.equal(o.periodo.to, '2001-12-31');
  assert.equal(o.financeiro.faturado_periodo, 0, 'nada faturado nesse período');
  assert.equal(o.fleet.total, 4, 'a frota é um retrato de AGORA, não do período');
});

test('zero é ZERO: banco vazio devolve números, nunca null/undefined', async () => {
  const o = await reports.overview('tenant-sem-nada');
  assert.equal(o.fleet.total, 0);
  assert.equal(o.fleet.taxa_ocupacao, 0);
  assert.equal(o.rentals.ativas, 0);
  assert.equal(o.financeiro.faturado_periodo, 0);
  assert.equal(o.financeiro.inadimplencia_valor, 0);
  assert.equal(o.manutencoes.proximas, 0);
  assert.equal(o.automacoes.mensagens_falha, 0);
  for (const grupo of [o.fleet, o.rentals, o.hoje, o.multas, o.estoque, o.manutencoes, o.automacoes, o.financeiro]) {
    for (const [k, v] of Object.entries(grupo)) {
      assert.equal(typeof v, 'number', `${k} deve ser número, veio ${typeof v}`);
      assert.ok(!Number.isNaN(v), `${k} não pode ser NaN`);
    }
  }
});

test('isolamento: nenhum indicador enxerga dados de outro tenant', async () => {
  const o = await reports.overview(T);
  assert.equal(o.fleet.total, 4, 'o veículo do outro tenant não entra');
  assert.equal(o.rentals.atrasado, 1, 'a locação atrasada do outro tenant não entra');
  assert.ok(o.financeiro.inadimplencia_valor < 7777, 'a cobrança vencida do outro tenant não entra');
  assert.equal(o.automacoes.mensagens_falha, 2, 'a mensagem com falha do outro tenant não entra');

  const outro = await reports.overview(OUTRO);
  assert.equal(outro.fleet.total, 1);
  assert.equal(outro.rentals.atrasado, 1);
});

// ── Séries dos gráficos ─────────────────────────────────────────────────────
test('séries: faturado x recebido tem datas ISO (nunca "Wed Jul 29")', async () => {
  const s = await reports.dashboardSeries(T);
  assert.ok(s.faturado_recebido.length >= 1);
  for (const d of s.faturado_recebido) {
    assert.match(d.dia, /^\d{4}-\d{2}-\d{2}$/, `dia inválido: ${d.dia}`);
    assert.equal(typeof d.faturado, 'number');
    assert.equal(typeof d.recebido, 'number');
  }
  const total = s.faturado_recebido.reduce((a, d) => a + d.faturado, 0);
  assert.equal(total, 1400);
});

test('séries: locações por status e ocupação da frota somam o total', async () => {
  const s = await reports.dashboardSeries(T);
  assert.equal(s.locacoes_por_status.reduce((a, x) => a + x.total, 0), 3);
  assert.equal(s.ocupacao_frota.reduce((a, x) => a + x.total, 0), 4);
  const alugado = s.ocupacao_frota.find((x) => x.status === 'alugado');
  assert.equal(alugado.percentual, 25);
});

test('séries: inadimplência é distribuída na faixa de atraso correta', async () => {
  const s = await reports.dashboardSeries(T);
  const faixas = s.inadimplencia_por_faixa;
  assert.equal(faixas.length, 4, 'quatro faixas de aging');
  const total = faixas.reduce((a, f) => a + f.total, 0);
  assert.equal(total, 400, 'o saldo vencido aparece em alguma faixa (bug: caía fora de todas)');
  const comValor = faixas.find((f) => f.total > 0);
  assert.equal(comValor.faixa, '16-30 dias', 'vencida há 20 dias');
  assert.equal(comValor.qtd, 1);
});

test('séries: receita por veículo agrega por carro e ordena por faturamento', async () => {
  const s = await reports.dashboardSeries(T);
  assert.ok(s.receita_por_veiculo.length >= 1, 'deve haver receita por veículo');
  const top = s.receita_por_veiculo[0];
  assert.equal(top.plate, 'AAA1A11');
  assert.equal(top.faturado, 1400, 'soma os dois faturamentos da mesma locação');
  assert.equal(top.recebido, 400);
  assert.equal(top.locacoes, 1, 'conta locações distintas, não faturamentos');
  assert.match(top.veiculo, /AAA1A11/);
  assert.equal(top._rentals, undefined, 'campo interno não vaza para a API');
});

test('séries: tenant sem dados devolve todas as séries vazias, sem quebrar', async () => {
  const s = await reports.dashboardSeries('tenant-sem-nada');
  assert.deepEqual(s.faturado_recebido, []);
  assert.deepEqual(s.locacoes_por_status, []);
  assert.deepEqual(s.ocupacao_frota, []);
  assert.deepEqual(s.receita_por_veiculo, []);
  assert.equal(s.inadimplencia_por_faixa.length, 4, 'faixas sempre existem (com zero)');
  assert.equal(s.inadimplencia_por_faixa.reduce((a, f) => a + f.total, 0), 0);
});

test('séries: isolamento por tenant', async () => {
  const s = await reports.dashboardSeries(OUTRO);
  assert.equal(s.ocupacao_frota.reduce((a, x) => a + x.total, 0), 1);
  assert.equal(s.receita_por_veiculo.length, 0, 'o faturamento do outro tenant não tem veículo vinculado');
});
