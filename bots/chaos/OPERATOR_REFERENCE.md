# Chaos bot operator reference

Use this reference after completing the linear setup and dry-run walkthrough in the [README](./README.md). It owns the exact network forms, trust checks, operation boundary, and runtime controls that are useful during configuration or incident response.

## Network and deployment profile

Mainnet and Sepolia use the preset form. Mainnet must use exactly these identity fields:

```json
"network": {
  "chainId": 1,
  "explorerUrl": "https://etherscan.io",
  "name": "mainnet"
}
```

Sepolia must use exactly these identity fields:

```json
"network": {
  "chainId": 11155111,
  "explorerUrl": "https://sepolia.etherscan.io",
  "name": "sepolia"
}
```

Another EVM chain uses the explicit custom form:

```json
"network": {
  "chainId": 4242424242,
  "explorerUrl": "https://explorer.custom-chain.example.invalid",
  "kind": "custom",
  "name": "Zoltar Custom Chain Placeholder"
}
```

`kind` must be exactly `"custom"`. The chain ID must be a positive JavaScript-safe integer and cannot reuse a preset ID. The name is a display label of 1–64 valid Unicode characters; it cannot have surrounding whitespace, contain control-like characters, or impersonate a preset. Custom durable profiles use `custom-chain-<chainId>`, not the label. The native currency must have the 18-decimal Ether semantics required by WETH and the rest of this ecosystem. `explorerUrl` is operator metadata, not a trust signal.

Configure all eight roots from an independently verified deployment manifest:

- `zoltar`
- `questionData`
- `securityPoolFactory`
- `securityPoolForker`
- `openOracle`
- `weth`
- `tradingFactory`
- `tradingRouter`

At every canonical scan anchor, the bot authenticates the configured graph before assets can become eligible:

- Zoltar must name the configured QuestionData, SecurityPoolForker must name Zoltar, TradingFactory must name SecurityPoolFactory, and TradingRouter must name TradingFactory.
- Every security pool must come from the configured factory registry. Its factory, forker, Zoltar, QuestionData, coordinator, share token, truth auction, universe, and question must agree with the registry and configured graph. Its coordinator must point back to it.
- Each pool must use its universe's canonical REP. The pool and coordinator must use the configured OpenOracle; the coordinator must use the configured WETH and canonical REP.
- Every trading pair must name the configured factory, source pool, share token, universe, and question.

These checks reject an inconsistent graph. They cannot prove that an internally consistent malicious graph is the deployment the operator intended, so deployment-manifest verification remains an out-of-band responsibility.

## RPC and submission configuration

- `rpcQuorum: 1` needs one healthy read endpoint and is available only in dry-run mode for isolated development.
- Live execution requires `rpcQuorum: 2`, a primary `readRpcUrl`, and at least two `quorumRpcUrls`: three distinct origins, two of which must agree and remain healthy.
- Every endpoint must report the configured chain. Use HTTPS except for loopback HTTP or the local Anvil service. Different paths on one origin are not independent providers.
- `publicRpcUrls` supplies public broadcasts. The schema requires at least one even when private submission is selected.
- `runtime.protocolStartBlock` is the earliest block that can contain protocol deployment or carry events. `"0"` is safe but can make the first backfill slow. Starting too late omits cumulative history and makes proof-dependent operations fail closed.

Public submission blocks deadline-bound operations:

```json
"submission": {
  "minimumBundleRelaySuccesses": 1,
  "mode": "public",
  "relayUrls": []
}
```

Private submission uses real, independent relays:

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

The example relay hosts are deliberately unusable. A relay must report the configured chain and prove authenticated `eth_sendPrivateTransaction` support. `minimumBundleRelaySuccesses` is the number that must pass preflight and accept the transaction. Relay URLs must use HTTPS or loopback HTTP and cannot embed credentials, query parameters, or fragments.

## Operation coverage

The dashboard's Operation catalog owns live eligibility for the runtime definitions in `CHAOS_OPERATION_CATALOG`. The complete canonical mutation inventory—including privileged and excluded ABI entries that are not runtime definitions—is owned by [`src/contracts/surface.ts`](./src/contracts/surface.ts). [`tests/contracts/catalog-coverage.test.ts`](./tests/contracts/catalog-coverage.test.ts) compares that inventory and every curated function/event shape with generated artifacts.

Every canonical mutating or special entry is classified as selectable random work, a workflow prerequisite, a lifecycle obligation, role-restricted, or excluded-dangerous. The bot does not impersonate privileged callers, invoke delegate modules directly, invent recipients or authorizations, redeploy infrastructure, or treat receive/fallback routing as ordinary random work.

