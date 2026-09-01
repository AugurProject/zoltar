# augurScan

augurScan is a read-only explorer for the Zoltar/Augur protocol. It indexes configured Ethereum networks into PostgreSQL, retains raw and historical evidence, and presents the result through a live web interface and bounded APIs.

The **Operations** area brings together the histories that operators usually need to investigate a protocol state: OpenOracle reports, escalation games, truth auctions, security-pool and vault risk, Zoltar forks, Statoblast migrations, AMM trading, price provenance, semantic changes, and chain replacements. The global timeline lets you filter those records across Zoltar, Trading, Statoblast, and Open Oracle by entity, event, address, block range, text, and canonical status.

## Start with Docker

Run these commands from `augurScan/`:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory. Open <http://localhost:3000>. PostgreSQL data is stored in the `augurscan-data` named volume, so rebuilding the app container does not discard indexed history.

The public RPC defaults are suitable for evaluation but may rate-limit a large backfill. Put archival-capable endpoints in `.env` for reliable indexing. `NETWORKS=mainnet` or `NETWORKS=sepolia` limits the enabled networks. The website remains available during backfill and reports each network's indexed block, observed head, lag, progress, estimated time remaining, and current error.

The Compose services join the external `zoltar` network. If this repository's Reth Compose project is running, `SEPOLIA_RPC_URL=http://reth:8545` reaches it without exposing RPC outside the host.

For production configuration, access controls, backups, upgrades, restore checks, integrity review, deterministic exports, and safe shutdown, follow [OPERATIONS.md](OPERATIONS.md).

## Explore the data

The network selector in the header controls Activity, **Operations**, **System state**, **Contracts**, and **Rich list**. Its selection is stored in the `chainId` query parameter. Point-in-time pool and vault risk views also accept `atBlock` for a retained canonical block.

Useful Operations routes include:

- `/operations/reports`, `/operations/escalations`, and `/operations/auctions` for OpenOracle and dispute resolution;
- `/operations/risk` for tagged pool and vault observations;
- `/operations/forks` for Zoltar fork and Statoblast migration evidence;
- `/operations/trading` for AMM price, liquidity, volume, and fee history;
- `/operations/timeline` for cross-protocol semantic history;
- `/operations/integrity` for reorgs, replay causes, migrations, and indexer provenance.

Detail routes are deep-linkable. Preserve `chainId` when constructing a link and preserve `atBlock` on a historical risk link. Address links stay inside augurScan; `/address?chainId=:chainId&address=:address` summarizes balances, REP tokens, pools, vaults, interactions, and recent transactions, with the external explorer as a secondary link.

Every visible route refreshes after a committed block notification and on the status cycle. Activity preserves the reader's scroll position while new rows arrive. Paged Operations views restore the visible depth at one canonical boundary instead of mixing results from different heads.

## What the index covers

augurScan starts at the configured history boundary or the earliest verified deployment within it. Protocol activity-source logs, tracked REP-token logs, and configured Uniswap factory or PoolManager events select transactions for indexing. It retains the complete receipts and known logs for those selected transactions. Failed calls, successful calls without a selecting log, internal calls without retained logs, and unrelated traffic through shared dependencies are outside this release.

For selected transactions, augurScan retains the block number, hash, parent hash, and timestamp; the transaction hash, position, sender, recipient, value, input, status, gas used, and receipt; and exact raw log topics and data. Integer quantities and raw log bytes remain lossless, but this is not a complete raw Ethereum block archive. Reorganizations keep displaced occurrences as noncanonical history. Decoder and projection runs append source-attributed interpretations, while tagged contract reads—including address balances and token metadata—append run-attributed observations before updating current materializations. Manifest or source replay rebuilds derived state without erasing retained canonical chain evidence or direct observations.

The [state model](STATE_MODEL.md) explains those evidence layers and what changes during a reorg or replay. The [API reference](API_REFERENCE.md) defines filters, point-in-time reads, bounds, opaque cursors, provenance fields, and NDJSON exports.

## Local development

From the repository root, install the pinned dependencies once. Then work inside `augurScan/`:

```bash
bun install --frozen-lockfile
cd augurScan
bun run typecheck
bun test
bun run dev
```

The browser source is under `browser/`. `bun run build` bundles it to the ignored `public/app.js`; do not edit that generated file.

The default tests need no infrastructure. PostgreSQL integration tests require a dedicated disposable database because they recreate its `public` schema:

```bash
docker run --detach --rm --name augurscan-test-postgres \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=augurscan \
  --env POSTGRES_PASSWORD=augurscan \
  --env POSTGRES_DB=augurscan_test \
  postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0

POSTGRES_TEST_URL=postgres://augurscan:augurscan@localhost:55432/augurscan_test bun run test:integration
docker stop augurscan-test-postgres
```

Regenerate the committed ABI and manifest snapshots after relevant contract or deployment changes:

```bash
bun run metadata:snapshot
```

The script writes only under `augurScan/config`. The production image uses that self-contained snapshot and the repository's shared Ethereum adapter; it does not require Solidity or deployment sources at runtime.
