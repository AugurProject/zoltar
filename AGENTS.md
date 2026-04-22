# Quality Assurance Guidelines

After completing all the requested code changes for given tasks, run the following quality checks **separately and in order** before finalizing:

## Check Commands

Run each command individually and address any issues before proceeding to the next:

1. **TypeScript type checking**:
   ```bash
   bun tsc
   ```
   - **UI-only exception**: If the change only affects `ui/` and does not touch `solidity/`, generated contract artifacts, or anything that depends on refreshed contract output, run:
      ```bash
      bun x tsc
      ```
      (We emit JS even for UI-only changes so the live-reload watcher notices the rebuild.)
   - **Contract exception**: If contracts or generated contract outputs changed, run the full `bun tsc`.

2. **Tests**: Run all tests
    ```bash
    bun test
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

- - This is a TypeScript project. Do not inspect or work from `js/` files anywhere in the repository when there is a corresponding TypeScript source file.
- - The project compiles TypeScript sources to JavaScript before testing (`bun tsc`). This happens automatically via the test scripts.
- - The `shared/js/` directory is generated build output from `shared/ts/` and must not be committed. Build it via `bun run shared:build` or by using the existing top-level setup/build scripts, which now run that step for you.
- - On a fresh checkout, use `bun install --frozen-lockfile && bun run setup` for the full local install. For UI-only work, `bun install --frozen-lockfile && bun run ui:build` is sufficient and will also regenerate `shared/js/`.
- - The root `bun tsc` runs the full generation pipeline before type-checking. UI-only changes still need to emit JS so the watcher reloads correctly; use `bun x tsc` instead of `--noEmit`.
- - Never edit files directly in any `js/` directory. Changes may be overwritten by TypeScript compilation. Always use the corresponding `.ts` or `.tsx` source files.
