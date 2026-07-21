# Repository Instructions

## Scope and startup

These instructions apply repository-wide. Nested `AGENTS.md` files add or override guidance for their subtree.

Do not install dependencies for read-only inspection, planning, or prose review. Before running Bun-based commands or changing executable files, check root dependencies:

```bash
test -d node_modules
```

If missing, install exactly from the lockfile:

```bash
bun install --frozen-lockfile
```

On a fresh checkout, use `bun install --frozen-lockfile && bun run setup` for a complete environment. For UI-only executable work, `bun install --frozen-lockfile && bun run ui:build` is sufficient.

## Working boundaries

- Preserve unrelated staged, unstaged, and untracked user changes. Do not rewrite or remove them to simplify the task.
- Treat TypeScript as source. Never inspect or edit a generated `js/` file when a corresponding TypeScript source exists.
- Never edit `ui/js/**` or `shared/js/**` directly.
- Do not modify imported compatibility contracts:
  - `solidity/contracts/peripherals/openOracle/OpenOracle.sol`
  - `solidity/contracts/peripherals/WETH9.sol`
  - `solidity/contracts/peripherals/Multicall3.sol`
- The protocol is not live. Do not preserve legacy ABIs, accessors, events, names, or compatibility shims solely for prior development deployments. Keep compatibility only for a current consumer, test, deployment script, or documented launch requirement.
- Pin every `package.json` dependency to an exact version without `^` or `~`.

## Task change set

Use the whole task change set when choosing validation and preparing review:

- committed branch changes since the merge base with `origin/main`
- staged changes
- unstaged changes
- task-related untracked files

`scripts/changed-files.mts` is the canonical implementation for this calculation. Keep a separate note of pre-existing or unrelated worktree changes so validation and reviewers do not attribute them to the task.

## Validation

After implementation, select checks from the behavior and complete task change set. Run selected commands separately in the order below and fix failures before continuing. Always run `git diff --check` last. In the final response, list selected checks and concrete scope-based reasons for every skipped category.

### 1. TypeScript

Run `bun run tsc` when any of these change:

- `.ts`, `.tsx`, `.mts`, or `.cts` sources outside the UI app-only exception
- TypeScript configuration
- package dependencies or scripts
- Solidity contracts or generated contract outputs
- anything that can change generated TypeScript imports

UI app-only exception: when changes are limited to `ui/ts/**/*.ts` or `ui/ts/**/*.tsx`, excluding `ui/ts/tests`, and do not touch contracts, `ui/build`, `ui/dev-server.ts`, generated artifacts, or consumers of refreshed contract output, run:

```bash
cd ui && bun x tsc --project tsconfig.json
```

Use full `bun run tsc` for UI tests, UI build scripts, `ui/dev-server.ts`, `ui/tsconfig.json`, package scripts, mixed UI/non-UI TypeScript, contracts, or generated contract output.

Skip TypeScript for prose-only, instruction-only, `.codex/agents`-only, formatting-only, or comment-only changes that cannot affect generated imports or executable behavior.

### 2. Tests

Run tests for behavior changes, bug fixes, tests or helpers, contracts, dependency wiring, and executable tooling or configuration.

- Start with the smallest meaningful targeted test for a narrow change.
- Run the full suite for contracts, shared behavior, cross-module interfaces, package/dependency wiring, or broad behavior.
- If TypeScript has not already run, use `bun run test`; this command includes TypeScript transitively.
- If `bun run tsc` already passed in the same cycle, avoid repeating it:

```bash
bun run ensure-contract-artifacts && bun run check:shared-dependencies && bun run test:run -- --bail=1
```

If selected tests require Anvil and `anvil` is missing, run `bun run install:anvil`.

When the task changes tests themselves, running the relevant tests is sufficient; do not require a second layer of tests for those tests. Skip tests for non-executable documentation, instructions, formatting, and agent-prompt changes.

