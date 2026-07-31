# LocaCore — Roteiro de homologação e aceite (Rental Log)

**Produto:** LocaCore · **Fornecedor:** TELUN
**Ambiente:** https://locacore.chronostek.com.br (API: https://api-locacore.chronostek.com.br)

Este documento serve para o responsável pela Rental Log **testar o sistema com as
próprias mãos** e registrar o aceite. Cada item tem um resultado esperado
objetivo — se o que você vê for diferente, marque como falha e descreva.

---

## 0. Antes de começar

1. Cada pessoa recebeu e-mail e uma **senha provisória**.
2. No primeiro acesso o sistema **exige** a troca dessa senha. Isso é proposital:
   a senha inicial trafegou por mensagem, então é considerada exposta.
3. Depois de trocar, você será deslogado e entra com a senha nova. As sessões
   antigas deixam de valer no mesmo instante.

> **Vagas de usuário:** a Rental Log tem **4 usuários**. A conta de suporte da
> TELUN aparece na lista, **não ocupa vaga** e não pode ser editada nem excluída
> — ela existe para manutenção do sistema. Para trocar alguém da equipe, exclua
> um usuário e crie outro.

---

## 1. Roteiro de homologação

Marque `OK` ou `FALHA` em cada linha.

### Acesso
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 1.1 | Entrar com e-mail e senha provisória | Aparece a tela "Defina sua senha" | ☐ |
| 1.2 | Definir a nova senha | Volta ao login; entra com a nova | ☐ |
| 1.3 | Tentar entrar com a senha antiga | Recusado | ☐ |
| 1.4 | Recarregar a página já logado | Continua logado | ☐ |

### Painel
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 2.1 | Abrir **Painel** | 4 indicadores no topo: Disponíveis, Locações ativas, Atrasadas, Valor em aberto | ☐ |
| 2.2 | Clicar em "Atrasadas" | Abre Locações **já filtrado** por atrasadas | ☐ |
| 2.3 | Ver a lateral de alertas | Ou lista de pendências, ou "Operação em dia" | ☐ |
| 2.4 | Abrir a aba **Operação** | Frota, agenda e manutenções | ☐ |
| 2.5 | Abrir a aba **Financeiro** | Faturado/Recebido/Pendente + até 3 gráficos | ☐ |
| 2.6 | Trocar o período (7/30/90 dias) | Os números financeiros mudam | ☐ |

### Cadastros
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 3.1 | **Clientes** → novo cliente | Aparece na lista | ☐ |
| 3.2 | **Frota** → novo veículo | Status "Disponível" | ☐ |
| 3.3 | **Configurações → Categorias** → adicionar categoria | Aparece no cadastro de veículo | ☐ |

### Operação
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 4.1 | **Locações** → nova locação (cliente + veículo + período) | Criada como "Reservado" | ☐ |
| 4.2 | Criar outra locação **no mesmo veículo e período** | **Recusada** por conflito | ☐ |
| 4.3 | Iniciar a locação | Vira "Em andamento"; veículo fica "Alugado" | ☐ |
| 4.4 | Registrar a vistoria de retirada | Fica salva no contrato | ☐ |
| 4.5 | Gerar o contrato em PDF | Baixa com os dados da empresa e o período correto | ☐ |
| 4.6 | Devolver a locação (com hodômetro) | Vira "Finalizado"; veículo volta a "Disponível" | ☐ |

### Manutenção
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 5.1 | **Manutenções** → nova, status "Em andamento" | Veículo fica "Manutenção" | ☐ |
| 5.2 | Tentar locar esse veículo | **Recusado** | ☐ |
| 5.3 | Concluir a manutenção | Veículo volta a "Disponível" | ☐ |
| 5.4 | Abrir DUAS manutenções e concluir só uma | Veículo **continua** indisponível | ☐ |

### Multas, estoque e agenda
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 6.1 | **Multas** → nova multa vinculada a veículo/locação | Aparece na lista com prazo | ☐ |
| 6.2 | **Estoque** → novo item + entrada | Saldo aumenta | ☐ |
| 6.3 | Lançar saída maior que o saldo | **Recusada** | ☐ |
| 6.4 | **Agenda** | Retiradas e devoluções aparecem automaticamente | ☐ |
| 6.5 | Criar evento manual na agenda | Aparece junto dos derivados | ☐ |

### Financeiro
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 7.1 | Faturar uma locação | Gera faturamento com o valor da locação | ☐ |
| 7.2 | Registrar o pagamento | Faturamento fica quitado | ☐ |
| 7.3 | Emitir o recibo | PDF com numeração sequencial | ☐ |
| 7.4 | Conferir o Painel | "Recebido" reflete o pagamento | ☐ |

### Relatórios e importação
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 8.1 | **Relatórios** → período | Linhas com datas em **dd/mm/aaaa** | ☐ |
| 8.2 | Exportar CSV | Abre no Excel com acentos corretos | ☐ |
| 8.3 | **Importação** → colar CSV de clientes → Preview | Mostra válidas e erros por linha, **sem gravar** | ☐ |
| 8.4 | Confirmar a importação e repetir o mesmo arquivo | A 2ª vez **não duplica** | ☐ |

