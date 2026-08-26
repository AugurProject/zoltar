# Zoltar chaos bot

The chaos bot is a long-running operator that exercises the Zoltar, Statoblast, Open Oracle, and trading ecosystem with real, permissionless transactions. It discovers what its dedicated account can currently do, waits a newly randomized delay from the configured range within 1–60 minutes, chooses one eligible operation, and executes its durable workflow.

## Safety at a glance

- The shipped configuration starts **paused**, in **dry-run**, with no private key or usable network deployment.
- The bot cannot acquire its initial ETH or REP funding automatically. Give a dedicated signer only the assets and positions you are prepared to risk.
- Every live step is rediscovered and simulated against a quorum-agreed block immediately before signing. This prevents knowingly submitted reverts, but concurrent transactions, provider faults, and reorganizations mean no bot can promise that every included transaction succeeds.
- Irreversible operations are disabled by default. Deadline-bound operations require private submission.
- Signed bytes and workflow progress are persisted before broadcast. Never delete runtime state to bypass a pending transaction or partial workflow.

## Quick start

### 1. Install and create an owner-only configuration

From `bots/chaos`:

```sh
bun install --frozen-lockfile
install -d -m 700 .state
cp config/operator.example.json .state/operator.json
chmod 600 .state/operator.json
```

[`config/operator.example.json`](./config/operator.example.json) is the default safe template used by the local and Docker startup paths. It deliberately has `networkConfigured: false`, no connectivity, zero deployment roots, `paused: true`, `runtime.execute: false`, and no private key.

[`config/operator.configured-placeholder.json`](./config/operator.configured-placeholder.json) is a parser-tested Sepolia shape reference. [`config/operator.custom-chain-placeholder.json`](./config/operator.custom-chain-placeholder.json) is the corresponding custom-EVM-chain reference. Both show a configured three-reader quorum and nonzero deployment fields, but their reserved `.invalid` hosts and patterned addresses are deliberately unusable. They remain paused, dry, and keyless. Never run or deploy those placeholder addresses; replace every endpoint and every deployment root with authenticated values from your deployment.

### 2. Create a dedicated signer and set its funding budget

Create the signer outside this repository and derive its address independently. Do not fund it yet. Decide how much you will send after the dashboard address is verified, allowing enough:

- native ETH for gas, payable operations, the configured ETH reserve, and the maximum ETH principal for one workflow;
- REP for every universe you intend to exercise, the configured REP reserve, and the maximum REP principal for one workflow;
- optional shares or LP tokens for position-management coverage.

Each principal cap is cumulative across all steps in one workflow and resets for the next workflow. Repeated workflows can therefore spend more than either cap over the bot's lifetime, down to the configured reserves while their other eligibility checks hold. The dedicated account's total holdings—not a per-workflow cap—are the overall asset-risk envelope. WETH need not be pre-funded when an eligible workflow can wrap ETH. Child universes have distinct REP tokens, so REP in one universe does not fund another. Never use an account that holds assets you are unwilling to lose.

### 3. Authenticate the deployment and configure connectivity

Keep the bot stopped and replace the inert `.state/operator.json` copy with exactly one configured shape:

```sh
# Sepolia
cp config/operator.configured-placeholder.json .state/operator.json

# Or, for a custom EVM chain
cp config/operator.custom-chain-placeholder.json .state/operator.json
```

For Mainnet, copy `config/operator.configured-placeholder.json` as the shape, then replace its `network` object with the exact Mainnet preset fields in the [operator reference](./OPERATOR_REFERENCE.md). For every chain, set an intentional chain-specific `runtime.stateFile` such as `.state/chaos.sepolia.json`, `.state/chaos.mainnet.json`, or `.state/chaos.custom-<chainId>.json`; never reuse a durable-state path across chain IDs. Edit only `.state/operator.json`, not the committed references, and restore owner-only permissions with `chmod 600 .state/operator.json`.

