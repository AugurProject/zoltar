# Chaos bot operator reference

Use this reference after completing the linear setup and dry-run walkthrough in the [README](./README.md). It owns the exact network forms, trust checks, operation boundary, and runtime controls that are useful during configuration or incident response.

## Network and deployment profile

Mainnet and Sepolia use the preset form. Mainnet must use exactly these identity fields:

```json
"network": {
  "chainId": 1,
  "explorerUrl": "https://etherscan.io",
  "maximumBlockIntervalSeconds": 60,
  "name": "mainnet"
}
```

Sepolia must use exactly these identity fields:

```json
"network": {
  "chainId": 11155111,
  "explorerUrl": "https://sepolia.etherscan.io",
  "maximumBlockIntervalSeconds": 60,
  "name": "sepolia"
}
```

Another EVM chain uses the explicit custom form:

```json
"network": {
  "chainId": 4242424242,
  "explorerUrl": "https://explorer.custom-chain.example.invalid",
  "kind": "custom",
  "maximumBlockIntervalSeconds": 30,
  "name": "Zoltar Custom Chain Placeholder"
}
```

`kind` must be exactly `"custom"`. The chain ID must be a positive JavaScript-safe integer and cannot reuse a preset ID. The name is a display label of 1–64 valid Unicode characters; it cannot have surrounding whitespace, contain control-like characters, or impersonate a preset. Custom durable profiles use `custom-chain-<chainId>`, not the label. The chain must expose an EIP-1559 base fee and accept type-2 transactions, and its native currency must have the 18-decimal Ether semantics required by WETH and the rest of this ecosystem. Canonical-anchor preflight rejects readers that omit `baseFeePerGas`. `explorerUrl` is operator metadata, not a trust signal.

`maximumBlockIntervalSeconds` is the operator's block-delay risk envelope used only to convert timestamp deadlines into a conservative wall-clock safety margin. It accepts 1–86,400 seconds. It does not change transaction transport validity, which remains a 25-block horizon. Block-clock deadline eligibility instead requires the deadline to be strictly later than `current block + 25 + prerequisite count × (25 + 12)` blocks: the supported margins are 25, 62, or 99 blocks for zero, one, or two prerequisites. That deadline check is separate from `strategy.workflowValidForBlocks`, which bounds the freshness of the whole prepared workflow. Timestamp planning reserves one interval for each prerequisite's inclusion, 12 intervals for that prerequisite's finality, and a terminal submission margin equal to the larger of one interval or 60 seconds; its deadline boundary is also strict. No finite setting guarantees a block will arrive within the interval: missed slots or chain disruption can always exceed it. Larger values reduce deadline-expiry risk but make fewer timestamp-bound operations eligible. Custom networks must set it explicitly from their observed and adversarial timing envelope. Mainnet and Sepolia default to 60 seconds (five nominal Ethereum slots) when the field is absent, and the committed preset examples use that value; operators may choose a larger value for a more conservative posture.

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
- Live execution requires `rpcQuorum: 2`, a primary `readRpcUrl`, and at least two `quorumRpcUrls`, for at least three distinct configured origins. Up to eight quorum readers are allowed, for at most nine configured read origins. Every configured reader participates in canonical scans; each check needs at least two healthy responses, and every successful response must agree. `rpcQuorum: 2` is a minimum health threshold, not a request to ignore readers beyond the first two.
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

The dashboard's Operation catalog projects the complete canonical mutation inventory. Runtime definitions, grouped lifecycle candidates, workflow prerequisites, privileged surfaces, and dangerous exclusions retain their classification and current blockers; filters separate ecosystem, classification, and eligibility. [`src/contracts/surface.ts`](./src/contracts/surface.ts) owns the canonical inventory, while `CHAOS_OPERATION_CATALOG` owns executable planners. [`tests/contracts/catalog-coverage.test.ts`](./tests/contracts/catalog-coverage.test.ts) compares both with generated artifacts.

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

### Discovery and cache safety envelopes

The five `discovery` fields ship at `100` and accept safe integers from `1` through `10,000`. Each configured maximum bounds one cycle of work and the corresponding complete topology retained for execution. Counted question, pool-deployment, and per-pool vault registries additionally persist their authenticated cursor, commitment, exact canonical total, and progress across restarts. Universe traversal and staged-operation discovery are bounded scans rather than counted durable cursors. Partial or oversized results are never executable topology.

