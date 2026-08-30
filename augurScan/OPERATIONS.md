# Operate augurScan without losing history

This guide covers a Compose deployment whose working directory is `augurScan/`. It shows how to configure the service, prove a backup can be restored, upgrade, inspect historical integrity, export deterministic evidence, and stop the service safely.

## Prepare the deployment

Use archival-capable JSON-RPC providers that can return runtime bytecode, block headers, transactions, and receipts throughout the configured history boundary. Each RPC environment variable accepts an ordered comma-separated provider pool. augurScan verifies a provider's chain before using it and resumes failed work from its durable checkpoint.

`config/networks.json` selects each network's manifest. Manifest entries are `[address, label, kind]` or `[address, label, kind, deploymentBlock]`. A verified deployment block avoids historical bytecode discovery and gives later replay a deterministic boundary. Keep an old address in the manifest while it remains a valid activity source.

The most important runtime settings are:

- `NETWORKS` selects enabled networks;
- `MAINNET_RPC_URL` and `SEPOLIA_RPC_URL` provide RPC pools;
- `MAINNET_START_BLOCK` and `SEPOLIA_START_BLOCK` set the lower bound for deployment discovery;
- `LOG_SCAN_RANGE_SIZE` caps each inclusive `eth_getLogs` request;
- `POSTGRES_URL` connects directly to PostgreSQL or through a session-mode pooler;
- `AUGURSCAN_ACCESS_USERNAME` and `AUGURSCAN_ACCESS_PASSWORD` enable HTTP Basic access control when both are set;
- `API_RATE_LIMIT_PER_MINUTE` changes the default per-client API limit of 600, while `0` disables it when a trusted upstream enforces the limit;
- `DISABLE_INDEXER=1` disables chain indexing and avoids the writer lease. It does not make the process or its database connection read-only: startup can initialize or migrate the schema, records an indexer-disabled process run, prunes expired live-stream events, and records the run's stop time.

The writer lease is a PostgreSQL session advisory lock and is incompatible with transaction-mode pooling. Terminate TLS before enabling Basic authentication because Basic credentials are encoded, not encrypted. Do not expose PostgreSQL publicly, and do not rely on the process-local rate limiter as a distributed edge control. `GET /metrics` exposes bounded Prometheus request, limiter, indexer-lag, success, and failure metrics.

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

Stop every augurScan app instance connected to the live database and prevent a standby from taking over while this procedure runs. For the Compose deployment, stop its app service. This freezes the source between the proof and the dump; leave it stopped until the upgrade step starts it again.

