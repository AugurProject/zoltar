# Project Review Contract

This contract is the canonical handoff, severity, output, scoring, and closure policy for project-scoped review agents. `AGENTS.md` decides when a review is required; each agent prompt defines its specialty.

## Handoff

The parent agent must provide:

- original user request or exact task summary
- acceptance criteria
- intentional non-goals and exclusions
- implementation summary
- baseline ref or SHA and intended changed paths
- task-related untracked files
- known pre-existing or unrelated worktree changes
- validation commands and results, including scope-based skip reasons
- known risks or areas needing close attention

If an input is unavailable, the reviewer must continue with best effort and record the gap under `Review limitations` instead of guessing.

## Scope

Review the task change, not every difference that happens to be present in the worktree. Include committed branch changes since the supplied baseline, staged changes, unstaged changes, and explicitly identified task-related untracked files. Do not attribute unrelated user changes to the task.

Use the merge base of the supplied baseline and `HEAD` for committed branch scope. Inspect the staged and unstaged views when needed to understand partial changes. Discover and follow every `AGENTS.md` applicable to a changed path.

Findings must be supported by repository evidence. Put uncertainty, inaccessible dependencies, stale refs, and unverified assumptions in `Review limitations`, not in findings.

## Severity

- **High:** likely correctness, security, data-loss, broken-build, protocol, or missing-acceptance-criterion failure. The task cannot complete while valid High findings remain.
- **Medium:** concrete regression, failure-path, API/contract mismatch, meaningful validation gap, or maintainability problem likely to cause future defects. The task cannot complete while valid Medium findings remain.
- **Low:** bounded readability, naming, duplication, test-quality, or maintenance issue with a concrete fix and limited immediate risk. Low findings block completion only when they violate an acceptance criterion or create a concrete correctness or maintenance risk in the touched area.

Do not report speculative, preference-only, or style-only concerns. Do not lower severity merely because a fix is easy, or raise severity because a topic is complicated.

## Output

Start with findings grouped under `High`, `Medium`, and `Low`. Write `None` under an empty group. For each finding include:

- `path:line`
- severity
- concise problem statement
- why it matters for the request
- concrete suggested fix
- validation that would catch the issue

Then include:

- `Acceptance criteria assessment`
- `Validation assessment`
- `Review limitations`, or `None`
- `Review score: <0-100>` with a brief rationale

Specialized agents may require additional sections after findings. Keep the report concise and do not manufacture findings to meet a quota.

## Scoring

- **90-100:** no High or Medium findings, strong validation, and low residual risk
- **75-89:** no High or Medium findings, but Low findings or meaningful review/validation limitations remain
- **50-74:** one or more Medium findings or important validation gaps
- **25-49:** one or more High findings, missing requested behavior, or serious regression risk
- **0-24:** unsafe, unreviewable, or likely broken

## Closure

The parent agent must disposition every finding:

- Fix every valid High and Medium finding.
- Fix Low findings that violate acceptance criteria or create concrete risk in the touched area.
- For advisory Low findings, either improve the touched code or text when the change is clearly beneficial and in scope, or record why the item is deferred.
- For a non-issue, clarify names, tests, comments, or the review handoff only when the concern reveals real ambiguity. Do not make unrelated edits merely to silence a stochastic review.

Rerun affected validation and the relevant reviewer after material fixes. A task is review-clean when no valid High or Medium findings remain and every Low finding has an explicit disposition. If the same unsupported finding repeats with no new evidence, record it as a review limitation instead of creating an unbounded review loop.
