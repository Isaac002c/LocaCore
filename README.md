# LocaCore

Plataforma SaaS multi-tenant para gestão de locadoras de veículos, com módulos de frota, locações, clientes, manutenção, operações e financeiro. O sistema também mantém funcionalidades de despachante para processos e multas.

## Funcionalidades

| Área | Recursos |
| --- | --- |
| Locação | Frota, contratos, vistorias, calendário, manutenção e estoque |
| Operação | Clientes, processos, multas, agenda, leads e documentos |
| Financeiro | Visão financeira, lançamentos, pagamentos, faturamentos e recibos em PDF |
| Gestão | Usuários, relatórios, importações e automações |

A API associa as operações ao tenant autenticado. O frontend encaminha as chamadas para a API por meio do proxy configurado no Next.js.

## Tecnologias

- **Frontend:** Next.js 16 e React 18.
- **Backend:** Node.js e Express 4, com API REST.
- **Banco de dados:** PostgreSQL.
- **Autenticação:** JWT.
- **Gráficos e documentos:** Recharts e PDFKit.

## Estrutura do repositório

~~~text
saas-multitenant/
├── app/                    Interface Next.js e módulos do produto
│   ├── locacao/             Frota, locações, vistorias e operações da locadora
│   ├── multas/              Processos, clientes, agenda e área financeira
│   └── lib/                 Clientes de API e funções compartilhadas
└── backend/
    ├── routes/              Endpoints da API
    ├── services/            Regras de negócio e integrações
    ├── middlewares/         Autenticação e contexto do tenant
    ├── migrations/          Evolução do schema do banco
    └── tests/               Testes do backend
~~~

## Executar localmente

### Requisitos

- Node.js e npm.
- PostgreSQL acessível pela aplicação.

### Configurar e iniciar a API

~~~powershell
Copy-Item saas-multitenant/backend/.env.example saas-multitenant/backend/.env
Set-Location saas-multitenant/backend
npm install
npm run dev
~~~

Configure DATABASE_URL e JWT_SECRET em backend/.env. A API inicia na porta 5000.

### Iniciar o frontend

Em outro terminal, a partir da raiz do repositório:

~~~powershell
Set-Location saas-multitenant
npm install
npm run dev
~~~

O frontend inicia em http://localhost:3001. Em desenvolvimento, o proxy do Next.js encaminha as rotas da API para http://localhost:5000. Para outro endereço, configure BACKEND_URL antes de iniciar o frontend.

## Testes e demonstração

~~~powershell
Set-Location saas-multitenant/backend
npm test
~~~

O backend inclui testes automatizados com Node.js. Para visualizar uma demonstração sem conectar a um banco PostgreSQL, há um servidor separado baseado em dados de exemplo:

~~~powershell
Set-Location saas-multitenant/backend
node demo-server.js
~~~

A demonstração local serve para exploração da interface e não substitui a configuração normal do sistema.

## Documentação

A documentação do módulo financeiro, incluindo migrations e rollback, está em [saas-multitenant/FINANCEIRO_MVP.md](saas-multitenant/FINANCEIRO_MVP.md).

## Segurança

Use valores próprios e fortes para DATABASE_URL e JWT_SECRET. Não publique arquivos .env, credenciais ou dados reais de clientes.
