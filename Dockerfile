# OpenSidebar server-side stack (RFC LP-8).
#
# Runs the dependency-light integration services (browser MCP host + OpenClaw
# stub gateway) and, with the `viewer` build, the trace viewer / log server.
# The extension itself is NOT here — it runs in your real Chrome and reaches
# these services over published loopback ports.
#
# `node:22` (not -slim) ships build tools so native better-sqlite3 compiles.
FROM node:22

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    NX_DAEMON=false \
    CI=1

RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 7589 8787 18789

# Default command is overridden per service in docker-compose.yml.
CMD ["pnpm", "exec", "tsx", "openclaw/adapter/server.ts"]
