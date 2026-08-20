'use strict';

// =============================================================================
// seed-rental-log-fiscal.js — Configuração fiscal INICIAL do tenant Rental Log.
//
// Fonte de verdade: documentos oficiais enviados pelo cliente (cartão CNPJ,
// Ficha de Informações Cadastrais e Cadastro de Contribuinte da Prefeitura do
// Rio, e uma DANFSe real). NADA é inventado. Este script NÃO sobrescreve
// silenciosamente (§2/§50): por padrão faz DRY-RUN e mostra atual x proposto.
//
//   node scripts/seed-rental-log-fiscal.js --tenant <slug-ou-id>            # mostra
//   node scripts/seed-rental-log-fiscal.js --tenant <slug-ou-id> --commit   # aplica campos ausentes
//   node scripts/seed-rental-log-fiscal.js --tenant <slug-ou-id> --commit --force  # sobrescreve
//
// Regras do contador aplicadas: locação pura → código nacional 99.04.01, ISS não
// incidente; recibo até a obrigatoriedade da NFS-e (nfse_mandatory_from) e NFS-e
// a partir dela; multa/juros/caução/manutenção em categorias fiscais separadas.
// NFS-e fica PREPARADA porém DESLIGADA (nfse_enabled=false) até certificado A1 +
// validação — nunca emite nota simulada.
// =============================================================================

const pool = require('../config/db');
const M = require('../models/automationModels');

// Dados confirmados nos documentos oficiais (não alterar sem novo documento).
const RENTAL_LOG = {
  fiscal_config: {
    razao_social: 'RENTAL LOG SERVICE LTDA',
    cnpj: '45427279000122',
    inscricao_municipal: '13761116',
    regime_tributario: 'simples',            // Simples Nacional (optante ME/EPP)
    municipio: '3304557',                    // código IBGE - Rio de Janeiro/RJ
    nome_municipio: 'Rio de Janeiro',
    uf: 'RJ',
    cep: '22790670',
    logradouro: 'Rua Doutor Crespo',
    numero: '170',
    bairro: 'Recreio dos Bandeirantes',
    email_fiscal: 'rentallogservice@gmail.com',
    telefone: '2197511361',
    // Locação pura (config confirmada pelo contador; ajustável por tenant).
    codigo_tributacao_nacional: '99.04.01',
    tratamento_iss: 'nao_incide',
    // IBS/CBS sem tratamento aplicável hoje (Simples) — deixado vazio de propósito.
    cst_ibs_cbs: null,
    classificacao_tributaria: null,
  },
  settings: {
    fiscal_provider: 'nfse_nacional',
    fiscal_document_type: 'nfse',
    fiscal_mode: 'after_payment',            // emite depois do pagamento (§7)
    nfse_mandatory_from: '2026-12-01',       // recibo até aqui; NFS-e a partir daqui (§6)
    receipts_enabled: true,                  // recibo já funcional (§48)
    nfse_enabled: false,                     // NFS-e preparada, ligada só com certificado (§47)
    billing_timezone: 'America/Sao_Paulo',
  },
};

function parseArgs(argv) {
  const args = { commit: false, force: false, tenant: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--commit') args.commit = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--tenant') args.tenant = argv[++i];
  }
  return args;
}

async function resolveTenant(ref) {
  if (!ref) return null;
  const byId = /^[0-9a-f-]{36}$/i.test(ref)
    ? await pool.query('SELECT id, slug, name FROM tenants WHERE id=$1', [ref]) : { rows: [] };
  if (byId.rows[0]) return byId.rows[0];
  const bySlug = await pool.query('SELECT id, slug, name FROM tenants WHERE slug=$1', [ref]);
  return bySlug.rows[0] || null;
}

// Preenche apenas as chaves ausentes/vazias, salvo --force (§2/§50).
function mergeConfig(current = {}, proposed, force) {
  const out = { ...current };
  const changes = [];
  for (const [k, v] of Object.entries(proposed)) {
    if (v === null || v === undefined) continue;
    const cur = current[k];
    const empty = cur === undefined || cur === null || cur === '';
    if (empty || (force && String(cur) !== String(v))) {
      out[k] = v;
      changes.push(`${k}: ${empty ? '(vazio)' : cur} -> ${v}`);
    }
  }
  return { out, changes };
}

async function main() {
  const args = parseArgs(process.argv);
  const tenant = await resolveTenant(args.tenant);
  if (!tenant) {
    console.error('Tenant não encontrado. Use --tenant <slug-ou-id>. Ex.: --tenant rental-log');
    process.exit(1);
  }
  console.log(`\nTenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`);

  const settings = await M.ensureSettings(tenant.id);
  const cfgMerge = mergeConfig(settings.fiscal_config || {}, RENTAL_LOG.fiscal_config, args.force);

  const settingsChanges = [];
  const settingsPatch = {};
  for (const [k, v] of Object.entries(RENTAL_LOG.settings)) {
    const cur = settings[k];
    const empty = cur === undefined || cur === null || cur === '' || cur === false;
    if (empty || (args.force && String(cur) !== String(v))) { settingsPatch[k] = v; settingsChanges.push(`${k}: ${cur} -> ${v}`); }
  }

  console.log('\n== fiscal_config (campos a definir) ==');
  console.log(cfgMerge.changes.length ? cfgMerge.changes.join('\n') : '(nada a alterar)');
  console.log('\n== automation_settings (campos a definir) ==');
  console.log(settingsChanges.length ? settingsChanges.join('\n') : '(nada a alterar)');
  console.log('\n== categorias fiscais (defaults reutilizáveis) ==');
  const cats = await M.listFiscalCategoryMappings(tenant.id);
  console.log(`existentes: ${cats.length ? cats.map((c) => c.category_key).join(', ') : 'nenhuma (serão semeadas)'}`);

  if (!args.commit) {
    console.log('\nDRY-RUN. Reveja acima e rode novamente com --commit para aplicar (ou --commit --force para sobrescrever).');
    await pool.end?.();
    return;
  }

  await M.ensureDefaultFiscalCategories(tenant.id);
  if (Object.keys(settingsPatch).length || cfgMerge.changes.length) {
    await M.updateSettings(tenant.id, { ...settingsPatch, fiscal_config: cfgMerge.out });
  }
  console.log('\nAplicado. Recibos já podem operar; NFS-e permanece desligada até o certificado A1 (fiscal:configure).');
  await pool.end?.();
}

main().catch((err) => { console.error('Falha:', err.message); process.exit(1); });
