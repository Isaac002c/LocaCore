'use strict';
// =============================================================================
// REGRESSÃO — coerção de DATE vinda do Postgres REAL.
//
// O driver `pg` devolve colunas DATE como objeto Date; o pg-mem devolve string.
// Por isso o bug abaixo passou por toda a suíte e só apareceu no deploy real:
//   String(new Date(...)).substring(0,10) === "Mon Jul 27"  ← data inválida
// que fazia o UPDATE falhar com:
//   invalid input syntax for type date: "Mon Jul 27"
//
// Os UPDATEs reaproveitam o valor atual do registro (padrão m('campo', cur.campo)),
// então qualquer edição de manutenção/multa/locação com data preenchida quebrava.
// Este teste fixa o contrato do helper em todos os modelos afetados.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Stub do pool: estes testes exercitam só os helpers puros dos modelos.
const dbId = require.resolve('../config/db');
const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true;
stub.exports = { query: async () => ({ rows: [] }) };
require.cache[dbId] = stub;

// Extrai o helper toDateOrNull de um modelo, avaliando o arquivo isoladamente.
const fs = require('node:fs');
const path = require('node:path');
function loadToDateOrNull(modelFile) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'models', modelFile), 'utf8');
  const m = src.match(/const toDateOrNull = [\s\S]*?\n};/);
  assert.ok(m, `toDateOrNull não encontrado em ${modelFile}`);
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return toDateOrNull;`)();
}

const MODELOS = [
  'vehicleMaintenanceModels.js',
  'rentalFineModels.js',
  'rentalModels.js',
  'rentalExtraModels.js',
];

for (const arquivo of MODELOS) {
  test(`${arquivo}: converte objeto Date (Postgres real) em YYYY-MM-DD`, () => {
    const toDateOrNull = loadToDateOrNull(arquivo);
    // 27/07/2026 no fuso local — como o driver pg entrega uma coluna DATE.
    const d = new Date(2026, 6, 27);
    const out = toDateOrNull(d);
    assert.equal(out, '2026-07-27', 'deve virar data ISO, nunca "Mon Jul 27"');
    assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
  });

  test(`${arquivo}: mantém string ISO e trata vazio/nulo`, () => {
    const toDateOrNull = loadToDateOrNull(arquivo);
    assert.equal(toDateOrNull('2026-07-27'), '2026-07-27');
    assert.equal(toDateOrNull('2026-07-27T12:00:00.000Z'), '2026-07-27', 'trunca timestamp');
    assert.equal(toDateOrNull(''), null);
    assert.equal(toDateOrNull(null), null);
    assert.equal(toDateOrNull(undefined), null);
  });
}

test('não desloca o dia por fuso horário (usa getters locais)', () => {
  const toDateOrNull = loadToDateOrNull('rentalModels.js');
  // 1º de janeiro às 00:00 local: com toISOString() viraria 31/12 em fusos negativos.
  assert.equal(toDateOrNull(new Date(2027, 0, 1)), '2027-01-01');
  // 31 de dezembro às 23:00 local: com toISOString() viraria 01/01 em fusos positivos.
  assert.equal(toDateOrNull(new Date(2027, 11, 31, 23, 0, 0)), '2027-12-31');
});

// =============================================================================
// utils/date.js — helper COMPARTILHADO (usado por relatórios/CSV, recibo e
// provedor de cobrança). Antes cada ponto repetia String(v).substring(0,10) e
// três deles estavam quebrados em produção.
// =============================================================================
const { toISODate, toISODateOrNull, toBrDate, addDays, diffDays } = require('../utils/date');

test('utils/date: converte Date do Postgres em YYYY-MM-DD', () => {
  assert.equal(toISODate(new Date(2026, 6, 29)), '2026-07-29');
  assert.equal(toISODate('2026-07-29'), '2026-07-29');
  assert.equal(toISODate('2026-07-29T10:00:00.000Z'), '2026-07-29');
  assert.equal(toISODate(''), '');
  assert.equal(toISODate(null), '');
  assert.equal(toISODateOrNull(null), null);
  assert.equal(toISODate(new Date('data-invalida')), '', 'Date inválido não vira lixo');
});

test('utils/date: não desloca o dia por fuso horário', () => {
  assert.equal(toISODate(new Date(2027, 0, 1)), '2027-01-01');
  assert.equal(toISODate(new Date(2027, 11, 31, 23, 0, 0)), '2027-12-31');
});

test('utils/date: formata pt-BR sem produzir "Wed Jul 29"', () => {
  assert.equal(toBrDate(new Date(2026, 6, 29)), '29/07/2026');
  assert.equal(toBrDate('2026-07-29'), '29/07/2026');
  assert.equal(toBrDate(null), '');
  // A regressão exata: o formato antigo devolvia o texto do Date.
  assert.doesNotMatch(toBrDate(new Date(2026, 6, 29)), /Jul|Wed/);
});

test('utils/date: addDays e diffDays atravessam meses corretamente', () => {
  assert.equal(addDays('2026-07-29', 5), '2026-08-03');
  assert.equal(addDays(new Date(2026, 6, 29), -29), '2026-06-30');
  assert.equal(diffDays('2026-07-01', '2026-07-29'), 28);
  assert.equal(diffDays(new Date(2026, 6, 1), new Date(2026, 6, 29)), 28);
  assert.equal(diffDays('x', '2026-07-29'), null);
});

test('regressão: relatório CSV, recibo e provedor de cobrança usam o helper', () => {
  const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const csv = ler('routes/reportRoutes.js');
  const recibo = ler('routes/rentalRoutes.js');
  const cobranca = ler('services/automation/providers/payment.js');
  assert.match(csv, /toISODate\(r\.data\)/, 'CSV de faturamento deve coagir a data');
  assert.match(csv, /toISODate\(r\.start_date\)/, 'CSV de locações deve coagir a data');
  assert.match(recibo, /toBrDate/, 'descrição do recibo deve coagir a data');
  assert.match(cobranca, /dueDate: toISODate\(due_date\)/, 'payload do provedor deve coagir a data');
  for (const [nome, src] of [['CSV', csv], ['recibo', recibo], ['cobrança', cobranca]]) {
    assert.doesNotMatch(src, /String\((?:r\.data|r\.start_date|r\.end_date|due_date|v)\)\.substring\(0, 10\)/,
      `${nome} não pode voltar ao String(...).substring(0,10)`);
  }
});

test('reportModels: agrupamento por dia não devolve "Wed Jul 29"', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'models', 'reportModels.js'), 'utf8');
  const m = src.match(/const iso = \(v\) => \{[\s\S]*?\n\};/);
  assert.ok(m, 'reportModels deve ter o helper iso() tolerante a Date');
  // eslint-disable-next-line no-new-func
  const isoFn = new Function(`${m[0]}; return iso;`)();
  assert.equal(isoFn(new Date(2026, 6, 29)), '2026-07-29');
  assert.equal(isoFn('2026-07-29'), '2026-07-29');
});
