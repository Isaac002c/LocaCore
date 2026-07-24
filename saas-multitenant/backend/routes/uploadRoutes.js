const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { getProvider } = require('../services/storage');
const storageObjects = require('../models/storageObjectModels');

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', req.tenantId || 'default');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const name = crypto.randomUUID() + (ext || '');
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG ou PNG.'));
    }
    cb(null, true);
  },
});

// POST /api/upload?category=&entity_type=&entity_id=
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
  }

  try {
    const provider = getProvider();
    const key = req.file.filename; // já é <uuid>.<ext> gerado no diskStorage
    const localPath = path.join(__dirname, '..', 'uploads', req.tenantId, key);

    // Envia ao provedor (local = no-op; s3 = sobe o arquivo). Nunca simula sucesso remoto.
    const stored = await provider.put({ tenantId: req.tenantId, key, localPath, contentType: req.file.mimetype });
    const fileUrl = provider.publicUrl({ tenantId: req.tenantId, key, bucket: stored.bucket });

    // Registra metadados (sem segredos). Falha aqui não impede o retorno do arquivo.
    let objectId = null;
    try {
      const rec = await storageObjects.record({
        tenant_id: req.tenantId, provider: stored.provider, bucket: stored.bucket, object_key: `${req.tenantId}/${key}`,
        category: req.query.category, entity_type: req.query.entity_type, entity_id: req.query.entity_id,
        file_name: req.file.originalname, content_type: req.file.mimetype, size: req.file.size, created_by: req.userId,
      });
      objectId = rec.id;
    } catch (metaErr) {
      console.error('[upload] falha ao registrar metadados:', metaErr.message);
    }

    res.json({
      success: true,
      data: {
        id:           objectId,
        url:          fileUrl,
        provider:     stored.provider,
        filename:     key,
        originalName: req.file.originalname,
        mimeType:     req.file.mimetype,
        size:         req.file.size,
      },
    });
  } catch (err) {
    console.error('[upload] erro no provedor de storage:', err.message);
    const status = err.code === 'STORAGE_NOT_CONFIGURED' ? 503 : 500;
    res.status(status).json({ success: false, error: err.message || 'Erro ao armazenar arquivo' });
  }
});

// Tratamento de erros do multer
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'Arquivo muito grande. Tamanho máximo: 10MB.' });
  }
  return res.status(400).json({ success: false, error: err.message || 'Erro no upload' });
});

module.exports = router;
