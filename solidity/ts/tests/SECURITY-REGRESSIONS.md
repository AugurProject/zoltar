# Security regression suite

From the repository root, `bun run test:security-regressions` runs the focused audit and security-regression tests while preserving their existing fixture imports and test identities. New tests that reproduce a security finding should use an `audit*.test.ts` or `securityRegression*.test.ts` name directly under `solidity/ts/tests` so the suite includes them automatically.

General protocol behavior belongs in the owning Statoblast, Trading, REP, or OpenOracle suite rather than in this collection.
