'use strict';
// Testes do serviço de reporting (bucketing dia/semana/mês, séries, períodos).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rep = require('../services/finance/reporting');

test('bucketKey: dia, semana (segunda ISO) e mês', () => {
  assert.equal(rep.bucketKey('2026-07-10', 'day'), '2026-07-10');
  assert.equal(rep.bucketKey('2026-07-10', 'week'), '2026-07-06');   // sexta → segunda da semana
  assert.equal(rep.bucketKey('2026-07-12', 'week'), '2026-07-06');   // domingo → mesma semana
  assert.equal(rep.bucketKey('2026-07-13', 'week'), '2026-07-13');   // segunda → ela mesma
  assert.equal(rep.bucketKey('2026-07-10', 'month'), '2026-07-01');
});

test('bucketRange preenche o intervalo completo', () => {
  assert.deepEqual(rep.bucketRange('2026-07-01', '2026-07-03', 'day'),
    ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.deepEqual(rep.bucketRange('2026-07-01', '2026-07-15', 'week'),
    ['2026-06-29', '2026-07-06', '2026-07-13']);
  assert.deepEqual(rep.bucketRange('2026-05-10', '2026-07-02', 'month'),
    ['2026-05-01', '2026-06-01', '2026-07-01']);
});

test('buildCashflowSeries agrega, zera buckets vazios e acumula saldo', () => {
  const rows = [
    { d: '2026-07-01', type: 'entrada', total: '100' },
    { d: '2026-07-01', type: 'saida', total: '30' },
    { d: '2026-07-03', type: 'entrada', total: '50' },
  ];
  const s = rep.buildCashflowSeries(rows, '2026-07-01', '2026-07-03', 'day');
  assert.equal(s.length, 3);
  assert.deepEqual(
    s.map((x) => [x.entradas, x.saidas, x.saldo, x.saldoAcumulado]),
    [[100, 30, 70, 70], [0, 0, 0, 70], [50, 0, 50, 120]]
  );
  assert.equal(s[0].label, '01/07');
});

test('buildBillingSeries: faturado × recebido × pendente por bucket', () => {
  const billed = [{ d: '2026-07-01', total: '1000', paid: '400' }];
  const received = [{ d: '2026-07-02', total: '400' }];
  const s = rep.buildBillingSeries(billed, received, '2026-07-01', '2026-07-02', 'day');
  assert.deepEqual(s.map((x) => [x.faturado, x.recebido, x.pendente]),
    [[1000, 0, 600], [0, 400, 0]]);
});

test('buildBillingSeries aceita Date (timestamptz do pg) e linhas sem GROUP BY', () => {
  // getBilledByDate retorna UMA linha por faturamento (d = created_at como Date);
  // a soma por bucket acontece aqui.
  const billed = [
    { d: new Date(2026, 6, 1, 14, 30), total: '600', paid: '100' },
    { d: new Date(2026, 6, 1, 9, 5),  total: '400', paid: '300' },
  ];
  const s = rep.buildBillingSeries(billed, [], '2026-07-01', '2026-07-01', 'day');
  assert.equal(s.length, 1);
  assert.equal(s[0].faturado, 1000);
  assert.equal(s[0].pendente, 600); // (600-100)+(400-300)
});

test('previousRange devolve janela anterior de mesma duração', () => {
  assert.deepEqual(rep.previousRange('2026-07-01', '2026-07-07'),
    { start: '2026-06-24', end: '2026-06-30' });
  assert.deepEqual(rep.previousRange('2026-07-10', '2026-07-10'),
    { start: '2026-07-09', end: '2026-07-09' });
});

test('pctChange trata zeros e sinais', () => {
  assert.equal(rep.pctChange(150, 100), 50);
  assert.equal(rep.pctChange(50, 100), -50);
  assert.equal(rep.pctChange(0, 0), 0);
  assert.equal(rep.pctChange(100, 0), null); // não comparável
});

test('resolvePeriod: presets', () => {
  const ref = '2026-07-10'; // sexta
  assert.deepEqual(rep.resolvePeriod({ preset: 'today' }, ref), { start: '2026-07-10', end: '2026-07-10' });
  assert.deepEqual(rep.resolvePeriod({ preset: 'week' }, ref), { start: '2026-07-06', end: '2026-07-12' });
  assert.deepEqual(rep.resolvePeriod({ preset: 'month' }, ref), { start: '2026-07-01', end: '2026-07-10' });
  assert.deepEqual(rep.resolvePeriod({ preset: '30d' }, ref), { start: '2026-06-11', end: '2026-07-10' });
  assert.deepEqual(rep.resolvePeriod({ preset: 'quarter' }, ref), { start: '2026-07-01', end: '2026-07-10' });
  assert.deepEqual(rep.resolvePeriod({ preset: 'year' }, ref), { start: '2026-01-01', end: '2026-07-10' });
  // custom vence preset
  assert.deepEqual(rep.resolvePeriod({ preset: 'week', start: '2026-01-05', end: '2026-01-09' }, ref),
    { start: '2026-01-05', end: '2026-01-09' });
});

test('autoGroup escolhe agrupamento legível', () => {
  assert.equal(rep.autoGroup('2026-07-01', '2026-07-07'), 'day');
  assert.equal(rep.autoGroup('2026-06-01', '2026-07-15'), 'week');
  assert.equal(rep.autoGroup('2026-01-01', '2026-07-10'), 'month');
});
