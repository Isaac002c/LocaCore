'use client';

import { useState, useEffect, useMemo } from 'react';
import { getMaintenances, createMaintenance, updateMaintenance, setMaintenanceStatus, deleteMaintenance } from '../lib/maintenancesAPI';
import { getVehicles } from '../lib/vehiclesAPI';
import { MetricCard } from '../components/ui';
import { PageLoading, InlineError, EmptyState } from '../components/states';
import { fmtMoney, fmtDate, toInputDate } from './shared';

// =============================================================================
// Manutenções da frota (§8). Preventiva/corretiva/revisão/óleo/pneus/documentação/
// vistoria/outro, com km prevista e realizada, custo, fornecedor e observações.
//
// Regra de negócio (aplicada no backend): "em andamento" bloqueia o veículo para
// locação; concluir/cancelar só libera se não houver OUTRO bloqueio.
// =============================================================================

const STATUS = [
  { value: 'agendada', label: 'Agendada' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
];
const STATUS_STYLE = {
  agendada:     { background: 'var(--primary-soft)', color: 'var(--primary)' },
  em_andamento: { background: 'color-mix(in srgb, var(--warning) 16%, transparent)', color: 'var(--warning)' },
  concluida:    { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' },
  cancelada:    { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' },
};
const statusLabel = (s) => STATUS.find((x) => x.value === s)?.label || s || '—';

// Tipos previstos no escopo (§8).
const TIPOS = ['Preventiva', 'Corretiva', 'Revisão', 'Troca de óleo', 'Pneus', 'Documentação', 'Vistoria', 'Outro'];

const EMPTY = {
  vehicle_id: '', type: '', status: 'agendada', scheduled_date: '', done_date: '',
  odometer_scheduled: '', odometer_done: '', cost: '', supplier: '', notes: '',
};

const hojeISO = () => new Date().toISOString().substring(0, 10);

export default function Manutencoes() {
  const [rows, setRows] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');

  useEffect(() => { load(); getVehicles({}).then((v) => setVehicles(v || [])).catch(() => {}); }, []);

  const load = async () => {
    try { setLoading(true); setError(null); setRows((await getMaintenances({})) || []); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setFormError(null); setShowModal(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({
      vehicle_id: m.vehicle_id || '', type: m.type || '', status: m.status || 'agendada',
      scheduled_date: toInputDate(m.scheduled_date), done_date: toInputDate(m.done_date),
      odometer_scheduled: m.odometer_scheduled ?? '', odometer_done: m.odometer_done ?? '',
      cost: m.cost ?? '', supplier: m.supplier || '', notes: m.notes || '',
    });
    setFormError(null); setShowModal(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vehicle_id) { setFormError('Selecione o veículo.'); return; }
    if (form.status === 'concluida' && !form.done_date) {
      setFormError('Informe a data realizada para marcar como concluída.'); return;
    }
    if (form.scheduled_date && form.done_date && form.done_date < form.scheduled_date) {
      setFormError('A data realizada não pode ser anterior à data prevista.'); return;
    }
    try {
      setSaving(true); setFormError(null);
      if (editing) await updateMaintenance(editing.id, form);
      else await createMaintenance(form);
      setShowModal(false); setForm(EMPTY); setEditing(null);
      await load();
    } catch (err) { setFormError(err.message); } finally { setSaving(false); }
  };

  const changeStatus = async (id, status) => {
    try { setError(null); await setMaintenanceStatus(id, status); await load(); }
    catch (err) { setError(err.message); }
  };
  const remove = async (id) => {
    if (!confirm('Remover esta manutenção? A ação não pode ser desfeita.')) return;
    try { setError(null); await deleteMaintenance(id); await load(); } catch (err) { setError(err.message); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const filtrando = !!(filter || vehicleFilter);
  const displayed = useMemo(() => rows.filter((r) =>
    (!filter || r.status === filter) && (!vehicleFilter || r.vehicle_id === vehicleFilter)
  ), [rows, filter, vehicleFilter]);

  // Alertas (§8): vencidas, próximas 7 dias, veículos parados e custo acumulado.
  const alertas = useMemo(() => {
    const hoje = hojeISO();
    const em7 = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
    const abertas = rows.filter((m) => ['agendada', 'em_andamento'].includes(m.status));
    const d = (v) => toInputDate(v);
    return {
      abertas: abertas.length,
      vencidas: abertas.filter((m) => d(m.scheduled_date) && d(m.scheduled_date) < hoje).length,
      proximas: abertas.filter((m) => d(m.scheduled_date) && d(m.scheduled_date) >= hoje && d(m.scheduled_date) <= em7).length,
      bloqueando: rows.filter((m) => m.status === 'em_andamento').length,
      custo: rows.filter((m) => m.status === 'concluida').reduce((a, m) => a + (Number(m.cost) || 0), 0),
    };
  }, [rows]);

  const vehLabel = (v) => `${v.brand || ''} ${v.model || ''}${v.plate ? ` — ${v.plate}` : ''}`.trim();
  const atrasada = (m) => ['agendada', 'em_andamento'].includes(m.status)
    && toInputDate(m.scheduled_date) && toInputDate(m.scheduled_date) < hojeISO();
  const km = (v) => (v !== null && v !== undefined && v !== '' ? Number(v).toLocaleString('pt-BR') : '—');

  if (loading) return <PageLoading label="Carregando manutenções..." />;

  return (
    <div className="clients-page">
      <InlineError message={error} onDismiss={() => setError(null)} onRetry={load} />

      <div className="nx-kpi-grid">
        <MetricCard title="Em aberto" value={alertas.abertas} subtitle="Agendadas + em andamento" />
        <MetricCard title="Vencidas" value={alertas.vencidas} direction={alertas.vencidas ? 'down' : undefined} subtitle="Data prevista passou" />
        <MetricCard title="Próximos 7 dias" value={alertas.proximas} subtitle="A executar" />
        <MetricCard title="Veículos parados" value={alertas.bloqueando} direction={alertas.bloqueando ? 'down' : undefined} subtitle="Em manutenção agora" />
        <MetricCard title="Custo concluído" value={fmtMoney(alertas.custo)} subtitle="Total das concluídas" />
      </div>

      <div className="clients-toolbar">
        <div className="clients-filters">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="clients-filter-select">
            <option value="">Todos os status</option>
            {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="clients-filter-select">
            <option value="">Todos os veículos</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{vehLabel(v)}</option>)}
          </select>
        </div>
        <button onClick={openNew} className="btn-primary clients-new-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Nova Manutenção
        </button>
      </div>

      <div className="clients-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Veículo</th><th>Tipo</th><th>Prevista</th><th>Realizada</th>
              <th>Km prev.</th><th>Km real.</th><th>Custo</th><th>Fornecedor</th>
              <th>Status</th><th style={{ width: 230 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan="10"><EmptyState
                title={filtrando ? 'Nenhuma manutenção com esses filtros' : 'Nenhuma manutenção registrada'}
                description={filtrando
                  ? 'Ajuste os filtros de status e veículo para ver os demais registros.'
                  : 'Registre preventivas, revisões e corretivas da frota. Enquanto uma manutenção estiver "em andamento", o veículo fica indisponível para locação.'}
                actionLabel={filtrando ? undefined : 'Nova manutenção'}
                onAction={filtrando ? undefined : openNew}
              /></td></tr>
            ) : displayed.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong style={{ color: 'var(--text-primary)' }}>{m.vehicle_brand} {m.vehicle_model}</strong>
                  {m.vehicle_plate && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {m.vehicle_plate}</span>}
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{m.type || '—'}</td>
                <td style={{ whiteSpace: 'nowrap', color: atrasada(m) ? 'var(--danger)' : undefined, fontWeight: atrasada(m) ? 700 : undefined }}>
                  {fmtDate(m.scheduled_date)}{atrasada(m) ? ' ⚠' : ''}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.done_date)}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{km(m.odometer_scheduled)}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{km(m.odometer_done)}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(m.cost)}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{m.supplier || '—'}</td>
                <td><span className="client-status-badge" style={STATUS_STYLE[m.status]}>{statusLabel(m.status)}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.status === 'agendada' && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'em_andamento')}>Iniciar</button>}
                    {m.status === 'em_andamento' && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'concluida')}>Concluir</button>}
                    {['agendada', 'em_andamento'].includes(m.status) && <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => changeStatus(m.id, 'cancelada')}>Cancelar</button>}
                    <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(m)}>Editar</button>
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
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? 'Editar Manutenção' : 'Nova Manutenção'}</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={submit} className="modal-form">
              {formError && <div className="nx-inline-error" role="alert"><span className="nx-inline-error-msg">{formError}</span></div>}

              <div className="form-row">
                <div className="form-group"><label>Veículo *</label>
                  <select value={form.vehicle_id} onChange={set('vehicle_id')} required>
                    <option value="">Selecione...</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{vehLabel(v)}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Tipo</label>
                  <select value={form.type} onChange={set('type')}>
                    <option value="">Selecione...</option>
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                    {form.type && !TIPOS.includes(form.type) && <option value={form.type}>{form.type}</option>}
                  </select>
                </div>
                <div className="form-group"><label>Status</label>
                  <select value={form.status} onChange={set('status')}>
                    {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Data prevista</label><input type="date" value={form.scheduled_date} onChange={set('scheduled_date')} /></div>
                <div className="form-group"><label>Data realizada</label><input type="date" value={form.done_date} onChange={set('done_date')} /></div>
                <div className="form-group"><label>Custo (R$)</label><input type="number" step="0.01" min="0" value={form.cost} onChange={set('cost')} placeholder="0,00" /></div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Km prevista</label><input type="number" min="0" value={form.odometer_scheduled} onChange={set('odometer_scheduled')} placeholder="Ex.: 40000" /></div>
                <div className="form-group"><label>Km realizada</label><input type="number" min="0" value={form.odometer_done} onChange={set('odometer_done')} placeholder="Ex.: 40250" /></div>
                <div className="form-group"><label>Fornecedor</label><input type="text" value={form.supplier} onChange={set('supplier')} placeholder="Oficina/fornecedor" /></div>
              </div>

              <div className="form-group"><label>Observações</label><textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Serviços executados, peças trocadas, garantia..." /></div>

              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Com o status <strong>Em andamento</strong>, o veículo fica indisponível para locação.
                Ao concluir, ele só é liberado se não houver outra manutenção em andamento.
              </p>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : (editing ? 'Salvar' : 'Registrar')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
