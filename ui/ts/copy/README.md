# UI copy modules

User-facing text is grouped by the feature that owns its meaning. Consumers import a feature module as a namespace, such as `import * as marketCopy from '../copy/market.js'`, so call sites retain context without large named-import lists.

Use `common.ts` only when the same concept is shared across multiple features. Text that merely happens to be identical should remain feature-owned when the contexts may evolve independently.

## Naming

- Name exports for their UI role and meaning, not by repeating the English sentence: `securityMultiplierHelpText`, not `securityMultiplierSetsTheRepCollateralTarget...`.
- Keep export names at or below 48 characters. This is a guardrail, not a naming target; prefer the shortest role-based name that stays unambiguous within its feature namespace.
- Use role suffixes such as `Title`, `Label`, `Detail`, `HelpText`, `Status`, `Error`, `Placeholder`, `ActionHint`, and `AriaLabel` when they clarify where copy appears.
- Prefix interpolation functions with `format` and give every parameter a domain name. Use `CopyTemplateValue` only for values that are already safe to display.
- Prefer complete sentences and templates. Fragments are reserved for rich JSX that inserts formatted components between copy segments; name those fragments `Lead`, `Separator`, or `Tail`.

## Style

- Use sentence case for actions and prose. Preserve protocol names and established acronyms such as REP, ETH, WETH, and RPC.
- End prose descriptions and errors with punctuation. Labels and titles do not need terminal punctuation.
- Use the single ellipsis character (`…`) for pending text. Three periods are reserved for literal truncation examples such as `0x...`.
