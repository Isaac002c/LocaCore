const pool = require('../config/db');

// ============================================
// RENTAL CONTRACTS MODEL (§7) — versões do contrato (snapshot congelado) +
// configurações de cabeçalho/cláusulas/rodapé por tenant. Tenant-scoped.
// ============================================

// Cláusulas iniciais EDITÁVEIS (não são texto jurídico definitivo — devem ser
// validadas pela locadora antes do uso real).
const DEFAULT_CLAUSES = [
  'MODELO INICIAL — o texto final das cláusulas deve ser revisado e validado pela locadora.',
  '1. O LOCATÁRIO declara receber o veículo em perfeito estado de uso e conservação, comprometendo-se a devolvê-lo nas mesmas condições.',
  '2. MULTAS E INFRAÇÕES: são de inteira responsabilidade do LOCATÁRIO as multas, taxas e penalidades por infrações cometidas durante o período de locação, acrescidas de taxa administrativa quando aplicável.',
  '3. AVARIAS: danos ao veículo não cobertos por proteção contratada serão ressarcidos pelo LOCATÁRIO conforme avaliação registrada na vistoria de devolução.',
  '4. COMBUSTÍVEL: o veículo é entregue e deve ser devolvido com o mesmo nível de combustível; a diferença será cobrada.',
  '5. ATRASO NA DEVOLUÇÃO: a devolução após a data/hora prevista implica cobrança de diária(s) adicional(is) e demais encargos previstos.',
  '6. CAUÇÃO: o valor de caução poderá ser retido para cobertura de multas, avarias, combustível ou pendências, sendo o saldo devolvido ao final.',
  '7. O LOCATÁRIO declara possuir habilitação válida e ser o único condutor autorizado, salvo indicação expressa de condutor adicional.',
];

const getSettings = async (tenant_id) => {
  const r = await pool.query('SELECT * FROM tenant_contract_settings WHERE tenant_id = $1', [tenant_id]);
  return r.rows[0] || { tenant_id, header: null, clauses: DEFAULT_CLAUSES.join('\n'), footer: null };
};

const upsertSettings = async (tenant_id, { header, clauses, footer }) => {
  const r = await pool.query(
    `INSERT INTO tenant_contract_settings (tenant_id, header, clauses, footer)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET header=EXCLUDED.header, clauses=EXCLUDED.clauses, footer=EXCLUDED.footer, updated_at=NOW()
     RETURNING *`,
    [tenant_id, header || null, clauses || null, footer || null]
  );
  return r.rows[0];
};

const nextVersion = async (rental_id, tenant_id) => {
  const r = await pool.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM rental_contracts WHERE rental_id=$1 AND tenant_id=$2', [rental_id, tenant_id]);
  return r.rows[0].v;
};

const create = async ({ tenant_id, rental_id, snapshot, created_by }) => {
  const version = await nextVersion(rental_id, tenant_id);
  const number = `CTR-${String(snapshot.rental_number || '').replace(/[^0-9]/g, '') || '000000'}-v${version}`;
  const r = await pool.query(
    `INSERT INTO rental_contracts (tenant_id, rental_id, version, number, snapshot, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [tenant_id, rental_id, version, number, JSON.stringify(snapshot), created_by || null]
  );
  return r.rows[0];
};

const listByRental = async (rental_id, tenant_id) => {
  const r = await pool.query('SELECT id, version, number, status, created_at FROM rental_contracts WHERE rental_id=$1 AND tenant_id=$2 ORDER BY version DESC', [rental_id, tenant_id]);
  return r.rows;
};

const getById = async (id, tenant_id) => {
  const r = await pool.query('SELECT * FROM rental_contracts WHERE id=$1 AND tenant_id=$2', [id, tenant_id]);
  return r.rows[0];
};

module.exports = { DEFAULT_CLAUSES, getSettings, upsertSettings, create, listByRental, getById };
