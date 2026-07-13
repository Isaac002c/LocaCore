const express = require('express');
const router  = express.Router();
const model   = require('../models/multasLeadModels');
const clientModel = require('../models/clientModels');
const pool    = require('../config/db');

// Helper: busca nome do usuário logado
async function getUserName(userId) {
  if (!userId) return null;
  try {
    const res = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.name || null;
  } catch { return null; }
}

// Quando um lead vira "fechado", cria (uma vez) o cliente correspondente.
// Best-effort: uma falha aqui NUNCA quebra a atualização do lead (o move do
// Kanban continua funcionando). Como é idempotente, um novo save de "fechado"
// tenta de novo. Respeita o tenant.
async function maybeCreateClientFromLead(lead, tenantId) {
  if (!lead || lead.status !== 'fechado') return;
  try {
    await clientModel.ensureClientFromLead(lead, tenantId);
  } catch (e) {
    console.error('[multas-leads] Falha ao criar cliente do lead fechado:', e.message);
  }
}

// GET /api/multas-leads — lista todos
router.get('/', async (req, res) => {
  try {
    const data = await model.getAllMultasLeads(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/multas-leads/stats — contagem por status
router.get('/stats', async (req, res) => {
  try {
    const data = await model.countMultasLeadsByStatus(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/multas-leads/kanban — leads visíveis no kanban (regra 7/30 por stage_changed_at)
router.get('/kanban', async (req, res) => {
  try {
    const data = await model.getKanbanLeads(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/multas-leads/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await model.getMultasLeadById(req.params.id, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Lead não encontrado' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/multas-leads
router.post('/', async (req, res) => {
  try {
    const {
      name, cpf, cnh, first_license_date, birth_date,
      phone, source, status, notes, motivo
    } = req.body;

    // Pega o usuário logado como created_by
    const userId   = req.userId || null;
    const userName = await getUserName(userId);

    const item = await model.createMultasLead({
      tenant_id:         req.tenantId,
      name, cpf, cnh,
      first_license_date,
      birth_date,
      phone, source, status, notes, motivo,
      created_by:        userId,
      created_by_name:   userName,
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/multas-leads/:id
router.put('/:id', async (req, res) => {
  try {
    const item = await model.updateMultasLead(
      req.params.id,
      req.body,
      req.tenantId
    );
    if (!item) return res.status(404).json({ success: false, error: 'Lead não encontrado' });
    await maybeCreateClientFromLead(item, req.tenantId);
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/multas-leads/:id/status — atualiza só o status (Kanban drag)
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'status é obrigatório' });
    const item = await model.updateMultasLeadStatus(req.params.id, status, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Lead não encontrado' });
    await maybeCreateClientFromLead(item, req.tenantId);
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/multas-leads/archive-old — arquiva leads antigos (admin only)
router.post('/archive-old', async (req, res) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Apenas administradores podem arquivar leads' });
  }
  try {
    const archived = await model.archiveOldLeads(req.tenantId);
    res.json({ success: true, data: archived, count: archived.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/multas-leads/:id
router.delete('/:id', async (req, res) => {
  try {
    const item = await model.deleteMultasLead(req.params.id, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Lead não encontrado' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
