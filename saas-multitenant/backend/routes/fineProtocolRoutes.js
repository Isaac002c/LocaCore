const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const model   = require('../models/fineProtocolModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { sendMail, isMailConfigured } = require('../services/mailService');

// Resolve o caminho LOCAL de um arquivo de upload garantindo isolamento por tenant.
// Aceita URL absoluta ou caminho; exige que o arquivo esteja sob /uploads/<tenantId>/.
// Usa basename (neutraliza ".." ) + guarda de path traversal.
function resolveTenantUploadPath(fileUrl, tenantId) {
  try {
    if (!fileUrl) return null;
    let pathname;
    try { pathname = new URL(fileUrl).pathname; }
    catch { pathname = String(fileUrl); }
    pathname = decodeURIComponent(pathname);
    const marker = `/uploads/${tenantId}/`;
    if (pathname.indexOf(marker) === -1) return null; // não pertence a este tenant
    const filename = path.basename(pathname);
    if (!filename || filename.includes('..')) return null;
    const baseDir  = path.resolve(__dirname, '..', 'uploads', String(tenantId));
    const resolved = path.resolve(baseDir, filename);
    if (resolved !== path.join(baseDir, filename)) return null;
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null;
    return resolved;
  } catch {
    return null;
  }
}

// Nome amigável do anexo, preservando a extensão real do arquivo armazenado.
function buildAttachmentName(data) {
  const clean = (s) => String(s || '').replace(/[^\w.-]+/g, '_');
  const ext = path.extname(String(data.protocol_file_url || '').split('?')[0]) || '';
  const base = data.protocol_number
    ? `Protocolo-${clean(data.protocol_number)}`
    : `Protocolo-${clean(data.fine_number || data.fine_id || 'documento')}`;
  return `${base}${ext}`;
}

// GET /api/fine-protocols?fine_id=X
router.get('/', checkPermission('contracts:read'), async (req, res) => {
  try {
    const { fine_id } = req.query;
    if (!fine_id) return res.status(400).json({ success: false, error: 'fine_id é obrigatório' });
    const data = await model.listByFine(fine_id, req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fine-protocols
router.post('/', checkPermission('contracts:update'), async (req, res) => {
  try {
    const item = await model.create({ ...req.body, tenant_id: req.tenantId });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/fine-protocols/:id
router.patch('/:id', checkPermission('contracts:update'), async (req, res) => {
  try {
    const item = await model.update(req.params.id, req.body, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Protocolo não encontrado' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/fine-protocols/:id
router.delete('/:id', checkPermission('contracts:delete'), async (req, res) => {
  try {
    const item = await model.remove(req.params.id, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Protocolo não encontrado' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fine-protocols/:id/send-email — envia o protocolo anexado por e-mail ao cliente.
// Multi-tenant: tudo escopado por req.tenantId; arquivo precisa estar em uploads do tenant.
router.post('/:id/send-email', checkPermission('contracts:update'), async (req, res) => {
  try {
    // 1) SMTP precisa estar configurado — senão erro controlado, sem derrubar o sistema.
    if (!isMailConfigured()) {
      return res.status(503).json({ success: false, error: 'envio de e-mail não configurado' });
    }

    // 2) Protocolo + cliente + tenant, escopado pelo tenant autenticado.
    const data = await model.getForEmail(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Protocolo não encontrado' });

    // 3) Cliente precisa ter e-mail.
    if (!data.client_email) {
      return res.status(400).json({ success: false, error: 'Cliente não possui e-mail cadastrado.' });
    }

    // 4) Protocolo precisa ter arquivo anexado.
    if (!data.protocol_file_url) {
      return res.status(400).json({ success: false, error: 'Este protocolo não possui arquivo anexado.' });
    }

    // 5) Resolve o arquivo local com isolamento por tenant + guarda de path traversal.
    const filePath = resolveTenantUploadPath(data.protocol_file_url, req.tenantId);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, error: 'Arquivo do protocolo não encontrado no servidor.' });
    }

    // 6) Mensagem usando o nome do tenant atual (fallback seguro).
    const tenantName = (data.tenant_name && data.tenant_name.trim()) || 'Assessoria de Trânsito';
    const clientName = data.client_name || 'Cliente';
    const subject = `Protocolo do seu processo${data.protocol_number ? ` — ${data.protocol_number}` : ''}`;
    const text =
`Olá, ${clientName}.

Segue em anexo o protocolo referente ao seu processo.

Atenciosamente,
${tenantName}`;

    await sendMail({
      to: data.client_email,
      subject,
      text,
      attachments: [{ filename: buildAttachmentName(data), path: filePath }],
    });

    return res.json({ success: true, data: { sent_to: data.client_email } });
  } catch (err) {
    // Não vaza credenciais/segredos — apenas a mensagem curta do erro.
    console.error('[fine-protocols:send-email] erro:', err.message);
    return res.status(500).json({ success: false, error: 'Falha ao enviar o e-mail. Tente novamente.' });
  }
});

module.exports = router;
