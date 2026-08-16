ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine AS builder

RUN apk add --no-cache git
WORKDIR /source
RUN git init
COPY package.json bun.lock ./
COPY scripts ./scripts
COPY shared ./shared
COPY solidity/contracts ./solidity/contracts
COPY docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/
COPY trading ./trading
RUN bun install --frozen-lockfile
RUN bun run shared:build
RUN cd trading && bun install --frozen-lockfile

ARG TRADING_UI_DEPLOYMENT
RUN cd trading && if [ -n "${TRADING_UI_DEPLOYMENT}" ]; then TRADING_UI_DEPLOYMENT="${TRADING_UI_DEPLOYMENT}" bun run ui:build; else bun run ui:build; fi

FROM oven/bun:${BUN_VERSION}-alpine AS runtime

WORKDIR /app/ui
COPY --from=builder --chown=bun:bun /source/trading/ui/dist ./dist
COPY --from=builder --chown=bun:bun /source/trading/ui/build/serve.mts ./build/serve.mts

USER bun
EXPOSE 4163
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:4163/'); process.exit(response.ok ? 0 : 1)"]
CMD ["bun", "./build/serve.mts"]
