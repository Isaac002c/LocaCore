'use client';

import { useState } from 'react';
import { changePassword } from '../lib/usersAPI';
import { InlineError } from './states';

// =============================================================================
// ForcePasswordChange (§11) — troca OBRIGATÓRIA da senha inicial.
//
// A senha inicial é criada por um administrador e entregue por mensagem, então
// é tratada como EXPOSTA. Enquanto `user.must_change_password` for true, esta
// tela bloqueia o sistema: não há como fechar nem navegar por trás dela.
//
// Ao definir a nova senha o backend invalida todas as sessões anteriores
// (sessions_valid_after = NOW()), então quem tivesse o token antigo perde acesso.
// =============================================================================

const MIN = 8;

// Regras conscientes: comprimento manda mais que "complexidade" decorativa.
function avaliar(senha) {
  const problemas = [];
  if (senha.length < MIN) problemas.push(`ter pelo menos ${MIN} caracteres`);
  if (!/[a-zA-Z]/.test(senha)) problemas.push('conter ao menos uma letra');
  if (!/\d/.test(senha)) problemas.push('conter ao menos um número');
  return problemas;
}

export default function ForcePasswordChange({ user, onConcluido, onSair }) {
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const problemas = avaliar(senha);
  const conferem = senha.length > 0 && senha === confirmacao;
  const podeSalvar = problemas.length === 0 && conferem && !salvando;

  const enviar = async (e) => {
    e.preventDefault();
    if (!podeSalvar) return;
    try {
      setSalvando(true); setErro(null);
      await changePassword(user.id, senha);
      // A senha antiga deixou de valer: o usuário refaz o login com a nova.
      onConcluido();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="nx-force-overlay" role="dialog" aria-modal="true" aria-labelledby="fpc-titulo">
      <div className="nx-force-card">
        <h1 id="fpc-titulo" className="nx-force-title">Defina sua senha</h1>
        <p className="nx-force-sub">
          Sua senha atual foi criada por um administrador e enviada por mensagem — por isso
          precisa ser trocada antes do primeiro uso. Escolha uma senha que só você conheça.
        </p>

        <InlineError message={erro} onDismiss={() => setErro(null)} />

        <form onSubmit={enviar}>
          <div className="form-group">
            <label htmlFor="fpc-senha">Nova senha</label>
            <input
              id="fpc-senha"
              type={mostrar ? 'text' : 'password'}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="fpc-conf">Repita a nova senha</label>
            <input
              id="fpc-conf"
              type={mostrar ? 'text' : 'password'}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
            />
            {confirmacao.length > 0 && !conferem && (
              <div className="nx-field-error">As senhas não conferem.</div>
            )}
          </div>

          <label className="nx-check" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={mostrar} onChange={() => setMostrar((v) => !v)} />
            <span>Mostrar senha</span>
          </label>

          {senha.length > 0 && problemas.length > 0 && (
            <p className="nx-force-regras">A senha precisa {problemas.join(', ')}.</p>
          )}

          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!podeSalvar}>
            {salvando ? 'Salvando...' : 'Salvar e entrar'}
          </button>
        </form>

        <button type="button" className="nx-link-btn" onClick={onSair} style={{ marginTop: 14 }}>
          Sair sem trocar
        </button>
      </div>
    </div>
  );
}
