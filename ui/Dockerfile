# ---------------------------------------------
# App Setup: Install dependencies and build app
# ---------------------------------------------

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-alpine AS builder

# git is required by preinstall hook scripts (link-shared-node-modules.mjs uses git rev-parse)
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
RUN mkdir -p /source/ui/coreShared/ts /source/ui/zoltar/ts /source/ui/statoblast/ts && bun run compile-contracts

# Install UI dependencies and vendor browser packages after the cached contract build.
COPY ./ui/coreShared/package.json /source/ui/coreShared/package.json
COPY ./ui/coreShared/bun.lock /source/ui/coreShared/bun.lock
COPY ./ui/zoltar/package.json /source/ui/zoltar/package.json
COPY ./ui/zoltar/bun.lock /source/ui/zoltar/bun.lock
COPY ./ui/statoblast/package.json /source/ui/statoblast/package.json
COPY ./ui/statoblast/bun.lock /source/ui/statoblast/bun.lock
RUN cd /source/ui/coreShared && bun install --frozen-lockfile && cd ../zoltar && bun install --frozen-lockfile && cd ../statoblast && bun install --frozen-lockfile
COPY ./ui/coreShared/build/ /source/ui/coreShared/build/
RUN bun ./ui/coreShared/build/vendor.mts zoltar && bun ./ui/coreShared/build/vendor.mts statoblast

# UI TypeScript source
COPY ./docs/mainnet-deployment-addresses.json /source/docs/mainnet-deployment-addresses.json
COPY ./docs/sepolia-deployment-addresses.json /source/docs/sepolia-deployment-addresses.json
COPY ./ui/tsconfig.base.json /source/ui/tsconfig.base.json
COPY ./ui/coreShared/tsconfig.json /source/ui/coreShared/tsconfig.json
COPY ./ui/zoltar/tsconfig.json /source/ui/zoltar/tsconfig.json
COPY ./ui/statoblast/tsconfig.json /source/ui/statoblast/tsconfig.json
COPY ./ui/zoltar/index.html /source/ui/zoltar/index.html
COPY ./ui/statoblast/index.html /source/ui/statoblast/index.html
COPY ./ui/coreShared/css/ /source/ui/coreShared/css/
COPY ./ui/coreShared/ts/ /source/ui/coreShared/ts/
COPY ./ui/zoltar/ts/ /source/ui/zoltar/ts/
COPY ./ui/statoblast/ts/ /source/ui/statoblast/ts/
COPY ./ui/coreShared/favicon.ico /source/ui/coreShared/favicon.ico
COPY ./ui/coreShared/favicon.svg /source/ui/coreShared/favicon.svg

# Refresh local packages, type-check, validate deployment data, and production-build both apps.
RUN cd /source/ui/coreShared && bun x tsc --project tsconfig.json
RUN cd /source/ui/zoltar && bun x tsc --project tsconfig.json && bun ../coreShared/build/production.mts zoltar
RUN cd /source/ui/statoblast && bun x tsc --project tsconfig.json && bun ../coreShared/build/production.mts statoblast

# ----------------------------------------------------
# Local runtime: Serve the production UI over plain HTTP
# ----------------------------------------------------

# Local runtime builds select this target explicitly, so no IPFS layers are built or run.
FROM oven/bun:${BUN_VERSION}-alpine AS local-runtime

WORKDIR /app

COPY --from=builder --chown=bun:bun /source/ui/zoltar/dist/ /app/ui/zoltar/
COPY --from=builder --chown=bun:bun /source/ui/statoblast/dist/ /app/ui/statoblast/
COPY --chown=bun:bun ./ui/coreShared/build/dockerServe.mts /app/dockerServe.mts

USER bun
EXPOSE 8080
# Select the application the runtime serves; override with `docker run -e UI_APP=statoblast`.
ENV UI_APP=zoltar
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
COPY --from=builder /source/ui/zoltar/dist/index.html /export/zoltar/index.html
COPY --from=builder /source/ui/zoltar/dist/favicon.ico /export/zoltar/favicon.ico
COPY --from=builder /source/ui/zoltar/dist/favicon.svg /export/zoltar/favicon.svg
COPY --from=builder /source/ui/zoltar/dist/assets/ /export/zoltar/assets/
COPY --from=builder /source/ui/zoltar/dist/css/ /export/zoltar/css/
COPY --from=builder /source/ui/statoblast/dist/index.html /export/statoblast/index.html
COPY --from=builder /source/ui/statoblast/dist/favicon.ico /export/statoblast/favicon.ico
COPY --from=builder /source/ui/statoblast/dist/favicon.svg /export/statoblast/favicon.svg
COPY --from=builder /source/ui/statoblast/dist/assets/ /export/statoblast/assets/
COPY --from=builder /source/ui/statoblast/dist/css/ /export/statoblast/css/

RUN ipfs init

# Store the hash to a file
RUN ipfs add --cid-version 1 --quieter --only-hash --recursive /export > ipfs_hash.txt

# Print the hash for visibility
RUN cat ipfs_hash.txt

COPY --chmod=755 ./ui/coreShared/scripts/docker-entrypoint.sh /entrypoint.sh

WORKDIR /temp

ENTRYPOINT [ "/entrypoint.sh" ]
