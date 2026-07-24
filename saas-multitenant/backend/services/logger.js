// =============================================================================
// logger.js — Log estruturado (JSON) com níveis. Nunca registra secrets/tokens.
// Campos livres: request_id, tenant_id, user_id, job_id, provider, event_id, etc.
// =============================================================================

const SERVICE = process.env.SERVICE_NAME || 'locacore-api';
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const SECRET_RE = /token|secret|password|authorization|apikey|api_key|access_key|credential/i;

function sanitize(fields = {}) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = SECRET_RE.test(k) ? '***' : fields[k];
  return out;
}

function emit(level, event, fields = {}) {
  if (LEVELS[level] > CURRENT) return;
  const rec = { ts: new Date().toISOString(), level, service: SERVICE, event, ...sanitize(fields) };
  const line = JSON.stringify(rec);
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  error: (event, fields) => emit('error', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  info: (event, fields) => emit('info', event, fields),
  debug: (event, fields) => emit('debug', event, fields),
  sanitize,
};
