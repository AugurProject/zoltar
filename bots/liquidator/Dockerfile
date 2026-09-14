ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

WORKDIR /source

COPY package.json bun.lock ./
COPY shared/ ./shared/
COPY tooling/ ./tooling/
COPY package.json bun.lock /source/
COPY augurScan/package.json /source/augurScan/package.json
COPY bots/chaos/package.json /source/bots/chaos/package.json
COPY bots/liquidator/package.json /source/bots/liquidator/package.json
COPY bots/open-oracle-arbitrager/package.json /source/bots/open-oracle-arbitrager/package.json
COPY bots/shared/package.json /source/bots/shared/package.json
COPY shared/core/package.json /source/shared/core/package.json
COPY shared/openOracle/package.json /source/shared/openOracle/package.json
COPY shared/statoblast/package.json /source/shared/statoblast/package.json
COPY shared/trading/package.json /source/shared/trading/package.json
COPY shared/zoltar/package.json /source/shared/zoltar/package.json
COPY solidity/package.json /source/solidity/package.json
COPY ui/coreShared/package.json /source/ui/coreShared/package.json
COPY ui/statoblast/package.json /source/ui/statoblast/package.json
COPY ui/statoblastShared/package.json /source/ui/statoblastShared/package.json
COPY ui/trading/package.json /source/ui/trading/package.json
COPY ui/zoltar/package.json /source/ui/zoltar/package.json
COPY ui/zoltarShared/package.json /source/ui/zoltarShared/package.json
RUN bun install --frozen-lockfile \
	&& bun ./tooling/repo/build-shared.mts

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY bots/shared/package.json ./bots/shared/
COPY bots/shared/src/ ./bots/shared/src/
COPY bots/liquidator/package.json ./bots/liquidator/
COPY package.json bun.lock /app/
COPY augurScan/package.json /app/augurScan/package.json
COPY bots/chaos/package.json /app/bots/chaos/package.json
COPY bots/liquidator/package.json /app/bots/liquidator/package.json
COPY bots/open-oracle-arbitrager/package.json /app/bots/open-oracle-arbitrager/package.json
COPY bots/shared/package.json /app/bots/shared/package.json
COPY shared/core/package.json /app/shared/core/package.json
COPY shared/openOracle/package.json /app/shared/openOracle/package.json
COPY shared/statoblast/package.json /app/shared/statoblast/package.json
COPY shared/trading/package.json /app/shared/trading/package.json
COPY shared/zoltar/package.json /app/shared/zoltar/package.json
COPY solidity/package.json /app/solidity/package.json
COPY ui/coreShared/package.json /app/ui/coreShared/package.json
COPY ui/statoblast/package.json /app/ui/statoblast/package.json
COPY ui/statoblastShared/package.json /app/ui/statoblastShared/package.json
COPY ui/trading/package.json /app/ui/trading/package.json
COPY ui/zoltar/package.json /app/ui/zoltar/package.json
COPY ui/zoltarShared/package.json /app/ui/zoltarShared/package.json
RUN bun install --frozen-lockfile --production --filter @zoltar/liquidator

COPY bots/liquidator/README.md ./bots/liquidator/README.md
COPY bots/liquidator/config/ ./bots/liquidator/config/
COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/
COPY bots/liquidator/scripts/check-market-sources.mts ./bots/liquidator/scripts/check-market-sources.mts
COPY bots/liquidator/scripts/check-process-lock-runtime.mts ./bots/liquidator/scripts/check-process-lock-runtime.mts
COPY bots/shared/scripts/docker-entrypoint.sh ./bots/liquidator/scripts/docker-entrypoint.sh
COPY bots/liquidator/src/ ./bots/liquidator/src/
RUN chmod 0755 bots/liquidator/scripts/docker-entrypoint.sh \
	&& install -d -m 0700 -o bun -g bun bots/liquidator/.state

USER bun
WORKDIR /app/bots/liquidator
RUN bun ./scripts/check-process-lock-runtime.mts

EXPOSE 4183
VOLUME ["/app/bots/liquidator/.state"]

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "run"]
