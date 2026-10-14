ARG NODE_IMAGE=docker.io/library/node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
RUN addgroup --system --gid 1001 api \
  && adduser --system --uid 1001 --ingroup api api
COPY --from=builder --chown=api:api /app/dist ./dist
COPY --from=builder --chown=api:api /app/package.json ./package.json
COPY --from=production-dependencies --chown=api:api /app/node_modules ./node_modules
USER api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:4000/readyz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/server.js"]
