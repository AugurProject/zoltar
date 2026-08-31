# Zoltar chaos bot

The chaos bot is a long-running operator that exercises the Zoltar, Statoblast, Open Oracle, and trading ecosystem with real, permissionless transactions. It discovers what its dedicated account can currently do, waits a newly randomized delay from the configured 1–60 minute range, chooses one eligible operation, and executes its durable workflow.

## Safety at a glance

- The shipped configuration starts **paused**, in **dry-run**, with no private key or usable deployment.
- The bot cannot acquire its initial ETH or REP. Use a dedicated signer and fund only assets and positions you are prepared to risk.
- Each live step is rediscovered and simulated against a quorum-agreed block before signing. This avoids knowingly submitted reverts, but concurrent transactions, provider faults, and reorganizations mean success can never be guaranteed.
- Irreversible operations are disabled by default. Deadline-bound operations and prepared oracle sponsorship require private submission.
- Signed bytes and workflow progress are persisted before broadcast. Never delete runtime state to bypass a pending transaction or partial workflow.

## Launch safely

### 1. Install and create a private configuration

From `bots/chaos`:

```sh
bun install --frozen-lockfile
install -d -m 700 .state
cp config/operator.example.json .state/operator.json
chmod 600 .state/operator.json
```

The default template is intentionally unconfigured, paused, dry, and keyless. The Sepolia and custom-chain placeholder files are parser-tested shape references only: their `.invalid` URLs and patterned addresses must never be used as deployments.

### 2. Create a dedicated signer and budget it

Create the signer outside this repository and derive its address independently. Do not fund it yet. Set a total account-risk budget that covers:

- native ETH for gas, payable calls, the retained ETH reserve, and one workflow's maximum ETH principal;
- REP for each universe you intend to exercise, the retained REP reserve, and one workflow's maximum REP principal;
- optional shares or LP tokens for the operation families you want to cover.

Workflow caps reset after each workflow, so repeated runs can spend more than one cap over the bot's lifetime. The account's holdings are the true risk envelope. Never reuse an account that holds assets you are unwilling to lose.

### 3. Configure the stopped, keyless bot

Replace the inert configuration with the appropriate shape while the bot is stopped:

```sh
# Sepolia
cp config/operator.configured-placeholder.json .state/operator.json

# Or a custom EVM chain
cp config/operator.custom-chain-placeholder.json .state/operator.json
chmod 600 .state/operator.json
```

Replace every placeholder RPC, relay, and deployment root from an independently authenticated deployment manifest. Keep `paused: true` and `runtime.execute: false`, and choose a new unused `runtime.stateFile` for this chain, deployment, and signer. Never repoint an operated state path at another identity; preserve its main file and companion stores together.

