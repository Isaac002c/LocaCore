const pool = require('../config/db');

// ============================================
// AUTOMATION MODELS (Ciclo 3) — settings, templates, charges, outbox,
// fiscal_documents, runs, external_costs, webhook_events. Tudo tenant-scoped.
// Funções que participam de transação aceitam executor `db` (default pool).
// ============================================

const money4 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n.toFixed(4) : '0.0000'; };
const money2 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : '0.00'; };

// Inserção idempotente robusta (check-then-insert, com a constraint UNIQUE como
// rede final). Retorna { created, row }. Correto tanto em Postgres real quanto
// em pg-mem (onde ON CONFLICT ... RETURNING devolve a linha existente).
async function _insertIfAbsent(db, selSql, selParams, insSql, insParams) {
  const found = await db.query(selSql, selParams);
  if (found.rows[0]) return { created: false, row: found.rows[0] };
  try {
    const r = await db.query(insSql, insParams);
    return { created: true, row: r.rows[0] };
  } catch (e) {
    if (/unique|duplicate|violat|uq_/i.test(String(e.message))) {
      const again = await db.query(selSql, selParams);
      return { created: false, row: again.rows[0] };
    }
    throw e;
  }
}

// ── automation_settings ──────────────────────────────────────────────────────
const getSettings = async (tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM automation_settings WHERE tenant_id = $1', [tenant_id]);
  return r.rows[0];
};
const ensureSettings = async (tenant_id, db = pool) => {
  await db.query(
    'INSERT INTO automation_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
    [tenant_id]
  );
  return getSettings(tenant_id, db);
};
// Atualização parcial por whitelist de colunas (evita SQL dinâmico inseguro).
const UPDATABLE = [
  'billing_enabled', 'billing_weekday', 'billing_hour', 'billing_timezone', 'billing_due_days',
  'billing_rental_statuses', 'billing_auto_create',
  'whatsapp_enabled', 'whatsapp_provider', 'whatsapp_from', 'whatsapp_account_id',
  'whatsapp_send_start_hour', 'whatsapp_send_end_hour', 'reminder_max', 'reminder_interval_hours', 'reminder_per_day',
  'payment_provider',
  'fiscal_enabled', 'fiscal_mode', 'fiscal_provider', 'fiscal_document_type', 'fiscal_environment', 'fiscal_config',
  'cost_per_message', 'cost_per_fiscal', 'cost_currency', 'cost_monthly_limit',
];
const updateSettings = async (tenant_id, patch = {}) => {
  await ensureSettings(tenant_id);
  const sets = [], params = [];
  for (const k of UPDATABLE) {
    if (patch[k] === undefined) continue;
    params.push(k.endsWith('_statuses') || k === 'fiscal_config' ? JSON.stringify(patch[k]) : patch[k]);
    sets.push(`${k} = $${params.length}${k.endsWith('_statuses') || k === 'fiscal_config' ? '::jsonb' : ''}`);
  }
  if (!sets.length) return getSettings(tenant_id);
  params.push(tenant_id);
  const r = await pool.query(
    `UPDATE automation_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE tenant_id = $${params.length} RETURNING *`,
    params
  );
  return r.rows[0];
};

