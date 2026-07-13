const express = require('express');
const router = express.Router();
const clientModel = require('../models/clientModels');

// GET /api/clients - Listar todos os clientes
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const clients = await clientModel.getAllClients(tenantId);
    res.json({ success: true, data: clients });
  } catch (err) {
    console.error('Erro ao buscar clientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/clients/search - Pesquisar clientes
router.get('/search', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    
    const clients = await clientModel.searchClients(tenantId, q);
    res.json({ success: true, data: clients });
  } catch (err) {
    console.error('Erro ao pesquisar clientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/clients/stats - Estatísticas de clientes
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const total = await clientModel.countClients(tenantId);
    res.json({ success: true, data: { total } });
  } catch (err) {
    console.error('Erro ao buscar stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/clients/:id - Buscar cliente por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    
    const client = await clientModel.getClientById(id, tenantId);
    
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    console.error('Erro ao buscar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/clients - Criar novo cliente
router.post('/', async (req, res) => {
  try {
    const { name, birth_date, cpf, cnh, first_cnh, phone, email, address, notes, status } = req.body;
    const tenantId = req.tenantId;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    }

    // Normaliza CPF removendo máscara antes de salvar
    const cpfNormalized = cpf ? cpf.replace(/\D/g, '') : null;
    if (cpfNormalized && cpfNormalized.length !== 11) {
      return res.status(400).json({ success: false, error: 'CPF deve ter 11 dígitos' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'E-mail inválido' });
    }

    // Verificar se CPF já existe no tenant
    if (cpfNormalized) {
      const existingClient = await clientModel.getClientByCPF(cpfNormalized, tenantId);
      if (existingClient) {
        return res.status(400).json({ success: false, error: 'CPF já cadastrado' });
      }
    }

    const client = await clientModel.createClient({
      tenant_id: tenantId,
      name: name.trim(), birth_date, cpf: cpfNormalized, cnh, first_cnh,
      phone, email, address, notes,
      status: status || 'negociacao',
    });

    res.status(201).json({ success: true, data: client });
  } catch (err) {
    console.error('Erro ao criar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/clients/:id - Atualizar cliente
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, birth_date, cpf, cnh, first_cnh, phone, email, address, notes, status } = req.body;
    const tenantId = req.tenantId;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'E-mail inválido' });
    }

    const existingClient = await clientModel.getClientById(id, tenantId);
    if (!existingClient) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    // Normaliza CPF removendo máscara antes de salvar
    const cpfNormalized = cpf ? cpf.replace(/\D/g, '') : null;
    if (cpfNormalized && cpfNormalized.length !== 11) {
      return res.status(400).json({ success: false, error: 'CPF deve ter 11 dígitos' });
    }

    // Verificar se CPF já existe em outro cliente
    if (cpfNormalized && cpfNormalized !== existingClient.cpf) {
      const existingCPF = await clientModel.getClientByCPF(cpfNormalized, tenantId);
      if (existingCPF) {
        return res.status(400).json({ success: false, error: 'CPF já cadastrado para outro cliente' });
      }
    }

    const client = await clientModel.updateClient(id, {
      name: name.trim(), birth_date, cpf: cpfNormalized, cnh, first_cnh,
      phone, email, address, notes,
      status: status || existingClient.status || 'negociacao',
    }, tenantId);

    res.json({ success: true, data: client });
  } catch (err) {
    console.error('Erro ao atualizar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/clients/:id - Deletar cliente
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    
    const client = await clientModel.deleteClient(id, tenantId);
    
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    
    res.json({ success: true, data: client, message: 'Cliente deletado com sucesso' });
  } catch (err) {
    console.error('Erro ao deletar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