Replace the selected shape's independent RPCs and all eight deployment roots with values from an independently verified deployment manifest, then keep `networkConfigured: true`. Replace every reserved `.invalid` endpoint and every patterned address. A nonzero address or internally consistent graph is not proof that you selected the intended deployment.

Live execution requires a three-reader, two-agreeing quorum with three distinct RPC origins. Single-reader mode is dry-run only. Keep `runtime.protocolStartBlock` at `"0"` unless you have verified the earliest block that can contain protocol deployment or carry events. Public submission is appropriate for initial dry runs but blocks deadline-bound operations; those require authenticated private relays.

The [operator reference](./OPERATOR_REFERENCE.md) defines the exact mainnet, Sepolia, and custom-chain forms; deployment-graph checks; RPC quorum; submission modes; and relay requirements.

### 4. Start paused and dry

Keep `paused: true` and `runtime.execute: false`, then validate and run:

```sh
(
  set -eu
  bun run typecheck
  bun run test
  if [ -L .state/dashboard-password ] || { [ -e .state/dashboard-password ] && [ ! -f .state/dashboard-password ]; }; then
    echo 'dashboard password path must be a regular file' >&2
    exit 1
  fi
  if [ ! -e .state/dashboard-password ]; then
    umask 077
    od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > .state/dashboard-password
  fi
  chmod 600 .state/dashboard-password
  export ZOLTAR_BOT_DASHBOARD_PASSWORD="$(tr -d '\r\n' < .state/dashboard-password)"
  exec bun run run
)
```

Open <http://127.0.0.1:4193> and sign in as user `operator` with the generated password. The dashboard accepts a write-only transaction key on Settings. Leaving “remember” off keeps the key in process memory; remembering it writes the key to the owner-only configuration. The browser input is cleared before the request completes, and the API never reads the key back.

While the bot remains paused and dry, verify that the displayed wallet address exactly matches the independently derived address. Only then fund it within the budget from step 2. Refresh Overview and confirm the ETH, WETH, and universe-specific REP inventory before continuing to discovery verification.

If the address differs, clear the signer and do not send assets. The durable state is already scoped to that first signer, so do not load a replacement into the same state file. Stop the bot, preserve the old state file and all of its companion stores as a protected unit, configure a new unused `runtime.stateFile` path while still paused and dry, restart, load the intended signer, and repeat the address check. Never delete the old state to work around signer scoping.

The dashboard is restricted to loopback authority and never starts without authentication. Set `ZOLTAR_BOT_DASHBOARD_PASSWORD` to at least 16 characters before every local run; the commands above generate an owner-only 48-character secret that can be reused across restarts. Only `/healthz` stays unauthenticated. This is mandatory even on loopback because another local process or user must not be able to change limits, load a signer, or resume the funded bot. For remote administration, keep the bot loopback-only and use an authenticated, encrypted SSH tunnel or HTTPS reverse proxy. Basic authentication does not make plaintext HTTP safe.

The dashboard is the only supported configuration writer while the bot is running. Stop the bot before editing, copying over, or restoring `operator.json` or a chain profile. Bot-owned writes are serialized and revision checked, but an arbitrary filesystem writer cannot participate in that protocol and can otherwise race an in-progress dashboard update.

### 5. Verify discovery before live execution

Allow the initial topology, protocol-event, and carry-proof indexes to finish backfilling. Transactions remain blocked while any required index is incomplete. Then verify:

1. endpoint health reports the intended chain and quorum;
2. no configured-graph authentication error is present;
3. Overview shows the expected signer and ETH/WETH/REP inventory;
4. Operation catalog shows the supported runtime operations for all four ecosystems and explains their current eligibility;
5. Ecosystem state shows the pools, universes, reports, auctions, and trading pairs you expect;
6. Activity & recovery has no unresolved transaction or partial-workflow blocker.

Keep `runtime.execute: false`, then resume from the dashboard and observe multiple randomized selections. Dry-run records anchored plans without signing, submitting, or running prerequisites; it does not claim that the same workflow will remain executable later. Pause again before changing live controls and inspect the durable countdown. Its timestamp keeps aging while paused, so a countdown that is already due can run immediately on the next resume.

