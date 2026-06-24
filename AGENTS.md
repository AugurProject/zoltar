# Quality Assurance Guidelines

After completing the requested changes, choose validation based on the files and behavior touched by the task. Run each selected command separately, in the order below, and address issues before moving to the next selected check.

When a check is skipped, record the reason in the final response. A skip is appropriate only when the changed files cannot affect what that check validates.

## Validation Selection

Use the staged and unstaged diff, including untracked files intended for the PR, to decide which checks apply.

1. **TypeScript type checking**
   - Run TypeScript when any TypeScript source file changed (`.ts`, `.tsx`, `.mts`, or `.cts`), when TypeScript configuration changed, when package dependencies or scripts changed, when Solidity contracts or generated contract outputs changed, or when a change can affect generated TypeScript imports.
   - If none of the TypeScript run conditions above apply, do not run TypeScript solely for docs, `AGENTS.md`, `.codex/agents`, Markdown, or comment-only changes. State why it was skipped.
   - Default command:
   ```bash
   bun run tsc
   ```
   - **UI app-only exception**: If the change only affects UI application sources covered by `ui/tsconfig.json` (`ui/ts/**/*.ts` or `ui/ts/**/*.tsx`, excluding `ui/ts/tests`) and does not touch `solidity/`, `ui/build/**/*.mts`, `ui/dev-server.ts`, generated contract artifacts, or anything that depends on refreshed contract output, run:
      ```bash
      cd ui && bun x tsc --project tsconfig.json
      ```
      (Root `bun run tsc` is typecheck-only. UI JS emission for the live-reload watcher comes from `ui/tsconfig.json`.)
   - **UI scripts/tests exception**: If the change touches `ui/ts/tests`, `ui/build/**/*.mts`, `ui/dev-server.ts`, `ui/tsconfig.json`, package scripts, or mixed UI and non-UI TypeScript, run the full `bun run tsc`.
   - **Contract exception**: If contracts or generated contract outputs changed, run the full `bun run tsc`.

2. **Tests**
   - Run tests when behavior changed, when a bug was fixed, when tests or test helpers changed, when contracts changed, when package dependencies changed, or when tooling/config changes can affect runtime behavior.
   - For narrow changes, prefer the smallest meaningful targeted test command first. Run the full suite when changes touch contracts, shared behavior, cross-module contracts, package/dependency wiring, or broad app behavior.
   - For docs-only, instruction-only, formatting-only, `.codex/agents`-only, or other non-executable changes, do not run tests unless the change affects a test runner, generated output, or executable tooling. State why tests were skipped.
   - When the task is itself about tests, test fixtures, or test cleanup, do not require additional tests for the tests. Instead verify that the changed tests are meaningful and run the relevant test command.
   - Full test command when TypeScript was not selected in the same validation cycle:
     ```bash
     bun run test
     ```
   - When `bun run tsc` has already passed in the same validation cycle, run the test runner directly so TypeScript is not checked twice:
     ```bash
     bun run ensure-contract-artifacts && bun run check:shared-dependencies && bun run test:run -- --bail=1
     ```
   - If tests require Anvil and the `anvil` executable is missing, install it with:
     ```bash
     bun run install:anvil
     ```

3. **Code formatting**
   - Run formatting when changed files are covered by the formatter, including package files, Markdown in the configured paths, TypeScript, CSS, scripts, docs, UI files, or Solidity.
   - If only files outside the formatter scope changed, do not run the full formatter solely for those files. Use a file-appropriate validation instead, such as a TOML parse for `.codex/agents/*.toml`, and run `git diff --check`.
   - Default command:
   ```bash
   bun run format
   ```

4. **Biome check and lint scripts**
   - Run `bun run check` when changed files are in the configured Biome or custom-lint scope, including `AGENTS.md`, docs, scripts, TypeScript, CSS, package files, UI files, or Solidity formatting.
   - If only files outside that scope changed, skip `bun run check` and run a file-appropriate validation instead. Always run `git diff --check` before finalizing.
   - Default command:
   ```bash
   bun run check
   ```

