# ---------------------------------------------
# App Setup: Install dependencies and build app
# ---------------------------------------------

FROM node:20-alpine3.19@sha256:e96618520c7db4c3e082648678ab72a49b73367b9a1e7884cf75ac30a198e454 AS builder

RUN npm install -g bun@1.3.9 --integrity=sha512-bf9864875baceec30d8df8a6584ef47e561b0f9235fea5906aa989e39ab6aa4e47ffb9ae4156b8efc2d2551485c864c1501a20d8bb0f4277c845d8f2589458f8

# Install app dependencies
COPY ./package.json /source/package.json
COPY ./package-lock.json /source/package-lock.json
WORKDIR /source
RUN npm ci

# Install Solidity dependencies
COPY ./solidity/package.json /source/solidity/package.json
COPY ./solidity/package-lock.json /source/solidity/package-lock.json
WORKDIR /source/solidity
RUN npm ci

# Vendoring files
COPY ./tsconfig.vendor.json /source/tsconfig.vendor.json
COPY ./build/ /source/build/
COPY ./app/index.html /source/app/index.html

# Contracts
WORKDIR /source
COPY ./solidity/tsconfig.json /source/solidity/tsconfig.json
COPY ./solidity/tsconfig-compile.json /source/solidity/tsconfig-compile.json
COPY ./solidity/contracts/ /source/solidity/contracts/
COPY ./solidity/ts/ /source/solidity/ts/

# Build the app
COPY ./tsconfig.json /source/tsconfig.json
COPY ./app/css/ /source/app/css/
COPY ./app/ts/ /source/app/ts/
COPY ./app/favicon.ico /source/app/favicon.ico
RUN npm run setup

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

# Copy app's build output and initialize IPFS api
COPY --from=builder /source/app /export
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
