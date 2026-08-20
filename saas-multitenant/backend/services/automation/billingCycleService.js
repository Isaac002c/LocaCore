'use strict';

const crypto = require('node:crypto');
const M = require('../../models/automationModels');
const billingModel = require('../../models/serviceBillingModels');
const rentalModel = require('../../models/rentalModels');
const clientModel = require('../../models/clientModels');
const tenantModel = require('../../models/tenantModels');
const { getPaymentProvider } = require('./providers/payment');
const { ensurePaymentCustomer } = require('./paymentCustomers');
const { render, buildVars } = require('./render');
const { withTransaction } = require('../tx');
const { resolveWeeklyAmount } = require('./billingAmount');
const { weekBoundsInZone, addCalendarDays } = require('./timezone');
const secretStore = require('./secretStore');
const audit = require('./auditService');

const ACTIVE_MODES = new Set(['pilot', 'staged', 'global']);
const ACTIVE_STATUSES = ['em_andamento', 'atrasado'];

function selectForMode(rentals, settings) {
  const mode = settings.automation_mode || 'global';
  if (mode === 'pilot') {
    const ids = new Set(Array.isArray(settings.pilot_rental_ids) ? settings.pilot_rental_ids.map(String) : []);
    return rentals.filter((r) => ids.has(String(r.id)));
  }
  if (mode === 'staged') return rentals.slice(0, Math.max(1, Number(settings.rollout_limit || 1)));
  if (mode === 'global') return rentals;
  return [];
}

function planRental(rental, settings, { period_start, period_end, due_date }) {
  const amount = resolveWeeklyAmount(rental, { days: 7 });
  const blockers = [];
  if (!rental.client_id) blockers.push({ code: 'MISSING_CLIENT', message: 'Locacao sem cliente.' });
  if (!rental.client_phone && settings.whatsapp_enabled) blockers.push({ code: 'MISSING_PHONE', message: 'Cliente sem telefone.' });
  if (!rental.client_cpf && settings.fiscal_enabled) blockers.push({ code: 'MISSING_DOCUMENT', message: 'Cliente sem CPF/CNPJ.' });
  if (!amount.ok) blockers.push({ code: amount.code, message: amount.reason });
  return {
    rental_id: rental.id,
    rental_number: rental.rental_number,
    client_id: rental.client_id,
    client_name: rental.client_name,
    vehicle_plate: rental.vehicle_plate,
    amount: amount.ok ? amount.amount : null,
    amount_source: amount.ok ? amount.source : null,
    period_start,
    period_end,
    due_date,
    actions: {
      checkout: !!settings.billing_auto_create,
      checkout_provider: settings.payment_provider || 'null',
      whatsapp: !!settings.whatsapp_enabled,
      whatsapp_provider: settings.whatsapp_provider || 'null',
      whatsapp_to: rental.client_phone || null,
      fiscal: !!settings.fiscal_enabled,
      fiscal_provider: settings.fiscal_provider || 'null',
      fiscal_trigger: settings.fiscal_mode || 'after_payment',
    },
    blockers,
    ready: blockers.length === 0,
  };
}

async function providerForTenant(tenant_id, settings) {
  const providerName = settings.payment_provider || 'null';
  const [stored, tenant] = await Promise.all([
    secretStore.getSecrets(tenant_id, `payment:${providerName}`),
    tenantModel.getTenantById(tenant_id).catch(() => null),
  ]);
  return getPaymentProvider(settings, { secretFn: secretStore.resolver(stored, tenant?.slug) });
}

