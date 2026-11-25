# augurScan

augurScan is a read-only explorer for the Zoltar/Augur protocol. It indexes configured Ethereum networks into PostgreSQL, retains raw and historical evidence, and presents the result through a live web interface and bounded APIs.

Backend capability ownership and dependency rules are documented in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).

The **Operations** area brings together the histories that operators usually need to investigate a protocol state: OpenOracle reports, escalation games, collateral repair auctions, security-pool settlement state, owner capital positions and their liquidation feed, Zoltar forks, Statoblast migrations, AMM trading, price provenance, semantic changes, and chain replacements. The global timeline lets you filter those records across Zoltar, Trading, Statoblast, and Open Oracle by entity, event, address, block range, text, and canonical status.

## Start with Docker

Run these commands from `augurScan/`:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory. Open <http://localhost:3000>. Compose runs separate `app` and `indexer` containers against the same PostgreSQL database, so browsing remains responsive while backfill continues. PostgreSQL data is stored in the `augurscan-data` named volume, so rebuilding the containers does not discard indexed history.

The public RPC defaults are suitable for evaluation but may rate-limit a large backfill. Put archival-capable endpoints in `.env` for reliable indexing. `NETWORKS=mainnet` or `NETWORKS=sepolia` limits the enabled networks; the [runtime settings](OPERATIONS.md#runtime-settings) table lists every variable and its default. The website remains available during backfill and reports each network's indexed block, observed head, lag, progress, estimated time remaining, and current error.

The Compose services join the external `zoltar` network. If this repository's Reth Compose project is running, `SEPOLIA_RPC_URL=http://reth:8545` reaches it without exposing RPC outside the host.

For production configuration, backups, upgrades, restore checks, integrity review, deterministic exports, and safe shutdown, follow [OPERATIONS.md](OPERATIONS.md).

## Explore the data

The network selector in the header controls Activity, **Operations**, **System state**, **Contracts**, and **Addresses**; choose a network and select **Switch** to apply it. Its selection is stored in the `chainId` query parameter. Point-in-time pool risk views also accept `atBlock` for a retained canonical block. Switching networks drops `atBlock` and the block range (`fromBlock`, `toBlock`), because block numbers belong to one chain.

Useful Operations routes include:

- `/operations/reports`, `/operations/escalations`, and `/operations/auctions` for OpenOracle and dispute resolution;
- `/operations/risk` for capital positions ranked by risk, capital ledgers, the liquidation feed, fee economics per universe, question fee streams, and tagged pool observations; `/capital/:ledger/:owner` for one owner's position, read history, and liquidation history;
- `/operations/forks` for Zoltar fork and Statoblast migration evidence;
- `/operations/trading` for AMM price, liquidity, share and ETH volume, fee history, and recent market activity;
- `/operations/timeline` for cross-protocol semantic history;
- `/operations/integrity` for reorgs, replay causes, migrations, indexer provenance, and canonical decode coverage by destination and selector.

Detail routes are deep-linkable. Preserve `chainId` when constructing a link and preserve `atBlock` on a historical risk link. Address links stay inside augurScan; `/address?chainId=:chainId&address=:address` summarizes balances, REP tokens, pools, trading profit and loss, interactions, and recent transactions, with the external explorer as a secondary link.

Every visible route refreshes after a committed block notification and on the status cycle. Activity preserves the reader's scroll position while new rows arrive. Paged Operations views restore the visible depth at one canonical boundary instead of mixing results from different heads.

## What the index covers

augurScan indexes protocol logs, selected Uniswap events, and tagged state reads. Coverage starts at the configured boundary or the earliest verified deployment within it. Provider pruning can advance the log boundary independently of historical state availability.

Security pool discovery starts with `SecurityPoolDeployed`, before the pool has questions. `SetupAdvanced` and `UniversePrepared` register the pool's components, and coverage includes the entire registering block, including the original settlement book's `BookCreated` event. A later question deployment can establish the bindings when indexing starts after setup.

By default, transaction coverage is log-based. Set `SCAN_DIRECT_CALLS=1` to scan full blocks for failed or eventless direct transactions to tracked contracts. Optional tracing adds internal calls to selected transactions.

The [state model](STATE_MODEL.md) explains coverage limits, evidence layers, and how replays preserve provenance. The [API reference](API_REFERENCE.md) defines snapshot bounds, cursors, proof availability, and exports. See the [operations guide](OPERATIONS.md#prepare-the-deployment) for provider requirements.

## Local development

From the repository root, install the pinned dependencies once. Then work inside `augurScan/`:

```bash
bun install --frozen-lockfile
bun run --cwd shared/core build
bun run --cwd shared/statoblast build
cd augurScan
bun run typecheck
bun test
```

Running the app or the indexer needs a PostgreSQL 17.11 database. The Compose database is not published to the host, so start a development database that matches the default `POSTGRES_URL` (`postgres://augurscan:augurscan@localhost:5432/augurscan`), or set `POSTGRES_URL` to another one:

```bash
docker run --detach --name augurscan-dev-postgres \
  --publish 127.0.0.1:5432:5432 \
  --env POSTGRES_USER=augurscan \
  --env POSTGRES_PASSWORD=augurscan \
  --env POSTGRES_DB=augurscan \
  postgres:17.11-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73

bun run dev
```

`bun run dev` starts separate watched app and indexer processes. For manual local startup, run `bun run build && bun src/server.ts` for the web app and `bun run start:indexer` for the indexer in a second terminal. The web app never indexes; only the indexer process writes chain evidence.

`bun run build` generates scanner metadata and bundles `browser/` to the ignored `public/app.js`. Typecheck, tests, and indexer startup also prepare the metadata automatically. Docker generates it in a build stage and copies the results into the runtime image.

### Tests

`bun test` runs every suite under `tests/`. PostgreSQL integration cases require `POSTGRES_TEST_URL`. Chromium cases require a browser fixture. Run `bun run test:browser:chromium` with Chromium installed to start the fixture and exercise those cases.

| Command | Scope |
| --- | --- |
| `bun run test:unit` | Pure validation, cursor, projection, and lifecycle behavior. |
| `bun run test:api` | Routes, response contracts, and the export scripts. |
| `bun run test:replay` | Indexer and replay behavior. |
| `bun run test:integration` | Real PostgreSQL transaction, lease, reorganization, and API boundaries. |
| `bun run test:browser` | Browser application modules and tests with any configured fixture. |
| `bun run test:browser:chromium` | Browser workflows against a local fixture using Chromium. |
| `bun run test:ci` | Unit, API, replay, and browser tests. |
| `bun run test` | `test:ci` plus integration. |

The integration tests require a dedicated disposable database because they recreate its `public` schema:

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

### Other scripts

| Command | Purpose |
| --- | --- |
| `bun run check` | Metadata build, import-boundary check, restricted-import check, metadata check, and Biome. |
| `bun run format`, `bun run format:check` | Biome formatting. |
| `bun run schema:init` | Initializes or migrates the schema in the `POSTGRES_URL` database and exits. |
| `bun run qa:serve` | Builds the demo browser bundle and serves it against fixture data on port `3001` (or `PORT`), without a database. |
| `bun run build:demo` | Builds only that demo bundle. |
| `bun run metadata:snapshot` | Writes the generated scanner metadata from the already compiled contract artifacts. `metadata:build` compiles the contracts first and then runs it. |
| `bun run metadata:unknown-calls` | Read-only report of canonical undecoded outer calls in the `POSTGRES_URL` database; `--limit` accepts 1–1000 and defaults to 100. |

### Scanner metadata

ABI catalogs, contract routes, and network manifests are ignored build outputs. The Solidity sources, deployment metadata, dependency ABIs in `config/dependency-abis.json`, and their source pins remain tracked. Builds verify the vendored ABI checksums and never download replacements. Missing or modified ABI files fail validation.

To generate only metadata or verify existing outputs:

```bash
bun run metadata:build
bun run metadata:check
```

For a dependency upgrade, review and copy its ABI into `config/dependency-abis.json`, update the source URL, version, and checksums in `config/dependency-abi-sources.json`, and run `bun run metadata:check`. Commit the ABI and pins together. Source URLs record provenance; builds do not fetch them. Do not edit the generated scanner metadata.

Generated scanner metadata lives under `augurScan/config`. The production image uses those outputs and the repository's shared Ethereum adapter; it does not require Solidity or deployment sources at runtime.
