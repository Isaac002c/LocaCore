const express = require('express');
const router = express.Router();
const rentalModel = require('../models/rentalModels');
const clientModel = require('../models/clientModels');
const vehicleModel = require('../models/vehicleModels');
const billingModel = require('../models/serviceBillingModels');
const rentalExtraModel = require('../models/rentalExtraModels');
const documentModel = require('../models/documentModels');
const paymentModel = require('../models/paymentModels');
const settingsModel = require('../models/tenantFinancialSettingsModels');
const tenantModel = require('../models/tenantModels');
const userModel = require('../models/userModels');
const contractModel = require('../models/rentalContractModels');
const { buildRentalContractPdf } = require('../services/finance/rentalContractPdf');
const rentalService = require('../services/rentalService');
const receiptService = require('../services/finance/receiptService');
const { resolveBranding } = require('../services/finance/branding');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const activityLog = require('../services/activityLogService');
const { toBrDate } = require('../utils/date');

// ============================================
// LOCAÇÕES (rentals) — LocaCore. Gating de módulo + permissões granulares (§12/§15).
// Operações críticas rodam em transação atômica via services/rentalService (§4).
// ============================================

// Todo o módulo exige que o tenant tenha "locacao" habilitado.
router.use(requireModule('locacao'));

// Mapeia erros do service (statusCode) para HTTP; mensagens 5xx não vazam detalhe.
const handleErr = (res, err, ctx) => {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(ctx, err.message);
  res.status(status).json({ success: false, error: status >= 500 ? 'Erro interno do servidor' : err.message });
};

// GET /api/rentals — lista (filtros: status, client_id, vehicle_id, q, date_from, date_to).
// Com ?limit= → paginado ({ data, pagination }); sem limit → array (compat.).
router.get('/', checkPermission('rentals:read'), async (req, res) => {
  try {
    const { status = '', client_id = '', vehicle_id = '', q = '', date_from = '', date_to = '', limit, offset } = req.query;
    const filters = { status, client_id, vehicle_id, q, date_from, date_to };
    await rentalModel.flagOverdue(req.tenantId).catch(() => {});
    if (limit !== undefined) {
      const r = await rentalModel.listRentalsPaged(req.tenantId, filters, { limit, offset });
      return res.json({ success: true, data: r.rows, pagination: { limit: r.limit, offset: r.offset, total: r.total, pages: Math.ceil(r.total / r.limit) } });
    }
    const rentals = await rentalModel.getAllRentals(req.tenantId, filters);
    res.json({ success: true, data: rentals });
  } catch (err) { handleErr(res, err, 'Erro ao listar locações:'); }
});

// GET /api/rentals/stats — indicadores
router.get('/stats', checkPermission('rentals:read'), async (req, res) => {
  try {
    await rentalModel.flagOverdue(req.tenantId).catch(() => {});
    const stats = await rentalModel.getRentalStats(req.tenantId);
    res.json({ success: true, data: stats });
  } catch (err) { handleErr(res, err, 'Erro ao buscar stats de locações:'); }
});

// ── Contrato de locação (§7) — rotas SEM :id vêm antes de GET /:id ───────────
// GET/PUT configurações de cabeçalho/cláusulas/rodapé do contrato (por tenant)
router.get('/contract-settings', checkPermission('rentals:read'), async (req, res) => {
  try { res.json({ success: true, data: await contractModel.getSettings(req.tenantId), defaults: contractModel.DEFAULT_CLAUSES }); }
  catch (err) { handleErr(res, err, 'Erro ao ler config de contrato:'); }
});
router.put('/contract-settings', checkPermission('contracts:generate'), async (req, res) => {
  try { res.json({ success: true, data: await contractModel.upsertSettings(req.tenantId, req.body || {}) }); }
  catch (err) { handleErr(res, err, 'Erro ao salvar config de contrato:'); }
});

