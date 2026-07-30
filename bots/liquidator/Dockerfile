ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine

ENV BUN_ENV=production
WORKDIR /app

COPY bots/shared/package.json bots/shared/bun.lock ./bots/shared/
COPY bots/shared/src/ ./bots/shared/src/
COPY bots/liquidator/package.json bots/liquidator/bun.lock ./bots/liquidator/
RUN cd bots/liquidator \
	&& bun install --frozen-lockfile --production

COPY bots/liquidator/README.md ./bots/liquidator/README.md
COPY bots/liquidator/config/ ./bots/liquidator/config/
COPY bots/liquidator/src/ ./bots/liquidator/src/
RUN install -d -m 0700 -o bun -g bun bots/liquidator/.state

USER bun
WORKDIR /app/bots/liquidator

EXPOSE 4183
VOLUME ["/app/bots/liquidator/.state"]

ENTRYPOINT ["bun", "run", "run"]
