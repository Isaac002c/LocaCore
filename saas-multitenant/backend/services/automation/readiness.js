'use strict';
// =============================================================================
// readiness.js — PRONTIDÃO DAS INTEGRAÇÕES (§13).
//
// Responde, para cada integração externa, o que já existe e o que ainda falta
// para ligar em produção. Regras:
//
//   · NUNCA devolve o valor de um secret — só se ele EXISTE (booleano);
//   · não inventa credencial nem simula prontidão: sem env configurada, o item
//     aparece como pendente, com a variável exata a preencher;
//   · o fiscal NUNCA assume NF-e ou NFS-e — o tipo de documento é uma decisão
//     do contador do cliente e aparece como pendência explícita enquanto não
//     for definido.
//
// A tela de Configurações > Integrações renderiza exatamente esta resposta.
// =============================================================================

const { getSecret } = require('./secrets');
const { validateConfig } = require('./providers/fiscal');

const temSecret = (scope, name, slug) => !!getSecret(scope, name, slug);

// Um item de checklist. `ok` = pronto; `env` = variável que resolve a pendência.
const item = (label, ok, { env = null, detalhe = null, depende = null } = {}) =>
  ({ label, ok: !!ok, env, detalhe, depende });

function statusGeral(itens, habilitado) {
  const obrigatorios = itens.filter((i) => !i.opcional);
  const faltando = obrigatorios.filter((i) => !i.ok).length;
  if (!habilitado) return 'desativado';
  if (faltando === 0) return 'pronto';
  if (faltando === obrigatorios.length) return 'nao_configurado';
  return 'parcial';
}

/**
 * @param {object} settings  automation_settings do tenant
 * @param {string} slug      slug do tenant (permite secret por tenant)
 */