| Ecosystem   | Supported permissionless families                                                                                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoltar      | Create binary, categorical, and scalar questions; approve REP; deploy child universes; fork universes; prepare, split, and continue REP migration; optional direct REP burn                                                                                                                                                                                     |
| Statoblast  | Deploy pools; deposit, withdraw, and redeem vault REP; update or redeem fees; create and redeem complete sets; redeem winning shares; reporting and escalation withdrawals; pool forks and vault migrations; truth-auction bid, refund, finalize, and settle; staged REP-withdrawal execution and staged-operation expiry; permissionless lifecycle maintenance |
| Open Oracle | Wrap and unwrap WETH; report, randomly selected dispute, and lifecycle settlement; canonical WETH/REP ERC-20 deposit; WETH/REP withdrawal, self-recipient `withdrawTo`, both push-or-credit overloads, wallet-to-self internal allowance management, and dust initialization                                                                                    |
| Trading     | Create and initialize pairs; enter and exit YES or NO; add and remove liquidity; exact-input and exact-output swaps with 1% quote protection; approvals; synchronization; complete-set redemption; fork share migration                                                                                                                                         |

Eligibility is narrower than coverage. Balances, reserves, approvals, lifecycle phase, deadlines, submission mode, missing candidates, disabled ecosystems, and risk gates can block a supported operation.

Native OpenOracle deposits are excluded because the contract exposes no exact native-transfer evidence for an automated withdrawal or push. WETH and discovered REP deposits remain supported because later credit sweeps can be bound to exact ERC-20 transfer evidence. OpenOracle recipients are always the configured wallet; internal allowance changes can authorize only that wallet to itself.

Staged REP-withdrawal execution is supported with an exact coordinator-context downstream simulation. Staged liquidation execution is excluded because inclusion ordering can change its irreversible debt result after preflight.

## Scheduler and execution controls

The configured scheduler bounds must be inclusive values within 60–3,600 seconds and must contain at least two possible delays. After each completed random workflow, the scheduler samples from that configured subrange and excludes the immediately preceding delay. The selected delay and next-run timestamp survive restarts. Deadline-bound lifecycle obligations take priority over novel random work.

- `paused` blocks novel scheduling, workflow continuation, and automatic resubmission. It retains `nextRunAt`; wall-clock time keeps advancing, so resume marks an elapsed countdown due instead of sampling a replacement delay. Read-only reconciliation continues so a canonical outcome remains observable.
- `runtime.execute` selects dry-run (`false`) or live signing and submission (`true`).
- `runtime.protocolLogBlockSpan` bounds the event range processed in one cycle; discovery maxima are per-page limits rather than total topology caps.
- `strategy.enabledEcosystems` accepts one or more of `zoltar`, `statoblast`, `open-oracle`, and `trading`.
- ETH and REP reserves protect retained inventory while eligibility checks hold. Each ETH/REP principal cap applies separately to one workflow and is cumulative across all of that workflow's steps; the cap resets for every later workflow. Wallet, WETH, REP, and OpenOracle internal-credit debits contribute to the relevant cap. Repeated workflows can consume additional principal down to the reserves, so the dedicated account's holdings—not a per-workflow cap—are the total asset-risk envelope. The gas ceiling is a separate per-transaction limit.
- `strategy.workflowValidForBlocks` must be at least 64 so prerequisites can reach finality while every continuation is still freshly simulated.
- High-risk and irreversible operations use independent explicit gates.

For dry-run validation, resume with `runtime.execute: false`, observe several randomized selections, then pause again before changing live controls. Inspect `nextRunAt` before live resume because due random work can begin immediately; deadline-bound lifecycle recovery can also take priority.

Before each signature, live mode rechecks the canonical plan, reserves, cumulative principal, gas ceiling, nonce, and exact call against the quorum anchor. A changed anchor discards the unsigned attempt. Signed bytes and the intent are persisted before broadcast; identical-byte resubmission repeats durable preflights and never crosses its stored transport horizon. Receipts need 12-block canonical finality and operation-specific semantic evidence.

Timestamp-bound calls require private next-block inclusion with a safety margin. Block-clock calls use the last valid inclusion block. An expired transport window does not falsely mark a still-present lifecycle obligation complete.

## Configuration and durable state

Dashboard mutations use configuration revisions so a stale browser cannot overwrite a newer file. Bot-owned writes are serialized, but an arbitrary filesystem writer cannot join that protocol. The dashboard is therefore the only supported writer while the process is running; stop it before any offline edit, restore, or copy.

A configuration commit first writes a durable safety checkpoint. Post-commit persistence or signer-lock faults are surfaced as committed-but-safety-paused or commit-indeterminate. Dashboard APIs redact RPC and relay URLs, deployment details, keys, signed transactions, and calldata.

Treat the main runtime state and its companion stores as one backup unit:

- `<runtime.stateFile>`
- `<runtime.stateFile>.protocol-index-v1`
- `<runtime.stateFile>.immutable-topology-v1`
- `<runtime.stateFile>.carry-proof-journal.json` and its segments

The main runtime state is atomically written, structurally validated, owner-only, and symlink-rejecting; it does not have a whole-file checksum. The companion protocol index, topology cache, and carry-proof stores add checksummed content tied to the deployment identity. Cursor-hash or identity mismatches fail closed or rebuild only the derived cache. Live balances and lifecycle state are always refreshed from the canonical anchor.
