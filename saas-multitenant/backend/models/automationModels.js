const pool = require('../config/db');

// ============================================
// AUTOMATION MODELS (Ciclo 3) — settings, templates, charges, outbox,
// fiscal_documents, runs, external_costs, webhook_events. Tudo tenant-scoped.
// Funções que participam de transação aceitam executor `db` (default pool).
// ============================================

const money4 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n.toFixed(4) : '0.0000'; };
const money2 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : '0.00'; };
const formatChargePublicId = (tenant_id, year, number) => {
  // O webhook InfinitePay chega antes de conhecermos o tenant. Por isso o
  // order_nsu precisa ser globalmente inequívoco, e não apenas sequencial por
  // tenant. UUID sem hífens preserva essa unicidade sem revelar outro dado.
  const tenantToken = String(tenant_id || 'tenant').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 32);
  return `COB-${tenantToken}-${String(year)}-${String(number).padStart(6, '0')}`;
};

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
  'automation_mode', 'pilot_rental_ids', 'rollout_limit',
  'whatsapp_enabled', 'whatsapp_provider', 'whatsapp_from', 'whatsapp_account_id',
  'whatsapp_send_start_hour', 'whatsapp_send_end_hour', 'reminder_max', 'reminder_interval_hours', 'reminder_per_day',
  'payment_provider', 'payment_config', 'whatsapp_config', 'payments_enabled',
  'fiscal_enabled', 'fiscal_mode', 'fiscal_provider', 'fiscal_document_type', 'fiscal_environment', 'fiscal_config',
  'receipts_enabled', 'nfse_enabled', 'nfse_mandatory_from', 'document_auto_send',
  'cost_per_message', 'cost_per_fiscal', 'cost_currency', 'cost_monthly_limit',
];
const updateSettings = async (tenant_id, patch = {}) => {
  await ensureSettings(tenant_id);
  const sets = [], params = [];
  for (const k of UPDATABLE) {
    if (patch[k] === undefined) continue;
    const json = k.endsWith('_statuses') || ['fiscal_config', 'payment_config', 'whatsapp_config', 'pilot_rental_ids'].includes(k);
    params.push(json ? JSON.stringify(patch[k]) : patch[k]);
    sets.push(`${k} = $${params.length}${json ? '::jsonb' : ''}`);
  }
  if (!sets.length) return getSettings(tenant_id);
  params.push(tenant_id);
  const r = await pool.query(
    `UPDATE automation_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE tenant_id = $${params.length} RETURNING *`,
    params
  );
  return r.rows[0];
};

