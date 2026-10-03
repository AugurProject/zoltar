# Operate augurScan without losing history

This guide covers a Compose deployment whose working directory is `augurScan/`. It shows how to configure the service, prove a backup can be restored, upgrade, inspect historical integrity, export deterministic evidence, and stop the service safely.

## Prepare the deployment

Use archival-capable JSON-RPC providers that can return runtime bytecode, block headers, transactions, and receipts throughout the configured history boundary. Each RPC environment variable accepts an ordered comma-separated provider pool. augurScan verifies a provider's chain before using it and resumes failed work from its durable checkpoint.

At startup, augurScan probes historical state. When the provider reports pruned state, augurScan locates its earliest retrievable state block and skips token metadata, balance, snapshot, and deployment-code reads below that boundary. Repeated state-discovery failures produce one console warning per provider, while every failed RPC exchange remains in the rotating JSONL log.

Log availability is discovered separately. If an `eth_getLogs` request reports pruned history, augurScan warns that it is locating the log boundary, finds the earliest retrievable log block on demand, and advances log coverage to that block. The state and log boundaries can differ. An archival provider remains necessary for evidence before either reported boundary.

`config/networks.json` selects each network's manifest. Manifest entries are `[address, label, kind]` or `[address, label, kind, deploymentBlock]`. A verified deployment block avoids historical bytecode discovery and gives later replay a deterministic boundary. Keep an old address in the manifest while it remains a valid activity source.

### Runtime settings

Every setting is an environment variable. The Compose column names the service that receives it; Compose substitutes the value from the host shell or `.env`, and falls back to the default shown.

| Variable | Default | Compose service | Effect |
| --- | --- | --- | --- |
| `NETWORKS` | every network in `config/networks.json` (`mainnet,sepolia`) | `app`, `indexer` | Comma-separated enabled networks. An unknown id stops startup. |
| `MAINNET_RPC_URL`, `SEPOLIA_RPC_URL` | `https://mainnet.gateway.tenderly.co`, `https://sepolia.gateway.tenderly.co` | `indexer` | Ordered comma-separated HTTP(S) provider pool. |
| `MAINNET_START_BLOCK`, `SEPOLIA_START_BLOCK` | `0` | `indexer` | Lower bound for deployment discovery. A manifest deployment block must not precede it. |
| `MAINNET_AMM_FACTORY_ADDRESS`, `SEPOLIA_AMM_FACTORY_ADDRESS` | unset | `indexer` | Adds an Augur AMM factory as a tracked contract when the manifest does not already list that address. |
| `MAINNET_UNISWAP_V2_FACTORY_ADDRESS`, `MAINNET_UNISWAP_V3_FACTORY_ADDRESS`, `MAINNET_UNISWAP_V4_POOL_MANAGER_ADDRESS`, and the matching `SEPOLIA_` variables | network default | `indexer` | Override the Uniswap activity sources. An unset or empty value selects the network default, and `none` disables that source. The V2 default comes from `config/networks.json`; the V3 and V4 defaults come from the shared Uniswap registry in `shared/core/ts/deployment/uniswapDeployments.ts`. |
| `LOG_SCAN_RANGE_SIZE` | `100000` | `indexer` | Caps each inclusive `eth_getLogs` request, in blocks. |
| `TRACE_SELECTED_TRANSACTIONS` | `0` | `indexer` | `1` enables optional `debug_traceTransaction` enrichment for log-selected transactions. It requires provider support for `callTracer` and adds RPC work. It does not index failed or eventless calls. Changing it affects subsequent ingestion and does not replay existing receipts. |
| `POLL_INTERVAL_MS` | `12000` | `app`, `indexer` | Indexer polling interval. The web app treats an indexer as stale after four intervals, or 45 seconds if that is longer. |
| `SCAN_BLOCK_TIME_MS` | `12000` on Mainnet and Sepolia | `indexer` | Block interval, in milliseconds, that the indexer's scan status log uses to report a scan as lagging. |
| `RPC_LOG_PATH` | `augurScan/logs/rpc.jsonl` | `indexer`, fixed to `/var/log/augurscan/rpc.jsonl` in the `augurscan-logs` volume | Rotating JSONL log of RPC exchanges. |
| `POSTGRES_URL` | `postgres://augurscan:augurscan@localhost:5432/augurscan`; in Compose, the bundled `postgres` service | `app`, `indexer` | Connects directly to PostgreSQL or through a session-mode pooler. |
| `POSTGRES_PASSWORD` | `augurscan-local` | `postgres`, and the default `POSTGRES_URL` | Password of the bundled database. Compose only. |
| `PORT` | `3000` | `app`, fixed to `3000` | Port the web app listens on. |
| `AUGURSCAN_PORT` | `3000` | host port of `app` | Host port that Compose publishes. Compose only. |
| `AUGURSCAN_ACCESS_USERNAME`, `AUGURSCAN_ACCESS_PASSWORD` | unset | `app` | Enable HTTP Basic access control when both are set. Setting only one stops startup. |
| `API_RATE_LIMIT_PER_MINUTE` | `600` | `app` | Per-client API limit. It also limits failed Basic-authentication attempts on protected non-API routes. `0` disables both limits when a trusted upstream enforces them. |
| `LIVE_BACKPRESSURE_TIMEOUT_MS` | `60000` | `app` | How long a live-stream client may make no write progress before its slot is closed and released. |
| `DISABLE_INDEXER` | unset | `indexer` (`0`); fixed to `1` on `app` | `1` starts the indexer process without indexing. See below. |

