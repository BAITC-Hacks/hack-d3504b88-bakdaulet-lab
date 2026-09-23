FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN node --test scripts/docker/check-start.mjs \
    && mkdir -p public \
    && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/app/storage/app.sqlite
# tsx and TypeScript are also needed at runtime for catalog:sync/next.config.ts.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/data/fixtures ./data/fixtures
COPY --from=build --chown=node:node /app/scripts/sync-catalog.ts ./scripts/sync-catalog.ts
COPY --from=build --chown=node:node /app/scripts/docker/start.mjs ./scripts/docker/start.mjs
COPY --from=build --chown=node:node /app/scripts/docker/healthcheck.mjs ./scripts/docker/healthcheck.mjs
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json /app/next.config.ts ./
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
# Check the Linux native binding and runtime loader in the final image.
RUN node --import tsx -e "const db = new (require('better-sqlite3'))(':memory:'); db.prepare('SELECT 1').get(); db.close(); require.resolve('next/dist/bin/next'); require.resolve('typescript')"
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 CMD ["node", "scripts/docker/healthcheck.mjs"]
CMD ["node", "scripts/docker/start.mjs"]
