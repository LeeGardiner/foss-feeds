FROM node:26-alpine
WORKDIR /app

# tzdata so TZ=Europe/London resolves (DST-aware local time for the alert schedule)
RUN apk add --no-cache tzdata
ENV TZ=Europe/London

# Install exactly the locked deps first, for layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# App source
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Run unprivileged. A bind-mounted ./data must be writable by uid 1000 (node).
RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production
ENV PORT=3004
EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3004/health || exit 1

CMD ["node", "server.js"]
