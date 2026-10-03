FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Local file storage is used only when AWS_ACCESS_KEY_ID is not set
RUN mkdir -p uploads signed
EXPOSE 3001
# Create/upgrade the schema (idempotent), seed the admin user if configured, start
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && exec node dist/index.js"]