### 3. Formatting

Use the non-mutating check first:

```bash
bun run format:check
```

If it fails for intended task files, run `bun run format`, review every resulting change, and rerun the check. Do not retain formatter changes to unrelated user files.

Skip the repository formatter when every changed file is outside its configured scope. For `.codex/agents/*.toml`, use `bun run check:agents` instead.

### 4. Lint and repository checks

- Use `bun run check:changed` for ordinary scoped changes covered by Biome, UI string linting, or agent configuration validation.
- Use full `bun run check` for package scripts, lint/check scripts, docs tooling, Solidity, broad cross-project changes, or CI-parity validation. This broad command also runs documentation and generation-dependent checks.
- For files outside those scopes, run a file-appropriate check.

### 5. Dead code

Run `bun run knip` when imports, exports, tests, package scripts or dependencies, configuration, TypeScript, or build entry points change. Skip it for prose-only, instruction-only, `.codex/agents`-only, or formatting-only changes that cannot affect the unused-code graph.

### 6. Generated artifacts

Run `bun run check:generated-clean` only for CI/release freshness work or when contracts, generation scripts, shared build output, UI contract artifacts, or artifact policy change.

Generated outputs are intentionally untracked:

| Output | Source or command |
| --- | --- |
| `shared/js/**` | `bun run shared:build` |
| `solidity/artifacts/Contracts.json` | `bun run compile-contracts` |
| `solidity/ts/types/contractArtifact.ts` | `bun run compile-contracts` |
| `ui/ts/contractArtifact.ts` | `bun run generate` or `bun run ui:build` |
| `ui/js/**` | UI TypeScript build |
| `ui/vendor/**` | `bun run ui:vendor` |

Do not regenerate or commit these outputs unless the task requires them or a required check reports a missing expected artifact. If a deployment workflow ever needs tracked generated artifacts, update this policy and add a dirty-diff freshness check in the same change.

### 7. UI manual QA

For visual, responsive, routing, form, or transaction-state behavior, perform browser QA in addition to automated checks. Use `bun run ui:serve` and `http://localhost:12345/?simulate=1` for walletless testing.

Choose the smallest relevant scenario:

- `simScenario=baseline`
- `simScenario=deployed`
- `simScenario=security-pool`
- `simScenario=securitypoolx2`

Check the changed flow at desktop and narrow/mobile widths, including relevant empty, loading, disabled, pending, success, and failure states. Uniswap-backed REP pricing is intentionally unavailable in simulation; quote-dependent UI must degrade gracefully.

Capture current-state screenshots for the visual-review handoff. Normally use `1440x900` for desktop and `390x844` for narrow/mobile; record the exact dimensions and explain any different viewport. Include baseline or before screenshots when they are trustworthy and readily available, but do not manufacture a baseline for a new surface. Record the route, scenario, state, browser, screenshot path or evidence identifier, intentional differences, and any console or runtime errors. Do not commit QA screenshots unless the task explicitly requires tracked visual fixtures.

## Bug-fix process

For a deterministic executable bug:

1. Add or identify a focused regression test that reproduces the defect.
2. Run it and confirm the expected failure before changing the implementation.
3. Fix the root cause at the narrowest shared layer.
4. Rerun the focused test and relevant surrounding suite.
5. Run the full suite when contracts, shared behavior, or cross-module interfaces changed.

If a failing automated reproduction is impractical, document why and provide the strongest deterministic validation available. Solidity bugs require the failing-test-first process and the full test suite.

## Code style

Automated formatters and linters enforce only part of this policy. Review the remaining judgment-based rules explicitly.

