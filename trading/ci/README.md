# Trading CI

Run `bun run ci` from `trading/` to execute the AMM's frozen dependency install, authoritative Zoltar artifact check, compiler, TypeScript checks, contract/SDK/UI tests, formatting check, standalone UI build, and dependency audit.

This entrypoint is project-local and does not modify or depend on the repository's existing CI workflow. A hosting provider may invoke it as an independent AMM check.
