# syntax=docker/dockerfile:1

# ── Etapa 1: dependencias y build ────────────────────────────────────────
FROM node:20-alpine AS builder

# pnpm viene incluido en Node 20+ vía corepack
RUN corepack enable

WORKDIR /app

# Copiamos solo los manifiestos para aprovechar la caché de capas
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# El store de pnpm se cachea entre builds vía mount cache de BuildKit
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @ats/api...

# Copiamos el código fuente y construimos la API + su dependencia compartida
COPY tsconfig.base.json ./
COPY apps/api/ apps/api/
COPY packages/shared/ packages/shared/

RUN pnpm --filter @ats/shared build && pnpm --filter @ats/api build

# Eliminamos dependencias de desarrollo para la imagen final
RUN pnpm deploy --filter @ats/api --prod /out

# ── Etapa 2: imagen de ejecución ─────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

# Copiamos el artefacto empaquetado (solo deps de producción)
COPY --from=builder /out .

# Puerto de la aplicación
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

USER node

CMD ["node", "dist/main"]
