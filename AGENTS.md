# Quality Assurance Guidelines

After implementing any feature or fixing a bug, always run the following quality checks **in order** until all issues are resolved:

1. **TypeScript type checking**: `bun tsc`
2. **Tests**: Run the relevant test suite (e.g., `bun run test-peripherals`, `bun run test-zoltar`, etc.)
3. **Code formatting**: `bun run prettify`
4. **Linting**: `bun run lint`
 5. **Dead code analysis**: `bun run knip`
 
 **Autofix**: You can automatically fix many knip issues with `bun run knip:fix`. This will remove unused exports and files. Review changes carefully.

Repeat the cycle iteratively after each fix to ensure clean builds and avoid accumulating issues.

**Important**: The final state after the agent's work must have **zero knip warnings** (no unused exports, no unused files, no configuration hints). All suggested issues from knip must be addressed. The codebase should be production-clean with no dead code warnings.

# Package Guidelines

- **Version pinning**: All dependency versions in `package.json` must be exact (no `^` or `~`). This ensures reproducible builds.

# Code Style Guidelines

- **Indentation**: Use tabs (not spaces) for indentation. This is enforced by ESLint (`indent: ['error', 'tab']`).
- **Quotes**: Use single quotes (`'`) for strings. Double quotes are not allowed unless escaping is required.
- **Semicolons**: Do not use semicolons at the end of statements.
- **Template literals**: Always include a space inside `${}` (e.g., `\`Hello, \${ name }!\``).
- **Empty lines**: Do not have multiple consecutive empty lines (maximum 1).
- **Non-null assertions**: Do not use the `!` operator. Instead, perform explicit undefined checks and throw an error if a value is unexpectedly undefined.

Prettier and ESLint are configured to enforce these rules automatically. Run `bun run prettify` and `bun run lint` to format and check your code.

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