async function dryRun(tenant_id, { now = new Date(), rental_ids = null } = {}) {
  const settings = await M.ensureSettings(tenant_id);
  const zone = settings.billing_timezone || 'America/Sao_Paulo';
  const { start: period_start, end: period_end, local } = weekBoundsInZone(now, zone);
  const due_date = addCalendarDays(local.ymd, Number(settings.billing_due_days || 0));
  const statuses = Array.isArray(settings.billing_rental_statuses) ? settings.billing_rental_statuses : ACTIVE_STATUSES;
  let rentals = (await rentalModel.getAllRentals(tenant_id, {})).filter((r) => statuses.includes(r.status));
  if (Array.isArray(rental_ids) && rental_ids.length) {
    const wanted = new Set(rental_ids.map(String));
    rentals = rentals.filter((r) => wanted.has(String(r.id)));
  } else if (ACTIVE_MODES.has(settings.automation_mode)) {
    rentals = selectForMode(rentals, settings);
  }
  const billingTemplate = await M.getActiveTemplate(tenant_id, 'billing').catch(() => null);
  const plans = rentals.map((r) => {
    const plan = planRental(r, settings, { period_start, period_end, due_date });
    plan.actions.whatsapp_template = billingTemplate?.provider_template_id || null;
    return plan;
  });
  const summary = {
    total: plans.length,
    ready: plans.filter((p) => p.ready).length,
    blocked: plans.filter((p) => !p.ready).length,
    total_amount: plans.filter((p) => p.ready).reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
  };
  await M.updateSettings(tenant_id, { automation_mode: settings.automation_mode === 'off' ? 'dry_run' : settings.automation_mode });
  await require('../../config/db').query('UPDATE automation_settings SET last_dry_run_at=NOW() WHERE tenant_id=$1', [tenant_id]).catch(() => {});
  await audit.record({ tenant_id, event_type: 'dry_run', status: summary.blocked ? 'blocked' : 'completed', details: { mode: settings.automation_mode } });
  return { dry_run: true, timezone: zone, local_time: local, period_start, period_end, summary, plans };
}

