FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS ui
WORKDIR /build/hq
COPY hq/package*.json ./
RUN npm ci --ignore-scripts
COPY hq/ ./
RUN npm run build

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production AGENT4_HOST=0.0.0.0 AGENT4_PORT=8782
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
COPY public/favicon.svg ./public/favicon.svg
COPY --from=ui /build/hq/dist/index.html ./public/hq.html
RUN mkdir -p /app/data && chmod 700 /app/data && chown -R node:node /app
USER node
EXPOSE 8782
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:8782/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/hq-server.js"]
