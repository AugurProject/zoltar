# Position journal and recovery

This document owns the [OpenOracle arbitrager](./README.md) durable position journal, its state machine, and the procedure for a position that needs manual reconciliation. It relies on the [read quorum and finality rule](./EXECUTION.md#read-agreement-and-finality).

**Contents**

- [Durable position journal](#durable-position-journal)
- [`recovery-required` runbook](#recovery-required-runbook)
- [Concurrent position limit](#concurrent-position-limit)

## Durable position journal

The configured `runtime.positionFile` is the durable journal; the example uses `.state/positions-mainnet.json`. Before relay delivery, writes use an owner-only temporary file, sync its complete contents, atomically rename it, and sync the parent directory. A malformed journal stops startup rather than discarding recovery state. Back it up with the configuration and history files, never share one path across networks or execution signers, and preserve it until every position is closed and reconciled.

The journal retains every position that can still consume risk, every expired transaction hash that still requires late-inclusion monitoring, every unsent history outbox, and the 500 newest fully terminal recovery records. Older closed records, and expired-not-included records only after every retained hash is reconciled or proved impossible, are compacted into durable position-count, hedged-profit, and realized-profit totals plus the newest 32 UTC-day gas buckets. The retained gas buckets continue to feed the current-day gas guard and dashboard; the append-only execution history remains the audit record for older confirmed entries and their dated gas costs.

Execute mode holds `<position-file>.lock` for the process lifetime to prevent concurrent writers. While a signer is active or queued, it also holds a signer lock under the `ZOLTAR_BOT_SIGNER_LOCK_ROOT` directory that prevents a second process from using the same signer on the same chain with a different journal, provided both processes resolve the same lock root. A signer change acquires the new lock before persistence and keeps the old and new locks until the next scan boundary completes the transfer. The reconciliation command also holds the journal lock. Journal contention fails before journal load, while signer contention fails before signer activation, signing, or submission. Lock files include the owner PID and acquisition time and are removed after normal completion or caught-error unwinding. After any interrupted, terminated, or crashed process, verify that no bot or reconciliation process is still running before removing an orphan lock; never delete a live lock to force startup. Signer locks cannot coordinate different lock roots or hosts. Never run the same execution signer across either boundary.

The state sequence is:

```text
pending-entry → open → withdrawing → closed-pending-finality → closed
     │           │          │                    │
     │           └──────────┴──→ recovery-required
     │                                ↓ signer-key-authorized local reconciliation
     │                              closed (P&L recorded or unavailable)
     ├── atomic public/private: after 12 canonical descendants and quorum-confirmed absence
     │    → expired-not-included
     ├── quorum-confirmed atomic revert → closed (gas recorded)
     └── lifecycle receipt removed by reorg → open (provisional accounting removed)
```

The bot records every entry transaction hash before submission. Private and public entry each have one guarded executor transaction. After a restart the bot requires the read quorum to agree on every required receipt and on that receipt block's current canonical hash. Every receipt must include its effective gas price. The bot then decodes the executor event and reconstructs actual entry gas and hedge economics before leaving `pending-entry`. A current atomic public or private attempt proven absent under the finality rule becomes `expired-not-included`; a quorum-confirmed atomic revert closes after gas accounting. Inter-reader disagreement keeps the current journal state pending and blocks execution. Quorum-agreed evidence that is missing required executor events or conflicts with the durable journal moves the position to `recovery-required` and never produces trading profit. Records written by earlier releases are covered under [upgrading](./CONFIGURATION.md#upgrading).

Before lifecycle delivery, the bot atomically records the one executor transaction hash, nonce, token decimals, target block, and delivery mode. Both modes call `settleAndWithdraw`, which optionally settles, moves only the recorded position amounts using OpenOracle internal allowances, and withdraws those exact amounts in the same parent-bound transaction. After a crash the bot reconstructs lifecycle gas and withdrawals, including the exact optional ETH settler reward, from the canonical receipt and `LifecycleExecuted` event. Wallet balance deltas and `withdraw(max)` are not accounting evidence, so permissionless OpenOracle dust, unrelated transfers, and other positions sharing a token remain separate. Exact successful evidence first moves the record to `closed-pending-finality`. The bot retains the risk slot and transaction evidence until the exact lifecycle evidence passes the finality quorum; it then realizes profit, or removes provisional withdrawal and gas accounting and reopens the position if the receipt was reorged out.

When another report replaces the bot, the durable entry already contains the exact amounts and fee needed to reproduce OpenOracle's replacement-credit formula. The bot checks the authenticated current report, records a `replacement-credit` lifecycle, and calls `withdrawReplacementCredit` for exactly one credited token. The executor uses an exact OpenOracle internal transfer and withdrawal, verifies the wallet receipt, and leaves the one-unit sentinel and every unrelated balance untouched. Missed or reverted attempts follow the same expiry/retry rules as settlement. Canonical success becomes **replaced**, not **closed**, because only one side of the hedged inventory has returned and automatic revenue would be misleading.

## `recovery-required` runbook

Stop new entries and preserve the position journal before investigating. Do not delete or hand-edit a record to bypass the concurrent-position limit.

1. Confirm the dashboard network, signer address, OpenOracle, executor, and token match the journal record. Save a copy of the journal, operation log, and evidence from every configured reader. Apply the [read quorum](./EXECUTION.md#read-agreement-and-finality): record a reader as unavailable only for a positively identified retryable transport failure. Preserve malformed or contradictory responses as safety-fault evidence rather than excluding them.
2. For **entry receipt could not be recovered**, current records contain one `entryTransactionHashes` value. Look it up on independent explorers/RPCs. It must be absent, revert without an executor event, or succeed in its parent-bound target block with the exact matching event. A quorum-confirmed revert is closed automatically after gas accounting. A [legacy multi-transaction record](./CONFIGURATION.md#upgrading) can contain multiple hashes; inspect every hash and never treat the record as expired merely because its target passed. If evidence is temporarily unavailable, restore the configured RPC service and let the bot retry quorum recovery automatically. For a successful mismatched receipt, reorganization, or legacy multi-transaction record, keep the bot paused and reconcile allowances, wallet balances, OpenOracle holder balances, and the current reporter manually. For inter-reader disagreement, preserve the contradictory evidence and restore a trustworthy agreeing quorum before deciding whether manual reconciliation is required.
3. For **lifecycle receipt could not be recovered**, inspect the single `lifecycleTransactionHashes` value and `lifecycleTargetBlockNumber`. A successful call must be in that target block and emit the exact matching lifecycle event. A public or private attempt whose absence passes the finality rule is automatically cleared for a fresh retry. Keep the bot paused for disagreement or ambiguous evidence; do not authorize a second transaction while the recorded attempt remains live.
4. For **stored-state/current-reporter mismatch**, compare the current reporter, settlement state, dispute events, and the wallet's OpenOracle WETH/token holder balances through the configured RPC quorum. When the bot's authenticated entry transaction is immediately followed by one canonical replacement, the bot computes that report's exact one-token credit and claims only that amount automatically. If the immediate successor cannot be authenticated, its arithmetic does not match the durable entry, or the exact credit is unavailable, the bot refuses an aggregate withdrawal and keeps the record in recovery. Never attribute the wallet's whole OpenOracle balance to this report.
5. For **unexpected residual assets**, use the lifecycle event and OpenOracle internal balances to distinguish the position's exact withdrawal from unrelated dust or other deposits. Value or unwind any external token exposure, including its gas and slippage, before treating manual reconciliation as complete.

After resolving all residual assets, close the recovery record with the dedicated command. The command requires the same private key as the position, exact typed report confirmation, evidence, external cost, final WETH/token balances, and either an independently calculated realized P&L or an explicit declaration that P&L is unavailable:

```bash
PRIVATE_KEY=0x... bun run reconcile -- --position-file=.state/positions-mainnet.sepolia.json --chain-id=11155111 --report-id=42 --confirm-report-id=42 --evidence='receipts and balance snapshots archived under incident-42' --note='residual REP sold manually; balances checked on all configured read RPCs' --external-cost-eth=0.003 --final-wallet-weth=4.2 --final-wallet-token=85 --pnl-unavailable=true
```

Use the active profile's configured `runtime.positionFile`; switching the supplied Mainnet configuration to Sepolia generates `.state/positions-mainnet.sepolia.json`. Set `--chain-id=1` for Mainnet or `--chain-id=11155111` for Sepolia. The command rejects a journal bound to a different chain.

Use `--realized-net-profit-eth=-0.04 --acknowledge-pnl-is-all-in=true` instead of `--pnl-unavailable=true` only when entry evidence was recovered and the all-in value can be independently reproduced. Add every OpenOracle or manual-withdrawal receipt and every external unwind or sale proceed; subtract all entry, lifecycle, and external gas, fees, slippage, and `--external-cost-eth`. The command records rather than computes that result. It writes the evidence, costs, final balances, signer, time, and P&L status into the owner-only journal before moving the record to `closed`. It never submits an on-chain transaction and stores no cryptographic signature or independently verifiable attestation; “signer-key-authorized” means only that the supplied key derives the position account. Keep the pre-reconciliation backup with the incident artifacts. There is intentionally no dashboard force-close button.

Escalate unresolved or contradictory evidence to the protocol/operator security team. Resume unattended entry only after the journal shows `closed`; recovery states are a safety stop, not an ignorable warning.

## Concurrent position limit

`runtime.riskLimits.maxConcurrentPositions` (1 through 1,000; the example sets `1`) caps non-closed durable positions. This is separate from the per-position and total-locked WETH limits; it prevents a second entry from depending on wallet inventory already committed to recovery.