Live execution requires the primary reader and at least two independent quorum-reader origins. Keep `runtime.protocolStartBlock` at `"0"` unless you have verified the earliest relevant deployment or carry event. Configure authenticated private relays before enabling deadline-bound operations. The [network and deployment profile](./OPERATOR_REFERENCE.md#network-and-deployment-profile) and [RPC and submission configuration](./OPERATOR_REFERENCE.md#rpc-and-submission-configuration) are the canonical sources for exact fields, graph checks, reader limits, custom-chain requirements, and relay rules.

With every operator for this state stopped, run the early bootstrap check:

```sh
bun run doctor
```

At this keyless, dry stage, `doctor` validates the configuration, network, public transaction-submission method, deployment, and any durable state already present. Because no signer is configured, it does **not** validate signer inventory or funding and does **not** acquire a signer-scoped lock. Private submission capability cannot pass keylessly because its relay evidence must authenticate the configured signer. A pass means the keyless public-mode bootstrap is coherent; it is not signer-aware live readiness. The full stopped preflight for a saved signer comes in step 6.

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

Leave that command running. In a second terminal, return to `bots/chaos` and read the owner-only dashboard password:

```sh
cat .state/dashboard-password
```

Open <http://127.0.0.1:4193> and sign in as `operator` with that password. Load the private key through the write-only Settings control. Leaving **remember** off keeps it only in process memory; enabling it saves the key in the owner-only configuration.

While paused and dry, verify that the displayed wallet address exactly matches the independently derived address. Only then fund it within the budget from step 2. Confirm the ETH, WETH, and universe-specific REP inventory on Overview. If the address differs, clear it, stop, preserve the old state unit, select a new unused state path, and restart with the intended signer; never delete state to work around signer scoping.

Keep the dashboard loopback-only or place it behind an access-controlled encrypted SSH tunnel. `/healthz` is unauthenticated liveness only; authenticated `/readyz` and `/metrics` report execution readiness and its individual blockers. Use the dashboard as the only configuration writer while the process runs. See [configuration and durable state](./OPERATOR_REFERENCE.md#configuration-and-durable-state) for the exact endpoint and mutation guarantees.

### 5. Finish discovery and prove a dry canary

Wait for topology, protocol-event, carry-proof, and signer-scoped inventory discovery to finish. Transactions remain blocked while required coverage is incomplete. Before continuing, verify:

1. the intended chain, deployment graph, and reader quorum are healthy;
2. the signer and ETH/WETH/REP inventory are exact;
3. Operation catalog shows all four ecosystems and explains each eligibility decision;
4. Ecosystem state contains the expected pools, universes, reports, auctions, and trading pairs;
5. Activity & recovery has no unresolved transaction, workflow, obligation, or safety blocker.

Treat any discovery warning as an execution stop. Raise only supported resident limits while paused, then wait for a complete warning-free rescan; never bypass a fixed envelope or discard proof state. The [discovery and cache safety envelopes](./OPERATOR_REFERENCE.md#discovery-and-cache-safety-envelopes) own the exact warning meanings and limits.

Resume once with `runtime.execute: false` and the shipped empty selectable allowlist. Confirm that lifecycle scanning continues but no random novelty is selected, then pause. Add one or a few exact low-risk selectable IDs from Operation catalog—for example `open-oracle.weth.wrap`—and observe several dry randomized selections. Every selection must remain inside that canary set. Pause before changing live controls and inspect the durable countdown, because an elapsed wait can become due immediately on resume.

The [scheduler and execution controls](./OPERATOR_REFERENCE.md#scheduler-and-execution-controls) define the exact allowlist, reserve, risk-gate, deadline, and retry semantics. [Operation coverage](./OPERATOR_REFERENCE.md#operation-coverage) owns the complete mutation classification.

### 6. Perform the signer-aware live preflight

Pause first. Take a stopped encrypted backup of the complete `.state` unit, then configure conservative positive ETH and REP reserves, principal and gas caps, the proven canary allowlist, and any required private relay. Keep both high-risk gates off. The signer persistence choice determines the safe preflight:

- **Saved signer:** enable live execution while paused, stop the process, and run `bun run doctor` against that persisted live-capable configuration. It must acquire both the state and signer locks and validate the durable stores, deployment, quorum, actual public-broadcast or signer-authenticated private-relay method, canonical topology, and signer funding. Restart paused. Before resuming, inspect the authenticated readiness report and require every check except the intentional pause to pass; this is where complete signer-scoped scan readiness is established. Reverify the signer, pending nonce, active workflow, index status, and safety-pause latch.
- **Memory-only signer:** stopping drops the key, so a stopped `doctor` becomes keyless and cannot prove signer funding or signer-lock ownership. Loading the funded signer into the paused process acquires its signer-scoped lock. Enable live execution through the authenticated dashboard; that path retains the lock and rejects the change unless signer-scoped discovery is complete and the full configured ETH, REP, and gas funding envelope is available. The saved configuration is forced back to paused, keyless dry-run form, so a restart cannot execute. Before resuming, require every authenticated readiness check except the intentional pause to pass.

After resume, `/readyz` returns HTTP 200 only while the bot is ready and idle. Require its named `submission` check to pass. Private mode supports only the official Flashbots relay matching the selected mainnet or Sepolia chain, or a loopback test relay; the [RPC and submission reference](./OPERATOR_REFERENCE.md#rpc-and-submission-configuration) owns the exact non-broadcasting control sequence and responses. A generic parser or gateway error is not sufficient evidence. Submission evidence is timestamped after the checks complete and refreshed at the final signing and broadcast boundaries; the bot refuses to sign or submit if it expires during the intervening anchor and nonce checks.

If due work starts immediately, the `recovery` check intentionally returns 503 while a transaction, workflow, lifecycle obligation, or automatic retry is active. Match that named blocker to the work shown in Overview and Activity & recovery; do not interrupt healthy in-flight work merely to restore 200. Pause for any other failed readiness check or an unexplained recovery blocker.

Do not assume resume creates a fresh wait: due random work or lifecycle recovery may start immediately. Observe successful finalized receipt and semantic evidence for each canary family before pausing to expand the allowlist. Keep high-risk and irreversible gates off until each affected operation has been reviewed and tested on an isolated deployment.

## Operate and recover

Monitor authenticated readiness, the durable countdown, signer inventory, active workflow, obligations, and Activity & recovery. If a dashboard mutation loses its response, reload and compare the current revision and state; never repeat it blindly. If the bot reports an indeterminate commit, stop and reconcile the owner configuration and runtime state before any further mutation.

A pending nonce blocks novelty until its canonical result is known. Use only the audited replacement, cancellation, retry, or abandonment controls in Activity & recovery. Never replay a confirmed prerequisite or manually edit a workflow. A durable safety pause survives restart; correct the cause, inspect its audit entry, and resume deliberately. Exact recovery proofs, retry timing, and transaction finality are defined in [scheduler and execution controls](./OPERATOR_REFERENCE.md#scheduler-and-execution-controls).

For a consistent backup or restore:

1. pause and wait for the dashboard mutation to finish;
2. stop every process or container using the state and signer;
3. copy the complete `.state` directory or named volume as one unit to owner-restricted encrypted storage;
4. restore only while stopped, repair the service UID/GID and owner-only permissions, then start paused;
5. verify signer, pending nonce, workflow, index, readiness, and safety-pause state before resume.

State may contain a remembered key, dashboard password, signed transactions, and credentialed endpoints. Never move only one sidecar, delete corruption, or stage a backup in shared storage. See [configuration and durable state](./OPERATOR_REFERENCE.md#configuration-and-durable-state) for the canonical state-unit inventory and recovery boundaries.

## Run with Docker

The Compose service runs as a non-root user, binds the dashboard to `127.0.0.1:4193`, and persists `.state` in the private `chaos-state` volume. Its fixed `zoltar-chaos-signer-locks` volume fences the same signer across Compose projects on one Docker host; it does not fence another host.

```sh
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build -d
docker compose exec chaos sh -c 'cat .state/dashboard-password'
docker compose logs --tail 100 chaos
```

First boot copies the safe paused, dry, keyless template. Stop the service and complete steps 3–6 before live use. The shipped Compose service and image's default `bun run run` command automatically run the full stopped preflight when the persisted configuration is live-capable; startup aborts if it cannot validate state, signer, network, or funding. An alternate container command does not receive that automatic gate, so run `bun src/cli/doctor.ts --if-live-capable` before any alternate operator launcher. `start.bat doctor` exposes the explicit gate on Windows. Do not copy a remembered key through an ordinary host directory; provision the protected volume through a secret manager.

For the keyless first-boot edit, export only the safe template to a protected Linux directory, choose a new state path and replace every placeholder, then restore its ownership in the volume:

```sh
install -d -m 700 .state
docker compose stop chaos
docker compose cp chaos:/app/bots/chaos/.state/operator.json ./.state/operator.json
# Edit .state/operator.json while it remains paused, dry, and keyless.
chmod 600 .state/operator.json
docker compose cp ./.state/operator.json chaos:/app/bots/chaos/.state/operator.json
docker compose run --rm --no-deps --user root --entrypoint sh chaos -c 'chown bun:bun /app/bots/chaos/.state/operator.json && chmod 600 /app/bots/chaos/.state/operator.json'
docker compose run --rm --no-deps chaos bun run doctor
docker compose start chaos
```

After loading or remembering a signer, make changes only through the authenticated dashboard. For a saved-signer live preflight, pause and stop the service, run the same one-off `doctor` command, then restart paused and complete step 6's readiness checks.

Any manually created container must mount `zoltar-chaos-signer-locks` at `.state/process-locks`. For multi-host operation, use exactly one signer per host or add an external lease/fencing service. This section owns the container-specific ownership and fencing guidance; the [configuration and durable state reference](./OPERATOR_REFERENCE.md#configuration-and-durable-state) owns the underlying state-unit and launch-gate invariants.

## Coverage and dashboard fixture

The bot covers permissionless Zoltar, Statoblast, Open Oracle, and Trading workflows. The dashboard shows current runtime eligibility; [operation coverage](./OPERATOR_REFERENCE.md#operation-coverage) is the canonical supported-family table.

To inspect the UI without a chain or key:

```sh
bun ./scripts/serve-dashboard-fixture.mts
```

Use `bun ./scripts/serve-dashboard-fixture.mts safety-recovery` for the pre-scan inventory, partial-workflow recovery, and safety-pause presentation. With Chromium installed, `bun ./scripts/capture-dashboard-qa.mts` records ignored desktop (`1440x900`) and mobile (`390x844`) evidence under `.state/qa`.
