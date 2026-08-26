# Zoltar chaos bot

The chaos bot is a long-running operator that exercises the Zoltar, Statoblast, Open Oracle, and trading ecosystem with real, permissionless transactions. It discovers what its dedicated account can currently do, waits a newly randomized 1–60 minutes, chooses one eligible operation, and executes its durable workflow.

## Safety at a glance

- The shipped configuration starts **paused**, in **dry-run**, with no private key or usable network deployment.
- The bot never mints or requests funds. Give a dedicated signer only the ETH, REP, and positions you are prepared to risk.
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

### 2. Create and fund a dedicated signer

Create the signer outside this repository and verify its address independently. Before live execution, send that address enough:

- native ETH for gas, payable operations, the configured ETH reserve, and the cumulative ETH cap;
- REP for every universe you intend to exercise, the configured REP reserve, and the cumulative REP cap;
- optional shares or LP tokens for position-management coverage.

WETH need not be pre-funded when an eligible workflow can wrap ETH. Child universes have distinct REP tokens, so REP in one universe does not fund another. Never use an account that holds assets you are unwilling to lose.

### 3. Authenticate the deployment and configure connectivity

Choose one explicit network representation. Mainnet and Sepolia retain their canonical three-field preset form; the parser requires chain ID `1` for `mainnet` and `11155111` for `sepolia`:

```json
"network": {
  "chainId": 11155111,
  "explorerUrl": "https://sepolia.etherscan.io",
  "name": "sepolia"
}
```

For another EVM chain, use the four-field custom form shown in the committed custom-chain placeholder:

```json
"network": {
  "chainId": 4242424242,
  "explorerUrl": "https://explorer.custom-chain.example.invalid",
  "kind": "custom",
  "name": "Zoltar Custom Chain Placeholder"
}
```

`kind` must be exactly `"custom"`. `chainId` must be a positive JavaScript-safe integer and cannot reuse the mainnet or Sepolia preset ID. `name` is a display label of 1–64 Unicode characters with no surrounding whitespace, Unicode control/format/private-use/unassigned characters, surrogates, or line separators; it cannot impersonate a preset name. The label never enters a profile filename: custom profile storage uses the deterministic `custom-chain-<chainId>` key, and profiles with different chain IDs must use distinct durable state files. The custom-chain example's name, ID, explorer, RPCs, and roots are placeholders—not an authenticated deployment.

The bot's transaction accounting and viem chain definition assume an 18-decimal Ether-compatible native currency with symbol ETH, as required by this Zoltar/WETH ecosystem. Do not point it at an EVM chain with different native-currency semantics. `explorerUrl` is required operator metadata; it does not authenticate the chain, providers, contracts, or deployment roots and is not a trust signal.

Obtain all eight roots—`zoltar`, `questionData`, `securityPoolFactory`, `securityPoolForker`, `openOracle`, `weth`, `tradingFactory`, and `tradingRouter`—from a trusted deployment manifest. Verify the manifest, chain ID, addresses, and deployed code out of band. A nonzero address is not authentication, and the bot cannot prove that an internally consistent malicious graph is the deployment you intended.

After replacing all roots, discovery verifies these relationships at its canonical anchor:

- Zoltar's question-data address equals the configured QuestionData root; SecurityPoolForker's Zoltar address equals the configured Zoltar root; TradingFactory's security-pool factory equals the configured SecurityPoolFactory root; TradingRouter's factory equals the configured TradingFactory root.
- Every pool comes from the configured factory registry. Its factory, forker, Zoltar, QuestionData, coordinator, share token, truth auction, universe ID, and question ID must match the factory record and configured graph; the coordinator must point back to the pool.
- Each pool's REP token must equal its universe's canonical REP. The pool and coordinator must use the configured OpenOracle; the coordinator must use the configured WETH and canonical universe REP.
- Every discovered trading pair must point to the configured TradingFactory, its source pool and share token, and the same universe and question identities as that pool.

Configure `network`, set `networkConfigured` to `true`, and add independent RPCs only after those checks are prepared:

