const AdmZip = require('adm-zip');

const REQUIRED_FIELDS = [
  'QUALIFICACAO_MOTORISTA',
  'DADOS_VEICULO',
  'DATA_INICIO',
  'DATA_FIM',
  'VALOR_SEMANAL',
  'DATA_FINAL_CONTRATO',
];

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const documentXml = (buffer) => {
  let zip;
  try { zip = new AdmZip(buffer); }
  catch (_) { throw Object.assign(new Error('O arquivo não é um DOCX válido.'), { statusCode: 400 }); }
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw Object.assign(new Error('O DOCX não contém o documento principal.'), { statusCode: 400 });
  return { zip, entry, xml: entry.getData().toString('utf8') };
};

const fieldOccurrences = (xml) => Object.fromEntries(REQUIRED_FIELDS.map((field) => [
  field,
  (xml.match(new RegExp(`<w:tag\\s+w:val=["']${field}["']`, 'g')) || []).length,
]));

const validateTemplate = (buffer) => {
  const { xml } = documentXml(buffer);
  const occurrences = fieldOccurrences(xml);
  const invalid = Object.entries(occurrences).filter(([, count]) => count !== 1);
  if (invalid.length) {
    const details = invalid.map(([field, count]) => `${field} (${count})`).join(', ');
    throw Object.assign(new Error(`Modelo incompatível. Campos obrigatórios ausentes ou duplicados: ${details}.`), { statusCode: 400 });
  }
  return { fields: REQUIRED_FIELDS, occurrences };
};

const fillTemplate = (buffer, values = {}) => {
  const { zip, entry, xml } = documentXml(buffer);
  validateTemplate(buffer);
  let output = xml;

  for (const field of REQUIRED_FIELDS) {
    const blocks = output.match(/<w:sdt(?:\s[^>]*)?>[\s\S]*?<\/w:sdt>/g) || [];
    const block = blocks.find((candidate) => new RegExp(`<w:tag\\s+w:val=["']${field}["']`).test(candidate));
    if (!block) throw Object.assign(new Error(`Campo ${field} não encontrado no modelo.`), { statusCode: 400 });
    let first = true;
    const replacement = block.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g, (_, open, close) => {
      const text = first ? escapeXml(values[field]) : '';
      first = false;
      return `${open}${text}${close}`;
    });
    if (first) throw Object.assign(new Error(`Campo ${field} não possui área de texto editável.`), { statusCode: 400 });
    output = output.replace(block, replacement);
  }

  zip.updateFile(entry.entryName, Buffer.from(output, 'utf8'));
  return zip.toBuffer();
};

module.exports = { REQUIRED_FIELDS, validateTemplate, fillTemplate };