// ── message_templates ────────────────────────────────────────────────────────
const listTemplates = async (tenant_id) => {
  const r = await pool.query('SELECT * FROM message_templates WHERE tenant_id = $1 ORDER BY kind ASC', [tenant_id]);
  return r.rows;
};
const getActiveTemplate = async (tenant_id, kind, db = pool) => {
  const r = await db.query(
    'SELECT * FROM message_templates WHERE tenant_id = $1 AND kind = $2 AND active = TRUE ORDER BY updated_at DESC LIMIT 1',
    [tenant_id, kind]
  );
  return r.rows[0];
};
const upsertTemplate = async (tenant_id, { id, kind, name, language, body, provider_template_id, active }) => {
  if (id) {
    const r = await pool.query(
      `UPDATE message_templates SET kind=COALESCE($1,kind), name=$2, language=COALESCE($3,language),
         body=COALESCE($4,body), provider_template_id=$5, active=COALESCE($6,active), updated_at=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [kind || null, name || null, language || null, body || null, provider_template_id || null,
       typeof active === 'boolean' ? active : null, id, tenant_id]
    );
    return r.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO message_templates (tenant_id, kind, name, language, body, provider_template_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenant_id, kind, name || null, language || 'pt_BR', body, provider_template_id || null]
  );
  return r.rows[0];
};
const ensureDefaultTemplates = async (tenant_id) => {
  const defaults = require('../services/automation/defaultTemplates');
  for (const t of defaults) {
    const existing = await getActiveTemplate(tenant_id, t.kind);
    if (!existing) await upsertTemplate(tenant_id, t);
  }
};

// ── charges ──────────────────────────────────────────────────────────────────
const getChargeByIdemp = async (tenant_id, idempotency_key, db = pool) => {
  const r = await db.query('SELECT * FROM charges WHERE tenant_id=$1 AND idempotency_key=$2', [tenant_id, idempotency_key]);
  return r.rows[0];
};
const getChargeByExternal = async (provider, external_id, db = pool) => {
  const r = await db.query('SELECT * FROM charges WHERE provider=$1 AND external_id=$2 LIMIT 1', [provider, external_id]);
  return r.rows[0];
};
const getChargeForUpdate = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM charges WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, tenant_id]);
  return r.rows[0];
};
const insertCharge = async (data, db = pool) => {
  return _insertIfAbsent(db,
    'SELECT * FROM charges WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
    `INSERT INTO charges (tenant_id, rental_id, billing_id, client_id, provider, external_id, amount, due_date,
       status, pix_code, payment_link, expires_at, period_start, period_end, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [data.tenant_id, data.rental_id || null, data.billing_id || null, data.client_id || null,
     data.provider || 'null', data.external_id || null, money2(data.amount), data.due_date || null,
     data.status || 'pending', data.pix_code || null, data.payment_link || null, data.expires_at || null,
     data.period_start || null, data.period_end || null, data.idempotency_key]);
};
const setChargeStatus = async (id, tenant_id, status, db = pool) => {
  const r = await db.query('UPDATE charges SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *', [status, id, tenant_id]);
  return r.rows[0];
};
// Cobranças em aberto (pendentes e não expiradas) para a régua de inadimplência.
const listOpenChargesForDunning = async (tenant_id, db = pool) => {
  const r = await db.query(
    `SELECT c.*, cl.phone AS client_phone, cl.name AS client_name,
            r.rental_number, r.status AS rental_status
       FROM charges c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN rentals r  ON r.id = c.rental_id
      WHERE c.tenant_id = $1 AND c.status = 'pending'
        AND (c.expires_at IS NULL OR c.expires_at > NOW())
      ORDER BY c.created_at ASC`,
    [tenant_id]
  );
  return r.rows;
};

// ── message_outbox ───────────────────────────────────────────────────────────
const insertOutbox = async (data, db = pool) => {
  return _insertIfAbsent(db,
    'SELECT * FROM message_outbox WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
    `INSERT INTO message_outbox (tenant_id, client_id, rental_id, charge_id, template_kind, to_number, body, payload,
       status, max_attempts, next_attempt_at, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',$9,NOW(),$10) RETURNING *`,
    [data.tenant_id, data.client_id || null, data.rental_id || null, data.charge_id || null, data.template_kind,
     data.to_number || null, data.body || null, JSON.stringify(data.payload || {}), data.max_attempts || 5, data.idempotency_key]);
};
const claimPendingOutbox = async (tenant_id, limit, db = pool) => {
  const r = await db.query(
    `SELECT * FROM message_outbox
      WHERE tenant_id=$1 AND status IN ('pending','failed') AND attempts < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY created_at ASC LIMIT $2`,
    [tenant_id, limit]
  );
  return r.rows;
};
const updateOutbox = async (id, tenant_id, fields, db = pool) => {
  const allowed = ['status', 'attempts', 'next_attempt_at', 'provider', 'external_id', 'sent_at', 'delivered_at', 'read_at', 'error', 'cost_amount'];
  const sets = [], params = [];
  for (const k of allowed) if (fields[k] !== undefined) { params.push(k === 'cost_amount' ? money4(fields[k]) : fields[k]); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return null;
  params.push(id, tenant_id);
  const r = await db.query(`UPDATE message_outbox SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`, params);
  return r.rows[0];
};
const cancelRemindersForCharge = async (tenant_id, charge_id, db = pool) => {
  const r = await db.query(
    `UPDATE message_outbox SET status='canceled', updated_at=NOW()
      WHERE tenant_id=$1 AND charge_id=$2 AND template_kind='reminder'
        AND status IN ('pending','failed','queued') RETURNING id`,
    [tenant_id, charge_id]
  );
  return r.rowCount;
};
const countRemindersForCharge = async (tenant_id, charge_id, db = pool) => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM message_outbox WHERE tenant_id=$1 AND charge_id=$2 AND template_kind='reminder' AND status <> 'canceled'`,
    [tenant_id, charge_id]
  );
  return r.rows[0].n;
};
const listOutbox = async (tenant_id, { status, kind, limit = 100 } = {}) => {
  const params = [tenant_id]; let where = 'WHERE tenant_id=$1';
  if (status) { params.push(status); where += ` AND status=$${params.length}`; }
  if (kind) { params.push(kind); where += ` AND template_kind=$${params.length}`; }
  params.push(Math.min(limit, 500));
  const r = await pool.query(`SELECT * FROM message_outbox ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return r.rows;
};
const getOutboxByExternal = async (provider, external_id, db = pool) => {
  const r = await db.query('SELECT * FROM message_outbox WHERE provider=$1 AND external_id=$2 LIMIT 1', [provider, external_id]);
  return r.rows[0];
};

// ── fiscal_documents ─────────────────────────────────────────────────────────
const getFiscalByIdemp = async (tenant_id, idempotency_key, db = pool) => {
  const r = await db.query('SELECT * FROM fiscal_documents WHERE tenant_id=$1 AND idempotency_key=$2', [tenant_id, idempotency_key]);
  return r.rows[0];
};
const insertFiscal = async (data, db = pool) => {
  return _insertIfAbsent(db,
    'SELECT * FROM fiscal_documents WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
    `INSERT INTO fiscal_documents (tenant_id, rental_id, client_id, billing_id, payment_id, provider, document_type,
       amount, status, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [data.tenant_id, data.rental_id || null, data.client_id || null, data.billing_id || null, data.payment_id || null,
     data.provider || 'null', data.document_type || null, money2(data.amount), data.status || 'pending', data.idempotency_key, data.created_by || null]);
};
const updateFiscal = async (id, tenant_id, fields, db = pool) => {
  const allowed = ['status', 'external_id', 'number', 'series', 'verification_code', 'issue_date', 'authorization_date', 'cancellation_date', 'pdf_url', 'xml_url', 'error_code', 'error_message', 'retry_count'];
  const sets = [], params = [];
  for (const k of allowed) if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) return null;
  params.push(id, tenant_id);
  const r = await db.query(`UPDATE fiscal_documents SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`, params);
  return r.rows[0];
};
const listFiscal = async (tenant_id, { status, limit = 100 } = {}) => {
  const params = [tenant_id]; let where = 'WHERE tenant_id=$1';
  if (status) { params.push(status); where += ` AND status=$${params.length}`; }
  params.push(Math.min(limit, 500));
  const r = await pool.query(`SELECT * FROM fiscal_documents ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return r.rows;
};

// ── automation_runs ──────────────────────────────────────────────────────────
const startRun = async (data, db = pool) => {
  return _insertIfAbsent(db,
    'SELECT * FROM automation_runs WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
    `INSERT INTO automation_runs (tenant_id, run_type, period_start, period_end, status, idempotency_key)
     VALUES ($1,$2,$3,$4,'running',$5) RETURNING *`,
    [data.tenant_id, data.run_type, data.period_start || null, data.period_end || null, data.idempotency_key]);
};
const finishRun = async (id, tenant_id, { status, rentals_processed, charges_created, messages_enqueued, details }, db = pool) => {
  const r = await db.query(
    `UPDATE automation_runs SET status=$1, rentals_processed=$2, charges_created=$3, messages_enqueued=$4,
        details=$5::jsonb, finished_at=NOW() WHERE id=$6 AND tenant_id=$7 RETURNING *`,
    [status || 'completed', rentals_processed || 0, charges_created || 0, messages_enqueued || 0,
     JSON.stringify(details || {}), id, tenant_id]
  );
  return r.rows[0];
};
const listRuns = async (tenant_id, { limit = 20 } = {}) => {
  const r = await pool.query('SELECT * FROM automation_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT $2', [tenant_id, Math.min(limit, 100)]);
  return r.rows;
};

// ── external_costs ───────────────────────────────────────────────────────────
const recordCost = async (data, db = pool) => {
  const amount = money4(Number(data.unit_cost || 0) * Number(data.quantity || 1));
  const r = await db.query(
    `INSERT INTO external_costs (tenant_id, kind, ref_id, provider, quantity, unit_cost, amount, currency, cost_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,CURRENT_DATE)) RETURNING *`,
    [data.tenant_id, data.kind, data.ref_id || null, data.provider || null, data.quantity || 1,
     money4(data.unit_cost), amount, data.currency || 'BRL', data.cost_date || null]
  );
  return r.rows[0];
};
const costReport = async (tenant_id, { from, to } = {}) => {
  const params = [tenant_id]; let where = 'WHERE tenant_id=$1';
  if (from) { params.push(from); where += ` AND cost_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND cost_date <= $${params.length}`; }
  const r = await pool.query(
    `SELECT kind, COUNT(*)::int AS quantidade, COALESCE(SUM(amount),0) AS total
       FROM external_costs ${where} GROUP BY kind ORDER BY kind`,
    params
  );
  const total = r.rows.reduce((s, x) => s + Number(x.total), 0);
  return { by_kind: r.rows, total: total.toFixed(4) };
};

// ── webhook_events (idempotência/anti-replay) ────────────────────────────────
// Retorna TRUE se o evento é novo (registrado agora); FALSE se já processado.
const registerWebhookEvent = async ({ tenant_id, provider, kind, external_event_id }, db = pool) => {
  if (!external_event_id) return true; // sem id → não deduplica (segue)
  const res = await _insertIfAbsent(db,
    'SELECT id FROM webhook_events WHERE provider=$1 AND external_event_id=$2', [provider, external_event_id],
    `INSERT INTO webhook_events (tenant_id, provider, kind, external_event_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [tenant_id || null, provider, kind, external_event_id]);
  return res.created; // TRUE = novo; FALSE = já processado
};

module.exports = {
  getSettings, ensureSettings, updateSettings,
  listTemplates, getActiveTemplate, upsertTemplate, ensureDefaultTemplates,
  getChargeByIdemp, getChargeByExternal, getChargeForUpdate, insertCharge, setChargeStatus, listOpenChargesForDunning,
  insertOutbox, claimPendingOutbox, updateOutbox, cancelRemindersForCharge, countRemindersForCharge, listOutbox, getOutboxByExternal,
  getFiscalByIdemp, insertFiscal, updateFiscal, listFiscal,
  startRun, finishRun, listRuns,
  recordCost, costReport,
  registerWebhookEvent,
};
