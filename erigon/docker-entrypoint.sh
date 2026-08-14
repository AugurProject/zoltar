#!/bin/sh
set -eu

if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then
	set -- erigon "$@"
fi

rpc_public_port=${ERIGON_RPC_PUBLIC_PORT:-8545}
month_start=$(date -u '+%Y-%m-01T00:00:00Z')

printf '%s\n' \
	"Sepolia archive retention: all chain history (including logs since ${month_start})" \
	"RPC endpoint from this host: http://localhost:${rpc_public_port}" \
	'RPC endpoint from another Compose service: http://erigon:8545'

exec "$@"