`DISABLE_INDEXER` affects only the indexer process (`src/indexer-process.ts`). The web app (`src/server.ts`) never indexes, whatever the value. A process that runs without indexing still needs write access: it initializes or migrates the schema, records an indexer-disabled process run, prunes expired live-stream events, and records the run's stop time.

API requests and failed Basic-authentication attempts share one per-client quota. When Basic authentication is enabled, exhausting that quota temporarily blocks all protected routes for the client, including requests with valid credentials, until the window resets. Successful non-API requests do not consume quota.

The writer lease is a PostgreSQL session advisory lock and is incompatible with transaction-mode pooling. Terminate TLS before enabling Basic authentication because Basic credentials are encoded, not encrypted. Do not expose PostgreSQL publicly, and do not rely on the process-local rate limiter as a distributed edge control. `GET /metrics` exposes bounded Prometheus request, limiter, indexer-lag, success, and failure metrics.

Bundled and external databases must use PostgreSQL 17.11. Compose pins the corresponding `postgres:17.11-alpine` image by digest. augurScan validates the server release before it initializes, migrates, or verifies the schema because its schema fingerprints are version-specific.

Upgrading to event-first indexing changes the application source hash and triggers the existing source replay. Current views are rebuilt from log-selected activity; prior occurrences and interpretations remain retained for audit.

Changing a tracked manifest address, label, kind, or deployment boundary can replay the affected network. ABI changes cause an `abi-redecode`; application or projection changes cause a conservative `projection-rebuild`. A deployment earlier than the stored coverage boundary requires a new database rather than silently presenting partial history. Review [STATE_MODEL.md](STATE_MODEL.md) before a source or manifest upgrade.

## Back up and prove the restore

Use a PostgreSQL client whose major version is at least the server's major version. Run this procedure in one Bash session with strict error handling, then choose exactly one database mode so every backup, restore, export, and cleanup command targets the same deployment:

```bash
set -euo pipefail
export AUGURSCAN_URL=http://localhost:3000
export AUGURSCAN_CHAIN_ID=1
export AUGURSCAN_DATABASE_MODE=bundled
```

Bundled mode supports exactly the Compose `augurscan@postgres:5432/augurscan` source and its named volume. Before stopping any writer, build the pinned operator helpers and validate the fully resolved Compose configuration, including values loaded from `.env`. The validator never connects to the database. If it rejects the role, host, port, database, URL shape, or missing value, select `external`; the bundled commands below deliberately do not infer another target.

