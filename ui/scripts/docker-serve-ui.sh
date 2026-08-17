#!/bin/sh
set -eu

EXPECTED_IPFS_HASH=$(cat /ipfs_hash.txt)
IPFS_HASH=$(ipfs add --cid-version 1 --quieter --recursive /export)

if [ "$IPFS_HASH" != "$EXPECTED_IPFS_HASH" ]; then
	echo "Built IPFS hash $EXPECTED_IPFS_HASH does not match imported hash $IPFS_HASH" >&2
	exit 1
fi

ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080

echo "Zoltar UI is available at:"
echo "http://localhost:8080/ipfs/${IPFS_HASH}/"

exec ipfs daemon
