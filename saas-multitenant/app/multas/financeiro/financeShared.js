'use client';

// Helpers compartilhados das telas financeiras (padrão visual/formatos pt-BR).

export const BRAND = 'var(--nx-primary)';

// R$ 1.234,56 — aceita number|string (o backend devolve NUMERIC como string).
export function formatBRL(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0').replace(',', '.'));
  if (!isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ISO/Date → DD/MM/AAAA (timezone-safe para datas puras).
export function formatDate(value) {
  if (!value) return '—';
  const s = String(value).substring(0, 10);
  const [y, m, d] = s.split('-');
  if (y && m && d) return `${d}/${m}/${y}`;
  const dt = new Date(value);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('pt-BR');
}

export function formatDateTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  return isNaN(dt) ? '—' : dt.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Máscara "digitando em centavos": "12345" → "123,45". Somente no frontend.
export function maskMoney(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const n = parseInt(digits, 10);
  return (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "1.234,56" → 1234.56 (envio ao backend).
export function moneyToNumber(masked) {
  const digits = String(masked ?? '').replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

// number|string → "1.234,56" (para preencher input a partir de dado existente).
export function numberToMask(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0').replace(',', '.'));
  if (!isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ISO date → yyyy-mm-dd para <input type=date>
export function toInputDate(value) {
  if (!value) return '';
  return String(value).substring(0, 10);
}

export const STATUS_COLORS = {
  // lançamentos
  previsto:  { bg: 'rgba(100,116,139,.12)', fg: '#475569' },
  pendente:  { bg: 'rgba(245,158,11,.14)',  fg: '#b45309' },
  pago:      { bg: 'rgba(21,128,61,.14)',   fg: '#15803d' },
  recebido:  { bg: 'rgba(21,128,61,.14)',   fg: '#15803d' },
  vencido:   { bg: 'rgba(220,38,38,.14)',   fg: '#b91c1c' },
  cancelado: { bg: 'rgba(100,116,139,.14)', fg: '#64748b' },
  // faturamento
  nao_faturado:      { bg: 'rgba(100,116,139,.12)', fg: '#475569' },
  faturado:          { bg: 'rgba(59,130,246,.14)',  fg: 'var(--nx-primary-hover)' },
  parcialmente_pago: { bg: 'rgba(245,158,11,.14)',  fg: '#b45309' },
  // recibos
  emitido:   { bg: 'rgba(21,128,61,.14)',   fg: '#15803d' },
};

export function StatusBadge({ status, label }) {
  const c = STATUS_COLORS[status] || { bg: 'rgba(100,116,139,.12)', fg: '#475569' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap',
    }}>
      {label || status}
    </span>
  );
}

export function isAdmin() {
  if (typeof window === 'undefined') return false;
  try { return (JSON.parse(localStorage.getItem('user') || '{}').role) === 'admin'; }
  catch { return false; }
}

export function AccessDenied() {
  return (
    <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{ marginBottom: 12 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>Acesso restrito</h3>
      <p style={{ color: '#94a3b8' }}>O módulo financeiro está disponível apenas para administradores.</p>
    </div>
  );
}

export function Spinner({ label = 'Carregando...' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: BRAND }} />
      <p style={{ color: '#94a3b8', fontSize: 14 }}>{label}</p>
    </div>
  );
}

// Toast simples de sucesso/erro (feedback). Renderiza fixo no topo.
export function Feedback({ message, type = 'success', onClose }) {
  if (!message) return null;
  const ok = type === 'success';
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 3000, maxWidth: 380,
      background: ok ? '#052e16' : '#450a0a', color: '#fff', padding: '12px 16px',
      borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.25)', display: 'flex',
      alignItems: 'center', gap: 12, fontSize: 14,
    }}>
      <span>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
    </div>
  );
}
