// =============================================================================
// defaultTemplates.js — Modelos padrão de mensagem (semeados por tenant na 1ª vez).
// Textos configuráveis por tenant depois; variáveis {{...}} resolvidas no envio.
// =============================================================================

module.exports = [
  {
    kind: 'billing',
    name: 'Cobrança semanal',
    language: 'pt_BR',
    body:
      'Olá, {{nome_cliente}}. A cobrança referente à locação {{numero_locacao}}, veículo {{veiculo}}, está disponível.\n\n' +
      'Valor: {{valor}}\nVencimento: {{vencimento}}\n\nPIX: {{codigo_pix}}\n\n' +
      'Em caso de dúvida, entre em contato.',
  },
  {
    kind: 'reminder',
    name: 'Lembrete de pagamento',
    language: 'pt_BR',
    body:
      'Olá, {{nome_cliente}}. Ainda não identificamos o pagamento da cobrança referente à locação {{numero_locacao}}.\n\n' +
      'Valor pendente: {{valor}}\nVencimento: {{vencimento}}\n\nPIX: {{codigo_pix}}\n\n' +
      'Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.',
  },
  {
    kind: 'payment_confirmed',
    name: 'Pagamento confirmado',
    language: 'pt_BR',
    body:
      'Pagamento confirmado ✅\n\nRecebemos o pagamento de {{valor}} referente à locação {{numero_locacao}} ({{periodo}}).\n\nObrigado.',
  },
  {
    kind: 'document',
    name: 'Recibo / documento fiscal',
    language: 'pt_BR',
    body:
      'Olá, {{nome_cliente}}. Seu recibo/documento fiscal referente ao pagamento da locação {{numero_locacao}} já está disponível.\n\n' +
      'Documento: {{document_numero}}\n{{document_link}}',
  },
];
