'use client';

import { useState, useEffect } from 'react';
import { getUsers, getRoles, createUser, updateUser, deleteUser, changePassword, setUserActive } from '../lib/usersAPI';
import { PageLoading, InlineError, EmptyState } from '../components/states';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' };
const roleLabel = (r) => ROLE_LABELS[r] || r;
const roleStyle = (r) => ({
  admin: { bg: 'var(--primary-soft)', text: 'var(--primary)' }, manager: { bg: 'color-mix(in srgb, var(--info) 16%, transparent)', text: 'var(--info)' },
  operator: { bg: 'color-mix(in srgb, var(--success) 16%, transparent)', text: 'var(--success)' }, viewer: { bg: 'var(--surface-hover)', text: 'var(--text-secondary)' },
}[r] || { bg: 'var(--surface-hover)', text: 'var(--text-secondary)' });

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
  const [seats, setSeats] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      setLoading(true); setError(null);
      const [u, r] = await Promise.all([getUsers(), getRoles().catch(() => ({ data: [] }))]);
      setUsers(u.data || []); setRoles(r.data || []); setSeats(u.seats || null);
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

  if (loading && users.length === 0) return <PageLoading label="Carregando usuários..." />;

  return (
    <div className="clients-page">
      <div className="clients-summary">
        <div className="clients-summary-card all"><span className="summary-number">{total}</span><span className="summary-label">Usuários</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number">{active}</span><span className="summary-label">Ativos</span></div>
        <div className="clients-summary-card nego"><span className="summary-number">{total - active}</span><span className="summary-label">Inativos</span></div>
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} onRetry={load} />

      <div className="clients-toolbar">
        <div style={{ flex: 1 }} />
        <button
          onClick={openNew}
          className="btn-primary clients-new-btn"
          disabled={seats ? !seats.can_create : false}
          title={seats && !seats.can_create ? `Limite de ${seats.limit} usuários atingido` : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Novo Usuário
        </button>
      </div>

      {seats && (
        <div className="nx-seats" role="status">
          <span className="nx-seats-num">{seats.used}/{seats.limit}</span>
          <span className="nx-seats-txt">
            {seats.can_create
              ? `usuários da sua empresa · ${seats.available} vaga(s) disponível(is)`
              : 'usuários — limite atingido. Exclua um usuário para liberar uma vaga.'}
            {seats.protected_accounts > 0 && ' · a conta de suporte da TELUN não ocupa vaga.'}
          </span>
        </div>
      )}

      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Status</th><th>Último acesso</th><th style={{ width: 260 }}>Ações</th></tr></thead>
        <tbody>
          {users.length === 0 ? <tr><td colSpan="6"><EmptyState
              title="Nenhum usuário cadastrado"
              description="Cadastre a equipe da locadora e defina o perfil de cada pessoa. O perfil controla o que cada um enxerga e pode fazer."
            /></td></tr> : users.map((u) => {
            const rs = roleStyle(u.role); const inactive = u.is_active === false;
            // Conta de suporte do fornecedor: visível, porém imutável para o cliente.
            const protegida = u.is_protected === true;
            return (
              <tr key={u.id} style={inactive ? { opacity: 0.6 } : undefined}>
                <td>
                  <strong>{u.name}</strong>
                  {protegida && <span className="nx-tag-suporte" title="Conta de suporte da TELUN — não ocupa vaga e não pode ser alterada">Suporte TELUN</span>}
                  {u.must_change_password && !protegida && <span className="nx-tag-pendente" title="Ainda não definiu a própria senha">senha provisória</span>}
                </td>
                <td>{u.email}</td>
                <td><span style={{ fontSize: 12, fontWeight: 700, color: rs.text, background: rs.bg, padding: '3px 9px', borderRadius: 999 }}>{roleLabel(u.role)}</span></td>
                <td><span style={{ fontSize: 12, fontWeight: 700, color: inactive ? 'var(--danger)' : 'var(--success)', background: inactive ? 'color-mix(in srgb, var(--danger) 16%, transparent)' : 'color-mix(in srgb, var(--success) 16%, transparent)', padding: '3px 9px', borderRadius: 999 }}>{inactive ? 'Inativo' : 'Ativo'}</span></td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 12.5 }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou'}
                </td>
                <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {protegida ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Gerenciada pela TELUN</span>
                  ) : (
                    <>
                      <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(u)}>Editar</button>
                      <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => { setPwUser(u); setPw(''); }}>Senha</button>
                      <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => toggleActive(u)}>{inactive ? 'Reativar' : 'Desativar'}</button>
                      <button className="btn-icon danger" title="Excluir" onClick={() => remove(u)}>✕</button>
                    </>
                  )}
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
            <div className="modal-header"><div><h2 style={{ fontSize: 18, fontWeight: 700 }}>Redefinir senha</h2><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pwUser.name} — encerra as sessões ativas</p></div><button className="btn-close" onClick={() => setPwUser(null)}>✕</button></div>
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