```bash
if test "$AUGURSCAN_DATABASE_MODE" = bundled; then
  docker compose build app
  docker compose config --format json |
    docker compose run --rm --no-deps -T --entrypoint bun \
      app augurScan/scripts/verify-compose-source.ts
fi
```

For external mode, supply a direct URL for the live database, a simple identifier for a new restore database, the role that will own and restore it, and a direct URL that connects as that owner to that database. Choose `postgres` provisioning when the administrative URL can create and drop databases owned by the restore role. Choose `provider` when the provider's controls will create and later delete the isolated database with that owner. Do not use a transaction-mode pooler for these commands.

```bash
export AUGURSCAN_DATABASE_MODE=external
export AUGURSCAN_SOURCE_URL='postgres://user:password@database.example/augurscan'
export AUGURSCAN_RESTORE_PROVISIONING=postgres
export AUGURSCAN_RESTORE_DATABASE=augurscan_restore
export AUGURSCAN_RESTORE_OWNER=augurscan_restore
export AUGURSCAN_RESTORE_ADMIN_URL='postgres://admin:password@database.example/postgres'
export AUGURSCAN_RESTORE_URL='postgres://augurscan_restore:password@database.example/augurscan_restore'
```

Stop every augurScan indexer instance connected to the live database and prevent a standby from taking over while this procedure runs. For the Compose deployment, stop its `indexer` service. The web app can remain online for reads, but leave the indexer stopped until the upgrade step starts it again so the source evidence boundary stays fixed between the proof and the dump.

```bash
set -euo pipefail
docker compose stop indexer
```

The proof below records source counts and its greatest indexed checkpoint before the dump. The pending filename prevents a failed or partial dump from being mistaken for a backup.

```bash
set -euo pipefail
export AUGURSCAN_BACKUP_FILE=augurscan-before-upgrade.dump
export AUGURSCAN_PROOF_SQL="SELECT jsonb_build_object(
  'schemaVersion', (SELECT schema_version FROM augurscan_schema WHERE singleton),
  'networkCount', (SELECT count(*) FROM networks),
  'blockCount', (SELECT count(*) FROM blocks),
  'logCount', (SELECT count(*) FROM logs),
  'replacementCount', (SELECT count(*) FROM chain_reorganizations),
  'networkBoundaries', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'chainId', network.chain_id::text,
      'startBlock', network.start_block::text,
      'indexedBlock', network.indexed_block::text,
      'indexedHash', network.indexed_hash,
      'invalidationId', COALESCE((SELECT max(replacement.id)::text FROM chain_reorganizations replacement
        WHERE replacement.chain_id = network.chain_id), '0'),
      'abiSourceHash', network.applied_abi_source_hash,
      'applicationSourceHash', network.applied_application_source_hash,
      'projectionSourceHash', network.applied_projection_source_hash
    ) ORDER BY network.chain_id) FROM networks network
  ), '[]'::jsonb)
)::text"

case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    AUGURSCAN_SOURCE_PROOF=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d augurscan -Atc "$AUGURSCAN_PROOF_SQL")
    ;;
  external)
    AUGURSCAN_SOURCE_PROOF=$(psql -X -v ON_ERROR_STOP=1 --dbname="${AUGURSCAN_SOURCE_URL:?}" -Atc "$AUGURSCAN_PROOF_SQL")
    ;;
  *) echo 'AUGURSCAN_DATABASE_MODE must be bundled or external.' >&2; exit 2 ;;
esac

AUGURSCAN_BACKUP_PENDING="$AUGURSCAN_BACKUP_FILE.pending"
test ! -e "$AUGURSCAN_BACKUP_FILE"
test ! -e "$AUGURSCAN_BACKUP_PENDING"
augurscan_dump() {
  case "$AUGURSCAN_DATABASE_MODE" in
    bundled) docker compose exec -T postgres pg_dump -U augurscan -d augurscan --format=custom ;;
    external) pg_dump --dbname="$AUGURSCAN_SOURCE_URL" --format=custom ;;
  esac
}
if augurscan_dump > "$AUGURSCAN_BACKUP_PENDING" && test -s "$AUGURSCAN_BACKUP_PENDING"; then
  mv "$AUGURSCAN_BACKUP_PENDING" "$AUGURSCAN_BACKUP_FILE"
else
  test ! -e "$AUGURSCAN_BACKUP_PENDING" || mv "$AUGURSCAN_BACKUP_PENDING" "$AUGURSCAN_BACKUP_PENDING.failed.$$"
  echo 'Backup failed; the final backup name was not created.' >&2
  exit 1
fi
```