- Use single quotes unless escaping requires double quotes.
- Omit statement-ending semicolons.
- Keep at most one consecutive empty line.
- Avoid non-null assertions; validate unexpected `undefined` and throw an understandable error.
- Do not use TypeScript directive comments such as `@ts-expect-error`, `@ts-ignore`, or `@ts-nocheck`.
- Avoid casts, especially double casts. Prefer inferred types, generic constraints, narrower APIs, or runtime validation.
- Prefer `undefined` for absence. Use `null` only when an external API or schema requires it.
- Prefer functions, plain data, pure transformations, and composition over classes.
- Do not use Solidity custom errors. Use understandable revert strings.

## Documentation

- Do not create standalone tests that only assert prose, tables, anchors, generated examples, or document structure.
- Validate documentation with direct scripts such as `bun run docs:check-html`, formatting/linting, or a targeted executable check.
- Runtime tests are appropriate for JavaScript embedded in documentation when that JavaScript has behavior.

## Branch-current gate

For a file-changing task explicitly being prepared for a PR, after validation run:

```bash
git fetch origin main:refs/remotes/origin/main
git rev-list --count HEAD..origin/main
```

If the count is `0`, record that the branch is current. If it is nonzero, merge `origin/main` only when the user explicitly requested branch synchronization or a PR-ready result; otherwise report the behind count and ask before merging. After a merge or conflict resolution, recalculate scope and rerun all applicable checks.

Skip this gate for read-only analysis, exploration, or when the user asks not to fetch or merge.

## Pull requests

When creating a pull request:

- Write a pull request description that explains what changed and why.
- For UI changes, include images that show the resulting UI. Do not commit these images to the repository; upload them to GitHub or Sharey and embed them in the pull request description instead. When using Sharey, select the longest practical expiry.

## Review gates

`.codex/review-contract.md` is the canonical review handoff, severity, output, scoring, and closure policy.

Apply the review-context isolation rule in `.codex/review-contract.md` to every required reviewer.

### Visual reviewer

For every task that can affect rendered UI or rendered documentation, spawn the project-scoped reviewer from `.codex/agents/visualReview.toml` after browser QA and any documentation review, and before the final reviewer. This includes changes to styles, rendered components, route or document composition, visible copy, icons, diagrams, assets, and shared visual primitives. Skip it only when the changed files cannot affect rendered appearance or interaction, and record the concrete reason in validation and the final response.

Supply the standard handoff plus every visual-review field required by the review contract. The reviewer must not modify files. Disposition every finding using the contract. After material visual fixes, repeat the relevant browser QA at the affected viewports and states, then rerun the visual reviewer. Completion requires no valid High or Medium visual findings and an explicit disposition for every Low visual finding.

### Final reviewer

For every task that changes code, tests, configuration, agent definitions, or repository instructions, the main agent must spawn the project-scoped reviewer from `.codex/agents/reviewer.toml` after validation, any branch synchronization, and any specialized review gates. Supply every handoff field required by the review contract, including the exact baseline and task paths, and summarize material specialized-review results. The reviewer must not modify files.

Disposition every finding using the contract. After material fixes, rerun affected checks and repeat the reviewer. Completion requires no valid High or Medium findings and an explicit disposition for every Low finding.

### Documentation reviewer

When documentation under `docs/` changes, spawn the project-scoped reviewer from `.codex/agents/textReview.toml` before the final reviewer. In addition to the standard handoff, list:

- changed documentation files
- Solidity contracts described, or `none`
- linked docs, tooltips, diagrams, examples, and shared references in the reading path

Ask it to assess story, flow, concept order, contract accuracy, MathML, notation, examples, and reader preparation. Disposition findings under the shared contract. Repeat the text review after material documentation fixes, then proceed to the visual reviewer when the documentation change can affect rendered appearance, followed by the final reviewer.

### Final response

Lead with the delivered result. Report:

- selected validation commands and results
- scope-based skip reasons
- final review score and material reviewer feedback
- visual-review evidence, score, and material feedback when the visual gate applied
- findings fixed or explicitly deferred under the contract
- branch-current status when the branch gate applied

Mention earlier review passes only when they produced material fixes; do not turn the user handoff into an internal process log.
