const pool = require('../config/db');

// ============================================
// COMPANIES MODEL - Empresas (pessoas jurídicas)
// Tudo escopado por tenant_id.
// ============================================

const toStrOrNull = (v) => (v === '' || v === undefined ? null : v);

const createCompany = async ({
  tenant_id, razao_social, nome_fantasia, cnpj, responsavel, phone, email, address, notes, status
}) => {
  if (!tenant_id) throw new Error('tenant_id é obrigatório');
  const r = await pool.query(
    `INSERT INTO companies(tenant_id, razao_social, nome_fantasia, cnpj, responsavel, phone, email, address, notes, status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      tenant_id, razao_social, toStrOrNull(nome_fantasia), cnpj,
      toStrOrNull(responsavel), toStrOrNull(phone), toStrOrNull(email),
      toStrOrNull(address), toStrOrNull(notes), status || 'ativo',
    ]
  );
  return r.rows[0];
};

// Lista + busca (razão social, nome fantasia, CNPJ ou placa de veículo) — tenant-scoped
const getAllCompanies = async (tenant_id, searchTerm) => {
  if (searchTerm && searchTerm.trim()) {
    const like = `%${searchTerm.trim()}%`;
    const digits = searchTerm.replace(/\D/g, '');
    const r = await pool.query(
      `SELECT DISTINCT co.*
         FROM companies co
         LEFT JOIN company_vehicles v ON v.company_id = co.id AND v.tenant_id = co.tenant_id
        WHERE co.tenant_id = $1
          AND (
            co.razao_social ILIKE $2
            OR co.nome_fantasia ILIKE $2
            OR ($3 <> '' AND co.cnpj ILIKE '%' || $3 || '%')
            OR v.plate ILIKE $2
          )
        ORDER BY co.razao_social ASC
        LIMIT 200`,
      [tenant_id, like, digits]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT * FROM companies WHERE tenant_id = $1 ORDER BY razao_social ASC LIMIT 500`,
    [tenant_id]
  );
  return r.rows;
};

const getCompanyById = async (id, tenant_id) => {
  const r = await pool.query('SELECT * FROM companies WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return r.rows[0];
};

const getCompanyByCnpj = async (cnpj, tenant_id) => {
  const r = await pool.query('SELECT * FROM companies WHERE cnpj = $1 AND tenant_id = $2', [cnpj, tenant_id]);
  return r.rows[0];
};

const updateCompany = async (id, {
  razao_social, nome_fantasia, cnpj, responsavel, phone, email, address, notes, status
}, tenant_id) => {
  const r = await pool.query(
    `UPDATE companies
        SET razao_social=$1, nome_fantasia=$2, cnpj=$3, responsavel=$4,
            phone=$5, email=$6, address=$7, notes=$8, status=$9, updated_at=NOW()
      WHERE id=$10 AND tenant_id=$11 RETURNING *`,
    [
      razao_social, toStrOrNull(nome_fantasia), cnpj, toStrOrNull(responsavel),
      toStrOrNull(phone), toStrOrNull(email), toStrOrNull(address),
      toStrOrNull(notes), status || 'ativo', id, tenant_id,
    ]
  );
  return r.rows[0];
};

const setCompanyStatus = async (id, status, tenant_id) => {
  const r = await pool.query(
    'UPDATE companies SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *',
    [status, id, tenant_id]
  );
  return r.rows[0];
};

const countCompanyFines = async (id, tenant_id) => {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS total FROM fines WHERE company_id = $1 AND tenant_id = $2',
    [id, tenant_id]
  );
  return r.rows[0].total;
};

const deleteCompany = async (id, tenant_id) => {
  const r = await pool.query('DELETE FROM companies WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

// Processos da empresa SEM veículo vinculado (vehicle_id NULL): placa ausente,
// inválida, não cadastrada ou vínculo incompleto. Acessíveis para vínculo manual.
const getUnlinkedCompanyFines = async (company_id, tenant_id) => {
  const r = await pool.query(
    `SELECT f.id,
            f.fine_number AS numero_multa,
            f.plate       AS vehicle_plate,
            f.organ,
            f.stage       AS status,
            f.due_date,
            f.notes,
            f.service_type_id AS service_id,
            f.company_id,
            f.vehicle_id,
            f.protocol_number, f.protocol_date, f.protocol_status, f.protocol_notes, f.protocol_file_url,
            st.code AS service_name
       FROM fines f
       LEFT JOIN service_types st ON f.service_type_id = st.id
      WHERE f.company_id = $1 AND f.tenant_id = $2 AND f.vehicle_id IS NULL
      ORDER BY f.created_at DESC`,
    [company_id, tenant_id]
  );
  return r.rows;
};

// Processos/multas vinculados à empresa (tenant-scoped)
const getCompanyFines = async (company_id, tenant_id) => {
  const r = await pool.query(
    `SELECT f.id,
            f.fine_number AS numero_multa,
            f.plate       AS vehicle_plate,
            f.organ,
            f.stage       AS status,
            f.due_date,
            f.notes,
            f.service_type_id AS service_id,
            f.company_id,
            f.vehicle_id,
            f.protocol_number, f.protocol_date, f.protocol_status, f.protocol_notes, f.protocol_file_url,
            st.code AS service_name,
            v.plate AS vehicle_ref_plate
       FROM fines f
       LEFT JOIN service_types st  ON f.service_type_id = st.id
       LEFT JOIN company_vehicles v ON f.vehicle_id = v.id AND v.tenant_id = f.tenant_id
      WHERE f.company_id = $1 AND f.tenant_id = $2
      ORDER BY f.created_at DESC`,
    [company_id, tenant_id]
  );
  return r.rows;
};

module.exports = {
  createCompany, getAllCompanies, getCompanyById, getCompanyByCnpj,
  updateCompany, setCompanyStatus, countCompanyFines, deleteCompany, getCompanyFines,
  getUnlinkedCompanyFines,
};