5. **Dead code analysis**
   - Run knip when code imports/exports, test files, package scripts, package dependencies, config, TypeScript sources, or build entry points changed.
   - Skip knip for docs-only, `AGENTS.md`-only, `.codex/agents`-only, formatting-only, or other changes that cannot affect the unused-code graph. State why it was skipped.
   - Default command:
   ```bash
   bun run knip
   ```

6. **Generated artifact freshness**
   - Use `bun run check:generated-clean` only when validating artifact freshness for CI/release work or when generation scripts, contracts, shared build output, UI contract artifacts, or artifact policy changed.
   - Do not regenerate or commit generated outputs unless the task explicitly requires it or a required check fails because an expected generated artifact is missing.

## Autofix

You can automatically fix many issues with:

- **Knip autofix** (removes unused exports and files):
  ```bash
  bun run knip:fix
  ```
  Review changes carefully.

Repeat the relevant part of the validation cycle after each fix. If a fix expands the touched area, expand the validation scope accordingly.

**Final requirement**: Every selected check must pass with zero errors. Skipped checks must have a concrete scope-based reason.

## Final Review Gate

For file-changing tasks that are being prepared for a PR, after the selected checks above pass, fetch `origin/main` and check whether the branch is behind:

```bash
git fetch origin main:refs/remotes/origin/main
git rev-list --count HEAD..origin/main
```

If the count is `0`, record that the branch is current and do not merge or rerun checks solely for this gate. If the count is nonzero, merge the latest `main` into the branch and resolve any conflicts if they exist. Rerun the selected checks after merging `main`, and again after any conflict resolution or follow-up edits. If the merge changes the touched area, update the validation scope before rerunning checks. Skip this step for read-only analysis, exploratory answers, or when the user explicitly asks not to merge; state the reason in the final response.

As the final quality gate for any task that changes code, tests, configuration, or repo instructions, the main agent must spawn the project-scoped `reviewer` custom agent defined in `.codex/agents/reviewer.toml` and wait for it to complete before responding to the user. Start the reviewer from a clear task summary instead of relying on inherited conversation context.

The main agent must give the reviewer a structured request summary that includes:

- a brief verbatim excerpt or exact summary of the original user request
- acceptance criteria derived from the request
- intentional non-goals or exclusions
- implementation summary
- changed files or areas
- validation commands and results, including concrete scope-based reasons for skipped checks
- known risks, tradeoffs, or areas needing close attention

Send the reviewer a prompt with this shape:

```text
Use the project-scoped reviewer instructions from .codex/agents/reviewer.toml.

Original user request:
<brief verbatim excerpt or exact task summary>

Acceptance criteria:
- <requirement 1>
- <requirement 2>

Intentional non-goals / exclusions:
- <anything intentionally not implemented>

Implementation summary:
- <what changed and why>

Changed files / areas:
- <file or area list>

Validation:
- <command>: <passed/failed/skipped>
- <skip reason, if skipped>

Known risks or areas needing close attention:
- <risk, tradeoff, or "none known">

Review the current worktree diff against origin/main, including committed branch changes, staged changes, unstaged changes, and untracked files intended for the task. Review the stated acceptance criteria and whether the changed code is named clearly, readable, and easy to understand.
Do not modify files.
Return findings grouped by High, Medium, and Low.

Also include:
- Validation assessment
- Review limitations, or "None" if there are no limitations
- Worktree-diff quality score from 0 to 100 using the reviewer rubric
```

After the reviewer finishes, the main agent must read the full review and decide how to handle every finding:

- Fix all valid High, Medium, and Low issues before completing the task.
- If a finding is a non-issue, improve the code, tests, names, or local explanation so a future reviewer can understand why the concern does not apply without needing this conversation.
- If no High, Medium, or Low issues are found, the task may be marked complete.
- If any High, Medium, or Low issues are fixed, rerun the required checks and repeat the reviewer gate until no valid findings remain.

