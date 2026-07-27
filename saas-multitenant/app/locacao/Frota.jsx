'use client';

import { useState, useEffect, useRef } from 'react';
import {
  getVehicles, getFleetStats, createVehicle, updateVehicle, deleteVehicle,
} from '../lib/vehiclesAPI';
import { getOptions, createOption, updateOption } from '../lib/configOptionsAPI';
import {
  VEHICLE_STATUS, vehicleStatusLabel, vehicleStatusStyle, fmtMoney, maskPlate,
} from './shared';

const EMPTY_FORM = {
  plate: '', brand: '', model: '', year: '', color: '', category: '',
  renavam: '', chassi: '', fuel: '', transmission: '',
  daily_rate: '', odometer: '', status: 'disponivel', notes: '',
};

export default function Frota() {
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState(null);
  const searchDebounce = useRef(null);

  // Categorias parametrizáveis por tenant (§8)
  const [categories, setCategories] = useState([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const isAdmin = (() => {
    if (typeof window === 'undefined') return false;
    try { return JSON.parse(localStorage.getItem('user') || '{}').role === 'admin'; } catch { return false; }
  })();

  useEffect(() => { load(); loadCategories(); }, []);

  const loadCategories = async (all = false) => {
    try { setCategories(await getOptions('vehicle_category', { all })); } catch { /* opcional */ }
  };

  const load = async (q = '') => {
    try {
      setLoading(true);
      setError(null);
      const [list, s] = await Promise.all([getVehicles({ q }), getFleetStats().catch(() => null)]);
      setVehicles(list || []);
      setStats(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    try { setCatBusy(true); await createOption('vehicle_category', newCat.trim()); setNewCat(''); await loadCategories(true); }
    catch (err) { setError(err.message); }
    finally { setCatBusy(false); }
  };
  const toggleCategory = async (c) => {
    try { setCatBusy(true); await updateOption(c.id, { active: !c.active }); await loadCategories(true); }
    catch (err) { setError(err.message); }
    finally { setCatBusy(false); }
  };

  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (term.length >= 2) load(term);
      else if (term.length === 0) load();
    }, 300);
  };

  const validateForm = () => {
    if (!formData.brand.trim()) return 'Marca é obrigatória.';
    if (!formData.model.trim()) return 'Modelo é obrigatório.';
    if (formData.daily_rate !== '' && Number(formData.daily_rate) < 0) return 'Diária não pode ser negativa.';
    if (formData.year && (Number(formData.year) < 1900 || Number(formData.year) > new Date().getFullYear() + 1)) return 'Ano inválido.';
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
        year: formData.year || null,
        daily_rate: formData.daily_rate || 0,
        odometer: formData.odometer || 0,
      };
      if (editing) await updateVehicle(editing.id, payload);
      else         await createVehicle(payload);
      closeModal();
      load(searchTerm.length >= 2 ? searchTerm : '');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => { setShowModal(false); setEditing(null); setFormData(EMPTY_FORM); setFormError(null); };

  const openEdit = (e, v) => {
    e.stopPropagation();
    setEditing(v);
    setFormData({
      plate: v.plate || '', brand: v.brand || '', model: v.model || '', year: v.year || '',
      color: v.color || '', category: v.category || '', renavam: v.renavam || '', chassi: v.chassi || '',
      fuel: v.fuel || '', transmission: v.transmission || '',
      daily_rate: v.daily_rate ?? '', odometer: v.odometer ?? '', status: v.status || 'disponivel', notes: v.notes || '',
    });
    setShowModal(true);
  };

  const openNew = () => { setEditing(null); setFormData(EMPTY_FORM); setShowModal(true); };

  const handleDelete = async (e, v) => {
    e.stopPropagation();
    if (!confirm(`Excluir o veículo ${v.brand} ${v.model}${v.plate ? ` (${v.plate})` : ''}? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteVehicle(v.id);
      load(searchTerm.length >= 2 ? searchTerm : '');
    } catch (err) {
      setError(err.message); // ex.: veículo com locação ativa → oriente inativar
    }
  };

  const set = (field) => (e) => {
    let value = e.target.value;
    if (field === 'plate') value = maskPlate(value);
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const displayed = vehicles.filter((v) => !filterStatus || (v.status || 'disponivel') === filterStatus);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: 'var(--nx-primary)' }} />
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando frota...</p>
    </div>
  );

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all" onClick={() => setFilterStatus('')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.total ?? vehicles.length}</span>
          <span className="summary-label">Total da Frota</span>
        </div>
        <div className="clients-summary-card fechado" onClick={() => setFilterStatus('disponivel')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.disponivel ?? '—'}</span>
          <span className="summary-label">Disponíveis</span>
        </div>
        <div className="clients-summary-card nego" onClick={() => setFilterStatus('alugado')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.alugado ?? '—'}</span>
          <span className="summary-label">Alugados</span>
        </div>
        <div className="clients-summary-card nego" onClick={() => setFilterStatus('manutencao')} style={{ cursor: 'pointer' }}>
          <span className="summary-number">{stats?.manutencao ?? '—'}</span>
          <span className="summary-label">Em manutenção</span>
        </div>
      </div>

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ margin: 0 }}>{error}</p>
          <button onClick={() => setError(null)} className="btn-close">✕</button>
        </div>
      )}

      <div className="clients-toolbar">
        <div className="clients-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Buscar por placa, marca, modelo ou categoria..." value={searchTerm} onChange={handleSearch} className="clients-search-input" />
        </div>
        <div className="clients-filters">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="clients-filter-select">
            <option value="">Todos os status</option>
            {VEHICLE_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {isAdmin && (
          <button onClick={() => { setShowCatModal(true); loadCategories(true); }} className="btn-secondary" title="Gerenciar categorias">
            Categorias
          </button>
        )}
        <button onClick={openNew} className="btn-primary clients-new-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Veículo
        </button>
      </div>

      <div className="clients-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Veículo</th>
              <th>Placa</th>
              <th>Categoria</th>
              <th>Diária</th>
              <th>KM</th>
              <th>Status</th>
              <th style={{ width: 80 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <div className="empty-state" style={{ padding: '40px 0' }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{ marginBottom: 8 }}>
                      <path d="M5 17H3v-6l2-5h11l4 5h1a2 2 0 0 1 2 2v4h-2" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="17.5" cy="17.5" r="1.5" />
                    </svg>
                    <p style={{ color: '#94a3b8' }}>{filterStatus ? `Nenhum veículo ${vehicleStatusLabel(filterStatus).toLowerCase()}` : 'Nenhum veículo cadastrado'}</p>
                  </div>
                </td>
              </tr>
            ) : displayed.map((v) => (
              <tr key={v.id} onClick={(e) => openEdit(e, v)} className="clickable-row">
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(165, 107, 255, 0.1)', color: 'var(--nx-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {(v.brand || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: '#0f172a', display: 'block' }}>{v.brand} {v.model}</strong>
                      {v.year && <span style={{ fontSize: 12, color: '#94a3b8' }}>{v.year}{v.color ? ` · ${v.color}` : ''}</span>}
                    </div>
                  </div>
                </td>
                <td style={{ color: '#475569', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'nowrap' }}>{v.plate || '—'}</td>
                <td style={{ color: '#475569' }}>{v.category || '—'}</td>
                <td style={{ color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(v.daily_rate)}</td>
                <td style={{ color: '#475569', whiteSpace: 'nowrap' }}>{v.odometer != null ? Number(v.odometer).toLocaleString('pt-BR') : '—'}</td>
                <td><span className="client-status-badge" style={vehicleStatusStyle(v.status)}>{vehicleStatusLabel(v.status)}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="actions-cell">
                    <button onClick={(e) => openEdit(e, v)} className="btn-icon" title="Editar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button onClick={(e) => handleDelete(e, v)} className="btn-icon danger" title="Excluir">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{editing ? 'Editar Veículo' : 'Novo Veículo'}</h2>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{editing ? 'Atualize os dados do veículo' : 'Cadastre um veículo na frota'}</p>
              </div>
              <button type="button" onClick={closeModal} className="btn-close">✕</button>
            </div>

            {formError && <div className="error-message" style={{ margin: '0 0 12px', fontSize: 13 }}>{formError}</div>}

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Marca *</label><input type="text" value={formData.brand} onChange={set('brand')} placeholder="Ex.: Fiat" required /></div>
                <div className="form-group"><label>Modelo *</label><input type="text" value={formData.model} onChange={set('model')} placeholder="Ex.: Argo" required /></div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Placa</label><input type="text" value={formData.plate} onChange={set('plate')} placeholder="ABC1D23" inputMode="text" /></div>
                <div className="form-group"><label>Ano</label><input type="number" value={formData.year} onChange={set('year')} placeholder="2024" /></div>
                <div className="form-group"><label>Cor</label><input type="text" value={formData.color} onChange={set('color')} placeholder="Prata" /></div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Categoria</label>
                  <input type="text" list="veh-cats" value={formData.category} onChange={set('category')} placeholder="Hatch, Sedã, SUV..." />
                  <datalist id="veh-cats">{categories.map((c) => <option key={c.id} value={c.value} />)}</datalist>
                </div>
                <div className="form-group"><label>Combustível</label><input type="text" value={formData.fuel} onChange={set('fuel')} placeholder="Flex" /></div>
                <div className="form-group"><label>Câmbio</label>
                  <select value={formData.transmission} onChange={set('transmission')}>
                    <option value="">—</option>
                    <option value="manual">Manual</option>
                    <option value="automatico">Automático</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>Diária (R$)</label><input type="number" step="0.01" min="0" value={formData.daily_rate} onChange={set('daily_rate')} placeholder="0,00" /></div>
                <div className="form-group"><label>KM atual</label><input type="number" min="0" value={formData.odometer} onChange={set('odometer')} placeholder="0" /></div>
                <div className="form-group"><label>Status *</label>
                  <select value={formData.status} onChange={set('status')} required>
                    {VEHICLE_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group"><label>RENAVAM</label><input type="text" value={formData.renavam} onChange={set('renavam')} placeholder="Opcional" /></div>
                <div className="form-group"><label>Chassi</label><input type="text" value={formData.chassi} onChange={set('chassi')} placeholder="Opcional" /></div>
              </div>

              <div className="form-group"><label>Observações</label><textarea value={formData.notes} onChange={set('notes')} rows={3} placeholder="Anotações sobre o veículo..." /></div>

              <div className="form-actions">
                <button type="button" onClick={closeModal} className="btn-secondary">Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar veículo'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCatModal && (
        <div className="modal-overlay" onClick={() => setShowCatModal(false)}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Categorias de veículo</h2>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Parametrizadas por empresa. Desativar preserva os veículos existentes.</p>
              </div>
              <button type="button" onClick={() => setShowCatModal(false)} className="btn-close">✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input type="text" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" style={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
              <button className="btn-primary" disabled={catBusy || !newCat.trim()} onClick={addCategory}>Adicionar</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {categories.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma categoria.</p>}
              {categories.map((c) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 13, opacity: c.active ? 1 : 0.55 }}>
                  <span>{c.value}{!c.active && <em style={{ color: '#94a3b8' }}> (inativa)</em>}</span>
                  <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} disabled={catBusy} onClick={() => toggleCategory(c)}>
                    {c.active ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
