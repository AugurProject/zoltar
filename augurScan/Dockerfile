FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY config ./config
COPY migrations ./migrations
COPY public ./public
COPY src ./src
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3000/health/ready');if(!r.ok)process.exit(1)"]
CMD ["bun", "src/server.ts"]
