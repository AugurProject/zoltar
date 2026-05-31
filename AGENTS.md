# Quality Assurance Guidelines

After completing all the requested code changes for given tasks, run the following quality checks **separately and in order** before finalizing:

## Check Commands

Run each command individually and address any issues before proceeding to the next:

1. **TypeScript type checking**:
   ```bash
   bun run tsc
   ```
   - **UI-only exception**: If the change only affects `ui/` and does not touch `solidity/`, generated contract artifacts, or anything that depends on refreshed contract output, run:
      ```bash
      cd ui && bun x tsc --project tsconfig.json
      ```
      (Root `bun run tsc` is typecheck-only. UI JS emission for the live-reload watcher comes from `ui/tsconfig.json`.)
   - **Contract exception**: If contracts or generated contract outputs changed, run the full `bun run tsc`.

2. **Tests**: Run all tests
    ```bash
    bun run test
    ```
   - If tests require Anvil and the `anvil` executable is missing, install it with:
     ```bash
     bun run install:anvil
     ```

3. **Code formatting**:
   ```bash
   bun run format
   ```

4. **Biome check**:
   ```bash
   bun run check
   ```

5. **Dead code analysis**:
   ```bash
   bun run knip
   ```

## Autofix

You can automatically fix many issues with:

- **Knip autofix** (removes unused exports and files):
  ```bash
  bun run knip:fix
  ```
  Review changes carefully.

Repeat the cycle iteratively after each fix to ensure clean builds and avoid accumulating issues.

**Final requirement**: The codebase must have zero knip warnings, zero test failures and zero typescript errors.

**Last step**: After the task PR is ready, merge the latest `main` into the branch and resolve any conflicts if they exist.

## Coverage Requirements

After completing each task, agents should also run coverage analysis before finalizing:

1. UI TypeScript coverage:
   ```bash
   bun run coverage:ui
   ```

2. Solidity TypeScript coverage:
   ```bash
   bun run coverage:contracts:ts
   ```

3. Solidity bytecode coverage:
   ```bash
   bun run coverage:contracts:bytecode
   ```

4. Optional unified run (runs all three domains):
   ```bash
   bun run coverage
   ```

Coverage should be kept at 100% for covered domains. Any reductions should be resolved before finalizing the task.

# Package Guidelines

- **Version pinning**: All dependency versions in `package.json` must be exact (no `^` or `~`). This ensures reproducible builds.

# Code Style Guidelines

- **Quotes**: Use single quotes (`'`) for strings. Double quotes are not allowed unless escaping is required.
- **Semicolons**: Do not use semicolons at the end of statements.
- **Empty lines**: Do not have multiple consecutive empty lines (maximum 1).
- **Non-null assertions**: Do not use the `!` operator. Instead, perform explicit undefined checks and throw an error if a value is unexpectedly undefined.
- **Type casts**: Avoid using `as` casts unless they are truly necessary. Prefer narrower helper functions, explicit runtime checks, better generic typing, or inferred types first.
- **Nullability**: Prefer `undefined` over `null` for absent optional values. Avoid introducing new `null` usage unless there is a strong external API reason.

Biome is configured to enforce these rules automatically. Run `bun run format` to format your code and `bun run check` to validate it.

# Testing Guidelines

## Bug Fix Process

When a bug is found in Solidity code:

1. **Write a failing test**: First, create a test case that reproduces the bug and demonstrates the incorrect behavior. This test should fail before any fix is applied.
2. **Verify the failure**: Run the test to confirm it fails as expected.
3. **Implement the fix**: Address the root cause in the Solidity code.
4. **Make the test pass**: Run the test again to verify the fix resolves the issue.
5. **Run the full test suite**: Ensure your fix doesn't introduce regressions elsewhere.

This test-driven approach ensures:
- The bug is properly documented and prevented from recurring
- The fix is validated automatically
- Regression testing is built into the process

## Notes

- - The UI supports a browser-local simulation harness behind the `?simulate=1` URL flag. Use `bun run ui:serve` and open `http://localhost:12345/?simulate=1` for walletless manual QA.
- - Simulation mode is Tevm-backed, seeds QA accounts with ETH/WETH/REP, leaves the app contracts undeployed so the Deploy flow can be tested, and exposes developer-only controls in the yellow simulation banner.
- - Supported simulation scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, and `simScenario=securitypoolx2`.
- - Uniswap-backed REP pricing is intentionally disabled in simulation mode. Quote-dependent features should degrade gracefully rather than assuming mainnet liquidity exists.
- - This is a TypeScript project. Do not inspect or work from `js/` files anywhere in the repository when there is a corresponding TypeScript source file.
- - The project type-checks TypeScript before testing (`bun run tsc`). Generated JS or shared asset refreshes come from the setup/build scripts, not from `bun run tsc`.
- - The `shared/js/` directory is generated build output from `shared/ts/`. Do not edit it manually. Regenerate it via `bun run shared:build` when a workflow explicitly requires refreshed generated output.
- - Solidity contract artifacts are generated by `bun run compile-contracts`. This writes `solidity/artifacts/Contracts.json` and `solidity/ts/types/contractArtifact.ts`. From `solidity/`, `bun run setup` is sufficient to regenerate those Solidity-side artifacts.
- - UI contract artifacts are generated by `bun run generate` or any script that includes it, such as `bun run ui:build`. This writes `ui/ts/contractArtifact.ts`.
- - If a test or typecheck fails because `solidity/ts/types/contractArtifact.ts`, `solidity/artifacts/Contracts.json`, or `ui/ts/contractArtifact.ts` is missing, run `bun run generate`. If only the Solidity-side artifact files are needed, `bun run compile-contracts` is sufficient.
- - The `ui/js/` tree is generated from `ui/ts/`. In particular, `ui/js/tests/` is generated from `ui/ts/tests/` via `cd ui && bun run build:tests`. Do not manually edit generated `ui/js/**` files, and do not regenerate them unless the user explicitly asks for generated-output updates.
- - On a fresh checkout, use `bun install --frozen-lockfile && bun run setup` for the full local install. For UI-only work, `bun install --frozen-lockfile && bun run ui:build` is sufficient and will also regenerate `shared/js/` and `ui/ts/contractArtifact.ts`.
- - Do not assume `bun run tsc` regenerates contract artifacts unless the script definition has been updated to do so. Root `bun run tsc` remains a pure typecheck. For UI-only changes that need emitted JS for the watcher, use `cd ui && bun x tsc --project tsconfig.json`.
- - Never edit files directly in any `js/` directory. Changes may be overwritten by TypeScript compilation. Always use the corresponding `.ts` or `.tsx` source files.