async function runBilling(tenant_id, { now = new Date(), force = false, request_id = null } = {}) {
  const settings = await M.ensureSettings(tenant_id);
  await M.ensureDefaultTemplates(tenant_id);
  if (!settings.billing_enabled && !force) return { skipped: 'billing_disabled' };
  const automationMode = settings.automation_mode || 'global';
  if (!ACTIVE_MODES.has(automationMode)) return { skipped: 'automation_not_active', mode: automationMode };
  if (!settings.billing_auto_create) return { skipped: 'automatic_charge_disabled' };

  const zone = settings.billing_timezone || 'America/Sao_Paulo';
  const { start: period_start, end: period_end, local } = weekBoundsInZone(now, zone);
  const dueDate = addCalendarDays(local.ymd, Number(settings.billing_due_days || 0));
  const statuses = Array.isArray(settings.billing_rental_statuses) ? settings.billing_rental_statuses : ACTIVE_STATUSES;
  const all = (await rentalModel.getAllRentals(tenant_id, {})).filter((r) => statuses.includes(r.status));
  const eligible = selectForMode(all, settings);
  const signature = crypto.createHash('sha256').update(JSON.stringify({ mode: automationMode, ids: eligible.map((r) => r.id), limit: settings.rollout_limit })).digest('hex').slice(0, 10);
  const runKey = `billing:${period_start}:${automationMode}:${signature}`;
  const run = await M.startRun({ tenant_id, run_type: 'billing', period_start, period_end, idempotency_key: runKey });
  if (!run.created) return { skipped: 'already_ran', period_start, period_end };

  const provider = await providerForTenant(tenant_id, settings);
  const template = await M.getActiveTemplate(tenant_id, 'billing');
  const counters = {
    rentals_processed: 0, charges_created: 0, messages_enqueued: 0,
    failed: 0, blocked: 0, details: { billed: [], failed: [], blocked: [], skipped: [] },
  };

  for (const rental of eligible) {
    const planned = planRental(rental, settings, { period_start, period_end, due_date: dueDate });
    if (!planned.ready) {
      counters.blocked++;
      counters.details.blocked.push({ rental: rental.rental_number, reasons: planned.blockers.map((b) => b.code) });
      await audit.record({ tenant_id, event_type: 'charge_blocked', status: 'blocked', rental_id: rental.id, client_id: rental.client_id, period_start, period_end, request_id, details: { rental_number: rental.rental_number, reason: planned.blockers.map((b) => b.code).join(',') } });
      continue;
    }

    const idempotencyKey = `${rental.id}:${period_start}:billing`;
    const existing = await M.getChargeByIdemp(tenant_id, idempotencyKey);
    if (existing) { counters.details.skipped.push(rental.rental_number); continue; }

    const correlationId = crypto.randomUUID();
    const publicId = await M.nextChargePublicId(tenant_id, local.year);
    const draftRes = await M.insertCharge({
      tenant_id, rental_id: rental.id, client_id: rental.client_id,
      provider: provider.name, amount: planned.amount, due_date: dueDate,
      status: 'draft', period_start, period_end, idempotency_key: idempotencyKey,
      public_id: publicId, correlation_id: correlationId,
    });
    const draft = draftRes.row;
    if (!draftRes.created) { counters.details.skipped.push(rental.rental_number); continue; }
    await M.updateCharge(draft.id, tenant_id, { status: 'processing', attempts: 1 });
    await audit.record({ tenant_id, event_type: 'charge_processing', status: 'processing', rental_id: rental.id, client_id: rental.client_id, charge_id: draft.id, amount: planned.amount, period_start, period_end, provider: provider.name, request_id, correlation_id: correlationId, attempt: 1, details: { public_id: publicId, source: planned.amount_source } });

    let external;
    try {
      const fullClient = await clientModel.getClientById(rental.client_id, tenant_id).catch(() => null);
      const externalCustomer = provider.supportsExternalCustomer
        ? await ensurePaymentCustomer(tenant_id, provider, { client_id: rental.client_id, client_name: rental.client_name, client_phone: rental.client_phone })
        : null;
      external = await provider.createCharge({
        amount: planned.amount,
        due_date: dueDate,
        public_id: publicId,
        external_customer_id: externalCustomer,
        client: fullClient || { name: rental.client_name, phone: rental.client_phone },
        description: `Locacao ${rental.rental_number} - ${period_start} a ${period_end}`,
      });
      if (!external || !external.external_id || (!external.payment_link && !external.pix_code)) {
        throw Object.assign(new Error('Provedor nao devolveu checkout ou Pix valido.'), { code: 'INVALID_PROVIDER_RESPONSE' });
      }
    } catch (err) {
      const ambiguous = err.code === 'NETWORK_ERROR';
      const status = ambiguous ? 'needs_attention' : 'failed';
      await M.updateCharge(draft.id, tenant_id, {
        status, error_code: err.code || 'PROVIDER_ERROR', error_message: String(err.message).slice(0, 1000),
        next_attempt_at: err.retryable && !ambiguous ? new Date(now.getTime() + 5 * 60 * 1000).toISOString() : null,
      });
      await audit.record({ tenant_id, event_type: 'charge_create_failed', status, rental_id: rental.id, client_id: rental.client_id, charge_id: draft.id, amount: planned.amount, period_start, period_end, provider: provider.name, request_id, correlation_id: correlationId, attempt: 1, error_code: err.code || 'PROVIDER_ERROR', error_message: err.message, details: { public_id: publicId } });
      counters.failed++;
      counters.details.failed.push({ rental: rental.rental_number, public_id: publicId, code: err.code || 'PROVIDER_ERROR' });
      continue;
    }

    try {
      const saved = await withTransaction(async (db) => {
        const billing = await billingModel.createBilling({
          tenant_id, client_id: rental.client_id, rental_id: rental.id,
          description: `Locacao ${rental.rental_number} - semana ${period_start} a ${period_end}`,
          original_amount: planned.amount, discount: 0, surcharge: 0, final_amount: planned.amount,
          paid_amount: 0, installments: 1, due_date: dueDate, payment_method: 'pix',
          financial_status: 'faturado', created_by: null,
        }, db);
        const charge = await M.updateCharge(draft.id, tenant_id, {
          billing_id: billing.id,
          external_id: external.external_id,
          status: external.status === 'paid' ? 'paid' : 'waiting_payment',
          pix_code: external.pix_code || null,
          payment_link: external.payment_link || null,
          expires_at: external.expires_at || null,
          provider_metadata: external.provider_metadata || {},
          error_code: null, error_message: null,
        }, db);

        let message = null;
        if (settings.whatsapp_enabled) {
          const vars = buildVars({ rental, charge: { ...charge, client_name: rental.client_name } });
          const text = template ? render(template.body, vars).text : `Cobranca da locacao ${rental.rental_number}: ${vars.valor}`;
          message = await M.insertOutbox({
            tenant_id, client_id: rental.client_id, rental_id: rental.id, charge_id: charge.id,
            template_kind: 'billing', to_number: rental.client_phone, body: text, payload: vars,
            idempotency_key: `${idempotencyKey}:msg`,
          }, db);
        }
        return { billing, charge, message };
      });

      counters.rentals_processed++;
      counters.charges_created++;
      if (saved.message?.created) counters.messages_enqueued++;
      counters.details.billed.push({ rental: rental.rental_number, public_id: publicId, amount: planned.amount });
      await audit.record({ tenant_id, event_type: 'charge_created', status: 'waiting_payment', rental_id: rental.id, client_id: rental.client_id, charge_id: saved.charge.id, billing_id: saved.billing.id, amount: planned.amount, period_start, period_end, provider: provider.name, request_id, correlation_id: correlationId, details: { public_id: publicId, source: planned.amount_source } });

      if (settings.fiscal_enabled && settings.fiscal_mode === 'on_charge') {
        const fiscalService = require('./fiscalService');
        await fiscalService.issueForCharge(tenant_id, saved.charge.id, { settings }).catch(() => null);
      }
    } catch (err) {
      // O checkout externo existe, mas a persistencia financeira falhou. Nunca
      // criamos outro automaticamente: exige conciliacao humana.
      await M.updateCharge(draft.id, tenant_id, { status: 'needs_attention', error_code: 'LOCAL_COMMIT_FAILED', error_message: String(err.message).slice(0, 1000) });
      await audit.record({ tenant_id, event_type: 'charge_local_commit_failed', status: 'needs_attention', rental_id: rental.id, client_id: rental.client_id, charge_id: draft.id, amount: planned.amount, period_start, period_end, provider: provider.name, request_id, correlation_id: correlationId, error_code: 'LOCAL_COMMIT_FAILED', error_message: err.message, details: { public_id: publicId } });
      counters.failed++;
      counters.details.failed.push({ rental: rental.rental_number, public_id: publicId, code: 'LOCAL_COMMIT_FAILED' });
    }
  }

  const runStatus = counters.failed || counters.blocked ? 'failed' : 'completed';
  await M.finishRun(run.row.id, tenant_id, { status: runStatus, ...counters });
  return { ok: runStatus === 'completed', timezone: zone, local_time: local, period_start, period_end, ...counters };
}

