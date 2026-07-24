// =============================================================================
// storage/index.js — Abstração de armazenamento (§ Storage). Um provedor por
// ambiente, escolhido por STORAGE_PROVIDER (default 'local'). NUNCA guarda
// segredos no banco: credenciais vêm SEMPRE do ambiente. O provedor S3 é um
// adaptador real, porém GATED: sem credenciais/SDK ele reporta `configured:false`
// e recusa operar — jamais simula um upload concluído.
//
// Contrato do provedor:
//   name: string
//   configured(): boolean
//   put({ tenantId, key, localPath?, buffer?, contentType }): Promise<{ key, bucket, provider }>
//   publicUrl({ tenantId, key, bucket }): string | null
// =============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const baseUrl = () => (process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

// Sanitiza um nome de arquivo p/ compor uma chave segura (sem traversal).
const safeName = (name = '') => {
  const ext = path.extname(String(name)).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return crypto.randomUUID() + (ext || '');
};

// ── Provedor LOCAL (disco; default; sempre configurado) ──────────────────────
const localProvider = {
  name: 'local',
  configured: () => true,
  async put({ tenantId, key, localPath, buffer }) {
    const dest = path.join(UPLOAD_ROOT, tenantId, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (buffer) fs.writeFileSync(dest, buffer);
    else if (localPath && path.resolve(localPath) !== path.resolve(dest)) fs.copyFileSync(localPath, dest);
    return { key, bucket: null, provider: 'local' };
  },
  publicUrl({ tenantId, key }) {
    return `${baseUrl()}/uploads/${tenantId}/${key}`;
  },
};

// ── Provedor S3-compatível (env-gated; adaptador real) ───────────────────────
// Requer STORAGE_PROVIDER=s3 + S3_BUCKET + S3_REGION + credenciais no ambiente e
// o SDK @aws-sdk/client-s3 instalado. Ausente qualquer um → configured()=false.
function makeS3Provider() {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const endpoint = process.env.S3_ENDPOINT || undefined; // compatível (MinIO/R2/Spaces)
  const hasCreds = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) || !!process.env.AWS_PROFILE;

  let sdk = null;
  const loadSdk = () => {
    if (sdk) return sdk;
    // eslint-disable-next-line global-require, import/no-unresolved
    sdk = require('@aws-sdk/client-s3'); // lança se não instalado → configured() já barra antes
    return sdk;
  };

  const configured = () => {
    if (!bucket || !region || !hasCreds) return false;
    try { require.resolve('@aws-sdk/client-s3'); return true; } catch (_) { return false; }
  };

  return {
    name: 's3',
    configured,
    async put({ tenantId, key, localPath, buffer, contentType }) {
      if (!configured()) {
        const err = new Error('Armazenamento S3 não configurado (defina S3_BUCKET, S3_REGION, credenciais e instale @aws-sdk/client-s3).');
        err.code = 'STORAGE_NOT_CONFIGURED';
        throw err;
      }
      const { S3Client, PutObjectCommand } = loadSdk();
      const client = new S3Client({ region, endpoint, forcePathStyle: !!endpoint });
      const objectKey = `${tenantId}/${key}`;
      const Body = buffer || fs.createReadStream(localPath);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body, ContentType: contentType || undefined }));
      return { key, bucket, provider: 's3' };
    },
    publicUrl({ tenantId, key }) {
      const objectKey = `${tenantId}/${key}`;
      if (endpoint) return `${endpoint.replace(/\/$/, '')}/${bucket}/${objectKey}`;
      return `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
    },
  };
}

let _provider = null;
function getProvider() {
  if (_provider) return _provider;
  const kind = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  if (kind === 's3') {
    const s3 = makeS3Provider();
    // Se S3 foi pedido mas não está configurado, cai para local com aviso —
    // preserva a operação sem simular upload remoto concluído.
    if (!s3.configured()) {
      console.warn('[storage] STORAGE_PROVIDER=s3 sem configuração completa; usando armazenamento local.');
      _provider = localProvider;
    } else {
      _provider = s3;
    }
  } else {
    _provider = localProvider;
  }
  return _provider;
}

// Reset p/ testes (não usar em produção).
function _resetProvider() { _provider = null; }

module.exports = { getProvider, safeName, localProvider, makeS3Provider, _resetProvider, UPLOAD_ROOT };
