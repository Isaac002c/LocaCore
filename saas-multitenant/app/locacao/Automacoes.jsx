'use client';

import { useState, useEffect } from 'react';
import {
  getAutomationStatus, getSettings, updateSettings, getRuns,
  runBilling, runDunning, runOutbox, runFiscalBatch,
  getMessages, retryMessage, getFiscalDocs, retryFiscal, getCosts,
  getConsole, getDeadLetter, cancelDeadLetter, manualDeadLetter,
  getReadiness, runDryRun, getCharges, retryCharge, getAutomationAudit,
  saveIntegrationSecrets, testIntegration, getFiscalCertificate, uploadFiscalCertificate,
  getTemplates, saveTemplate, confirmChargeManually, getChargeTimeline,
} from '../lib/automationsAPI';
import { getRentals } from '../lib/rentalsAPI';
import { MetricCard, PageHead, EmptyState } from '../components/ui';
import { fmtMoney, fmtDate } from './shared';
import { PageLoading, InlineError } from '../components/states';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const TABS = [
  { key: 'painel', label: 'Painel' },
  { key: 'prontidao', label: 'Prontidão' },
  { key: 'cobrancas', label: 'Cobranças' },
  { key: 'execucoes', label: 'Execuções' },
  { key: 'mensagens', label: 'Mensagens' },
  { key: 'templates', label: 'Templates' },
  { key: 'deadletter', label: 'Dead-letter' },
  { key: 'fiscal', label: 'Notas Fiscais' },
  { key: 'custos', label: 'Custos' },
  { key: 'auditoria', label: 'Auditoria' },
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
const localYmd = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const shiftYmd = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};
const chargeFilters = (preset) => {
  const today = localYmd();
  if (preset === 'today') return { date_from: today, date_to: today };
  if (preset === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const start = shiftYmd(today, weekday === 0 ? -6 : 1 - weekday);
    return { date_from: start, date_to: shiftYmd(start, 6) };
  }
  if (preset === 'upcoming') return { status: 'waiting_payment', date_from: today };
  if (preset === 'overdue') return { status: 'overdue' };
  if (preset === 'paid') return { status: 'paid' };
  if (preset === 'failed') return { status: 'failed' };
  return {};
};

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
  const [readiness, setReadiness] = useState(null);
  const [dryResult, setDryResult] = useState(null);
  const [charges, setCharges] = useState([]);
  const [chargeFilter, setChargeFilter] = useState('');
  const [auditRows, setAuditRows] = useState([]);
  const [activeRentals, setActiveRentals] = useState([]);
  const [secretDraft, setSecretDraft] = useState({});
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [certificate, setCertificate] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [confirmModal, setConfirmModal] = useState(null); // { charge, amount, payment_date, payment_method, notes }
  const [timeline, setTimeline] = useState(null); // { charge, rows }

  useEffect(() => { loadPanel(); }, []);

  const loadPanel = async () => {
    try {
      setLoading(true); setError(null);
      // O console traz tudo numa chamada; o status legado fica de reserva.
      const [c, s, r, ready] = await Promise.all([
        getConsole().catch(() => null),
        getAutomationStatus(),
        getRuns().catch(() => []),
        getReadiness().catch(() => null),
      ]);
      setConsoleData(c); setStatus(s); setSettings(c?.settings || s.settings); setRuns(c?.ultimas_execucoes || r);
      setReadiness(ready);
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
    try {
      const [d, rentals, cert] = await Promise.all([
        getSettings(), getRentals().catch(() => []), getFiscalCertificate().catch(() => null),
      ]);
      setSettings(d.settings); setValidation(d.fiscal_validation);
      setActiveRentals((rentals || []).filter((r) => ['em_andamento', 'atrasado'].includes(r.status)));
      setCertificate(cert);
    } catch (err) { setError(err.message); }
  };
  const loadMessages = async () => { try { setMessages(await getMessages({ status: msgFilter })); } catch (err) { setError(err.message); } };
  const loadFiscal = async () => { try { setFiscal(await getFiscalDocs({})); } catch (err) { setError(err.message); } };
  const loadCosts = async () => { try { setCosts(await getCosts()); } catch (err) { setError(err.message); } };
  const loadReadiness = async () => {
    try {
      const mode = settings?.automation_mode === 'off' ? 'global' : settings?.automation_mode;
      const ids = ['pilot', 'staged'].includes(mode) ? (settings?.pilot_rental_ids || []) : [];
      setReadiness(await getReadiness({ mode, rental_ids: ids }));
    } catch (err) { setError(err.message); }
  };
  const loadCharges = async () => { try { setCharges(await getCharges(chargeFilters(chargeFilter))); } catch (err) { setError(err.message); } };
  const loadAudit = async () => { try { setAuditRows(await getAutomationAudit({ limit: 200 })); } catch (err) { setError(err.message); } };
  const loadTemplates = async () => { try { setTemplates(await getTemplates()); } catch (err) { setError(err.message); } };

  const onTab = (k) => {
    setTab(k); setNotice(null); setError(null);
    if (k === 'config') loadConfig();
    if (k === 'mensagens') loadMessages();
    if (k === 'fiscal') loadFiscal();
    if (k === 'custos') loadCosts();
    if (k === 'painel') loadPanel();
    if (k === 'execucoes') loadPanel();
    if (k === 'deadletter') loadDead();
    if (k === 'prontidao') loadReadiness();
    if (k === 'cobrancas') loadCharges();
    if (k === 'auditoria') loadAudit();
    if (k === 'templates') loadTemplates();
  };

  const doRun = async (fn, label) => {
    try { setBusy(true); setNotice(null); const r = await fn(); setNotice(`${label}: ${JSON.stringify(r)}`); await loadPanel(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const executeBilling = async () => {
    try {
      setBusy(true); setError(null); setNotice(null);
      const result = await runBilling();
      if (result.skipped === 'already_ran') {
        setNotice(`Cobrança desta semana já executada (${result.period_start} a ${result.period_end}); nenhuma mensagem foi duplicada.`);
      } else if (result.skipped) {
        setError(`Cobrança não executada: ${result.skipped}. Revise a prontidão da automação.`);
      } else {
        const failed = Number(result.failed || 0) + Number(result.blocked || 0);
        const summary = `${result.charges_created || 0} cobrança(s) criada(s) e ${result.messages_enqueued || 0} mensagem(ns) colocada(s) na fila`;
        if (failed) setError(`${summary}. ${failed} cliente(s) exigem revisão; consulte os detalhes da execução.`);
        else setNotice(`${summary}. O worker enviará pelo WhatsApp dentro da janela configurada.`);
      }
      await loadPanel();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const saveSettings = async (patch) => {
    try {
      setBusy(true);
      const targetMode = patch.automation_mode;
      const needsActivation = ['pilot', 'staged', 'global'].includes(targetMode);
      const d = await updateSettings(needsActivation ? { ...patch, automation_mode: 'off' } : patch);
      setSettings(needsActivation ? { ...d.settings, automation_mode: targetMode } : d.settings);
      setValidation(d.fiscal_validation);
      setNotice(needsActivation
        ? 'Configurações salvas com a automação desligada. Valide a prontidão para ativar.'
        : 'Configurações salvas.');
    }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const setField = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? Number(e.target.value) : e.target.value);
    setSettings((s) => ({ ...s, [k]: v }));
  };
  const setNestedField = (root, key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setSettings((s) => ({ ...s, [root]: { ...(s[root] || {}), [key]: value } }));
  };

  const executeDryRun = async () => {
    try {
      setBusy(true); setError(null); setNotice(null);
      const ids = ['pilot', 'staged'].includes(settings?.automation_mode) ? settings.pilot_rental_ids : null;
      const result = await runDryRun(ids);
      setDryResult(result); setNotice(`Simulação concluída: ${result.summary.ready} prontas e ${result.summary.blocked} bloqueadas.`);
      await loadReadiness();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const activate = async () => {
    try {
      setBusy(true); setError(null);
      const d = await updateSettings({ automation_mode: settings.automation_mode });
      setSettings(d.settings); setNotice(`Automação ativada em modo ${d.settings.automation_mode}.`); await loadPanel();
    } catch (err) { setError(err.message); await loadReadiness(); } finally { setBusy(false); }
  };

  const saveSecrets = async (kind, names) => {
    try {
      setBusy(true); const values = {};
      names.forEach((name) => { const value = secretDraft[`${kind}:${name}`]; if (value) values[name] = value; });
      await saveIntegrationSecrets(kind, values);
      setSecretDraft((prev) => { const next = { ...prev }; names.forEach((name) => delete next[`${kind}:${name}`]); return next; });
      setNotice(`Credenciais de ${kind} armazenadas com criptografia.`); await loadReadiness();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const testProvider = async (kind) => {
    try { setBusy(true); const result = await testIntegration(kind); setNotice(`${kind}: conexão validada (${JSON.stringify(result)}).`); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const uploadCertificate = async () => {
    if (!certificateFile || !certificatePassword) return setError('Selecione o certificado e informe a senha.');
    try {
      setBusy(true); const meta = await uploadFiscalCertificate(certificateFile, certificatePassword);
      setCertificate(meta); setCertificatePassword(''); setCertificateFile(null);
      setNotice('Certificado validado e armazenado com criptografia.'); await loadReadiness();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  // Confirmação manual do pagamento (§49) — dispara o mesmo pipeline do webhook.
  const openConfirm = (charge) => setConfirmModal({ charge, amount: charge.amount, payment_date: localYmd(), payment_method: 'pix', notes: '' });
  const submitConfirm = async () => {
    if (!confirmModal) return;
    try {
      setBusy(true); setError(null);
      const r = await confirmChargeManually(confirmModal.charge.id, {
        amount: confirmModal.amount, payment_date: confirmModal.payment_date,
        payment_method: confirmModal.payment_method, notes: confirmModal.notes,
      });
      setConfirmModal(null);
      setNotice(r.kind === 'receipt' ? `Pagamento confirmado. Recibo ${r.document?.numero || ''} gerado.`
        : r.kind === 'nfse' && r.fiscal_status === 'authorized' ? `Pagamento confirmado. NFS-e ${r.document?.numero || ''} emitida e arquivada.`
        : r.kind === 'nfse' && r.fiscal_error_message ? `Pagamento confirmado, mas a NFS-e ficou pendente: ${r.fiscal_error_message}`
        : r.kind === 'nfse' ? `Pagamento confirmado. NFS-e em processamento (status: ${r.fiscal_status || 'pendente'}).`
        : 'Pagamento confirmado. Ative recibo/NFS-e nas Configurações para gerar o documento.');
      await loadCharges();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const openTimeline = async (charge) => {
    try { setBusy(true); setError(null); const rows = await getChargeTimeline(charge.id); setTimeline({ charge, rows: rows || [] }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const CONFIRMABLE = new Set(['waiting_payment', 'overdue', 'needs_attention', 'processing']);

  if (loading) return <PageLoading label="Carregando automações..." />;

  return (
    <div>
      <PageHead title="Automações" subtitle="Cobrança semanal, WhatsApp, confirmação de pagamento e emissão fiscal" />

      <div className="nx-seg" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => onTab(t.key)}>{t.label}</button>)}
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} onRetry={loadPanel} />
      {notice && <div style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 38%, transparent)', color: '#065f46', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', wordBreak: 'break-word' }}><span>{notice}</span><button className="btn-close" onClick={() => setNotice(null)}>✕</button></div>}

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
            <button className="btn-primary" disabled={busy} onClick={executeBilling}>Cobrar clientes selecionados</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runOutbox, 'Processar fila')}>Processar mensagens</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runDunning, 'Régua')}>Rodar inadimplência</button>
            <button className="btn-secondary" disabled={busy} onClick={() => doRun(runFiscalBatch, 'Lote fiscal')}>Lote fiscal</button>
            <button className="btn-secondary" disabled={loading} onClick={loadPanel}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>
      )}

      {/* ── EXECUÇÕES ──────────────────────────────────────────── */}
      {tab === 'prontidao' && (
        <div>
          <div className="nx-form-section" style={{ borderColor: readiness?.ready ? 'var(--success)' : 'var(--warning)' }}>
            <div className="nx-form-section-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>Prontidão da automação</span><strong>{readiness?.percentage ?? 0}%</strong>
            </div>
            <p className="nx-cfg-hint">A validação também acontece no backend. O botão de ativação permanece bloqueado enquanto existir pendência crítica.</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {(readiness?.checks || []).map((check) => (
                <div key={check.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-secondary)' }}>
                  <span>{check.ok ? '✓' : '✕'} {check.label}</span>
                  {!check.ok && <strong style={{ color: 'var(--danger)' }}>{check.count != null ? check.count : 'Pendente'}</strong>}
                </div>
              ))}
            </div>
            {(readiness?.activation?.blockers || []).length > 0 && (
              <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13 }}>
                Bloqueios: {readiness.activation.blockers.map((b) => b.count ? `${b.label} (${b.count})` : b.label).join('; ')}.
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button className="btn-secondary" disabled={busy} onClick={executeDryRun}>Executar Dry Run</button>
              <button className="btn-primary" disabled={busy || !readiness?.activation?.allowed || !['pilot', 'staged', 'global'].includes(settings?.automation_mode)} onClick={activate}>
                {readiness?.activation?.allowed ? 'Ativar automação' : 'Ativar automação — bloqueado'}
              </button>
              <button className="btn-secondary" disabled={busy} onClick={loadReadiness}>Atualizar prontidão</button>
            </div>
          </div>

          {dryResult && (
            <div className="nx-form-section">
              <div className="nx-form-section-title">Resultado da simulação</div>
              <div className="nx-kpi-grid">
                <MetricCard title="Locações" value={dryResult.summary.total} />
                <MetricCard title="Prontas" value={dryResult.summary.ready} />
                <MetricCard title="Bloqueadas" value={dryResult.summary.blocked} direction={dryResult.summary.blocked ? 'down' : undefined} />
                <MetricCard title="Valor previsto" value={fmtMoney(dryResult.summary.total_amount)} />
              </div>
              <div className="clients-table-wrap"><table className="data-table">
                <thead><tr><th>Cliente/locação</th><th>Veículo</th><th>Valor</th><th>Vencimento</th><th>Ações previstas</th><th>Bloqueios</th></tr></thead>
                <tbody>{dryResult.plans.map((p) => <tr key={p.rental_id}>
                  <td><strong>{p.client_name || '—'}</strong><div>{p.rental_number}</div></td><td>{p.vehicle_plate || '—'}</td>
                  <td>{p.amount ? fmtMoney(p.amount) : '—'}</td><td>{p.due_date}</td>
                  <td>
                    Pix {p.actions.checkout ? `✓ (${p.actions.checkout_provider})` : '—'} · NF {p.actions.fiscal ? `✓ (${p.actions.fiscal_trigger})` : '—'} · WhatsApp {p.actions.whatsapp ? '✓' : '—'}
                    {p.actions.whatsapp && <div>{p.actions.whatsapp_to || 'sem telefone'} · {p.actions.whatsapp_template || 'template ausente'}</div>}
                  </td>
                  <td style={{ color: p.ready ? 'var(--success)' : 'var(--danger)' }}>{p.ready ? 'Pronta' : p.blockers.map((b) => b.message).join('; ')}</td>
                </tr>)}</tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {tab === 'cobrancas' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <select value={chargeFilter} onChange={(e) => setChargeFilter(e.target.value)} className="clients-filter-select">
              <option value="">Todas</option>
              <option value="today">Hoje</option><option value="week">Semana</option><option value="upcoming">A vencer</option>
              <option value="overdue">Vencidas</option><option value="paid">Pagas</option><option value="failed">Falharam</option>
            </select>
            <button className="btn-secondary" onClick={loadCharges}>Filtrar</button>
          </div>
          <div className="clients-table-wrap"><table className="data-table">
            <thead><tr><th>ID</th><th>Cliente</th><th>Locação/veículo</th><th>Período</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Pix</th><th>NF</th><th>WhatsApp</th><th>Próxima tentativa</th><th>Ações</th></tr></thead>
            <tbody>{charges.length === 0 ? <tr><td colSpan="12"><EmptyState small title="Sem cobranças" description="As cobranças reais aparecem aqui depois do piloto." /></td></tr> : charges.map((charge) => <tr key={charge.id}>
              <td><strong>{charge.public_id || '—'}</strong></td><td>{charge.client_name || '—'}</td>
              <td>{charge.rental_number || '—'}<div>{charge.vehicle_plate || '—'}</div></td>
              <td>{fmtDate(charge.period_start)} a {fmtDate(charge.period_end)}</td><td>{fmtMoney(charge.amount)}</td><td>{fmtDate(charge.due_date)}</td>
              <td><span className="client-status-badge">{charge.status}</span>{charge.error_message && <div style={{ color: 'var(--danger)', maxWidth: 220 }}>{charge.error_message}</div>}</td>
              <td>{charge.payment_link ? <a href={charge.payment_link} target="_blank" rel="noreferrer">Abrir</a> : charge.pix_code ? 'Código disponível' : '—'}</td>
              <td>{charge.has_fiscal ? '✓' : '—'}</td><td>{charge.whatsapp_status || '—'}<div>{fmtDataHora(charge.last_message_at)}</div></td>
              <td>{fmtDataHora(charge.next_attempt_at)}</td>
              <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {charge.status === 'failed' && <button className="btn-secondary" onClick={async () => { try { await retryCharge(charge.id); await loadCharges(); } catch (e) { setError(e.message); } }}>Reprocessar</button>}
                {CONFIRMABLE.has(charge.status) && <button className="btn-secondary" disabled={busy} onClick={() => openConfirm(charge)}>{charge.client_name ? `${charge.client_name} — recebido` : 'Marcar recebido'}</button>}
                <button className="btn-secondary" disabled={busy} onClick={() => openTimeline(charge)}>Linha do tempo</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="clients-table-wrap"><table className="data-table">
          <thead><tr><th>Data</th><th>Evento</th><th>Status</th><th>Locação</th><th>Cobrança</th><th>Valor</th><th>Provider</th><th>Tentativa</th><th>Erro</th></tr></thead>
          <tbody>{auditRows.length === 0 ? <tr><td colSpan="9"><EmptyState small title="Sem eventos" description="A trilha será criada a cada simulação e execução." /></td></tr> : auditRows.map((row) => <tr key={row.id}>
            <td>{fmtDataHora(row.created_at)}</td><td>{row.event_type}</td><td>{row.status}</td><td>{row.rental_id || '—'}</td><td>{row.charge_id || '—'}</td>
            <td>{row.amount ? fmtMoney(row.amount) : '—'}</td><td>{row.provider || '—'}</td><td>{row.attempt}</td><td style={{ color: 'var(--danger)' }}>{row.error_message || '—'}</td>
          </tr>)}</tbody>
        </table></div>
      )}

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
            <div className="nx-form-section-title">Ativação gradual</div>
            <div className="form-row">
              <div className="form-group"><label>Modo</label><select value={settings.automation_mode || 'off'} onChange={setField('automation_mode')}>
                <option value="off">Desligado</option><option value="dry_run">Somente simulação</option><option value="pilot">Piloto (1 locação)</option><option value="staged">Lote controlado</option><option value="global">Todas as locações</option>
              </select></div>
              {settings.automation_mode === 'pilot' && <div className="form-group"><label>Locação piloto</label><select value={settings.pilot_rental_ids?.[0] || ''} onChange={(e) => setSettings((s) => ({ ...s, pilot_rental_ids: e.target.value ? [e.target.value] : [] }))}>
                <option value="">Selecione uma locação</option>{activeRentals.map((r) => <option key={r.id} value={r.id}>{r.rental_number} — {r.client_name}</option>)}
              </select></div>}
              {settings.automation_mode === 'staged' && <div className="form-group"><label>Quantidade máxima</label><select value={settings.rollout_limit || 1} onChange={setField('rollout_limit')}><option value={1}>1</option><option value={3}>3</option><option value={5}>5</option><option value={10}>10</option></select></div>}
            </div>
            {settings.automation_mode === 'staged' && <div className="form-group"><label>Locações deste lote</label><select multiple size={Math.min(8, Math.max(3, activeRentals.length))} value={settings.pilot_rental_ids || []} onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (option) => option.value);
              setSettings((s) => ({ ...s, pilot_rental_ids: selected }));
            }}>
              {activeRentals.map((r) => <option key={r.id} value={r.id}>{r.rental_number} — {r.client_name}{r.vehicle_plate ? ` — ${r.vehicle_plate}` : ''}</option>)}
            </select><p className="nx-cfg-hint">Selecione somente os clientes autorizados para o teste. O scheduler não incluirá outros registros.</p></div>}
            <p className="nx-cfg-hint">Salve as configurações, execute o Dry Run na aba Prontidão e só então ative o piloto. Produção nunca é habilitada automaticamente.</p>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Cobrança semanal</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.billing_enabled} onChange={setField('billing_enabled')} /> Ativar cobrança automática</label>
            <div className="form-row">
              <div className="form-group"><label>Dia da semana</label><select value={settings.billing_weekday} onChange={setField('billing_weekday')}>{WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
              <div className="form-group"><label>Hora</label><input type="number" min="0" max="23" value={settings.billing_hour} onChange={setField('billing_hour')} /></div>
              <div className="form-group"><label>Vencimento (dias)</label><input type="number" min="0" value={settings.billing_due_days} onChange={setField('billing_due_days')} /></div>
              <div className="form-group"><label>Fuso horário</label><input type="text" value={settings.billing_timezone || 'America/Sao_Paulo'} onChange={setField('billing_timezone')} /></div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!settings.billing_auto_create} onChange={setField('billing_auto_create')} /> Gerar cobrança automaticamente (senão, apenas fatura para revisão)</label>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">WhatsApp</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.whatsapp_enabled} onChange={setField('whatsapp_enabled')} /> Ativar envio de mensagens</label>
            <div className="form-row">
              <div className="form-group"><label>Provedor</label><select value={settings.whatsapp_provider} onChange={setField('whatsapp_provider')}><option value="null">Nenhum</option><option value="meta">Meta (Cloud API oficial)</option><option value="evolution">Evolution API</option></select></div>
              <div className="form-group"><label>Remetente</label><input type="text" value={settings.whatsapp_from || ''} onChange={setField('whatsapp_from')} placeholder="+55..." /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Janela início (h)</label><input type="number" min="0" max="23" value={settings.whatsapp_send_start_hour} onChange={setField('whatsapp_send_start_hour')} /></div>
              <div className="form-group"><label>Janela fim (h)</label><input type="number" min="1" max="24" value={settings.whatsapp_send_end_hour} onChange={setField('whatsapp_send_end_hour')} /></div>
              <div className="form-group"><label>Máx. lembretes</label><input type="number" min="0" value={settings.reminder_max} onChange={setField('reminder_max')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>API URL (Evolution)</label><input type="url" value={settings.whatsapp_config?.api_url || ''} onChange={setNestedField('whatsapp_config', 'api_url')} placeholder="https://..." /></div>
              <div className="form-group"><label>Instância</label><input type="text" value={settings.whatsapp_config?.instance || ''} onChange={setNestedField('whatsapp_config', 'instance')} /></div>
              <div className="form-group"><label>Phone Number ID</label><input type="text" value={settings.whatsapp_config?.phone_number_id || ''} onChange={setNestedField('whatsapp_config', 'phone_number_id')} /></div>
              <div className="form-group"><label>WABA ID</label><input type="text" value={settings.whatsapp_config?.waba_id || ''} onChange={setNestedField('whatsapp_config', 'waba_id')} /></div>
            </div>
            {settings.whatsapp_provider === 'evolution' && <div className="form-row">
              <div className="form-group"><label>Modo da Evolution</label><select value={settings.whatsapp_config?.provider_mode || 'cloud'} onChange={setNestedField('whatsapp_config', 'provider_mode')}><option value="cloud">Cloud API / templates oficiais</option><option value="baileys">WhatsApp Web / texto livre</option></select></div>
              {settings.whatsapp_config?.provider_mode === 'baileys' && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={settings.whatsapp_config?.unofficial_acknowledged === true} onChange={setNestedField('whatsapp_config', 'unofficial_acknowledged')} /> Estou ciente de que este modo não é a API oficial da Meta.</label>}
            </div>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={settings.whatsapp_config?.send_payment_confirmation !== false} onChange={setNestedField('whatsapp_config', 'send_payment_confirmation')} /> Enviar mensagem de pagamento confirmado</label>
            <div className="form-row">
              {(settings.whatsapp_provider === 'evolution' ? ['API_KEY', 'APP_SECRET', 'VERIFY_TOKEN'] : ['ACCESS_TOKEN', 'APP_SECRET', 'VERIFY_TOKEN']).map((name) => <div className="form-group" key={name}><label>{name}</label><input type="password" autoComplete="new-password" value={secretDraft[`whatsapp:${name}`] || ''} onChange={(e) => setSecretDraft((s) => ({ ...s, [`whatsapp:${name}`]: e.target.value }))} placeholder="••••••••" /></div>)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn-secondary" type="button" disabled={busy || settings.whatsapp_provider === 'null'} onClick={() => saveSecrets('whatsapp', settings.whatsapp_provider === 'evolution' ? ['API_KEY', 'APP_SECRET', 'VERIFY_TOKEN'] : ['ACCESS_TOKEN', 'APP_SECRET', 'VERIFY_TOKEN'])}>Salvar credenciais</button><button className="btn-secondary" type="button" disabled={busy || settings.whatsapp_provider === 'null'} onClick={() => testProvider('whatsapp')}>Testar conexão</button></div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tokens são criptografados no servidor e nunca retornam ao navegador. O modo Evolution/Cloud exige templates aprovados.</p>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Pagamento (cobrança/PIX)</div>
            <div className="form-row">
              <div className="form-group"><label>Provedor</label><select value={settings.payment_provider} onChange={setField('payment_provider')}><option value="null">Nenhum</option><option value="manual_pix">PIX direto — confirmar pelo botão Recebido</option><option value="infinitepay">InfinitePay</option><option value="asaas">Asaas (legado)</option></select></div>
              {settings.payment_provider === 'manual_pix' && <><div className="form-group"><label>Chave PIX</label><input type="text" value={settings.payment_config?.pix_key || ''} onChange={setNestedField('payment_config', 'pix_key')} placeholder="CPF, CNPJ, telefone, e-mail ou chave aleatória" /></div><div className="form-group"><label>Favorecido</label><input type="text" value={settings.payment_config?.pix_receiver_name || ''} onChange={setNestedField('payment_config', 'pix_receiver_name')} placeholder="Nome exibido na mensagem" /></div></>}
              {settings.payment_provider === 'infinitepay' && <><div className="form-group"><label>InfiniteTag</label><input type="text" value={settings.payment_config?.handle || ''} onChange={setNestedField('payment_config', 'handle')} placeholder="sua-infinite-tag" /></div><div className="form-group"><label>URL de retorno</label><input type="url" value={settings.payment_config?.redirect_url || ''} onChange={setNestedField('payment_config', 'redirect_url')} placeholder="https://..." /></div></>}
            </div>
            {settings.payment_provider === 'asaas' && <div className="form-row">{['KEY', 'WEBHOOK_TOKEN'].map((name) => <div className="form-group" key={name}><label>{name}</label><input type="password" autoComplete="new-password" value={secretDraft[`payment:${name}`] || ''} onChange={(e) => setSecretDraft((s) => ({ ...s, [`payment:${name}`]: e.target.value }))} /></div>)}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              {settings.payment_provider === 'asaas' && <button className="btn-secondary" type="button" disabled={busy} onClick={() => saveSecrets('payment', ['KEY', 'WEBHOOK_TOKEN'])}>Salvar credenciais</button>}
              <button className="btn-secondary" type="button" disabled={busy || settings.payment_provider === 'null'} onClick={() => testProvider('payment')}>Testar configuração</button>
            </div>
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Fiscal</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.fiscal_enabled} onChange={setField('fiscal_enabled')} /> Ativar emissão fiscal</label>
            <div className="form-row">
              <div className="form-group"><label>Modo</label><select value={settings.fiscal_mode} onChange={setField('fiscal_mode')}><option value="on_charge">Na geração da cobrança</option><option value="on_due_date">No vencimento</option><option value="after_payment">Após o pagamento</option><option value="weekly_batch">Lote semanal</option><option value="manual">Manual</option></select></div>
              <div className="form-group"><label>Tipo de documento</label><select value={settings.fiscal_document_type || ''} onChange={setField('fiscal_document_type')}><option value="">— definir com contador —</option><option value="nfse">NFS-e</option><option value="nfe">NF-e</option></select></div>
              <div className="form-group"><label>Ambiente</label><select value={settings.fiscal_environment} onChange={setField('fiscal_environment')}><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></div>
            </div>
            <div className="form-group" style={{ maxWidth: 360 }}><label>Provedor fiscal</label><select value={settings.fiscal_provider} onChange={setField('fiscal_provider')}><option value="null">Nenhum (pendente)</option><option value="nfse_nacional">NFS-e Nacional / SEFIN</option><option value="focusnfe">Focus NFe</option></select></div>
            <div className="form-row">
              <div className="form-group"><label>CNPJ</label><input value={settings.fiscal_config?.cnpj || ''} onChange={setNestedField('fiscal_config', 'cnpj')} /></div>
              <div className="form-group"><label>Razão social</label><input value={settings.fiscal_config?.razao_social || ''} onChange={setNestedField('fiscal_config', 'razao_social')} /></div>
              <div className="form-group"><label>Nome fantasia</label><input value={settings.fiscal_config?.nome_fantasia || ''} onChange={setNestedField('fiscal_config', 'nome_fantasia')} /></div>
              <div className="form-group"><label>Inscrição municipal</label><input value={settings.fiscal_config?.inscricao_municipal || ''} onChange={setNestedField('fiscal_config', 'inscricao_municipal')} /></div>
              <div className="form-group"><label>Inscrição estadual</label><input value={settings.fiscal_config?.inscricao_estadual || ''} onChange={setNestedField('fiscal_config', 'inscricao_estadual')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>CNAEs (separados por vírgula)</label><input value={Array.isArray(settings.fiscal_config?.cnaes) ? settings.fiscal_config.cnaes.join(', ') : ''} onChange={(e) => setSettings((s) => ({ ...s, fiscal_config: { ...(s.fiscal_config || {}), cnaes: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } }))} /></div>
              <div className="form-group"><label>E-mail fiscal</label><input type="email" value={settings.fiscal_config?.email_fiscal || ''} onChange={setNestedField('fiscal_config', 'email_fiscal')} /></div>
              <div className="form-group"><label>Telefone</label><input value={settings.fiscal_config?.telefone || ''} onChange={setNestedField('fiscal_config', 'telefone')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Logradouro</label><input value={settings.fiscal_config?.logradouro || ''} onChange={setNestedField('fiscal_config', 'logradouro')} /></div>
              <div className="form-group"><label>Número</label><input value={settings.fiscal_config?.numero || ''} onChange={setNestedField('fiscal_config', 'numero')} /></div>
              <div className="form-group"><label>Complemento</label><input value={settings.fiscal_config?.complemento || ''} onChange={setNestedField('fiscal_config', 'complemento')} /></div>
              <div className="form-group"><label>Bairro</label><input value={settings.fiscal_config?.bairro || ''} onChange={setNestedField('fiscal_config', 'bairro')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>CEP</label><input value={settings.fiscal_config?.cep || ''} onChange={setNestedField('fiscal_config', 'cep')} /></div>
              <div className="form-group"><label>Município</label><input value={settings.fiscal_config?.nome_municipio || ''} onChange={setNestedField('fiscal_config', 'nome_municipio')} /></div>
              <div className="form-group"><label>UF</label><input maxLength={2} value={settings.fiscal_config?.uf || ''} onChange={setNestedField('fiscal_config', 'uf')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Código IBGE</label><input value={settings.fiscal_config?.municipio || ''} onChange={setNestedField('fiscal_config', 'municipio')} /></div>
              <div className="form-group"><label>Regime tributário</label><input value={settings.fiscal_config?.regime_tributario || ''} onChange={setNestedField('fiscal_config', 'regime_tributario')} /></div>
              <div className="form-group"><label>Código nacional</label><input value={settings.fiscal_config?.codigo_tributacao_nacional || ''} onChange={setNestedField('fiscal_config', 'codigo_tributacao_nacional')} placeholder="Ex.: 99.04.01 — confirmar contador" /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Código municipal</label><input value={settings.fiscal_config?.codigo_servico || ''} onChange={setNestedField('fiscal_config', 'codigo_servico')} /></div>
              <div className="form-group"><label>Alíquota</label><input type="number" step="0.0001" value={settings.fiscal_config?.aliquota ?? ''} onChange={setNestedField('fiscal_config', 'aliquota')} /></div>
              <div className="form-group"><label>Código NBS</label><input value={settings.fiscal_config?.codigo_nbs || ''} onChange={setNestedField('fiscal_config', 'codigo_nbs')} placeholder="Ex.: 1.1101.11.00" /></div>
              <div className="form-group"><label>Atividade Simples Nacional</label><input value={settings.fiscal_config?.codigo_atividade_simples_nacional || ''} onChange={setNestedField('fiscal_config', 'codigo_atividade_simples_nacional')} placeholder="11 para locação sem ISS" /></div>
              <div className="form-group"><label>CST IBS/CBS</label><input value={settings.fiscal_config?.cst_ibs_cbs || ''} onChange={setNestedField('fiscal_config', 'cst_ibs_cbs')} /></div>
              <div className="form-group"><label>Classificação tributária</label><input value={settings.fiscal_config?.classificacao_tributaria || ''} onChange={setNestedField('fiscal_config', 'classificacao_tributaria')} /></div>
              <div className="form-group"><label>Tratamento ISS</label><input value={settings.fiscal_config?.tratamento_iss || ''} onChange={setNestedField('fiscal_config', 'tratamento_iss')} /></div>
            </div>
            {settings.fiscal_provider === 'nfse_nacional' && <p className="nx-cfg-hint">A conexão usa somente os endpoints oficiais da SEFIN Nacional, com mTLS e o certificado A1 deste tenant. URLs personalizadas não são aceitas.</p>}
            {settings.fiscal_provider === 'focusnfe' && <div className="form-row"><div className="form-group"><label>Token Focus NFe</label><input type="password" autoComplete="new-password" value={secretDraft['fiscal:TOKEN'] || ''} onChange={(e) => setSecretDraft((s) => ({ ...s, 'fiscal:TOKEN': e.target.value }))} /></div><button className="btn-secondary" type="button" disabled={busy} onClick={() => saveSecrets('fiscal', ['TOKEN'])}>Salvar token</button></div>}
            <div className="form-row" style={{ alignItems: 'flex-end' }}>
              <div className="form-group"><label>Certificado A1 (.pfx/.p12)</label><input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setCertificateFile(e.target.files?.[0] || null)} /></div>
              <div className="form-group"><label>Senha do certificado</label><input type="password" autoComplete="new-password" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} /></div>
              <button className="btn-secondary" type="button" disabled={busy || !certificateFile || !certificatePassword} onClick={uploadCertificate}>Validar e armazenar</button>
            </div>
            {certificate && <p className="nx-cfg-hint">Certificado armazenado: {certificate.filename}. Validade: {fmtDate(certificate.valid_until)}. O arquivo e a senha não podem ser baixados.</p>}
            <button className="btn-secondary" type="button" disabled={busy || settings.fiscal_provider === 'null'} onClick={() => testProvider('fiscal')}>Validar configuração fiscal</button>
            {validation && !validation.ok && (
              <div style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 38%, transparent)', color: 'var(--warning)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                Emissão fiscal bloqueada. {validation.missing?.length ? `Faltando: ${validation.missing.join(', ')}. ` : ''}
                {(validation.blockers || []).map((blocker) => blocker.message).join(' ')} Sem provedor, certificado e validação oficiais, nenhuma nota produtiva é emitida.
              </div>
            )}
          </div>

          <div className="nx-form-section">
            <div className="nx-form-section-title">Recibos e documentos fiscais</div>
            <p className="nx-cfg-hint">Regra do contador: até a data de obrigatoriedade, o pagamento confirmado gera <strong>recibo</strong>; a partir dela, <strong>NFS-e</strong>. A emissão é sempre depois do pagamento (§7/§8/§9).</p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.receipts_enabled} onChange={setField('receipts_enabled')} /> Gerar recibo automático após o pagamento <span style={{ color: 'var(--text-muted)' }}>(funciona já, sem InfinitePay/certificado)</span></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.nfse_enabled} onChange={setField('nfse_enabled')} /> Emitir NFS-e automática a partir da data <span style={{ color: 'var(--text-muted)' }}>(exige certificado A1 + provedor fiscal)</span></label>
            {settings.payment_provider !== 'manual_pix' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={!!settings.payments_enabled} onChange={setField('payments_enabled')} /> Criar cobrança no provedor externo (InfinitePay)</label>}
            {settings.payment_provider === 'manual_pix' && <p className="nx-cfg-hint">O sistema enviará somente a chave PIX e aguardará um usuário autorizado clicar em “Recebido”. Nenhum webhook poderá dar baixa nesse modo.</p>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={settings.document_auto_send !== false} onChange={setField('document_auto_send')} /> Enviar o recibo/NFS-e ao cliente pelo WhatsApp</label>
            <div className="form-row">
              <div className="form-group"><label>NFS-e obrigatória a partir de</label><input type="date" value={String(settings.nfse_mandatory_from || '').slice(0, 10)} onChange={setField('nfse_mandatory_from')} /></div>
            </div>
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
      {tab === 'templates' && (
        <div>
          <p className="nx-cfg-hint">Cadastre o nome aprovado no provedor. Os nomes não são fixos no código e podem variar por tenant.</p>
          {templates.map((template, index) => <div className="nx-form-section" key={template.id || template.kind}>
            <div className="nx-form-section-title">{({ billing: 'Cobrança', reminder: 'Lembrete', payment_confirmed: 'Pagamento confirmado', document: 'Recibo / documento fiscal' })[template.kind] || template.kind}</div>
            <div className="form-row">
              <div className="form-group"><label>Nome interno</label><input value={template.name || ''} onChange={(e) => setTemplates((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} /></div>
              <div className="form-group"><label>Template aprovado no provedor</label><input value={template.provider_template_id || ''} onChange={(e) => setTemplates((rows) => rows.map((row, i) => i === index ? { ...row, provider_template_id: e.target.value } : row))} placeholder="Ex.: cobranca_locacao" /></div>
              <div className="form-group"><label>Idioma</label><input value={template.language || 'pt_BR'} onChange={(e) => setTemplates((rows) => rows.map((row, i) => i === index ? { ...row, language: e.target.value } : row))} /></div>
            </div>
            <div className="form-group"><label>Texto usado no sandbox/fallback</label><textarea rows={4} value={template.body || ''} onChange={(e) => setTemplates((rows) => rows.map((row, i) => i === index ? { ...row, body: e.target.value } : row))} /></div>
            <button className="btn-secondary" disabled={busy} onClick={async () => { try { setBusy(true); await saveTemplate(template); setNotice('Template salvo.'); await loadTemplates(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>Salvar template</button>
          </div>)}
        </div>
      )}

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
              <thead><tr><th>Tipo</th><th>Número</th><th>Valor</th><th>Status</th><th>Pasta do cliente</th><th>Erro</th><th>Ações</th></tr></thead>
              <tbody>{fiscal.map((f) => (
                <tr key={f.id}>
                  <td>{f.document_type || '—'}</td><td>{f.number || '—'}</td><td>{fmtMoney(f.amount)}</td>
                  <td><span className="client-status-badge">{f.status}</span></td>
                  <td>{f.archived_document_url ? <a href={f.archived_document_url} target="_blank" rel="noreferrer">Abrir documento</a> : 'Pendente'}</td>
                  <td style={{ fontSize: 12, color: 'var(--warning)', maxWidth: 260 }}>{f.error_message || '—'}</td>
                  <td>{(['failed', 'rejected', 'pending_configuration'].includes(f.status) || (f.status === 'authorized' && !f.archived_document_id)) && <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={async () => { try { await retryFiscal(f.id); await loadFiscal(); } catch (e) { setError(e.message); } }}>{f.status === 'authorized' ? 'Arquivar novamente' : 'Reprocessar'}</button>}</td>
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

      {/* ── Confirmação manual do pagamento (§49) ─────────────────── */}
      {confirmModal && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => !busy && setConfirmModal(null)}>
          <div style={{ background: 'var(--surface, #16161f)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, maxWidth: 460, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Confirmar pagamento — {confirmModal.charge.public_id || confirmModal.charge.id}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Registra o recebimento e dispara recibo/NFS-e + envio do documento ao cliente.</p>
            <div className="form-group"><label>Valor (R$)</label><input type="number" step="0.01" min="0" value={confirmModal.amount} onChange={(e) => setConfirmModal((m) => ({ ...m, amount: e.target.value }))} /></div>
            <div className="form-row">
              <div className="form-group"><label>Data</label><input type="date" value={confirmModal.payment_date} onChange={(e) => setConfirmModal((m) => ({ ...m, payment_date: e.target.value }))} /></div>
              <div className="form-group"><label>Forma</label><select value={confirmModal.payment_method} onChange={(e) => setConfirmModal((m) => ({ ...m, payment_method: e.target.value }))}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option></select></div>
            </div>
            <div className="form-group"><label>Observação</label><input value={confirmModal.notes} onChange={(e) => setConfirmModal((m) => ({ ...m, notes: e.target.value }))} placeholder="opcional" /></div>
            <div className="form-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setConfirmModal(null)} disabled={busy}>Cancelar</button>
              <button className="btn-primary" onClick={submitConfirm} disabled={busy || !(Number(confirmModal.amount) > 0)}>Confirmar pagamento</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Linha do tempo da cobrança (§38) ──────────────────────── */}
      {timeline && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setTimeline(null)}>
          <div style={{ background: 'var(--surface, #16161f)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, maxWidth: 640, width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Linha do tempo — {timeline.charge.public_id || timeline.charge.id}</h3>
            {timeline.rows.length === 0 ? <EmptyState small title="Sem eventos" description="Nenhum evento registrado para esta cobrança." /> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 420, overflowY: 'auto' }}>
                {timeline.rows.map((row) => (
                  <li key={row.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDataHora(row.created_at)}</div>
                    <div><strong>{row.event_type}</strong> — {row.status}{row.error_message ? <span style={{ color: 'var(--danger)' }}> · {row.error_message}</span> : ''}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn-secondary" onClick={() => setTimeline(null)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
