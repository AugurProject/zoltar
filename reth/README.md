# Sepolia Reth node

This Compose project runs Reth as the Sepolia execution client and Lighthouse as its consensus client. Reth prunes execution history before a fixed boundary while preserving every block body, receipt, and transaction lookup from that block onward. Consequently, `eth_getLogs` remains available from that block even as the node continues running.

## Choose the retention boundary

Copy the environment template before the first start:

```bash
cp .env.example .env
```

Resolve the first Sepolia block whose timestamp is at or after the required UTC boundary—for example, `2026-08-01T00:00:00Z`—using a trusted Sepolia RPC or block explorer. With Foundry installed, the lookup for that example is:

```bash
cast find-block --rpc-url https://your-trusted-sepolia-rpc.example 1785542400
```

Confirm whether the closest block is immediately before or after the cutoff, adjust to the first block at or after it, and put that decimal block number in `.env`:

```dotenv
RETH_RECEIPTS_START_BLOCK=12345678
```

The number above is an example, not the August 2026 Sepolia boundary. Verify the selected block and its parent before starting:

```bash
curl --fail-with-body \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0xbc614e",false]}' \
  https://your-trusted-sepolia-rpc.example
```

The selected block's timestamp must be at or after the cutoff, and the preceding block's timestamp must be before it.

> [!WARNING]
> Keep `RETH_RECEIPTS_START_BLOCK` fixed on every restart. Raising it authorizes Reth to permanently delete additional block bodies, receipts, and transaction lookups.

## Start

From this directory, run:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose config
docker compose up -d
docker compose logs -f reth lighthouse
```

On Windows, copy `.env.example` to `.env`, set the retention block, and run `start.bat`.

Applications on the host use `http://localhost:8545` or `ws://localhost:8546`. Other repository Compose services on the external `zoltar` network use `http://reth:8545` or `ws://reth:8546`. Both host ports bind only to loopback; use an authenticated TLS reverse proxy if remote access is required.

Set `RETH_RPC_PORT` or `RETH_WS_PORT` in `.env` to change the host ports without changing the container endpoints.

Allow inbound TCP/UDP `30303` and UDP `9200` for Reth peer discovery, plus TCP/UDP `9000` and UDP `9001` for Lighthouse discovery and QUIC. The JSON-RPC ports do not need public firewall rules because they bind only to host loopback.

## Data and pruning

The `reth-sepolia-data` volume contains execution data and bounded Reth process logs. `lighthouse-sepolia-data` contains consensus data. The `engine-jwt` volume contains the randomly generated Engine API secret shared by both clients. A normal `docker compose down` preserves all three volumes.

The pruning configuration:

- retains block bodies, receipts, and transaction-hash lookups from `RETH_RECEIPTS_START_BLOCK` forward;
- discards sender-recovery data after it is no longer required;
- retains a rolling 10,064-block window of account and storage history;
- retains current state, so current RPC reads and transaction submission continue working.

This supports historical `eth_getLogs` and receipt lookup from the configured boundary. It does not support old state queries or traces outside the rolling state-history window. Block, transaction, and receipt storage will continue growing because the requested event history is retained permanently.

> [!WARNING]
> Never run `docker compose down --volumes` unless all Reth and Lighthouse data may be deleted. Never move the retention boundary forward unless the additional block, transaction, and receipt history may be irreversibly deleted.

## Migration from Erigon

The old Erigon database cannot be reused by Reth. Bring this project up with its new volumes and leave the old Erigon Compose project and volume stopped but intact until Reth is fully synchronized and verified.

During migration, only one execution client can publish host port `8545` and P2P port `30303`. Either stop Erigon before starting this project or temporarily assign different host/P2P ports. Because the checked-in deployment uses fixed P2P ports, the simplest safe sequence is:

1. Stop Erigon with `docker compose down` from the old checkout. Do not pass `--volumes`.
2. Start this Reth project.
3. Wait for both clients to synchronize.
4. Verify the chain ID, sync status, and logs spanning the retention boundary.
5. Point dependent services from `http://erigon:8545` to `http://reth:8545`.
6. Delete the old Erigon volume only after an explicit backup/rollback decision.

Verify the execution endpoint:

```bash
curl --fail-with-body \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://localhost:8545
```

Sepolia returns `0xaa36a7`. Then query `eth_getLogs` once from the configured start block through a small known range and again across recent blocks. Do not retire Erigon until both return the expected events and `eth_syncing` reports that Reth has reached the head.