Planning reserves the complete post-transaction topology for every route that may add a question, universe, pool, or vault registration. This includes implicit creation during REP migration, child-pool migration, auction settlement, and escalation claims. A question reserves its record, outcome-label fan-out, and serialized resident bytes. A route that reuses an existing child or registered vault remains available at an exact limit because it adds no topology. When a lifecycle action lacks headroom, its raw identity remains visible and blocks novel work until capacity is safely increased or another actor completes it.

| Envelope                                           | Exact limit                                                                                                                                                      | Failure behavior                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configured discovery fields                       | `maxPools`, `maxQuestions`, `maxStagedOperationsPerPool`, `maxUniverses`, and `maxVaultsPerPool` are each `1`–`10,000`                                           | The configuration is rejected outside the range. Reaching a configured work or resident bound keeps discovery incomplete and execution paused.           |
| Configured aggregate products                      | Each of `maxPools × maxUniverses`, `maxPools × maxVaultsPerPool`, and `maxPools × maxStagedOperationsPerPool` must be at most `10,000`                            | The configuration is rejected before it can be activated.                                                                                                |
| Actual share-inventory fan-out                     | At most `10,000` approval and fork-migration relations                                                                                                           | Discovery warns before issuing the fan-out RPCs; indexing, lifecycle completion, and execution remain paused.                                            |
| Outcome labels for one question                    | At most `4,096` labels and `4 MiB` total label UTF-8 bytes                                                                                                       | Question discovery fails closed.                                                                                                                         |
| All resident question snapshots and outcome labels | At most `10,000` items and `32 MiB` of serialized snapshots                                                                                                      | The question registry switches to overflow mode, retains no partial executable registry, and reports the exact total and progress.                       |
| Discovery RPC work                                 | Per configured reader: `12` active requests and at most `48` queued requests. For `N = 1 + quorumRpcUrls.length`, the aggregate ceilings are `12 × N` active and `48 × N` queued; at the nine-reader maximum these are `108` and `432`. | Additional queued work fails the scan; bounded mappers stop assigning new work and drain the workers they already started.                                |
| Immutable topology cache                           | At most `100,000` resident items and `64 MiB` of committed chunk data; each chunk has at most `256` records and `32 MiB`; its manifest is at most `64 KiB`         | Loading and writing validate these limits incrementally and reject the cache before retaining excess data.                                                |
| One immutable topology record                      | At most `33,553,408` bytes (`32 MiB - 1 KiB`); a cached question still has the independent `4 MiB` outcome-label limit                                            | The record is rejected before it can enter the resident cache.                                                                                            |
| Protocol event index                               | At most `100,000` records, `512` chunks, and `64 MiB` of chunk payload across all six collections. Each chunk contains at most `256` records and `1 MiB`; the authenticated manifest is at most `64 KiB`. | A scan that would cross the envelope is rejected before replacing the last persistable in-memory index. Unchanged content-addressed chunks are hard-linked into the new generation, while every loaded byte, count, digest, owner, mode, and path remains validated. |
| Carry-proof journal                                | At most `32,768` persisted evidence records and `16 MiB` of payload across at most `16` owner-only `1 MiB` segments; one append may use at most `16,384` transient records before producing a checkpoint within the persisted limit; the segmented manifest is at most `64 KiB`; its dedicated segment-directory cleanup examines at most `256` entries per save | The manifest, exact segment geometry, identity, bytes, and record count are checked before replay. Headroom-aware compaction makes a bounded response independent of the fixed suffix threshold. Capacity or cleanup exhaustion fails the canonical scan closed without dropping proof evidence. |
| Carry indexed replay                              | At most `262,144` weighted units. Every game costs `480` units, every indexed MMR slot costs `6`, every sparse-nullifier record costs `68`, and materialized state copies are charged separately. Empty MMR peak arrays are allocated lazily. | Replay rejects before constructing an index whose maps, MMR nodes, sparse-tree nodes, or simultaneous state copies exceed the heap-oriented work envelope. This limit is intentionally distinct from serialized record count. |
| Carry log and proof page                           | Topic-filtered log responses contain at most `16,384` relevant events. Oversized multi-block ranges are halved and resumed without loss; an overfull single block fails closed. At most `32` inherited-deposit proofs are generated and anchor-verified per scan. | The proof page rotates with the canonical anchor. The journal still emits the complete lightweight set of unconsumed wallet identities for lifecycle confirmation, and quorum-read game phase/outcome fields derive the complete mature-winning subset that can obstruct novelty even while off-page. Paging therefore cannot permit false absence, starve due carry work, or block on immature/losing slots. Every exposed action remains fully replayed, verified, and simulated. |
| Unplanned lifecycle-presence guard                 | At most `1,000,000` raw identities are deduplicated and at most `256` active obligations are materialized. Raw presence retains identity and tombstones; a separate complete canonical phase set marks only identities that are currently due. Every bounded deposit or bid call contributes all deterministic batches. Unrepresented due identities are reduced to one fixed-size count, commitment, reason, provenance flag, and bounded first-item summary in the main state. | Exceeding the raw identity limit, exhausting the active-obligation budget, or finding an actionable plan outside either set fails novel work closed without growing the main journal without bound. Latent identities do not stop unrelated work. An incomplete scan may latch but never clear the guard; only complete canonical coverage can recompute, clear, or defer it. A completed identity that returns after confirmed absence is classified as a possible canonical reorganization and requires explicit reconciliation or a later complete absence. Actionable materialized obligations retain priority. |