- `rpcQuorum: 1` requires one healthy read endpoint. It tolerates no independent disagreement and is best reserved for isolated development.
- `rpcQuorum: 2` requires a primary `readRpcUrl` plus at least two `quorumRpcUrls`—three configured read endpoints with distinct origins. Every read cycle needs two agreeing, healthy endpoints, so the third provides one-provider outage tolerance.
- Every endpoint must report the configured chain ID. RPC URLs must use HTTPS, except loopback HTTP or the local Anvil service. Changing only a URL path does not create an independent read provider.
- `publicRpcUrls` is the broadcast set for public mode. The schema requires at least one public endpoint in either mode, but private mode does not use it for transaction broadcast. In public mode, at least one healthy public endpoint must accept a live public transaction.

Set `runtime.protocolStartBlock` to the earliest block that can contain protocol deployment or carry events. Leaving it at `"0"` is safe but may make the first backfill slow. Starting too late omits cumulative history and makes proof-dependent operations fail closed.

The configured-placeholder file demonstrates public submission:

```json
"submission": {
  "minimumBundleRelaySuccesses": 1,
  "mode": "public",
  "relayUrls": []
}
```

Public mode deliberately blocks deadline-bound operations. To enable them, replace that object with a private configuration using real relays:

```json
"submission": {
  "minimumBundleRelaySuccesses": 2,
  "mode": "private",
  "relayUrls": [
    "https://first-private-relay.example.invalid",
    "https://second-private-relay.example.invalid"
  ]
}
```

The URLs above are placeholders, not deployable values. A private relay must report the expected chain ID and prove support for authenticated `eth_sendPrivateTransaction`; malformed, ambiguous, or unsupported capability responses fail closed. `minimumBundleRelaySuccesses` is the minimum number of configured relays that must be healthy during preflight and accept the private transaction. Relay URLs must use HTTPS or loopback HTTP and cannot contain embedded credentials, query parameters, or fragments.

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

Open <http://127.0.0.1:4193> and sign in as user `operator` with the generated password. The dashboard accepts a write-only transaction key on Settings. Leaving “remember” off keeps the key in process memory; remembering it writes the key to the owner-only configuration. The browser input is cleared before the request completes, and the API never reads the key back. Verify the displayed wallet address out of band before funding or enabling execution.

The dashboard is restricted to loopback authority and never starts without authentication. Set `ZOLTAR_BOT_DASHBOARD_PASSWORD` to at least 16 characters before every local run; the commands above generate an owner-only 48-character secret that can be reused across restarts. Only `/healthz` stays unauthenticated. This is mandatory even on loopback because another local process or user must not be able to change limits, load a signer, or resume the funded bot. For remote administration, keep the bot loopback-only and use an authenticated, encrypted SSH tunnel or HTTPS reverse proxy. Basic authentication does not make plaintext HTTP safe.

The dashboard is the only supported configuration writer while the bot is running. Stop the bot before editing, copying over, or restoring `operator.json` or a chain profile. Bot-owned writes are serialized and revision checked, but an arbitrary filesystem writer cannot participate in that protocol and can otherwise race an in-progress dashboard update.

### 5. Verify discovery before live execution

Allow the initial topology, protocol-event, and carry-proof indexes to finish backfilling. Transactions remain blocked while any required index is incomplete. Then verify:

1. endpoint health reports the intended chain and quorum;
2. no configured-graph authentication error is present;
3. Overview shows the expected signer and ETH/WETH/REP inventory;
4. Operation catalog shows all four ecosystems and explains every ineligible operation;
5. Ecosystem state shows the pools, universes, reports, auctions, and trading pairs you expect;
6. Activity & recovery has no unresolved transaction or partial-workflow blocker.

Run dry mode through multiple randomized selections. Dry-run records anchored plans without signing, submitting, or running prerequisites; it does not claim that the same workflow will remain executable later.

### 6. Enable live execution deliberately

Back up the complete `.state` directory, keep conservative reserves and per-operation caps, set `runtime.execute: true`, and only then unpause. Enabling live mode requires a signer and nonzero deployment roots. The first transaction still waits for the durable randomized scheduler unless lifecycle recovery is already due.

The shipped template keeps both risk gates off. Leave `allowHighRiskOperations: false` through the first live cycles; before opting in, review every currently eligible high-risk catalog entry and its worst-case spend. This gate enables economically adversarial disputes, OpenOracle report workflows, child deployment, escalation deposits, and auction participation. Review `allowIrreversibleOperations` separately: it permits universe forks, REP burns or migrations, and global lifecycle transitions. Test either gate on an isolated deployment before enabling it on a shared network.

