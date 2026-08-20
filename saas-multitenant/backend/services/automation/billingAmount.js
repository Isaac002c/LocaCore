'use strict';

const cents = (value) => Math.round((Number(value) || 0) * 100);
const asMoney = (valueInCents) => (valueInCents / 100).toFixed(2);

/**
 * Resolve o valor sem inventar informacao contratual.
 * Prioridade: semanal explicito -> fonte total explicitamente escolhida -> diaria.
 * O total nunca e usado no modo automatico porque pode representar o contrato todo.
 */
function resolveWeeklyAmount(rental = {}, { days = 7 } = {}) {
  const weekly = cents(rental.weekly_rate);
  if (weekly > 0) return { ok: true, amount: asMoney(weekly), source: 'weekly_rate', days: 7 };

  const source = String(rental.billing_value_source || 'auto').toLowerCase();
  const total = cents(rental.total_amount);
  if (source === 'total') {
    if (total > 0) return { ok: true, amount: asMoney(total), source: 'total_amount', days: null };
    return { ok: false, code: 'MISSING_TOTAL_AMOUNT', reason: 'Valor total selecionado, mas nao informado.' };
  }

  if (source === 'weekly') {
    return { ok: false, code: 'MISSING_WEEKLY_AMOUNT', reason: 'Valor semanal selecionado, mas nao informado.' };
  }

  const daily = cents(rental.daily_rate);
  if (daily > 0) {
    const safeDays = Math.max(1, Number(days) || 7);
    return { ok: true, amount: asMoney(daily * safeDays), source: 'daily_rate', days: safeDays };
  }

  if (source === 'daily') {
    return { ok: false, code: 'MISSING_DAILY_AMOUNT', reason: 'Valor diario selecionado, mas nao informado.' };
  }

  return {
    ok: false,
    code: 'NO_SAFE_AMOUNT',
    reason: 'Sem valor semanal explicito ou diaria valida. O total do contrato nao sera presumido.',
  };
}

module.exports = { resolveWeeklyAmount, cents, asMoney };

