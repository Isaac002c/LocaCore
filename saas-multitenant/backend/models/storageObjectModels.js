const pool = require('../config/db');

// ============================================
// STORAGE OBJECTS MODEL — metadados de arquivos (§ Storage). NUNCA guarda
// segredos nem conteúdo; apenas ponteiros (provider/bucket/object_key) + infos.
// Tudo escopado por tenant_id.
// ============================================

const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
const toIntOrNull = (v) => { if (v === '' || v == null) return null; const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };

// Registra um objeto armazenado e devolve a linha (sem segredos).
const record = async (d) => {
  const r = await pool.query(
    `INSERT INTO storage_objects
       (tenant_id, provider, bucket, object_key, category, entity_type, entity_id,
        file_name, content_type, size, checksum, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      d.tenant_id, d.provider || 'local', toStrOrNull(d.bucket), d.object_key,
      toStrOrNull(d.category), toStrOrNull(d.entity_type), toStrOrNull(d.entity_id),
      toStrOrNull(d.file_name), toStrOrNull(d.content_type), toIntOrNull(d.size),
      toStrOrNull(d.checksum), toStrOrNull(d.created_by),
    ]
  );
  return r.rows[0];
};

const listByEntity = async (tenant_id, entity_type, entity_id) => {
  const r = await pool.query(
    `SELECT * FROM storage_objects
      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
      ORDER BY created_at DESC`,
    [tenant_id, entity_type, entity_id]
  );
  return r.rows;
};

const getById = async (id, tenant_id) => {
  const r = await pool.query('SELECT * FROM storage_objects WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return r.rows[0];
};

const remove = async (id, tenant_id) => {
  const r = await pool.query('DELETE FROM storage_objects WHERE id = $1 AND tenant_id = $2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

module.exports = { record, listByEntity, getById, remove };