## Monitor and recover

The Overview page shows mode, signer readiness, inventory, the durable countdown, the active workflow, and ecosystem readiness. Operation catalog explains eligibility and blockers. Ecosystem state presents the discovered graph. Activity & recovery exposes redacted activity, lifecycle obligations, transaction recovery, and partial-workflow reconciliation. Settings controls timing, budgets, ecosystems, risk gates, dry/live mode, and the write-only signer.

A pending nonce blocks novel work until its canonical outcome is known. Signed bytes are persisted before the first broadcast, and automatic resubmission uses the exact same bytes only after repeating durable preflights. Every receipt must reach 12-block canonical finality and pass operation-specific semantic evidence.

If automatic recovery cannot finish, pause the bot and use one of the three audited Activity & recovery paths:

- verify an exact semantic replacement with the same sender, nonce, destination, calldata, value, finality, and result;
- verify a finalized zero-value, empty-calldata self-transfer from the recovery signer at the exact nonce;
- clear only a mistyped queued verification hash using compare-and-swap protection, typed confirmation, and an audit reason.

A confirmed prerequisite is never replayed. The bot rebuilds the continuation for the original protocol identity and executes only unfinished steps. If an exact continuation is permanently unavailable, use the paused, audited abandonment path. Lifecycle abandonment remains tombstoned until the identity is absent beyond the reorganization-retention window.

Unexpected invariants set a durable safety-pause latch in addition to the configuration pause. Restarting does not clear it. Correct the cause, inspect the recorded audit entry, and resume deliberately.

Back up or move the main runtime state file and its `.protocol-index-v1`, `.immutable-topology-v1`, and carry-proof sidecars together. The main state references a committed protocol-index digest, so an incomplete copy fails closed. Never delete the main state to bypass recovery.

If the carry sidecar is corrupt or has the wrong identity, pause, confirm no transaction recovery is pending, remove only `<runtime.stateFile>.carry-proof-journal.json`, and let it rebuild from the configured start block. Correcting an overly late `protocolStartBlock` also requires a complete sidecar rebuild.

## Run with Docker

The Compose service builds a non-root Bun image, publishes only `127.0.0.1:4193`, and keeps configuration, workflows, transaction intents, scheduler state, and an automatically generated dashboard password in the private `chaos-state` volume. Authentication remains mandatory because containers on the shared Docker network can reach the container listener.

```sh
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build -d
docker compose exec chaos sh -c 'cat .state/dashboard-password'
docker compose logs --tail 100 chaos
```

Sign in as user `operator`. The password file is owner-only, reused across restarts, and never printed by the entrypoint. Rotate it by stopping the service, replacing the file with at least 16 characters, restoring owner-only permissions, and restarting.

On first start, the container copies the default safe template—not the configured-placeholder reference—to `.state/operator.json`, changes only the in-container UI bind address to `0.0.0.0`, and preserves paused dry-run defaults. To edit it outside the container:

```sh
install -d -m 700 .state
docker compose cp chaos:/app/bots/chaos/.state/operator.json ./.state/operator.json
# Replace every network and deployment placeholder; keep paused dry-run mode.
docker compose cp ./.state/operator.json chaos:/app/bots/chaos/.state/operator.json
docker compose exec -u root chaos chown bun:bun /app/bots/chaos/.state/operator.json
docker compose exec -u root chaos chmod 600 /app/bots/chaos/.state/operator.json
docker compose restart chaos
```

The ownership repair is required because `docker compose cp` can create the destination as root while the bot runs as the unprivileged `bun` user. For unattended deployments, mount the complete `.state` directory through your secret-management system. Do not put keys or credentialed endpoints in Compose, `.env`, shell history, screenshots, or support bundles. On Windows, run `start.bat`.

For manual configuration from PowerShell, replace the POSIX `install` line above with:

```powershell
New-Item -ItemType Directory -Force .state | Out-Null
docker compose cp chaos:/app/bots/chaos/.state/operator.json ./.state/operator.json
# Replace every network and deployment placeholder; keep paused dry-run mode.
docker compose cp ./.state/operator.json chaos:/app/bots/chaos/.state/operator.json
docker compose exec -u root chaos chown bun:bun /app/bots/chaos/.state/operator.json
docker compose exec -u root chaos chmod 600 /app/bots/chaos/.state/operator.json
docker compose restart chaos
```

