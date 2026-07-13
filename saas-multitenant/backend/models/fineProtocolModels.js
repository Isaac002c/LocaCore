const pool = require('../config/db');

const VALID_STATUSES = ['protocolado', 'concluido', 'indeferido'];

const listByFine = async (fine_id, tenant_id) => {
  const r = await pool.query(
    `SELECT * FROM fine_protocols
     WHERE fine_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [fine_id, tenant_id]
  );
  return r.rows;
};

const create = async ({ tenant_id, fine_id, protocol_number, protocol_date, protocol_status, protocol_notes, protocol_file_url }) => {
  if (!tenant_id) throw new Error('tenant_id é obrigatório');
  if (!fine_id)   throw new Error('fine_id é obrigatório');
  const status = VALID_STATUSES.includes(protocol_status) ? protocol_status : 'protocolado';
  const r = await pool.query(
    `INSERT INTO fine_protocols
       (tenant_id, fine_id, protocol_number, protocol_date, protocol_status, protocol_notes, protocol_file_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenant_id, fine_id, protocol_number || null, protocol_date || null, status, protocol_notes || null, protocol_file_url || null]
  );
  return r.rows[0];
};

const update = async (id, { protocol_number, protocol_date, protocol_status, protocol_notes, protocol_file_url }, tenant_id) => {
  const status = VALID_STATUSES.includes(protocol_status) ? protocol_status : 'protocolado';
  const r = await pool.query(
    `UPDATE fine_protocols
     SET protocol_number=$1, protocol_date=$2, protocol_status=$3,
         protocol_notes=$4, protocol_file_url=$5, updated_at=NOW()
     WHERE id=$6 AND tenant_id=$7 RETURNING *`,
    [protocol_number || null, protocol_date || null, status, protocol_notes || null, protocol_file_url || null, id, tenant_id]
  );
  return r.rows[0];
};

const remove = async (id, tenant_id) => {
  const r = await pool.query(
    'DELETE FROM fine_protocols WHERE id=$1 AND tenant_id=$2 RETURNING *',
    [id, tenant_id]
  );
  return r.rows[0];
};

// Retorna o protocolo + dados do cliente e do tenant para envio de e-mail.
// Tudo escopado por tenant_id (joins reforçam o isolamento entre tenants).
const getForEmail = async (id, tenant_id) => {
  const r = await pool.query(
    `SELECT fp.id, fp.protocol_number, fp.protocol_date, fp.protocol_file_url,
            f.id AS fine_id, f.fine_number, f.plate,
            c.id AS client_id, c.name AS client_name, c.email AS client_email,
            t.name AS tenant_name
       FROM fine_protocols fp
       JOIN fines   f ON f.id = fp.fine_id   AND f.tenant_id = fp.tenant_id
       JOIN clients c ON c.id = f.client_id  AND c.tenant_id = fp.tenant_id
       LEFT JOIN tenants t ON t.id = fp.tenant_id
      WHERE fp.id = $1 AND fp.tenant_id = $2`,
    [id, tenant_id]
  );
  return r.rows[0];
};

module.exports = { listByFine, create, update, remove, getForEmail };
