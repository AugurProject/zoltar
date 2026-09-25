ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS workspace
WORKDIR /workspace
COPY package.json bun.lock ./
COPY augurScan/package.json ./augurScan/package.json
COPY bots/chaos/package.json ./bots/chaos/package.json
COPY bots/liquidator/package.json ./bots/liquidator/package.json
COPY bots/open-oracle-arbitrager/package.json ./bots/open-oracle-arbitrager/package.json
COPY bots/shared/package.json ./bots/shared/package.json
COPY shared/core/package.json ./shared/core/package.json
COPY shared/openOracle/package.json ./shared/openOracle/package.json
COPY shared/statoblast/package.json ./shared/statoblast/package.json
COPY shared/trading/package.json ./shared/trading/package.json
COPY shared/zoltar/package.json ./shared/zoltar/package.json
COPY solidity/package.json ./solidity/package.json
COPY ui/coreShared/package.json ./ui/coreShared/package.json
COPY ui/statoblast/package.json ./ui/statoblast/package.json
COPY ui/statoblastShared/package.json ./ui/statoblastShared/package.json
COPY ui/trading/package.json ./ui/trading/package.json
COPY ui/zoltar/package.json ./ui/zoltar/package.json
COPY ui/zoltarShared/package.json ./ui/zoltarShared/package.json

FROM workspace AS dependencies
RUN bun install --frozen-lockfile --production --filter augur-scan

FROM workspace AS browser-build
# Shared TypeScript compilation also needs the root workspace's type dependencies.
RUN bun install --frozen-lockfile
# Browser exports resolve to JavaScript; build the shared package from tracked source.
COPY shared/tsconfig.base.json shared/tsconfig.strict.json ./shared/
COPY shared/core/tsconfig.json ./shared/core/tsconfig.json
COPY shared/core/ts ./shared/core/ts
RUN bun run --cwd shared/core build
WORKDIR /workspace/augurScan
COPY augurScan/browser ./browser
COPY augurScan/scripts/build-browser.ts ./scripts/build-browser.ts
COPY augurScan/public ./public
RUN bun run build:browser

FROM workspace AS metadata-build
RUN bun install --frozen-lockfile --filter augur-scan --filter @zoltar/contracts
COPY solidity/contracts ./solidity/contracts
COPY solidity/ts/compile.ts ./solidity/ts/compile.ts
COPY solidity/ts/contractProjects.ts ./solidity/ts/contractProjects.ts
COPY augurScan/scripts ./augurScan/scripts
COPY augurScan/config/dependency-abis.json ./augurScan/config/dependency-abis.json
COPY augurScan/config/dependency-abi-sources.json ./augurScan/config/dependency-abi-sources.json
COPY docs/mainnet-deployment-addresses.json ./docs/mainnet-deployment-addresses.json
COPY docs/sepolia-deployment-addresses.json ./docs/sepolia-deployment-addresses.json
RUN bun run --cwd augurScan metadata:build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY package.json bun.lock ./
COPY augurScan/package.json ./augurScan/
COPY shared/core/package.json ./shared/core/
COPY --from=dependencies /workspace/augurScan/node_modules ./augurScan/node_modules
COPY --from=dependencies /workspace/shared/core/node_modules ./shared/core/node_modules
COPY augurScan/config ./augurScan/config
COPY --from=metadata-build /workspace/augurScan/config ./augurScan/config
COPY augurScan/schema.sql ./augurScan/schema.sql
COPY augurScan/migrations ./augurScan/migrations
COPY --from=browser-build /workspace/augurScan/public ./augurScan/public
COPY augurScan/scripts/verify-compose-source.ts ./augurScan/scripts/verify-compose-source.ts
COPY augurScan/scripts/verify-export-page.ts ./augurScan/scripts/verify-export-page.ts
COPY augurScan/scripts/report-abi-coverage.ts ./augurScan/scripts/report-abi-coverage.ts
COPY augurScan/src ./augurScan/src
COPY shared/core/ts/evm/ ./shared/core/ts/evm/
COPY shared/core/ts/errors/ ./shared/core/ts/errors/
COPY shared/core/ts/math/ ./shared/core/ts/math/
COPY shared/core/ts/monitoring/ ./shared/core/ts/monitoring/
RUN mkdir -p /workspace/augurScan/logs /var/log/augurscan && chown -R bun:bun /workspace/augurScan/logs /var/log/augurscan
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3000/health/ready');if(!r.ok)process.exit(1)"]
CMD ["bun", "augurScan/src/server.ts"]