## Operation coverage

The coverage manifest includes canonical runtime code families with externally callable mutations: user-facing endpoints, dynamically deployed pools, tokens, games, auctions and pairs, factories, deployment workers, pool migration proxies, the fallback claim module, and storage-coupled delegate modules installed by the deployment graph. Within that boundary, every mutating generated ABI entry is classified and every overloaded signature is pinned exactly.

Each mutation is selectable random work, a workflow prerequisite, a lifecycle obligation, role-restricted, or excluded-dangerous. Role-restricted, raw-routing, externally signed, orphan-deployment, direct-delegate, and admin-only calls stay visible with an explicit reason; the bot does not impersonate privileged callers or invent unsafe recipients or authorization. View helpers, generic Multicall transport, code-storage carriers, libraries, interfaces, and test contracts are not economic endpoints.

| Ecosystem | Supported permissionless families |
| --- | --- |
| Zoltar | Create binary, categorical, and scalar questions; approve REP; deploy child universes; fork universes; prepare, split, and continue REP migration; optional direct REP burn |
| Statoblast | Deploy pools; deposit, withdraw, and redeem vault REP; update or redeem fees; create and redeem complete sets; redeem winning shares; reporting and escalation withdrawals; pool forks and vault migrations; truth-auction bid, refund, finalize, and settle; staged REP-withdrawal execution and staged-operation expiry; permissionless lifecycle maintenance |
| Open Oracle | Wrap and unwrap WETH; report, randomly selected dispute, and lifecycle settlement; canonical WETH/REP ERC-20 deposit; WETH/REP withdrawal, self-recipient `withdrawTo`, and both push-or-credit overloads with exact transfer evidence; bounded wallet-to-self internal allowance management; dust initialization |
| Trading | Create and initialize pairs; enter and exit YES or NO; add and remove liquidity; exact-input and exact-output swaps with 1% quote protection; approvals; synchronization; complete-set redemption; fork share migration |

Eligibility is narrower than coverage. Balances, reserves, approvals, lifecycle phase, deadlines, submission mode, missing candidates, disabled ecosystems, or risk gates can block a supported operation.

Native OpenOracle deposits are intentionally unavailable. They create native internal credit, but the contract exposes no exact native-transfer evidence for an automated withdrawal or push. WETH and discovered REP deposits remain supported because their eventual credit sweep is bound to exact ERC-20 transfer evidence.

OpenOracle routing always fixes the recipient to the configured wallet. Push-or-credit overload selection is deterministic from the workflow seed: the three-argument form uses the contract's 50,000-gas default, while the four-argument form receives a 30,000–100,000 gas bound. Internal allowance transactions can only authorize the configured wallet to itself; a nonzero allowance is revoked before any later nonzero value.

## Operational reference

### Scheduling and execution

After each completed random workflow, the scheduler samples a new inclusive delay between 60 and 3,600 seconds. It cannot equal the immediately preceding delay, and both the delay and next-run timestamp survive restarts.

Every selectable operation has canonical discovery inputs, eligibility checks, bounded parameters, an immediate live simulation, and receipt evidence. When a coordinator catches downstream reverts, the bot repeats the exact downstream call from the coordinator context at the signing block and binds the expected return bytes. This supports staged REP-withdrawal execution. Staged liquidation execution remains excluded because inclusion ordering can change its irreversible debt result after preflight. Approvals and wrapping become durable prerequisites.

Live mode rechecks the plan, reserves, cumulative principal caps, gas ceiling, nonce, and exact call at a quorum-agreed block before each signature. If the anchor changes, the unsigned attempt is discarded and rediscovered. ETH, WETH, REP, and OpenOracle internal-credit debits all count toward cumulative principal caps.

Lifecycle obligations are independent of random work. Settlement, auction refunds, escalation withdrawals, and migration continuation can expire sooner than an hour, so recovery discovers every actionable instance and handles it before new random selection. A temporarily ineligible instance remains pending. Only a passed semantic deadline or complete canonical absence retires it as superseded, without claiming this bot or a competitor succeeded. Repeatable OpenOracle credit withdrawals and disputes remain random work. Disputes retain their exact deadline and private-submission requirement; settlement remains lifecycle work.

