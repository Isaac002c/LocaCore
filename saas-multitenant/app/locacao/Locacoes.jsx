'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  getRentals, getRentalStats, getRentalById, createRental, updateRental,
  setRentalStatus, returnRental, cancelRental, faturarRental, getRentalBillings, deleteRental,
  generateReceipt, getRentalExtras, addRentalExtra, deleteRentalExtra,
  getRentalDocuments, addRentalDocument, deleteRentalDocument,
  generateContract, contractPdfUrl,
} from '../lib/rentalsAPI';
import { getVehicles } from '../lib/vehiclesAPI';
import { getClients } from '../lib/clientsAPI';
import { getOptions } from '../lib/configOptionsAPI';
import { uploadFile } from '../lib/uploadsAPI';
import { Drawer, ConfirmDialog, EmptyState } from '../components/ui';
import { VistoriaFields, VistoriaView, EMPTY_VISTORIA, vistoriaHasContent } from './Vistoria';
import {
  RENTAL_STATUS, rentalStatusLabel, rentalStatusStyle,
  fmtMoney, fmtDate, toInputDate, daysBetween,
} from './shared';
import { PageLoading, InlineError } from '../components/states';

const EMPTY_FORM = {
  client_id: '', vehicle_id: '', start_date: '', end_date: '',
  daily_rate: '', discount_amount: '', deposit_amount: '',
  status: 'reservado', pickup_location: '', notes: '', pickup_inspection: EMPTY_VISTORIA,
};

// Categorias de documento da locação (fallback; podem ser parametrizadas por tenant).
const DOC_CATEGORIES = [
  'contrato_locacao', 'cnh', 'documento_identificacao', 'comprovante_residencia',
  'vistoria_retirada', 'vistoria_devolucao', 'comprovante_pagamento', 'multa', 'manutencao', 'outro',
];
const DOC_LABELS = {
  contrato_locacao: 'Contrato de locação', cnh: 'CNH', documento_identificacao: 'Documento de identificação',
  comprovante_residencia: 'Comprovante de residência', vistoria_retirada: 'Vistoria de retirada',
  vistoria_devolucao: 'Vistoria de devolução', comprovante_pagamento: 'Comprovante de pagamento',
  multa: 'Multa', manutencao: 'Manutenção', outro: 'Outro',
};

