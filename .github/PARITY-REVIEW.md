# Codex parity review loop

Nexus Superharness is measured against Codex Desktop. Each release cut from
`develop` is reviewed on a real Mac, every gap becomes an Issue, and each Issue
carries enough context that the fixing agent needs nothing beyond the Issue body.
This file is the operating procedure; the label and form requirements below are
enforced by [`issue-policy.yml`](workflows/issue-policy.yml) and
[`issue-lifecycle.yml`](workflows/issue-lifecycle.yml), so a review that skips
them fails CI rather than quietly producing an untriageable Issue.

## The loop

```
release cut from develop
        │
        ▼
visual review on this Mac ──► parity Issue (+ parity, area/*, p*)
        │                              │
        │                              ▼
        │                     fixing PR into develop
        │                     (Fixes #N, kind/*, area/*, review @onenexus-superagent)
        │                              │
        │                              ▼
        │                     reviews resolved ──► merged by the maintainer
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
- requests review from `@onenexus-superagent`.

PR kinds and their meanings are the ones the policy already knows:

| Label | Means |
|:--|:--|
| `kind/feature` | New user-visible capability or behaviour |
| `kind/bug-fix` | Corrects behaviour that did not meet its contract |
| `kind/doc` | Documentation only |
| `kind/testing` | Test coverage only |
| `kind/cleanup` | Refactor, rename, or removal with no behaviour change |
| `kind/dependency` | Dependency or pinned-artifact changes |

Fill the [pull request template](pull_request_template.md) as written, including
the AI declaration. A parity-fix PR additionally states which acceptance criteria
from the Issue it satisfies and how each was checked.

## Merging

Merge only after every review comment is resolved and the required checks pass.
Squash to one commit per Issue so `develop` reads as a list of gaps closed. The
first release after a merge is what the next review measures.

## Scope

The review covers the app as shipped from this repository. Two things it must not
report as gaps:

- **Upstream release plumbing.** Signing, notarisation, publisher environments
  and the release workflows need organisation secrets this fork does not hold;
  releases are cut locally instead.
- **Things the standalone Composer owns.** The embedded sidecar is the product
  surface. The standalone app is being retired and is not parity scope.
