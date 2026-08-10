const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { REQUIRED_FIELDS, validateTemplate, fillTemplate } = require('../services/contracts/editableDocx');

const template = (fields = REQUIRED_FIELDS) => {
  const zip = new AdmZip();
  const controls = fields.map((field) => (
    `<w:sdt><w:sdtPr><w:tag w:val="${field}"/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>[${field}]</w:t></w:r></w:sdtContent></w:sdt>`
  )).join('');
  zip.addFile('word/document.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${controls}</w:body></w:document>`
  ));
  return zip.toBuffer();
};

test('valida e preenche os seis campos mantendo o DOCX editável', () => {
  const input = template();
  assert.deepEqual(validateTemplate(input).fields, REQUIRED_FIELDS);
  const values = Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, `Valor & <${field}>`]));
  const output = fillTemplate(input, values);
  assert.deepEqual(validateTemplate(output).fields, REQUIRED_FIELDS);
  const xml = new AdmZip(output).readAsText('word/document.xml');
  for (const field of REQUIRED_FIELDS) {
    assert.match(xml, new RegExp(`Valor &amp; &lt;${field}&gt;`));
  }
});

test('recusa modelo sem todos os campos obrigatórios', () => {
  assert.throws(() => validateTemplate(template(REQUIRED_FIELDS.slice(0, -1))), /DATA_FINAL_CONTRATO/);
});
