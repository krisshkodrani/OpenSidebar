FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/cloud-service/package.json apps/cloud-service/package.json
COPY packages/sandbox-contracts/package.json packages/sandbox-contracts/package.json
COPY packages/scenario-contracts/package.json packages/scenario-contracts/package.json
COPY packages/scenario-engine/package.json packages/scenario-engine/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter opensidebar-cloud-service...
COPY apps/cloud-service apps/cloud-service
COPY packages/sandbox-contracts packages/sandbox-contracts
COPY packages/scenario-contracts packages/scenario-contracts
COPY packages/scenario-engine packages/scenario-engine
COPY packages/shared-types packages/shared-types
RUN pnpm --filter opensidebar-cloud-service build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY apps/cloud-service/package.runtime.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /workspace/apps/cloud-service/dist ./dist
COPY --from=build /workspace/apps/cloud-service/migrations ./migrations
USER node
CMD ["node", "dist/server.js"]
