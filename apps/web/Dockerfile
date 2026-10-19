# syntax=docker/dockerfile:1

# ── Etapa 1: build de producción del frontend ────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /app

# Manifiestos primero para cachear la instalación de dependencias
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @ats/web...

# Código fuente y build
COPY tsconfig.base.json ./
COPY apps/web/ apps/web/
COPY packages/shared/ packages/shared/

RUN pnpm --filter @ats/shared build && pnpm --filter @ats/web build

# ── Etapa 2: servidor estático con nginx ─────────────────────────────────
FROM nginx:1.27-alpine AS runner

# SPA fallback: cualquier ruta cae en index.html (React Router)
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ >/dev/null || exit 1
