// Constantes e helpers compartilhados do módulo Locação (Frota + Locações).
// Fonte única de verdade da UI; nada de listas duplicadas espalhadas nas telas.

// ── Dinheiro / datas (padrão brasileiro, timezone-safe) ──────────────────────
export const fmtMoney = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

export const fmtDate = (v) => {
  if (!v) return '—';
  const [y, m, d] = String(v).substring(0, 10).split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : '—';
};

export const toInputDate = (v) => (!v ? '' : String(v).substring(0, 10));

// ── Frota (vehicles) ─────────────────────────────────────────────────────────
export const VEHICLE_STATUS = [
  { value: 'disponivel', label: 'Disponível' },
  { value: 'alugado',    label: 'Alugado' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'inativo',    label: 'Inativo' },
];
const VEHICLE_STATUS_COLORS = {
  disponivel: { bg: '#dcfce7', text: '#15803d' },
  alugado:    { bg: '#dbeafe', text: 'var(--nx-primary-hover)' },
  manutencao: { bg: '#fef3c7', text: '#b45309' },
  inativo:    { bg: '#f1f5f9', text: '#64748b' },
};
export const vehicleStatusLabel = (s) => VEHICLE_STATUS.find((o) => o.value === s)?.label || s || '—';
export const vehicleStatusStyle = (s) => {
  const c = VEHICLE_STATUS_COLORS[s] || { bg: '#f1f5f9', text: '#64748b' };
  return { background: c.bg, color: c.text };
};

// ── Locações (rentals) ───────────────────────────────────────────────────────
export const RENTAL_STATUS = [
  { value: 'reservado',    label: 'Reservado' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'atrasado',     label: 'Atrasado' },
  { value: 'finalizado',   label: 'Finalizado' },
  { value: 'cancelado',    label: 'Cancelado' },
];
const RENTAL_STATUS_COLORS = {
  reservado:    { bg: '#ede9fe', text: '#6d28d9' },
  em_andamento: { bg: '#dbeafe', text: 'var(--nx-primary-hover)' },
  atrasado:     { bg: '#fee2e2', text: '#b91c1c' },
  finalizado:   { bg: '#dcfce7', text: '#15803d' },
  cancelado:    { bg: '#f1f5f9', text: '#64748b' },
};
export const rentalStatusLabel = (s) => RENTAL_STATUS.find((o) => o.value === s)?.label || s || '—';
export const rentalStatusStyle = (s) => {
  const c = RENTAL_STATUS_COLORS[s] || { bg: '#f1f5f9', text: '#64748b' };
  return { background: c.bg, color: c.text };
};

// ── Máscaras ─────────────────────────────────────────────────────────────────
// Placa BR (antiga ABC-1234 ou Mercosul ABC1D23): alfanumérica, até 7 caracteres.
export const maskPlate = (v) =>
  (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

export const maskPhone = (v) => {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// Diárias entre duas datas (mínimo 1 quando há período).
export const daysBetween = (start, end) => {
  if (!start || !end) return 1;
  const a = new Date(`${String(start).substring(0, 10)}T00:00:00`);
  const b = new Date(`${String(end).substring(0, 10)}T00:00:00`);
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 1;
};
