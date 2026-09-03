# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://flightbuddy:flightbuddy@localhost:5432/flightbuddy
ENV AUTH_SECRET=build-time-secret
# next build + worker/seed bundles (see scripts/bundle-runtime.mjs)
RUN npm run build

# Self-contained Prisma CLI (+ transitive deps like effect) for migrate deploy.
FROM base AS prisma-cli
WORKDIR /prisma-cli
RUN npm init -y \
  && npm install prisma@6.19.3 --omit=dev \
  && rm -rf /root/.npm

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3377
WORKDIR /app

# Next standalone already ships a trimmed node_modules for the web app + worker client.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Schema for migrate; CLI lives in /prisma-cli so it keeps its own dependency tree.
COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /prisma-cli /prisma-cli

# Bundled worker + seed (no tsx / no full app node_modules).
COPY --from=builder /app/dist/worker.cjs ./dist/worker.cjs
COPY --from=builder /app/dist/seed.cjs ./dist/seed.cjs

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh \
  && useradd --system --uid 1001 nextjs \
  && chown -R nextjs:nextjs /app /prisma-cli
USER nextjs
EXPOSE 3377
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["app"]
