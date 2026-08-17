# Security Pool Workflow Section Test Slices

Run every split workflow-section suite:

```bash
bun run test:security-pool-workflow
```

Run one workflow slice directly:

```bash
bun test --timeout 300000 ui/ts/tests/features/security-pools/workflow/stagedOperations.test.tsx
bun test --timeout 300000 ui/ts/tests/features/security-pools/workflow/forkWorkflowState.test.tsx
```

Use `useSecurityPoolWorkflowSectionTestDom().renderWorkflow(...)` for direct component renders. Use `renderLoadedPool(...)` when a test only needs a selected pool shell.