```bash
set -euo pipefail
docker compose stop app
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

If access control is enabled, export both credentials in the operator shell. This helper rejects a half-configured pair and keeps credentials out of the URL:

```bash
augurscan_curl() {
  if test -n "${AUGURSCAN_ACCESS_USERNAME:-}" || test -n "${AUGURSCAN_ACCESS_PASSWORD:-}"; then
    test -n "${AUGURSCAN_ACCESS_USERNAME:-}" && test -n "${AUGURSCAN_ACCESS_PASSWORD:-}" || {
      echo 'Set both AUGURSCAN_ACCESS_USERNAME and AUGURSCAN_ACCESS_PASSWORD.' >&2
      return 2
    }
    curl --user "$AUGURSCAN_ACCESS_USERNAME:$AUGURSCAN_ACCESS_PASSWORD" "$@"
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

API clients should follow `data.nextCursor` while `data.hasMore` is true. The integrity cursor fixes the greatest visible replacement ID and materialization generation. A later invalidation returns HTTP 409; restart at page one rather than combining generations. `/api/v1/provenance` is also paged and identifies the indexer run plus its ABI, application, and projection hashes.

The `/api/v1/reorgs` view uses a chain- and generation-bound cursor. A new invalidation returns `409` so an operator restarts instead of combining generations. Use the deterministic export below for durable audit files with per-page proofs. The [API reference](API_REFERENCE.md) owns the exact response, cursor, and pagination contracts.

## Export deterministic evidence

Run exports against the restored database through an isolated, indexer-disabled app. This keeps the live service available and prevents the export boundary from changing because of chain indexing. This process still needs write access: it can migrate the restored schema, appends an `indexer_runs` provenance row, prunes expired `live_events`, and records its stop time. After any required migration, it does not index new chain evidence, so the restored evidence boundary remains fixed. Both database modes use the pinned app image that Compose built during the upgrade.

The isolated container needs its own direct, container-reachable URL for the restored database. External mode already set `AUGURSCAN_RESTORE_URL` during restore preparation. In bundled mode, set it explicitly with the actual password that the `postgres` service reads from `.env`; percent-encode reserved URL characters. Do not rely on an unexported `POSTGRES_PASSWORD`, and do not use `localhost` to name a database outside the container.

```bash
if test "$AUGURSCAN_DATABASE_MODE" = bundled; then
  export AUGURSCAN_RESTORE_URL='postgres://augurscan:actual-password@postgres:5432/augurscan_restore'
fi
```

```bash
set -euo pipefail
export AUGURSCAN_EXPORT_CONTAINER="augurscan-export-$$"
: "${AUGURSCAN_RESTORE_URL:?Set the direct, container-reachable restore URL}"
source scripts/export-container-cleanup.sh
case "$AUGURSCAN_DATABASE_MODE" in
  bundled)
    test "$(printf '%s\n' "$AUGURSCAN_RESTORE_URL" | sed -n 's#^[^:]*://[^@]*@\([^/:]*\).*#\1#p')" = postgres || {
      echo 'Bundled AUGURSCAN_RESTORE_URL must use the postgres service hostname.' >&2
      exit 2
    }
    test "$(printf '%s\n' "$AUGURSCAN_RESTORE_URL" | sed -n 's#^[^:]*://[^@]*@[^/]*/\([^?]*\).*$#\1#p')" = "$AUGURSCAN_RESTORE_DATABASE" || {
      echo 'Bundled AUGURSCAN_RESTORE_URL must name the verified restore database.' >&2
      exit 2
    }
    ;;
  external) ;;
  *) echo 'AUGURSCAN_DATABASE_MODE must be bundled or external.' >&2; exit 2 ;;
esac
docker compose run --detach --rm --no-deps \
  --name "$AUGURSCAN_EXPORT_CONTAINER" \
  --publish 127.0.0.1:3002:3000 \
  --env "POSTGRES_URL=$AUGURSCAN_RESTORE_URL" \
  --env DISABLE_INDEXER=1 \
  app
augurscan_install_export_cleanup
export AUGURSCAN_EXPORT_URL=http://localhost:3002
AUGURSCAN_EXPORT_READY=0
for _ in {1..30}; do
  if curl --fail --silent --show-error "$AUGURSCAN_EXPORT_URL/health/ready"; then
    AUGURSCAN_EXPORT_READY=1
    break
  fi
  sleep 2
done
if test "$AUGURSCAN_EXPORT_READY" != 1; then
  docker logs "$AUGURSCAN_EXPORT_CONTAINER" >&2
  exit 1
fi
```

The installed `EXIT` trap force-removes only the exact named export container after a readiness, transport, HTTP, or verifier failure. It does not delete the restore database or any pending, failed, invalidated, or validated evidence directory, so those remain available for diagnosis. A successful explicit stop disarms the trap before database cleanup.

Export one dataset at a time from Bash. Supported datasets are `logs`, `reorgs`, and `timeline`. Logs and timeline accept `canonical`, `orphaned`, or `all`; reorganization exports require `all` because replacements have no canonical classification. The [API reference](API_REFERENCE.md#evidence-and-export) owns the full filter contract. The continuation cursor belongs to the response header, not the NDJSON body.

```bash
export AUGURSCAN_EXPORT_DATASET=logs
export AUGURSCAN_EXPORT_CANONICAL=all
export AUGURSCAN_EXPORT_FROM_BLOCK=0
export AUGURSCAN_EXPORT_TO_BLOCK=9223372036854775807
export AUGURSCAN_EXPORT_DIRECTORY="$(pwd)/augurscan-export-$(date -u +%Y%m%dT%H%M%SZ)-$$/$AUGURSCAN_EXPORT_DATASET"
mkdir -p "$AUGURSCAN_EXPORT_DIRECTORY"
AUGURSCAN_EXPORT_CURSOR=
AUGURSCAN_EXPORT_VALIDATION=
AUGURSCAN_EXPORT_PAGE=0
while :; do
  AUGURSCAN_PAGE_DIRECTORY="$AUGURSCAN_EXPORT_DIRECTORY/page-$AUGURSCAN_EXPORT_PAGE"
  test ! -e "$AUGURSCAN_PAGE_DIRECTORY" || {
    echo "Refusing to overwrite $AUGURSCAN_PAGE_DIRECTORY" >&2
    exit 1
  }
  AUGURSCAN_PENDING=$(mktemp -d "$AUGURSCAN_EXPORT_DIRECTORY/.page-$AUGURSCAN_EXPORT_PAGE.pending.XXXXXX")
  AUGURSCAN_BODY="$AUGURSCAN_PENDING/evidence.ndjson"
  AUGURSCAN_HEADERS="$AUGURSCAN_PENDING/headers"
  AUGURSCAN_ARGS=(
    --silent --show-error --dump-header "$AUGURSCAN_HEADERS" --output "$AUGURSCAN_BODY"
    --write-out '%{http_code}' --get "$AUGURSCAN_EXPORT_URL/api/v1/export"
    --data-urlencode "chainId=$AUGURSCAN_CHAIN_ID"
    --data-urlencode "dataset=$AUGURSCAN_EXPORT_DATASET"
    --data-urlencode "canonical=$AUGURSCAN_EXPORT_CANONICAL"
    --data-urlencode "fromBlock=$AUGURSCAN_EXPORT_FROM_BLOCK"
    --data-urlencode "toBlock=$AUGURSCAN_EXPORT_TO_BLOCK"
    --data-urlencode 'limit=50000'
  )
  if test -n "$AUGURSCAN_EXPORT_CURSOR"; then
    AUGURSCAN_ARGS+=(--data-urlencode "cursor=$AUGURSCAN_EXPORT_CURSOR")
  fi
  if AUGURSCAN_STATUS=$(augurscan_curl "${AUGURSCAN_ARGS[@]}"); then
    case "$AUGURSCAN_STATUS" in
      2??) ;;
      409)
        mv "$AUGURSCAN_PENDING" "$AUGURSCAN_EXPORT_DIRECTORY/INVALIDATED-page-$AUGURSCAN_EXPORT_PAGE"
        echo 'The export boundary changed. Quarantine this attempt and restart at page zero.' >&2
        exit 1
        ;;
      *)
        mv "$AUGURSCAN_PENDING" "$AUGURSCAN_EXPORT_DIRECTORY/FAILED-page-$AUGURSCAN_EXPORT_PAGE"
        echo "Export failed with HTTP $AUGURSCAN_STATUS; inspect the saved response." >&2
        exit 1
        ;;
    esac
  else
    mv "$AUGURSCAN_PENDING" "$AUGURSCAN_EXPORT_DIRECTORY/FAILED-page-$AUGURSCAN_EXPORT_PAGE"
    echo 'Export transport failed; inspect the saved response and retry in a new attempt.' >&2
    exit 1
  fi
  AUGURSCAN_PENDING_NAME=$(basename "$AUGURSCAN_PENDING")
  AUGURSCAN_VALIDATION_ARGS=(
    "/evidence/$AUGURSCAN_PENDING_NAME/headers"
    "/evidence/$AUGURSCAN_PENDING_NAME/evidence.ndjson"
    "$AUGURSCAN_EXPORT_DATASET"
    "$AUGURSCAN_CHAIN_ID"
    "$AUGURSCAN_EXPORT_CANONICAL"
    "$AUGURSCAN_EXPORT_FROM_BLOCK"
    "$AUGURSCAN_EXPORT_TO_BLOCK"
  )
  if test -n "$AUGURSCAN_EXPORT_VALIDATION"; then
    AUGURSCAN_VALIDATION_ARGS+=("$AUGURSCAN_EXPORT_VALIDATION" "$AUGURSCAN_EXPORT_CURSOR")
  fi
  if ! docker compose run --rm --no-deps \
    --user "$(id -u):$(id -g)" \
    --volume "$AUGURSCAN_EXPORT_DIRECTORY:/evidence:ro" \
    --entrypoint bun \
    app augurScan/scripts/verify-export-page.ts "${AUGURSCAN_VALIDATION_ARGS[@]}" \
    > "$AUGURSCAN_PENDING/validation.json"; then
    mv "$AUGURSCAN_PENDING" "$AUGURSCAN_EXPORT_DIRECTORY/INVALID-page-$AUGURSCAN_EXPORT_PAGE"
    echo 'Export proof failed; inspect the quarantined headers, body, and validation output.' >&2
    exit 1
  fi
  AUGURSCAN_EXPORT_CURSOR=$(tr -d '\r' < "$AUGURSCAN_HEADERS" | awk 'tolower($1) == "x-augurscan-next-cursor:" { print $2 }')
  mv "$AUGURSCAN_PENDING" "$AUGURSCAN_PAGE_DIRECTORY"
  AUGURSCAN_EXPORT_VALIDATION="/evidence/page-$AUGURSCAN_EXPORT_PAGE/validation.json"
  test -n "$AUGURSCAN_EXPORT_CURSOR" || break
  AUGURSCAN_EXPORT_PAGE=$((AUGURSCAN_EXPORT_PAGE + 1))
done
```

Each successful response is atomically renamed from a hidden pending directory to a numbered page containing `evidence.ndjson`, `headers`, and `validation.json`; the loop refuses to overwrite one. The pinned image validates one complete set of snapshot and source headers, valid non-empty JSON objects on every NDJSON line, an exact line count, a cursor exactly when `truncated=true`, and the exact prior continuation cursor on every later request. It also requires every row to match the requested dataset, chain, canonical scope, and range; requires dataset-specific row identities to increase strictly across page boundaries; binds each response cursor to the final row; keeps the snapshot boundary fixed; and requires the final cumulative count to equal the first page's exact total. A cursor binds the dataset, chain, canonical scope, requested range, indexed block/hash, invalidation ID, exact total, applied source hashes, and last-row identity. HTTP 409 means that boundary changed: quarantine every page from that attempt and restart from page zero. Do not concatenate pages across attempts. Change `AUGURSCAN_EXPORT_FROM_BLOCK` and `AUGURSCAN_EXPORT_TO_BLOCK` to constrain the interval. For a replacement range, compare `canonical=orphaned` and `canonical=canonical` log exports by block hash.

For unattended exports, also persist the current cursor after each page. An interrupted request remains in a hidden pending directory; do not treat it as committed evidence. Keep the restore database until every dataset is complete.

Stop the isolated process and remove the temporary restore only after checking the exported files. Cleanup first verifies the restored database's identity again. The `postgres` branch deletes that explicit name through the administrative connection. The `provider` branch never runs `dropdb`; delete that exact database with the same provider control used to create it.

```bash
set -euo pipefail
docker stop "$AUGURSCAN_EXPORT_CONTAINER"
augurscan_disarm_export_cleanup
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

Stop the writer gracefully before PostgreSQL maintenance:

```bash
docker compose stop app
```

`docker compose down` preserves the named history volume. `docker compose down --volumes` deletes it; use that command only when the loss is intentional and a tested backup exists.
