# Activate the CI updates

Move both staged workflow replacements into place, then commit and push:

```bash
mv workflow/ci.yml .github/workflows/ci.yml
mv workflow/browser-workflow.yml .github/workflows/browser-workflow.yml
```

The supporting package scripts and test changes are already in their final locations.

Browser coverage runs as four independent jobs: auction boot, pool recovery, reporting and migration, and deployment plus auction finalization. All four remain required. Deployment and auction finalization share a browser session to retain the lightweight setup that preceded the expensive auction fixture in the original test. They start as soon as the production UI artifact is available; Solidity tests and script/Solidity typechecks do not block their start. Formatting runs in the parallel checks job, and the redundant application typecheck and unused incremental cache are removed from preparation.

Running `bun run test:browser:workflow` locally still runs every scenario. Set `ZOLTAR_BROWSER_WORKFLOW_SCENARIO` to one of `auction-boot`, `pool-recovery`, `reporting-migration`, or `deployment-auction` to select just that scenario. A standalone dispatch builds the production UI once and shares it across the browser jobs.
