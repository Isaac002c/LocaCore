'use strict';

const crypto = require('node:crypto');
const forge = require('node-forge');
const pool = require('../../config/db');
const secretStore = require('./secretStore');

const MAX_CERTIFICATE_SIZE = 5 * 1024 * 1024;

function inspectPkcs12(buffer, password) {
  try {
    const asn1 = forge.asn1.fromDer(buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, String(password || ''));
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = (bags[forge.pki.oids.certBag] || [])[0];
    if (!certBag || !certBag.cert) throw new Error('Certificado nao encontrado no arquivo.');
    const cert = certBag.cert;
    const cn = cert.subject.getField('CN');
    return {
      valid_from: cert.validity.notBefore,
      valid_until: cert.validity.notAfter,
      subject_name: cn ? cn.value : cert.subject.attributes.map((x) => `${x.shortName || x.name}=${x.value}`).join(', '),
      serial_number: cert.serialNumber || null,
    };
  } catch (err) {
    const e = new Error('Nao foi possivel abrir o certificado. Verifique o arquivo e a senha.');
    e.code = 'INVALID_CERTIFICATE';
    e.cause = err;
    throw e;
  }
}

async function storeCertificate(tenant_id, { buffer, filename, mime_type, password }, db = pool) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Arquivo de certificado ausente.');
  if (buffer.length > MAX_CERTIFICATE_SIZE) throw new Error('Certificado excede o limite de 5 MB.');
  if (!/\.(pfx|p12)$/i.test(filename || '')) throw new Error('Envie um certificado A1 .pfx ou .p12.');
  if (!password) throw new Error('A senha do certificado e obrigatoria.');
  if (!secretStore.encryptionReady()) throw new Error('Configure AUTOMATION_SECRETS_KEY antes de armazenar certificados.');

  const meta = inspectPkcs12(buffer, password);
  const data = secretStore.encrypt(buffer.toString('base64'));
  const pass = secretStore.encrypt(password);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const r = await db.query(
    `INSERT INTO tenant_fiscal_certificates
     (tenant_id,filename,mime_type,size_bytes,sha256,encrypted_data,data_iv,data_auth_tag,
      encrypted_password,password_iv,password_auth_tag,valid_from,valid_until,subject_name,serial_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (tenant_id) DO UPDATE SET
       filename=EXCLUDED.filename,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,
       sha256=EXCLUDED.sha256,encrypted_data=EXCLUDED.encrypted_data,data_iv=EXCLUDED.data_iv,
       data_auth_tag=EXCLUDED.data_auth_tag,encrypted_password=EXCLUDED.encrypted_password,
       password_iv=EXCLUDED.password_iv,password_auth_tag=EXCLUDED.password_auth_tag,
       valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,
       subject_name=EXCLUDED.subject_name,serial_number=EXCLUDED.serial_number,updated_at=NOW()
     RETURNING id,filename,mime_type,size_bytes,sha256,valid_from,valid_until,subject_name,serial_number,updated_at`,
    [
      tenant_id, filename, mime_type || 'application/x-pkcs12', buffer.length, sha256,
      data.ciphertext, data.iv, data.auth_tag, pass.ciphertext, pass.iv, pass.auth_tag,
      meta.valid_from, meta.valid_until, meta.subject_name, meta.serial_number,
    ],
  );
  return r.rows[0];
}

async function getCertificateMetadata(tenant_id, db = pool) {
  try {
    const r = await db.query(
      `SELECT id,filename,mime_type,size_bytes,sha256,valid_from,valid_until,subject_name,
              serial_number,created_at,updated_at
         FROM tenant_fiscal_certificates WHERE tenant_id=$1`,
      [tenant_id],
    );
    return r.rows[0] || null;
  } catch (_) { return null; }
}

async function getDecryptedCertificate(tenant_id, db = pool) {
  const r = await db.query('SELECT * FROM tenant_fiscal_certificates WHERE tenant_id=$1', [tenant_id]);
  const row = r.rows[0];
  if (!row) return null;
  const data = secretStore.decrypt({ ciphertext: row.encrypted_data, iv: row.data_iv, auth_tag: row.data_auth_tag });
  const password = secretStore.decrypt({ ciphertext: row.encrypted_password, iv: row.password_iv, auth_tag: row.password_auth_tag });
  return { buffer: Buffer.from(data, 'base64'), password, metadata: await getCertificateMetadata(tenant_id, db) };
}

async function removeCertificate(tenant_id, db = pool) {
  const r = await db.query('DELETE FROM tenant_fiscal_certificates WHERE tenant_id=$1', [tenant_id]);
  return r.rowCount > 0;
}

module.exports = {
  MAX_CERTIFICATE_SIZE, inspectPkcs12, storeCertificate, getCertificateMetadata,
  getDecryptedCertificate, removeCertificate,
};

