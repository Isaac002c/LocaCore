// =============================================================================
// csvImport.js — Importação CSV (§ Importação) para clientes e veículos.
// Sem dependências novas: parser próprio (BOM, delimitador ; ou , , aspas com
// escape "", CRLF/LF). Valida e normaliza por entidade; NÃO escreve no banco
// (o commit fica na rota, tenant-scoped). Preview e commit compartilham a validação.
// =============================================================================

// Detecta o delimitador dominante na 1ª linha (; tem prioridade no pt-BR).
const detectDelimiter = (line) => {
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  return semi >= comma && semi > 0 ? ';' : ',';
};

// Parser CSV tolerante. Retorna { headers: [...], rows: [ {header: value} ] }.
function parseCsv(text) {
  if (text == null) return { headers: [], rows: [] };
  let s = String(text).replace(/^﻿/, ''); // remove BOM
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!s.trim()) return { headers: [], rows: [] };

  const delim = detectDelimiter(s.split('\n')[0]);
  const records = [];
  let field = '', record = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      record.push(field); field = '';
    } else if (c === '\n') {
      record.push(field); records.push(record); field = ''; record = [];
    } else field += c;
  }
  record.push(field); records.push(record);

  const headers = (records.shift() || []).map((h) => h.trim().toLowerCase());
  const rows = records
    .filter((r) => r.some((v) => String(v).trim() !== '')) // ignora linhas vazias
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] == null ? '' : String(r[idx]).trim()); });
      return obj;
    });
  return { headers, rows };
}

// ── Helpers de validação ─────────────────────────────────────────────────────
const digits = (v) => String(v || '').replace(/\D/g, '');
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());
const parseMoney = (v) => {
  if (v === '' || v == null) return 0;
  let x = String(v).trim().replace(/[^\d.,-]/g, '');
  if (x.includes(',')) x = x.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : NaN;
};
const plate = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

// Mapeia sinônimos comuns de cabeçalho → campo canônico.
const alias = (map) => (row) => {
  const out = {};
  for (const [canon, keys] of Object.entries(map)) {
    for (const k of keys) { if (row[k] !== undefined && row[k] !== '') { out[canon] = row[k]; break; } }
  }
  return out;
};

const CLIENT_ALIAS = alias({
  name: ['name', 'nome', 'cliente'], cpf: ['cpf', 'cpf/cnpj', 'documento'],
  cnh: ['cnh'], phone: ['phone', 'telefone', 'celular'], email: ['email', 'e-mail'],
  address: ['address', 'endereco', 'endereço'], birth_date: ['birth_date', 'nascimento', 'data_nascimento'],
  notes: ['notes', 'observacoes', 'observações', 'obs'], status: ['status'],
});
const VEHICLE_ALIAS = alias({
  plate: ['plate', 'placa'], brand: ['brand', 'marca'], model: ['model', 'modelo'],
  year: ['year', 'ano'], color: ['color', 'cor'], category: ['category', 'categoria'],
  renavam: ['renavam'], chassi: ['chassi', 'chassis'], fuel: ['fuel', 'combustivel', 'combustível'],
  transmission: ['transmission', 'cambio', 'câmbio'], daily_rate: ['daily_rate', 'diaria', 'diária', 'valor_diaria'],
  odometer: ['odometer', 'km', 'hodometro', 'hodômetro'], status: ['status'],
});

// Valida + normaliza. Retorna { valid: [{ line, data }], errors: [{ line, message }] }.
// Deduplica dentro do arquivo por chave natural (cpf | placa).
function validate(entity, rows) {
  const valid = [], errors = [], seen = new Set();
  rows.forEach((raw, i) => {
    const line = i + 2; // +1 cabeçalho, +1 base-1
    if (entity === 'clientes') {
      const r = CLIENT_ALIAS(raw);
      if (!r.name || !r.name.trim()) { errors.push({ line, message: 'Nome é obrigatório.' }); return; }
      if (r.email && !isEmail(r.email)) { errors.push({ line, message: `E-mail inválido: ${r.email}` }); return; }
      const key = r.cpf ? `cpf:${digits(r.cpf)}` : `name:${r.name.toLowerCase()}`;
      if (seen.has(key)) { errors.push({ line, message: `Duplicado no arquivo: ${r.name}` }); return; }
      seen.add(key);
      valid.push({ line, data: { name: r.name.trim(), cpf: r.cpf ? digits(r.cpf) : null, cnh: r.cnh || null, phone: r.phone || null, email: r.email || null, address: r.address || null, birth_date: r.birth_date || null, notes: r.notes || null, status: r.status || 'negociacao' } });
    } else if (entity === 'veiculos') {
      const r = VEHICLE_ALIAS(raw);
      const p = plate(r.plate);
      if (!p) { errors.push({ line, message: 'Placa é obrigatória.' }); return; }
      let daily = 0;
      if (r.daily_rate !== undefined && r.daily_rate !== '') { daily = parseMoney(r.daily_rate); if (Number.isNaN(daily)) { errors.push({ line, message: `Diária inválida: ${r.daily_rate}` }); return; } }
      if (seen.has(p)) { errors.push({ line, message: `Placa duplicada no arquivo: ${p}` }); return; }
      seen.add(p);
      valid.push({ line, data: { plate: p, brand: r.brand || null, model: r.model || null, year: r.year || null, color: r.color || null, category: r.category || null, renavam: r.renavam || null, chassi: r.chassi || null, fuel: r.fuel || null, transmission: r.transmission || null, daily_rate: daily, odometer: r.odometer || 0, status: r.status || 'disponivel' } });
    } else {
      errors.push({ line, message: `Entidade não suportada: ${entity}` });
    }
  });
  return { valid, errors };
}

const ENTITIES = ['clientes', 'veiculos'];

module.exports = { parseCsv, validate, ENTITIES };
