# Sepolia archive node

This container runs Erigon's embedded execution and consensus clients for Sepolia in archive mode. It retains all historical state and enables persisted receipts, so `eth_getLogs` can query every block from the start of the current month as well as older history.

Erigon also writes its own process logs under `/home/erigon/.local/share/erigon/logs` in the persistent data volume. Those files survive container recreation.

## Start

From this directory, run:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build -d
docker compose logs -f erigon
```

On Windows, run `start.bat` from this directory. It starts the same Compose project in the foreground and keeps the window open when Docker exits so that errors remain visible.

The first startup lines print the RPC addresses. With the defaults, applications on the host connect to:

```text
http://localhost:8545
```

Other repository Compose services connect to `http://erigon:8545` through the shared external `zoltar` network. WebSockets use the same addresses with the `ws://` scheme. The host RPC binding is deliberately restricted to `127.0.0.1`; use a reverse proxy with authentication and TLS instead of exposing the debug and trace APIs directly to the internet.

To use another host port, create an `.env` file beside `compose.yaml`:

```dotenv
ERIGON_RPC_PORT=9545
```

The printed host address would then be `http://localhost:9545`. The RPC remains available only from the Docker host and other Compose services.

## Data and retention

Chain data and Erigon's file logs live in the `erigon-sepolia-data` named volume. A normal `docker compose down` preserves it. Do not run `docker compose down --volumes` unless you intend to delete the archive and sync it again.

An archive node retains all historical execution state rather than only a rolling window. This is intentionally broader than retaining logs from the first day of the current month and avoids a date-to-block boundary that would become stale. Initial synchronization downloads the historical archive and can take substantial time, disk space, and bandwidth; the RPC listener starts immediately, but historical requests are complete only after the relevant sync stages finish.

The public P2P, Caplin discovery, and snapshot-download ports are published for reliable sync. The JSON-RPC port is only published on loopback. If a host firewall is enabled, allow inbound TCP/UDP `30303`, UDP `4000`, TCP `4001`, and TCP/UDP `42069` as appropriate for the host.

Verify the node and its network after it has started:

```bash
curl --fail-with-body \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://localhost:8545
```

Sepolia's chain ID is returned as `0xaa36a7`.
