# ---- frontend build ----
FROM node:20-bookworm-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM node:20-bookworm-slim AS backend
WORKDIR /be
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=backend /be/node_modules ./node_modules
COPY --from=backend /be/dist ./dist
COPY --from=frontend /fe/dist ./public
VOLUME /app/data
EXPOSE 8080
CMD ["node", "dist/index.js"]