// Monta os dados do contrato (locação + cliente + veículo + adicionais + branding).
async function contractData(rentalId, tenantId) {
  const rental = await rentalModel.getRentalById(rentalId, tenantId);
  if (!rental) return null;
  const [client, vehicle, extras, settings, tenant, finSettings] = await Promise.all([
    rental.client_id ? clientModel.getClientById(rental.client_id, tenantId) : null,
    rental.vehicle_id ? vehicleModel.getVehicleById(rental.vehicle_id, tenantId) : null,
    rentalExtraModel.listByRental(rentalId, tenantId).catch(() => []),
    contractModel.getSettings(tenantId),
    tenantModel.getTenantById(tenantId).catch(() => null),
    settingsModel.getSettings(tenantId).catch(() => null),
  ]);
  return { rental, client: client || {}, vehicle: vehicle || {}, extras, settings, branding: resolveBranding({ tenant, settings: finSettings }) };
}

// POST /:id/contract — gera nova VERSÃO do contrato (snapshot; não sobrescreve)
router.post('/:id/contract', checkPermission('contracts:generate'), async (req, res) => {
  try {
    const data = await contractData(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const snapshot = { rental_number: data.rental.rental_number, client_name: data.client.name, vehicle_plate: data.vehicle.plate, total_amount: data.rental.total_amount, generated_at: new Date().toISOString() };
    const contract = await contractModel.create({ tenant_id: req.tenantId, rental_id: req.params.id, snapshot, created_by: req.userId });
    activityLog.logCreate(req.tenantId, req.userId, 'rental_contract', contract.id, `Contrato ${contract.number} gerado (v${contract.version})`, {}).catch(() => {});
    res.status(201).json({ success: true, data: contract });
  } catch (err) { handleErr(res, err, 'Erro ao gerar contrato:'); }
});

// GET /:id/contracts — versões geradas
router.get('/:id/contracts', checkPermission('rentals:read'), async (req, res) => {
  try { res.json({ success: true, data: await contractModel.listByRental(req.params.id, req.tenantId) }); }
  catch (err) { handleErr(res, err, 'Erro ao listar contratos:'); }
});

// GET /:id/contract.pdf — PDF do contrato (dados atuais; pronto para imprimir)
router.get('/:id/contract.pdf', checkPermission('rentals:read'), async (req, res) => {
  try {
    const data = await contractData(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    let pdf;
    try { pdf = await buildRentalContractPdf({ ...data, contract: { number: `Locação ${data.rental.rental_number}` } }); }
    catch (e) { if (e && (e.code === 'MODULE_NOT_FOUND' || /pdfkit/i.test(e.message))) return res.status(503).json({ success: false, error: 'Geração de PDF indisponível (pdfkit não instalado)' }); throw e; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${String(req.query.download || '') === '1' ? 'attachment' : 'inline'}; filename="contrato-${data.rental.rental_number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err) { handleErr(res, err, 'Erro ao gerar PDF do contrato:'); }
});

// GET /api/rentals/:id — detalhe
router.get('/:id', checkPermission('rentals:read'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    res.json({ success: true, data: rental });
  } catch (err) { handleErr(res, err, 'Erro ao buscar locação:'); }
});

// GET /api/rentals/:id/billings — faturamentos + resumo financeiro
router.get('/:id/billings', checkPermission('rentals:read'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const [billings, summary] = await Promise.all([
      billingModel.getBillingsByRental(req.params.id, req.tenantId),
      billingModel.getRentalSummary(req.params.id, req.tenantId),
    ]);
    res.json({ success: true, data: { billings, summary } });
  } catch (err) { handleErr(res, err, 'Erro ao buscar financeiro da locação:'); }
});

// GET /api/rentals/:id/payments — pagamentos (com recibo, se houver)
router.get('/:id/payments', checkPermission('rentals:read'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const payments = await paymentModel.getPaymentsByRental(req.params.id, req.tenantId);
    res.json({ success: true, data: payments });
  } catch (err) { handleErr(res, err, 'Erro ao buscar pagamentos da locação:'); }
});

// GET /api/rentals/:id/documents — documentos da locação
router.get('/:id/documents', checkPermission('rentals:read'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const docs = await documentModel.getDocumentsByRental(req.params.id, req.tenantId);
    res.json({ success: true, data: docs });
  } catch (err) { handleErr(res, err, 'Erro ao listar documentos da locação:'); }
});