Raise a configured bound only while paused. A newly sufficient bound may restart an affected counted cursor rather than trust a formerly nonresident prefix, so leave execution disabled until a warning-free canonical scan finishes. Counted registry warnings expose exact totals and progress; staged-operation warnings expose an exact total without a durable cursor; universe warnings expose only the retained count at the limit; share fan-out warnings expose a conservative lower bound. If an exact counted total exceeds `10,000`, required configured values violate an aggregate product, or a non-counted scan still exceeds a fixed question, RPC, record, fan-out, cache, or carry-evidence envelope, no supported setting can make that deployment executable. Keep the bot paused and in dry-run mode; do not delete carry evidence or bypass an envelope. For a carry-capacity failure, preserve the journal and inspect whether the durable evidence, weighted replay, payload, or bounded transient response reached its named limit. Rebuilding is not a general recovery mechanism; use a reviewed software/storage design change or a fresh deployment when the canonical retained state itself exceeds the supported envelope.

- `paused` blocks novel scheduling, workflow continuation, and automatic resubmission. It retains `nextRunAt`; wall-clock time keeps advancing, so resume marks an elapsed countdown due instead of sampling a replacement delay. Read-only reconciliation continues so a canonical outcome remains observable.
- `runtime.execute` selects dry-run (`false`) or live signing and submission (`true`). Live mode requires `strategy.minimumRepReserve` to be greater than zero and retains `strategy.minimumEthReserve` as a safety floor at least as large as one complete `strategy.maximumGasCostEth` budget. That floor is not itself spendable: a normal or recovery transaction still needs its ETH value plus gas above the reserve. The smallest positive 18-decimal unit is `0.000000000000000001`.
- `runtime.protocolLogBlockSpan` bounds the event range processed in one cycle.
- `strategy.enabledEcosystems` accepts one or more of `zoltar`, `statoblast`, `open-oracle`, and `trading`.
- ETH and REP reserves protect retained inventory while eligibility checks hold. Zero reserves are permitted only in dry-run mode; live ETH reserve must also retain a maximum-gas-cost-sized safety floor. Enabling or resuming live mode requires a complete signer-scoped scan whose ETH balance covers that reserve plus one maximum gas budget and whose canonical universe inventory contains REP at or above the configured reserve. Every later live scan reapplies those inventory checks to novel selectable work, so an external drain blocks new random operations without hiding lifecycle reconciliation. The floor does not guarantee recovery funding because transaction value and gas must remain available above it. An invalid reserve cannot enable live signing, workflow continuation, or automatic resubmission. Read-only reconciliation still observes canonical outcomes while dry. Each ETH/REP principal cap applies separately to one workflow and is cumulative across all of that workflow's steps; the cap resets for every later workflow. Wallet, WETH, REP, OpenOracle internal-credit, and SecurityPool vault-backed REP debits contribute to the relevant cap. Vault-backed escalation deposits are rechecked against fresh canonical vault backing before signing or resubmission. Repeated workflows can consume additional principal down to the reserves, so the dedicated account's holdings—not a per-workflow cap—are the total asset-risk envelope. Before the first remaining workflow transaction, a fresh canonical balance check requires enough ETH for the reserve, every remaining transaction value, and one complete maximum-gas-cost budget per remaining step plus every declared workflow-owned cleanup transaction. The executor then revalidates the exact gas ceiling and balance before each signature. The configured gas ceiling remains a per-transaction limit.
- `strategy.workflowValidForBlocks` must be at least 75. The floor covers both supported approval prerequisites consuming their full 25-block transport validity and 12-block finality horizons, plus one block to begin the terminal step. The committed 96-block setting adds operational headroom.
- High-risk and irreversible operations use independent explicit gates. The dashboard locks the complete execution-policy form while the bot is unpaused, so risk gates, reserves, caps, timing, and ecosystem scope cannot be changed in a running browser session.

