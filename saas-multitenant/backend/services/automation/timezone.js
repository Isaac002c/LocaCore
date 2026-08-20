'use strict';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value || DEFAULT_TIMEZONE }).format(new Date());
    return value || DEFAULT_TIMEZONE;
  } catch (_) {
    return DEFAULT_TIMEZONE;
  }
}

function zonedParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const zone = validTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    timeZone: zone,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function addCalendarDays(ymd, amount) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

function weekBoundsInZone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  const delta = p.weekday === 0 ? -6 : 1 - p.weekday;
  const start = addCalendarDays(p.ymd, delta);
  return { start, end: addCalendarDays(start, 6), local: p };
}

function isScheduledNow(date, { weekday, hour, timeZone }) {
  const p = zonedParts(date, timeZone);
  return p.weekday === Number(weekday) && p.hour >= Number(hour);
}

module.exports = {
  DEFAULT_TIMEZONE, validTimeZone, zonedParts, addCalendarDays, weekBoundsInZone, isScheduledNow,
};

