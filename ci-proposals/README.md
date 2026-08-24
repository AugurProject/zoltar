# CI files awaiting relocation

These files intentionally live outside `.github` until a repository maintainer moves them.

- Move `workflows/coverage.yml` to `.github/workflows/coverage.yml`, replacing the existing scheduled-only workflow.
- Move `workflows/test-domains.yml` to `.github/workflows/test-domains.yml`.
- Move `workflows/browser-workflow.yml` and `workflows/coverage.yml` to `.github/workflows/` when those jobs are approved for activation.
- Move `workflows/test-stability.yml` to `.github/workflows/test-stability.yml` to collect nightly repeat-run evidence without retrying pull-request failures.
- Keep the existing root `tests`, `test-timings`, and infrastructure test step when first moving this proposal. This makes the initial move additive and preserves tests invoked through `version-deploy.yml`'s reusable `ci.yml` call.
- In a follow-up CI-owned change, make `ci.yml` call the moved test-domain workflow for `workflow_call`, pull-request, main-push, and tag paths. Only then remove the superseded root jobs and duplicated infrastructure test step after the required checks have been updated to the replacement job names.
- Direct and reusable executions use invocation-qualified concurrency groups, so a tag or main-push run cannot cancel the reusable run awaited by `ci.yml` or `version-deploy.yml`. When the CI-owned wiring follow-up is proven, remove the redundant direct triggers as part of that same change.
- Update the `Required` job to require the relocated test-domain workflow according to the repository's branch-protection policy.

The relocated test-domain workflow maintains separate timing histories, shards application and Solidity domains independently, and runs the critical mutation smoke tier. It intentionally duplicates the existing root tests until the CI-owned wiring follow-up is complete.
