'use client';

import { useState, useEffect } from 'react';
import { getUsers, getRoles, createUser, updateUser, deleteUser, changePassword, setUserActive } from '../lib/usersAPI';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' };
const roleLabel = (r) => ROLE_LABELS[r] || r;
const roleStyle = (r) => ({
  admin: { bg: '#ede9fe', text: '#6d28d9' }, manager: { bg: '#dbeafe', text: 'var(--nx-primary-hover)' },
  operator: { bg: '#dcfce7', text: '#15803d' }, viewer: { bg: '#f1f5f9', text: '#475569' },
}[r] || { bg: '#f1f5f9', text: '#475569' });

const EMPTY = { name: '', email: '', password: '', role: 'viewer' };

export default function Usuarios() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [pwUser, setPwUser] = useState(null);
  const [pw, setPw] = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      setLoading(true); setError(null);
      const [u, r] = await Promise.all([getUsers(), getRoles().catch(() => ({ data: [] }))]);
      setUsers(u.data || []); setRoles(r.data || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const openNew = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (u) => { setEditing(u); setForm({ name: u.name || '', email: u.email || '', password: '', role: u.role || 'viewer' }); setModal(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editing) await updateUser(editing.id, { name: form.name, email: form.email, role: form.role });
      else await createUser(form);
      setModal(false); await load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const toggleActive = async (u) => {
    const next = u.is_active === false;
    if (!next && !confirm(`Desativar ${u.name}? As sessões ativas serão encerradas.`)) return;
    try { await setUserActive(u.id, next); await load(); } catch (err) { setError(err.message); }
  };

  const remove = async (u) => {
    if (!confirm(`Excluir ${u.name}? Esta ação não pode ser desfeita.`)) return;
    try { await deleteUser(u.id); await load(); } catch (err) { setError(err.message); }
  };

  const submitPw = async (e) => {
    e.preventDefault();
    if (!pw || pw.length < 6) { setError('A senha deve ter ao menos 6 caracteres.'); return; }
    try { setSaving(true); await changePassword(pwUser.id, pw); setPwUser(null); setPw(''); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const total = users.length;
  const active = users.filter((u) => u.is_active !== false).length;

  if (loading && users.length === 0) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}><div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: 'var(--nx-primary)' }} /><p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando usuários...</p></div>;

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all"><span className="summary-number">{total}</span><span className="summary-label">Usuários</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number">{active}</span><span className="summary-label">Ativos</span></div>
        <div className="clients-summary-card nego"><span className="summary-number">{total - active}</span><span className="summary-label">Inativos</span></div>
      </div>

      {error && <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span>{error}</span><button className="btn-close" onClick={() => setError(null)}>✕</button></div>}

      <div className="clients-toolbar">
        <div style={{ flex: 1 }} />
        <button onClick={openNew} className="btn-primary clients-new-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Novo Usuário</button>
      </div>

      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Status</th><th style={{ width: 260 }}>Ações</th></tr></thead>
        <tbody>
          {users.length === 0 ? <tr><td colSpan="5"><div className="empty-state" style={{ padding: '40px 0' }}><p style={{ color: '#94a3b8' }}>Nenhum usuário</p></div></td></tr> : users.map((u) => {
            const rs = roleStyle(u.role); const inactive = u.is_active === false;
            return (
              <tr key={u.id} style={inactive ? { opacity: 0.6 } : undefined}>
                <td><strong>{u.name}</strong></td>
                <td>{u.email}</td>
                <td><span style={{ fontSize: 12, fontWeight: 700, color: rs.text, background: rs.bg, padding: '3px 9px', borderRadius: 999 }}>{roleLabel(u.role)}</span></td>
                <td><span style={{ fontSize: 12, fontWeight: 700, color: inactive ? '#b91c1c' : '#15803d', background: inactive ? '#fee2e2' : '#dcfce7', padding: '3px 9px', borderRadius: 999 }}>{inactive ? 'Inativo' : 'Ativo'}</span></td>
                <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(u)}>Editar</button>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => { setPwUser(u); setPw(''); }}>Senha</button>
                  <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => toggleActive(u)}>{inactive ? 'Reativar' : 'Desativar'}</button>
                  <button className="btn-icon danger" title="Excluir" onClick={() => remove(u)}>✕</button>
                </div></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? 'Editar Usuário' : 'Novo Usuário'}</h2><button className="btn-close" onClick={() => setModal(false)}>✕</button></div>
            <form onSubmit={submit} className="modal-form">
              <div className="form-group"><label>Nome *</label><input type="text" value={form.name} onChange={set('name')} required autoFocus /></div>
              <div className="form-group"><label>E-mail *</label><input type="email" value={form.email} onChange={set('email')} required /></div>
              {!editing && <div className="form-group"><label>Senha *</label><input type="password" value={form.password} onChange={set('password')} required minLength={6} placeholder="Mínimo 6 caracteres" /></div>}
              <div className="form-group"><label>Função *</label>
                <select value={form.role} onChange={set('role')} required>
                  {(roles.length ? roles.map((r) => r.name) : ['admin', 'manager', 'operator', 'viewer']).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </div>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}</button></div>
            </form>
          </div>
        </div>
      )}

      {pwUser && (
        <div className="modal-overlay" onClick={() => setPwUser(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div><h2 style={{ fontSize: 18, fontWeight: 700 }}>Redefinir senha</h2><p style={{ fontSize: 12, color: '#94a3b8' }}>{pwUser.name} — encerra as sessões ativas</p></div><button className="btn-close" onClick={() => setPwUser(null)}>✕</button></div>
            <form onSubmit={submitPw} className="modal-form">
              <div className="form-group"><label>Nova senha *</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoFocus placeholder="Mínimo 6 caracteres" /></div>
              <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => setPwUser(null)}>Cancelar</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Redefinir'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
