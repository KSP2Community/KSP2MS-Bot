FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD ["node", "src/weblate/health.js"]
CMD ["node", "index.js"]