const nextChargePublicId = async (tenant_id, year = new Date().getUTCFullYear(), db = pool) => {
  await ensureSettings(tenant_id, db);
  try {
    const r = await db.query(
      `UPDATE automation_settings
          SET last_charge_number=last_charge_number+1, updated_at=NOW()
        WHERE tenant_id=$1 RETURNING last_charge_number`,
      [tenant_id],
    );
    return formatChargePublicId(tenant_id, year, r.rows[0].last_charge_number);
  } catch (err) {
    if (!/last_charge_number|column .* does not exist/i.test(err.message)) throw err;
    const r = await db.query('SELECT COUNT(*)::int AS n FROM charges WHERE tenant_id=$1', [tenant_id]);
    return formatChargePublicId(tenant_id, year, Number(r.rows[0]?.n || 0) + 1);
  }
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
const getChargeByPublicId = async (provider, public_id, db = pool) => {
  const r = await db.query(
    'SELECT * FROM charges WHERE provider=$1 AND public_id=$2 LIMIT 1',
    [provider, public_id],
  );
  return r.rows[0];
};
const getChargeForUpdate = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM charges WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, tenant_id]);
  return r.rows[0];
};
const insertCharge = async (data, db = pool) => {
  try { return await _insertIfAbsent(db,
    'SELECT * FROM charges WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
    `INSERT INTO charges (tenant_id, rental_id, billing_id, client_id, provider, external_id, amount, due_date,
       status, pix_code, payment_link, expires_at, period_start, period_end, idempotency_key,
       public_id,provider_metadata,transaction_nsu,receipt_url,error_code,error_message,attempts,next_attempt_at,
       confirmed_at,correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [data.tenant_id, data.rental_id || null, data.billing_id || null, data.client_id || null,
     data.provider || 'null', data.external_id || null, money2(data.amount), data.due_date || null,
     data.status || 'draft', data.pix_code || null, data.payment_link || null, data.expires_at || null,
     data.period_start || null, data.period_end || null, data.idempotency_key, data.public_id || null,
     JSON.stringify(data.provider_metadata || {}), data.transaction_nsu || null, data.receipt_url || null,
     data.error_code || null, data.error_message || null, Number(data.attempts || 0), data.next_attempt_at || null,
     data.confirmed_at || null, data.correlation_id || null]);
  } catch (err) {
    if (!/public_id|provider_metadata|column .* does not exist/i.test(err.message)) throw err;
    const legacyStatus = ['paid', 'expired', 'canceled'].includes(data.status) ? data.status : 'pending';
    return _insertIfAbsent(db,
      'SELECT * FROM charges WHERE tenant_id=$1 AND idempotency_key=$2', [data.tenant_id, data.idempotency_key],
      `INSERT INTO charges (tenant_id,rental_id,billing_id,client_id,provider,external_id,amount,due_date,
        status,pix_code,payment_link,expires_at,period_start,period_end,idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [data.tenant_id, data.rental_id || null, data.billing_id || null, data.client_id || null,
        data.provider || 'null', data.external_id || null, money2(data.amount), data.due_date || null,
        legacyStatus, data.pix_code || null, data.payment_link || null, data.expires_at || null,
        data.period_start || null, data.period_end || null, data.idempotency_key]);
  }
};
const setChargeStatus = async (id, tenant_id, status, db = pool) => {
  const r = await db.query('UPDATE charges SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *', [status, id, tenant_id]);
  return r.rows[0];
};
const updateCharge = async (id, tenant_id, fields = {}, db = pool) => {
  const allowed = [
    'billing_id', 'external_id', 'status', 'pix_code', 'payment_link', 'expires_at',
    'provider_metadata', 'transaction_nsu', 'receipt_url', 'error_code', 'error_message',
    'attempts', 'next_attempt_at', 'confirmed_at', 'correlation_id',
  ];
  const sets = [], params = [];
  for (const key of allowed) {
    if (fields[key] === undefined) continue;
    const json = key === 'provider_metadata';
    params.push(json ? JSON.stringify(fields[key] || {}) : fields[key]);
    sets.push(`${key}=$${params.length}${json ? '::jsonb' : ''}`);
  }
  if (!sets.length) return getChargeForUpdate(id, tenant_id, db);
  params.push(id, tenant_id);
  try {
    const r = await db.query(
      `UPDATE charges SET ${sets.join(', ')}, updated_at=NOW()
        WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`, params);
    return r.rows[0];
  } catch (err) {
    if (!/column .* does not exist|column .*not found|provider_metadata|confirmed_at|correlation_id/i.test(err.message)) throw err;
    const legacyAllowed = ['billing_id', 'external_id', 'status', 'pix_code', 'payment_link', 'expires_at'];
    const legacy = {}; for (const key of legacyAllowed) if (fields[key] !== undefined) legacy[key] = fields[key];
    if (legacy.status && !['paid', 'expired', 'canceled'].includes(legacy.status)) legacy.status = 'pending';
    const legacySets = [], legacyParams = [];
    for (const [key, value] of Object.entries(legacy)) { legacyParams.push(value); legacySets.push(`${key}=$${legacyParams.length}`); }
    if (!legacySets.length) return getChargeForUpdate(id, tenant_id, db);
    legacyParams.push(id, tenant_id);
    const r = await db.query(`UPDATE charges SET ${legacySets.join(', ')},updated_at=NOW() WHERE id=$${legacyParams.length - 1} AND tenant_id=$${legacyParams.length} RETURNING *`, legacyParams);
    return r.rows[0];
  }
};

const listCharges = async (tenant_id, filters = {}) => {
  const params = [tenant_id];
  let where = 'WHERE c.tenant_id=$1';
  if (filters.status) { params.push(filters.status); where += ` AND c.status=$${params.length}`; }
  if (filters.date_from) { params.push(filters.date_from); where += ` AND c.due_date >= $${params.length}`; }
  if (filters.date_to) { params.push(filters.date_to); where += ` AND c.due_date <= $${params.length}`; }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where += ` AND (c.public_id ILIKE $${params.length} OR cl.name ILIKE $${params.length} OR r.rental_number ILIKE $${params.length} OR v.plate ILIKE $${params.length})`;
  }
  params.push(Math.min(Number(filters.limit) || 100, 500));
  const r = await pool.query(
    `SELECT c.*,cl.name AS client_name,cl.phone AS client_phone,r.rental_number,
            v.plate AS vehicle_plate,
            EXISTS(SELECT 1 FROM fiscal_documents f WHERE f.tenant_id=c.tenant_id AND f.billing_id=c.billing_id AND f.status IN ('authorized','processing','pending')) AS has_fiscal,
            (SELECT o.status FROM message_outbox o WHERE o.tenant_id=c.tenant_id AND o.charge_id=c.id ORDER BY o.created_at DESC LIMIT 1) AS whatsapp_status,
            (SELECT o.sent_at FROM message_outbox o WHERE o.tenant_id=c.tenant_id AND o.charge_id=c.id ORDER BY o.created_at DESC LIMIT 1) AS last_message_at
       FROM charges c
       LEFT JOIN clients cl ON cl.id=c.client_id AND cl.tenant_id=c.tenant_id
       LEFT JOIN rentals r ON r.id=c.rental_id AND r.tenant_id=c.tenant_id
       LEFT JOIN vehicles v ON v.id=r.vehicle_id AND v.tenant_id=r.tenant_id
       ${where} ORDER BY c.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
};
// Cobranças em aberto (pendentes e não expiradas) para a régua de inadimplência.
const listOpenChargesForDunning = async (tenant_id, db = pool) => {
  const r = await db.query(
    `SELECT c.*, cl.phone AS client_phone, cl.name AS client_name,
            r.rental_number, r.status AS rental_status
       FROM charges c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN rentals r  ON r.id = c.rental_id
      WHERE c.tenant_id = $1 AND c.status IN ('pending','waiting_payment','overdue')
        AND (c.expires_at IS NULL OR c.expires_at > NOW())
      ORDER BY c.created_at ASC`,
    [tenant_id]
  );
  return r.rows;
};

// ── payment_customers (mapa cliente → customer do provedor de cobrança) ──────
const getPaymentCustomer = async (tenant_id, provider, client_id, db = pool) => {
  const r = await db.query(
    'SELECT * FROM payment_customers WHERE tenant_id=$1 AND provider=$2 AND client_id=$3',
    [tenant_id, provider, client_id]
  );
  return r.rows[0];
};
const savePaymentCustomer = async ({ tenant_id, provider, client_id, external_customer_id }, db = pool) => {
  return _insertIfAbsent(db,
    'SELECT * FROM payment_customers WHERE tenant_id=$1 AND provider=$2 AND client_id=$3',
    [tenant_id, provider, client_id],
    `INSERT INTO payment_customers (tenant_id, provider, client_id, external_customer_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [tenant_id, provider, client_id, external_customer_id]);
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
const getFiscalById = async (tenant_id, id, db = pool) => {
  const r = await db.query('SELECT * FROM fiscal_documents WHERE tenant_id=$1 AND id=$2', [tenant_id, id]);
  return r.rows[0];
};
// Reserva uma identidade DPS uma única vez. O bloqueio transacional evita que
// workers concorrentes reutilizem o mesmo número; retentativas preservam a
// série/número originalmente assinados.
const reserveFiscalDpsIdentity = async (tenant_id, id, series) => {
  const normalizedSeries = String(series || '').replace(/\D/g, '');
  if (!normalizedSeries || normalizedSeries.length > 5) throw new Error('Série DPS inválida.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = (await db.query(
      'SELECT dps_number,dps_series FROM fiscal_documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [tenant_id, id],
    )).rows[0];
    if (!current) throw new Error('Documento fiscal não encontrado.');
    if (current.dps_number && current.dps_series) {
      await db.query('COMMIT');
      return { number: String(current.dps_number), series: String(current.dps_series) };
    }
    const next = (await db.query(
      `UPDATE automation_settings SET last_dps_number=last_dps_number+1,updated_at=NOW()
        WHERE tenant_id=$1 RETURNING last_dps_number`, [tenant_id],
    )).rows[0];
    if (!next) throw new Error('Configurações de automação não encontradas.');
    const updated = (await db.query(
      `UPDATE fiscal_documents SET dps_number=$1,dps_series=$2,updated_at=NOW()
        WHERE tenant_id=$3 AND id=$4 RETURNING dps_number,dps_series`,
      [next.last_dps_number, normalizedSeries, tenant_id, id],
    )).rows[0];
    await db.query('COMMIT');
    return { number: String(updated.dps_number), series: String(updated.dps_series) };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
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
  const allowed = ['status', 'external_id', 'number', 'series', 'verification_code', 'issue_date', 'authorization_date', 'cancellation_date', 'pdf_url', 'xml_url', 'error_code', 'error_message', 'retry_count', 'next_attempt_at', 'provider_payload', 'fiscal_category', 'dps_number', 'dps_series'];
  const sets = [], params = [];
  for (const k of allowed) if (fields[k] !== undefined) {
    const json = k === 'provider_payload';
    params.push(json ? JSON.stringify(fields[k] || {}) : fields[k]);
    sets.push(`${k}=$${params.length}${json ? '::jsonb' : ''}`);
  }
  if (!sets.length) return null;
  params.push(id, tenant_id);
  try {
    const r = await db.query(`UPDATE fiscal_documents SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`, params);
    return r.rows[0];
  } catch (err) {
    if (!/column .* does not exist|column .*not found|provider_payload|next_attempt_at|fiscal_category/i.test(err.message)) throw err;
    const legacyAllowed = new Set(['status', 'external_id', 'number', 'series', 'verification_code', 'issue_date', 'authorization_date', 'cancellation_date', 'pdf_url', 'xml_url', 'error_code', 'error_message', 'retry_count']);
    const legacySets = [], legacyParams = [];
    for (const [key, value] of Object.entries(fields)) if (legacyAllowed.has(key)) { legacyParams.push(value); legacySets.push(`${key}=$${legacyParams.length}`); }
    if (!legacySets.length) return getFiscalById(tenant_id, id, db);
    legacyParams.push(id, tenant_id);
    const r = await db.query(`UPDATE fiscal_documents SET ${legacySets.join(', ')},updated_at=NOW() WHERE id=$${legacyParams.length - 1} AND tenant_id=$${legacyParams.length} RETURNING *`, legacyParams);
    return r.rows[0];
  }
};
const listFiscal = async (tenant_id, { status, limit = 100 } = {}) => {
  const params = [tenant_id]; let where = 'WHERE tenant_id=$1';
  if (status) { params.push(status); where += ` AND f.status=$${params.length}`; }
  params.push(Math.min(limit, 500));
  try {
    const scopedWhere = where.replace('WHERE tenant_id=', 'WHERE f.tenant_id=');
    const r = await pool.query(
      `SELECT f.*, d.id AS archived_document_id, d.file_url AS archived_document_url
         FROM fiscal_documents f
         LEFT JOIN documents d ON d.tenant_id=f.tenant_id AND d.fiscal_document_id=f.id
         ${scopedWhere} ORDER BY f.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows;
  } catch (err) {
    if (!/fiscal_document_id|column .* does not exist/i.test(err.message)) throw err;
    const legacyWhere = where.replace(/\bf\./g, '');
    const r = await pool.query(`SELECT * FROM fiscal_documents ${legacyWhere} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return r.rows;
  }
};

const getFiscalCategoryMapping = async (tenant_id, category_key, db = pool) => {
  const r = await db.query(
    'SELECT * FROM fiscal_category_mappings WHERE tenant_id=$1 AND category_key=$2 AND active=TRUE',
    [tenant_id, category_key],
  );
  return r.rows[0];
};
const upsertFiscalCategoryMapping = async (tenant_id, data, db = pool) => {
  const r = await db.query(
    `INSERT INTO fiscal_category_mappings
      (tenant_id,category_key,label,national_tax_code,municipal_service_code,nbs_code,
       cst_ibs_cbs,tax_classification,iss_treatment,config,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (tenant_id,category_key) DO UPDATE SET
       label=EXCLUDED.label,national_tax_code=EXCLUDED.national_tax_code,
       municipal_service_code=EXCLUDED.municipal_service_code,nbs_code=EXCLUDED.nbs_code,
       cst_ibs_cbs=EXCLUDED.cst_ibs_cbs,tax_classification=EXCLUDED.tax_classification,
       iss_treatment=EXCLUDED.iss_treatment,config=EXCLUDED.config,active=EXCLUDED.active,updated_at=NOW()
     RETURNING *`,
    [tenant_id, data.category_key, data.label, data.national_tax_code || null,
      data.municipal_service_code || null, data.nbs_code || null, data.cst_ibs_cbs || null,
      data.tax_classification || null, data.iss_treatment || null,
      JSON.stringify(data.config || {}), data.active !== false],
  );
  return r.rows[0];
};
const listFiscalCategoryMappings = async (tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM fiscal_category_mappings WHERE tenant_id=$1 ORDER BY label', [tenant_id]);
  return r.rows;
};

// Defaults REUTILIZÁVEIS por locadora (§12): cada natureza de cobrança tem
// tratamento fiscal próprio e NÃO herda o da locação. Só a locação pura recebe o
// código nacional 99.04.01 e ISS não incidente (config inicial confirmada pelo
// contador da Rental — ajustável por tenant). Semeadas apenas se ausentes:
// NUNCA sobrescreve edição do administrador. Não invento CST/cClassTrib (Simples).
const DEFAULT_FISCAL_CATEGORIES = [
  { category_key: 'locacao', label: 'Locação de veículo', national_tax_code: '99.04.01', iss_treatment: 'nao_incide' },
  { category_key: 'multa', label: 'Multa contratual', iss_treatment: 'configuravel' },
  { category_key: 'juros', label: 'Juros', iss_treatment: 'configuravel' },
  { category_key: 'caucao', label: 'Caução', iss_treatment: 'nao_tributavel' },
  { category_key: 'manutencao', label: 'Manutenção', iss_treatment: 'configuravel' },
  { category_key: 'avaria', label: 'Avaria / Dano', iss_treatment: 'configuravel' },
  { category_key: 'combustivel', label: 'Combustível', iss_treatment: 'configuravel' },
  { category_key: 'servico_adicional', label: 'Serviço adicional', iss_treatment: 'configuravel' },
];
const ensureDefaultFiscalCategories = async (tenant_id, db = pool) => {
  for (const c of DEFAULT_FISCAL_CATEGORIES) {
    await db.query(
      `INSERT INTO fiscal_category_mappings (tenant_id, category_key, label, national_tax_code, iss_treatment, active)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (tenant_id, category_key) DO NOTHING`,
      [tenant_id, c.category_key, c.label, c.national_tax_code || null, c.iss_treatment || null],
    );
  }
  return listFiscalCategoryMappings(tenant_id, db);
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
const registerWebhookEvent = async ({ tenant_id, provider, kind, external_event_id, payload_hash, correlation_id }, db = pool) => {
  if (!external_event_id) return true; // sem id → não deduplica (segue)
  let res;
  try { res = await _insertIfAbsent(db,
    'SELECT id FROM webhook_events WHERE provider=$1 AND external_event_id=$2', [provider, external_event_id],
    `INSERT INTO webhook_events (tenant_id,provider,kind,external_event_id,payload_hash,correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenant_id || null, provider, kind, external_event_id, payload_hash || null, correlation_id || null]);
  } catch (err) {
    if (!/payload_hash|correlation_id|column .* does not exist/i.test(err.message)) throw err;
    res = await _insertIfAbsent(db,
      'SELECT id FROM webhook_events WHERE provider=$1 AND external_event_id=$2', [provider, external_event_id],
      'INSERT INTO webhook_events (tenant_id,provider,kind,external_event_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [tenant_id || null, provider, kind, external_event_id]);
  }
  if (res.created) return true;

  // O provedor deve conseguir reenviar um evento cujo processamento interno
  // terminou em erro. A transição condicional garante que apenas uma réplica
  // retome o evento; eventos processados continuam deduplicados.
  try {
    const retry = await db.query(
      `UPDATE webhook_events
          SET processing_status='received', error_message=NULL,
              received_at=NOW(), processed_at=NULL
        WHERE provider=$1 AND external_event_id=$2 AND processing_status='failed'
        RETURNING id`,
      [provider, external_event_id],
    );
    return retry.rowCount > 0;
  } catch (err) {
    // Compatibilidade temporária durante rolling deploy: no schema anterior
    // não havia estado de processamento, portanto o comportamento é deduplicar.
    if (!/processing_status|received_at|processed_at|column .* does not exist/i.test(err.message)) throw err;
    return false;
  }
};
const getLastReminderForCharge = async (tenant_id, charge_id, db = pool) => {
  const r = await db.query(
    `SELECT id,created_at,status FROM message_outbox
      WHERE tenant_id=$1 AND charge_id=$2 AND template_kind='reminder' AND status <> 'canceled'
      ORDER BY created_at DESC LIMIT 1`,
    [tenant_id, charge_id],
  );
  return r.rows[0];
};

const markWebhookProcessed = async (provider, external_event_id, { status = 'processed', error_message = null } = {}, db = pool) => {
  if (!external_event_id) return null;
  try {
    const r = await db.query(
      `UPDATE webhook_events SET processing_status=$1,error_message=$2,processed_at=NOW()
        WHERE provider=$3 AND external_event_id=$4 RETURNING *`,
      [status, error_message ? String(error_message).slice(0, 1000) : null, provider, external_event_id]);
    return r.rows[0];
  } catch (err) {
    if (!/processing_status|column .* does not exist/i.test(err.message)) throw err;
    return null;
  }
};


// =============================================================================
// CONSOLE OPERACIONAL (§8) — números da fila, dead-letter e retries.
//
// "Dead-letter" = mensagem que ESGOTOU as tentativas (attempts >= max_attempts)
// ou foi marcada como `dead`. Ela não é reprocessada sozinha: exige ação humana.
// =============================================================================

// Contagem da fila por estado, num único SELECT por estado (compatível com
// pg-mem: sem FILTER, sem CASE agregado).
const outboxCounters = async (tenant_id) => {
  const um = async (sql, params) => {
    try { const r = await pool.query(sql, params); return Number(r.rows[0]?.n) || 0; }
    catch (_) { return 0; }
  };
  const base = 'SELECT COUNT(*)::int AS n FROM message_outbox WHERE tenant_id=$1';
  const [pendentes, processando, enviadas, entregues, falhas, bloqueadas, dead, retries] = await Promise.all([
    um(`${base} AND status='pending'`, [tenant_id]),
    um(`${base} AND status='processing'`, [tenant_id]),
    um(`${base} AND status='sent'`, [tenant_id]),
    um(`${base} AND status='delivered'`, [tenant_id]),
    um(`${base} AND status='failed' AND attempts < max_attempts`, [tenant_id]),
    um(`${base} AND status='skipped'`, [tenant_id]),
    um(`${base} AND (status='dead' OR (status='failed' AND attempts >= max_attempts))`, [tenant_id]),
    // Total de reentregas acumuladas (mede o quanto o provedor está instável).
    (async () => {
      try {
        const r = await pool.query('SELECT COALESCE(SUM(attempts),0)::int AS n FROM message_outbox WHERE tenant_id=$1 AND attempts > 0', [tenant_id]);
        return Number(r.rows[0]?.n) || 0;
      } catch (_) { return 0; }
    })(),
  ]);
  return {
    pendentes, processando, enviadas, entregues,
    falhas, bloqueadas, dead_letter: dead, retries,
    concluidas: enviadas + entregues,
  };
};

// Mensagens que exigem ação humana (dead-letter), com o erro e o contexto.
const listDeadLetter = async (tenant_id, { limit = 100 } = {}) => {
  try {
    const r = await pool.query(
      `SELECT o.id, o.template_kind, o.to_number, o.status, o.attempts, o.max_attempts,
              o.provider, o.error, o.created_at, o.updated_at, o.next_attempt_at,
              o.charge_id, o.rental_id, o.client_id
         FROM message_outbox o
        WHERE o.tenant_id = $1
          AND (o.status = 'dead' OR (o.status = 'failed' AND o.attempts >= o.max_attempts))
        ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC
        LIMIT $2`,
      [tenant_id, Math.min(limit, 500)],
    );
    return r.rows;
  } catch (_) { return []; }
};

// Contadores de cobrança/pagamento/fiscal para o painel.
const consoleCounters = async (tenant_id) => {
  const um = async (sql, params) => {
    try { const r = await pool.query(sql, params); return Number(r.rows[0]?.n) || 0; }
    catch (_) { return 0; }
  };
  const [cobrancasCriadas, cobrancasPagas, fiscaisPendentes, fiscaisEmitidos, fiscaisErro] = await Promise.all([
    um('SELECT COUNT(*)::int AS n FROM charges WHERE tenant_id=$1', [tenant_id]),
    um(`SELECT COUNT(*)::int AS n FROM charges WHERE tenant_id=$1 AND status IN ('paid','received','confirmed')`, [tenant_id]),
    um(`SELECT COUNT(*)::int AS n FROM fiscal_documents WHERE tenant_id=$1 AND status IN ('pending','pending_configuration','processing')`, [tenant_id]),
    um(`SELECT COUNT(*)::int AS n FROM fiscal_documents WHERE tenant_id=$1 AND status IN ('issued','authorized')`, [tenant_id]),
    um(`SELECT COUNT(*)::int AS n FROM fiscal_documents WHERE tenant_id=$1 AND status='error'`, [tenant_id]),
  ]);
  return {
    cobrancas_criadas: cobrancasCriadas,
    pagamentos_conciliados: cobrancasPagas,
    fiscais_pendentes: fiscaisPendentes,
    fiscais_emitidos: fiscaisEmitidos,
    fiscais_erro: fiscaisErro,
  };
};

// Heartbeat de worker/scheduler + o que cada um registrou por último.
const serviceHeartbeats = async () => {
  try {
    const r = await pool.query("SELECT service, last_beat, meta FROM system_heartbeats WHERE service IN ('worker','scheduler')");
    const out = {};
    for (const row of r.rows) {
      const idade = row.last_beat ? Math.round((Date.now() - new Date(row.last_beat).getTime()) / 1000) : null;
      out[row.service] = {
        last_beat: row.last_beat,
        age_seconds: idade,
        // 180s é a mesma janela usada pelo /health/ready.
        ativo: idade !== null && idade < 180,
        meta: row.meta || {},
      };
    }
    return out;
  } catch (_) { return {}; }
};

module.exports = {
  getSettings, ensureSettings, updateSettings, nextChargePublicId,
  listTemplates, getActiveTemplate, upsertTemplate, ensureDefaultTemplates,
  getChargeByIdemp, getChargeByExternal, getChargeByPublicId, getChargeForUpdate,
  insertCharge, setChargeStatus, updateCharge, listCharges, listOpenChargesForDunning,
  getPaymentCustomer, savePaymentCustomer,
  insertOutbox, claimPendingOutbox, updateOutbox, cancelRemindersForCharge, countRemindersForCharge, getLastReminderForCharge, listOutbox, getOutboxByExternal,
  getFiscalByIdemp, getFiscalById, reserveFiscalDpsIdentity, insertFiscal, updateFiscal, listFiscal,
  getFiscalCategoryMapping, upsertFiscalCategoryMapping, listFiscalCategoryMappings, ensureDefaultFiscalCategories,
  startRun, finishRun, listRuns,
  outboxCounters, listDeadLetter, consoleCounters, serviceHeartbeats,
  recordCost, costReport,
  registerWebhookEvent, markWebhookProcessed, formatChargePublicId,
};
