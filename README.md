# LocaCore

**LocaCore** · por TELUN — plataforma SaaS multi-tenant para **locadoras de veículos**
(frota, locações, clientes/locatários e **módulo financeiro**), construída sobre a
base multi-tenant do NexoCRM. O domínio de despachante (processos/multas) é
preservado e continua disponível por tenant.

## Stack
- **Frontend:** Next.js 14 (App Router), React 18 — `saas-multitenant/`
- **Backend:** Node.js + Express — `saas-multitenant/backend/`
- **Banco:** PostgreSQL (Neon), multi-tenant por JWT
- **Gráficos:** recharts · **PDF:** pdfkit

## Estrutura
```
saas-multitenant/
├── app/            # Frontend Next.js (dashboard, financeiro, multas, componentes)
│   ├── components/ # Design system (ui.jsx) + Sidebar/PageHeader
│   ├── multas/     # Área Despachantes (processos, clientes, agenda) + financeiro/
│   └── lib/        # Clientes de API
└── backend/        # Express (models, routes, services, middlewares, migrations)
    ├── migrations/ # SQL incremental idempotente
    └── services/finance/  # Regras financeiras puras + orquestração transacional
```

## Duas áreas do produto
- **Despachantes:** processos, clientes, empresas, prazos, agenda, leads, deferidos, histórico.
- **Financeiro** (admin): Visão Financeira (dashboard com gráficos), Caixa, Lançamentos,
  Faturamentos, Pagamentos, Recibos (PDF) e Configurações.

## Rodar localmente
```bash
# Backend (porta 5000)
cd saas-multitenant/backend
npm install
npm test          # suíte de testes (node --test)
node app.js       # requer DATABASE_URL e JWT_SECRET no .env

# Frontend (porta 3001)
cd saas-multitenant
npm install
npm run dev
```

## Módulo Financeiro
Documentação, migrations e rollback em [`saas-multitenant/FINANCEIRO_MVP.md`](saas-multitenant/FINANCEIRO_MVP.md).

## Demonstração local (sem banco)
`saas-multitenant/backend/demo-server.js` sobe o backend real sobre um Postgres em
memória (pg-mem) com dados de exemplo — apenas para visualização (`node demo-server.js`).