Restore only into a new, empty database. The `postgres` path deliberately fails if that name already exists instead of dropping it. For `provider` provisioning, create a new empty database with the provider's controls before continuing. The identity checks prove that `AUGURSCAN_RESTORE_URL` connects as the declared owner to the intended database. The catalog check rejects any existing public table, partition, view, materialized view, sequence, foreign table, or routine before restore.

```bash
set -euo pipefail
: "${AUGURSCAN_SOURCE_PROOF:?Run the backup proof first}"
: "${AUGURSCAN_BACKUP_FILE:?Run the backup first}"
export AUGURSCAN_RESTORE_DATABASE=${AUGURSCAN_RESTORE_DATABASE:-augurscan_restore}
[[ "$AUGURSCAN_RESTORE_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || {
  echo 'AUGURSCAN_RESTORE_DATABASE must be a simple PostgreSQL identifier.' >&2
  exit 2
}
if test "$AUGURSCAN_DATABASE_MODE" = external; then
  [[ "${AUGURSCAN_RESTORE_OWNER:?}" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || {
    echo 'AUGURSCAN_RESTORE_OWNER must be a simple PostgreSQL role name.' >&2
    exit 2
  }
fi
export AUGURSCAN_PUBLIC_OBJECT_SQL="SELECT
  (SELECT count(*) FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f'))
  + (SELECT count(*) FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public')"

case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    docker compose exec -T postgres createdb -U augurscan "$AUGURSCAN_RESTORE_DATABASE"
    AUGURSCAN_RESTORE_CURRENT=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc 'SELECT current_database()')
    AUGURSCAN_RESTORE_CURRENT_USER=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc 'SELECT current_user')
    AUGURSCAN_RESTORE_ACTUAL_OWNER=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")
    AUGURSCAN_RESTORE_OBJECTS=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "$AUGURSCAN_PUBLIC_OBJECT_SQL")
    AUGURSCAN_RESTORE_EXPECTED_OWNER=augurscan
    ;;
  external)
    case "${AUGURSCAN_RESTORE_PROVISIONING:?}" in
      postgres) createdb --maintenance-db="${AUGURSCAN_RESTORE_ADMIN_URL:?}" --owner="$AUGURSCAN_RESTORE_OWNER" "$AUGURSCAN_RESTORE_DATABASE" ;;
      provider) : ;;
      *) echo 'AUGURSCAN_RESTORE_PROVISIONING must be postgres or provider.' >&2; exit 2 ;;
    esac
    AUGURSCAN_RESTORE_CURRENT=$(psql -X -v ON_ERROR_STOP=1 --dbname="${AUGURSCAN_RESTORE_URL:?}" -Atc 'SELECT current_database()')
    AUGURSCAN_RESTORE_CURRENT_USER=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc 'SELECT current_user')
    AUGURSCAN_RESTORE_ACTUAL_OWNER=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")
    AUGURSCAN_RESTORE_OBJECTS=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "$AUGURSCAN_PUBLIC_OBJECT_SQL")
    AUGURSCAN_RESTORE_EXPECTED_OWNER=$AUGURSCAN_RESTORE_OWNER
    ;;
  *) echo 'AUGURSCAN_DATABASE_MODE must be bundled or external.' >&2; exit 2 ;;
esac
test "$AUGURSCAN_RESTORE_CURRENT" = "$AUGURSCAN_RESTORE_DATABASE"
test "$AUGURSCAN_RESTORE_CURRENT_USER" = "$AUGURSCAN_RESTORE_EXPECTED_OWNER"
test "$AUGURSCAN_RESTORE_ACTUAL_OWNER" = "$AUGURSCAN_RESTORE_EXPECTED_OWNER"
test "$AUGURSCAN_RESTORE_OBJECTS" = 0
export AUGURSCAN_OBJECT_OWNER_SQL="SELECT count(*) FROM (
  SELECT class.relowner AS owner FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT routine.proowner FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
) object WHERE pg_get_userbyid(object.owner) <> current_user"

case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    docker compose exec -T postgres pg_restore -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" --exit-on-error --single-transaction --no-owner < "$AUGURSCAN_BACKUP_FILE"
    AUGURSCAN_RESTORE_PROOF=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "$AUGURSCAN_PROOF_SQL")
    AUGURSCAN_LIVE_PROOF=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d augurscan -Atc "$AUGURSCAN_PROOF_SQL")
    ;;
  external)
    pg_restore --dbname="$AUGURSCAN_RESTORE_URL" --exit-on-error --single-transaction --no-owner < "$AUGURSCAN_BACKUP_FILE"
    AUGURSCAN_RESTORE_PROOF=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "$AUGURSCAN_PROOF_SQL")
    AUGURSCAN_LIVE_PROOF=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_SOURCE_URL" -Atc "$AUGURSCAN_PROOF_SQL")
    ;;
esac
test "$AUGURSCAN_RESTORE_PROOF" = "$AUGURSCAN_SOURCE_PROOF"
test "$AUGURSCAN_LIVE_PROOF" = "$AUGURSCAN_SOURCE_PROOF"
case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    AUGURSCAN_RESTORE_WRONG_OWNERS=$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "$AUGURSCAN_OBJECT_OWNER_SQL")
    ;;
  external)
    AUGURSCAN_RESTORE_WRONG_OWNERS=$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "$AUGURSCAN_OBJECT_OWNER_SQL")
    ;;
esac
test "$AUGURSCAN_RESTORE_WRONG_OWNERS" = 0
```

