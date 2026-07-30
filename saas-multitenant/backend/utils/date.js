'use strict';
// =============================================================================
// utils/date.js — coerção segura de DATE vindo do banco.
//
// O driver `pg` devolve colunas DATE como objeto Date; o pg-mem devolve string.
// Por isso `String(valor).substring(0,10)` passa em todos os testes locais e
// quebra só em produção, produzindo "Wed Jul 29" em vez de "2026-07-29".
//
// Sintomas já observados com esse bug: UPDATE recusado pelo Postgres, datas
// erradas no CSV exportado, período errado no recibo/contrato e `dueDate`
// inválido no payload do provedor de cobrança.
//
// Usa getters LOCAIS (não toISOString) para não deslocar o dia por fuso.
// =============================================================================

/** DATE → 'YYYY-MM-DD' (string vazia quando não há valor). */
const toISODate = (v) => {
  if (v === '' || v === undefined || v === null) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).substring(0, 10);
};

/** DATE → 'YYYY-MM-DD' ou null (para parâmetros de query). */
const toISODateOrNull = (v) => toISODate(v) || null;

/** DATE → 'DD/MM/AAAA' (exibição pt-BR); string vazia quando não há valor. */
const toBrDate = (v) => {
  const iso = toISODate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Hoje em 'YYYY-MM-DD' (horário local). */
const todayISO = () => toISODate(new Date());

/** Soma dias a uma data (aceita Date ou string) → 'YYYY-MM-DD'. */
const addDays = (base, days) => {
  const iso = toISODate(base);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().substring(0, 10);
};

/** Diferença em dias inteiros entre duas datas (b - a); null se inválidas. */
const diffDays = (a, b) => {
  const ia = toISODate(a); const ib = toISODate(b);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ia) || !/^\d{4}-\d{2}-\d{2}$/.test(ib)) return null;
  const [ya, ma, da] = ia.split('-').map(Number);
  const [yb, mb, db] = ib.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
};

module.exports = { toISODate, toISODateOrNull, toBrDate, todayISO, addDays, diffDays };
