# Host-agnostic container for Phase 6 (Azure Container Apps / App Service for
# Containers, or any container host). Not required for local dev or the demo.
FROM node:22-slim

WORKDIR /app

# Install production dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY . .

# SQLite single-file path, used only if DATABASE_URL is NOT set. On Azure set
# DATABASE_URL to a managed Postgres (see INSTALL.md) — then this volume is unused.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Recommended runtime settings (see INSTALL.md):
#   -e DATABASE_URL=postgresql://user:pass@host:5432/survey?sslmode=require
#   -e PUBLIC_URL=https://<your-app-url>
# The admin login defaults to admin/admin and is changed in the dashboard's
# Settings on first sign-in; the session secret is generated and stored on first run.
CMD ["node", "server/server.js"]
