# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json prisma.config.ts ./
COPY scripts/env.ts ./scripts/env.ts
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --legacy-peer-deps

FROM dependencies AS builder
COPY . .
RUN npm run build

# Build this target for a separately scheduled `tick` job. It needs only the
# database and ingestion configuration, never auth or model keys.
FROM dependencies AS worker
WORKDIR /app
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node tsconfig.json ./
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "scripts/tax-worker.ts", "tick"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
