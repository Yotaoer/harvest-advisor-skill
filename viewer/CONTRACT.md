# Harvest report JSON

Open `index.html` directly from the filesystem, then import a UTF-8 `.json`
file. No server, dependencies, account, or persistence is required. Start with
`examples/markdown-cli.json` (architecture, flow and approval handoff) or
`examples/reservations.json` (one-to-many and coverage gaps). Both are synthetic;
their locators do not identify real source.

## Version and records

`schemaVersion` must be the numeric version exported by `contract.js` (currently
`1`). That file owns the supported version and is the authoritative validator.
Objects reject extra keys; fields below are required unless marked optional.
IDs are 1-64 letters, digits, dots, underscores, or hyphens, starting with a
letter or digit. Record IDs are unique across the report, including views and
scope gaps; repository IDs have their own namespace. All ID lists reject
duplicates. Labels need not be unique.

| Record | Fields and meaning |
| --- | --- |
| Report | `schemaVersion`, `title`, `repositories`, `scope`, `nodes`, `edges`, `correspondences`, `evidence`, `views`; optional `candidates` and `tasks` (default `[]`), and `language` (report-language hint). |
| `repositories` | Exactly `own` and `reference`, each `{id, name, revision: {kind, value, state?}}`. `kind` is `revision` or `snapshot`. `value` is the inspected revision or a recheckable snapshot label; `state` describes relevant worktree state or reproducibility limits. |
| `scope` | `{goal, included, excluded, gaps}`. `included` and `excluded` are arrays of text. `gaps` contains `{id, label, note, evidence?}`; `evidence` is an array of IDs. State where you looked and what you could not establish in `note`. |
| `nodes[]` | `{id, repo, label, evidence, group?, note?, evidenceGap?}`. `repo` is a repository ID; `evidence` points to that repository. An empty array requires `evidenceGap` and renders as unverified. A `group` labels a run of nodes in view order; it is not a stage. |
| `edges[]` | `{id, kind, from, to, label, evidence, note?}`. `kind` is `call`, `data`, or `dependency`; `from` and `to` are ordered node IDs from one repo. At least one evidence ID from that repo is required. |
| `correspondences[]` | `{id, status, label, own, reference, evidence, note}`. `own` and `reference` are arrays of node IDs from their respective repos. `matched` needs nodes and evidence on both sides; it draws one undirected group of branches, not inferred pairwise calls. `checked-no-match` needs exactly one populated side and a note of the searched scope. `unverified` needs at least one populated side and a note of what remains unknown. Neither gap status draws a wire; evidence may be partial or empty. |
| `evidence[]` | `{id, repo, revision, path, supports, limits, range?, symbol?}`. `revision` must match the designated repo's inspected `revision.value`. `path` is repo-relative, slash-separated, not a URL. Provide exactly one of `range: {start, end}` (positive, inclusive line numbers) or `symbol` (text). Locator display: `repo@revision:path:range-or-symbol`. |
| `views` | `{overview, flows?}`. `overview` is required; `flows` is a list of zero or more views. A view is `{id, label, nodes, edges, correspondences, note?}`. Array entries are record IDs; every included relationship must have all its recorded endpoints included. View order controls node order in each lane. No phase names or number of layers are inferred. |
| `candidates[]` | `{id, title, decision, approach, targets, evidence, fact, inference, recommendation, benefit, license, stackFit, maintenanceCost, architectureImpact, evidenceGap?}`. `decision`: `adopt`, `adapt`, `reject`, `watch`. `approach` describes the proposed adoption mechanism independently (see below). `targets` references nodes, edges, correspondences, or scope gaps, with at least one visible in a view or scope. `evidence: {own, reference}` holds separate ID arrays; only `watch` may omit a side's evidence, by giving an empty array and explaining it in `evidenceGap`. Use text for evaluations and independent licensing/distribution limits. |
| `tasks[]`, approval | `{id, candidate, kind: "approval", title, evidence, modules, dependencies, steps, acceptance, rollback}`. `candidate` is an `adopt` or `adapt` candidate's ID; `modules`, `dependencies`, and `steps` are text arrays; evidence, modules, and steps cannot be empty. No approval action is provided. |
| `tasks[]`, recheck | `{id, candidate, kind: "recheck", title, evidence, action, condition}`. Each `watch` needs at least one recheck, with an action and a condition for revisiting the decision. Evidence may be empty. `reject` has no tasks. |

Candidate `approach` values:

- `copy-code`: directly reuse source code, subject to applicable permissions.
- `design-only`: use a design or pattern as a reference without copying code.
- `test-cases-only`: borrow test or acceptance scenarios and implement them independently.
- `add-dependency`: propose introducing an existing package or library as a dependency, not copying its source. Import never installs it.
- `status-quo`: retain the current approach.

`evidence` lists always contain evidence IDs, not locator strings. Explicit
empty arrays are valid where evidence is not required. An empty comparison
can have empty node, edge, correspondence, evidence, and overview lists;
the scope can document why. There is no requirement for a flow, candidate, or
approval task to import a report.

## Report language and viewer language

`language` is an optional BCP 47 tag accepted by `Intl.Locale`, up to 64
characters. It describes the report text, not a command or a request to
translate it. Old reports still work without this field. An unsupported but
well-formed tag is accepted.

The viewer uses the explicit interface choice first. Auto uses a supported
report hint after import, then the browser's first supported language, then
English. English variants map to English; `zh-Hans`, `zh-CN`, `zh-SG`, and bare
`zh` map to Simplified Chinese. Traditional Chinese is not mapped to Simplified
Chinese. Only a manual interface preference may be stored in local browser
storage; Auto clears it. Reports and their contents are not stored and do not
change when the interface language changes.

## Import boundary

Imports are limited to 2 MiB, 200 nodes, 600 directed edges, 300
correspondences, 2,000 evidence entries, 30 flows, 200 candidates, 400 tasks,
and 200 scope gaps. Blocking errors identify the first invalid field; the
previous report stays open. Strings are inert text, including any text that
resembles Markdown, HTML, commands, styles, or URLs. There are no markup,
script, style, asset, or executable path inputs. Evidence locators never open
files or generate links, and graph relationships never initiate requests.

Format validation checks shape and referential integrity only. It does not
inspect repositories, validate claims or licenses, approve tasks, or establish
that tests passed. For the local contract regression checks, run
`node --test viewer/contract.test.cjs` from the project root.
