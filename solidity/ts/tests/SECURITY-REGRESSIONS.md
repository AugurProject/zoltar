# Security regression suite

`bun run test:security-regressions` runs the focused audit and security-regression tests while preserving their existing fixture imports and test identities. New tests that reproduce a security finding should use an `audit*.test.ts`, `securityRegression*.test.ts`, or `*.audit.test.ts` name so the suite includes them automatically.

General protocol behavior belongs in the owning Statoblast, Trading, REP, or OpenOracle suite rather than in this collection.
