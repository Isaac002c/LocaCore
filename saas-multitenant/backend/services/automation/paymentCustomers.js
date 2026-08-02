// =============================================================================
// paymentCustomers.js — Garante o cliente no provedor de cobrança (ex.: Asaas).
//
// O adapter Asaas exige `external_customer_id` para gerar a cobrança. Aqui
// resolvemos isso de forma idempotente: procura o mapeamento salvo; se não há,
// cria o customer no provedor (com nome + CPF/CNPJ + e-mail do cliente) e guarda
// o id em payment_customers. Sandbox e provedores sem createCustomer são no-op.
// =============================================================================

const M = require('../../models/automationModels');
const clientModel = require('../../models/clientModels');

/**
 * @param {string} tenant_id
 * @param {object} provider  adapter de pagamento (getPaymentProvider)
 * @param {object} ctx       { client_id, client_name, client_phone }
 * @returns {Promise<string|null>} external_customer_id (ou null se não aplicável)
 */
async function ensurePaymentCustomer(tenant_id, provider, ctx = {}) {
  if (!provider || provider.isSandbox || typeof provider.createCustomer !== 'function') return null;
  const client_id = ctx.client_id;
  if (!client_id) return null;

  const existing = await M.getPaymentCustomer(tenant_id, provider.name, client_id);
  if (existing) return existing.external_customer_id;

  // Carrega o cadastro completo (o join da locação só traz nome/telefone; o Asaas
  // precisa de CPF/CNPJ e e-mail).
  const client = await clientModel.getClientById(client_id, tenant_id).catch(() => null);
  const created = await provider.createCustomer({
    name: (client && client.name) || ctx.client_name,
    cpfCnpj: client && client.cpf,
    email: client && client.email,
    phone: (client && client.phone) || ctx.client_phone,
  });
  if (!created || !created.external_id) return null;

  await M.savePaymentCustomer({
    tenant_id, provider: provider.name, client_id, external_customer_id: created.external_id,
  });
  return created.external_id;
}

module.exports = { ensurePaymentCustomer };
