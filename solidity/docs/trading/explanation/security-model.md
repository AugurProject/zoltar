# Security model

## Signature and callback authorization

V2 LP permits use the standard ERC-2612 nonce, deadline, chain-bound EIP-712 domain, owner, spender, and exact value. The local signature primitives are derived from OpenZeppelin Contracts 5.2.0; provenance and local adaptations are recorded beside `contracts/vendor/authorization/AuthorizationSignatures.sol`. A signature is authorization, not transaction privacy: integrations should use short deadlines and exact amounts. A Safe that does not produce an ECDSA permit uses the ordinary allowance fallback.

Receive-based ERC-1155 operations do not use an off-chain signature. The ShareToken call must be submitted by the owner, while the versioned payload binds all contract identities, operation inputs, recipients, slippage, and deadline. Copying an observed payload cannot redirect assets and cannot separately consume an allowance because the router requires `operator == from`.

The pair rejects foreign ShareTokens, INVALID, and noncanonical universe IDs in both single and batch callbacks. A reentrancy lock covers all reserve and LP mutations. Recipient callbacks can execute arbitrary code, so final reserves are read from authoritative balances after transfers. Recorded-balance deficits revert; valid donations synchronize upward.

The router recognizes pairs only through its immutable factory, opens callback state only around one expected pool/share token, and restores starting share balances. Its ETH receiver opens only around redemption from that pool. This prevents unsolicited callbacks and mixing forced ETH with exit proceeds.

Factory checks prevent a malicious pool from borrowing another question’s ShareToken or universe identity. CREATE2 plus one immutable fee gives one canonical pair per exact pool without privileged replacement.

Because an ERC-1155 transfer to an address without code cannot invoke a receiver callback, an attacker can send shares to a predicted CREATE2 address before deployment. Pair construction detects its canonical INVALID, YES, and NO balances and irrecoverably quarantines them in the factory’s ownerless sink. Initialization then starts with zero canonical balances, including zero INVALID. Foreign token contracts cannot be enumerated and may still assign irrelevant balances to the address; the pair never recognizes or moves them.

Remaining risks include first-price choice, sandwiching, stale simulation, lifecycle races, recipient denial of ETH or ERC-1155 reception, core-contract bugs, and approval misuse. Slippage and deadlines bound execution but do not remove MEV. See `SECURITY.md` for reporting and assumptions.
