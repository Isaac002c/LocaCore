FROM node:20-alpine

# dumb-init: PID 1 correto — repassa sinais (SIGTERM) e recolhe zumbis
RUN apk add --no-cache dumb-init

WORKDIR /app

# Instala dependências de produção com lockfile
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia o código-fonte (node_modules excluído via .dockerignore)
COPY . .

EXPOSE 5000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "app.js"]
