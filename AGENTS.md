# Quality Assurance Guidelines

After implementing any feature or fixing a bug, always run the following quality checks **separately and in order** until all issues are resolved:

## Check Commands

Run each command individually and address any issues before proceeding to the next:

1. **TypeScript type checking**:
   ```bash
   bun tsc
   ```
   - **UI-only exception**: If the change only affects `ui/` and does not touch `solidity/`, generated contract artifacts, or anything that depends on refreshed contract output, run:
     ```bash
     bun x tsc --noEmit
     ```
   - **Contract exception**: If contracts or generated contract outputs changed, run the full `bun tsc`.

2. **Tests**: Run all tests
    ```bash
    bun test
    ```

3. **Code formatting**:
   ```bash
   bun run format
   ```

4. **Dead code analysis**:
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

**Final requirement**: The codebase must have **zero knip warnings** (no unused exports, no unused files, no configuration hints). All knip issues must be addressed.

# Package Guidelines

- **Version pinning**: All dependency versions in `package.json` must be exact (no `^` or `~`). This ensures reproducible builds.

# Code Style Guidelines

- **Indentation**: Use tabs (not spaces) for indentation. This is enforced by ESLint (`indent: ['error', 'tab']`).
- **Quotes**: Use single quotes (`'`) for strings. Double quotes are not allowed unless escaping is required.
- **Semicolons**: Do not use semicolons at the end of statements.
- **Template literals**: Always include a space inside `${}` (e.g., ``Hello, ${ name }!``).
- **Empty lines**: Do not have multiple consecutive empty lines (maximum 1).
- **Consecutive spaces**: Do not have multiple consecutive spaces within a line. This is enforced by ESLint (`no-multi-spaces`).
- **Non-null assertions**: Do not use the `!` operator. Instead, perform explicit undefined checks and throw an error if a value is unexpectedly undefined.
- **Type casts**: Avoid using `as` casts unless they are truly necessary. Prefer narrower helper functions, explicit runtime checks, better generic typing, or inferred types first.
- **Nullability**: Prefer `undefined` over `null` for absent optional values. Avoid introducing new `null` usage unless there is a strong external API reason.

Prettier is configured to enforce these rules automatically. Run `bun run format` to format your code.

# Testing Guidelines

Always run the appropriate tests after implementing a feature or fixing a bug to ensure correctness and prevent regressions.

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

## Key Principles

- **Always run the full test suite**: `bun test` runs all tests and catches cross-module issues.
  - **UI-only work**: When the change only affects `ui/`, you do not need to run `bun test`; the test suite here applies to Solidity and shared code paths, not UI-only edits.
- **Prefer the fast UI typecheck when eligible**: For `ui/`-only changes, use `bun x tsc --noEmit`. If `solidity/` or generated contract outputs changed, use the full `bun tsc`.

## Commands

- `bun test` – runs all tests

## Notes

- This is a TypeScript project. Do not inspect or work from `js/` files anywhere in the repository when there is a corresponding TypeScript source file.
- The project compiles TypeScript sources to JavaScript before testing (`bun tsc`). This happens automatically via the test scripts.
- The root `bun tsc` runs the full generation pipeline before type-checking. Use `bun x tsc --noEmit` only for `ui/`-only changes that do not require regenerated contract outputs.
- Never edit files directly in any `js/` directory. Changes may be overwritten by TypeScript compilation. Always use the corresponding `.ts` or `.tsx` source files.
