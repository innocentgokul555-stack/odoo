# Builds the website and runs everything on ONE port (4000):  docker build -t odoo . && docker run -p 4000:4000 odoo
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DB_PATH=/data/odoo.db
COPY backend/package*.json backend/
RUN npm ci --omit=dev --prefix backend
COPY backend backend
COPY --from=web /app/frontend/dist frontend/dist
VOLUME /data
EXPOSE 4000
# JWT_SECRET must be provided in production, for example:  docker run -e JWT_SECRET=a-long-random-text ...
# Add  -e SEED_DEMO=true  to fill a brand-new database with demo data.
CMD ["node", "backend/src/server.js"]
