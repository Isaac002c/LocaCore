// Seed do usuário master TELUN (super_admin). Idempotente.
// Uso (NÃO commitar senha): MASTER_SEED_PASSWORD='...' node scripts/seed_master.js
require('dotenv').config({ path: __dirname + '/../.env' });
const pool   = require('../config/db');
const bcrypt = require('bcryptjs');

const EMAIL = 'contato@telun.com.br';
const SLUG  = process.env.MASTER_TENANT_SLUG || 'telun';

(async () => {
  const pw = process.env.MASTER_SEED_PASSWORD;
  if (!pw || pw.length < 8) {
    console.error('ERRO: defina MASTER_SEED_PASSWORD (>= 8 chars) ao rodar o seed.');
    process.exit(1);
  }
  try {
    // 1. Tenant TELUN (host do master)
    let t = await pool.query('SELECT id FROM tenants WHERE slug = $1', [SLUG]);
    let tenantId;
    if (t.rows[0]) {
      tenantId = t.rows[0].id;
    } else {
      const ins = await pool.query(
        "INSERT INTO tenants(name, slug, status) VALUES('TELUN', $1, 'ativo') RETURNING id",
        [SLUG]
      );
      tenantId = ins.rows[0].id;
      console.log('Tenant TELUN criado.');
    }

    // 2. Usuário master super_admin (cria ou atualiza senha/role)
    const hash = await bcrypt.hash(pw, 10);
    const u = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [EMAIL, tenantId]);
    if (u.rows[0]) {
      await pool.query(
        "UPDATE users SET password_hash = $1, role = 'super_admin', name = 'TELUN Master' WHERE id = $2",
        [hash, u.rows[0].id]
      );
      console.log('Master atualizado:', EMAIL);
    } else {
      await pool.query(
        "INSERT INTO users(tenant_id, name, email, password_hash, role) VALUES($1, 'TELUN Master', $2, $3, 'super_admin')",
        [tenantId, EMAIL, hash]
      );
      console.log('Master criado:', EMAIL);
    }
    console.log('SEED OK — role=super_admin, tenant='+SLUG+'');
    process.exit(0);
  } catch (e) {
    console.error('SEED ERRO:', e.message);
    process.exit(1);
  }
})();
