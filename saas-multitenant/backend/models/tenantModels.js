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

// Lê SOMENTE as áreas habilitadas do tenant (§12/§15). Tolerante à ausência da
// coluna `modules` (pré-migração do Ciclo 2): retorna null = todas habilitadas.
const getTenantModules = async (id) => {
    try {
        const result = await pool.query('SELECT modules FROM tenants WHERE id = $1', [id]);
        let mods = result.rows[0] && result.rows[0].modules;
        if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch { mods = null; } }
        return Array.isArray(mods) && mods.length ? mods : null;
    } catch (_) {
        return null; // coluna ainda não existe → comportamento anterior (sem gating)
    }
};

module.exports = {
    getTenantModules,
    createTenant,
    getAllTenants,
    getTenantById,
};
