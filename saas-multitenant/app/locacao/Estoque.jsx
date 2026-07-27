'use client';

import { useState, useEffect } from 'react';
import { getItems, getInventoryDashboard, createItem, updateItem, deleteItem, createMovement, exportItemsUrl } from '../lib/inventoryAPI';
import { fmtMoney } from './shared';

const MOV_TYPES = [
  ['entrada', 'Entrada'], ['saida', 'Saída'], ['ajuste_pos', 'Ajuste +'], ['ajuste_neg', 'Ajuste −'],
  ['devolucao', 'Devolução'], ['consumo', 'Consumo'], ['perda', 'Perda'],
];
const EMPTY = { name: '', code: '', category: '', unit: 'un', quantity: '', min_quantity: '', unit_cost: '', location: '' };
const EMPTY_MOV = { type: 'entrada', quantity: '', unit_cost: '', reason: '' };

export default function Estoque() {
  const [items, setItems] = useState([]);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [movItem, setMovItem] = useState(null);
  const [mov, setMov] = useState(EMPTY_MOV);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    try { setLoading(true); setError(null); const [it, d] = await Promise.all([getItems(search ? { q: search } : {}), getInventoryDashboard().catch(() => null)]); setItems(it || []); setDash(d); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setM = (k) => (e) => setMov((m) => ({ ...m, [k]: e.target.value }));
  const openNew = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (i) => { setEditing(i); setForm({ ...EMPTY, ...i }); setModal(true); };
  const submit = async (e) => { e.preventDefault(); try { setSaving(true); if (editing) await updateItem(editing.id, form); else await createItem(form); setModal(false); await load(); } catch (err) { setError(err.message); } finally { setSaving(false); } };
  const submitMov = async (e) => {
    e.preventDefault();
    if (!mov.quantity || Number(mov.quantity) <= 0) { setError('Quantidade inválida.'); return; }
    try { setSaving(true); await createMovement({ item_id: movItem.id, ...mov }); setMovItem(null); setMov(EMPTY_MOV); await load(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const remove = async (i) => { if (!confirm(`Excluir ${i.name}?`)) return; try { await deleteItem(i.id); await load(); } catch (err) { setError(err.message); } };

  const displayed = items.filter((i) => !search || (i.name + ' ' + (i.code || '')).toLowerCase().includes(search.toLowerCase()));

  if (loading && items.length === 0) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}><div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: 'var(--nx-primary)' }} /><p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando estoque...</p></div>;

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all"><span className="summary-number">{dash?.total_itens ?? items.length}</span><span className="summary-label">Itens</span></div>
        <div className="clients-summary-card nego"><span className="summary-number">{dash?.abaixo_minimo ?? '—'}</span><span className="summary-label">Abaixo do mínimo</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(dash?.valor_estimado || 0)}</span><span className="summary-label">Valor estimado</span></div>
      </div>

      {error && <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span>{error}</span><button className="btn-close" onClick={() => setError(null)}>✕</button></div>}

      <div className="clients-toolbar">
        <div className="clients-search"><input type="text" placeholder="Buscar item..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} className="clients-search-input" /></div>
        <button className="btn-secondary" onClick={() => window.open(exportItemsUrl(), '_blank')}>Exportar CSV</button>
        <button onClick={openNew} className="btn-primary clients-new-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Novo Item</button>
      </div>

      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Item</th><th>Categoria</th><th>Quantidade</th><th>Mínimo</th><th>Custo unit.</th><th>Local</th><th style={{ width: 180 }}>Ações</th></tr></thead>
        <tbody>
          {displayed.length === 0 ? <tr><td colSpan="7"><div className="empty-state" style={{ padding: '40px 0' }}><p style={{ color: '#94a3b8' }}>Nenhum item cadastrado</p></div></td></tr> : displayed.map((i) => {
            const low = Number(i.quantity) <= Number(i.min_quantity);
            return (
              <tr key={i.id}>
                <td><strong>{i.name}</strong>{i.code && <span style={{ color: '#94a3b8', fontSize: 12 }}> · {i.code}</span>}{!i.active && <em style={{ color: '#94a3b8' }}> (inativo)</em>}</td>
                <td>{i.category || '—'}</td>
                <td style={{ fontWeight: 600, color: low ? '#b91c1c' : '#0f172a' }}>{Number(i.quantity)} {i.unit}</td>
                <td>{Number(i.min_quantity)}</td>
                <td>{fmtMoney(i.unit_cost)}</td>
                <td>{i.location || '—'}</td>
                <td><div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => { setMovItem(i); setMov(EMPTY_MOV); }}>Movimentar</button>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(i)}>Editar</button>
                  <button className="btn-icon danger" title="Excluir" onClick={() => remove(i)}>✕</button>
                </div></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? 'Editar Item' : 'Novo Item'}</h2><button className="btn-close" onClick={() => setModal(false)}>✕</button></div>
            <form onSubmit={submit} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Nome *</label><input type="text" value={form.name} onChange={set('name')} required /></div>
                <div className="form-group"><label>Código</label><input type="text" value={form.code} onChange={set('code')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Categoria</label><input type="text" value={form.category} onChange={set('category')} /></div>
                <div className="form-group"><label>Unidade</label><input type="text" value={form.unit} onChange={set('unit')} placeholder="un, L, kg" /></div>
                <div className="form-group"><label>Local</label><input type="text" value={form.location} onChange={set('location')} /></div>
              </div>
              <div className="form-row">
                {!editing && <div className="form-group"><label>Qtd. inicial</label><input type="number" step="0.001" value={form.quantity} onChange={set('quantity')} /></div>}
                <div className="form-group"><label>Estoque mínimo</label><input type="number" step="0.001" min="0" value={form.min_quantity} onChange={set('min_quantity')} /></div>
                <div className="form-group"><label>Custo unit. (R$)</label><input type="number" step="0.01" min="0" value={form.unit_cost} onChange={set('unit_cost')} /></div>
              </div>
              {editing && <p style={{ fontSize: 12, color: '#94a3b8' }}>A quantidade é alterada apenas por movimentações.</p>}
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar' : 'Cadastrar'}</button></div>
            </form>
          </div>
        </div>
      )}

      {movItem && (
        <div className="modal-overlay" onClick={() => setMovItem(null)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div><h2 style={{ fontSize: 18, fontWeight: 700 }}>Movimentar estoque</h2><p style={{ fontSize: 12, color: '#94a3b8' }}>{movItem.name} — saldo {Number(movItem.quantity)} {movItem.unit}</p></div><button className="btn-close" onClick={() => setMovItem(null)}>✕</button></div>
            <form onSubmit={submitMov} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Tipo</label><select value={mov.type} onChange={setM('type')}>{MOV_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div className="form-group"><label>Quantidade</label><input type="number" step="0.001" min="0.001" value={mov.quantity} onChange={setM('quantity')} required /></div>
                <div className="form-group"><label>Custo unit. (R$)</label><input type="number" step="0.01" min="0" value={mov.unit_cost} onChange={setM('unit_cost')} placeholder="opcional" /></div>
              </div>
              <div className="form-group"><label>Motivo</label><input type="text" value={mov.reason} onChange={setM('reason')} placeholder="Compra, uso em manutenção..." /></div>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setMovItem(null)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Registrando...' : 'Registrar'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
