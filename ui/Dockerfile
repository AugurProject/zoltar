# ---------------------------------------------
# App Setup: Install dependencies and build app
# ---------------------------------------------

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine AS common-builder

# git is required by preinstall hook scripts (link-shared-node-modules.mts uses git rev-parse)
RUN apk add --no-cache git
WORKDIR /source
RUN git init

# Copy preinstall hook scripts before running bun install
COPY ./scripts/ /source/scripts/
COPY ./ui/coreShared/scripts/ /source/ui/coreShared/scripts/

# Shared package metadata and source for local package resolution
COPY ./shared/package.json /source/shared/package.json
COPY ./shared/tsconfig.json /source/shared/tsconfig.json
COPY ./shared/ts/ /source/shared/ts/
RUN mkdir -p /source/shared/js

# Install root dependencies and build generated shared outputs from tracked source.
COPY ./package.json ./bun.lock /source/
RUN bun install --frozen-lockfile
RUN bun run shared:build

# Install Solidity dependencies
COPY ./solidity/package.json ./solidity/bun.lock /source/solidity/
RUN cd /source/solidity && bun install --frozen-lockfile

# Solidity contracts and TypeScript source
COPY ./ui/coreShared/build/appPaths.mts /source/ui/coreShared/build/appPaths.mts
COPY ./ui/coreShared/build/projectArtifacts.mts /source/ui/coreShared/build/projectArtifacts.mts
COPY ./solidity/tsconfig.json /source/solidity/tsconfig.json
COPY ./solidity/tsconfig-compile.json /source/solidity/tsconfig-compile.json
COPY ./solidity/contracts/ /source/solidity/contracts/
COPY ./solidity/ts/ /source/solidity/ts/
RUN mkdir -p /source/ui/coreShared/ts && bun run compile-contracts

# Common UI build inputs.
COPY ./ui/coreShared/package.json /source/ui/coreShared/package.json
COPY ./ui/coreShared/bun.lock /source/ui/coreShared/bun.lock
COPY ./ui/coreShared/build/ /source/ui/coreShared/build/
COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json
COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json
COPY ./ui/tsconfig.base.json /source/ui/tsconfig.base.json
COPY ./ui/coreShared/tsconfig.json /source/ui/coreShared/tsconfig.json
COPY ./ui/coreShared/css/ /source/ui/coreShared/css/
COPY ./ui/coreShared/ts/ /source/ui/coreShared/ts/
RUN bun ./scripts/install-frozen.mts ui/coreShared
RUN cd /source/ui/coreShared && bun x tsc --project tsconfig.json

# Build Zoltar from only its inward dependencies.
FROM common-builder AS zoltar-builder

COPY ./ui/zoltar/package.json /source/ui/zoltar/package.json
COPY ./ui/zoltar/bun.lock /source/ui/zoltar/bun.lock
RUN bun ./scripts/install-frozen.mts ui/zoltar
RUN bun ./ui/coreShared/build/vendor.mts zoltar
COPY ./ui/zoltar/tsconfig.json /source/ui/zoltar/tsconfig.json
COPY ./ui/zoltar/index.html /source/ui/zoltar/index.html
COPY ./ui/zoltar/favicon.svg /source/ui/zoltar/favicon.svg
COPY ./ui/zoltar/ts/ /source/ui/zoltar/ts/
RUN cd /source/ui/zoltar && bun x tsc --project tsconfig.json && bun ../coreShared/build/production.mts zoltar

# Local runtime images contain only the selected application artifact.
FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime-zoltar

WORKDIR /app
COPY --from=zoltar-builder --chown=bun:bun /source/ui/zoltar/dist/ /app/ui/zoltar/
COPY --chown=bun:bun ./ui/coreShared/build/dockerServe.mts /app/dockerServe.mts
COPY --chown=bun:bun ./ui/coreShared/build/appPaths.mts /app/appPaths.mts
USER bun
EXPOSE 8012
ENV UI_APP=zoltar
ENV PORT=8012
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD [ "bun", "-e", "const response = await fetch('http://127.0.0.1:8012/'); process.exit(response.ok ? 0 : 1)" ]
CMD [ "bun", "/app/dockerServe.mts" ]

# Build Statoblast on top of its Zoltar dependency, without Trading.
FROM zoltar-builder AS statoblast-builder

COPY ./ui/statoblast/package.json /source/ui/statoblast/package.json
COPY ./ui/statoblast/bun.lock /source/ui/statoblast/bun.lock
RUN bun ./scripts/install-frozen.mts ui/statoblast
RUN bun ./ui/coreShared/build/vendor.mts statoblast
COPY ./ui/statoblast/tsconfig.json /source/ui/statoblast/tsconfig.json
COPY ./ui/statoblast/index.html /source/ui/statoblast/index.html
COPY ./ui/statoblast/favicon.svg /source/ui/statoblast/favicon.svg
COPY ./ui/statoblast/ts/ /source/ui/statoblast/ts/
RUN cd /source/ui/statoblast && bun x tsc --project tsconfig.json && bun ../coreShared/build/production.mts statoblast

FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime-statoblast

WORKDIR /app
COPY --from=statoblast-builder --chown=bun:bun /source/ui/statoblast/dist/ /app/ui/statoblast/
COPY --chown=bun:bun ./ui/coreShared/build/dockerServe.mts /app/dockerServe.mts
COPY --chown=bun:bun ./ui/coreShared/build/appPaths.mts /app/appPaths.mts
USER bun
EXPOSE 8011
ENV UI_APP=statoblast
ENV PORT=8011
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD [ "bun", "-e", "const response = await fetch('http://127.0.0.1:8011/'); process.exit(response.ok ? 0 : 1)" ]
CMD [ "bun", "/app/dockerServe.mts" ]

# Trading is the only application that reaches the complete UI dependency DAG.
FROM statoblast-builder AS trading-builder

COPY ./ui/trading/package.json /source/ui/trading/package.json
COPY ./ui/trading/bun.lock /source/ui/trading/bun.lock
RUN bun ./scripts/install-frozen.mts ui/trading
COPY ./ui/trading/tsconfig.json /source/ui/trading/tsconfig.json
COPY ./ui/trading/index.html /source/ui/trading/index.html
COPY ./ui/trading/favicon.svg /source/ui/trading/favicon.svg
COPY ./ui/trading/ts/ /source/ui/trading/ts/
COPY ./ui/trading/css/ /source/ui/trading/css/
COPY ./ui/trading/build/ /source/ui/trading/build/
RUN bun ./ui/coreShared/build/vendor.mts trading
RUN cd /source/ui/trading && bun x tsc --project tsconfig.json && bun ../coreShared/build/production.mts trading

FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime-trading

WORKDIR /app
COPY --from=trading-builder --chown=bun:bun /source/ui/trading/dist/ /app/ui/trading/
COPY --chown=bun:bun ./ui/coreShared/build/dockerServe.mts /app/dockerServe.mts
COPY --chown=bun:bun ./ui/coreShared/build/appPaths.mts /app/appPaths.mts
USER bun
EXPOSE 8080
ENV UI_APP=trading
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD [ "bun", "-e", "const response = await fetch('http://127.0.0.1:8080/'); process.exit(response.ok ? 0 : 1)" ]
CMD [ "bun", "/app/dockerServe.mts" ]

# The publisher intentionally includes every application.
FROM trading-builder AS builder

# -------------------------------------------------
# Publisher: Upload the production UI to host IPFS
# -------------------------------------------------

# Keep the publisher last for compatibility with the release workflow, which
# builds the Dockerfile's default target.
FROM ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 AS ipfs-kubo

FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf AS publisher

# Add curl to the base image (7.88.1-10+deb12u6)
# Add jq to the base image (1.6-2.1)
RUN sed -i 's/URIs/# URIs/g' /etc/apt/sources.list.d/debian.sources && \
	sed -i 's/# http/URIs: http/g' /etc/apt/sources.list.d/debian.sources && \
	apt-get update -o Acquire::Check-Valid-Until=false && apt-get install -y curl=7.88.1-10+deb12u6 jq=1.6-2.1

# Install kubo and initialize ipfs
COPY --from=ipfs-kubo /usr/local/bin/ipfs /usr/local/bin/ipfs

# Copy only the deployable UI artifacts (excluding node_modules, source files, build tools)
COPY --from=builder /source/ui/zoltar/dist/index.html /export/zoltar/index.html
COPY --from=builder /source/ui/zoltar/dist/favicon.svg /export/zoltar/favicon.svg
COPY --from=builder /source/ui/zoltar/dist/assets/ /export/zoltar/assets/
COPY --from=builder /source/ui/zoltar/dist/css/ /export/zoltar/css/
COPY --from=builder /source/ui/statoblast/dist/index.html /export/statoblast/index.html
COPY --from=builder /source/ui/statoblast/dist/favicon.svg /export/statoblast/favicon.svg
COPY --from=builder /source/ui/statoblast/dist/assets/ /export/statoblast/assets/
COPY --from=builder /source/ui/statoblast/dist/css/ /export/statoblast/css/
COPY --from=builder /source/ui/trading/dist/index.html /export/trading/index.html
COPY --from=builder /source/ui/trading/dist/favicon.svg /export/trading/favicon.svg
COPY --from=builder /source/ui/trading/dist/core-deployments.json /export/trading/core-deployments.json
COPY --from=builder /source/ui/trading/dist/assets/ /export/trading/assets/
COPY --from=builder /source/ui/trading/dist/css/ /export/trading/css/

RUN ipfs init

# Store the hash to a file
RUN ipfs add --cid-version 1 --quieter --only-hash --recursive /export > ipfs_hash.txt

# Print the hash for visibility
RUN cat ipfs_hash.txt

COPY --chmod=755 ./ui/coreShared/scripts/docker-entrypoint.sh /entrypoint.sh

WORKDIR /temp

ENTRYPOINT [ "/entrypoint.sh" ]