Any failed command stops this Bash session before upgrade or export. A failed `pg_restore --single-transaction` leaves no partially restored schema. Keep the verified restore database until every export has finished.

A supported schema upgrade runs in one transaction under an advisory lock. Startup fingerprints the full public layout before accepting its schema marker and verifies the migrated layout before committing the new marker. If either check fails, restore a compatible backup or run the intervening supported release; do not delete evidence to force startup.

## Upgrade and check readiness

Rebuild the services and wait for the database and API to become ready:

```bash
docker compose up --build --force-recreate --detach
until curl --fail --silent --show-error "$AUGURSCAN_URL/health/ready"; do sleep 2; done
```

If access control is enabled, export both credentials in the operator shell. This helper, for the manual requests in this guide, rejects a half-configured pair and keeps credentials out of the URL and the process arguments:

```bash
augurscan_curl() {
  if test -n "${AUGURSCAN_ACCESS_USERNAME:-}" || test -n "${AUGURSCAN_ACCESS_PASSWORD:-}"; then
    test -n "${AUGURSCAN_ACCESS_USERNAME:-}" && test -n "${AUGURSCAN_ACCESS_PASSWORD:-}" || {
      echo 'Set both AUGURSCAN_ACCESS_USERNAME and AUGURSCAN_ACCESS_PASSWORD.' >&2
      return 2
    }
    local credentials="$AUGURSCAN_ACCESS_USERNAME:$AUGURSCAN_ACCESS_PASSWORD"
    credentials=${credentials//\\/\\\\}
    credentials=${credentials//\"/\\\"}
    curl --config <(printf 'user = "%s"\n' "$credentials") "$@"
  else
    curl "$@"
  fi
}
```

Audit checkpoints, source cursors, stale networks, and recent canonical continuity:

```bash
augurscan_curl --fail-with-body --silent --show-error "$AUGURSCAN_URL/health/indexers"
```

