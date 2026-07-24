'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAgenda, createEvent, deleteEvent } from '../lib/calendarAPI';
import { fmtDate } from './shared';

// Cores/rótulos por tipo de evento da agenda operacional.
const TYPE_META = {
  retirada:   { label: 'Retirada',    bg: '#dbeafe', text: '#1d4ed8' },
  devolucao:  { label: 'Devolução',   bg: '#dcfce7', text: '#15803d' },
  manutencao: { label: 'Manutenção',  bg: '#fef3c7', text: '#b45309' },
  multa:      { label: 'Multa',       bg: '#fee2e2', text: '#b91c1c' },
  bloqueio:   { label: 'Bloqueio',    bg: '#f1f5f9', text: '#475569' },
  lembrete:   { label: 'Lembrete',    bg: '#ede9fe', text: '#6d28d9' },
  tarefa:     { label: 'Tarefa',      bg: '#e0f2fe', text: '#0369a1' },
  outro:      { label: 'Evento',      bg: '#f1f5f9', text: '#475569' },
};
const meta = (t) => TYPE_META[t] || TYPE_META.outro;

const FILTERS = [
  ['', 'Tudo'], ['retirada', 'Retiradas'], ['devolucao', 'Devoluções'],
  ['manutencao', 'Manutenções'], ['multa', 'Multas'],
];

// Primeiro/último dia do mês corrente (ISO yyyy-mm-dd).
const monthRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => d.toISOString().substring(0, 10);
  return { from: iso(first), to: iso(last) };
};

const EMPTY = { title: '', event_date: '', start_time: '', type: 'lembrete', description: '' };
const isToday = (d) => String(d).substring(0, 10) === new Date().toISOString().substring(0, 10);

export default function Calendario() {
  const init = monthRange();
  const [events, setEvents] = useState([]);
  const [range, setRange] = useState(init);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const data = await getAgenda({ from: range.from, to: range.to, type });
      setEvents(data || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [range.from, range.to, type]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const openNew = () => { setForm({ ...EMPTY, event_date: new Date().toISOString().substring(0, 10) }); setModal(true); };
  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.event_date) { setError('Título e data são obrigatórios.'); return; }
    try { setSaving(true); await createEvent(form); setModal(false); await load(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const remove = async (ev) => {
    if (ev.source !== 'manual') return;
    if (!confirm(`Excluir "${ev.title}"?`)) return;
    try { await deleteEvent(ev.id); await load(); } catch (err) { setError(err.message); }
  };

  // Agrupa por data (mantém ordem já vinda do backend).
  const groups = [];
  const byDate = new Map();
  for (const ev of events) {
    const d = String(ev.date).substring(0, 10);
    if (!byDate.has(d)) { byDate.set(d, []); groups.push(d); }
    byDate.get(d).push(ev);
  }

  const counts = FILTERS.reduce((acc, [k]) => { acc[k] = k ? events.filter((e) => e.type === k).length : events.length; return acc; }, {});

  if (loading && events.length === 0) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}><div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#2563eb' }} /><p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando agenda...</p></div>;

  return (
    <div className="clients-page">
      {error && <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span>{error}</span><button className="btn-close" onClick={() => setError(null)}>✕</button></div>}

      <div className="clients-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="clients-search-input" style={{ width: 150 }} />
          <span style={{ color: '#94a3b8' }}>até</span>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="clients-search-input" style={{ width: 150 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([v, l]) => (
            <button key={v || 'all'} className={type === v ? 'btn-primary' : 'btn-secondary'} style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => setType(v)}>
              {l}{counts[v] ? ` (${counts[v]})` : ''}
            </button>
          ))}
        </div>
        <button onClick={openNew} className="btn-primary clients-new-btn" style={{ marginLeft: 'auto' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Novo Evento</button>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state" style={{ padding: '60px 0', textAlign: 'center' }}><p style={{ color: '#94a3b8' }}>Nenhum evento no período.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groups.map((d) => (
            <div key={d}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: isToday(d) ? '#2563eb' : '#0f172a', margin: 0 }}>{fmtDate(d)}</h3>
                {isToday(d) && <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#dbeafe', padding: '2px 8px', borderRadius: 999 }}>HOJE</span>}
                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {byDate.get(d).map((ev) => {
                  const m = meta(ev.type);
                  return (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, borderLeft: `4px solid ${m.text}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: m.text, background: m.bg, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{m.label}</span>
                      {ev.start_time && <span style={{ fontSize: 13, fontWeight: 600, color: '#475569', minWidth: 44 }}>{String(ev.start_time).substring(0, 5)}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 14 }}>{ev.title}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {[ev.client_name, ev.vehicle_plate, ev.responsible_name && `resp. ${ev.responsible_name}`, ev.status].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {ev.source === 'manual'
                        ? <button className="btn-icon danger" title="Excluir" onClick={() => remove(ev)}>✕</button>
                        : <span style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic', whiteSpace: 'nowrap' }}>automático</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>Novo Evento</h2><button className="btn-close" onClick={() => setModal(false)}>✕</button></div>
            <form onSubmit={submit} className="modal-form">
              <div className="form-group"><label>Título *</label><input type="text" value={form.title} onChange={set('title')} required autoFocus /></div>
              <div className="form-row">
                <div className="form-group"><label>Data *</label><input type="date" value={form.event_date} onChange={set('event_date')} required /></div>
                <div className="form-group"><label>Hora</label><input type="time" value={form.start_time} onChange={set('start_time')} /></div>
                <div className="form-group"><label>Tipo</label><select value={form.type} onChange={set('type')}><option value="lembrete">Lembrete</option><option value="tarefa">Tarefa</option><option value="outro">Evento</option></select></div>
              </div>
              <div className="form-group"><label>Descrição</label><textarea rows="2" value={form.description} onChange={set('description')} /></div>
              <p style={{ fontSize: 12, color: '#94a3b8' }}>Retiradas, devoluções, manutenções e multas aparecem automaticamente na agenda.</p>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Criar'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
