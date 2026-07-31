'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getDeadlines } from '../lib/contractsAPI';

// ─── Datas (date-only, sem shift de fuso) ───────────────────────────────────────

const parseDateOnly = (v) => {
  if (!v) return null;
  const [y, m, d] = String(v).substring(0, 10).split('-');
  if (!y || !m || !d) return null;
  return new Date(+y, +m - 1, +d, 12, 0, 0);
};

const fmtDate = (v) => {
  const dt = parseDateOnly(v);
  return dt ? dt.toLocaleDateString('pt-BR') : '—';
};

const diffDays = (v) => {
  const dt = parseDateOnly(v);
  if (!dt) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((dt - today) / 86400000);
};

const prazoLabel = (v) => {
  const d = diffDays(v);
  if (d == null) return '';
  if (d === 0) return 'vence hoje';
  if (d < 0)   return `venceu há ${Math.abs(d)} dia${Math.abs(d) !== 1 ? 's' : ''}`;
  return `vence em ${d} dia${d !== 1 ? 's' : ''}`;
};

// Cor por urgência (mantém vermelho p/ vencido, amarelo/laranja p/ próximos)
const urgencyOf = (v, overdue) => {
  const d = diffDays(v);
  if (overdue && d === 0)               return { color: '#ea580c', soft: '#ffedd5' }; // vence hoje
  if (overdue || (d != null && d < 0))  return { color: 'var(--danger)', soft: '#fee2e2' }; // vencido
  if (d != null && d <= 7)              return { color: 'var(--warning)', soft: '#fef3c7' }; // até 7 dias
  return { color: 'var(--text-secondary)', soft: '#f1f5f9' };                                       // mais distante
};

// Abas por urgência (Vencido / Hoje / Até 7 dias / Mais distante)
const TABS = [
  { key: 'vencidos', label: 'Vencidos',      color: 'var(--danger)', soft: '#fee2e2' },
  { key: 'hoje',     label: 'Vence hoje',    color: '#ea580c', soft: '#ffedd5' },
  { key: 'ate7',     label: 'Até 7 dias',    color: 'var(--warning)', soft: '#fef3c7' },
  { key: 'distante', label: 'Mais distante', color: 'var(--text-secondary)', soft: '#f1f5f9' },
];

// ─── Item da agenda ─────────────────────────────────────────────────────────────

