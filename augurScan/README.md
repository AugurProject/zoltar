# augurScan

augurScan is a read-only explorer for the Zoltar/Augur protocol. It indexes configured Ethereum networks into PostgreSQL, retains raw and historical evidence, and presents the result through a live web interface and bounded APIs.

Backend capability ownership and dependency rules are documented in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).

The **Operations** area brings together the histories that operators usually need to investigate a protocol state: OpenOracle reports, escalation games, truth auctions, security-pool and vault risk, Zoltar forks, Statoblast migrations, AMM trading, price provenance, semantic changes, and chain replacements. The global timeline lets you filter those records across Zoltar, Trading, Statoblast, and Open Oracle by entity, event, address, block range, text, and canonical status.

## Start with Docker

Run these commands from `augurScan/`:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory. Open <http://localhost:3000>. Compose now runs separate `app` and `indexer` containers against the same PostgreSQL database, so browsing remains responsive while backfill continues. PostgreSQL data is stored in the `augurscan-data` named volume, so rebuilding the containers does not discard indexed history.

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
- `/operations/integrity` for reorgs, replay causes, migrations, indexer provenance, and canonical decode coverage by destination and selector.

Detail routes are deep-linkable. Preserve `chainId` when constructing a link and preserve `atBlock` on a historical risk link. Address links stay inside augurScan; `/address?chainId=:chainId&address=:address` summarizes balances, REP tokens, pools, vaults, interactions, and recent transactions, with the external explorer as a secondary link.

Every visible route refreshes after a committed block notification and on the status cycle. Activity preserves the reader's scroll position while new rows arrive. Paged Operations views restore the visible depth at one canonical boundary instead of mixing results from different heads.

## What the index covers

augurScan starts at the configured history boundary or the earliest verified deployment within it. If the RPC provider has pruned older logs, augurScan dynamically advances log coverage to the earliest block the provider can return; this log boundary is independent of the provider's historical-state boundary. See the [operations guide](OPERATIONS.md#prepare-the-deployment) for provider requirements. The indexer reads every block in bounded batches and selects direct calls to tracked protocol contracts, including reverted and eventless calls, alongside protocol logs and filtered Uniswap events. When the provider supports `debug_traceBlockByHash` with `callTracer`, nested protocol calls also select transactions. Selected receipts retain call trees and trace availability; transaction pages show internal calls and ETH values, including attempted values in reverted frames. Providers without tracing still index direct calls and log-selected transactions, but nested calls without protocol logs remain outside coverage. Unrelated traffic through global shared dependencies is excluded. Full-block reads and tracing increase RPC cost compared with log-only scanning.

For selected transactions, augurScan retains the block number, hash, parent hash, and timestamp; the transaction hash, position, sender, recipient, value, input, status, gas used, and receipt; and exact raw log topics and data. Integer quantities and raw log bytes remain lossless, but this is not a complete raw Ethereum block archive. Reorganizations keep displaced occurrences as noncanonical history. Decoder and projection runs append source-attributed interpretations, while tagged contract reads—including address balances and token metadata—append run-attributed observations before updating current materializations. Manifest or source replay rebuilds derived state without erasing retained canonical chain evidence or direct observations.

Escalation balances and resolutions use tagged contract reads. Address share positions use indexed ERC-1155 transfers, including migration mints without counting them twice; source positions are marked locked after migration. Complete-set inventory includes INVALID, YES, and NO and is not a redemption quote. Deposit positions distinguish consumed, pending, and winning principal; actual carried claims still require their [carry proof](../docs/reference/merkle-mountain-range.html#proofs) and [payout calculation](../docs/explanation/escalation-game.html#payouts). Refund balances and fee accrual totals cover indexed history and do not establish completeness before the configured history boundary.

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

`bun run dev` starts separate watched app and indexer processes. For manual local startup, run `bun run build && bun src/server.ts` for the web app and `bun run start:indexer` for the indexer in a second terminal.

`bun run build` generates scanner metadata and bundles `browser/` to the ignored `public/app.js`. Typecheck, tests, and indexer startup also prepare the metadata automatically. Docker generates it in a build stage and copies the results into the runtime image.

The default tests need no infrastructure. PostgreSQL integration tests require a dedicated disposable database because they recreate its `public` schema:

```bash
docker run --detach --rm --name augurscan-test-postgres \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=augurscan \
  --env POSTGRES_PASSWORD=augurscan \
  --env POSTGRES_DB=augurscan_test \
  postgres:17.11-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73

POSTGRES_TEST_URL=postgres://augurscan:augurscan@localhost:55432/augurscan_test bun run test:integration
docker stop augurscan-test-postgres
```

ABI catalogs, contract routes, and network manifests are ignored build outputs. The Solidity sources, deployment metadata, dependency ABIs in `config/dependency-abis.json`, and their source pins remain tracked. Builds verify the vendored ABI checksums and never download replacements. Missing or modified ABI files fail validation.

To generate only metadata or verify existing outputs:

```bash
bun run metadata:build
bun run metadata:check
```

For a dependency upgrade, review and copy its ABI into `config/dependency-abis.json`, update the source URL, version, and checksums in `config/dependency-abi-sources.json`, and run `bun run metadata:check`. Commit the ABI and pins together. Source URLs record provenance; builds do not fetch them. Do not edit the generated scanner metadata.

Generated scanner metadata lives under `augurScan/config`. The production image uses those outputs and the repository's shared Ethereum adapter; it does not require Solidity or deployment sources at runtime.
