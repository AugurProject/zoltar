# Security Pool Workflow Section Test Slices

Run every split workflow-section suite from the repository root:

```bash
bun run test:security-pool-workflow
```

Run one workflow slice with the same build step, runner, and UI preload:

```bash
bun run ensure-shared-build
bun ./tooling/testing/bun-test.mts --preload ./bun-test-setup-ui.ts ui/statoblast/ts/tests/features/security-pools/workflow/stagedOperations.test.tsx
```

Use `useSecurityPoolWorkflowSectionTestDom().renderWorkflow(...)` for direct component renders. Use `renderLoadedPool(...)` when a test only needs a selected pool shell.
