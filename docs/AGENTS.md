# Documentation instructions

## Define the page before editing it

Before changing a page, determine:

- its primary Diátaxis mode: tutorial, how-to, reference, or explanation;
- its intended reader;
- the single task or question it serves;
- what the reader is assumed to know on entry;
- what the reader should be able to do or understand on exit;
- explicit non-goals;
- the authoritative sources for claims made.

Every page has exactly one primary mode. Brief supporting material from another
mode is allowed only when necessary for continuity. Otherwise move it to its
canonical owner or link to it.

Do not perform a protocol-wide documentation coverage audit unless the task
explicitly requests one.

## Mode contracts

### Tutorial

Provide one reliable, concrete learning journey.

- Show the destination and an observable result early.
- Use small actions with visible results.
- Minimize explanation and choices.
- Link to explanation and reference instead of importing them.
- Do not turn the tutorial into a complete protocol tour.
- Use visuals, screenshots, diagrams, charts, what ever makes the document easier to understand

### How-to guide

Help a competent reader accomplish one real task.

- Start from the user's goal, not from a contract or feature inventory.
- Include only necessary prerequisites, actions, decisions, success checks, and task-specific recovery.
- Use direct imperative language.
- Do not add background teaching, architecture surveys, or general reference material for completeness.
- Use visuals, screenshots, diagrams, charts, what ever makes the document easier to understand

### Reference

Describe the machinery accurately and succinctly.

- Structure the page according to the product, interface, schema, or state machine being described.
- Prefer generated or code-derived content where practical.
- Use neutral, factual language.
- Include exact inputs, outputs, permissions, effects, events, errors, and invariants when they belong to the referenced interface.
- Do not include a tutorial, operational journey, or design essay.

### Explanation

Answer one bounded conceptual or “why” question.

- Establish the smallest useful mental model.
- Explain rationale, relationships, constraints, implications, and meaningful alternatives.
- Keep implementation detail only when it helps explain the concept.
- Do not enumerate every entrypoint, revert, parameter, or failure path.
- Link to reference for exact mechanics and to how-to guides for actions.

## Editing defaults

Use this remediation order:

1. delete;
2. move;
3. link;
4. rewrite;
5. add.

Do not preserve text solely because it already exists.

Do not relocate material from a deleted page unless the receiving page's reader
job independently requires it.

When existing prose is inadequate, edit or replace it. Do not append a second
explanation of the same concept.

One normative fact, formula, parameter table, worked example, or edge-case
catalog has one canonical owner. Other pages may use the shortest summary needed
for continuity and link to that owner.

Do not repeat information between:

- title and lede;
- prose and lists;
- prose and tables;
- prose and diagrams;
- diagrams and captions;
- main text and callouts;
- separate pages.

Do not add a diagram, widget, formula, example, parameter table, security
analysis, or edge-case catalog merely for completeness. Add it only when it is
the clearest way to fulfil the page's stated reader job.

After drafting, perform a deletion pass. Remove every sentence, section,
example, and visual element that does not advance the reader's task or bounded
question.

Stop when the reader's stated need is met and every claim made is accurate.
Protocol-wide completeness is not a page-level goal.

## Source authority

For implemented behavior, use this authority order:

1. contracts and executable code;
2. tests and generated artifacts;
3. current deployment/configuration data;
4. existing documentation.

Use `https://github.com/AugurProject/oracle-research` for design rationale, historical context, proposals, and open research. Do not silently present research proposals or assumptions as current implemented behavior.

Clearly distinguish:

- contract-enforced behavior;
- configurable behavior;
- model assumptions;
- design rationale;
- proposed or open research.

## Draft hygiene

Published HTML must not contain:

- claims explicitly known to be wrong;
- dead internal links;
- links to deleted pages;
- malformed HTML;
- unfinished sentences or list items.

## Validation

Validate:

- HTML and formatting;
- internal links and anchors;
- manifest and generated navigation freshness;
- absence of visible draft placeholders;
- interactive behavior and accessibility when applicable;
- implementation accuracy only for claims the page actually makes.

Do not create tests that freeze narrative wording, paragraph order or examples.
