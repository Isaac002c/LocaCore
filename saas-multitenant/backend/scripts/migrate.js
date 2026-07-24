#!/usr/bin/env node
'use strict';
// =============================================================================
// migrate.js — Controle de migrations do LocaCore (produção).
//
// Registra cada migration em schema_migrations (nome, checksum, data, duração,
// ambiente, sucesso, erro). Idempotente: pula as já aplicadas com o mesmo
// checksum; se o arquivo mudou após aplicado, ACUSA drift (não reaplica em
// silêncio). Advisory lock impede duas execuções simultâneas.
//
// Uso (CLI):
//   node scripts/migrate.js status
//   node scripts/migrate.js up
//   node scripts/migrate.js verify
//   node scripts/migrate.js rollback <nome_da_migration>
// Requer DATABASE_URL. Ordem definida em migrations/manifest.json.
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 947274; // chave arbitrária p/ pg_advisory_lock

const checksum = (sql) => crypto.createHash('sha256').update(sql, 'utf8').digest('hex');

function readManifest(dir = MIGRATIONS_DIR) {
  const manifestPath = path.join(dir, 'manifest.json');
  const list = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).migrations;
  return list.map((name) => {
    const p = path.join(dir, name);
    const sql = fs.readFileSync(p, 'utf8');
    return { name, path: p, sql, checksum: checksum(sql) };
  });
}

function createMigrator({ pool, dir = MIGRATIONS_DIR, environment = process.env.NODE_ENV || 'development', appliedBy = 'migrate.js' }) {
  const ensureTable = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms INTEGER,
        environment TEXT,
        success     BOOLEAN NOT NULL DEFAULT TRUE,
        error       TEXT,
        applied_by  TEXT
      )`);
  };

  const getApplied = async () => {
    const r = await pool.query('SELECT * FROM schema_migrations');
    const map = {};
    for (const row of r.rows) map[row.name] = row;
    return map;
  };

  const withLock = async (fn) => {
    let locked = false;
    try { await pool.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]); locked = true; }
    catch (_) { /* pg-mem/engine sem advisory lock → segue (uso single-run) */ }
    try { return await fn(); }
    finally { if (locked) { try { await pool.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) { /* ignore */ } } }
  };

  const status = async () => {
    await ensureTable();
    const applied = await getApplied();
    return readManifest(dir).map((m) => {
      const a = applied[m.name];
      let state = 'pending';
      if (a) state = a.checksum === m.checksum ? 'applied' : 'drift';
      return { name: m.name, state, applied_at: a ? a.applied_at : null };
    });
  };

  const up = async () => {
    await ensureTable();
    return withLock(async () => {
      const applied = await getApplied();
      const results = [];
      for (const m of readManifest(dir)) {
        const a = applied[m.name];
        if (a && a.checksum === m.checksum) { results.push({ name: m.name, action: 'skip' }); continue; }
        if (a && a.checksum !== m.checksum) {
          throw new Error(`Drift em "${m.name}": arquivo alterado após aplicado. Crie uma nova migration em vez de editar a existente.`);
        }
        const started = Date.now();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(m.sql);
          await client.query(
            `INSERT INTO schema_migrations (name, checksum, duration_ms, environment, success, applied_by)
             VALUES ($1,$2,$3,$4,TRUE,$5)`,
            [m.name, m.checksum, Date.now() - started, environment, appliedBy]
          );
          await client.query('COMMIT');
          results.push({ name: m.name, action: 'applied', duration_ms: Date.now() - started });
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
          // Registra a falha (fora da transação revertida).
          await pool.query(
            `INSERT INTO schema_migrations (name, checksum, duration_ms, environment, success, error, applied_by)
             VALUES ($1,$2,$3,$4,FALSE,$5,$6)
             ON CONFLICT (name) DO UPDATE SET success=FALSE, error=EXCLUDED.error`,
            [m.name, m.checksum, Date.now() - started, environment, String(err.message).slice(0, 1000), appliedBy]
          ).catch(() => {});
          throw new Error(`Falha ao aplicar "${m.name}": ${err.message}`);
        } finally { client.release(); }
      }
      return results;
    });
  };

  const verify = async () => {
    await ensureTable();
    const applied = await getApplied();
    const drift = [];
    for (const m of readManifest(dir)) {
      const a = applied[m.name];
      if (a && a.checksum !== m.checksum) drift.push(m.name);
    }
    return { ok: drift.length === 0, drift };
  };

  // Rollback de uma migration específica (usa <name sem .sql>_rollback.sql se existir).
  const rollback = async (name) => {
    await ensureTable();
    const base = name.replace(/\.sql$/, '');
    const rbPath = path.join(dir, `${base}_rollback.sql`);
    if (!fs.existsSync(rbPath)) throw new Error(`Rollback não encontrado: ${base}_rollback.sql`);
    const sql = fs.readFileSync(rbPath, 'utf8');
    return withLock(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
        await client.query('COMMIT');
        return { name, action: 'rolled_back' };
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      } finally { client.release(); }
    });
  };

  return { ensureTable, status, up, verify, rollback };
}

module.exports = { createMigrator, readManifest, checksum, MIGRATIONS_DIR };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const cmd = process.argv[2] || 'status';
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não definido.'); process.exit(1); }
    const { Pool } = require('pg');
    const sslDisabled = /sslmode=disable/i.test(process.env.DATABASE_URL) || process.env.DB_SSL === 'false';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslDisabled ? false : { rejectUnauthorized: false } });
    const m = createMigrator({ pool });
    try {
      if (cmd === 'status') { console.table(await m.status()); }
      else if (cmd === 'up') { const r = await m.up(); console.log('Migrations aplicadas:'); console.table(r); }
      else if (cmd === 'verify') { const v = await m.verify(); console.log(v.ok ? '✓ Sem drift.' : `✗ Drift: ${v.drift.join(', ')}`); process.exitCode = v.ok ? 0 : 2; }
      else if (cmd === 'rollback') { const name = process.argv[3]; if (!name) throw new Error('informe o nome da migration'); console.log(await m.rollback(name)); }
      else { console.error(`Comando desconhecido: ${cmd} (use status|up|verify|rollback)`); process.exitCode = 1; }
    } catch (err) {
      console.error('ERRO:', err.message); process.exitCode = 1;
    } finally { await pool.end().catch(() => {}); }
  })();
}
