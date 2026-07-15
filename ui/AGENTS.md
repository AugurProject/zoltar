# UI Instructions

Root `../AGENTS.md` applies first. This file adds design, accessibility, interaction, and browser-QA requirements for changes under `ui/`.

## Design intent

The UI is a restrained operations interface: dark technical palette, balanced density, serious utility-first tone, strong scanability, low decorative chrome, and one coherent system across routes. Teach workflows visually so users can understand goals, progress, state, and consequences with minimal reading.

- Prefer hierarchy, alignment, rhythm, and semantic structure over visual effects.
- Keep routes structurally consistent without forcing every workflow into an identical layout.
- Do not introduce a page-specific visual language unless the user explicitly requests it.
- Treat route composition and state transitions as first-order UI behavior, not cosmetic cleanup.

## Visual explanation and progressive teaching

- Show state, sequence, and consequence before explaining them in prose. Prefer progress indicators, state maps, timelines, previews, diagrams, and compact before/after comparisons when they communicate the workflow more clearly.
- Use consistent semantic color, short badges, labeled icons, and shape to make status and available actions recognizable at a glance. Color or icons must not be the only cue.
- Borrow the clarity of a well-designed game: establish the immediate goal, reveal complexity in stages, preview the effect of an action, respond immediately, and make success unmistakable. Do not add points, rewards, fantasy language, or decorative game theming unless the product calls for it.
- Use motion to explain causality, progression, or a change of state. Keep animation brief, interruptible, free of avoidable layout shift, and paired with an equivalent reduced-motion presentation.
- Prefer progressive disclosure and detail on demand over paragraphs of instructions. Do not hide information required to make a safe decision exclusively in a tooltip, hover state, or animation.
- Keep icons familiar and labeled when their meaning could be ambiguous. Give icon-only controls accessible names.

## Route and surface structure

A normal top-level route should present:

1. Route intro or header
2. Context summary or status
3. View tabs when needed
4. Main work sections

Full-screen flows, callbacks, redirects, dialogs, and exceptional states may use another structure when their semantics require it. Preserve the shared shell, explain the exception in the implementation, and keep primary context visible.

Use three primary surface roles:

- `page surface`: route frame or page background
- `section surface`: default workflow or content wrapper
- `record surface`: a concrete entity such as a pool, report, question, vault, or result

Prefer spacing and dividers for simple grouping. Avoid decorative nesting and normally keep container depth to two levels inside a route section. Dialogs, popovers, tables, and semantically nested records may exceed that limit when the additional layer communicates real structure.

## Components and reuse

Inspect shared `ui/ts/components`, the relevant `ui/ts/features/*/components`, and the touched route before introducing a primitive or pattern.

- Reuse a component when its semantic role, behavior, and accessibility match the need.
- Adapt composition around the closest shared pattern when that preserves its meaning.
- Add or generalize a shared primitive when reuse would distort semantics or create brittle exceptions.
- Do not copy an existing one-off inconsistency into another route.
- `EntityCard` is for entity records and concrete result summaries, not generic page layout.
- `WorkflowSubsection` structures content inside a larger workflow and should not create a competing chrome system.
- Metric grids, headers, section blocks, fields, badges, and tabs should converge on shared patterns.

Keep cleanup bounded to the edited component, route, and directly shared primitive. Do not refactor unrelated routes solely to make a narrow change conform.

## Layout, type, and color

- Maintain high information throughput with clear spacing, headings, alignment, and dividers.
- Keep related data near the actions it unlocks and action placement stable across state changes.
- Avoid oversized empty panels and cramped control clusters.
- Use serif display type only for route or hero headings, mono for labels/addresses/hashes/numbers, and sans-serif for body copy and controls.
- Use semantic variables from `ui/css/tokens.css`; add a semantic token for a genuinely new role instead of a raw one-off color.
- Reserve stronger accent treatment for active, focused, or meaningful status states.
- Keep gradients, glow, shine, and overlays subtle and mostly page-level.

## Interaction and transaction states

- Active tabs and selected views must be immediately distinguishable.
- Keep disabled controls legible and explain why the primary expected action is unavailable.
- Disable a transaction action when known local state proves it will fail, using direct reasons such as `Insufficient balance`, `Switch to Ethereum mainnet`, or `Approval required`.
- Revalidate transaction prerequisites immediately before submission when wallet, network, allowance, balance, or contract state may have changed.
- Keep pending feedback inside the initiating button, keep the button disabled, and prevent duplicate submission until the action resolves.
- Loading states must not cause avoidable layout jumps.
- Use consistent empty, loading, success, warning, and error grammar.
- Keep important state visible without hover and preserve action placement while content changes state.

## Accessibility

- Use native semantic elements before ARIA and give every control an accessible name.
- Support keyboard operation with a logical focus order and clearly visible focus state.
- Tabs, dialogs, menus, and disclosure controls must expose the correct semantic state and keyboard behavior.
- Associate validation and transaction errors with the relevant control; announce important pending, success, and failure updates through an appropriate live region.
- Do not communicate status, selection, or errors through color alone.
- Preserve readable contrast for text, controls, disabled states, focus indicators, and status surfaces.
- Respect reduced-motion preferences and avoid motion that is required to understand state.
- Keep touch targets usable on narrow screens and do not hide required actions behind hover-only interaction.

## Copy

- Use as little text as the user needs to act safely and confidently. Favor short labels, a direct action, and at most a one-line reason when visual structure already explains the rest.
- Use concise operational language led by the managed object or action.
- Use one term for one concept across routes.
- Prefer direct verbs for actions and direct nouns for labels.
- Avoid novelty copy when standard operational wording is clearer.
- Do not use paragraphs, repeated helper text, or tooltips to compensate for weak hierarchy or unclear state; improve the visual explanation first.

## Responsive behavior

- Preserve semantic section order between desktop and mobile.
- Keep tabs and primary actions usable on narrow screens.
- Prevent addresses, hashes, and numeric values from overflowing.
- Wrap dense data gracefully; use horizontal scrolling only when preserving column relationships requires it.
- Collapse columns without separating actions from their context.

## Validation checklist

For relevant UI changes, verify:

- route hierarchy and surface roles
- component reuse without semantic distortion
- visual explanation of goals, progress, state, and consequences with minimal copy
- meaningful use of color, badges, labeled icons, previews, and motion where they improve comprehension
- keyboard operation, focus, accessible names, and non-color status cues
- empty, loading, disabled, pending, success, and error states
- transaction prerequisite and duplicate-submission guards
- desktop and narrow/mobile layouts
- long values and dense data
- no edits to generated `ui/js/**`

Use the browser-local simulation harness described in root `AGENTS.md`. Record the tested scenario, viewport classes, and states in the final response. If browser QA is skipped, give a concrete reason the changed files cannot affect rendered or interactive behavior.