// Valida vínculos e período. Cliente e veículo (quando informados) devem ser do tenant.
const validateLinks = async (body, tenantId) => {
  if (body.client_id) {
    const c = await clientModel.getClientById(body.client_id, tenantId);
    if (!c) return 'Cliente (locatário) não encontrado neste tenant.';
  }
  if (body.vehicle_id) {
    const v = await vehicleModel.getVehicleById(body.vehicle_id, tenantId);
    if (!v) return 'Veículo não encontrado neste tenant.';
  }
  if (body.start_date && body.end_date && String(body.end_date) < String(body.start_date)) {
    return 'A data de devolução não pode ser anterior à retirada.';
  }
  return null;
};

// POST /api/rentals — criar locação (transacional: valida conflito + sincroniza veículo)
router.post('/', checkPermission('rentals:create'), async (req, res) => {
  try {
    if (!req.body.client_id) return res.status(400).json({ success: false, error: 'Selecione o cliente (locatário).' });
    if (!req.body.vehicle_id) return res.status(400).json({ success: false, error: 'Selecione o veículo.' });
    const linkErr = await validateLinks(req.body, req.tenantId);
    if (linkErr) return res.status(400).json({ success: false, error: linkErr });

    const rental = await rentalService.create({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });
    const full = await rentalModel.getRentalById(rental.id, req.tenantId);
    activityLog.logCreate(req.tenantId, req.userId, 'rental', rental.id,
      `Locação ${rental.rental_number} criada${full.vehicle_plate ? ` — ${full.vehicle_plate}` : ''}${full.client_name ? ` para ${full.client_name}` : ''}`,
      { rental_number: rental.rental_number, total_amount: rental.total_amount, status: rental.status }).catch(() => {});
    res.status(201).json({ success: true, data: full });
  } catch (err) { handleErr(res, err, 'Erro ao criar locação:'); }
});

// PUT /api/rentals/:id — atualizar (transacional: recheca conflito)
router.put('/:id', checkPermission('rentals:update'), async (req, res) => {
  try {
    const existing = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const linkErr = await validateLinks({ ...existing, ...req.body }, req.tenantId);
    if (linkErr) return res.status(400).json({ success: false, error: linkErr });

    const rental = await rentalService.update(req.params.id, req.body, req.tenantId);
    const full = await rentalModel.getRentalById(rental.id, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental', rental.id,
      `Locação ${rental.rental_number} atualizada`, existing, rental).catch(() => {});
    res.json({ success: true, data: full });
  } catch (err) { handleErr(res, err, 'Erro ao atualizar locação:'); }
});

// PATCH /api/rentals/:id/status — mudança de status (guarda de transição + conflito ao iniciar)
router.patch('/:id/status', checkPermission('rentals:update'), async (req, res) => {
  try {
    const { rental, previous } = await rentalService.changeStatus(req.params.id, req.body.status, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental', rental.id,
      `Status da locação ${rental.rental_number}: "${previous}" → "${rental.status}"`,
      { status: previous }, { status: rental.status }).catch(() => {});
    res.json({ success: true, data: rental });
  } catch (err) { handleErr(res, err, 'Erro ao alterar status da locação:'); }
});

// POST /api/rentals/:id/return — devolução (transacional)
router.post('/:id/return', checkPermission('rentals:return'), async (req, res) => {
  try {
    const { rental, previous } = await rentalService.returnRental(req.params.id, req.body, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental', rental.id,
      `Devolução registrada — locação ${rental.rental_number} finalizada`,
      { status: previous }, { status: 'finalizado', return_date: rental.return_date }).catch(() => {});
    res.json({ success: true, data: rental });
  } catch (err) { handleErr(res, err, 'Erro ao registrar devolução:'); }
});

