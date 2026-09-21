# ─────────────────────────────────────────────────────────────────────────────
# ee.io — single-container deployment.
#
# The built frontend is served by the same Express process that answers /api,
# so there is one origin, no CORS surface, and no separate CDN to configure.
# ─────────────────────────────────────────────────────────────────────────────

# ---- build stage ------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Typecheck + bundle. Fails the image build if either breaks.
RUN npm run build


# ---- runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only — no vite, no vitest, no typescript.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save tsx@^4.19.2 \
 && npm cache clean --force

# The server runs TypeScript directly via tsx; ship sources plus the bundle.
COPY --from=build /app/dist   ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared

# Drop root. The app needs no write access to its own filesystem.
USER node

EXPOSE 8080
ENV API_PORT=8080

# Fail the container health check if the quote API stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