Timestamp-bound calls use next-block private inclusion with a safety margin. Block-clock calls use their exact final valid inclusion block. The rolling transport horizon is separate from the immutable protocol deadline, so an expired submission window does not retire a live obligation. Price requests reserve twice the anchored bounty and report minimum. Deadline-bound internal-credit withdrawals and pushes are also next-block-only.

OpenOracle report indexing accepts unresolved reports created by this signer with no callback, or the exact pending report of an authenticated pool coordinator. Token pairs are restricted to canonical WETH and discovered REP, callback gas is capped, and signer-owned active reports are durably bounded.

### Configuration controls

- `paused` gates novel scheduling, workflow continuation, and automatic resubmission. Read-only pending-transaction reconciliation still runs so the dashboard can observe a canonical outcome.
- `network` uses the canonical mainnet/Sepolia preset form or the explicit custom form above. The configured chain ID scopes RPC checks, signing, process locks, durable deployment identity, and safe profile storage.
- `runtime.execute` selects dry-run (`false`) or live signing and submission (`true`).
- `runtime.protocolStartBlock` and `runtime.protocolLogBlockSpan` set the immutable index origin and bounded per-cycle event range.
- Discovery maxima are per-RPC page sizes, not total topology caps. Every page is exhausted; incomplete or inconsistent pages fail closed.
- Scheduler minimum and maximum are an inclusive 60–3,600-second range and must allow at least two distinct delays.
- `strategy.enabledEcosystems` accepts one or more of `zoltar`, `statoblast`, `open-oracle`, and `trading`.
- Minimum ETH and REP reserves protect inventory from random principal spending; cumulative per-operation ETH/REP caps and the gas ceiling add separate bounds.
- `strategy.workflowValidForBlocks` is at least 64 so multi-step workflows can finalize prerequisites while each next step is freshly simulated.
- High-risk and irreversible controls are separate explicit gates.

Dashboard updates use configuration revisions, so a stale browser cannot overwrite a newer file. A configuration commit first writes a durable safety checkpoint. Post-commit persistence or signer-lock faults are reported as committed-but-safety-paused or commit-indeterminate; they never leave an apparently failed live enablement running. Dashboard APIs redact RPC and relay URLs, deployment internals, keys, signed transactions, and calldata.

### Index, cache, and compaction internals

The signer-, chain-, and deployment-scoped main journal is written atomically with owner-only permissions. On restart, recovery resolves receipts and exact transaction visibility through quorum reads before novel work. Identical-byte resubmission stops at its persisted public or private horizon.

Fork-carry proofs use `<runtime.stateFile>.carry-proof-journal.json`, scoped to chain, deployment, forker, and start block. The owner-only, symlink-rejecting journal is persisted before publishing a scan. Large journals split into checksummed 1 MiB segments; finalized whole-block prefixes compact into authenticated replay checkpoints after 8,192 retained events. Checkpoints preserve the event-chain commitment and proof-producing state roots.

The scanner reads `runtime.protocolStartBlock` inclusively and advances at most `runtime.protocolLogBlockSpan` blocks per cycle. A cursor-hash mismatch discards derived carry history and rebuilds it. Each inherited-deposit proof is sent alone because its nullifier proof is valid against one pre-consumption root, and it is limited to private inclusion in the block immediately after its anchor.

The cumulative protocol index uses immutable, checksummed, owner-only generations under `<runtime.stateFile>.protocol-index-v1`. Chunked collections keep growth beyond 10,000 reports, bids, deposits, or migration routes out of the main state. Canonical topology uses `<runtime.stateFile>.immutable-topology-v1`; each RPC verifies the cached cursor hash before reuse. Questions, pool deployments, universe-child routes, vault registries, and pair identities then page only new entries. Reorganizations discard the optimization. Live balances and lifecycle state are always refreshed at the anchor, and every vault is refreshed when exact fork-migration accounting needs the full registry.

### Dashboard fixture

To inspect the UI without a chain or key:

```sh
bun ./scripts/serve-dashboard-fixture.mts
```

With Chromium installed, `bun ./scripts/capture-dashboard-qa.mts` records desktop (`1440x900`) and mobile (`390x844`) evidence under ignored `.state/qa`.