async function retryCharge(tenant_id, charge_id, { now = new Date(), request_id = null } = {}) {
  const charge = await M.getChargeForUpdate(charge_id, tenant_id);
  if (!charge) return null;
  if (charge.status !== 'failed') {
    const err = new Error(charge.status === 'needs_attention'
      ? 'Cobranca com resultado externo ambiguo exige conciliacao manual.'
      : 'Somente cobrancas com falha confirmada podem ser reprocessadas.');
    err.statusCode = 409; throw err;
  }
  const attempt = Number(charge.attempts || 0) + 1;
  if (attempt > 5) {
    await M.updateCharge(charge.id, tenant_id, { status: 'needs_attention', next_attempt_at: null });
    return { ...charge, status: 'needs_attention' };
  }
  const [settings, rental] = await Promise.all([
    M.getSettings(tenant_id),
    rentalModel.getRentalById(charge.rental_id, tenant_id),
  ]);
  if (!settings || !rental) throw Object.assign(new Error('Configuracao ou locacao nao encontrada.'), { statusCode: 409 });
  const provider = await providerForTenant(tenant_id, settings);
  if (provider.name !== charge.provider) throw Object.assign(new Error('O provedor da cobranca foi alterado; revise manualmente.'), { statusCode: 409 });
  await M.updateCharge(charge.id, tenant_id, { status: 'processing', attempts: attempt, next_attempt_at: null, error_code: null, error_message: null });
  let external;
  try {
    const fullClient = await clientModel.getClientById(rental.client_id, tenant_id).catch(() => null);
    const externalCustomer = provider.supportsExternalCustomer
      ? await ensurePaymentCustomer(tenant_id, provider, { client_id: rental.client_id, client_name: rental.client_name, client_phone: rental.client_phone })
      : null;
    external = await provider.createCharge({
      amount: charge.amount, due_date: charge.due_date, public_id: charge.public_id,
      external_customer_id: externalCustomer, client: fullClient,
      description: `Locacao ${rental.rental_number} - ${charge.period_start} a ${charge.period_end}`,
    });
    if (!external?.external_id || (!external.payment_link && !external.pix_code)) {
      throw Object.assign(new Error('Provedor nao devolveu checkout ou Pix valido.'), { code: 'INVALID_PROVIDER_RESPONSE' });
    }
  } catch (err) {
    const ambiguous = err.code === 'NETWORK_ERROR';
    const status = ambiguous || attempt >= 5 ? 'needs_attention' : 'failed';
    await M.updateCharge(charge.id, tenant_id, {
      status, error_code: err.code || 'PROVIDER_ERROR', error_message: String(err.message).slice(0, 1000),
      next_attempt_at: err.retryable && status === 'failed' ? new Date(now.getTime() + Math.min(60, 5 * 2 ** (attempt - 1)) * 60000).toISOString() : null,
    });
    await audit.record({ tenant_id, event_type: 'charge_retry_failed', status,
      rental_id: rental.id, client_id: rental.client_id, charge_id: charge.id, amount: charge.amount,
      provider: provider.name, request_id, attempt, error_code: err.code || 'PROVIDER_ERROR', error_message: err.message,
      details: { public_id: charge.public_id } });
    return { ...charge, status, error_code: err.code || 'PROVIDER_ERROR' };
  }

  try {
    const saved = await withTransaction(async (db) => {
      const billing = await billingModel.createBilling({
        tenant_id, client_id: rental.client_id, rental_id: rental.id,
        description: `Locacao ${rental.rental_number} - semana ${charge.period_start} a ${charge.period_end}`,
        original_amount: charge.amount, discount: 0, surcharge: 0, final_amount: charge.amount,
        paid_amount: 0, installments: 1, due_date: charge.due_date, payment_method: 'pix',
        financial_status: 'faturado', created_by: null,
      }, db);
      const updated = await M.updateCharge(charge.id, tenant_id, {
        billing_id: billing.id, external_id: external.external_id,
        status: external.status === 'paid' ? 'paid' : 'waiting_payment',
        pix_code: external.pix_code || null, payment_link: external.payment_link || null,
        expires_at: external.expires_at || null, provider_metadata: external.provider_metadata || {},
        error_code: null, error_message: null, next_attempt_at: null,
      }, db);
      if (settings.whatsapp_enabled && rental.client_phone) {
        const template = await M.getActiveTemplate(tenant_id, 'billing', db);
        const vars = buildVars({ rental, charge: { ...updated, client_name: rental.client_name } });
        const text = template ? render(template.body, vars).text : `Cobranca da locacao ${rental.rental_number}: ${vars.valor}`;
        await M.insertOutbox({ tenant_id, client_id: rental.client_id, rental_id: rental.id, charge_id: updated.id,
          template_kind: 'billing', to_number: rental.client_phone, body: text, payload: vars,
          idempotency_key: `${charge.id}:billing-message` }, db);
      }
      return updated;
    });
    await audit.record({ tenant_id, event_type: 'charge_retry_succeeded', status: saved.status,
      rental_id: rental.id, client_id: rental.client_id, charge_id: charge.id, amount: charge.amount,
      provider: provider.name, request_id, attempt, details: { public_id: charge.public_id } });
    return saved;
  } catch (err) {
    await M.updateCharge(charge.id, tenant_id, { status: 'needs_attention', error_code: 'LOCAL_COMMIT_FAILED', error_message: String(err.message).slice(0, 1000) });
    throw err;
  }
}

async function retryDueCharges(tenant_id, { now = new Date(), limit = 20 } = {}) {
  const pool = require('../../config/db');
  const rows = (await pool.query(
    `SELECT id FROM charges WHERE tenant_id=$1 AND status='failed' AND attempts < 5
      AND next_attempt_at IS NOT NULL AND next_attempt_at <= $2 ORDER BY next_attempt_at LIMIT $3`,
    [tenant_id, now.toISOString(), Math.min(Number(limit) || 20, 100)],
  )).rows;
  let retried = 0, failed = 0;
  for (const row of rows) {
    const result = await retryCharge(tenant_id, row.id, { now }).catch(() => null);
    if (result && result.status === 'waiting_payment') retried++; else failed++;
  }
  return { candidates: rows.length, retried, failed };
}

module.exports = { runBilling, retryCharge, retryDueCharges, dryRun, planRental, selectForMode, weekBounds: weekBoundsInZone, providerForTenant };
