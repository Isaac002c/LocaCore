'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getTransactions, createTransaction, updateTransaction, cancelTransaction, getCategories,
  TRANSACTION_STATUS, TRANSACTION_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '../../lib/financialAPI';
import {
  formatBRL, formatDate, isAdmin, AccessDenied, StatusBadge, Feedback,
  maskMoney, moneyToNumber, numberToMask, toInputDate,
} from './financeShared';
import {
  PageHead, ConfirmDialog, Pagination, SkeletonRows, EmptyState, FormSection,
} from '../../components/ui';

const EMPTY = {
  type: 'entrada', category_id: '', description: '', amount: '',
  transaction_date: new Date().toISOString().substring(0, 10), due_date: '',
  payment_method: '', status: 'pago', notes: '',
};

export default function Lancamentos() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [filters, setFilters] = useState({ type: '', category_id: '', status: '', page: 1 });

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null); // lançamento a cancelar
  const [busyCancel, setBusyCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await getTransactions({ ...filters, limit: 20 });
      setRows(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => {
    if (!isAdmin()) { setLoading(false); return; }
    getCategories({ active: true }).then(setCategories).catch(() => {});
  }, []);
  useEffect(() => { if (isAdmin()) load(); }, [load]);

  if (!isAdmin()) return <AccessDenied />;

  const setFilter = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value, page: 1 }));
  const set = (k) => (e) => {
    let v = e.target.value;
    if (k === 'amount') v = maskMoney(v);
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (k === 'type') next.category_id = ''; // reset categoria ao trocar tipo
      return next;
    });
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setFormError(null); setShowModal(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({
      type: t.type, category_id: t.category_id || '', description: t.description || '',
      amount: numberToMask(t.amount), transaction_date: toInputDate(t.transaction_date),
      due_date: toInputDate(t.due_date), payment_method: t.payment_method || '',
      status: t.status, notes: t.notes || '',
    });
    setFormError(null); setShowModal(true);
  };
  const close = () => { setShowModal(false); setEditing(null); setForm(EMPTY); setFormError(null); };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.type) return setFormError('Selecione o tipo.');
    if (moneyToNumber(form.amount) <= 0) return setFormError('Informe um valor válido.');
    try {
      setSaving(true);
      const payload = { ...form, amount: moneyToNumber(form.amount) };
      if (editing) await updateTransaction(editing.id, payload);
      else await createTransaction(payload);
      close();
      setFeedback({ type: 'success', message: editing ? 'Lançamento atualizado.' : 'Lançamento criado.' });
      load();
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  const doCancel = async () => {
    try {
      setBusyCancel(true);
      await cancelTransaction(confirmCancel.id);
      setConfirmCancel(null);
      setFeedback({ type: 'success', message: 'Lançamento cancelado — preservado no histórico.' });
      load();
    } catch (err) { setError(err.message); setConfirmCancel(null); }
    finally { setBusyCancel(false); }
  };

  const cats = categories.filter((c) => !form.type || c.type === form.type);

  return (
    <div className="clients-page">
      <Feedback {...(feedback || {})} onClose={() => setFeedback(null)} />

      <PageHead
        title="Lançamentos"
        subtitle="Entradas e saídas — lançamentos automáticos (de pagamentos) são estornados pelo pagamento"
        actions={<button onClick={openNew} className="btn-primary">+ Novo lançamento</button>}
      />

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span>{error}</span><button onClick={() => setError(null)} className="btn-close">✕</button>
        </div>
      )}

      <div className="clients-toolbar">
        <div className="clients-filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select value={filters.type} onChange={setFilter('type')} className="clients-filter-select">
            <option value="">Todos os tipos</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
          </select>
          <select value={filters.category_id} onChange={setFilter('category_id')} className="clients-filter-select">
            <option value="">Todas as categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
          <select value={filters.status} onChange={setFilter('status')} className="clients-filter-select">
            <option value="">Todos os status</option>
            {TRANSACTION_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? <SkeletonRows rows={6} height={52} /> : rows.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento encontrado"
          description="Registre entradas e saídas manualmente, ou confirme pagamentos para gerar entradas automáticas."
          actionLabel="Criar lançamento"
          onAction={openNew}
        />
      ) : (
        <>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th>
                  <th>Forma</th><th>Status</th><th>Origem</th>
                  <th style={{ textAlign: 'right' }}>Valor</th><th style={{ width: 80 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ opacity: t.status === 'cancelado' ? 0.55 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.transaction_date)}</td>
                    <td><span style={{ color: t.type === 'entrada' ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{t.type === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
                    <td style={{ color: '#475569' }}>{t.category_name || '—'}</td>
                    <td style={{ color: '#475569' }}>{t.description || '—'}</td>
                    <td style={{ color: '#475569' }}>{PAYMENT_METHOD_LABELS[t.payment_method] || '—'}</td>
                    <td><StatusBadge status={t.status} label={TRANSACTION_STATUS_LABELS[t.status]} /></td>
                    <td><span style={{ fontSize: 11, color: '#94a3b8' }}>{t.origin === 'pagamento' ? 'Automático' : 'Manual'}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: t.type === 'entrada' ? '#15803d' : '#b91c1c' }}>{formatBRL(t.amount)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="actions-cell">
                        {t.origin === 'manual' && t.status !== 'cancelado' && (
                          <button onClick={() => openEdit(t)} className="btn-icon" title="Editar" aria-label="Editar lançamento">✎</button>
                        )}
                        {t.origin === 'manual' && t.status !== 'cancelado' && (
                          <button onClick={() => setConfirmCancel(t)} className="btn-icon danger" title="Cancelar" aria-label="Cancelar lançamento">✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total}
            onPage={(page) => setFilters((p) => ({ ...p, page }))} />
        </>
      )}

      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancelar lançamento"
        message={confirmCancel ? `Cancelar o lançamento "${confirmCancel.description || confirmCancel.category_name || ''}" de ${formatBRL(confirmCancel.amount)}? O registro será preservado no histórico.` : ''}
        confirmLabel="Cancelar lançamento"
        danger
        busy={busyCancel}
        onConfirm={doCancel}
        onClose={() => setConfirmCancel(null)}
      />

      {showModal && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
              <button type="button" onClick={close} className="btn-close">✕</button>
            </div>
            {formError && <div className="error-message" style={{ margin: '0 0 12px', fontSize: 13 }} role="alert">{formError}</div>}
            <form onSubmit={submit} className="modal-form">
              <FormSection title="Identificação">
                <div className="form-row">
                  <div className="form-group">
                    <label>Tipo <span className="nx-required">*</span></label>
                    <select value={form.type} onChange={set('type')} required>
                      <option value="entrada">Entrada</option>
                      <option value="saida">Saída</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Categoria</label>
                    <select value={form.category_id} onChange={set('category_id')}>
                      <option value="">Sem categoria</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <div className="nx-help">Somente categorias do tipo selecionado.</div>
                  </div>
                </div>
                <div className="form-group">
                  <label>Descrição</label>
                  <input type="text" value={form.description} onChange={set('description')} placeholder="Ex.: Aluguel do escritório" />
                </div>
              </FormSection>

              <FormSection title="Valores e datas">
                <div className="form-row">
                  <div className="form-group">
                    <label>Valor (R$) <span className="nx-required">*</span></label>
                    <input type="text" inputMode="numeric" value={form.amount} onChange={set('amount')} placeholder="0,00" required />
                  </div>
                  <div className="form-group">
                    <label>Data do lançamento</label>
                    <input type="date" value={form.transaction_date} onChange={set('transaction_date')} />
                  </div>
                  <div className="form-group">
                    <label>Vencimento</label>
                    <input type="date" value={form.due_date} onChange={set('due_date')} />
                  </div>
                </div>
              </FormSection>

              <FormSection title="Pagamento">
                <div className="form-row">
                  <div className="form-group">
                    <label>Forma de pagamento</label>
                    <select value={form.payment_method} onChange={set('payment_method')}>
                      <option value="">—</option>
                      {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={form.status} onChange={set('status')}>
                      {TRANSACTION_STATUS.filter((s) => s.value !== 'cancelado').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </FormSection>

              <FormSection title="Observações">
                <div className="form-group">
                  <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Informações complementares (opcional)" aria-label="Observações" />
                </div>
              </FormSection>

              <div className="form-actions">
                <button type="button" onClick={close} className="btn-secondary">Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar lançamento'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
