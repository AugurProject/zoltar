FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /workspace
COPY augurScan/package.json augurScan/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY augurScan/package.json augurScan/bun.lock ./
COPY augurScan/config ./augurScan/config
COPY augurScan/migrations ./augurScan/migrations
COPY augurScan/public ./augurScan/public
COPY augurScan/src ./augurScan/src
COPY shared/ts/ethereum.ts ./shared/ts/ethereum.ts
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3000/health/ready');if(!r.ok)process.exit(1)"]
CMD ["bun", "augurScan/src/server.ts"]
