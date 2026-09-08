ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

RUN apk add --no-cache git
WORKDIR /source
RUN git init

COPY package.json bun.lock ./
COPY tooling/ ./tooling/
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
COPY bots/open-oracle-arbitrager/package.json bots/open-oracle-arbitrager/bun.lock ./bots/open-oracle-arbitrager/
# Use the repository installer for nested file: dependencies in production too.
COPY --from=shared-builder /source/tooling/repo/install-frozen.mts /tmp/tooling/repo/install-frozen.mts
COPY --from=shared-builder /source/tooling/ui/share-ui-preact-runtime.mts /tmp/tooling/ui/share-ui-preact-runtime.mts
RUN cd shared \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& cd ../bots/shared \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& cd ../open-oracle-arbitrager \
	&& bun /tmp/tooling/repo/install-frozen.mts . --production \
	&& rm -rf /tmp/tooling

COPY bots/open-oracle-arbitrager/README.md ./bots/open-oracle-arbitrager/README.md
COPY bots/open-oracle-arbitrager/config/ ./bots/open-oracle-arbitrager/config/
COPY bots/open-oracle-arbitrager/docs/ ./bots/open-oracle-arbitrager/docs/
COPY bots/open-oracle-arbitrager/scripts/check-market-fixture.mts ./bots/open-oracle-arbitrager/scripts/check-market-fixture.mts
COPY bots/open-oracle-arbitrager/scripts/docker-entrypoint.sh ./bots/open-oracle-arbitrager/scripts/docker-entrypoint.sh
COPY bots/open-oracle-arbitrager/src/ ./bots/open-oracle-arbitrager/src/
RUN chmod 0755 bots/open-oracle-arbitrager/scripts/docker-entrypoint.sh \
	&& install -d -m 0700 -o bun -g bun bots/open-oracle-arbitrager/.state

USER bun
WORKDIR /app/bots/open-oracle-arbitrager

EXPOSE 4173
VOLUME ["/app/bots/open-oracle-arbitrager/.state"]

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "run"]
