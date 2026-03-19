# Quality Assurance Guidelines

After implementing any feature or fixing a bug, always run the following quality checks **separately and in order** until all issues are resolved:

## Check Commands

Run each command individually and address any issues before proceeding to the next:

1. **TypeScript type checking**:
   ```bash
   bun tsc
   ```

2. **Tests**: Run the relevant test suite (e.g., `bun run test-peripherals`, `bun run test-zoltar`, etc.)
   ```bash
   bun test
   ```

3. **Code formatting**:
   ```bash
   bun run format
   ```

4. **Linting**:
   ```bash
   bun run lint
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

- **ESLint autofix** (fixes style and some code issues):
  ```bash
  bun run lint --fix
  ```

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

Prettier and ESLint are configured to enforce these rules automatically. Run `bun run format` and `bun run lint` to format and check your code.

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

- **Run specific test suites relevant to your changes**: If you modified contracts in `contracts/peripherals/`, run `bun run test-peripherals`. For Zoltar changes, run `bun run test-zoltar`, etc.
- **Run the full test suite occasionally**: `bun test` runs all tests and catches cross-module issues.

## Commands

- `bun run test-peripherals` – runs peripherals tests
- `bun run test-zoltar` – runs zoltar tests
- `bun run test-escalation-game` – runs escalation game tests
- `bun run test-question-data` – runs question data tests
- `bun run test-auction` – runs auction tests
- `bun test` – runs all tests

## Notes

- The project compiles TypeScript sources to JavaScript before testing (`bun tsc`). This happens automatically via the test scripts.
- If you edit files directly in the `js/` directory, changes may be overwritten by TypeScript compilation. Always edit the corresponding `.ts` files in the `ts/` directory.
