# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Zoltar is a prediction market platform with forked universes. The repo is a monorepo split into two main packages:

- `solidity/` — Solidity contracts, TypeScript tests, and generated contract artifacts
- `ui/` — Preact frontend that talks directly to deployed contracts via viem

There is no separate backend. The smart contracts are the backend; the UI interacts with them through an injected Ethereum provider (MetaMask/wallet).

## Prerequisites

- Bun 1.3+
- Foundry `anvil` for local chain work (`bun run install:anvil`)

## Commands

### Setup

```bash
bun run setup           # Full bootstrap: deps, contracts, UI vendor, build
bun run generate        # Regenerate contract bindings and UI vendor assets
bun run compile-contracts  # Compile Solidity to JS + generate ABI bindings
```

### Development

```bash
bun run ui:serve        # Dev server
bun run ui:watch        # Watch and rebuild UI assets
```

### Quality Checks (run in order after changes)

```bash
bun tsc                 # Full TypeScript check (includes contract generation pipeline)
bun x tsc --noEmit      # UI-only typecheck (when only ui/ changed, no contract output needed)
bun test                # Run all tests (skip for ui/-only changes)
bun run format          # Format with Prettier + ESLint fixes
bun run knip            # Dead-code analysis (zero warnings required)
bun run knip:fix        # Auto-fix unused exports/files
```

### Other

```bash
bun run lint            # ESLint only
bun run gas-costs       # Measure Solidity gas costs
```

## Architecture

### Data Flow

```
User → Browser
  ↓
UI (Preact + @preact/signals in ui/ts/)
  ├── Components (ui/ts/components/)
  ├── Hooks (ui/ts/hooks/) — contract reads/writes
  └── viem for Ethereum interaction
      ↓
Injected Ethereum Provider (MetaMask)
      ↓
Deployed Smart Contracts (solidity/contracts/)
  ├── Zoltar.sol — main prediction market contract
  ├── ZoltarQuestionData.sol — question metadata
  ├── ReputationToken.sol — voting/rep system
  └── peripherals/ — escalation, security pools, auctions, factories
```

### Contract Architecture

- **Core**: `Zoltar.sol`, `ZoltarQuestionData.sol`, `ReputationToken.sol`, `ScalarOutcomes.sol`
- **Peripherals**: `EscalationGame.sol`, `SecurityPool.sol`, `SecurityPoolForker.sol`, `UniformPriceDualCapBatchAuction.sol`
- **Factories**: Under `peripherals/factories/` — deploy new instances of pools, tokens, etc.
- **Tokens**: `peripherals/tokens/` — ERC1155 and ShareToken implementations

### UI Architecture

- **State**: Preact Signals (`@preact/signals`) — no Redux or Context
- **Hooks**: Custom hooks in `ui/ts/hooks/` wrap contract interactions
- **Build**: TypeScript → `ui/js/` (compiled); dependencies vendored into `ui/vendor/` via import map in `index.html`
- **Routing**: URL state persistence handled in `ui/ts/`

### Build Pipeline

1. `solidity/ts/compile.ts` compiles Solidity → ABI + TypeScript bindings → `solidity/js/`
2. `bun tsc` compiles all TypeScript sources to `*/js/` directories
3. `ui/build/vendor.mts` bundles UI dependencies into `ui/vendor/`

## Key Constraints

### Never edit js/ directories

All `js/` directories contain compiled output. Always edit the corresponding `.ts`/`.tsx` source files. Changes to `js/` will be overwritten by compilation.

### Quality gate (zero tolerance)

The codebase must have **zero knip warnings** before merging. No unused exports, no unused files.

### Bug fix process for Solidity

1. Write a failing test first
2. Verify it fails
3. Implement the fix
4. Verify the test passes
5. Run full test suite (`bun test`)

## Code Style

Enforced by ESLint + Prettier (`bun run format`):

- **Tabs** for indentation (not spaces)
- **Single quotes** for strings
- **No semicolons**
- **Template literals**: space inside `${}` — e.g., `` `Hello, ${ name }!` ``
- **No non-null assertions** (`!`) — use explicit undefined checks instead
- **Avoid `as` casts** — prefer proper typing, runtime checks, or generics
- **Prefer `undefined` over `null`**
- **Exact versions** in package.json (no `^` or `~`)
- Maximum 1 consecutive empty line