// POST /api/rentals/:id/cancel — cancelamento com motivo (transacional; preserva histórico)
router.post('/:id/cancel', checkPermission('rentals:cancel'), async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ success: false, error: 'Informe o motivo do cancelamento (mín. 3 caracteres).' });

    // O faturamento vinculado é cancelado JUNTO, dentro da transação. A única
    // recusa que resta é quando já houve pagamento (o serviço explica o porquê).
    const { rental, previous, canceledBillings } = await rentalService.cancelRental(req.params.id, { reason }, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental', rental.id,
      `Locação ${rental.rental_number} cancelada — ${reason}`
      + (canceledBillings ? ` (${canceledBillings} faturamento(s) cancelado(s) junto)` : ''),
      { status: previous }, { status: 'cancelado', reason, canceled_billings: canceledBillings }).catch(() => {});
    res.json({
      success: true,
      data: rental,
      canceled_billings: canceledBillings,
      message: canceledBillings
        ? `Locação cancelada. ${canceledBillings} faturamento(s) cancelado(s) junto.`
        : 'Locação cancelada.',
    });
  } catch (err) { handleErr(res, err, 'Erro ao cancelar locação:'); }
});

// POST /api/rentals/:id/faturar — cria faturamento vinculado (evita duplicidade)
router.post('/:id/faturar', checkPermission('rentals:bill'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });

    const existing = await billingModel.getBillingsByRental(req.params.id, req.tenantId);
    if (existing.some((b) => b.financial_status !== 'cancelado')) {
      return res.status(409).json({ success: false, error: 'Esta locação já possui faturamento. Cancele o anterior antes de refaturar.' });
    }

    const amount = Number(rental.total_amount) || 0;
    const billing = await billingModel.createBilling({
      tenant_id: req.tenantId, client_id: rental.client_id, rental_id: rental.id,
      description: req.body.description || `Locação ${rental.rental_number}${rental.vehicle_plate ? ` — ${rental.vehicle_plate}` : ''}`,
      original_amount: amount, discount: 0, surcharge: 0, final_amount: amount, paid_amount: 0,
      installments: req.body.installments || 1, due_date: req.body.due_date || rental.end_date || null,
      payment_method: req.body.payment_method || null, financial_status: 'faturado',
      notes: req.body.notes || null, created_by: req.userId,
    });
    activityLog.logGeneric(req.tenantId, req.userId, 'create', 'billing',
      `Faturamento gerado para a locação ${rental.rental_number} (R$ ${amount.toFixed(2)})`,
      { rental_id: rental.id, billing_id: billing.id, amount }).catch(() => {});
    res.status(201).json({ success: true, data: billing });
  } catch (err) { handleErr(res, err, 'Erro ao faturar locação:'); }
});

