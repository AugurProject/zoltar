#!/bin/sh
set -eu

for app in zoltar statoblast trading; do
    IPFS_CID=$(ipfs --api "${IPFS_API:-/dns4/host.docker.internal/tcp/5001}" add --cid-version 1 --pin=true --quieter --recursive "/export/$app")
    if [ -z "$IPFS_CID" ]; then
        echo 'IPFS did not return a content identifier.' >&2
        exit 1
    fi

    echo "$app: ipfs://${IPFS_CID}/"
done
