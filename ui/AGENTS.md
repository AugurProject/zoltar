# UI AGENTS

> See `../AGENTS.md` for repo-wide engineering, testing, formatting, and generated-file rules. Those instructions take precedence. This file adds UI-specific design and composition rules for anything under `ui/`.

## Scope

This file governs visual design and UI composition inside `ui/`. It is intentionally stricter than a normal style guide. Follow it when editing layout, styling, copy structure, interaction states, or component composition.

Do not treat this as optional guidance. If a UI change conflicts with this file, revise the UI change unless the user explicitly asks for an exception.

## Design Intent

The UI is a restrained operations interface with these qualities:

- dark technical palette
- balanced density
- serious utility-first tone
- strong scanability
- fewer decorative containers
- one coherent visual system across all routes

The design system is structurally consistent as well as visually consistent:

- Routes share the same scaffolding.
- Surface hierarchy is consistent from screen to screen.
- Containers are used for semantic structure, not for decoration.
- Repeated nested-card patterns are avoided unless they map to a real record hierarchy.

## Non-Negotiable Principles

- Prefer restraint over decoration.
- Prefer hierarchy over visual effects.
- Prefer alignment and rhythm over extra chrome.
- Preserve scanability for dense operational content.
- Use one consistent section grammar across routes.
- Keep the UI serious and utility-first. Do not introduce playful or novelty styling.
- Do not introduce a new visual language for a single page unless the user explicitly asks for it.
- Judge UI changes at the route-composition level, not just per component.

## Route-Level Structure

Every top-level route should follow this order:

1. Route intro or header
2. Context summary or status strip
3. View tabs if applicable
4. Main work sections

Rules:

- Do not start a route with unexplained subtabs.
- Do not let one route feel like a separate product from the others.
- Do not copy `Deploy` literally. Preserve its restraint, scanability, and low-chrome feel.
- Use route-level headings to explain what the screen manages before showing detailed controls.
- Keep 404 and other exceptional states inside the same overall route grammar, even if they get a stronger hero treatment.

## Surface Hierarchy

Use only these visual layers:

- `page surface`: the route frame or page-level background treatment
- `section surface`: the default wrapper for content blocks and workflows
- `record surface`: concrete entities such as pools, reports, questions, vaults, or result records

Rules:

- Section surfaces are the default content wrapper.
- Record surfaces are for actual entities, not for every block of copy or every set of controls.
- Do not stack multiple decorative surfaces without a clear semantic reason.
- Cap visual nesting depth at two container levels inside a route section.
- If a layout only needs grouping, use spacing and dividers before adding another surface.

## Component Role Rules

Use available primitives according to role, not convenience.

- `EntityCard` is for entity records and concrete result summaries.
- Do not use `EntityCard` as the default page-layout box.
- `WorkflowSubsection` should structure content inside a larger section.
- Do not let `WorkflowSubsection` create a competing visual system with its own heavier chrome.
- Metric grids should converge toward one shared pattern instead of multiplying route-specific variants.
- Route headers, section blocks, and shared data grids define the preferred component architecture.

Implementation rule:

- If a dedicated shared primitive does not exist, emulate the same role with the closest existing component and CSS pattern.
- Before adding a new wrapper or class pattern, check whether an existing surface, badge, metric, or tab pattern already expresses that role.
- New component structure should reinforce this surface model instead of creating a parallel one.

## Layout and Density Rules

Target balanced density.

- Keep enough breathing room between major sections to make scan paths obvious.
- Do not create oversized empty panels with minimal content.
- Do not create cramped inline control clusters without clear grouping.
- Maintain high information throughput, but clarify grouping with spacing, headings, and dividers.
- Align actions consistently within a section.
- Keep related summary data visually near the actions it unlocks.
- Use vertical rhythm to separate tasks before introducing extra borders or shadows.

## Typography Rules