// POST /api/rentals/:id/recibo — gera recibo direto pela locação (reusa o módulo real).
// Requer um pagamento confirmado do faturamento da locação. Evita duplicidade.
router.post('/:id/recibo', checkPermission('rentals:receipt'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });

    const all = await paymentModel.getPaymentsByRental(req.params.id, req.tenantId);
    const confirmed = all.filter((p) => p.status === 'confirmado');
    if (confirmed.length === 0) {
      return res.status(400).json({ success: false, error: 'Registre o recebimento no Financeiro antes de gerar o recibo.' });
    }
    let payment = req.body.payment_id ? confirmed.find((p) => p.id === req.body.payment_id) : null;
    if (!payment && confirmed.length === 1) payment = confirmed[0];
    if (!payment) return res.status(400).json({ success: false, error: 'Informe qual pagamento gerará o recibo.' });

    // Já existe recibo ativo para este pagamento → devolve o existente (não duplica).
    if (payment.receipt_id) {
      return res.status(200).json({ success: true, data: { id: payment.receipt_id, full_number: payment.receipt_number }, existing: true });
    }

    const [settings, tenant, user] = await Promise.all([
      settingsModel.ensureSettings(req.tenantId),
      tenantModel.getTenantById(req.tenantId),
      userModel.getUserById(req.userId, req.tenantId).catch(() => null),
    ]);
    const branding = resolveBranding({ tenant, settings });

    const veic = [rental.vehicle_brand, rental.vehicle_model].filter(Boolean).join(' ') || 'veículo';
    const per = (v) => toBrDate(v);
    const description = req.body.service_description
      || `Recebimento referente à locação ${rental.rental_number}, veículo ${veic}${rental.vehicle_plate ? `, placa ${rental.vehicle_plate}` : ''}${rental.start_date ? `, período de ${per(rental.start_date)} a ${per(rental.end_date)}` : ''}.`;

    const receipt = await receiptService.issueReceipt({
      tenant_id: req.tenantId,
      payment_id: payment.id,
      rental_id: rental.id,
      billing_id: payment.billing_id || null,
      client_id: rental.client_id || payment.client_id || null,
      client_name: rental.client_name || payment.client_name || 'Cliente',
      client_document: rental.client_cpf || null,
      service_description: description,
      amount: payment.amount,
      payment_method: payment.payment_method,
      notes: req.body.notes || null,
      created_by: req.userId,
      created_by_name: user ? user.name : (req.userEmail || null),
      defaultIssuerName: branding.name,
      defaultIssuerDocument: branding.document,
      defaultIssuerAddress: branding.address,
      defaultPrefix: settings.receipt_prefix,
    });

    activityLog.logGeneric(req.tenantId, req.userId, 'create', 'receipt',
      `Recibo ${receipt.full_number} emitido pela locação ${rental.rental_number}`,
      { rental_id: rental.id, receipt_id: receipt.id, payment_id: payment.id }).catch(() => {});
    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    const status = err.statusCode || (err && err.name === 'ValidationError' ? 400 : 500);
    if (status >= 500) console.error('Erro ao gerar recibo da locação:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao gerar recibo' : err.message });
  }
});

// GET /api/rentals/:id/extras — adicionais ativos da locação
router.get('/:id/extras', checkPermission('rentals:read'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const extras = await rentalExtraModel.listByRental(req.params.id, req.tenantId);
    res.json({ success: true, data: extras });
  } catch (err) { handleErr(res, err, 'Erro ao listar adicionais:'); }
});

// POST /api/rentals/:id/extras — adiciona um extra (recalcula o total, transacional)
router.post('/:id/extras', checkPermission('rentals:extras'), async (req, res) => {
  try {
    if (req.body.unit_amount !== undefined && Number(req.body.unit_amount) < 0) {
      return res.status(400).json({ success: false, error: 'Valor unitário não pode ser negativo.' });
    }
    const { extra, rental } = await rentalService.addExtra(req.params.id, { ...req.body, created_by: req.userId }, req.tenantId);
    activityLog.logCreate(req.tenantId, req.userId, 'rental_extra', extra.id,
      `Adicional na locação ${rental.rental_number}: ${extra.category || 'extra'} (R$ ${Number(extra.total_amount).toFixed(2)})`,
      { rental_id: req.params.id, total_amount: extra.total_amount }).catch(() => {});
    res.status(201).json({ success: true, data: { extra, rental } });
  } catch (err) { handleErr(res, err, 'Erro ao adicionar extra:'); }
});

// DELETE /api/rentals/:id/extras/:extraId — baixa lógica do extra (recalcula total)
router.delete('/:id/extras/:extraId', checkPermission('rentals:extras'), async (req, res) => {
  try {
    const { rental } = await rentalService.cancelExtra(req.params.id, req.params.extraId, req.tenantId);
    activityLog.logDelete(req.tenantId, req.userId, 'rental_extra', req.params.extraId,
      `Adicional removido da locação ${rental.rental_number}`, { rental_id: req.params.id }).catch(() => {});
    res.json({ success: true, data: { rental } });
  } catch (err) { handleErr(res, err, 'Erro ao remover extra:'); }
});