For dry-run validation, resume with `runtime.execute: false`, observe several randomized selections, then pause again before changing live controls. Inspect `nextRunAt` before live resume because due random work can begin immediately; deadline-bound lifecycle recovery can also take priority.

Before each signature, live mode rechecks the canonical plan, reserves, cumulative principal, gas ceiling, nonce, and exact call against the quorum anchor. A changed anchor discards the unsigned attempt. Signed bytes and the intent are persisted before broadcast; identical-byte resubmission repeats durable preflights and never crosses its stored transport horizon. Receipts need 12-block canonical finality and operation-specific semantic evidence.

Timestamp-bound calls require private next-block inclusion with a safety margin. Block-clock calls use the last valid inclusion block. An expired transport or refreshable planning window does not falsely mark a still-present lifecycle obligation complete; raw canonical presence keeps it deferred until it becomes actionable again or complete discovery proves that the identity left the protocol.

Statoblast oracle sponsorship uses a durable funding envelope instead of recomputing amounts after approvals. The plan records an exact WETH amount, exact REP amount, refundable ETH bounty, collateral ceiling, and maximum supported inclusion fee; both approvals reach canonical finality before only the terminal request receives a private next-block constraint. The initial balance check reserves the configured maximum gas budget for both approvals, the request, and two possible revocations. A changed price, pending report, collateral increase, fee ceiling, principal policy, submission mode, insufficient funding inventory, or expired original workflow-validity window converts every confirmed workflow-created approval into exact `approve(0)` cleanup. An approval that was never confirmed is never treated as workflow-owned and is not revoked. Pausing or disabling Statoblast still blocks that cleanup, so retain enough ETH for recovery and do not change those controls until Activity & recovery shows no partial workflow.

## Configuration and durable state

Dashboard mutations use configuration revisions so a stale browser cannot overwrite a newer file. Bot-owned writes are serialized, but an arbitrary filesystem writer cannot join that protocol. The dashboard is therefore the only supported writer while the process is running; stop it before any offline edit, restore, or copy. A configuration commit first writes a durable safety checkpoint.

Mutation outcomes have three distinct recovery paths:

- A timeout or lost transport response before the API returns a commit status is an unknown response. The browser freezes the affected controls while it reloads the current revision or recovery state. If reconciliation succeeds, compare that state before continuing; never repeat the original mutation blindly.
- `configuration_committed_safely_paused` confirms that the owner configuration committed but activation did not complete. The durable safety pause remains set. Reload and verify the committed configuration and recovery state, correct the reported activation problem, and explicitly resume only after that review.
- `configuration_commit_indeterminate` means the owner-file save may have committed and its exact outcome cannot be proven. Treat the request as committed. The server rejects every later dashboard mutation for the rest of that process, so Refresh reads can aid diagnosis but cannot unlock mutation controls. Stop the bot, inspect and reconcile the owner configuration and runtime-state files offline, restart, and reverify the signer, revision, pause, and recovery state before making another change.

Dashboard APIs redact RPC and relay URLs, deployment details, keys, signed transactions, and calldata.

Treat the main runtime state and its companion stores as one backup unit:

- `<runtime.stateFile>`
- `<runtime.stateFile>.protocol-index-v1`
- `<runtime.stateFile>.immutable-topology-v1`
- `<runtime.stateFile>.carry-proof-journal.json` and, when its manifest is segmented, the complete dedicated directory named by `segmentDirectory`

The main runtime state is atomically written, structurally validated, owner-only, and symlink-rejecting; it does not have a whole-file checksum. A state path is scoped to its chain ID, all eight deployment roots, and first signer. Changing any identity requires a new unused state path while the old complete state unit remains preserved. Only an unsigned bootstrap journal with no durable activity, scheduler, index, workflow, obligation, lifecycle-presence blocker, tombstone, pending transaction, or safety history can adopt corrected deployment roots automatically. The companion protocol index, topology cache, and carry-proof stores add checksummed content tied to the deployment identity. Every carry replacement is checked against the authenticated revision from which it was prepared; a permitted deployment-profile reset preserves the authenticated old generation and installs the pristine replacement within one serialized mutation. Corruption is never treated as reset authority. Cursor-hash or identity mismatches otherwise fail closed or rebuild only the derived cache. Live balances and lifecycle state are always refreshed from the canonical anchor.
