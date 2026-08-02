'use client';

import { useState, useEffect } from 'react';
import { getFines, getFineStats, createFine, updateFine, setFineStatus, faturarFine, fineToExtra, deleteFine } from '../lib/rentalFinesAPI';
import { getVehicles } from '../lib/vehiclesAPI';
import { getClients } from '../lib/clientsAPI';
import { getRentals } from '../lib/rentalsAPI';
import { fmtMoney, fmtDate, toInputDate } from './shared';
import { PageLoading, InlineError, EmptyState } from '../components/states';

const STATUS = [
  ['identificada', 'Identificada'], ['aguardando_validacao', 'Aguard. validação'], ['aguardando_condutor', 'Aguard. condutor'],
  ['comunicada', 'Comunicada'], ['aguardando_pagamento', 'Aguard. pagamento'], ['cobrada', 'Cobrada'],
  ['paga', 'Paga'], ['recorrida', 'Recorrida'], ['cancelada', 'Cancelada'], ['encerrada', 'Encerrada'],
];
const LABEL = Object.fromEntries(STATUS);
const EMPTY = { rental_id: '', vehicle_id: '', client_id: '', driver_name: '', fine_number: '', organ: '', infraction_date: '', due_date: '', original_amount: '', admin_fee: '', points: '', description: '', status: 'identificada' };

export default function Multas() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [clients, setClients] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); Promise.all([getVehicles({}), getClients(), getRentals({})]).then(([v, c, r]) => { setVehicles(v || []); setClients(c || []); setRentals(r || []); }).catch(() => {}); }, []);

  const load = async () => {
    try { setLoading(true); setError(null); const [f, s] = await Promise.all([getFines(filter ? { status: filter } : {}), getFineStats().catch(() => null)]); setRows(f || []); setStats(s); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]); // eslint-disable-line

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const openNew = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...EMPTY, ...r, infraction_date: toInputDate(r.infraction_date), due_date: toInputDate(r.due_date) }); setModal(true); };
  const submit = async (e) => {
    e.preventDefault();
    try { setSaving(true); if (editing) await updateFine(editing.id, form); else await createFine(form); setModal(false); await load(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const act = async (fn, id, msg) => { try { setNotice(null); await fn(id); setNotice(msg); await load(); } catch (err) { setError(err.message); } };
  const remove = async (id) => { if (!confirm('Excluir esta multa?')) return; try { await deleteFine(id); await load(); } catch (err) { setError(err.message); } };

  if (loading && rows.length === 0) return <PageLoading label="Carregando multas..." />;

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all"><span className="summary-number">{stats?.total ?? rows.length}</span><span className="summary-label">Total de Multas</span></div>
        <div className="clients-summary-card nego"><span className="summary-number">{stats?.abertas ?? '—'}</span><span className="summary-label">Em aberto</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(stats?.valor_aberto || 0)}</span><span className="summary-label">Valor em aberto</span></div>
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} onRetry={load} />
      {notice && <div style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 38%, transparent)', color: '#065f46', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}><span>{notice}</span><button className="btn-close" onClick={() => setNotice(null)}>✕</button></div>}

      <div className="clients-toolbar">
        <div className="clients-filters"><select value={filter} onChange={(e) => setFilter(e.target.value)} className="clients-filter-select"><option value="">Todos os status</option>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <button onClick={openNew} className="btn-primary clients-new-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Nova Multa</button>
      </div>

      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Nº / Órgão</th><th>Veículo</th><th>Cliente</th><th>Infração</th><th>Total</th><th>Status</th><th style={{ width: 220 }}>Ações</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan="7"><EmptyState
              title={filter ? 'Nenhuma multa neste status' : 'Nenhuma multa registrada'}
              description={filter
                ? 'Troque o filtro de status para ver as demais multas.'
                : 'Registre infrações recebidas para vincular ao veículo, à locação e ao condutor — e cobrar do cliente quando for o caso.'}
            /></td></tr> : rows.map((f) => (
            <tr key={f.id}>
              <td><strong>{f.fine_number || '—'}</strong><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.organ || ''}</div></td>
              <td>{f.vehicle_plate || '—'}</td>
              <td>{f.client_name || '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.infraction_date)}</td>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(f.total_amount)}</td>
              <td><span className="client-status-badge">{LABEL[f.status] || f.status}</span></td>
              <td>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(f)}>Editar</button>
                  {!f.billing_id && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => act(faturarFine, f.id, 'Multa faturada.')}>Faturar</button>}
                  {f.rental_id && !f.rental_extra_id && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => act(fineToExtra, f.id, 'Lançada como adicional.')}>Adicional</button>}
                  <button
                    className="btn-icon danger"
                    title={f.billing_id ? 'Excluir (o faturamento vinculado é cancelado junto)' : 'Excluir'}
                    onClick={() => remove(f.id)}
                  >✕</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? 'Editar Multa' : 'Nova Multa'}</h2><button className="btn-close" onClick={() => setModal(false)}>✕</button></div>
            <form onSubmit={submit} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Locação</label><select value={form.rental_id} onChange={set('rental_id')}><option value="">— sem locação —</option>{rentals.map((r) => <option key={r.id} value={r.id}>{r.rental_number} · {r.client_name}</option>)}</select></div>
                <div className="form-group"><label>Veículo</label><select value={form.vehicle_id} onChange={set('vehicle_id')}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} {v.plate ? `— ${v.plate}` : ''}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Cliente</label><select value={form.client_id} onChange={set('client_id')}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div className="form-group"><label>Condutor</label><input type="text" value={form.driver_name} onChange={set('driver_name')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Nº da infração</label><input type="text" value={form.fine_number} onChange={set('fine_number')} /></div>
                <div className="form-group"><label>Órgão</label><input type="text" value={form.organ} onChange={set('organ')} placeholder="DETRAN, DER..." /></div>
                <div className="form-group"><label>Pontos</label><input type="number" min="0" value={form.points} onChange={set('points')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Data infração</label><input type="date" value={form.infraction_date} onChange={set('infraction_date')} /></div>
                <div className="form-group"><label>Vencimento</label><input type="date" value={form.due_date} onChange={set('due_date')} /></div>
                <div className="form-group"><label>Status</label><select value={form.status} onChange={set('status')}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Valor original (R$)</label><input type="number" step="0.01" min="0" value={form.original_amount} onChange={set('original_amount')} placeholder="0,00" /></div>
                <div className="form-group"><label>Taxa administrativa (R$)</label><input type="number" step="0.01" min="0" value={form.admin_fee} onChange={set('admin_fee')} placeholder="0,00" /></div>
              </div>
              <div className="form-group"><label>Descrição</label><textarea rows={2} value={form.description} onChange={set('description')} /></div>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar' : 'Registrar'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
