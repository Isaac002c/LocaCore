'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getCompanySettings, saveCompanySettings,
  getContractSettings, saveContractSettings,
  getRoles, getIntegrationsReadiness,
} from '../lib/settingsAPI';
import { getOptions, createOption, updateOption } from '../lib/configOptionsAPI';
import { PageLoading, PageError, InlineError, EmptyState } from '../components/states';
import { PageHead } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';
import Usuarios from './Usuarios';

// =============================================================================
// CENTRAL DE CONFIGURAÇÕES (§7) — um lugar só, em abas.
//
// Não cria fonte de verdade nova: cada aba grava no MESMO endpoint que já
// existia (financeiro, contratos, opções de configuração, usuários). O que
// muda é que o operador deixa de caçar configuração espalhada por módulo.
//
// Toda alteração persiste no backend, é validada por tenant e mostra sucesso
// ou erro — nada de formulário que só altera estado local.
// =============================================================================

const ABAS = [
  { key: 'empresa',      label: 'Empresa' },
  { key: 'usuarios',     label: 'Usuários' },
  { key: 'perfis',       label: 'Perfis e permissões' },
  { key: 'categorias',   label: 'Categorias de veículos' },
  { key: 'adicionais',   label: 'Adicionais' },
  { key: 'contratos',    label: 'Contratos' },
  { key: 'financeiro',   label: 'Financeiro' },
  { key: 'automacoes',   label: 'Automações' },
  { key: 'integracoes',  label: 'Integrações' },
  { key: 'aparencia',    label: 'Aparência' },
];

const STATUS_INTEGRACAO = {
  pronto:          { label: 'Pronto',            cor: 'var(--success)' },
  parcial:         { label: 'Parcialmente configurado', cor: 'var(--warning)' },
  nao_configurado: { label: 'Não configurado',   cor: 'var(--text-muted)' },
  desativado:      { label: 'Desativado',        cor: 'var(--text-muted)' },
};

// Aviso de sucesso/erro padrão das abas.
function Aviso({ ok, erro, onFechar }) {
  if (!ok && !erro) return null;
  if (erro) return <InlineError message={erro} onDismiss={onFechar} />;
  return (
    <div className="nx-aviso-ok" role="status">
      <span>{ok}</span>
      <button type="button" className="btn-close" onClick={onFechar} aria-label="Fechar">✕</button>
    </div>
  );
}

// ── Aba: Empresa ────────────────────────────────────────────────────────────
function AbaEmpresa() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setForm(await getCompanySettings()); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const salvar = async (e) => {
    e.preventDefault();
    try {
      setSaving(true); setErro(null); setOk(null);
      await saveCompanySettings({
        razao_social: form.razao_social, document: form.document, address: form.address,
        phone: form.phone, email: form.email, logo_url: form.logo_url,
      });
      setOk('Dados da empresa salvos.');
      await load();
    } catch (err) { setErro(err.message); } finally { setSaving(false); }
  };

  if (loading) return <PageLoading label="Carregando dados da empresa..." compact />;
  if (!form) return <PageError message="Não foi possível carregar os dados da empresa." onRetry={load} />;

  return (
    <form onSubmit={salvar} className="nx-cfg-form">
      <Aviso ok={ok} erro={erro} onFechar={() => { setOk(null); setErro(null); }} />
      <p className="nx-cfg-hint">
        Estes dados aparecem no recibo e no contrato de locação. Preencha com a razão social
        exatamente como consta no CNPJ.
      </p>
      <div className="form-row">
        <div className="form-group"><label>Razão social</label>
          <input type="text" value={form.razao_social || ''} onChange={set('razao_social')} placeholder="Rental Log Locadora Ltda" /></div>
        <div className="form-group"><label>CNPJ</label>
          <input type="text" value={form.document || ''} onChange={set('document')} placeholder="00.000.000/0001-00" /></div>
      </div>
      <div className="form-group"><label>Endereço</label>
        <input type="text" value={form.address || ''} onChange={set('address')} placeholder="Rua, número, bairro, cidade - UF" /></div>
      <div className="form-row">
        <div className="form-group"><label>Telefone</label>
          <input type="text" value={form.phone || ''} onChange={set('phone')} placeholder="(21) 90000-0000" /></div>
        <div className="form-group"><label>E-mail</label>
          <input type="email" value={form.email || ''} onChange={set('email')} placeholder="contato@empresa.com.br" /></div>
      </div>
      <div className="form-group"><label>URL do logo</label>
        <input type="url" value={form.logo_url || ''} onChange={set('logo_url')} placeholder="https://..." />
        <small className="nx-cfg-hint">Usado na barra lateral, no recibo e no contrato.</small></div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </form>
  );
}

