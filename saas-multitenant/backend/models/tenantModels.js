const pool = require('../config/db');

const createTenant = async (name) => {
    const result = await pool.query(
        'INSERT INTO tenants(name) VALUES($1) RETURNING *',
        [name]
    );
    return result.rows[0];
};

const getAllTenants = async () => {
    const result = await pool.query('SELECT * FROM tenants');
    return result.rows;
};

// Dados de branding do tenant (para recibos/PDF). Tenant-scoped por id.
const getTenantById = async (id) => {
    const result = await pool.query(
        `SELECT id, name, slug, logo_url, brand_color, tagline FROM tenants WHERE id = $1`,
        [id]
    );
    return result.rows[0];
};

module.exports = {
    createTenant,
    getAllTenants,
    getTenantById,
};