function DeadlineItem({ item, overdue, onOpen }) {
  const u = urgencyOf(item.due_date, overdue);
  const meta = [item.numero_multa, item.vehicle_plate, item.organ].filter(Boolean).join(' · ');
  return (
    <div className="ag-item" onClick={onOpen} role="button" tabIndex={0}>
      <div className="ag-ava" style={{ background: u.soft, color: u.color }}>
        {(item.client_name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="ag-itembody">
        <div className="ag-name">{item.client_name || 'Cliente'}</div>
        <div className="ag-meta">{meta || '—'}</div>
      </div>
      <div className="ag-right">
        <span className="ag-date">{fmtDate(item.due_date)}</span>
        <span className="ag-pill" style={{ background: u.soft, color: u.color }}>{prazoLabel(item.due_date)}</span>
      </div>
    </div>
  );
}

// ─── Seção (lista) ──────────────────────────────────────────────────────────────

function Section({ title, color, soft, items, overdue, emptyText, onOpen }) {
  return (
    <div className="ag-card">
      <div className="ag-card-head" style={{ '--accent': color, '--accent-soft': soft }}>
        <span className="ag-card-dot" />
        <span className="ag-card-title">{title}</span>
        <span className="ag-card-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="ag-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          {emptyText}
        </div>
      ) : (
        <div className="ag-list">
          {items.map((it) => (
            <DeadlineItem key={it.id} item={it} overdue={overdue} onOpen={() => onOpen(it)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Linha do resumo (coluna direita) ───────────────────────────────────────────

function ResumoRow({ label, value, color }) {
  return (
    <div className="ag-aside-row">
      <span className="ag-aside-lbl">
        <span className="ag-aside-dot" style={{ background: color }} />
        {label}
      </span>
      <span className="ag-aside-val" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────────

export default function MultasAgenda() {
  const router = useRouter();
  const [overdue, setOverdue]   = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState('vencidos');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDeadlines(30);
      setOverdue(data?.overdue || []);
      setUpcoming(data?.upcoming || []);
    } catch (err) {
      setError('Não foi possível carregar os prazos.');
    } finally {
      setLoading(false);
    }
  };

  const openClient = (it) => {
    if (it?.client_id) router.push(`/multas/clients/${it.client_id}`);
  };

  const total = overdue.length + upcoming.length;
  const all = [...overdue, ...upcoming];
  const buckets = { vencidos: [], hoje: [], ate7: [], distante: [] };
  for (const it of all) {
    const d = diffDays(it.due_date);
    if (d == null) continue;
    if (d < 0)        buckets.vencidos.push(it);
    else if (d === 0) buckets.hoje.push(it);
    else if (d <= 7)  buckets.ate7.push(it);
    else              buckets.distante.push(it);
  }
  const activeTabInfo = TABS.find(t => t.key === tab) || TABS[0];

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--nx-primary)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Carregando prazos...</p>
    </div>
  );

  return (
    <div className="ag-page">
      <div className="ag-head">
        <div>
          <h2 className="ag-head-title">Prazos</h2>
          <p className="ag-head-sub">Prazos dos processos por urgência (próximos 30 dias).</p>
        </div>
        <button className="ag-refresh" onClick={load} disabled={loading}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Atualizar
        </button>
      </div>

      {error && (
        <div style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Abas por urgência */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => {
          const n = buckets[t.key].length;
          const activeTab = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: '1px solid ' + (activeTab ? t.color : 'var(--border)'),
                background: activeTab ? t.soft : '#fff',
                color: activeTab ? t.color : 'var(--text-secondary)',
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
              {t.label}
              <span style={{ fontSize: 11, fontWeight: 700, background: activeTab ? '#fff' : '#f1f5f9', color: t.color, padding: '1px 8px', borderRadius: 999 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="md-layout">
        <div className="md-main">
          <div className="ag-card">
            <div className="ag-card-head" style={{ '--accent': activeTabInfo.color, '--accent-soft': activeTabInfo.soft }}>
              <span className="ag-card-dot" />
              <span className="ag-card-title">{activeTabInfo.label}</span>
              <span className="ag-card-count">{buckets[tab].length}</span>
            </div>
            {buckets[tab].length === 0 ? (
              <div className="ag-empty">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Nenhum prazo nesta categoria.
              </div>
            ) : (
              <div className="ag-list">
                {buckets[tab].map(it => (
                  <DeadlineItem key={it.id} item={it} overdue={(diffDays(it.due_date) ?? 1) <= 0} onOpen={() => openClient(it)} />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="md-sidebar">
          <div className="ag-aside-card">
            <div className="ag-aside-title">Resumo</div>
            <ResumoRow label="Vencidos"      value={buckets.vencidos.length} color="#dc2626" />
            <ResumoRow label="Vence hoje"    value={buckets.hoje.length}     color="#ea580c" />
            <ResumoRow label="Até 7 dias"    value={buckets.ate7.length}     color="#d97706" />
            <ResumoRow label="Mais distante" value={buckets.distante.length} color="var(--text-secondary)" />
            <ResumoRow label="Total"         value={total}                   color="var(--text-primary)" />
          </div>
          <div className="ag-aside-card">
            <div className="ag-aside-title">Legenda</div>
            <p className="ag-legend">
              <strong style={{ color: 'var(--danger)' }}>Vermelho</strong> — vencido<br />
              <strong style={{ color: '#ea580c' }}>Laranja</strong> — vence hoje<br />
              <strong style={{ color: 'var(--warning)' }}>Amarelo</strong> — vence em até 7 dias<br />
              <strong style={{ color: 'var(--text-secondary)' }}>Cinza</strong> — mais distante
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
