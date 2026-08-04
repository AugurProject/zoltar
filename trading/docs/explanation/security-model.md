# Security model

The pair rejects foreign ShareTokens, INVALID, and noncanonical universe IDs in both single and batch callbacks. A reentrancy lock covers all reserve and LP mutations. Recipient callbacks can execute arbitrary code, so final reserves are read from authoritative balances after transfers. Recorded-balance deficits revert; valid donations synchronize upward.

The router recognizes pairs only through its immutable factory, opens callback state only around one expected pool/share token, and restores starting share balances. Its ETH receiver opens only around redemption from that pool. This prevents unsolicited callbacks and mixing forced ETH with exit proceeds.

Factory checks prevent a malicious pool from borrowing another question’s ShareToken or universe identity. CREATE2 plus one immutable fee gives one canonical pair per exact pool without privileged replacement.

Remaining risks include first-price choice, sandwiching, stale simulation, lifecycle races, recipient denial of ETH or ERC-1155 reception, core-contract bugs, and approval misuse. Slippage and deadlines bound execution but do not remove MEV. See `SECURITY.md` for reporting and assumptions.