The dashboard catalog intentionally contains runtime definitions only. The complete canonical ABI classification, including privileged and excluded entries with reasons, is owned by [`src/contracts/surface.ts`](./src/contracts/surface.ts) and enforced by [`tests/contracts/catalog-coverage.test.ts`](./tests/contracts/catalog-coverage.test.ts).

### 6. Enable live execution deliberately

Before changing live controls, make a stopped, encrypted, owner-only backup using the procedure below. That procedure stops the bot. Restart it with the persisted paused, dry-run configuration, sign in, and reload the signer if you kept it only in memory. Reverify the displayed address and the restored pending-transaction status, partial workflow, countdown, index progress, and safety-pause latch. Then keep conservative reserves and per-workflow principal caps, set `runtime.execute: true`, and only then unpause. Enabling live mode requires a signer and nonzero deployment roots. Do not assume live resume creates a fresh wait: due random work or lifecycle recovery can start immediately.

The shipped template keeps both risk gates off. Leave `allowHighRiskOperations: false` through the first live cycles. Before opting in, remain paused and dry, inspect high-risk catalog entries whose policy blocker is this gate, and confirm the configured ETH/REP principal caps and gas ceiling. This gate enables economically adversarial disputes, OpenOracle report workflows, child deployment, escalation deposits, and auction participation. Review `allowIrreversibleOperations` separately: it permits universe forks, REP burns or migrations, and global lifecycle transitions. Test either gate on an isolated deployment before enabling it on a shared network.

## Monitor and recover

The Overview page shows mode, signer readiness, inventory, the durable countdown, the active workflow, and ecosystem readiness. Operation catalog explains eligibility and blockers. Ecosystem state presents the discovered graph. Activity & recovery exposes redacted activity, lifecycle obligations, transaction recovery, and partial-workflow reconciliation. Settings controls timing, budgets, ecosystems, risk gates, dry/live mode, and the write-only signer.

A pending nonce blocks novel work until its canonical outcome is known. Signed bytes are persisted before the first broadcast, and automatic resubmission uses the exact same bytes only after repeating durable preflights. Every receipt must reach 12-block canonical finality and pass operation-specific semantic evidence.

If automatic recovery cannot finish, pause the bot and use one of the three audited Activity & recovery paths:

- verify an exact semantic replacement with the same sender, nonce, destination, calldata, value, finality, and result;
- verify a finalized zero-value, empty-calldata self-transfer from the recovery signer at the exact nonce;
- clear only a mistyped queued verification hash using compare-and-swap protection, typed confirmation, and an audit reason.

A confirmed prerequisite is never replayed. The bot rebuilds the continuation for the original protocol identity and executes only unfinished steps. If an exact continuation is permanently unavailable, use the paused, audited abandonment path. Lifecycle abandonment remains tombstoned until the identity is absent beyond the reorganization-retention window.

Unexpected invariants set a durable safety-pause latch in addition to the configuration pause. Restarting does not clear it. Correct the cause, inspect the recorded audit entry, and resume deliberately.

Back up or move the main runtime state file and its `.protocol-index-v1`, `.immutable-topology-v1`, and carry-proof sidecars together using the stopped procedure below. The main state references a committed protocol-index digest, so an incomplete copy fails closed. Never delete the main state to bypass recovery.

If the carry sidecar is corrupt or has the wrong identity, first investigate the mismatch and verify the intended chain, deployment, signer, and start block. Inspect Activity & recovery; do not rebuild while a transaction, partial workflow, or lifecycle action is unresolved. Pause and wait for that dashboard mutation to finish, then stop every bot process or container that uses the state unit. While stopped, move only `<runtime.stateFile>.carry-proof-journal.json` into protected quarantine; if it is a readable segmented manifest, move the exact segment files named by that manifest too. Do not wildcard-delete files or touch the main state, protocol index, or topology cache. Restart paused and dry, allow the carry journal to backfill completely from the configured start block, and verify its canonical anchor and the absence of recovery or safety blockers before resuming. Correcting an overly late `protocolStartBlock` also requires this complete stopped-state rebuild.

