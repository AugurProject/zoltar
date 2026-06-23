# EscalationGame architecture

`EscalationGame` is intentionally split into source-level modules while preserving one deployed contract. The split reduces review scope for future changes without introducing delegate calls, external libraries, or cross-contract state ownership.

## Inheritance stack

The modules form a narrow inheritance ladder:

| Module | Owns |
| --- | --- |
| `EscalationGameTypes.sol` | Constants and structs shared by the stack. |
| `EscalationGameState.sol` | Storage layout, events, constructor wiring, shared access control, and the primitive escrow/unresolved counters. |
| `EscalationGameCalculations.sol` | Pure/view attrition, resolution, accepted-deposit, and payout math. |
| `EscalationGameProofs.sol` | Storage-free Merkle Mountain Range and nullifier proof math. |
| `EscalationGameCarry.sol` | Fork carry snapshots, Merkle Mountain Range state, nullifier roots, proof verification, and local carry consumption. |
| `EscalationGameEscrow.sol` | Forked escrow records, vault export cursors, batch export bounds, and child REP accounting. |
| `EscalationGameSettlement.sol` | Claim, withdraw, proof-backed settlement, residual sweeping, and public deposit pagination. |
| `EscalationGame.sol` | Start/resume entrypoints and local deposit intake from `SecurityPool`. |

This order matters because storage remains inherited from `EscalationGameState`. Future modules should be appended through inheritance only when they need the full state surface. Helpers that do not need storage should stay as free functions, libraries, or tests. `EscalationGameProofs` is the template for that boundary: it computes roots and proof-derived values, but it does not advance nullifiers, mark deposits consumed, or mutate accounting totals.

## Accounting invariants

The state counters are the primary local invariants:

- `totalEscrowedRep` is the sum of active REP locks owned by all vaults in this game.
- `escrowedRepByVault[vault]` is the vault-local component of that total.
- `totalLocalUnresolvedRep` is the sum of unresolved local deposits that were placed directly in this game.
- `unresolvedRepByVault[vault]` is the vault-local component of `totalLocalUnresolvedRep`.
- For each outcome, `currentCarryTotal == inheritedUnresolvedTotal + localUnresolvedTotal`.
- A local deposit is active while `Deposit.amount > 0`. Settlement, claim, or export must zero the amount, mark the stable parent deposit index consumed, reduce the local unresolved totals, and update the current carry snapshot.
- Inherited proof settlement consumes `inheritedUnresolvedTotal` first, then local unresolved total only for the remaining amount.
- Forked escrow settlement releases child REP proportionally against source principal, and the claimed counters must never exceed the recorded principal or child REP.

The scenario tests assert these invariants in the paths that historically carried the most risk: consumed local carry leaves and bounded unresolved-vault export. `escalationGameInterfaceRegression.test.ts` also snapshots the inherited storage layout so refactors do not silently move live state slots.

## Interface changes

The public ABI snapshot lives at `solidity/ts/tests/fixtures/escalationGameAbi.snapshot`. If a public function, event, error, or tuple shape changes intentionally, refresh it with:

```bash
bun run update:escalation-game-abi-snapshot
```

Review the fixture diff together with the Solidity change. Accidental ABI drift should be fixed in Solidity instead of updating the snapshot.

The bytecode snapshot lives at `solidity/ts/tests/fixtures/escalationGameBytecode.snapshot.json`. If executable runtime bytecode changes intentionally, refresh it with:

```bash
bun run update:escalation-game-bytecode-snapshot
```

Review that diff together with the Solidity change. The snapshot strips Solidity metadata before hashing runtime bytecode, so comment-only or metadata-only changes should not require updating the runtime hash.

## Deployment and bytecode

The split is source-only, so `EscalationGame` still deploys as one contract. The current compiled artifact measures:

- creation bytecode: `23,649` bytes
- deployed bytecode: `23,184` bytes
- EIP-170 deployed bytecode headroom: `1,392` bytes below `24,576`

Any Solidity change can alter deterministic deployment addresses because address derivation uses init code. After contract changes, regenerate and review deployment outputs with the normal artifact workflow and keep `docs/mainnet-deployment-addresses.json` plus `docs/mainnet-deployment-addresses.md` in sync when expected addresses change.

For gas-sensitive changes, run the scenario tests first, then `bun run gas-costs` when comparing deployment or settlement costs. Source extraction alone should not be treated as a gas optimization unless measured.

## Future extraction criteria

Prefer further extraction only when it removes an ownership boundary that is still too broad:

- Move math into a storage-free helper only if it can be tested independently and does not need `outcomeState` or `securityPool`.
- Move proof helpers only if the caller still owns nullifier advancement, consumed-index accounting, and escrow/carry total mutation.
- Do not split escrow or settlement into separate deployed contracts unless there is a concrete bytecode limit or upgradeability requirement. That would create new trust, approval, and accounting surfaces.