// ── Aba: Perfis e permissões (matriz — leitura) ─────────────────────────────
function AbaPerfis() {
  const [roles, setRoles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setRoles(await getRoles()); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading label="Carregando perfis..." compact />;
  if (erro) return <PageError message="Não foi possível carregar os perfis." detail={erro} onRetry={load} />;

  const lista = Array.isArray(roles) ? roles : (roles?.roles || []);
  if (!lista.length) return <EmptyState title="Nenhum perfil disponível" description="O backend não retornou perfis." />;

  return (
    <>
      <p className="nx-cfg-hint">
        O perfil define o que cada pessoa enxerga e pode fazer. A troca de perfil é feita na aba
        <strong> Usuários</strong>. As permissões abaixo são aplicadas pelo servidor — mudar a tela
        não dá acesso a quem não tem.
      </p>
      <div className="clients-table-wrap">
        <table className="data-table">
          <thead><tr><th>Perfil</th><th>Resumo do acesso</th><th>Permissões</th></tr></thead>
          <tbody>
            {lista.map((r) => {
              const nome = typeof r === 'string' ? r : (r.role || r.name);
              const perms = typeof r === 'string' ? [] : (r.permissions || []);
              return (
                <tr key={nome}>
                  <td><strong style={{ color: 'var(--text-primary)' }}>{PERFIL_LABEL[nome] || nome}</strong></td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: 380 }}>{PERFIL_RESUMO[nome] || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {perms.length ? `${perms.length} permissões` : '—'}
                    {perms.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer' }}>ver</summary>
                        <div style={{ marginTop: 6, lineHeight: 1.7 }}>{perms.join(', ')}</div>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const PERFIL_LABEL = {
  admin: 'Administrador', manager: 'Gerente', operator: 'Operador',
  seller: 'Consultor', viewer: 'Consulta',
};
const PERFIL_RESUMO = {
  admin: 'Acesso total: operação, Financeiro, Automações, usuários e configurações.',
  manager: 'Operação completa + relatórios, importação e gestão de usuários. Sem Financeiro nem configuração de Automações.',
  operator: 'Operação diária: clientes, frota, locações, multas, estoque, agenda e contratos.',
  seller: 'Cadastro e consulta de clientes, frota e locações.',
  viewer: 'Somente leitura.',
};

// ── Aba genérica de OPÇÕES (categorias de veículo / adicionais) ─────────────
function AbaOpcoes({ kind, titulo, descricao, placeholder }) {
  const [itens, setItens] = useState([]);
  const [novo, setNovo] = useState('');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setItens((await getOptions(kind, { all: true })) || []); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  const adicionar = async (e) => {
    e.preventDefault();
    const valor = novo.trim();
    if (!valor) { setErro('Informe um nome.'); return; }
    try {
      setSaving(true); setErro(null); setOk(null);
      await createOption(kind, valor);
      setNovo(''); setOk(`"${valor}" adicionado.`); await load();
    } catch (err) { setErro(err.message); } finally { setSaving(false); }
  };

  const alternar = async (opt) => {
    try {
      setErro(null); setOk(null);
      await updateOption(opt.id, { active: !opt.active });
      setOk(`"${opt.value}" ${opt.active ? 'desativado' : 'reativado'}.`); await load();
    } catch (err) { setErro(err.message); }
  };

  if (loading) return <PageLoading label={`Carregando ${titulo.toLowerCase()}...`} compact />;

  return (
    <>
      <Aviso ok={ok} erro={erro} onFechar={() => { setOk(null); setErro(null); }} />
      <p className="nx-cfg-hint">{descricao}</p>

      <form onSubmit={adicionar} className="nx-cfg-inline-form">
        <input type="text" value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} />
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Adicionando...' : 'Adicionar'}</button>
      </form>

      {itens.length === 0 ? (
        <EmptyState small title="Nenhuma opção cadastrada" description="Adicione a primeira usando o campo acima." />
      ) : (
        <div className="clients-table-wrap" style={{ marginTop: 14 }}>
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Situação</th><th style={{ width: 140 }}>Ações</th></tr></thead>
            <tbody>
              {itens.map((o) => (
                <tr key={o.id}>
                  <td><strong style={{ color: 'var(--text-primary)' }}>{o.value}</strong></td>
                  <td>
                    <span className="client-status-badge" style={o.active
                      ? { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' }
                      : { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>
                      {o.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td>
                    <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => alternar(o)}>
                      {o.active ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Aba: Contratos ──────────────────────────────────────────────────────────
function AbaContratos() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setForm((await getContractSettings()) || {}); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const salvar = async (e) => {
    e.preventDefault();
    try {
      setSaving(true); setErro(null); setOk(null);
      await saveContractSettings({ header: form.header, clauses: form.clauses, footer: form.footer });
      setOk('Modelo de contrato salvo. As próximas gerações usam este texto.');
      await load();
    } catch (err) { setErro(err.message); } finally { setSaving(false); }
  };

  if (loading) return <PageLoading label="Carregando modelo de contrato..." compact />;
  if (!form) return <PageError message="Não foi possível carregar o modelo de contrato." onRetry={load} />;

  return (
    <form onSubmit={salvar} className="nx-cfg-form">
      <Aviso ok={ok} erro={erro} onFechar={() => { setOk(null); setErro(null); }} />
      <p className="nx-cfg-hint">
        Texto usado no PDF do contrato de locação. Cada contrato gerado guarda uma CÓPIA deste
        texto (versionada), então alterar aqui não muda contratos já emitidos.
      </p>
      <div className="form-group"><label>Cabeçalho</label>
        <textarea rows={3} value={form.header || ''} onChange={set('header')} placeholder="Identificação da empresa, CNPJ, endereço..." /></div>
      <div className="form-group"><label>Cláusulas</label>
        <textarea rows={12} value={form.clauses || ''} onChange={set('clauses')}
          placeholder={'Cláusulas do contrato: caução, combustível, atraso na devolução, multas, avarias, seguro, quilometragem...'} />
        <small className="nx-cfg-hint">
          As cláusulas definitivas devem ser revisadas pelo responsável jurídico da locadora.
        </small></div>
      <div className="form-group"><label>Rodapé</label>
        <textarea rows={3} value={form.footer || ''} onChange={set('footer')} placeholder="Foro, assinaturas, observações finais..." /></div>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar modelo'}</button>
      </div>
    </form>
  );
}

// ── Aba: Financeiro ─────────────────────────────────────────────────────────
function AbaFinanceiro() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setForm(await getCompanySettings()); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const metodos = form?.payment_methods || [];
  const habilitados = Array.isArray(form?.enabled_payment_methods) ? form.enabled_payment_methods : [];

  const alternarMetodo = (value) => {
    setForm((f) => {
      const atuais = Array.isArray(f.enabled_payment_methods) ? f.enabled_payment_methods : [];
      const novos = atuais.includes(value) ? atuais.filter((v) => v !== value) : [...atuais, value];
      return { ...f, enabled_payment_methods: novos };
    });
  };

  const salvar = async (e) => {
    e.preventDefault();
    if (!habilitados.length) { setErro('Habilite ao menos uma forma de pagamento.'); return; }
    try {
      setSaving(true); setErro(null); setOk(null);
      await saveCompanySettings({
        receipt_prefix: form.receipt_prefix,
        enabled_payment_methods: form.enabled_payment_methods,
      });
      setOk('Configurações financeiras salvas.');
      await load();
    } catch (err) { setErro(err.message); } finally { setSaving(false); }
  };

  if (loading) return <PageLoading label="Carregando configurações financeiras..." compact />;
  if (!form) return <PageError message="Não foi possível carregar as configurações financeiras." onRetry={load} />;

  return (
    <form onSubmit={salvar} className="nx-cfg-form">
      <Aviso ok={ok} erro={erro} onFechar={() => { setOk(null); setErro(null); }} />
      <div className="form-row">
        <div className="form-group"><label>Prefixo do recibo</label>
          <input type="text" value={form.receipt_prefix || ''} onChange={(e) => setForm((f) => ({ ...f, receipt_prefix: e.target.value }))} placeholder="LOCA" maxLength={20} />
          <small className="nx-cfg-hint">Somente letras e números. Próximo número: <strong>{form.next_receipt_number}</strong></small></div>
      </div>

      <div className="form-group">
        <label>Formas de pagamento aceitas</label>
        <div className="nx-check-grid">
          {metodos.map((m) => (
            <label key={m.value} className="nx-check">
              <input type="checkbox" checked={habilitados.includes(m.value)} onChange={() => alternarMetodo(m.value)} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
        <small className="nx-cfg-hint">Só as formas marcadas aparecem ao registrar um pagamento.</small>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </form>
  );
}

// ── Aba: Integrações (prontidão real, sem credencial fictícia) ──────────────
function AbaIntegracoes() {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const load = useCallback(async () => {
    try { setLoading(true); setErro(null); setDados(await getIntegrationsReadiness()); }
    catch (e) { setErro(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading label="Verificando integrações..." compact />;
  if (erro) return <PageError message="Não foi possível verificar as integrações." detail={erro} onRetry={load} />;

  return (
    <>
      <p className="nx-cfg-hint">
        Estado real de cada integração externa. Nada aqui é simulado: um item só fica verde quando
        a credencial existe de verdade no servidor. Ambiente atual: <strong>{dados.ambiente}</strong>.
      </p>

      {(dados.integracoes || []).map((it) => {
        const st = STATUS_INTEGRACAO[it.status] || STATUS_INTEGRACAO.nao_configurado;
        const pendentes = (it.itens || []).filter((i) => !i.ok);
        return (
          <section key={it.key} className="nx-integracao">
            <header className="nx-integracao-head">
              <div>
                <strong>{it.nome}</strong>
                <span className="nx-integracao-fim">{it.finalidade}</span>
              </div>
              <span className="nx-integracao-status" style={{ color: st.cor, borderColor: st.cor }}>{st.label}</span>
            </header>

            <ul className="nx-checklist">
              {(it.itens || []).map((i) => (
                <li key={i.label} className={i.ok ? 'ok' : 'pendente'}>
                  <span className="nx-checklist-marca" aria-hidden="true">{i.ok ? '✓' : '○'}</span>
                  <span className="nx-checklist-corpo">
                    <span className="nx-checklist-label">{i.label}</span>
                    {i.detalhe && <span className="nx-checklist-detalhe">{i.detalhe}</span>}
                    {!i.ok && i.env && <span className="nx-checklist-env">Falta a variável <code>{i.env}</code> no servidor</span>}
                    {!i.ok && i.depende && <span className="nx-checklist-depende">Depende de: {i.depende}</span>}
                  </span>
                </li>
              ))}
            </ul>

            {it.aviso && <p className="nx-integracao-aviso">{it.aviso}</p>}
            {pendentes.length > 0 && (
              <p className="nx-cfg-hint" style={{ marginTop: 8 }}>
                <strong>{pendentes.length}</strong> item(ns) pendente(s) para ligar em produção.
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

// ── Aba: Aparência ──────────────────────────────────────────────────────────
function AbaAparencia() {
  return (
    <>
      <p className="nx-cfg-hint">
        O tema é uma preferência de cada pessoa e fica salvo neste navegador. A identidade da
        locadora (logo e cor) vem dos dados da empresa.
      </p>
      <div className="form-group">
        <label>Tema do sistema</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <ThemeToggle />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Alterna entre escuro e claro. Na primeira visita, o sistema segue a preferência do seu sistema operacional.
          </span>
        </div>
      </div>
      <div className="form-group">
        <label>Identidade visual</label>
        <p className="nx-cfg-hint">
          Logo e cor da marca são definidos na aba <strong>Empresa</strong> (campo URL do logo).
          O produto usa a identidade TELUN quando a locadora não define a própria.
        </p>
      </div>
    </>
  );
}

// ── Aba: Automações (aponta para o console, sem duplicar) ───────────────────
function AbaAutomacoes({ onIr }) {
  return (
    <>
      <p className="nx-cfg-hint">
        As configurações de automação (dia e horário da cobrança, vencimento, janela de envio,
        lembretes, provedor e modo fiscal) ficam no console de Automações, junto da fila, das
        execuções e do dead-letter — para você configurar vendo o efeito.
      </p>
      <button type="button" className="btn-primary" onClick={onIr}>Abrir console de Automações</button>
    </>
  );
}

// =============================================================================
export default function Configuracoes({ onNavigate }) {
  const [aba, setAba] = useState('empresa');
  const irParaAutomacoes = () => (onNavigate ? onNavigate('locacao', 'automacoes') : null);

  return (
    <div>
      <PageHead title="Configurações" subtitle="Empresa, equipe, catálogos, contratos, financeiro e integrações — em um lugar só." />

      <div className="nx-cfg-layout">
        <nav className="nx-cfg-nav" aria-label="Seções de configuração">
          {ABAS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`nx-cfg-nav-item${aba === a.key ? ' active' : ''}`}
              aria-current={aba === a.key ? 'true' : undefined}
              onClick={() => setAba(a.key)}
            >
              {a.label}
            </button>
          ))}
        </nav>

        <section className="nx-cfg-painel">
          {aba === 'empresa' && <AbaEmpresa />}
          {aba === 'usuarios' && <Usuarios />}
          {aba === 'perfis' && <AbaPerfis />}
          {aba === 'categorias' && (
            <AbaOpcoes
              kind="vehicle_category"
              titulo="Categorias de veículos"
              descricao="Categorias usadas no cadastro da frota e nos filtros (Hatch, Sedan, SUV, Utilitário...)."
              placeholder="Ex.: SUV"
            />
          )}
          {aba === 'adicionais' && (
            <AbaOpcoes
              kind="rental_extra_category"
              titulo="Adicionais"
              descricao="Tipos de item adicional cobrados na locação (cadeirinha, GPS, motorista adicional, combustível, avaria...)."
              placeholder="Ex.: Cadeirinha"
            />
          )}
          {aba === 'contratos' && <AbaContratos />}
          {aba === 'financeiro' && <AbaFinanceiro />}
          {aba === 'automacoes' && <AbaAutomacoes onIr={irParaAutomacoes} />}
          {aba === 'integracoes' && <AbaIntegracoes />}
          {aba === 'aparencia' && <AbaAparencia />}
        </section>
      </div>
    </div>
  );
}
