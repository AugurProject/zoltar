ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

RUN apk add --no-cache git
WORKDIR /source
RUN git init

COPY package.json bun.lock ./
COPY shared/ ./shared/
COPY tooling/ ./tooling/
RUN bun install --frozen-lockfile \
	&& bun ./tooling/repo/build-shared.mts

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY bots/shared/package.json bots/shared/bun.lock ./bots/shared/
COPY bots/shared/src/ ./bots/shared/src/
COPY bots/liquidator/package.json bots/liquidator/bun.lock ./bots/liquidator/
# Use the repository installer for nested file: dependencies in production too.
COPY --from=shared-builder /source/tooling/repo/install-frozen.mts /tmp/tooling/repo/install-frozen.mts
COPY --from=shared-builder /source/tooling/ui/share-ui-preact-runtime.mts /tmp/tooling/ui/share-ui-preact-runtime.mts
RUN cd shared/core \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& cd ../../bots/shared \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& cd ../liquidator \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& rm -rf /tmp/tooling

COPY bots/liquidator/README.md ./bots/liquidator/README.md
COPY bots/liquidator/config/ ./bots/liquidator/config/
COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/
COPY bots/liquidator/scripts/check-market-sources.mts ./bots/liquidator/scripts/check-market-sources.mts
COPY bots/liquidator/scripts/check-process-lock-runtime.mts ./bots/liquidator/scripts/check-process-lock-runtime.mts
COPY bots/liquidator/scripts/docker-entrypoint.sh ./bots/liquidator/scripts/docker-entrypoint.sh
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
