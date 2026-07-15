/* =============================================================================
 * seed_admin.js — Cria o PRIMEIRO tenant + usuário admin num banco novo (do zero).
 * Não-interativo (lê variáveis de ambiente). Idempotente por e-mail/slug.
 *
 * Rodar dentro do container do backend após aplicar o schema + migrations:
 *   docker compose -f deploy/docker-compose.yml exec \
 *     -e SEED_TENANT_NAME="Minha Empresa" \
 *     -e SEED_ADMIN_NAME="Admin" \
 *     -e SEED_ADMIN_EMAIL="admin@empresa.com" \
 *     -e SEED_ADMIN_PASSWORD="senha-forte" \
 *     backend node scripts/seed_admin.js
 * ============================================================================= */
require('dotenv').config({ path: __dirname + '/../.env' });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const slugify = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME;
  const adminName  = process.env.SEED_ADMIN_NAME || 'Administrador';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPass  = process.env.SEED_ADMIN_PASSWORD;
  const slug       = process.env.SEED_TENANT_SLUG || slugify(tenantName);

  if (!tenantName || !adminEmail || !adminPass) {
    console.error('❌ Defina SEED_TENANT_NAME, SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD.');
    process.exit(1);
  }
  if (adminPass.length < 6) { console.error('❌ Senha muito curta (min 6).'); process.exit(1); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tenant (idempotente por slug). status='ativo' é obrigatório para permitir login.
    let tenantId;
    const existingTenant = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (existingTenant.rows[0]) {
      tenantId = existingTenant.rows[0].id;
      console.log(`• Tenant "${slug}" já existe (${tenantId}).`);
    } else {
      const t = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'ativo') RETURNING id`,
        [tenantName, slug]
      );
      tenantId = t.rows[0].id;
      console.log(`✓ Tenant criado: ${tenantName} (${tenantId})`);
    }

    // Admin (idempotente por e-mail dentro do tenant).
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [adminEmail, tenantId]
    );
    if (existingUser.rows[0]) {
      console.log(`• Usuário ${adminEmail} já existe. Nada a fazer.`);
    } else {
      const hash = await bcrypt.hash(adminPass, 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, tenant_id, role)
         VALUES ($1, $2, $3, $4, 'admin')`,
        [adminName, adminEmail, hash, tenantId]
      );
      console.log(`✓ Admin criado: ${adminEmail}`);
    }

    await client.query('COMMIT');
    console.log('✅ Seed concluído.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Falha no seed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main();
