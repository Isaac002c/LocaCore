/*
 * Importa, de forma idempotente, documentos previamente inventariados para os
 * clientes de um único tenant. Não lê nem altera a origem (ex.: Google Drive).
 *
 * Uso:
 *   node scripts/import-client-documents.js manifest.json /caminho/raiz [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const documentModel = require('../models/documentModels');
const storageObjects = require('../models/storageObjectModels');
const { getProvider, safeName } = require('../services/storage');

const MIME = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const repairText = (value) => {
  const text = String(value || '');
  if (!/[ÃÂ]/.test(text)) return text;
  try { return Buffer.from(text, 'latin1').toString('utf8'); } catch (_) { return text; }
};

const main = async () => {
  const manifestPath = path.resolve(process.argv[2] || '');
  const sourceRoot = path.resolve(process.argv[3] || '');
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) throw new Error('Manifesto não encontrado.');
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) throw new Error('Diretório-fonte não encontrado.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const tenantResult = await pool.query('SELECT id, slug FROM tenants WHERE slug=$1', [manifest.tenant_slug]);
  if (tenantResult.rows.length !== 1) throw new Error(`Tenant não encontrado de forma unívoca: ${manifest.tenant_slug}`);
  const tenantId = tenantResult.rows[0].id;

  const resolvedClients = [];
  for (const item of manifest.clients || []) {
    const result = await pool.query(
      'SELECT id, name FROM clients WHERE tenant_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))',
      [tenantId, item.client_name]
    );
    if (result.rows.length !== 1) throw new Error(`Cliente não encontrado de forma unívoca: ${item.client_name} (${result.rows.length})`);
    resolvedClients.push({ item, client: result.rows[0] });
  }

  const expected = resolvedClients.reduce((sum, row) => sum + row.item.documents.length, 0);
  const audit = { tenant_id: tenantId, tenant_slug: manifest.tenant_slug, dry_run: dryRun, expected, uploaded: 0, skipped: 0, errors: [], clients: [] };
  const provider = getProvider();

  for (const { item, client } of resolvedClients) {
    const clientAudit = { client_id: client.id, client_name: client.name, expected: item.documents.length, uploaded: 0, skipped: 0 };
    for (const doc of item.documents) {
      const sourcePath = path.resolve(sourceRoot, doc.relative_path);
      if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`) || !fs.existsSync(sourcePath)) throw new Error(`Arquivo-fonte ausente ou inválido: ${doc.relative_path}`);
      const actualSize = fs.statSync(sourcePath).size;
      if (actualSize !== Number(doc.bytes)) throw new Error(`Tamanho divergente: ${doc.relative_path}`);
      const existing = await pool.query(
        `SELECT id, provider, bucket, object_key FROM storage_objects
          WHERE tenant_id=$1 AND entity_type='client' AND entity_id=$2 AND checksum=$3 LIMIT 1`,
        [tenantId, client.id, doc.sha256]
      );
      if (existing.rows[0]) {
        const existingKey = String(existing.rows[0].object_key).replace(`${tenantId}/`, '');
        const existingUrl = provider.publicUrl({ tenantId, key: existingKey, bucket: existing.rows[0].bucket });
        const linked = await pool.query(
          'SELECT id FROM documents WHERE tenant_id=$1 AND client_id=$2 AND file_url=$3 LIMIT 1',
          [tenantId, client.id, existingUrl]
        );
        if (!linked.rows[0] && !dryRun) {
          const displayName = repairText(doc.file_name);
          const contentType = MIME[String(doc.extension || path.extname(displayName)).toLowerCase()] || 'application/octet-stream';
          await documentModel.createDocument({
            tenant_id: tenantId, client_id: client.id, file_url: existingUrl, file_name: displayName,
            file_type: contentType, file_size: actualSize, category: doc.category,
            description: repairText(doc.description), uploaded_by: null,
          });
          audit.uploaded += 1; clientAudit.uploaded += 1;
        } else {
          audit.skipped += 1; clientAudit.skipped += 1;
        }
        continue;
      }
      if (dryRun) { audit.uploaded += 1; clientAudit.uploaded += 1; continue; }

      const displayName = repairText(doc.file_name);
      const key = safeName(displayName);
      const contentType = MIME[String(doc.extension || path.extname(displayName)).toLowerCase()] || 'application/octet-stream';
      const stored = await provider.put({ tenantId, key, localPath: sourcePath, contentType });
      const fileUrl = provider.publicUrl({ tenantId, key, bucket: stored.bucket });
      await storageObjects.record({
        tenant_id: tenantId, provider: stored.provider, bucket: stored.bucket,
        object_key: `${tenantId}/${key}`, category: doc.category, entity_type: 'client', entity_id: client.id,
        file_name: displayName, content_type: contentType, size: actualSize, checksum: doc.sha256, created_by: null,
      });
      await documentModel.createDocument({
        tenant_id: tenantId, client_id: client.id, file_url: fileUrl, file_name: displayName,
        file_type: contentType, file_size: actualSize, category: doc.category,
        description: repairText(doc.description), uploaded_by: null,
      });
      audit.uploaded += 1; clientAudit.uploaded += 1;
    }
    audit.clients.push(clientAudit);
  }

  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
};

main()
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => pool.end());
