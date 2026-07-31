'use client';

import { useState, useEffect } from 'react';
import {
  getAutomationStatus, getSettings, updateSettings, getRuns,
  runBilling, runDunning, runOutbox, runFiscalBatch,
  getMessages, retryMessage, getFiscalDocs, retryFiscal, getCosts,
  getConsole, getDeadLetter, cancelDeadLetter, manualDeadLetter,
} from '../lib/automationsAPI';
import { MetricCard, PageHead, EmptyState } from '../components/ui';
import { fmtMoney, fmtDate } from './shared';
import { PageLoading, InlineError } from '../components/states';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const TABS = [
  { key: 'painel', label: 'Painel' },
  { key: 'execucoes', label: 'Execuções' },
  { key: 'mensagens', label: 'Mensagens' },
  { key: 'deadletter', label: 'Dead-letter' },
  { key: 'fiscal', label: 'Notas Fiscais' },
  { key: 'custos', label: 'Custos' },
  { key: 'config', label: 'Configurações' },
];

// Intervalo declarado do job -> texto legível ("a cada 5 min").
const fmtIntervalo = (ms) => {
  const min = Math.round((Number(ms) || 0) / 60000);
  if (min < 60) return `a cada ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `a cada ${h}h` : `a cada ${Math.round(h / 24)}d`;
};
const fmtDataHora = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
const fmtDuracao = (ini, fim) => {
  if (!ini || !fim) return '—';
  const ms = new Date(fim).getTime() - new Date(ini).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};
const fmtCost = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v) || 0);

export default function Automacoes() {
  const [tab, setTab] = useState('painel');
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [validation, setValidation] = useState(null);
  const [runs, setRuns] = useState([]);
  const [messages, setMessages] = useState([]);
  const [fiscal, setFiscal] = useState([]);
  const [costs, setCosts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [msgFilter, setMsgFilter] = useState('');
  const [consoleData, setConsoleData] = useState(null);
  const [dead, setDead] = useState([]);

  useEffect(() => { loadPanel(); }, []);

  const loadPanel = async () => {
    try {
      setLoading(true); setError(null);
      // O console traz tudo numa chamada; o status legado fica de reserva.
      const [c, s, r] = await Promise.all([
        getConsole().catch(() => null),
        getAutomationStatus(),
        getRuns().catch(() => []),
      ]);
      setConsoleData(c); setStatus(s); setSettings(c?.settings || s.settings); setRuns(c?.ultimas_execucoes || r);
      if (c?.fiscal_validation) setValidation(c.fiscal_validation);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const loadDead = async () => {
    try { setError(null); setDead((await getDeadLetter({ limit: 100 })) || []); }
    catch (err) { setError(err.message); }
  };
  const acaoDead = async (fn, id, msg) => {
    try { setNotice(null); setError(null); await fn(id); setNotice(msg); await loadDead(); await loadPanel(); }
    catch (err) { setError(err.message); }
  };
  const loadConfig = async () => {
    try { const d = await getSettings(); setSettings(d.settings); setValidation(d.fiscal_validation); } catch (err) { setError(err.message); }
  };
  const loadMessages = async () => { try { setMessages(await getMessages({ status: msgFilter })); } catch (err) { setError(err.message); } };
  const loadFiscal = async () => { try { setFiscal(await getFiscalDocs({})); } catch (err) { setError(err.message); } };
  const loadCosts = async () => { try { setCosts(await getCosts()); } catch (err) { setError(err.message); } };

  const onTab = (k) => {
    setTab(k); setNotice(null); setError(null);
    if (k === 'config') loadConfig();
    if (k === 'mensagens') loadMessages();
    if (k === 'fiscal') loadFiscal();
    if (k === 'custos') loadCosts();
    if (k === 'painel') loadPanel();
    if (k === 'execucoes') loadPanel();
    if (k === 'deadletter') loadDead();
  };

  const doRun = async (fn, label) => {
    try { setBusy(true); setNotice(null); const r = await fn(); setNotice(`${label}: ${JSON.stringify(r)}`); await loadPanel(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const saveSettings = async (patch) => {
    try { setBusy(true); const d = await updateSettings(patch); setSettings(d.settings); setValidation(d.fiscal_validation); setNotice('Configurações salvas.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const setField = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? Number(e.target.value) : e.target.value);
    setSettings((s) => ({ ...s, [k]: v }));
  };

  if (loading) return <PageLoading label="Carregando automações..." />;

  return (
    <div>
      <PageHead title="Automações" subtitle="Cobrança semanal, WhatsApp, confirmação de pagamento e emissão fiscal" />

      <div className="nx-seg" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => onTab(t.key)}>{t.label}</button>)}
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} onRetry={loadPanel} />
      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', wordBreak: 'break-word' }}><span>{notice}</span><button className="btn-close" onClick={() => setNotice(null)}>✕</button></div>}

      {/* ── PAINEL: console operacional (§8) ────────────────────── */}
      {tab === 'painel' && (
        <div>
          {/* Serviços: worker e scheduler estão vivos? */}
          <div className="nx-section-label">Serviços</div>
          <div className="nx-kpi-grid nx-kpi-grid--4">
            <MetricCard
              title="Worker"
              value={consoleData?.servicos?.worker?.ativo ? 'Ativo' : 'Parado'}
              direction={consoleData?.servicos?.worker?.ativo ? undefined : 'down'}
              subtitle={consoleData?.servicos?.worker?.age_seconds != null
                ? `heartbeat há ${consoleData.servicos.worker.age_seconds}s` : 'sem heartbeat'}
              tooltip="Processa a fila de mensagens"
            />
            <MetricCard
              title="Scheduler"
              value={consoleData?.servicos?.scheduler?.ativo ? 'Ativo' : 'Parado'}
              direction={consoleData?.servicos?.scheduler?.ativo ? undefined : 'down'}
              subtitle={consoleData?.servicos?.scheduler?.age_seconds != null
                ? `heartbeat há ${consoleData.servicos.scheduler.age_seconds}s` : 'sem heartbeat'}
              tooltip="Dispara os jobs no horário"
            />
            <MetricCard
              title="Fila pendente"
              value={consoleData?.fila?.pendentes ?? status?.messages?.pending ?? 0}
              subtitle={`${consoleData?.fila?.processando ?? 0} processando`}
              tooltip="Mensagens aguardando envio"
            />
            <MetricCard
              title="Dead-letter"
              value={consoleData?.fila?.dead_letter ?? 0}
              direction={consoleData?.fila?.dead_letter ? 'down' : undefined}
              subtitle="Esgotaram as tentativas"
              onClick={() => onTab('deadletter')}
              tooltip="Exigem ação humana"
            />
          </div>

          {/* Fila detalhada */}
          <div className="nx-section-label">Fila de mensagens</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Concluídas" value={consoleData?.fila?.concluidas ?? 0} subtitle="Enviadas + entregues" />
            <MetricCard title="Falhas (com retry)" value={consoleData?.fila?.falhas ?? 0} direction={consoleData?.fila?.falhas ? 'down' : undefined} subtitle="Ainda serão reprocessadas" />
            <MetricCard title="Retries acumulados" value={consoleData?.fila?.retries ?? 0} subtitle="Reentregas totais" tooltip="Mede a instabilidade do provedor" />
            <MetricCard title="Bloqueadas" value={consoleData?.fila?.bloqueadas ?? 0} subtitle="Fora da janela ou desativadas" />
          </div>

          {/* Cobrança, conciliação e fiscal */}
          <div className="nx-section-label">Cobrança e fiscal</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Cobranças criadas" value={consoleData?.contadores?.cobrancas_criadas ?? 0} />
            <MetricCard title="Pagamentos conciliados" value={consoleData?.contadores?.pagamentos_conciliados ?? 0} subtitle="Confirmados pelo provedor" />
            <MetricCard title="Fiscais pendentes" value={consoleData?.contadores?.fiscais_pendentes ?? 0} subtitle="Aguardando emissão" onClick={() => onTab('fiscal')} />
            <MetricCard title="Fiscais com erro" value={consoleData?.contadores?.fiscais_erro ?? 0} direction={consoleData?.contadores?.fiscais_erro ? 'down' : undefined} onClick={() => onTab('fiscal')} />
            <MetricCard title="Custo do período" value={fmtCost(consoleData?.custos?.total ?? status?.cost?.total)} subtitle="WhatsApp + fiscal" onClick={() => onTab('custos')} />
          </div>

          {/* Jobs do scheduler */}
          <div className="nx-section-label">Jobs agendados</div>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead><tr><th>Job</th><th>Intervalo</th><th>Última execução</th><th>Status</th><th>Próxima (estimada)</th></tr></thead>
              <tbody>
                {(consoleData?.jobs || []).length === 0 ? (
                  <tr><td colSpan="5"><EmptyState small title="Sem jobs" description="O scheduler não reportou jobs." /></td></tr>
                ) : consoleData.jobs.map((j) => (
                  <tr key={j.name}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{j.label}</strong><span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {j.name}</span></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{fmtIntervalo(j.every_ms)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(j.ultima_execucao)}</td>
                    <td>{j.ultimo_status || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDataHora(j.proxima_execucao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '18px 0' }}>
            <button className="btn-primary" disabled={busy} onClick={() => doRun(runBilling, 'Cobrança semanal')}>Executar cobrança semanal</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runOutbox, 'Processar fila')}>Processar mensagens</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runDunning, 'Régua')}>Rodar inadimplência</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runFiscalBatch, 'Lote fiscal')}>Lote fiscal</button>
            <button className="btn-secondary" disabled={loading} onClick={loadPanel}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>
      )}

      {/* ── EXECUÇÕES ──────────────────────────────────────────── */}
      {tab === 'execucoes' && (
        <div>
          <p className="nx-cfg-hint">Cada execução do scheduler, com duração, registros processados e resultado.</p>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead><tr><th>Job</th><th>Período</th><th>Início</th><th>Término</th><th>Duração</th><th>Locações</th><th>Cobranças</th><th>Mensagens</th><th>Status</th></tr></thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr><td colSpan="9"><EmptyState
                    title="Nenhuma execução registrada"
                    description="O scheduler grava aqui cada rodada de cobrança, régua, fila e fiscal. Dispare uma execução manual no Painel ou aguarde o horário agendado."
                  /></td></tr>
                ) : runs.map((r) => (
                  <tr key={r.id}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{r.run_type}</strong></td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDate(r.period_start)}–{fmtDate(r.period_end)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(r.started_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(r.finished_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDuracao(r.started_at, r.finished_at)}</td>
                    <td>{r.rentals_processed ?? 0}</td>
                    <td>{r.charges_created ?? 0}</td>
                    <td>{r.messages_enqueued ?? 0}</td>
                    <td>
                      <span className="client-status-badge" style={(r.status === 'success' || r.status === 'ok')
                        ? { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' }
                        : (r.status === 'error' || r.status === 'failed')
                          ? { background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }
                          : { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>
                        {r.status}
                      </span>
                      {r.details?.error && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3 }}>{String(r.details.error).slice(0, 90)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DEAD-LETTER ────────────────────────────────────────── */}
      {tab === 'deadletter' && (
        <div>
          <p className="nx-cfg-hint">
            Mensagens que esgotaram as tentativas automáticas. Elas <strong>não</strong> voltam sozinhas —
            exigem decisão de alguém. O telefone aparece mascarado e nenhum token ou assinatura é exibido.
          </p>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead><tr><th>Template</th><th>Destino</th><th>Tentativas</th><th>Provedor</th><th>Erro</th><th>Última tentativa</th><th style={{ width: 260 }}>Ações</th></tr></thead>
              <tbody>
                {dead.length === 0 ? (
                  <tr><td colSpan="7"><EmptyState
                    title="Nenhuma mensagem em dead-letter"
                    description="Tudo que entrou na fila foi entregue ou ainda está sendo reprocessado automaticamente."
                  /></td></tr>
                ) : dead.map((m) => (
                  <tr key={m.id}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{m.template_kind}</strong></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{m.to_number || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.attempts}/{m.max_attempts}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{m.provider || '—'}</td>
                    <td style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 280 }}>{m.error || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(m.updated_at || m.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }}
                          onClick={() => acaoDead(retryMessage, m.id, 'Mensagem recolocada na fila.')}>Reprocessar</button>
                        <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }}
                          onClick={() => acaoDead(manualDeadLetter, m.id, 'Encaminhada para atendimento manual.')}>Atendimento manual</button>
                        <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: 12 }}
                          onClick={() => acaoDead(cancelDeadLetter, m.id, 'Mensagem cancelada.')}>Cancelar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CONFIGURAÇÕES ──────────────────────────────────────── */}
      {tab === 'config' && settings && (
        <div style={{ maxWidth: 760 }}>
          <div className="nx-form-section">
            <div className="nx-form-section-title">Cobrança semanal</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.billing_enabled} onChange={setField('billing_enabled')} /> Ativar cobrança automática</label>
            <div className="form-row">
              <div className="form-group"><label>Dia da semana</label><select value={settings.billing_weekday} onChange={setField('billing_weekday')}>{WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
              <div className="form-group"><label>Hora</label><input type="number" min="0" max="23" value={settings.billing_hour} onChange={setField('billing_hour')} /></div>
              <div className="form-group"><label>Vencimento (dias)</label><input type="number" min="0" value={settings.billing_due_days} onChange={setField('billing_due_days')} /></div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!settings.billing_auto_create} onChange={setField('billing_auto_create')} /> Gerar cobrança automaticamente (senão, apenas fatura para revisão)</label>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">WhatsApp</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.whatsapp_enabled} onChange={setField('whatsapp_enabled')} /> Ativar envio de mensagens</label>
            <div className="form-row">
              <div className="form-group"><label>Provedor</label><select value={settings.whatsapp_provider} onChange={setField('whatsapp_provider')}><option value="null">Sandbox (sem envio real)</option><option value="meta">Meta (WhatsApp Cloud API)</option><option value="twilio">Twilio</option></select></div>
              <div className="form-group"><label>Remetente</label><input type="text" value={settings.whatsapp_from || ''} onChange={setField('whatsapp_from')} placeholder="+55..." /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Janela início (h)</label><input type="number" min="0" max="23" value={settings.whatsapp_send_start_hour} onChange={setField('whatsapp_send_start_hour')} /></div>
              <div className="form-group"><label>Janela fim (h)</label><input type="number" min="1" max="24" value={settings.whatsapp_send_end_hour} onChange={setField('whatsapp_send_end_hour')} /></div>
              <div className="form-group"><label>Máx. lembretes</label><input type="number" min="0" value={settings.reminder_max} onChange={setField('reminder_max')} /></div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Credenciais do provedor não ficam no banco — configuradas por variável de ambiente. O sandbox simula o envio para homologação.</p>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Pagamento (cobrança/PIX)</div>
            <div className="form-group" style={{ maxWidth: 320 }}><label>Provedor</label><select value={settings.payment_provider} onChange={setField('payment_provider')}><option value="null">Sandbox (PIX fictício)</option><option value="asaas">Asaas</option><option value="mercadopago">Mercado Pago</option></select></div>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Fiscal</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.fiscal_enabled} onChange={setField('fiscal_enabled')} /> Ativar emissão fiscal</label>
            <div className="form-row">
              <div className="form-group"><label>Modo</label><select value={settings.fiscal_mode} onChange={setField('fiscal_mode')}><option value="after_payment">Após o pagamento</option><option value="weekly_batch">Lote semanal</option><option value="manual">Manual</option></select></div>
              <div className="form-group"><label>Tipo de documento</label><select value={settings.fiscal_document_type || ''} onChange={setField('fiscal_document_type')}><option value="">— definir com contador —</option><option value="nfse">NFS-e</option><option value="nfe">NF-e</option></select></div>
              <div className="form-group"><label>Ambiente</label><select value={settings.fiscal_environment} onChange={setField('fiscal_environment')}><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></div>
            </div>
            <div className="form-group" style={{ maxWidth: 320 }}><label>Provedor fiscal</label><select value={settings.fiscal_provider} onChange={setField('fiscal_provider')}><option value="null">Nenhum (pendente)</option><option value="focusnfe">Focus NFe</option><option value="nfeio">NFe.io</option></select></div>
            {validation && !validation.ok && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                Emissão fiscal pendente de configuração. Faltando: {validation.missing.join(', ')}. Definir com o contador; sem provedor/credenciais válidos, nenhuma nota produtiva é emitida.
              </div>
            )}
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Custos externos</div>
            <div className="form-row">
              <div className="form-group"><label>Custo por mensagem (R$)</label><input type="number" step="0.0001" min="0" value={settings.cost_per_message} onChange={setField('cost_per_message')} /></div>
              <div className="form-group"><label>Custo por nota (R$)</label><input type="number" step="0.0001" min="0" value={settings.cost_per_fiscal} onChange={setField('cost_per_fiscal')} /></div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custos de mensagens, emissão fiscal, certificados e demais serviços externos são cobrados separadamente conforme o consumo.</p>
          </div>

          <div className="form-actions"><button className="btn-primary" disabled={busy} onClick={() => saveSettings(settings)}>Salvar configurações</button></div>
        </div>
      )}

      {/* ── MENSAGENS ──────────────────────────────────────────── */}
      {tab === 'mensagens' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <select value={msgFilter} onChange={(e) => setMsgFilter(e.target.value)} className="clients-filter-select">
              <option value="">Todos os status</option>
              {['pending', 'sent', 'delivered', 'read', 'failed', 'canceled', 'skipped'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-secondary" onClick={loadMessages}>Filtrar</button>
          </div>
          {messages.length === 0 ? <EmptyState small title="Sem mensagens" description="Dispare a cobrança para gerar mensagens." /> : (
            <div className="clients-table-wrap"><table className="data-table">
              <thead><tr><th>Tipo</th><th>Para</th><th>Status</th><th>Tent.</th><th>Custo</th><th>Enviada</th><th>Ações</th></tr></thead>
              <tbody>{messages.map((m) => (
                <tr key={m.id}>
                  <td>{m.template_kind}</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.to_number || '—'}</td>
                  <td><span className="client-status-badge">{m.status}</span></td><td>{m.attempts}</td>
                  <td>{fmtCost(m.cost_amount)}</td><td style={{ fontSize: 12 }}>{m.sent_at ? fmtDate(m.sent_at) : '—'}</td>
                  <td>{['failed', 'pending'].includes(m.status) && <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={async () => { try { await retryMessage(m.id); await loadMessages(); } catch (e) { setError(e.message); } }}>Reprocessar</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── FISCAL ─────────────────────────────────────────────── */}
      {tab === 'fiscal' && (
        <div>
          {fiscal.length === 0 ? <EmptyState small title="Sem notas" description="Documentos fiscais aparecem aqui após pagamentos (quando a emissão estiver configurada)." /> : (
            <div className="clients-table-wrap"><table className="data-table">
              <thead><tr><th>Tipo</th><th>Número</th><th>Valor</th><th>Status</th><th>Erro</th><th>Ações</th></tr></thead>
              <tbody>{fiscal.map((f) => (
                <tr key={f.id}>
                  <td>{f.document_type || '—'}</td><td>{f.number || '—'}</td><td>{fmtMoney(f.amount)}</td>
                  <td><span className="client-status-badge">{f.status}</span></td>
                  <td style={{ fontSize: 12, color: '#b45309', maxWidth: 260 }}>{f.error_message || '—'}</td>
                  <td>{['failed', 'rejected', 'pending_configuration'].includes(f.status) && <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={async () => { try { await retryFiscal(f.id); await loadFiscal(); } catch (e) { setError(e.message); } }}>Reprocessar</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── CUSTOS ─────────────────────────────────────────────── */}
      {tab === 'custos' && costs && (
        <div className="nx-form-section" style={{ maxWidth: 520 }}>
          <div className="nx-form-section-title">Consumo de serviços externos</div>
          <table className="data-table"><thead><tr><th>Tipo</th><th>Quantidade</th><th>Total</th></tr></thead>
            <tbody>
              {costs.by_kind.length === 0 && <tr><td colSpan="3" style={{ color: 'var(--text-muted)' }}>Sem custos no período.</td></tr>}
              {costs.by_kind.map((c) => <tr key={c.kind}><td>{c.kind}</td><td>{c.quantidade}</td><td>{fmtCost(c.total)}</td></tr>)}
            </tbody>
          </table>
          <p style={{ marginTop: 10, fontWeight: 700 }}>Total: {fmtCost(costs.total)}</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cobrado separadamente da mensalidade, conforme o consumo.</p>
        </div>
      )}
    </div>
  );
}