In the final response to the user, summarize the reviewer feedback received, report the score from each review pass, state which findings were addressed, note any findings considered non-issues and what readability or self-documenting improvements were made, and list the checks run after the final changes.

# Package Guidelines

- **Version pinning**: All dependency versions in `package.json` must be exact (no `^` or `~`). This ensures reproducible builds.

# Generated Artifact Policy

- Generated build outputs and protocol artifacts are intentionally untracked. Keep `/ui/js`, `/shared/js`, `/ui/vendor`, `/solidity/artifacts`, `/ui/ts/contractArtifact.ts`, and `/solidity/ts/types/contractArtifact.ts` out of source review.
- If a deployment workflow ever requires committing generated artifacts, update this policy in the same PR and add a freshness check that regenerates the artifacts and fails on a dirty tracked diff.
- The generated artifact freshness rule in Validation Selection is the source of truth for when to run artifact freshness checks.

# Code Style Guidelines

- **Immutable imported contracts**: Do not modify `solidity/contracts/peripherals/openOracle/OpenOracle.sol`, `solidity/contracts/peripherals/WETH9.sol`, or `solidity/contracts/peripherals/Multicall3.sol`. These contracts are treated as externally sourced/compatibility contracts; address warnings or integration issues in tooling, wrappers, tests, or documented exceptions instead.
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

- The UI supports a browser-local simulation harness behind the `?simulate=1` URL flag. Use `bun run ui:serve` and open `http://localhost:12345/?simulate=1` for walletless manual QA.
- Simulation mode is Tevm-backed, seeds QA accounts with ETH/WETH/REP, leaves the app contracts undeployed so the Deploy flow can be tested, and exposes developer-only controls in the yellow simulation banner.
- Supported simulation scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, and `simScenario=securitypoolx2`.
- Uniswap-backed REP pricing is intentionally disabled in simulation mode. Quote-dependent features should degrade gracefully rather than assuming mainnet liquidity exists.
- This is a TypeScript project. Do not inspect or work from `js/` files anywhere in the repository when there is a corresponding TypeScript source file.
- The project type-checks TypeScript before testing (`bun run tsc`). Generated JS or shared asset refreshes come from the setup/build scripts, not from `bun run tsc`.
- The `shared/js/` directory is generated build output from `shared/ts/`. Do not edit it manually. Regenerate it via `bun run shared:build` when a workflow explicitly requires refreshed generated output.
- Solidity contract artifacts are generated by `bun run compile-contracts`. This writes `solidity/artifacts/Contracts.json` and `solidity/ts/types/contractArtifact.ts`. From `solidity/`, `bun run setup` is sufficient to regenerate those Solidity-side artifacts.
- UI contract artifacts are generated by `bun run generate` or any script that includes it, such as `bun run ui:build`. This writes `ui/ts/contractArtifact.ts`.
- If a test or typecheck fails because `solidity/ts/types/contractArtifact.ts`, `solidity/artifacts/Contracts.json`, or `ui/ts/contractArtifact.ts` is missing, run `bun run generate`. If only the Solidity-side artifact files are needed, `bun run compile-contracts` is sufficient.
- The `ui/js/` tree is generated from `ui/ts/`. In particular, `ui/js/tests/` is generated from `ui/ts/tests/` via `cd ui && bun run build:tests`. Do not manually edit generated `ui/js/**` files, and do not regenerate them unless the user explicitly asks for generated-output updates.
- On a fresh checkout, use `bun install --frozen-lockfile && bun run setup` for the full local install. For UI-only work, `bun install --frozen-lockfile && bun run ui:build` is sufficient and will also regenerate `shared/js/` and `ui/ts/contractArtifact.ts`.
- Do not assume `bun run tsc` regenerates contract artifacts unless the script definition has been updated to do so. Root `bun run tsc` remains a pure typecheck. For UI-only changes that need emitted JS for the watcher, use `cd ui && bun x tsc --project tsconfig.json`.
- Never edit files directly in any `js/` directory. Changes may be overwritten by TypeScript compilation. Always use the corresponding `.ts` or `.tsx` source files.