// POST /api/rentals/:id/documents — anexa documento à locação (reusa upload → /api/upload)
router.post('/:id/documents', checkPermission('rentals:documents'), async (req, res) => {
  try {
    const rental = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!rental) return res.status(404).json({ success: false, error: 'Locação não encontrada' });
    const { file_url, file_name, file_type, file_size, category, description } = req.body;
    if (!file_url || !file_name) return res.status(400).json({ success: false, error: 'Arquivo (url e nome) é obrigatório.' });

    const doc = await documentModel.createDocument({
      tenant_id: req.tenantId, rental_id: rental.id, vehicle_asset_id: rental.vehicle_id || null,
      client_id: rental.client_id || null, file_url, file_name, file_type, file_size,
      category: category || 'outro', description: description || null, uploaded_by: req.userId,
    });
    activityLog.logCreate(req.tenantId, req.userId, 'document', doc.id,
      `Documento anexado à locação ${rental.rental_number}: ${file_name}`,
      { rental_id: rental.id, category: doc.category }).catch(() => {});
    res.status(201).json({ success: true, data: doc });
  } catch (err) { handleErr(res, err, 'Erro ao anexar documento:'); }
});

// DELETE /api/rentals/:id/documents/:docId — remove documento da locação
router.delete('/:id/documents/:docId', checkPermission('rentals:documents'), async (req, res) => {
  try {
    const doc = await documentModel.getDocumentByIdRaw(req.params.docId, req.tenantId);
    if (!doc || String(doc.rental_id) !== String(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Documento não encontrado nesta locação' });
    }
    await documentModel.deleteDocument(req.params.docId, req.tenantId);
    activityLog.logDelete(req.tenantId, req.userId, 'document', req.params.docId,
      `Documento removido da locação: ${doc.file_name || ''}`, { rental_id: req.params.id }).catch(() => {});
    res.json({ success: true, message: 'Documento removido.' });
  } catch (err) { handleErr(res, err, 'Erro ao remover documento:'); }
});

// DELETE /api/rentals/:id — excluir (bloqueado se houver faturamento; preserva histórico §8.3)
router.delete('/:id', checkPermission('rentals:delete'), async (req, res) => {
  try {
    const existing = await rentalModel.getRentalById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Locação não encontrada' });

    // Excluir apaga o registro. Só é recusado quando há DINHEIRO recebido —
    // aí o histórico financeiro precisa continuar existindo (estorne antes).
    const billings = await billingModel.getBillingsByRental(req.params.id, req.tenantId);
    const comPagamento = billings.filter((b) => b.financial_status !== 'cancelado' && Number(b.paid_amount) > 0);
    if (comPagamento.length) {
      const total = comPagamento.reduce((a, b) => a + Number(b.paid_amount), 0);
      return res.status(409).json({
        success: false,
        error: `Esta locação já recebeu ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em pagamentos `
          + 'e não pode ser excluída. Estorne o pagamento no Financeiro e, se precisar, cancele a locação — o histórico é preservado.',
      });
    }
    // Faturamentos ainda não pagos saem junto.
    for (const b of billings.filter((x) => x.financial_status !== 'cancelado')) {
      await billingModel.cancelBilling(b.id, req.tenantId).catch(() => {});
    }

    const rental = await rentalModel.deleteRental(req.params.id, req.tenantId);
    await vehicleModel.refreshVehicleStatus(existing.vehicle_id, req.tenantId).catch(() => {});
    activityLog.logDelete(req.tenantId, req.userId, 'rental', req.params.id,
      `Locação ${existing.rental_number} removida`, existing).catch(() => {});
    res.json({ success: true, data: rental, message: 'Locação excluída.' });
  } catch (err) { handleErr(res, err, 'Erro ao excluir locação:'); }
});

module.exports = router;
