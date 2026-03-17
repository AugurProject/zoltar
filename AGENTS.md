# Testing Guidelines

Always run the appropriate tests after implementing a feature or fixing a bug to ensure correctness and prevent regressions.

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