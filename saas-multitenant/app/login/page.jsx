'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '../lib/api.js';
import { BRAND } from '../lib/brand';

// Login institucional do produto (LocaCore, um produto TELUN). NÃO usa branding
// de tenant: logo, nome e cores são do produto. A locadora só aparece DEPOIS do
// login, na área autenticada (sidebar/topbar).
//
// Composição (§2): 52% institucional à esquerda · 48% formulário à direita.
// No mobile vira coluna única, sem card flutuante genérico.
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;              // bloqueia múltiplos envios
    setError('');
    setLoading(true);

    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      // Token em localStorage para o header Authorization; o backend também
      // envia cookie httpOnly via Set-Cookie.
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('auth-token', data.token);
      }

      const userData = { ...data.user, role: data.user.role || 'admin' };
      localStorage.setItem('user', JSON.stringify(userData));
      localStorage.setItem('tenant', JSON.stringify(data.tenant));
      localStorage.setItem('tenantId', data.tenant?.id || '');

      // super_admin (operador da plataforma) vai para /master; demais para o tenant.
      router.push(userData.role === 'super_admin' ? '/master' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Logo oficial da TELUN. O símbolo é luminoso sobre fundo Cosmic — o fundo faz
  // parte da arte, por isso o recorte é redondo em vez de recortar transparência.
  const Logo = ({ compact = false }) => (
    <div className="tl-login__logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRAND.logoCompact}
        alt=""
        aria-hidden="true"
        className="tl-login__logo-mark"
        width={compact ? 34 : 38}
        height={compact ? 34 : 38}
      />
      <span className="tl-login__logo-text" style={compact ? { fontSize: 17 } : undefined}>
        {BRAND.companyName}
      </span>
    </div>
  );

  return (
    <div className="tl-login">
      {/* ── Área institucional (52%) ─────────────────────────────────── */}
      <aside className="tl-login__brandside">
        <Logo />

        <div className="tl-login__center">
          <h1 className="tl-login__title">
            Gestão que <em>move</em> sua operação.
            <span>Clareza para conduzir sua frota.</span>
          </h1>
          <p className="tl-login__lead">
            Clientes, veículos, locações, financeiro e automações em um único
            ambiente, com dados reais e visão completa da operação.
          </p>
          <p className="tl-login__kicker">
            PROPÓSITO <b>•</b> DIREÇÃO <b>•</b> EVOLUÇÃO
          </p>
        </div>

        <p className="tl-login__footer">
          {BRAND.productName} · {BRAND.productSignature}
        </p>
      </aside>

      {/* ── Marca no topo (apenas mobile) ─────────────────────────────── */}
      <div className="tl-login__mobilebrand">
        <Logo compact />
      </div>

      {/* ── Área de autenticação (48%) ───────────────────────────────── */}
      <main className="tl-login__formside">
        <form className="tl-login__form" onSubmit={handleLogin} noValidate>
          <h2>Acessar o {BRAND.productName}</h2>
          <p className="tl-login__sub">Entre com suas credenciais para continuar.</p>

          {error && <div className="tl-alert" role="alert">{error}</div>}

          <div className="tl-field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email" type="email" className="tl-input"
              value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" required autoFocus
              placeholder="voce@empresa.com.br"
            />
          </div>

          <div className="tl-field tl-field--password">
            <label htmlFor="password">Senha</label>
            <input
              id="password" type={showPassword ? 'text' : 'password'} className="tl-input"
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required
              placeholder="Sua senha"
            />
            <button
              type="button" className="tl-field__reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <button
            type="submit"
            className="tl-btn tl-btn--primary tl-btn--block"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {!loading && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            )}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <p style={{ marginTop: 22, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            {BRAND.productName} · {BRAND.productSignature}
          </p>
        </form>
      </main>
    </div>
  );
}