### Configurações e usuários
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 9.1 | **Configurações → Empresa** → preencher CNPJ e endereço → Salvar | Mensagem de sucesso | ☐ |
| 9.2 | Recarregar a página | Os dados continuam salvos | ☐ |
| 9.3 | **Configurações → Contratos** → editar cláusulas → Salvar | Novo contrato usa o texto novo | ☐ |
| 9.4 | **Configurações → Usuários** | Mostra "x/4" vagas | ☐ |
| 9.5 | Tentar criar o 5º usuário | **Recusado** com aviso de limite | ☐ |
| 9.6 | Tentar editar/excluir a conta de suporte TELUN | **Não permitido** | ☐ |
| 9.7 | **Configurações → Perfis** | Mostra o que cada perfil acessa | ☐ |
| 9.8 | **Configurações → Aparência** → trocar o tema | Muda e persiste ao recarregar | ☐ |

### Automações
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 10.1 | **Automações → Painel** | Worker e Scheduler "Ativo" | ☐ |
| 10.2 | Ver Jobs agendados | 5 jobs com intervalo e próxima execução | ☐ |
| 10.3 | Aba **Execuções** | Histórico com duração e status | ☐ |
| 10.4 | Aba **Dead-letter** | Vazia (ou com ações de reprocessar/cancelar) | ☐ |
| 10.5 | **Configurações → Integrações** | WhatsApp/Asaas/Fiscal com o que falta em cada um | ☐ |

### Permissões
| # | Passo | Resultado esperado | |
|---|---|---|---|
| 11.1 | Criar um usuário "Operador" e entrar com ele | **Não** vê Painel, Automações nem Configurações | ☐ |
| 11.2 | Digitar na barra de endereço a URL de Automações com esse usuário | Mensagem de acesso restrito | ☐ |

---

## 2. O que precisamos da Rental Log

Sem estes itens o sistema **funciona**, mas com dados de exemplo ou recursos
desligados. Nada aqui bloqueia o uso diário.

### Dados da empresa (bloqueiam recibo e contrato corretos)
- [ ] Razão social exata (como no CNPJ)
- [ ] CNPJ
- [ ] Endereço completo
- [ ] Telefone comercial
- [ ] E-mail comercial
- [ ] Logo (PNG/SVG com fundo transparente)

### Definição de equipe
- [ ] Confirmar os 4 usuários e o **perfil** de cada um
      (hoje os quatro estão como **Administrador** — todos veem Financeiro e
      Automações. Se não for a intenção, indicar quem deve ser Gerente/Operador.)
- [ ] Confirmar se o admin provisório `contato@chronostek.com.br` deve ser
      desativado após a Empresa assumir

### Carga inicial (importação por CSV)
- [ ] Clientes (nome, CPF/CNPJ, telefone, e-mail, endereço, CNH)
- [ ] Veículos (placa, marca, modelo, ano, cor, categoria, RENAVAM, diária, km)
- [ ] Locações em aberto (se houver contratos rodando hoje)
- [ ] Estoque inicial (item, unidade, quantidade, custo, mínimo)

### Regras de negócio (hoje sem definição escrita)
- [ ] Cláusulas definitivas do contrato de locação (revisão jurídica)
- [ ] Política de caução (valor, retenção, devolução)
- [ ] Política de atraso na devolução (tolerância, multa, diária extra)
- [ ] Regras de combustível (tanque cheio/cheio? cobrança por litro?)
- [ ] Regras de multa de trânsito (taxa administrativa, prazo de repasse)
- [ ] Regras de cobrança (dia da semana, vencimento, quantos lembretes)

### Credenciais externas
- [ ] **Meta WhatsApp**: token de acesso, phone_number_id, WABA ID, app secret,
      verify token, e templates aprovados pela Meta
- [ ] **Asaas**: chave de API, token de webhook, ambiente (sandbox/produção)

### Pendências do contador (não decidimos por ele)
- [ ] **Tipo de documento fiscal** — o sistema **não assume** NF-e nem NFS-e
- [ ] Inscrição municipal
- [ ] Código do município (IBGE)
- [ ] Regime tributário
- [ ] Código do serviço
- [ ] Alíquota
- [ ] Certificado digital (A1/A3)
- [ ] Provedor fiscal homologado

> Enquanto esses itens não vierem, os documentos fiscais ficam em
> **"pendente de configuração"**. O sistema nunca simula emissão fiscal.

---

## 3. Limitações conhecidas nesta entrega

| Item | Situação |
|---|---|
| WhatsApp, PIX/Asaas e fiscal | Adapter pronto e testado em sandbox; **desligados** por falta de credencial |
| Perfis dos 4 usuários | Todos como Administrador, por decisão registrada — revisar |
| Domínio do frontend | `locacore.chronostek.com.br` até existir o domínio TELUN |
| Relatório de manutenção/estoque | Consulta na tela; **exportação CSV** só em Locações e Faturamento |
| Agenda | Visões lista e semana; **mês** ainda não |

---

## 4. Suporte

- **E-mail:** suporte@telun.com.br
- **Backup:** diário e automático, com restauração testada
- **Conta de suporte:** a TELUN mantém um acesso próprio (visível na lista de
  usuários) para manutenção — ele não consome vaga da sua equipe

---

## 5. Aceite

> Declaro que executei o roteiro acima e que o sistema atende ao combinado,
> ressalvadas as limitações da seção 3.

**Responsável:** ______________________  **Data:** ____/____/______

**Itens em falha (se houver):**

```
```
