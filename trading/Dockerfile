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

RUN cd trading && bun run ui:build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime

WORKDIR /app/ui
COPY --from=builder --chown=bun:bun /source/trading/ui/dist ./dist
COPY --from=builder --chown=bun:bun /source/trading/ui/build/serve.mts ./build/serve.mts

USER bun
EXPOSE 4163
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:4163/'); process.exit(response.ok ? 0 : 1)"]
CMD ["bun", "./build/serve.mts"]

# Publisher: package the static trading UI for a host IPFS node.
FROM ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 AS ipfs-kubo

FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf AS publisher

RUN sed -i 's/URIs/# URIs/g' /etc/apt/sources.list.d/debian.sources && \
	sed -i 's/# http/URIs: http/g' /etc/apt/sources.list.d/debian.sources && \
	apt-get update -o Acquire::Check-Valid-Until=false && apt-get install -y curl=7.88.1-10+deb12u6 jq=1.6-2.1

COPY --from=ipfs-kubo /usr/local/bin/ipfs /usr/local/bin/ipfs
COPY --from=builder /source/trading/ui/dist/ /export/
RUN ipfs init && ipfs add --cid-version 1 --quieter --only-hash --recursive /export > /ipfs_hash.txt

COPY --chmod=755 ui/scripts/docker-entrypoint.sh /entrypoint.sh

WORKDIR /temp
ENTRYPOINT ["/entrypoint.sh"]

# Preserve the runtime image as the default target for local and production serving.
FROM runtime AS final
