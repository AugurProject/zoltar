ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

WORKDIR /source

COPY shared/ ./shared/
COPY tooling/ ./tooling/
COPY package.json bun.lock /source/
COPY augurScan/package.json /source/augurScan/package.json
COPY bots/chaos/package.json /source/bots/chaos/package.json
COPY bots/liquidator/package.json /source/bots/liquidator/package.json
COPY bots/open-oracle-arbitrager/package.json /source/bots/open-oracle-arbitrager/package.json
COPY bots/shared/package.json /source/bots/shared/package.json
COPY solidity/package.json /source/solidity/package.json
COPY ui/coreShared/package.json /source/ui/coreShared/package.json
COPY ui/statoblast/package.json /source/ui/statoblast/package.json
COPY ui/statoblastShared/package.json /source/ui/statoblastShared/package.json
COPY ui/trading/package.json /source/ui/trading/package.json
COPY ui/zoltar/package.json /source/ui/zoltar/package.json
COPY ui/zoltarShared/package.json /source/ui/zoltarShared/package.json
RUN bun install --frozen-lockfile \
	&& bun ./tooling/repo/build-shared.mts

COPY solidity/bunfig.toml solidity/default-config.json solidity/tsconfig.json solidity/tsconfig-compile.json ./solidity/
COPY solidity/contracts/ ./solidity/contracts/
COPY solidity/ts/ ./solidity/ts/
RUN cd solidity \
	&& bun tsc --project tsconfig-compile.json \
	&& bun ./js/compile.js

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
ENV ZOLTAR_BOT_CONTAINER=true
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY --from=shared-builder /source/solidity/ts/types/contractArtifact.ts ./solidity/ts/types/contractArtifact.ts
COPY bots/shared/src/ ./bots/shared/src/
COPY package.json bun.lock /app/
COPY augurScan/package.json /app/augurScan/package.json
COPY bots/chaos/package.json /app/bots/chaos/package.json
COPY bots/liquidator/package.json /app/bots/liquidator/package.json
COPY bots/open-oracle-arbitrager/package.json /app/bots/open-oracle-arbitrager/package.json
COPY bots/shared/package.json /app/bots/shared/package.json
COPY solidity/package.json /app/solidity/package.json
COPY ui/coreShared/package.json /app/ui/coreShared/package.json
COPY ui/statoblast/package.json /app/ui/statoblast/package.json
COPY ui/statoblastShared/package.json /app/ui/statoblastShared/package.json
COPY ui/trading/package.json /app/ui/trading/package.json
COPY ui/zoltar/package.json /app/ui/zoltar/package.json
COPY ui/zoltarShared/package.json /app/ui/zoltarShared/package.json
RUN bun install --frozen-lockfile --production --filter @zoltar/chaos

COPY bots/chaos/README.md ./bots/chaos/README.md
COPY bots/chaos/config/ ./bots/chaos/config/
COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/
COPY bots/chaos/scripts/check-runtime.mts ./bots/chaos/scripts/check-runtime.mts
COPY bots/chaos/scripts/docker-entrypoint.sh ./bots/chaos/scripts/docker-entrypoint.sh
COPY bots/chaos/scripts/validate-container-paths.mts ./bots/chaos/scripts/validate-container-paths.mts
COPY bots/chaos/src/ ./bots/chaos/src/
RUN chmod 0755 bots/chaos/scripts/docker-entrypoint.sh \
	&& install -d -m 0700 -o bun -g bun bots/chaos/.state \
	&& install -d -m 0700 -o bun -g bun bots/chaos/.state/process-locks

USER bun
WORKDIR /app/bots/chaos
RUN bun ./scripts/check-runtime.mts

EXPOSE 4193
VOLUME ["/app/bots/chaos/.state"]

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "run"]