export default function Locacoes() {
  const [rentals, setRentals]   = useState([]);
  const [stats, setStats]       = useState(null);
  const [clients, setClients]   = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const searchDebounce = useRef(null);

  // Drawer de detalhe / operação
  const [selected, setSelected] = useState(null);
  const [finance, setFinance]   = useState(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [returnMode, setReturnMode] = useState(false);
  const [returnData, setReturnData] = useState({ return_date: '', return_odometer: '', notes: '', return_inspection: EMPTY_VISTORIA });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Erro exibido DENTRO do diálogo de confirmação (cancelar/excluir). Sem ele, a
  // recusa do backend era gravada em `error`, que só renderiza atrás do drawer —
  // o usuário via o diálogo fechar e "nada acontecer".
  const [dialogError, setDialogError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Adicionais / documentos da locação selecionada
  const [extras, setExtras] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [extraCats, setExtraCats] = useState([]);
  const [extraForm, setExtraForm] = useState({ category: '', description: '', quantity: '1', unit_amount: '' });
  const [docForm, setDocForm] = useState({ category: 'contrato_locacao', description: '' });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { load(); loadRefs(); }, []);

  const load = async (opts = {}) => {
    try {
      setLoading(true);
      setError(null);
      const [list, s] = await Promise.all([
        getRentals({ q: opts.q || '', status: opts.status ?? filterStatus }),
        getRentalStats().catch(() => null),
      ]);
      setRentals(list || []);
      setStats(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadRefs = async () => {
    try {
      const [cli, veh, cats] = await Promise.all([
        getClients().catch(() => []), getVehicles({}).catch(() => []),
        getOptions('rental_extra_category').catch(() => []),
      ]);
      setClients(cli || []);
      setVehicles(veh || []);
      setExtraCats((cats || []).map((c) => c.value));
    } catch { /* refs opcionais */ }
  };

  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (term.length >= 2) load({ q: term });
      else if (term.length === 0) load({ q: '' });
    }, 300);
  };

  const onFilterStatus = (status) => { setFilterStatus(status); load({ status, q: searchTerm.length >= 2 ? searchTerm : '' }); };

  // Total calculado ao vivo no formulário (diária × diárias − desconto).
  // Adicionais são itemizados na aba "Adicionais" da locação (somados ao total lá).
  const formTotals = useMemo(() => {
    const days = daysBetween(formData.start_date, formData.end_date);
    const total = Math.max(
      (Number(formData.daily_rate) || 0) * days - (Number(formData.discount_amount) || 0),
      0,
    );
    return { days, total };
  }, [formData.daily_rate, formData.start_date, formData.end_date, formData.discount_amount]);

  const set = (field) => (e) => {
    const value = e.target.value;
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Ao escolher o veículo, sugere a diária padrão dele (se ainda vazia).
      if (field === 'vehicle_id') {
        const v = vehicles.find((x) => x.id === value);
        if (v && (!prev.daily_rate || Number(prev.daily_rate) === 0)) next.daily_rate = v.daily_rate ?? '';
      }
      return next;
    });
  };

  const validateForm = () => {
    if (!formData.client_id) return 'Selecione o cliente (locatário).';
    if (!formData.vehicle_id) return 'Selecione o veículo.';
    if (formData.start_date && formData.end_date && formData.end_date < formData.start_date) return 'A devolução não pode ser anterior à retirada.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const v = validateForm();
    if (v) { setFormError(v); return; }
    try {
      setSaving(true);
      const payload = {
        ...formData,
        days: formTotals.days,
        daily_rate: formData.daily_rate || 0,
        discount_amount: formData.discount_amount || 0,
        deposit_amount: formData.deposit_amount || 0,
        pickup_inspection: vistoriaHasContent(formData.pickup_inspection) ? formData.pickup_inspection : null,
      };
      if (editing) await updateRental(editing.id, payload);
      else         await createRental(payload);
      closeModal();
      load({ q: searchTerm.length >= 2 ? searchTerm : '' });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => { setShowModal(false); setEditing(null); setFormData(EMPTY_FORM); setFormError(null); };

  const openNew = () => { setEditing(null); setFormData(EMPTY_FORM); setShowModal(true); };

  const openEdit = (r) => {
    setEditing(r);
    setFormData({
      client_id: r.client_id || '', vehicle_id: r.vehicle_id || '',
      start_date: toInputDate(r.start_date), end_date: toInputDate(r.end_date),
      daily_rate: r.daily_rate ?? '',
      discount_amount: r.discount_amount ?? '', deposit_amount: r.deposit_amount ?? '',
      status: r.status || 'reservado', pickup_location: r.pickup_location || '', notes: r.notes || '',
      pickup_inspection: r.pickup_inspection || EMPTY_VISTORIA,
    });
    setShowModal(true);
  };

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const loadExtrasDocs = async (id) => {
    const [ex, docs] = await Promise.all([
      getRentalExtras(id).catch(() => []),
      getRentalDocuments(id).catch(() => []),
    ]);
    setExtras(ex || []);
    setDocuments(docs || []);
  };

  const openDrawer = async (r) => {
    setSelected(r);
    setReturnMode(false);
    setFinance(null);
    setExtras([]); setDocuments([]);
    setError(null); setNotice(null); setDialogError(null);
    setConfirmCancel(false); setConfirmDelete(false);
    setExtraForm({ category: '', description: '', quantity: '1', unit_amount: '' });
    getRentalBillings(r.id).then(setFinance).catch(() => setFinance({ billings: [], summary: null }));
    loadExtrasDocs(r.id);
  };
  const closeDrawer = () => {
    setSelected(null); setFinance(null); setReturnMode(false); setExtras([]); setDocuments([]);
    setError(null); setNotice(null); setDialogError(null);
    setConfirmCancel(false); setConfirmDelete(false);
  };

  // Recarrega a locação (com total recalculado), a lista e o financeiro.
  const refreshSelected = async () => {
    if (!selected) return;
    const fresh = await getRentalById(selected.id).catch(() => null);
    if (fresh) setSelected(fresh);
    getRentalBillings(selected.id).then(setFinance).catch(() => {});
  };

  const refreshAfterAction = async () => {
    await load({ q: searchTerm.length >= 2 ? searchTerm : '' });
    await refreshSelected();
  };

  const doStatus = async (status) => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      await setRentalStatus(selected.id, status);
      await refreshAfterAction();
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doReturn = async () => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      await returnRental(selected.id, returnData);
      setReturnMode(false);
      setReturnData({ return_date: '', return_odometer: '', notes: '', return_inspection: EMPTY_VISTORIA });
      await refreshAfterAction();
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doFaturar = async () => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      await faturarRental(selected.id);
      getRentalBillings(selected.id).then(setFinance).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doRecibo = async () => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      setNotice(null);
      const { receipt, existing } = await generateReceipt(selected.id);
      setNotice(existing ? `Recibo ${receipt.full_number || ''} já existia — abrindo.` : `Recibo ${receipt.full_number} gerado.`);
      window.open(`/api/financial/receipts/${receipt.id}/pdf`, '_blank');
      getRentalBillings(selected.id).then(setFinance).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doContract = async () => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      await generateContract(selected.id).catch(() => {}); // registra versão (auditoria)
      window.open(contractPdfUrl(selected.id), '_blank');
      setNotice('Contrato gerado — abrindo PDF.');
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doCancel = async (reason) => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      setDialogError(null);
      await cancelRental(selected.id, reason);
      setConfirmCancel(false);
      setNotice('Locação cancelada.');
      await refreshAfterAction();
    } catch (err) {
      // Mantém o diálogo aberto e mostra o MOTIVO da recusa ali mesmo.
      setDialogError(err.message);
    } finally { setDrawerBusy(false); }
  };

  const doDelete = async () => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      setDialogError(null);
      await deleteRental(selected.id);
      setConfirmDelete(false);
      closeDrawer();
      await load({ q: searchTerm.length >= 2 ? searchTerm : '' });
    } catch (err) {
      setDialogError(err.message);
    } finally { setDrawerBusy(false); }
  };

  const doAddExtra = async (e) => {
    e.preventDefault();
    if (!selected) return;
    if (!extraForm.unit_amount || Number(extraForm.unit_amount) <= 0) { setError('Informe o valor do adicional.'); return; }
    try {
      setDrawerBusy(true);
      await addRentalExtra(selected.id, {
        category: extraForm.category || 'Outro', description: extraForm.description,
        quantity: extraForm.quantity || 1, unit_amount: extraForm.unit_amount,
      });
      setExtraForm({ category: '', description: '', quantity: '1', unit_amount: '' });
      await loadExtrasDocs(selected.id);
      await refreshSelected();
      await load({ q: searchTerm.length >= 2 ? searchTerm : '' });
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doDeleteExtra = async (extraId) => {
    if (!selected) return;
    try {
      setDrawerBusy(true);
      await deleteRentalExtra(selected.id, extraId);
      await loadExtrasDocs(selected.id);
      await refreshSelected();
      await load({ q: searchTerm.length >= 2 ? searchTerm : '' });
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const doUploadDoc = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !selected) return;
    try {
      setUploading(true);
      setError(null);
      const up = await uploadFile(file);
      await addRentalDocument(selected.id, {
        file_url: up.url, file_name: up.originalName, file_type: up.mimeType, file_size: up.size,
        category: docForm.category, description: docForm.description,
      });
      setDocForm({ category: 'contrato_locacao', description: '' });
      if (fileRef.current) fileRef.current.value = '';
      await loadExtrasDocs(selected.id);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  const doDeleteDoc = async (docId) => {
    if (!selected) return;
    if (!confirm('Remover este documento da locação?')) return;
    try {
      setDrawerBusy(true);
      await deleteRentalDocument(selected.id, docId);
      await loadExtrasDocs(selected.id);
    } catch (err) { setError(err.message); }
    finally { setDrawerBusy(false); }
  };

  const displayed = rentals; // filtro de status já aplicado no backend

  const vehicleLabel = (v) => `${v.brand || ''} ${v.model || ''}${v.plate ? ` — ${v.plate}` : ''}`.trim();

  if (loading && rentals.length === 0) return <PageLoading label="Carregando locações..." />;

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all" onClick={() => onFilterStatus('')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.total ?? rentals.length}</span>
          <span className="summary-label">Total de Locações</span>
        </div>
        <div className="clients-summary-card nego" onClick={() => onFilterStatus('em_andamento')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.em_andamento ?? '—'}</span>
          <span className="summary-label">Em andamento</span>
        </div>
        <div className="clients-summary-card nego" onClick={() => onFilterStatus('atrasado')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.atrasado ?? '—'}</span>
          <span className="summary-label">Atrasadas</span>
        </div>
        <div className="clients-summary-card fechado" onClick={() => onFilterStatus('')} style={{ cursor: 'default' }}>
          <span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(stats?.valor_em_aberto || 0)}</span>
          <span className="summary-label">Valor em aberto</span>
        </div>
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} onRetry={load} />

      <div className="clients-toolbar">
        <div className="clients-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Buscar por nº, cliente ou placa..." value={searchTerm} onChange={handleSearch} className="clients-search-input" />
        </div>
        <div className="clients-filters">
          <select value={filterStatus} onChange={(e) => onFilterStatus(e.target.value)} className="clients-filter-select">
            <option value="">Todos os status</option>
            {RENTAL_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={openNew} className="btn-primary clients-new-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova Locação
        </button>
      </div>

      <div className="clients-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Cliente</th>
              <th>Veículo</th>
              <th>Período</th>
              <th>Total</th>
              <th>Status</th>
              <th style={{ width: 60 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <div className="empty-state" style={{ padding: '40px 0' }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 8 }}>
                      <rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                    <p style={{ color: 'var(--text-muted)' }}>{filterStatus ? `Nenhuma locação ${rentalStatusLabel(filterStatus).toLowerCase()}` : 'Nenhuma locação registrada'}</p>
                  </div>
                </td>
              </tr>
            ) : displayed.map((r) => (
              <tr key={r.id} onClick={() => openDrawer(r)} className="clickable-row">
                <td style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.rental_number || '—'}</td>
                <td><strong style={{ color: 'var(--text-primary)' }}>{r.client_name || '—'}</strong></td>
                <td style={{ color: 'var(--text-secondary)' }}>{r.vehicle_brand ? `${r.vehicle_brand} ${r.vehicle_model || ''}` : '—'}{r.vehicle_plate ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {r.vehicle_plate}</span> : null}</td>
                <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</td>
                <td style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(r.total_amount)}</td>
                <td><span className="client-status-badge" style={rentalStatusStyle(r.status)}>{rentalStatusLabel(r.status)}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="actions-cell">
                    <button onClick={() => openEdit(r)} className="btn-icon" title="Editar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal criar/editar ─────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{editing ? `Editar Locação ${editing.rental_number || ''}` : 'Nova Locação'}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{editing ? 'Atualize os dados da locação' : 'Vincule cliente e veículo e defina o período'}</p>
              </div>
              <button type="button" onClick={closeModal} className="btn-close">✕</button>
            </div>

            {formError && <div className="error-message" style={{ margin: '0 0 12px', fontSize: 13 }}>{formError}</div>}

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Cliente (locatário) *</label>
                  <select value={formData.client_id} onChange={set('client_id')} required>
                    <option value="">Selecione...</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.cpf ? ` — ${c.cpf}` : ''}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Veículo *</label>
                  <select value={formData.vehicle_id} onChange={set('vehicle_id')} required>
                    <option value="">Selecione...</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id} disabled={v.status !== 'disponivel' && v.id !== formData.vehicle_id}>{vehicleLabel(v)}{v.status !== 'disponivel' ? ` (${v.status})` : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Retirada</label><input type="date" value={formData.start_date} onChange={set('start_date')} /></div>
                <div className="form-group"><label>Devolução prevista</label><input type="date" value={formData.end_date} onChange={set('end_date')} /></div>
                <div className="form-group">
                  <label>Diárias</label>
                  {/* Calculado das datas — não é campo editável, então não se
                      disfarça de input vazio. */}
                  <output className="nx-derivado" title="Calculado a partir das datas de retirada e devolução">
                    <strong>{formTotals.days || '—'}</strong>
                    <span>{formTotals.days === 1 ? 'diária' : 'diárias'}</span>
                  </output>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Diária (R$)</label><input type="number" step="0.01" min="0" value={formData.daily_rate} onChange={set('daily_rate')} placeholder="0,00" /></div>
                <div className="form-group"><label>Desconto (R$)</label><input type="number" step="0.01" min="0" value={formData.discount_amount} onChange={set('discount_amount')} placeholder="0,00" /></div>
                <div className="form-group"><label>Caução (R$)</label><input type="number" step="0.01" min="0" value={formData.deposit_amount} onChange={set('deposit_amount')} placeholder="0,00" /></div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Status *</label>
                  <select value={formData.status} onChange={set('status')} required>
                    {RENTAL_STATUS.filter((o) => o.value !== 'atrasado').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Local de retirada</label><input type="text" value={formData.pickup_location} onChange={set('pickup_location')} placeholder="Opcional" /></div>
              </div>

              {/* Resumo do valor: mostra a CONTA, não só o resultado. A caução
                  aparece separada porque é reembolsável — não entra no total. */}
              <div className="nx-resumo">
                <div className="nx-resumo-linhas">
                  <div className="nx-resumo-linha">
                    <span>{formTotals.days || 0} {formTotals.days === 1 ? 'diária' : 'diárias'} × {fmtMoney(formData.daily_rate || 0)}</span>
                    <span>{fmtMoney((Number(formData.daily_rate) || 0) * formTotals.days)}</span>
                  </div>
                  {Number(formData.discount_amount) > 0 && (
                    <div className="nx-resumo-linha nx-resumo-linha--desconto">
                      <span>Desconto</span>
                      <span>− {fmtMoney(formData.discount_amount)}</span>
                    </div>
                  )}
                </div>
                <div className="nx-resumo-total">
                  <span>Total da locação</span>
                  <strong>{fmtMoney(formTotals.total)}</strong>
                </div>
                {Number(formData.deposit_amount) > 0 && (
                  <div className="nx-resumo-nota">
                    + {fmtMoney(formData.deposit_amount)} de caução — cobrada à parte e devolvida na entrega do veículo.
                  </div>
                )}
              </div>

              <div className="form-group"><label>Observações</label><textarea value={formData.notes} onChange={set('notes')} rows={2} placeholder="Anotações sobre a locação..." /></div>

              <VistoriaFields value={formData.pickup_inspection} onChange={(vi) => setFormData((p) => ({ ...p, pickup_inspection: vi }))} />

              <div className="form-actions">
                <button type="button" onClick={closeModal} className="btn-secondary">Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar locação'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Drawer de operação ─────────────────────────────────────────── */}
      <Drawer
        open={!!selected}
        onClose={closeDrawer}
        title={selected ? `Locação ${selected.rental_number || ''}` : ''}
        subtitle={selected ? `${selected.client_name || 'Sem cliente'} · ${selected.vehicle_brand || ''} ${selected.vehicle_model || ''}` : ''}
        headerExtra={selected ? <span className="client-status-badge" style={rentalStatusStyle(selected.status)}>{rentalStatusLabel(selected.status)}</span> : null}
        footer={selected && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={() => { const r = selected; closeDrawer(); openEdit(r); }}>Editar</button>
            <button className="btn-secondary" disabled={drawerBusy} onClick={doContract}>Contrato (PDF)</button>
            {selected.status === 'reservado' && <button className="btn-primary" disabled={drawerBusy} onClick={() => doStatus('em_andamento')}>Iniciar locação</button>}
            {(selected.status === 'em_andamento' || selected.status === 'atrasado') && !returnMode && <button className="btn-primary" disabled={drawerBusy} onClick={() => setReturnMode(true)}>Registrar devolução</button>}
            {selected.status !== 'cancelado' && selected.status !== 'finalizado' && <button className="btn-secondary" disabled={drawerBusy} onClick={() => { setDialogError(null); setConfirmCancel(true); }}>Cancelar locação</button>}
            <button className="btn-secondary" style={{ color: 'var(--nx-red)', borderColor: 'color-mix(in srgb, var(--nx-red) 45%, transparent)' }} disabled={drawerBusy} onClick={() => { setDialogError(null); setConfirmDelete(true); }}>Excluir</button>
          </div>
        )}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Erro de qualquer ação do drawer (devolução, faturar, adicionais…).
                Antes só existia atrás do drawer, então a falha parecia silenciosa. */}
            {error && (
              <div className="error-message" role="alert" style={{ margin: 0, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span>{error}</span>
                <button className="btn-close" onClick={() => setError(null)} aria-label="Fechar">✕</button>
              </div>
            )}
            <div className="nx-form-section">
              <div className="nx-form-section-title">Resumo</div>
              <DetailRow label="Período" value={`${fmtDate(selected.start_date)} → ${fmtDate(selected.end_date)}`} />
              <DetailRow label="Diárias" value={`${selected.days} × ${fmtMoney(selected.daily_rate)}`} />
              {Number(selected.extras_amount) > 0 && <DetailRow label="Adicionais" value={fmtMoney(selected.extras_amount)} />}
              {Number(selected.discount_amount) > 0 && <DetailRow label="Desconto" value={`− ${fmtMoney(selected.discount_amount)}`} />}
              <DetailRow label="Total" value={<strong>{fmtMoney(selected.total_amount)}</strong>} />
              {Number(selected.deposit_amount) > 0 && <DetailRow label="Caução" value={fmtMoney(selected.deposit_amount)} />}
              {selected.return_date && <DetailRow label="Devolvido em" value={fmtDate(selected.return_date)} />}
              {selected.notes && <DetailRow label="Observações" value={selected.notes} />}
            </div>

            {(selected.pickup_inspection || selected.return_inspection) && (
              <div className="nx-form-section">
                <div className="nx-form-section-title">Vistorias</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <VistoriaView data={selected.pickup_inspection} title="Retirada" />
                  <VistoriaView data={selected.return_inspection} title="Devolução" />
                </div>
              </div>
            )}

            {returnMode && (
              <div className="nx-form-section">
                <div className="nx-form-section-title">Registrar devolução</div>
                <div className="form-row">
                  <div className="form-group"><label>Data da devolução</label><input type="date" value={returnData.return_date} onChange={(e) => setReturnData((p) => ({ ...p, return_date: e.target.value }))} /></div>
                  <div className="form-group"><label>KM de devolução</label><input type="number" min="0" value={returnData.return_odometer} onChange={(e) => setReturnData((p) => ({ ...p, return_odometer: e.target.value }))} placeholder="0" /></div>
                </div>
                <div className="form-group"><label>Observações</label><textarea rows={2} value={returnData.notes} onChange={(e) => setReturnData((p) => ({ ...p, notes: e.target.value }))} placeholder="Avarias, combustível, etc." /></div>
                <VistoriaFields value={returnData.return_inspection} onChange={(vi) => setReturnData((p) => ({ ...p, return_inspection: vi }))} />
                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => setReturnMode(false)}>Voltar</button>
                  <button className="btn-primary" disabled={drawerBusy} onClick={doReturn}>Confirmar devolução</button>
                </div>
              </div>
            )}

            {notice && (
              <div style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 38%, transparent)', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{notice}</span>
                <button className="btn-close" onClick={() => setNotice(null)}>✕</button>
              </div>
            )}

            {/* ── Adicionais (extras) ─────────────────────────────────── */}
            {selected.status !== 'cancelado' && (
              <div className="nx-form-section">
                <div className="nx-form-section-title">Adicionais</div>
                {extras.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {extras.map((ex) => (
                      <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--surface-secondary)', borderRadius: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{ex.category || 'Extra'}{Number(ex.quantity) !== 1 ? ` · ${Number(ex.quantity)}×${fmtMoney(ex.unit_amount)}` : ''}{ex.description ? ` — ${ex.description}` : ''}</span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <strong>{fmtMoney(ex.total_amount)}</strong>
                          {selected.status !== 'finalizado' && <button className="btn-icon danger" title="Remover" disabled={drawerBusy} onClick={() => doDeleteExtra(ex.id)}>✕</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {selected.status !== 'finalizado' && (
                  <form onSubmit={doAddExtra} className="form-row" style={{ alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 1.4 }}>
                      <label>Categoria</label>
                      <input list="extra-cats" value={extraForm.category} onChange={(e) => setExtraForm((p) => ({ ...p, category: e.target.value }))} placeholder="Combustível, avaria..." />
                      <datalist id="extra-cats">{extraCats.map((c) => <option key={c} value={c} />)}</datalist>
                    </div>
                    <div className="form-group" style={{ maxWidth: 70 }}><label>Qtd</label><input type="number" min="1" step="1" value={extraForm.quantity} onChange={(e) => setExtraForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
                    <div className="form-group" style={{ maxWidth: 100 }}><label>Valor (R$)</label><input type="number" min="0" step="0.01" value={extraForm.unit_amount} onChange={(e) => setExtraForm((p) => ({ ...p, unit_amount: e.target.value }))} placeholder="0,00" /></div>
                    <button type="submit" className="btn-secondary" disabled={drawerBusy}>Adicionar</button>
                  </form>
                )}
              </div>
            )}

            {/* ── Financeiro ──────────────────────────────────────────── */}
            <div className="nx-form-section">
              <div className="nx-form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Financeiro</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {selected.status !== 'cancelado' && (
                    <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={drawerBusy} onClick={doFaturar}>Faturar</button>
                  )}
                  {finance && finance.billings.length > 0 && (
                    <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} disabled={drawerBusy} onClick={doRecibo}>Gerar recibo</button>
                  )}
                </span>
              </div>
              {!finance ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
              ) : finance.billings.length === 0 ? (
                <EmptyState small title="Sem faturamento" description="Gere um faturamento para esta locação." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {finance.summary && (
                    <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                      <span>Faturado: <strong>{fmtMoney(finance.summary.total_billed)}</strong></span>
                      <span>Recebido: <strong style={{ color: 'var(--success)' }}>{fmtMoney(finance.summary.total_paid)}</strong></span>
                      <span>Pendente: <strong style={{ color: 'var(--warning)' }}>{fmtMoney(finance.summary.total_pending)}</strong></span>
                    </div>
                  )}
                  {finance.billings.map((b) => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-secondary)', borderRadius: 8, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{b.description || 'Faturamento'}</span>
                      <span style={{ fontWeight: 600 }}>{fmtMoney(b.final_amount)} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>({b.financial_status})</span></span>
                    </div>
                  ))}
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>Recebimentos são registrados no módulo Financeiro; o recibo é gerado aqui após o recebimento.</p>
                </div>
              )}
            </div>

            {/* ── Documentos ──────────────────────────────────────────── */}
            <div className="nx-form-section">
              <div className="nx-form-section-title">Documentos</div>
              {documents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {documents.map((d) => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--surface-secondary)', borderRadius: 8, fontSize: 13 }}>
                      <a href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--nx-primary)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {DOC_LABELS[d.category] || d.category || 'Documento'} · {d.file_name}
                      </a>
                      <button className="btn-icon danger" title="Remover" disabled={drawerBusy} onClick={() => doDeleteDoc(d.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1.2 }}>
                  <label>Categoria</label>
                  <select value={docForm.category} onChange={(e) => setDocForm((p) => ({ ...p, category: e.target.value }))}>
                    {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_LABELS[c]}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1.6 }}>
                  <label>Arquivo (PDF/JPG/PNG)</label>
                  <input ref={fileRef} type="file" accept="application/pdf,image/*" disabled={uploading} onChange={doUploadDoc} />
                </div>
              </div>
              {uploading && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Enviando arquivo…</p>}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar locação"
        message="A locação será marcada como cancelada e o veículo liberado. O histórico é preservado. Informe o motivo:"
        confirmLabel="Cancelar locação"
        cancelLabel="Voltar"
        danger
        requireReason
        reasonLabel="Motivo do cancelamento"
        busy={drawerBusy}
        error={dialogError}
        onConfirm={doCancel}
        onClose={() => { setConfirmCancel(false); setDialogError(null); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir locação"
        message="A locação será removida definitivamente. Faturamentos ainda não pagos são cancelados junto; se já houve pagamento, estorne no Financeiro antes. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        cancelLabel="Voltar"
        danger
        busy={drawerBusy}
        error={dialogError}
        onConfirm={doDelete}
        onClose={() => { setConfirmDelete(false); setDialogError(null); }}
      />
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 13.5, borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