### Back up and restore state

Treat the entire state directory as a secret: it can contain a remembered private key, dashboard password, signed transactions, and credentialed endpoints. To take a consistent backup:

1. pause the bot and wait for the dashboard mutation to finish;
2. stop the local process or Compose service so no journal, index, cache, or password file can change;
3. snapshot the complete `.state` directory or named volume as one unit into offline, encrypted storage restricted to the operator;
4. verify the backup destination's access controls, then disconnect or unmount it before retaining the copy.

Restore the complete unit only while the bot is stopped. Reapply owner-only directory and file permissions, start in paused mode, and verify the signer, pending nonce, active workflow, index status, and safety-pause latch before resuming. Never stage a backup in an ordinary shared directory or unprotected NTFS path.

## Run with Docker

The Compose service builds a non-root Bun image, publishes only `127.0.0.1:4193`, and keeps configuration, workflows, transaction intents, scheduler state, and an automatically generated dashboard password in the private `chaos-state` volume. Authentication remains mandatory because containers on the shared Docker network can reach the container listener.

```sh
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build -d
docker compose exec chaos sh -c 'cat .state/dashboard-password'
docker compose logs --tail 100 chaos
```

Sign in as user `operator`. The password file is owner-only, reused across restarts, and never printed by the entrypoint. Rotate it by stopping the service, replacing the file with at least 16 characters, restoring owner-only permissions, and restarting.

On first start, the container copies the default safe template—not the configured-placeholder reference—to `.state/operator.json`, changes only the in-container UI bind address to `0.0.0.0`, and preserves paused dry-run defaults. Before a signer is loaded, you can perform the one-time network/deployment bootstrap outside the container. Stop the bot first:

```sh
install -d -m 700 .state
docker compose stop chaos
docker compose cp chaos:/app/bots/chaos/.state/operator.json ./.state/operator.json
# Replace every network and deployment placeholder; keep paused dry-run mode.
chmod 600 .state/operator.json
docker compose cp ./.state/operator.json chaos:/app/bots/chaos/.state/operator.json
docker compose run --rm --no-deps --user root --entrypoint sh chaos -c 'chown bun:bun /app/bots/chaos/.state/operator.json && chmod 600 /app/bots/chaos/.state/operator.json'
docker compose start chaos
```

The ownership repair is required because `docker compose cp` can create the destination as root while the bot runs as `bun`. Perform this export only before a private key has been loaded or remembered. After bootstrap, use the authenticated dashboard for supported changes. If an offline edit is unavoidable, first pause, clear the remembered signer in Settings, stop the bot, and handle the complete `.state` directory through an encrypted secret-management workflow.

For unattended deployments, mount the complete `.state` directory through your secret-management system. Do not put keys or credentialed endpoints in Compose, `.env`, shell history, screenshots, or support bundles.

On Windows, run `start.bat`, but do not copy a live `operator.json` into an ordinary PowerShell/NTFS working directory: inherited ACLs may expose a remembered key. Perform the keyless bootstrap from WSL2 on its Linux filesystem using the POSIX permission steps above, or provision the volume through a Windows secret manager that enforces a private ACL. Load the signer only after the file is back in the protected volume.

## Coverage and exact controls

The bot covers permissionless Zoltar, Statoblast, Open Oracle, and Trading workflows. The dashboard shows current runtime eligibility; the complete ABI classification, supported-family table, exact network/submission grammar, scheduler semantics, and durable-state controls live in the [operator reference](./OPERATOR_REFERENCE.md).

## Dashboard fixture

To inspect the UI without a chain or key:

```sh
bun ./scripts/serve-dashboard-fixture.mts
```

With Chromium installed, `bun ./scripts/capture-dashboard-qa.mts` records desktop (`1440x900`) and mobile (`390x844`) evidence under ignored `.state/qa`.