This route returns HTTP 503 when the indexer is stale or the audit finds a problem. Its parent-hash continuity scan covers at most the latest 10,000 indexed blocks, so it does not replace the retained-history review below.

## Review replacements and provenance

Open `$AUGURSCAN_URL/operations/integrity?chainId=$AUGURSCAN_CHAIN_ID`. Load records until **All indexed records are shown.** Each replacement includes its primary reason, complete cause set, affected occurrence counts, old and replacement boundaries, and the exact indexer run and source hashes that initiated it.

API clients should follow `data.nextCursor` while `data.hasMore` is true. The integrity cursor fixes the greatest visible replacement ID and materialization generation. A later invalidation returns HTTP 409; restart from the first page rather than combining generations. `/api/v1/provenance` is also paged and identifies the indexer run plus its ABI, application, and projection hashes.

The `/api/v1/reorgs` view uses a chain- and generation-bound cursor. A new invalidation returns `409` so an operator restarts instead of combining generations. Use the deterministic export below for durable audit files with per-page proofs. The [API reference](API_REFERENCE.md) owns the exact response, cursor, and pagination contracts.

## Export deterministic evidence

Run exports against the restored database through an isolated app process without the dedicated indexer. This keeps the live service available and prevents the export boundary from changing because of chain indexing. This process still needs write access: it can migrate the restored schema, appends an `indexer_runs` provenance row, prunes expired `live_events`, and records its stop time. After any required migration, it does not index new chain evidence, so the restored evidence boundary remains fixed. Both database modes use the pinned app image that Compose built during the upgrade.

The isolated container needs its own direct, container-reachable URL for the restored database. External mode already set `AUGURSCAN_RESTORE_URL` during restore preparation. In bundled mode, set it explicitly with the actual password that the `postgres` service reads from `.env`; percent-encode reserved URL characters. Do not rely on an unexported `POSTGRES_PASSWORD`, and do not use `localhost` to name a database outside the container.

```bash
if test "$AUGURSCAN_DATABASE_MODE" = bundled; then
  export AUGURSCAN_RESTORE_URL='postgres://augurscan:actual-password@postgres:5432/augurscan_restore'
fi
```

