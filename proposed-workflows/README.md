# Proposed CI workflow updates

The YAML files in this directory are inert reference copies. GitHub does not execute them as workflows. They preserve the benchmarked workflow changes for review by a maintainer who is authorized to modify `.github/workflows/`.

## What they change

- `ci.yml` restores TypeScript incremental state, runs TypeScript checks and the production UI build concurrently, and uses prepared generated state for repository checks.
- `ipfs-deploy.yml` removes a duplicate host-side production build and enables GitHub Actions BuildKit caching for the Docker build.

The companion package scripts, test-fixture splits, shard weights, and Docker layer changes remain in their normal source locations in this branch. The active workflow files under `.github/workflows/` are unchanged.

## Measured local effect

On the benchmark host, the complete warm local CI equivalent fell from 145.3 seconds to approximately 80.7 seconds. The component-comparable cold path fell from 305.1 seconds to approximately 186.4 seconds. The optimized concurrent test/check phase had a 63.82-second median across three samples.

Local timings do not predict hosted-runner duration exactly. They demonstrate the relative cost of repeated generation, sequential preflight work, and unbalanced simulation tests. Applying the inert workflow proposals requires separate authorization and hosted-CI validation.
