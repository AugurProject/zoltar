ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine AS shared-builder

RUN apk add --no-cache git
WORKDIR /source
RUN git init

COPY package.json bun.lock ./
COPY scripts/ ./scripts/
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/ts/ ./shared/ts/
RUN mkdir -p shared/js \
	&& bun install --frozen-lockfile \
	&& bun run shared:build

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
WORKDIR /app

COPY --from=shared-builder /source/shared/ ./shared/
COPY bots/open-oracle-arbitrager/package.json bots/open-oracle-arbitrager/bun.lock ./bots/open-oracle-arbitrager/
RUN cd bots/open-oracle-arbitrager \
	&& bun install --frozen-lockfile --production

COPY bots/open-oracle-arbitrager/README.md ./bots/open-oracle-arbitrager/README.md
COPY bots/open-oracle-arbitrager/config/ ./bots/open-oracle-arbitrager/config/
COPY bots/open-oracle-arbitrager/docs/ ./bots/open-oracle-arbitrager/docs/
COPY bots/open-oracle-arbitrager/scripts/check-market-fixture.mts ./bots/open-oracle-arbitrager/scripts/check-market-fixture.mts
COPY bots/open-oracle-arbitrager/src/ ./bots/open-oracle-arbitrager/src/
RUN install -d -m 0700 -o bun -g bun bots/open-oracle-arbitrager/.state

USER bun
WORKDIR /app/bots/open-oracle-arbitrager

EXPOSE 4173
VOLUME ["/app/bots/open-oracle-arbitrager/.state"]

ENTRYPOINT ["bun", "run", "run"]
