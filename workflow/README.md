# Pending CI optimization

These definitions are staged here because the PR author cannot update GitHub workflow files. The active `.github/` definitions remain unchanged until a maintainer moves the replacements.

Move all four files together from the repository root:

```bash
mv workflow/ci.yml .github/workflows/ci.yml
mv workflow/test-domains.yml .github/workflows/test-domains.yml
mv workflow/browser-workflow.yml .github/workflows/browser-workflow.yml
mv workflow/actions/setup-ci/action.yml .github/actions/setup-ci/action.yml
```

The supporting changes in `package.json` and `tooling/` are already in their final locations. Workflow tests read the staged definitions when present and automatically fall back to the active paths after the move. Remove this README after activation.

The new `build-inputs` job generates and publishes shared inputs once. Solidity shards, package checks, repository checks, documentation, and dead-code analysis consume those inputs; package checks no longer wait for the UI build. Application shards and browser jobs also reuse them. Full and contract-only jobs share a contract cache keyed by contract and shared-library inputs; UI and explorer outputs are cached separately. Transfers retain the shared freshness marker. The full test matrix and required gates remain in place.

After activation, compare cold-cache and warm-cache CI runs with the previous workflow. This PR validates the definitions and local artifact reuse; hosted runner timing improvements can only be measured once the replacements are active.
