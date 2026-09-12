'use strict';

const pool = require('../../config/db');
const M = require('../../models/automationModels');
const secretStore = require('./secretStore');
const certificateService = require('./fiscalCertificateService');
const { getSecret } = require('./secrets');
const { validateConfig } = require('./providers/fiscal');

const ACTIVE_STATUSES = ['em_andamento', 'atrasado'];
const item = (key, label, ok, count = null, extra = {}) => ({ key, label, ok: !!ok, count, ...extra });

function scopeClause(ids, params, alias = 'r') {
  if (!Array.isArray(ids) || !ids.length) return '';
  const placeholders = ids.map((id) => { params.push(id); return `$${params.length}`; });
  return ` AND ${alias}.id IN (${placeholders.join(',')})`;
}

async function dataCounts(tenant_id, rentalIds = null) {
  const params = [tenant_id];
  const scope = scopeClause(rentalIds, params);
  const base = `r.tenant_id=$1 AND r.status IN ('${ACTIVE_STATUSES.join("','")}')${scope}`;
  const queries = [
    `SELECT COUNT(*)::int total,
      COUNT(CASE WHEN NOT (
        (r.weekly_rate IS NOT NULL AND r.weekly_rate > 0)
        OR (r.billing_value_source IN ('auto','daily') AND r.daily_rate IS NOT NULL AND r.daily_rate > 0)
        OR (r.billing_value_source='total' AND r.total_amount IS NOT NULL AND r.total_amount > 0)
      ) THEN 1 END)::int missing FROM rentals r WHERE ${base}`,
    `SELECT COUNT(DISTINCT r.client_id)::int total,
      COUNT(DISTINCT CASE WHEN NULLIF(regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g'),'') IS NULL THEN r.client_id END)::int missing_phone,
      COUNT(DISTINCT CASE WHEN NULLIF(regexp_replace(COALESCE(c.cpf,''),'[^0-9]','','g'),'') IS NULL THEN r.client_id END)::int missing_document
      FROM rentals r LEFT JOIN clients c ON c.id=r.client_id AND c.tenant_id=r.tenant_id WHERE ${base}`,
    `SELECT COUNT(DISTINCT r.vehicle_id)::int total,
      COUNT(DISTINCT CASE WHEN NULLIF(TRIM(v.ncm),'') IS NULL THEN r.vehicle_id END)::int missing_ncm
      FROM rentals r LEFT JOIN vehicles v ON v.id=r.vehicle_id AND v.tenant_id=r.tenant_id WHERE ${base}`,
  ];
  const [rentals, clients, vehicles] = await Promise.all(queries.map((sql) => pool.query(sql, params)));
  return {
    active_rentals: Number(rentals.rows[0]?.total || 0),
    rentals_without_value: Number(rentals.rows[0]?.missing || 0),
    active_clients: Number(clients.rows[0]?.total || 0),
    clients_without_phone: Number(clients.rows[0]?.missing_phone || 0),
    clients_without_document: Number(clients.rows[0]?.missing_document || 0),
    active_vehicles: Number(vehicles.rows[0]?.total || 0),
    vehicles_without_ncm: Number(vehicles.rows[0]?.missing_ncm || 0),
  };
}

function hasEnv(scope, name, slug) { return !!getSecret(scope, name, slug); }
const hasStored = (names, name) => names.some((n) => String(n).toUpperCase() === String(name).toUpperCase());

