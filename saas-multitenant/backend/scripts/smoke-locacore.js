#!/usr/bin/env node
'use strict';
// =============================================================================
// smoke-locacore.js — Smoke E2E do LocaCore contra uma API já em execução.
//
//   node scripts/smoke-locacore.js [BASE_URL] [EMAIL] [SENHA]
//   BASE_URL padrão: http://localhost:5000
//
// Percorre o fluxo real do §22: login → painel → frota → manutenção (bloqueia e
// libera o veículo) → locação → multa → estoque → agenda → relatórios/CSV →
// importação (preview) → financeiro (faturar/pagar/recibo) → automações.
//
// Sai com código 1 se qualquer passo falhar. Não altera dados fora do tenant do
// token informado.
// =============================================================================

const BASE = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const EMAIL = process.argv[3] || process.env.SMOKE_EMAIL || 'admin@demo.com';
const SENHA = process.argv[4] || process.env.SMOKE_PASSWORD || 'demo123';

let token = '';
let ok = 0; const falhas = [];
const marca = `SMOKE${Date.now().toString().slice(-6)}`;

const cor = { ok: '\x1b[32m', err: '\x1b[31m', dim: '\x1b[90m', off: '\x1b[0m' };

async function req(method, path, body, { raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  return { status: res.status, body: json, text };
}

async function passo(nome, fn) {
  try {
    const detalhe = await fn();
    ok += 1;
    console.log(`${cor.ok}  OK ${cor.off} ${nome}${detalhe ? `${cor.dim} — ${detalhe}${cor.off}` : ''}`);
  } catch (err) {
    falhas.push({ nome, erro: err.message });
    console.log(`${cor.err} FALHA${cor.off} ${nome}${cor.dim} — ${err.message}${cor.off}`);
  }
}

const precisa = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log(`\nSmoke LocaCore · ${BASE}\n${'─'.repeat(60)}`);

  // ── Autenticação ─────────────────────────────────────────────────────────
  await passo('login', async () => {
    const r = await req('POST', '/auth/login', { email: EMAIL, password: SENHA });
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(r.body?.token, 'sem token na resposta');
    token = r.body.token;
    return r.body.tenant?.name || r.body.user?.email;
  });
  if (!token) { console.log('\nSem token: abortando.'); process.exit(1); }

  await passo('rejeita requisição sem token (401)', async () => {
    const r = await fetch(`${BASE}/api/reports/overview`);
    precisa(r.status === 401 || r.status === 403, `esperava 401/403, veio ${r.status}`);
    return `HTTP ${r.status}`;
  });

  // ── Painel ───────────────────────────────────────────────────────────────
  let overview;
  await passo('painel: indicadores consolidados', async () => {
    const r = await req('GET', '/api/reports/overview');
    precisa(r.status === 200, `HTTP ${r.status}`);
    overview = r.body.data;
    for (const g of ['fleet', 'rentals', 'hoje', 'multas', 'estoque', 'manutencoes', 'automacoes', 'financeiro']) {
      precisa(overview[g], `grupo ausente: ${g}`);
    }
    precisa(typeof overview.fleet.taxa_ocupacao === 'number', 'taxa_ocupacao deve ser número');
    return `frota=${overview.fleet.total} locações ativas=${overview.rentals.ativas}`;
  });

  await passo('painel: séries dos gráficos', async () => {
    const r = await req('GET', '/api/reports/dashboard-series');
    precisa(r.status === 200, `HTTP ${r.status}`);
    const s = r.body.data;
    for (const k of ['faturado_recebido', 'locacoes_por_status', 'ocupacao_frota', 'inadimplencia_por_faixa', 'receita_por_veiculo']) {
      precisa(Array.isArray(s[k]), `série ausente: ${k}`);
    }
    for (const d of s.faturado_recebido) {
      precisa(/^\d{4}-\d{2}-\d{2}$/.test(d.dia), `data inválida na série: ${d.dia}`);
    }
    return `${s.faturado_recebido.length} dia(s) na série`;
  });

  await passo('painel: filtro de período é respeitado', async () => {
    const r = await req('GET', '/api/reports/overview?from=2001-01-01&to=2001-12-31');
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(r.body.data.periodo.from === '2001-01-01', 'período não aplicado');
    precisa(r.body.data.financeiro.faturado_periodo === 0, 'período vazio deveria zerar o faturado');
    return 'período aplicado';
  });

  // ── Clientes (necessário antes das locações) ─────────────────────────────
  let cliente, locacao;
  await passo('clientes: obter um locatário', async () => {
    const r = await req('GET', '/api/clients');
    precisa(r.status === 200, `HTTP ${r.status}`);
    const lista = Array.isArray(r.body.data) ? r.body.data : r.body.data?.data;
    precisa(lista?.length, 'nenhum cliente disponível para o smoke');
    cliente = lista[0];
    return cliente.name;
  });

  // ── Frota ────────────────────────────────────────────────────────────────
  let veiculo;
  await passo('frota: criar veículo', async () => {
    const r = await req('POST', '/api/vehicles', {
      plate: marca.slice(0, 7), brand: 'Smoke', model: 'Teste', year: 2025,
      category: 'Hatch', daily_rate: 100, odometer: 1000, status: 'disponivel',
    });
    precisa(r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.text?.slice(0, 120)}`);
    veiculo = r.body.data;
    precisa(veiculo?.id, 'veículo sem id');
    return veiculo.plate;
  });

  await passo('frota: listar', async () => {
    const r = await req('GET', '/api/vehicles');
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(Array.isArray(r.body.data), 'esperava array');
    return `${r.body.data.length} veículo(s)`;
  });

  // ── Manutenção: bloqueia e libera o veículo (§8) ──────────────────────────
  let manutencao;
  await passo('manutenção: criar em andamento bloqueia o veículo', async () => {
    const r = await req('POST', '/api/maintenances', {
      vehicle_id: veiculo.id, type: 'Revisão', status: 'em_andamento',
      scheduled_date: new Date().toISOString().substring(0, 10),
      odometer_scheduled: 1000, cost: 250, supplier: 'Oficina Smoke',
    });
    precisa(r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.text?.slice(0, 120)}`);
    manutencao = r.body.data;
    const v = await req('GET', `/api/vehicles/${veiculo.id}`);
    precisa(v.body.data.status === 'manutencao', `status do veículo = ${v.body.data.status}`);
    return 'veículo em manutenção';
  });

  await passo('manutenção: veículo bloqueado NÃO pode ser locado (409)', async () => {
    const r = await req('POST', '/api/rentals', {
      client_id: cliente.id, vehicle_id: veiculo.id, status: 'reservado',
      start_date: '2027-01-10', end_date: '2027-01-15', daily_rate: 100,
    });
    precisa(r.status === 409, `esperava 409, veio ${r.status} ${r.text?.slice(0, 120)}`);
    return r.body?.error?.slice(0, 50);
  });

  await passo('manutenção: concluir libera o veículo', async () => {
    const r = await req('PATCH', `/api/maintenances/${manutencao.id}/status`, { status: 'concluida' });
    precisa(r.status === 200, `HTTP ${r.status}`);
    const v = await req('GET', `/api/vehicles/${veiculo.id}`);
    precisa(v.body.data.status === 'disponivel', `status do veículo = ${v.body.data.status}`);
    return 'veículo disponível';
  });

  await passo('manutenção: segunda manutenção aberta impede a liberação (§8)', async () => {
    const a = await req('POST', '/api/maintenances', { vehicle_id: veiculo.id, type: 'Pneus', status: 'em_andamento' });
    const b = await req('POST', '/api/maintenances', { vehicle_id: veiculo.id, type: 'Freios', status: 'em_andamento' });
    precisa(a.body?.data?.id && b.body?.data?.id, 'falha ao criar as manutenções');
    await req('PATCH', `/api/maintenances/${a.body.data.id}/status`, { status: 'concluida' });
    const v = await req('GET', `/api/vehicles/${veiculo.id}`);
    precisa(v.body.data.status === 'manutencao', `veículo foi liberado indevidamente (status=${v.body.data.status})`);
    // Encerra a segunda para liberar o carro para os próximos passos.
    await req('PATCH', `/api/maintenances/${b.body.data.id}/status`, { status: 'concluida' });
    const v2 = await req('GET', `/api/vehicles/${veiculo.id}`);
    precisa(v2.body.data.status === 'disponivel', `não liberou após concluir todas (status=${v2.body.data.status})`);
    return 'bloqueio respeitado e liberado ao final';
  });

  // ── Locação ──────────────────────────────────────────────────────────────
  // (cliente já obtido acima)
  await passo('locação: criar reserva', async () => {
    const r = await req('POST', '/api/rentals', {
      client_id: cliente.id, vehicle_id: veiculo.id, status: 'reservado',
      start_date: '2027-02-10', end_date: '2027-02-15', daily_rate: 100, deposit_amount: 200,
    });
    precisa(r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.text?.slice(0, 160)}`);
    locacao = r.body.data;
    precisa(locacao?.id, 'locação sem id');
    return `${locacao.rental_number} · total ${locacao.total_amount}`;
  });

  await passo('locação: período sobreposto é recusado (409)', async () => {
    const r = await req('POST', '/api/rentals', {
      client_id: cliente.id, vehicle_id: veiculo.id, status: 'reservado',
      start_date: '2027-02-12', end_date: '2027-02-18', daily_rate: 100,
    });
    precisa(r.status === 409, `esperava 409, veio ${r.status}`);
    return r.body?.error?.slice(0, 60);
  });

  await passo('locação: listar com paginação { data, pagination }', async () => {
    const r = await req('GET', '/api/rentals?limit=5&offset=0');
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(Array.isArray(r.body.data), 'data deve ser array');
    precisa(r.body.pagination && typeof r.body.pagination.total === 'number', 'pagination ausente');
    return `total=${r.body.pagination.total}`;
  });

  await passo('locação: iniciar (em andamento) e devolver', async () => {
    const s = await req('PATCH', `/api/rentals/${locacao.id}/status`, { status: 'em_andamento' });
    precisa(s.status === 200, `iniciar: HTTP ${s.status} ${s.text?.slice(0, 120)}`);
    const d = await req('POST', `/api/rentals/${locacao.id}/return`, { return_odometer: 1500 });
    precisa(d.status === 200, `devolver: HTTP ${d.status} ${d.text?.slice(0, 120)}`);
    precisa(d.body.data.status === 'finalizado', `status final = ${d.body.data.status}`);
    return 'reservado → em andamento → finalizado';
  });

  // ── Financeiro ───────────────────────────────────────────────────────────
  let faturamento;
  await passo('financeiro: faturar a locação', async () => {
    const r = await req('POST', `/api/rentals/${locacao.id}/faturar`, {});
    precisa(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text?.slice(0, 160)}`);
    faturamento = r.body.data?.billing || r.body.data;
    precisa(faturamento?.id, 'faturamento sem id');
    return `R$ ${faturamento.final_amount}`;
  });

  await passo('financeiro: registrar pagamento', async () => {
    const r = await req('POST', '/api/financial/payments', {
      billing_id: faturamento.id, amount: Number(faturamento.final_amount), payment_method: 'pix',
    });
    precisa(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text?.slice(0, 200)}`);
    return 'pagamento confirmado';
  });

  await passo('financeiro: emitir recibo da locação', async () => {
    const r = await req('POST', `/api/rentals/${locacao.id}/recibo`, {});
    precisa(r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.text?.slice(0, 200)}`);
    precisa(r.body.data?.full_number, 'recibo sem número');
    return r.body.data.full_number;
  });

  await passo('financeiro: dashboard responde', async () => {
    const r = await req('GET', '/api/financial/summary/dashboard');
    precisa(r.status === 200, `HTTP ${r.status}`);
    return 'ok';
  });

  // ── Multas ───────────────────────────────────────────────────────────────
  await passo('multas: criar e listar', async () => {
    const c = await req('POST', '/api/rental-fines', {
      vehicle_id: veiculo.id, rental_id: locacao.id, client_id: cliente.id,
      fine_number: `${marca}-AI`, organ: 'DETRAN', original_amount: 130, admin_fee: 20,
      infraction_date: '2027-02-11', status: 'identificada',
    });
    precisa(c.status === 201 || c.status === 200, `criar: HTTP ${c.status} ${c.text?.slice(0, 160)}`);
    const l = await req('GET', '/api/rental-fines');
    precisa(l.status === 200 && Array.isArray(l.body.data), 'listagem inválida');
    return `${l.body.data.length} multa(s)`;
  });

  // ── Estoque ──────────────────────────────────────────────────────────────
  await passo('estoque: criar item, movimentar e bloquear saldo negativo', async () => {
    const i = await req('POST', '/api/inventory/items', { name: `Item ${marca}`, unit: 'un', quantity: 0, min_quantity: 2, unit_cost: 50 });
    precisa(i.status === 201 || i.status === 200, `criar item: HTTP ${i.status} ${i.text?.slice(0, 160)}`);
    const item = i.body.data;
    const e = await req('POST', '/api/inventory/movements', { item_id: item.id, type: 'entrada', quantity: 10, unit_cost: 50 });
    precisa(e.status === 201 || e.status === 200, `entrada: HTTP ${e.status} ${e.text?.slice(0, 160)}`);
    const neg = await req('POST', '/api/inventory/movements', { item_id: item.id, type: 'saida', quantity: 999 });
    precisa(neg.status === 409, `saldo negativo deveria ser recusado (veio ${neg.status})`);
    return 'entrada ok · saída acima do saldo recusada (409)';
  });

  // ── Agenda ───────────────────────────────────────────────────────────────
  await passo('agenda: eventos derivados + evento manual', async () => {
    const a = await req('GET', '/api/calendar-events/agenda?from=2027-02-01&to=2027-02-28');
    precisa(a.status === 200, `agenda: HTTP ${a.status}`);
    const c = await req('POST', '/api/calendar-events', {
      title: `Evento ${marca}`, event_date: '2027-02-12', type: 'outro',
    });
    precisa(c.status === 201 || c.status === 200, `criar evento: HTTP ${c.status} ${c.text?.slice(0, 160)}`);
    const lista = Array.isArray(a.body.data) ? a.body.data : (a.body.data?.events || []);
    return `${lista.length} evento(s) no período`;
  });

  // ── Relatórios ───────────────────────────────────────────────────────────
  await passo('relatórios: faturamento, locações e frota', async () => {
    for (const p of ['/api/reports/revenue', '/api/reports/rentals', '/api/reports/fleet']) {
      const r = await req('GET', p);
      precisa(r.status === 200, `${p}: HTTP ${r.status}`);
    }
    return '3 relatórios';
  });

  await passo('relatórios: CSV sai com datas válidas (não "Wed Jul 29")', async () => {
    const r = await req('GET', '/api/reports/rentals?format=csv', null, { raw: true });
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(/Locação;Status/.test(r.text), 'cabeçalho do CSV ausente');
    const datasRuins = r.text.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d/g);
    precisa(!datasRuins, `CSV com data inválida: ${datasRuins && datasRuins[0]}`);
    return `${r.text.split('\n').length - 1} linha(s)`;
  });

  // ── Importação ───────────────────────────────────────────────────────────
  await passo('importação: preview valida sem gravar', async () => {
    const csv = 'name;cpf;phone\nCliente Smoke;11144477735;(21) 90000-0000\n;;\n';
    const r = await req('POST', '/api/import/clientes/preview', { csv });
    precisa(r.status === 200, `HTTP ${r.status} ${r.text?.slice(0, 160)}`);
    const d = r.body.data;
    precisa(typeof d.total === 'number' && typeof d.valid_count === 'number', 'preview sem resumo');
    precisa(Array.isArray(d.errors), 'preview sem lista de erros por linha');
    return `total=${d.total} válidas=${d.valid_count} erros=${d.error_count}`;
  });

  await passo('importação: tenant_id do arquivo é ignorado', async () => {
    const csv = 'name;cpf;tenant_id\nInvasor;11144477735;outro-tenant\n';
    const r = await req('POST', '/api/import/clientes/preview', { csv });
    precisa(r.status === 200, `HTTP ${r.status}`);
    precisa(!JSON.stringify(r.body.data).includes('outro-tenant'), 'tenant_id do arquivo vazou para o preview');
    return 'coluna ignorada';
  });

  // ── Automações ───────────────────────────────────────────────────────────
  await passo('automações: painel (worker, scheduler, fila)', async () => {
    const r = await req('GET', '/api/automations/status');
    precisa(r.status === 200, `HTTP ${r.status} ${r.text?.slice(0, 160)}`);
    precisa(r.body.data?.settings, 'settings ausente no painel');
    return 'painel ok';
  });

  await passo('automações: execuções, mensagens e fiscal respondem', async () => {
    for (const p of ['/api/automations/runs', '/api/automations/messages', '/api/automations/fiscal']) {
      const r = await req('GET', p);
      precisa(r.status === 200, `${p}: HTTP ${r.status}`);
    }
    return '3 listagens';
  });

  // ── Isolamento ───────────────────────────────────────────────────────────
  await passo('segurança: token adulterado é rejeitado', async () => {
    const bom = token;
    token = `${bom.slice(0, -4)}xxxx`;
    const r = await req('GET', '/api/reports/overview');
    token = bom;
    precisa(r.status === 401 || r.status === 403, `esperava 401/403, veio ${r.status}`);
    return `HTTP ${r.status}`;
  });

  // ── Resultado ────────────────────────────────────────────────────────────
  const total = ok + falhas.length;
  console.log(`${'─'.repeat(60)}`);
  console.log(`${falhas.length ? cor.err : cor.ok}${ok}/${total} passos OK${cor.off}`);
  if (falhas.length) {
    console.log('\nFalhas:');
    falhas.forEach((f) => console.log(`  · ${f.nome}: ${f.erro}`));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => { console.error('Erro fatal no smoke:', err); process.exit(1); });
