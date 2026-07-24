#!/usr/bin/env node
'use strict';
// =============================================================================
// scheduler.js — Processo SEPARADO que dispara os jobs periódicos.
//
// Cada job roda no seu intervalo, protegido por LOCK DISTRIBUÍDO (duas instâncias
// não executam o mesmo job ao mesmo tempo). Intervalos configuráveis por env.
// Shutdown gracioso. Idempotência garantida pelos serviços por-tenant.
//
// Jobs:
//   - overdue   : marca locações atrasadas (>= 1x/hora)
//   - outbox    : processa a fila (a cada ~5 min; o worker também processa)
//   - dunning   : régua de inadimplência (diária/por janela)
//   - billing   : cobrança semanal (checagem horária; roda no dia/hora do tenant)
//   - fiscal    : lote fiscal (semanal, quando habilitado)
// =============================================================================

require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: __dirname + '/.env' });

const { withLock } = require('./services/lock');
const runner = require('./services/automation/runner');
const log = require('./services/logger');

const min = (n) => n * 60 * 1000;
const env = (k, def) => (process.env[k] ? Number(process.env[k]) : def);

// { nome, intervalo, ttl do lock, fn }
const JOBS = [
  { name: 'overdue', every: env('SCHED_OVERDUE_MS', min(60)),  ttl: 120, run: () => runner.flagOverdueAll() },
  { name: 'outbox',  every: env('SCHED_OUTBOX_MS',  min(5)),   ttl: 60,  run: () => runner.processOutboxAll({ limit: 100 }) },
  { name: 'dunning', every: env('SCHED_DUNNING_MS', min(60 * 6)), ttl: 300, run: () => runner.runDunningAll({}) },
  { name: 'billing', every: env('SCHED_BILLING_MS', min(60)),  ttl: 600, run: () => runner.runBillingAll({}) },
  { name: 'fiscal',  every: env('SCHED_FISCAL_MS',  min(60 * 12)), ttl: 600, run: () => runner.fiscalBatchAll() },
];

let stopping = false;
const timers = [];
const active = {};

async function runJob(job) {
  if (stopping || active[job.name]) return;
  active[job.name] = true;
  const started = Date.now();
  try {
    const r = await withLock(`scheduler:${job.name}`, job.ttl, job.run);
    if (r && !r.skipped) log.info('scheduler.job', { job: job.name, duration_ms: Date.now() - started, result_count: Array.isArray(r) ? r.length : undefined });
  } catch (err) {
    log.error('scheduler.job.error', { job: job.name, error: err.message });
  } finally {
    active[job.name] = false;
  }
}

for (const job of JOBS) {
  timers.push(setInterval(() => runJob(job), job.every));
}
// Heartbeat + primeira passada leve (overdue/outbox) ao iniciar.
setInterval(() => runner.heartbeat('scheduler', { pid: process.pid }).catch(() => {}), min(1));
runner.heartbeat('scheduler', { pid: process.pid }).catch(() => {});
log.info('scheduler.start', { jobs: JOBS.map((j) => ({ name: j.name, every_ms: j.every })) });

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('scheduler.shutdown', { signal });
  timers.forEach((t) => clearInterval(t));
  const deadline = Date.now() + 5000;
  while (Object.values(active).some(Boolean) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 100)); }
  try { const pool = require('./config/db'); await pool.end(); } catch (_) { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => log.error('scheduler.uncaught', { error: e.message }));
process.on('unhandledRejection', (e) => log.error('scheduler.unhandledRejection', { error: String(e) }));
