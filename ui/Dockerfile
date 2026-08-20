# ---------------------------------------------
# App Setup: Install dependencies and build app
# ---------------------------------------------

ARG BUN_VERSION=1.3.13

FROM oven/bun:${BUN_VERSION}-alpine AS builder

# git is required by preinstall hook scripts (link-shared-node-modules.mts uses git rev-parse)
RUN apk add --no-cache git
WORKDIR /source
RUN git init

# Copy preinstall hook scripts before running bun install
COPY ./scripts/ /source/scripts/
COPY ./ui/scripts/ /source/ui/scripts/

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
COPY ./ui/build/projectArtifacts.mts /source/ui/build/projectArtifacts.mts
COPY ./solidity/tsconfig.json /source/solidity/tsconfig.json
COPY ./solidity/tsconfig-compile.json /source/solidity/tsconfig-compile.json
COPY ./solidity/contracts/ /source/solidity/contracts/
COPY ./solidity/ts/ /source/solidity/ts/
RUN mkdir -p /source/ui/ts && bun run compile-contracts

# Install UI dependencies and vendor browser packages after the cached contract build.
COPY ./ui/package.json ./ui/bun.lock /source/ui/
RUN cd /source/ui && bun install --frozen-lockfile
COPY ./ui/tsconfig.vendor.json /source/ui/tsconfig.vendor.json
COPY ./ui/build/ /source/ui/build/
RUN bun run ui:vendor

# UI TypeScript source
COPY ./ui/index.html /source/ui/index.html
COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json
COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json
COPY ./ui/tsconfig.json /source/ui/tsconfig.json
COPY ./ui/css/ /source/ui/css/
COPY ./ui/ts/ /source/ui/ts/
COPY ./ui/favicon.ico /source/ui/favicon.ico
COPY ./ui/favicon.svg /source/ui/favicon.svg

# Refresh local packages, type-check, validate deployment data, and build the UI.
RUN bun run ui:build:prod:prepared

# ----------------------------------------------------
# Local runtime: Serve the production UI over plain HTTP
# ----------------------------------------------------

# start.bat selects this target explicitly, so no IPFS layers are built or run.
FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime

WORKDIR /app

COPY --from=builder --chown=bun:bun /source/ui/dist/ /app/ui/
COPY --chown=bun:bun ./ui/build/dockerServe.mts /app/dockerServe.mts

USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD [ "bun", "-e", "const response = await fetch('http://127.0.0.1:8080/'); process.exit(response.ok ? 0 : 1)" ]

CMD [ "bun", "/app/dockerServe.mts" ]

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
COPY --from=builder /source/ui/dist/index.html /export/index.html
COPY --from=builder /source/ui/dist/favicon.ico /export/favicon.ico
COPY --from=builder /source/ui/dist/favicon.svg /export/favicon.svg
COPY --from=builder /source/ui/dist/assets/ /export/assets/
COPY --from=builder /source/ui/dist/css/ /export/css/

RUN ipfs init

# Store the hash to a file
RUN ipfs add --cid-version 1 --quieter --only-hash --recursive /export > ipfs_hash.txt

# Print the hash for visibility
RUN cat ipfs_hash.txt

COPY --chmod=755 ./ui/scripts/docker-entrypoint.sh /entrypoint.sh

WORKDIR /temp

ENTRYPOINT [ "/entrypoint.sh" ]
