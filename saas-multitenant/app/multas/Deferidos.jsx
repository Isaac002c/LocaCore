'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getDeferred } from '../lib/contractsAPI';

const GREEN = '#15803d';
const fmtDate = (v) => {
  if (!v) return '—';
  const [y, m, d] = String(v).substring(0, 10).split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : '—';
};

export default function Deferidos() {
  const router = useRouter();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(null); // modal somente leitura
  const [search, setSearch]   = useState('');

  const currentUser = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}') : {};
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => { load(); }, []);
  const load = async () => {
    try { setLoading(true); setError(null); setItems(await getDeferred() || []); }
    catch (e) { setError('Não foi possível carregar os deferidos.'); }
    finally { setLoading(false); }
  };

  const filtered = items.filter(i => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (i.client_name || '').toLowerCase().includes(s)
      || (i.numero_multa || '').toLowerCase().includes(s)
      || (i.vehicle_plate || '').toLowerCase().includes(s)
      || (i.organ || '').toLowerCase().includes(s);
  });

  // Admin pode abrir o detalhe editável; consultor NÃO é redirecionado.
  const openEditable = (it) => {
    if (!isAdmin) return;
    if (it.client_id)       router.push(`/multas/clients/${it.client_id}`);
    else if (it.company_id) router.push(`/multas/companies/${it.company_id}`);
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--nx-primary)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Carregando deferidos...</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="ag-head">
        <div>
          <h2 className="ag-head-title">Deferidos</h2>
          <p className="ag-head-sub">Processos com resultado <strong style={{ color: GREEN }}>DEFERIDO</strong> — prova social para apresentar a clientes.</p>
        </div>
        <div style={{ position: 'relative' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" placeholder="Buscar cliente, auto, placa..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 34, paddingRight: 12, height: 38, border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', background: 'var(--surface)', width: 240, color: 'var(--text-primary)' }} />
        </div>
      </div>

      {error && (
        <div style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}</div>
      )}

      <div className="ag-card">
        <div className="ag-card-head" style={{ '--accent': GREEN, '--accent-soft': 'color-mix(in srgb, var(--success) 16%, transparent)' }}>
          <span className="ag-card-dot" />
          <span className="ag-card-title">Processos deferidos</span>
          <span className="ag-card-count">{filtered.length}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="ag-empty">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Nenhum processo deferido encontrado.
          </div>
        ) : (
          <div className="ag-list">
            {filtered.map((it) => (
              <div key={it.id} className="ag-item" onClick={() => setSelected(it)} role="button" tabIndex={0}>
                <div className="ag-ava" style={{ background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: GREEN }}>
                  {(it.client_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="ag-itembody">
                  <div className="ag-name">{it.client_name || 'Sem nome'}{it.company_id ? '  ·  Empresa' : ''}</div>
                  <div className="ag-meta">{[it.numero_multa, it.vehicle_plate, it.organ].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="ag-right">
                  <span className="ag-date">{fmtDate(it.due_date)}</span>
                  <span className="ag-pill" style={{ background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: GREEN }}>Deferido</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal somente leitura */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{selected.client_name || 'Processo'}</h2>
                <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: GREEN, padding: '2px 10px', borderRadius: 999 }}>
                  DEFERIDO · somente leitura
                </span>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="btn-close">✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, color: 'var(--text-secondary)', padding: '4px 2px 8px' }}>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Tipo</span>{selected.company_id ? 'Empresa' : 'Cliente'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Órgão</span>{selected.organ || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Nº Auto/Processo</span>{selected.numero_multa || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Placa</span>{selected.vehicle_plate || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Andamento</span>Deferido</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 11 }}>Prazo</span>{fmtDate(selected.due_date)}</div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Fechar</button>
              {isAdmin && (
                <button type="button" className="btn-primary" onClick={() => openEditable(selected)}>Abrir processo</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
