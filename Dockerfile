# Host-agnostic container for Phase 6 (Azure Container Apps / App Service for
# Containers, or any container host). Not required for local dev or the demo.
FROM node:22-slim

WORKDIR /app

# Install production dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY . .

# The app stores its SQLite file here in single-file mode; for production prefer
# a managed DB (see docs/IT-DEPLOYMENT-GUIDE.md) and set DB_PATH / DATABASE_URL.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# REQUIRED at runtime (the app refuses to start in production without them):
#   -e SESSION_SECRET=<long random string>
#   -e ADMIN_USERNAME=<admin user>
#   -e ADMIN_PASSWORD_HASH=<output of: node scripts/hash-password.js "pw">
# This fail-fast is intentional — it prevents an insecure default-credential boot.
CMD ["node", "server/server.js"]