Export one dataset at a time from Bash. Supported datasets are `logs`, `reorgs`, and `timeline`. Logs and timeline accept `canonical`, `orphaned`, or `all`; reorganization exports require `all` because replacements have no canonical classification. The [API reference](API_REFERENCE.md#evidence-and-export) owns the full filter contract. The continuation cursor belongs to the response header, not the NDJSON body.

```bash
export AUGURSCAN_EXPORT_DATASET=logs
export AUGURSCAN_EXPORT_CANONICAL=all
export AUGURSCAN_EXPORT_FROM_BLOCK=0
export AUGURSCAN_EXPORT_TO_BLOCK=9223372036854775807
export AUGURSCAN_EXPORT_DIRECTORY="$(pwd)/augurscan-export-$(date -u +%Y%m%dT%H%M%SZ)-$$/$AUGURSCAN_EXPORT_DATASET"
scripts/export-history.sh
```

The script accepts two further optional variables: `AUGURSCAN_EXPORT_PORT` (default `3002`) is the host loopback port of the isolated app, and `AUGURSCAN_EXPORT_CONTAINER` (default `augurscan-export-<pid>`) is its container name.

If access control is enabled, export `AUGURSCAN_ACCESS_USERNAME` and `AUGURSCAN_ACCESS_PASSWORD` in this shell before running the script. It starts the isolated app with exactly this shell's values, not the ones in `.env`, and sends them as HTTP Basic credentials through a curl configuration file descriptor, so they appear in neither the URL nor the process arguments. With both unset, the isolated app runs without access control; it is published only on host loopback. Setting only one is rejected.

The script validates the restore target and request scope, starts the isolated process, follows every continuation, verifies each page with the pinned app image, and stops the container after success. Its `EXIT` trap force-removes only the exact named export container after a readiness, transport, HTTP, or verifier failure. It does not delete the restore database or any pending, failed, invalidated, or validated evidence directory, so those remain available for diagnosis.

Each successful response is atomically renamed from a hidden pending directory to a numbered page directory, starting at `page-0`, containing `evidence.ndjson`, `headers`, and `validation.json`; the script refuses to overwrite one. The pinned image validates one complete set of snapshot and source headers, valid non-empty JSON objects on every NDJSON line, an exact line count, a cursor exactly when `truncated=true`, and the exact prior continuation cursor on every later request. It also requires every row to match the requested dataset, chain, canonical scope, and range; requires dataset-specific row identities to increase strictly across page boundaries; binds each response cursor to the final row; keeps the snapshot boundary fixed; and requires the final cumulative count to equal the first page's exact total. A cursor binds the dataset, chain, canonical scope, requested range, indexed block/hash, invalidation ID, exact total, applied source hashes, and last-row identity. HTTP 409 means that boundary changed: the script quarantines the response as `INVALIDATED-page-N` and exits. Quarantine every page from that attempt and start again from the first page in a new export directory. Do not concatenate pages across attempts. Change `AUGURSCAN_EXPORT_FROM_BLOCK` and `AUGURSCAN_EXPORT_TO_BLOCK` to constrain the interval. For a replacement range, compare `canonical=orphaned` and `canonical=canonical` log exports by block hash.

The script cannot resume an interrupted attempt: it keeps the continuation cursor only in the running process and refuses to overwrite an existing page directory. After an interruption, start again with a new `AUGURSCAN_EXPORT_DIRECTORY`. Each committed page's `headers` file records the cursor that produced the next page. An interrupted request remains in a hidden pending directory; do not treat it as committed evidence. Keep the restore database until every dataset is complete.

The script has already stopped the isolated container. Remove the temporary restore database only after checking the exported files. Cleanup first verifies the restored database's identity again. The `postgres` branch deletes that explicit name through the administrative connection. The `provider` branch never runs `dropdb`; delete that exact database with the same provider control used to create it.

```bash
set -euo pipefail
case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    test "$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc 'SELECT current_database()')" = "$AUGURSCAN_RESTORE_DATABASE"
    test "$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc 'SELECT current_user')" = augurscan
    test "$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")" = augurscan
    test "$(docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U augurscan -d "$AUGURSCAN_RESTORE_DATABASE" -Atc "${AUGURSCAN_OBJECT_OWNER_SQL:?}")" = 0
    docker compose exec -T postgres dropdb -U augurscan "$AUGURSCAN_RESTORE_DATABASE"
    ;;
  external)
    test "$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc 'SELECT current_database()')" = "$AUGURSCAN_RESTORE_DATABASE"
    test "$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc 'SELECT current_user')" = "$AUGURSCAN_RESTORE_OWNER"
    test "$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")" = "$AUGURSCAN_RESTORE_OWNER"
    test "$(psql -X -v ON_ERROR_STOP=1 --dbname="$AUGURSCAN_RESTORE_URL" -Atc "${AUGURSCAN_OBJECT_OWNER_SQL:?}")" = 0
    case "$AUGURSCAN_RESTORE_PROVISIONING" in
      postgres) dropdb --maintenance-db="$AUGURSCAN_RESTORE_ADMIN_URL" "$AUGURSCAN_RESTORE_DATABASE" ;;
      provider) echo "Delete $AUGURSCAN_RESTORE_DATABASE with the provider control that created it." ;;
      *) echo 'AUGURSCAN_RESTORE_PROVISIONING must be postgres or provider.' >&2; exit 2 ;;
    esac
    ;;
  *) echo 'AUGURSCAN_DATABASE_MODE must be bundled or external.' >&2; exit 2 ;;
esac
```

## Stop for maintenance

Stop the indexer gracefully before PostgreSQL maintenance:

```bash
docker compose stop indexer
```

`docker compose down` preserves the named history volume. `docker compose down --volumes` deletes it; use that command only when the loss is intentional and a tested backup exists.