- Use serif display type only for route-level or hero-level headings.
- Use mono for labels, badges, addresses, hashes, and numeric values.
- Use sans-serif for body copy and controls.
- Do not mix type treatments arbitrarily inside one section.
- Keep headings short and structurally meaningful.
- Reuse the same heading level and tone for the same kind of content across routes.

## Color and Token Rules

- Use semantic CSS variables from `ui/css/index.css`.
- Do not introduce raw one-off colors when an existing token can represent the role.
- If a new visual role is genuinely needed, add or rename a semantic token instead of hardcoding a new color inline.
- Reserve stronger accent treatment for active state, focus state, or meaningful status.
- Keep glow, gradients, and overlays subtle and mostly page-level.
- Do not repeat decorative gradients or shine effects on every container.
- Solve hierarchy with spacing, borders, type, and alignment before adding more color.

## Interaction and State Rules

- Active tabs and selected views must be obvious at a glance.
- Disabled states must remain legible while clearly unavailable.
- If the UI can already determine that clicking a transaction action would send a failing transaction, disable the action instead of letting the user attempt it.
- If a disabled transaction action is the main action the user is expected to take next, show the reason clearly. Use direct operational language such as `Insufficient balance`, `Switch to Ethereum mainnet`, or `Approval required`.
- Loading states should not create layout jumps.
- Success, warning, and error states should use consistent semantic patterns.
- Empty states should use one grammar: status, explanation, and next action.
- Status UI should communicate meaning, not just add visual noise.
- Keep action placement stable when a section changes between empty, loading, and loaded states.
- Do not hide important state behind hover-only styling.
- When a user clicks a button to send a transaction, keep the loading spinner inside that button while the transaction is pending.
- While a transaction button is showing its loading state, keep that button disabled until the pending action resolves.

## Content and Copy Structure

- Use concise operational language.
- Lead with the object or action being managed.
- Keep labels predictable and reusable across routes.
- Use the same term for the same concept everywhere.
- Avoid page-specific novelty copy when standard operational copy works.
- Prefer direct verbs for actions and direct nouns for data labels.
- Do not let copy structure compensate for weak layout structure.

## Responsive Rules

- Desktop and mobile must preserve the same section order.
- Tabs must remain usable on narrow screens.
- Long addresses, hashes, and numeric values must not overflow their containers.
- Dense data should wrap gracefully instead of forcing unnecessary horizontal scrolling.
- Collapse multi-column layouts to single-column layouts without changing the meaning or order of sections.
- Preserve clear action placement on mobile. Do not let primary actions drift far from their context.

## Anti-Patterns

Do not:

- introduce a new one-off panel style for a single route
- add extra nested cards just to create separation
- use `EntityCard` as the default wrapper for every block
- start routes with unexplained subtabs
- create a new metric-grid variant when an existing pattern can be reused
- add more decorative gradients, shine overlays, or chrome to solve hierarchy problems
- make non-Deploy routes visually louder than Deploy
- leave a transaction-sending action enabled when known local state already proves it will fail
- move transaction-loading feedback away from the button that initiated the action
- edit generated `ui/js/**` files
- copy a one-off or inconsistent pattern into a new screen without a clear design reason

## Application Rules

- UI work must make the touched area conform to the design contract in this file.
- When two existing patterns conflict, choose the one that best matches the rules in this file.
- Remove unnecessary nesting before adding new styling.
- Treat route-composition issues as first-order UI issues, not as cosmetic cleanup.
- Reuse established roles and patterns before inventing a new one.

## Review Checklist

Before finalizing a UI change, check:

- Does this route follow the shared route rhythm?
- Did I use the right surface level for each block?
- Did I avoid unnecessary nesting?
- Are tabs and active states obvious?
- Are empty, loading, success, warning, and error states consistent?
- Are transaction actions disabled when known prerequisites fail?
- If the primary transaction action is disabled, is the reason visible and specific?
- Does a pending transaction show its spinner inside the button that initiated it?
- Does the change conform to the target system defined in this file?
- Did I reuse existing patterns before inventing new ones?
- Did I avoid touching generated `ui/js/**` output?
