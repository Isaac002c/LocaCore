Chronos Tech CRM

Sistema de CRM SaaS com arquitetura multitenant, voltado para gestão de leads, pipeline comercial e análise de performance.

Visão Geral

O Chronos Tech CRM é uma aplicação web que permite que múltiplas empresas utilizem a mesma instância do sistema com isolamento completo de dados. A proposta é oferecer uma base escalável para operação comercial, com foco em organização de leads e visibilidade do funil de vendas.

A aplicação é dividida em frontend (Next.js) e backend (Express), com persistência em PostgreSQL.

Stack
Frontend: Next.js 14 (App Router)
Backend: Node.js + Express
Banco de dados: PostgreSQL (Supabase)
Autenticação: JWT com cookies HTTP-only
Deploy: Vercel (frontend) e Render (backend)
Estrutura do Projeto
ChronosTechCRM/
└── saas-multitenant/
    ├── app/                    # Frontend (Next.js)
    │   ├── components/         # Componentes reutilizáveis
    │   ├── dashboard/          # Dashboard principal
    │   ├── leads/              # Módulo de leads
    │   ├── login/              # Autenticação
    │   ├── register/
    │   ├── layout.jsx
    │   ├── page.jsx
    │   └── globals.css
    │
    ├── backend/                # API (Express)
    │   ├── config/             # Configuração (DB, etc)
    │   ├── controllers/        # Regras de negócio
    │   ├── database/           # Scripts SQL
    │   ├── middlewares/        # Middlewares (tenant, auth)
    │   ├── models/             # Acesso a dados
    │   ├── routes/             # Rotas da API
    │   ├── services/           # Camada de serviço
    │   └── app.js              # Entry point do servidor
    │
    ├── .env
    ├── package.json
    └── README.md
Módulo de Leads

O módulo de leads concentra a maior parte da funcionalidade atual do sistema:

Overview: visão geral com métricas e distribuição de leads
Acquisition: análise de origem e conversão
Pipeline: gerenciamento visual do funil (Kanban)
Performance: acompanhamento de desempenho da equipe
Reports: geração de relatórios
Multitenancy

O isolamento de dados é feito por tenant utilizando middleware no backend.

Fluxo:

O usuário realiza login
O tenant_id é associado à sessão (cookie)
As requisições incluem o identificador do tenant
O backend filtra todas as operações com base nesse identificador

Middleware responsável: tenantContext.js

Execução local
Pré-requisitos
Node.js 18+
PostgreSQL (ou instância no Supabase)
Configuração

Criar arquivo .env na raiz do projeto:

DATABASE_URL=postgresql://postgres:[SENHA]@db.[PROJETO].supabase.co:5432/postgres
JWT_SECRET=sua_chave_secreta
PORT=3000
Banco de dados

Executar o script:

backend/database/leads_table.sql
Backend
cd saas-multitenant
node backend/app.js

Disponível em: http://localhost:3000

Frontend
cd saas-multitenant
npm run dev -- -p 3001

Disponível em: http://localhost:3001

Deploy

A aplicação está preparada para separação de serviços:

Frontend: Vercel
Backend: Render
Banco: Supabase
Variáveis de ambiente relevantes
DATABASE_URL
JWT_SECRET
FRONTEND_URL
CORS_ORIGIN
Roadmap
Módulo de contratos
Módulo financeiro
Controle de permissões (RBAC)
Integrações externas (webhooks)
Integração com canais de comunicação