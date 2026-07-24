// =============================================================================
// lock.js — Lock distribuído por LEASE (tabela job_locks) para worker/scheduler.
//
// Impede que duas instâncias executem o mesmo job simultaneamente. O lock tem
// TTL (expires_at); se o dono morrer sem liberar, outro assume após expirar.
// Implementação portável (sem interval/ON CONFLICT do pg-mem): check-then-act
// com UPDATE otimista por (name, expires_at).
// =============================================================================

const pool = require('../config/db');

const defaultOwner = () => `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

async function acquireLock(name, { ttlSeconds = 60, owner = defaultOwner(), db = pool } = {}) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  const cur = await db.query('SELECT owner, expires_at FROM job_locks WHERE name = $1', [name]);
  const row = cur.rows[0];

  if (!row) {
    try {
      await db.query(
        'INSERT INTO job_locks (name, owner, acquired_at, expires_at) VALUES ($1,$2,$3,$4)',
        [name, owner, now.toISOString(), expires.toISOString()]
      );
      return { acquired: true, owner };
    } catch (_) { return { acquired: false }; } // corrida: outro inseriu primeiro
  }

  if (new Date(row.expires_at) > now) return { acquired: false }; // lock ativo

  // Expirado → assume com UPDATE otimista (guarda contra corrida).
  const upd = await db.query(
    'UPDATE job_locks SET owner=$1, acquired_at=$2, expires_at=$3 WHERE name=$4 AND expires_at=$5 RETURNING owner',
    [owner, now.toISOString(), expires.toISOString(), name, row.expires_at]
  );
  return upd.rows.length ? { acquired: true, owner } : { acquired: false };
}

async function renewLock(name, owner, { ttlSeconds = 60, db = pool } = {}) {
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const r = await db.query('UPDATE job_locks SET expires_at=$1 WHERE name=$2 AND owner=$3 RETURNING owner', [expires, name, owner]);
  return r.rows.length > 0;
}

async function releaseLock(name, owner, { db = pool } = {}) {
  await db.query('DELETE FROM job_locks WHERE name=$1 AND owner=$2', [name, owner]).catch(() => {});
}

// Executa fn apenas se conseguir o lock; libera ao final. Retorna { skipped:'locked' }
// quando outro processo já detém o lock.
async function withLock(name, ttlSeconds, fn, { db = pool } = {}) {
  const { acquired, owner } = await acquireLock(name, { ttlSeconds, db });
  if (!acquired) return { skipped: 'locked' };
  try { return await fn(); }
  finally { await releaseLock(name, owner, { db }); }
}

module.exports = { acquireLock, renewLock, releaseLock, withLock };
