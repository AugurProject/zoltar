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

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY bots/shared/package.json bots/shared/bun.lock ./bots/shared/
COPY bots/shared/src/ ./bots/shared/src/
COPY bots/liquidator/package.json bots/liquidator/bun.lock ./bots/liquidator/
RUN cd shared \
	&& bun install --frozen-lockfile --production \
	&& cd ../bots/shared \
	&& bun install --frozen-lockfile --production \
	&& cd ../liquidator \
	&& bun install --frozen-lockfile --production

COPY bots/liquidator/README.md ./bots/liquidator/README.md
COPY bots/liquidator/config/ ./bots/liquidator/config/
COPY bots/liquidator/scripts/check-market-sources.mts ./bots/liquidator/scripts/check-market-sources.mts
COPY bots/liquidator/scripts/check-process-lock-runtime.mts ./bots/liquidator/scripts/check-process-lock-runtime.mts
COPY bots/liquidator/scripts/docker-entrypoint.sh ./bots/liquidator/scripts/docker-entrypoint.sh
COPY bots/liquidator/src/ ./bots/liquidator/src/
COPY ui/coreShared/favicon.svg ./ui/coreShared/favicon.svg
RUN chmod 0755 bots/liquidator/scripts/docker-entrypoint.sh \
	&& install -d -m 0700 -o bun -g bun bots/liquidator/.state

USER bun
WORKDIR /app/bots/liquidator
RUN bun ./scripts/check-process-lock-runtime.mts

EXPOSE 4183
VOLUME ["/app/bots/liquidator/.state"]

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "run"]
