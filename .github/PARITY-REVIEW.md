# Codex parity review loop

Nexus Superharness is measured against Codex Desktop. Each release cut from
`develop` is reviewed on a real Mac, every gap becomes an Issue, and each Issue
carries enough context that the fixing agent needs nothing beyond the Issue body.
This file is the operating procedure. The label rules below are enforced by
[`issue-policy.yml`](workflows/issue-policy.yml) and
[`issue-lifecycle.yml`](workflows/issue-lifecycle.yml); the review and merge
rules are enforced by `develop`'s branch protection, which the
[Parity loop](workflows/parity-loop.yml) workflow relies on rather than
re-implements.

Two things this procedure asks of a reviewer that no workflow can check: whether
an Issue records the surface, the current behaviour and the reference behaviour
(the form asks, but an empty answer passes), and whether a parity Issue names a
gap Codex actually has. Both are review judgement.

## The loop

```
release cut from develop
        │
        ▼
visual review on this Mac ──► parity Issue (+ parity, area/*, p*)
        │                              │
        │                              ▼
        │                     fixing PR into develop
        │                     (Fixes #N, kind/*, area/*, review by a peer agent)
        │                              │
        │                              ▼
        │              one approving review from someone other than the author
        │                              │
        │                              ▼
        │                     GitHub merges when protection is satisfied
        │                              │
        └──────────────────────────────┴──► next release cut from develop
```

## Reviewing a release

Review the build as a person would use it, not the diff. For each gap record:

1. **The surface** — sidebar, product switcher, composer, settings, window
   chrome, menu, shortcut, packaging. Name the file when the review pinned it.
2. **What Superharness does**, with evidence: measured CSS values, DOM reads,
   log lines, screenshot notes. "Looks wrong" is not a gap.
3. **What Codex Desktop does instead**, precisely enough to implement — the
   default, the entry point, the keyboard path, what persists.
4. **Acceptance criteria** a reviewer can tick from the running app.

Open the Issue with the [Parity gap](ISSUE_TEMPLATE/parity-gap.md) form. Assign
`@onenexus-superagent`, and set Priority by impact:

| Label | Means |
|:--|:--|
| `p0` | Blocks the release: the app cannot be cut over |
| `p1` | Visible in every session |
| `p2` | Worth fixing soon; a workaround exists |
| `p3` | Polish; no one is blocked |

One Issue per gap. A review that finds five things files five Issues, so each one
can be fixed, reviewed and merged on its own.

## Fixing a gap

The Issue body is the brief. A fixing PR:

- targets `develop`, never `master` (which mirrors upstream),
- says `Fixes #N`, so merging closes the Issue and the lifecycle workflow moves
  it to Done,
- carries exactly one `kind/*` and at least one `area/*`,
- is routed for review by the Parity loop, which requests it automatically.

The loop picks the reviewer from `REVIEWERS` in
[`parity-loop/policy.mjs`](parity-loop/policy.mjs), a list of reviewer agents,
most senior first. A PR opened by someone outside the list goes to the first
entry, `@onenexus-superagent`. A PR opened by an agent in the list goes to the
most senior other agent, because GitHub rejects a review request to the author
and excludes authors from approving their own PRs. With only one agent in the
list, the loop reports that it has no peer and leaves the request to be made by
hand. Adding an agent to the list extends peer routing with no other change.
The protection asks for one non-author approval; it does not require that the
approver be the routed agent.

PR kinds and their meanings are the ones the policy already knows:

| Label | Means |
|:--|:--|
| `kind/feature` | New user-visible capability or behaviour |
| `kind/bug-fix` | Corrects behaviour that did not meet its contract |
| `kind/doc` | Documentation only |
| `kind/testing` | Test coverage only |
| `kind/cleanup` | Refactor, rename, or removal with no behaviour change |
| `kind/dependency` | Dependency or pinned-artifact changes |

Fill the [pull request template](pull_request_template.md) as written. A PR
that carries `area/desktop` or `area/client`, or fixes a `parity` Issue, fills
its **User-visible evidence** section from a packaged build: before and after
screenshots, each captioned with the commit it was built from, and one ticked
entry per acceptance criterion of the Issue saying how it was checked, with the
output or screenshot. A PR with no user-visible change writes
`N/A — no user-visible change` with a reason instead. The evidence is the
author's to produce; CI does not build a DMG per PR.

### Packaged-only surfaces

A dev build (`dev:desktop`, `start:desktop`, a Web renderer or a DOM read)
cannot verify these, because they come from the packaging step or from macOS
reading the bundle. Evidence for them comes from a
`pnpm run package:desktop:mac:arm64:unsigned` build:

- Dock and Finder icon
- About panel
- `Info.plist`
- DMG window, background and layout
- native menus
- code signature and bundle id
- first-run window

## Reviewing a PR

The routed reviewer agent checks the pull request against this list before
anything else. When any item fails, submit **Request changes**, not a comment,
and name each failed item; a comment leaves the PR mergeable once another
account approves.

- [ ] A PR that carries `area/desktop` or `area/client`, or says `Fixes` a
      `parity` Issue, has a **User-visible evidence** section. Only a stated
      `N/A — no user-visible change` with a reason replaces it, and that reason
      must hold for the diff.
- [ ] The evidence names the build command and the commit it was built from,
      and that commit is the PR head or an ancestor whose later commits do not
      change what the evidence shows.
- [ ] Every criterion that names a
      [packaged-only surface](#packaged-only-surfaces) is shown from a packaged
      build. Dev-build screenshots or DOM reads for one of those surfaces fail
      this item.
- [ ] Every acceptance criterion in the linked Issue has its own ticked entry
      saying how it was checked, with the output or screenshot. A criterion
      left out, or covered only by "tests pass", fails this item.
- [ ] Before and after screenshots show the same scenario, so the difference is
      the change.

Then review the diff as usual. A green CI run does not stand in for this list:
unit tests and dev-build DOM reads can pass while the shipped bundle is wrong.

## Merging

Nobody merges by hand, and no workflow merges on its own. `develop` is protected:
it requires one approving review from someone other than the author, dismisses
stale approvals when the branch moves, requires an approval of the last push, and
requires every review conversation to be resolved. The Parity loop therefore only
asks GitHub to auto-merge the pull request, and GitHub applies those rules to the
commit it is about to merge — so an approval cannot carry over to a commit it did
not see.

Squash to one commit per Issue so `develop` reads as a list of gaps closed. The
first release after a merge is what the next review measures.

`develop` currently has no required status checks: the fork's CI workflows still
reference upstream organisation secrets and do not run here. Protection enforces
review, not CI, until those workflows can run.

## Scope

The review covers the app as shipped from this repository. Two things it must not
report as gaps:

- **Upstream release plumbing.** Signing, notarisation, publisher environments
  and the release workflows need organisation secrets this fork does not hold;
  releases are cut locally instead.
- **Things the standalone Composer owns.** The embedded sidecar is the product
  surface. The standalone app is being retired and is not parity scope.
