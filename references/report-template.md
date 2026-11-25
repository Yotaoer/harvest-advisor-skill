# Repository Comparison Report

Write in the user's language. Keep only rows the evidence supports; label
unverified entries instead of completing placeholders by guesswork.

## Scope and Revisions

- Goal; behaviors in and out of scope; assumptions and material constraints.
- Own repo and reference repo: alias, inspected revision or snapshot, relevant
  worktree state, and version limitations.
- Static coverage and limits: paths, symbols, configuration or environments
  inspected; gaps, confidence rationale, and the runtime verification status.

## Current Architecture and Key Flow

### Figure 1: Architecture Overview

Draw the two repos in separate lanes, aligned by responsibility. Show major
components, which responsibilities each owns, and their boundaries and
relationships. Add a text comparison of the structure; the table supports the
diagram but does not substitute for it when a diagram is supported.

| Responsibility or business step | Own repo: behavior, state, evidence | Reference repo: behavior, state, evidence | Difference / candidate |
| --- | --- | --- | --- |
| [Responsibility] | [Observed state; E-xx] | [Observed state; E-xx] | [Supported comparison; both sides' evidence; H-xx if relevant] |

### Figure 2: Key Flow Comparison

Draw one shared business behavior at step level, from entry through key calls
and state or data changes. Align equivalent steps across separate repo lanes.
Add a text walkthrough that explains where the flows differ.

Use a plain-text diagram if Mermaid is unavailable. For very small repos, use
one figure only if the two diagrams would completely repeat each other, and
label its architecture and flow layers separately. Draw only verified
portions and name missing responsibilities, steps, or relationships in text.
Put an evidence ID on each key node and edge; cite both sides for each
correspondence. Attach relevant `H-xx` IDs to nodes, edges, or comparison rows.

Legend (use distinct labels or line styles): **Calls** and **Data** are observed
in-repo relationships, **Corresponds** is a cross-repo responsibility match
only, and **Proposed** belongs in a separately labeled future view. Anchor
proposals to their supporting current-state evidence and candidate ID.

## Candidate Decisions

### H-xx: [Business outcome] (`adopt` / `adapt` / `reject` / `watch`)

- **Fact:** Own baseline [E-xx]; reference behavior [E-xx]; observed state,
  equivalent or planned work, and counterevidence.
- **Inference:** Transfer fit and uncertainties [both sides' E-xx]. Assess
  benefit, stack fit, maintenance cost, and architecture impact with the reason
  for each. Name anchors and units if using grades or numbers.
- **Recommendation:** Decision, direct code reuse / design reference only /
  status quo, and why it beats the alternatives or should be deferred.
- **Independent constraint:** Provenance and license scope, intended
  distribution, known obligations or blockers [E-xx if verified], and open questions.

## Pending Approval

| Candidate | Modules | Dependencies / prerequisites | Steps | Acceptance | Rollback | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| H-xx (adopt/adapt) | [Interfaces or files] | [Order, approvals, constraints] | [Proposed changes] | [Observable behavior and regression checks] | [How to restore prior behavior; state impact] | [E-xx] |

Before delivering Markdown, cross-check every `adopt` and `adapt` ID against
this table. Each ID needs at least one complete approval task. For every
`watch` ID, record a verification action and its decision trigger. For `reject`,
record the reason and, if known, what would justify revisiting it; do not add
a development task.

## Evidence Index

| ID | Recheckable locator | Observed evidence and its limit |
| --- | --- | --- |
| E-xx | `repo@revision:path:line/range` or `repo@revision:path:symbol` | [What this anchor supports; what it does not establish] |

Use the scope's snapshot alias for local-only evidence. For unresolved points,
record the search scope and missing corroboration rather than inventing an ID
or using a failed search as proof of absence.
