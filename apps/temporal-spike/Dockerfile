FROM node:22-bookworm-slim AS build
WORKDIR /workspace
COPY apps/temporal-spike/package.json apps/temporal-spike/package-lock.json ./
RUN npm ci
COPY apps/temporal-spike/src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/package-lock.json ./package-lock.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
