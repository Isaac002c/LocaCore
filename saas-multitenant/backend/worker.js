#!/usr/bin/env node
'use strict';
// =============================================================================
// worker.js — Processo SEPARADO que consome a fila (message_outbox) e retries.
//
// Loop com intervalo configurável, lock distribuído (não duplica trabalho entre
// instâncias), heartbeat (lido por /health/ready) e SHUTDOWN GRACIOSO (SIGTERM/
// SIGINT): termina o tick corrente e sai. Após reiniciar, retoma os pendentes
// (a fila está no banco — nada em memória).
//
// Uso:  node worker.js    (requer DATABASE_URL e JWT_SECRET no ambiente)
// =============================================================================

require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: __dirname + '/.env' });

const { withLock } = require('./services/lock');
const runner = require('./services/automation/runner');
const log = require('./services/logger');

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 60000;
const LIMIT = Number(process.env.WORKER_BATCH || 50);

let stopping = false;
let ticking = false;

async function tick() {
  if (ticking || stopping) return;
  ticking = true;
  const started = Date.now();
  try {
    await runner.heartbeat('worker', { pid: process.pid, interval_ms: INTERVAL_MS });
    const r = await withLock('worker:outbox', 30, () => runner.processOutboxAll({ limit: LIMIT }));
    if (r && !r.skipped) log.info('worker.tick', { ...r, duration_ms: Date.now() - started });
  } catch (err) {
    log.error('worker.tick.error', { error: err.message });
  } finally {
    ticking = false;
  }
}

const timer = setInterval(tick, INTERVAL_MS);
tick();
log.info('worker.start', { interval_ms: INTERVAL_MS, batch: LIMIT });

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('worker.shutdown', { signal });
  clearInterval(timer);
  // Aguarda o tick corrente terminar (até ~5s) antes de sair.
  const deadline = Date.now() + 5000;
  while (ticking && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 100)); }
  try { const pool = require('./config/db'); await pool.end(); } catch (_) { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => { log.error('worker.uncaught', { error: e.message }); });
process.on('unhandledRejection', (e) => { log.error('worker.unhandledRejection', { error: String(e) }); });
