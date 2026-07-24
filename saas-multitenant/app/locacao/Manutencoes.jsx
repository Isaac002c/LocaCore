'use client';

import { useState, useEffect } from 'react';
import { getMaintenances, createMaintenance, setMaintenanceStatus, deleteMaintenance } from '../lib/maintenancesAPI';
import { getVehicles } from '../lib/vehiclesAPI';
import { fmtMoney, fmtDate, toInputDate } from './shared';

const STATUS = [
  { value: 'agendada', label: 'Agendada' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
];
const STATUS_STYLE = {
  agendada: { background: '#ede9fe', color: '#6d28d9' },
  em_andamento: { background: '#fef3c7', color: '#b45309' },
  concluida: { background: '#dcfce7', color: '#15803d' },
  cancelada: { background: '#f1f5f9', color: '#64748b' },
};
const EMPTY = { vehicle_id: '', type: '', status: 'agendada', scheduled_date: '', done_date: '', cost: '', supplier: '', notes: '' };

export default function Manutencoes() {
  const [rows, setRows] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); getVehicles({}).then(setVehicles).catch(() => {}); }, []);

  const load = async () => {
    try { setLoading(true); setError(null); setRows(await getMaintenances({})); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vehicle_id) { setError('Selecione o veículo.'); return; }
    try { setSaving(true); await createMaintenance(form); setShowModal(false); setForm(EMPTY); await load(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const changeStatus = async (id, status) => { try { await setMaintenanceStatus(id, status); await load(); } catch (err) { setError(err.message); } };
  const remove = async (id) => { if (!confirm('Remover esta manutenção?')) return; try { await deleteMaintenance(id); await load(); } catch (err) { setError(err.message); } };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const displayed = rows.filter((r) => !filter || r.status === filter);
  const vehLabel = (v) => `${v.brand || ''} ${v.model || ''}${v.plate ? ` — ${v.plate}` : ''}`.trim();

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#2563eb' }} />
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando manutenções...</p>
    </div>
  );

  return (
    <div className="clients-page">
      {error && <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}><span>{error}</span><button className="btn-close" onClick={() => setError(null)}>✕</button></div>}

      <div className="clients-toolbar">
        <div className="clients-filters">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="clients-filter-select">
            <option value="">Todos os status</option>
            {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <button onClick={() => { setForm(EMPTY); setShowModal(true); }} className="btn-primary clients-new-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Nova Manutenção
        </button>
      </div>

      <div className="clients-table-wrap">
        <table className="data-table">
          <thead><tr><th>Veículo</th><th>Tipo</th><th>Agendada</th><th>Concluída</th><th>Custo</th><th>Fornecedor</th><th>Status</th><th style={{ width: 200 }}>Ações</th></tr></thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan="8"><div className="empty-state" style={{ padding: '40px 0' }}><p style={{ color: '#94a3b8' }}>Nenhuma manutenção registrada</p></div></td></tr>
            ) : displayed.map((m) => (
              <tr key={m.id}>
                <td><strong style={{ color: '#0f172a' }}>{m.vehicle_brand} {m.vehicle_model}</strong>{m.vehicle_plate && <span style={{ color: '#94a3b8', fontSize: 12 }}> · {m.vehicle_plate}</span>}</td>
                <td style={{ color: '#475569' }}>{m.type || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.scheduled_date)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.done_date)}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(m.cost)}</td>
                <td style={{ color: '#475569' }}>{m.supplier || '—'}</td>
                <td><span className="client-status-badge" style={STATUS_STYLE[m.status]}>{STATUS.find((s) => s.value === m.status)?.label || m.status}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.status === 'agendada' && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'em_andamento')}>Iniciar</button>}
                    {m.status === 'em_andamento' && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'concluida')}>Concluir</button>}
                    {['agendada', 'em_andamento'].includes(m.status) && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'cancelada')}>Cancelar</button>}
                    <button className="btn-icon danger" title="Remover" onClick={() => remove(m.id)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>Nova Manutenção</h2><button className="btn-close" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={submit} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Veículo *</label>
                  <select value={form.vehicle_id} onChange={set('vehicle_id')} required>
                    <option value="">Selecione...</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{vehLabel(v)}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Tipo</label><input type="text" value={form.type} onChange={set('type')} placeholder="Preventiva, revisão..." /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Status</label><select value={form.status} onChange={set('status')}>{STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                <div className="form-group"><label>Data agendada</label><input type="date" value={toInputDate(form.scheduled_date)} onChange={set('scheduled_date')} /></div>
                <div className="form-group"><label>Custo (R$)</label><input type="number" step="0.01" min="0" value={form.cost} onChange={set('cost')} placeholder="0,00" /></div>
              </div>
              <div className="form-group"><label>Fornecedor</label><input type="text" value={form.supplier} onChange={set('supplier')} placeholder="Oficina/fornecedor" /></div>
              <div className="form-group"><label>Observações</label><textarea rows={2} value={form.notes} onChange={set('notes')} /></div>
              <p style={{ fontSize: 12, color: '#94a3b8' }}>Ao marcar "Em andamento", o veículo fica indisponível para locação.</p>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
