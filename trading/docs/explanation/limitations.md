# Limitations and non-goals

This MVP intentionally does not implement a three-way invariant, INVALID trading, an invalidity-probability oracle, weighted reserves, quadratic solvers, flash swaps, a protocol fee, governance controls, upgradeable proxies, automatic branch selection, automatic LP migration, an insured-position NFT, or per-user on-chain position accounting.

It also has no TWAP, routing across markets, guaranteed deep liquidity, or mechanism to withdraw more early ETH than complete-set insurance and reserves permit. The UI’s local demo states are visual fixtures, not live-chain evidence; live mode requires an explicit deployment manifest. Public deployments require an independently reviewed manifest, gas benchmarks against a real-core funded lifecycle fixture, adversarial integration testing, and an external audit.

Potential future work may add separate INVALID markets, safer oracle observations, routing, or bounded convenience flows. Those are distinct designs and must not weaken the invariant that this pair never accepts or holds INVALID.
