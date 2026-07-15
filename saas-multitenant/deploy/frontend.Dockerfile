# Frontend Nexos (Next.js 14). Build de produção + next start na porta 3001.
# IMPORTANTE: no Next.js os rewrites (next.config.js) são avaliados no BUILD e
# gravados no routes-manifest. Por isso BACKEND_URL precisa estar definido no
# build (ARG) para o proxy /api e /auth apontar para o backend correto.
FROM node:20-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Destino do proxy interno (serviço "backend" na rede nexos). Injetado no build.
ARG BACKEND_URL=http://backend:5000
ENV BACKEND_URL=$BACKEND_URL

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ENV NODE_ENV=production
RUN npm run build

EXPOSE 3001
CMD ["npm", "start"]
