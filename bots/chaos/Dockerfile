ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

RUN apk add --no-cache git
WORKDIR /source
RUN git init

COPY package.json bun.lock ./
COPY scripts/ ./scripts/
COPY shared/package.json shared/bun.lock shared/tsconfig.json ./shared/
COPY shared/ts/ ./shared/ts/
RUN mkdir -p shared/js \
	&& bun install --frozen-lockfile \
	&& bun run shared:build

COPY solidity/package.json solidity/bun.lock solidity/bunfig.toml solidity/default-config.json solidity/tsconfig.json solidity/tsconfig-compile.json ./solidity/
COPY solidity/contracts/ ./solidity/contracts/
COPY solidity/ts/ ./solidity/ts/
RUN cd solidity \
	&& bun install --frozen-lockfile \
	&& bun tsc --project tsconfig-compile.json \
	&& bun ./js/compile.js

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
ENV ZOLTAR_BOT_CONTAINER=true
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY --from=shared-builder /source/solidity/ts/types/contractArtifact.ts ./solidity/ts/types/contractArtifact.ts
COPY bots/shared/package.json bots/shared/bun.lock ./bots/shared/
COPY bots/shared/src/ ./bots/shared/src/
COPY bots/chaos/package.json bots/chaos/bun.lock ./bots/chaos/
RUN cd shared \
	&& bun install --frozen-lockfile --production \
	&& cd ../bots/shared \
	&& bun install --frozen-lockfile --production \
	&& cd ../chaos \
	&& bun install --frozen-lockfile --production

COPY bots/chaos/README.md ./bots/chaos/README.md
COPY bots/chaos/config/ ./bots/chaos/config/
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
