---
name: Parity gap
about: A Codex Desktop behaviour Nexus Superharness lacks or gets wrong, found by release review
title: "[Parity] "
type: Task
labels: ['parity']
---

<!--
Filled by a release review; keep every section. A gap is only actionable with
the observed surface and the reference behaviour, so quote what the app does
today and what Codex Desktop does instead.

This body is also the brief for the fixing agent: the PR that closes it must
reference this issue with `Fixes #N`. The Parity loop routes the PR's review to
a reviewer agent other than its author, who requests changes unless the PR
shows every acceptance criterion and every surface under Evidence required.
-->

## Gap

<!-- One paragraph: which surface, what Superharness does, what Codex Desktop does. -->

## Where

<!--
Name the exact surface and, where known, the code that owns it:
sidebar / product switcher / new-session composer / settings / window chrome /
shortcut / menu / packaging. Include file paths when the review pinned them.
-->

- **Surface**:
- **Observed in build**:
- **Owner (if known)**:

## Reproduction

<!-- Smallest reliable steps. Numbered. -->

1.
2.
3.

## Current behaviour

<!-- What happens, with evidence: measured CSS values, DOM reads, screenshot notes, logs. -->

## Expected behaviour (Codex Desktop)

<!--
The reference behaviour, precisely enough to implement: alignment, default focus,
entry points, the keyboard path, persistence. Say whether Codex makes this a
menu item, a shortcut, a persisted setting, or a default.
-->

## Acceptance criteria

<!-- Checkable statements. A reviewer should be able to tick each one from the running app. -->

- [ ]
- [ ]

## Evidence required

<!--
Which surfaces the fixing PR must show from a packaged build
(`pnpm run package:desktop:mac:arm64:unsigned`), because a dev build cannot
verify them. Keep the ones the criteria touch and delete the rest; write
"None — dev-build evidence suffices" with a reason when no criterion names one.
See .github/PARITY-REVIEW.md, Packaged-only surfaces.
-->

- [ ] Dock and Finder icon
- [ ] About panel
- [ ] `Info.plist`
- [ ] DMG window, background and layout
- [ ] Native menus
- [ ] Code signature and bundle id
- [ ] First-run window

## Scope notes

<!--
What the fix must NOT change: shared components other products render, the
Composer seat contract, packaging identity, and anything the release review
already confirmed correct. Note dependencies on other gaps.
-->