function integrationsReadiness(settings = {}, slug = null) {
  const ambiente = process.env.NODE_ENV === 'production' ? 'producao' : 'homologacao';

  // ── WhatsApp (Meta Cloud API) ─────────────────────────────────────────────
  const waProvider = settings.whatsapp_provider || 'null';
  const waItens = [
    item('Adapter implementado', true, { detalhe: 'services/automation/providers/whatsapp.js' }),
    item('Provedor selecionado', waProvider === 'meta', { detalhe: waProvider === 'meta' ? 'Meta Cloud API' : 'Nenhum provedor real selecionado' }),
    item('Token de acesso', temSecret('WHATSAPP', 'META_TOKEN', slug), { env: 'WHATSAPP_META_TOKEN' }),
    item('ID do número (phone_number_id)', !!settings.whatsapp_from, { detalhe: 'Configurado em Automações > Configurações' }),
    item('Conta comercial (WABA)', !!settings.whatsapp_account_id, { detalhe: 'Configurado em Automações > Configurações' }),
    item('Segredo do webhook', temSecret('WHATSAPP', 'META_APP_SECRET', slug), { env: 'WHATSAPP_META_APP_SECRET' }),
    item('Token de verificação do webhook', temSecret('WHATSAPP', 'META_VERIFY_TOKEN', slug), { env: 'WHATSAPP_META_VERIFY_TOKEN' }),
    item('Templates aprovados pela Meta', false, { depende: 'Aprovação da Meta (fora do sistema)', detalhe: 'Cada template de cobrança precisa ser submetido e aprovado.' }),
  ];

  // ── Cobrança / PIX (Asaas) ────────────────────────────────────────────────
  const payProvider = settings.payment_provider || 'null';
  const payItens = [
    item('Adapter implementado', true, { detalhe: 'services/automation/providers/payment.js' }),
    item('Provedor selecionado', payProvider === 'asaas', { detalhe: payProvider === 'asaas' ? 'Asaas' : 'Nenhum provedor real selecionado' }),
    item('Chave de API', temSecret('PAYMENT', 'ASAAS_KEY', slug), { env: 'PAYMENT_ASAAS_KEY' }),
    item('Token do webhook', temSecret('PAYMENT', 'ASAAS_WEBHOOK_TOKEN', slug), { env: 'PAYMENT_ASAAS_WEBHOOK_TOKEN' }),
    item('Ambiente da API', !!process.env.PAYMENT_ASAAS_BASE, { env: 'PAYMENT_ASAAS_BASE', detalhe: 'sandbox ou produção' }),
    item('Conciliação de pagamento', true, { detalhe: 'Webhook reaproveita o fluxo financeiro real (idempotente).' }),
  ];

  // ── Fiscal ────────────────────────────────────────────────────────────────
  const fiscalProvider = settings.fiscal_provider || 'null';
  const fiscalCfg = settings.fiscal_config || {};
  const validacao = validateConfig(settings) || {};
  const fiscalItens = [
    item('Adapter implementado', true, { detalhe: 'services/automation/providers/fiscal.js' }),
    item('Provedor selecionado', fiscalProvider !== 'null', { detalhe: fiscalProvider !== 'null' ? fiscalProvider : 'Nenhum provedor selecionado' }),
    item('Credencial do provedor', temSecret('FISCAL', `${String(fiscalProvider).toUpperCase()}_TOKEN`, slug), { env: `FISCAL_${String(fiscalProvider).toUpperCase()}_TOKEN` }),
    // Decisões do CONTADOR — o sistema não escolhe por ele.
    item('Tipo de documento', !!settings.fiscal_document_type, { depende: 'Contador', detalhe: 'NÃO assumimos NF-e nem NFS-e: depende da atividade e do município.' }),
    item('CNPJ da empresa', !!fiscalCfg.cnpj, { depende: 'Cliente' }),
    item('Inscrição municipal', !!fiscalCfg.inscricao_municipal, { depende: 'Contador' }),
    item('Município (código IBGE)', !!fiscalCfg.municipio, { depende: 'Contador' }),
    item('Regime tributário', !!fiscalCfg.regime_tributario, { depende: 'Contador' }),
    item('Código do serviço', !!fiscalCfg.codigo_servico, { depende: 'Contador' }),
    item('Alíquota', fiscalCfg.aliquota !== undefined && fiscalCfg.aliquota !== null && fiscalCfg.aliquota !== '', { depende: 'Contador' }),
    item('Certificado digital', !!fiscalCfg.certificado_configurado, { depende: 'Cliente', detalhe: 'A1/A3 conforme exigência do provedor.' }),
  ];

  return {
    ambiente,
    // O fiscal só sai de pending_configuration quando o adapter valida tudo.
    fiscal_validacao: validacao,
    integracoes: [
      {
        key: 'whatsapp',
        nome: 'WhatsApp (Meta Cloud API)',
        finalidade: 'Enviar cobranças e lembretes ao cliente.',
        habilitado: !!settings.whatsapp_enabled,
        provider: waProvider,
        status: statusGeral(waItens, !!settings.whatsapp_enabled),
        itens: waItens,
      },
      {
        key: 'pagamento',
        nome: 'Cobrança / PIX (Asaas)',
        finalidade: 'Gerar PIX e conciliar pagamentos automaticamente.',
        habilitado: payProvider === 'asaas',
        provider: payProvider,
        status: statusGeral(payItens, payProvider === 'asaas'),
        itens: payItens,
      },
      {
        key: 'fiscal',
        nome: 'Emissão fiscal',
        finalidade: 'Emitir documento fiscal após o pagamento.',
        habilitado: !!settings.fiscal_enabled,
        provider: fiscalProvider,
        status: statusGeral(fiscalItens, !!settings.fiscal_enabled),
        itens: fiscalItens,
        aviso: 'O sistema nunca simula emissão fiscal em produção: sem provedor, credencial e tipo de documento definidos com o contador, os documentos ficam em "pendente de configuração".',
      },
    ],
  };
}

module.exports = { integrationsReadiness };
