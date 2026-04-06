# ---------------------------------------------
# App Setup: Install dependencies and build app
# ---------------------------------------------

FROM oven/bun:1.3.9-alpine AS builder

# git is required by preinstall hook scripts (link-shared-node-modules.mjs uses git rev-parse)
RUN apk add --no-cache git
WORKDIR /source
RUN git init

# Copy preinstall hook scripts before running bun install
COPY ./scripts/ /source/scripts/
COPY ./ui/scripts/ /source/ui/scripts/

# Install root dependencies
COPY ./package.json ./bun.lock /source/
RUN bun install --frozen-lockfile

# Install Solidity dependencies
COPY ./solidity/package.json ./solidity/bun.lock /source/solidity/
RUN cd /source/solidity && bun install --frozen-lockfile

# Install UI dependencies
COPY ./ui/package.json ./ui/bun.lock /source/ui/
RUN cd /source/ui && bun install --frozen-lockfile

# Vendoring config and build scripts
COPY ./ui/tsconfig.vendor.json /source/ui/tsconfig.vendor.json
COPY ./ui/build/ /source/ui/build/
COPY ./ui/index.html /source/ui/index.html

# Solidity contracts and TypeScript source
COPY ./solidity/tsconfig.json /source/solidity/tsconfig.json
COPY ./solidity/tsconfig-compile.json /source/solidity/tsconfig-compile.json
COPY ./solidity/contracts/ /source/solidity/contracts/
COPY ./solidity/ts/ /source/solidity/ts/

# UI TypeScript source
COPY ./ui/tsconfig.json /source/ui/tsconfig.json
COPY ./ui/css/ /source/ui/css/
COPY ./ui/ts/ /source/ui/ts/
COPY ./ui/favicon.ico /source/ui/favicon.ico
COPY ./ui/favicon.svg /source/ui/favicon.svg

# Compile contracts, vendor dependencies, and build UI
RUN bun run ui:build

# --------------------------------------------------------
# Base Image: Create the base image that will host the app
# --------------------------------------------------------

# Cache the kubo image
FROM ipfs/kubo:v0.25.0@sha256:0c17b91cab8ada485f253e204236b712d0965f3d463cb5b60639ddd2291e7c52 AS ipfs-kubo

# Create the base image
FROM debian:12.6-slim@sha256:39868a6f452462b70cf720a8daff250c63e7342970e749059c105bf7c1e8eeaf

# Add curl to the base image (7.88.1-10+deb12u6)
# Add jq to the base image (1.6-2.1)
RUN sed -i 's/URIs/# URIs/g' /etc/apt/sources.list.d/debian.sources && \
	sed -i 's/# http/URIs: http/g' /etc/apt/sources.list.d/debian.sources && \
	apt-get update -o Acquire::Check-Valid-Until=false && apt-get install -y curl=7.88.1-10+deb12u6 jq=1.6-2.1

# Install kubo and initialize ipfs
COPY --from=ipfs-kubo /usr/local/bin/ipfs /usr/local/bin/ipfs

# Copy only the deployable UI artifacts (excluding node_modules, source files, build tools)
COPY --from=builder /source/ui/index.html /export/index.html
COPY --from=builder /source/ui/favicon.ico /export/favicon.ico
COPY --from=builder /source/ui/favicon.svg /export/favicon.svg
COPY --from=builder /source/ui/js/ /export/js/
COPY --from=builder /source/ui/vendor/ /export/vendor/
COPY --from=builder /source/ui/css/ /export/css/

RUN ipfs init

# Store the hash to a file
RUN ipfs add --cid-version 1 --quieter --only-hash --recursive /export > ipfs_hash.txt

# Print the hash for visibility
RUN cat ipfs_hash.txt

# --------------------------------------------------------
# Publish Script: when run, publishes to IPFS running on docker host.
# --------------------------------------------------------

WORKDIR /temp
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -e

echo "Build Hash: $(cat /ipfs_hash.txt)"

IPFS_IP4_ADDRESS=$(getent ahostsv4 host.docker.internal | grep STREAM | head -n 1 | cut -d ' ' -f 1)

echo "Adding files to docker running IPFS at $IPFS_IP4_ADDRESS"
IPFS_HASH=$(ipfs add --api /ip4/$IPFS_IP4_ADDRESS/tcp/5001 --cid-version 1 --quieter -r /export)
echo "Uploaded Hash: $IPFS_HASH"
EOF

RUN chmod u+x /entrypoint.sh

ENTRYPOINT [ "/entrypoint.sh" ]
