#!/bin/sh
set -eu

echo "Build Hash: $(cat /ipfs_hash.txt)"

IPFS_IP4_ADDRESS=$(getent ahostsv4 host.docker.internal | grep STREAM | head -n 1 | cut -d ' ' -f 1)

echo "Adding files to docker running IPFS at $IPFS_IP4_ADDRESS"
IPFS_HASH=$(ipfs add --api "/ip4/$IPFS_IP4_ADDRESS/tcp/5001" --cid-version 1 --quieter --recursive /export)
echo "Uploaded Hash: $IPFS_HASH"