async function integrationsReadiness(settings = {}, slug = null, options = {}) {
  const tenant_id = options.tenant_id || settings.tenant_id;
  if (!tenant_id) throw new Error('tenant_id e obrigatorio para calcular prontidao.');
  const mode = options.mode || settings.automation_mode || 'off';
  let rentalIds = options.rental_ids || null;
  if (mode === 'pilot') rentalIds = options.rental_ids || settings.pilot_rental_ids || [];
  if (mode === 'staged' && !rentalIds) {
    const configured = Array.isArray(settings.pilot_rental_ids)
      ? settings.pilot_rental_ids.slice(0, Math.max(1, Number(settings.rollout_limit || 1)))
      : [];
    if (configured.length) rentalIds = configured;
    else {
      const selected = await pool.query(
        `SELECT id FROM rentals WHERE tenant_id=$1 AND status IN ('em_andamento','atrasado') ORDER BY created_at ASC LIMIT $2`,
        [tenant_id, Math.max(1, Number(settings.rollout_limit || 1))],
      );
      rentalIds = selected.rows.map((r) => r.id);
    }
  }

  const paymentProvider = String(settings.payment_provider || 'null').toLowerCase();
  const waProvider = String(settings.whatsapp_provider || 'null').toLowerCase();
  const fiscalProvider = String(settings.fiscal_provider || 'null').toLowerCase();
  const [counts, templates, paySecrets, waSecrets, fiscalSecrets, certificate, heartbeats] = await Promise.all([
    dataCounts(tenant_id, rentalIds),
    M.listTemplates(tenant_id),
    secretStore.secretPresence(tenant_id, `payment:${paymentProvider}`),
    secretStore.secretPresence(tenant_id, `whatsapp:${waProvider}`),
    secretStore.secretPresence(tenant_id, `fiscal:${fiscalProvider}`),
    certificateService.getCertificateMetadata(tenant_id),
    M.serviceHeartbeats(),
  ]);

  const templateMap = Object.fromEntries(templates.filter((t) => t.active).map((t) => [t.kind, t]));
  const publicBase = String(process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const webhookAvailable = /^https:\/\//i.test(publicBase) || (process.env.NODE_ENV !== 'production' && /^http:\/\//i.test(publicBase));
  const paymentConfig = settings.payment_config || {};
  const waConfig = settings.whatsapp_config || {};
  const fiscalConfig = settings.fiscal_config || {};
  const infiniteHandle = paymentConfig.handle || paymentConfig.infinitepay_handle
    || hasEnv('PAYMENT_INFINITEPAY', 'HANDLE', slug);
  const manualPix = paymentProvider === 'manual_pix';
  const manualPixKey = String(paymentConfig.pix_key || '').trim();
  const externalPaymentsEnabled = settings.payments_enabled !== false;
  const waMode = waProvider === 'evolution' ? String(waConfig.provider_mode || 'cloud').toLowerCase() : 'cloud';
  const waKey = waProvider === 'evolution'
    ? hasStored(waSecrets, 'API_KEY') || hasEnv('EVOLUTION', 'API_KEY', slug)
    : hasStored(waSecrets, 'ACCESS_TOKEN') || hasEnv('META_WHATSAPP', 'ACCESS_TOKEN', slug);
  const waSecret = waProvider === 'evolution'
    ? hasStored(waSecrets, 'APP_SECRET') || hasStored(waSecrets, 'VERIFY_TOKEN')
      || hasEnv('EVOLUTION', 'APP_SECRET', slug) || hasEnv('EVOLUTION', 'VERIFY_TOKEN', slug)
    : hasStored(waSecrets, 'APP_SECRET') || hasEnv('META', 'APP_SECRET', slug);
  const waVerifyToken = hasStored(waSecrets, 'VERIFY_TOKEN')
    || hasEnv(waProvider === 'evolution' ? 'EVOLUTION' : 'META_WHATSAPP', 'VERIFY_TOKEN', slug);
  const templateKinds = ['billing', 'reminder', 'payment_confirmed'];
  const templatesReady = waMode === 'baileys'
    ? templateKinds.every((kind) => !!templateMap[kind]?.body)
    : templateKinds.every((kind) => !!templateMap[kind]?.provider_template_id);
  const fiscalCredential = fiscalProvider === 'nfse_nacional'
    ? !!certificate
    : hasStored(fiscalSecrets, 'TOKEN') || hasEnv(`FISCAL_${fiscalProvider.toUpperCase()}`, 'TOKEN', slug);
  const certExpired = !!certificate?.valid_until && new Date(certificate.valid_until).getTime() <= Date.now();
  const certExpiring = !!certificate?.valid_until
    && new Date(certificate.valid_until).getTime() - Date.now() < 30 * 86400000 && !certExpired;
  const fiscalValidation = validateConfig(settings);

  const checks = [
    item('pilot_selection', 'Modo piloto com exatamente uma locacao', mode !== 'pilot' || rentalIds.length === 1,
      mode === 'pilot' ? rentalIds.length : null, { critical: mode === 'pilot' }),
    item('staged_selection', 'Lote controlado com locacoes selecionadas', mode !== 'staged' ||
      (rentalIds.length > 0 && rentalIds.length <= Math.max(1, Number(settings.rollout_limit || 1))),
    mode === 'staged' ? rentalIds.length : null, { critical: mode === 'staged' }),
    item('rental_value', 'Locacoes com valor seguro', counts.rentals_without_value === 0,
      counts.rentals_without_value, { critical: true, detail: 'Valor semanal, diario ou total explicitamente definido.' }),
    item('client_phone', 'Clientes com telefone', !settings.whatsapp_enabled || counts.clients_without_phone === 0,
      counts.clients_without_phone, { critical: !!settings.whatsapp_enabled }),
    item('client_document', 'Clientes com CPF/CNPJ', !settings.fiscal_enabled || counts.clients_without_document === 0,
      counts.clients_without_document, { critical: !!settings.fiscal_enabled }),
    item('vehicle_ncm', 'Veiculos com NCM', !settings.fiscal_enabled || fiscalConfig.require_vehicle_ncm !== true || counts.vehicles_without_ncm === 0,
      counts.vehicles_without_ncm, { critical: !!settings.fiscal_enabled && fiscalConfig.require_vehicle_ncm === true,
        detail: fiscalConfig.require_vehicle_ncm === true ? 'Exigido pela configuração fiscal deste tenant.' : 'O leiaute DPS 1.01 não usa NCM.' }),
    item('payment_provider', 'InfinitePay ou PIX com confirmacao manual selecionado',
      ['infinitepay', 'manual_pix'].includes(paymentProvider), null, { critical: true }),
    item('infinitepay_handle', 'InfiniteTag configurada', manualPix || !!infiniteHandle, null,
      { critical: !manualPix }),
    item('manual_pix_key', 'Chave PIX da confirmacao manual configurada', !manualPix || !!manualPixKey, null,
      { critical: manualPix }),
    item('external_payment_enabled', 'Criacao de cobranca externa habilitada',
      manualPix || externalPaymentsEnabled, null, { critical: !manualPix }),
    item('payment_webhook', 'Webhook publico de pagamento', manualPix || webhookAvailable, null,
      { critical: !manualPix, detail: manualPix ? 'Baixa feita somente pelo botao Recebido.' :
        (publicBase ? `${publicBase}/webhooks/infinitepay` : 'BASE_URL ausente') }),
    item('whatsapp_provider', 'WhatsApp Meta ou Evolution configurado', ['meta', 'evolution'].includes(waProvider), null,
      { critical: !!settings.whatsapp_enabled }),
    item('whatsapp_credentials', 'Credencial do WhatsApp armazenada', !settings.whatsapp_enabled ||
      (!!waKey && !!waSecret && (waProvider !== 'meta' || !!waVerifyToken)), null,
      { critical: !!settings.whatsapp_enabled }),
    item('whatsapp_endpoint', 'URL e instancia/Phone Number ID', !settings.whatsapp_enabled ||
      (waProvider === 'evolution' ? !!waConfig.api_url && !!waConfig.instance : !!waConfig.phone_number_id), null,
      { critical: !!settings.whatsapp_enabled }),
    item('whatsapp_unofficial_ack', 'Uso do modo WhatsApp Web explicitamente reconhecido',
      !settings.whatsapp_enabled || waMode !== 'baileys' || waConfig.unofficial_acknowledged === true, null,
      { critical: !!settings.whatsapp_enabled && waMode === 'baileys' }),
    item('whatsapp_webhook', 'Webhook publico do WhatsApp', !settings.whatsapp_enabled || webhookAvailable, null,
      { critical: !!settings.whatsapp_enabled,
        detail: publicBase ? `${publicBase}/webhooks/whatsapp/${waProvider}${waProvider === 'meta' ? `/${tenant_id}` : ''}` : 'BASE_URL ausente' }),
    item('whatsapp_templates', 'Templates aprovados vinculados', !settings.whatsapp_enabled || templatesReady, null,
      { critical: !!settings.whatsapp_enabled }),
    item('fiscal_enabled', 'Emissao fiscal habilitada', !!settings.fiscal_enabled, null, { critical: true }),
    item('fiscal_config', 'Configuracao fiscal completa', !!settings.fiscal_enabled && fiscalValidation.ok, null,
      { critical: true, detail: fiscalValidation.missing?.join(', ') || null }),
    item('fiscal_credentials', 'Credencial/certificado fiscal', !!settings.fiscal_enabled && !!fiscalCredential && !certExpired, null,
      { critical: true }),
    item('scheduler', 'Scheduler ativo', !!heartbeats.scheduler?.ativo, null, { critical: true }),
  ];
  const critical = checks.filter((x) => x.critical);
  const blockers = critical.filter((x) => !x.ok);
  const percentage = critical.length ? Math.round(100 * (critical.length - blockers.length) / critical.length) : 100;

  return {
    ambiente: process.env.NODE_ENV === 'production' ? 'producao' : 'homologacao',
    mode, percentage, ready: blockers.length === 0,
    activation: { allowed: blockers.length === 0, blockers: blockers.map((x) => ({ key: x.key, label: x.label, count: x.count, detail: x.detail })) },
    counts,
    checks,
    certificate: certificate ? {
      configured: true, filename: certificate.filename, valid_from: certificate.valid_from,
      valid_until: certificate.valid_until, expired: certExpired, expiring_soon: certExpiring,
      subject_name: certificate.subject_name,
    } : { configured: false, expired: false, expiring_soon: false },
    fiscal_validacao: fiscalValidation,
    integrations: [
      { key: 'pagamento', nome: manualPix ? 'PIX com confirmacao manual' : 'InfinitePay', provider: paymentProvider,
        status: checks.filter((x) => ['payment_provider', 'infinitepay_handle', 'manual_pix_key', 'external_payment_enabled', 'payment_webhook'].includes(x.key)).every((x) => x.ok)
          ? 'pronto' : 'nao_configurado',
        itens: checks.filter((x) => ['payment_provider', 'infinitepay_handle', 'manual_pix_key', 'external_payment_enabled', 'payment_webhook'].includes(x.key)) },
      { key: 'whatsapp', nome: waProvider === 'evolution' ? 'Evolution API / WhatsApp' : 'WhatsApp Cloud API', provider: waProvider,
        status: checks.filter((x) => x.key.startsWith('whatsapp')).every((x) => x.ok) ? 'pronto' : 'nao_configurado',
        itens: checks.filter((x) => x.key.startsWith('whatsapp')) },
      { key: 'fiscal', nome: 'Emissao fiscal', provider: fiscalProvider,
        status: checks.filter((x) => x.key.startsWith('fiscal')).every((x) => x.ok) ? 'pronto' : 'incompleto',
        itens: checks.filter((x) => x.key.startsWith('fiscal') || x.key === 'vehicle_ncm' || x.key === 'client_document') },
    ],
  };
}

module.exports = { integrationsReadiness, dataCounts };
