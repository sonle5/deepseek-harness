# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thank you for your interest in contributing to DeepSeek Harness!

We deeply believe in the power of open source communities, and that belief has shaped this project from the very beginning.

DeepSeek Harness is still at an early stage and under active development. We are sorry that we cannot accept external pull requests at the moment. However, contributing code to this repository is far from the only way to help. There are many other ways to get involved:

- Identify and report issues or bugs in GitHub Discussions:
  - Upvote discussions that you would like to bring to the team's attention. We are a very small team and may not be able to reply to every post, but we monitor them and consider them when allocating resources.
- Contribute to the ecosystem:
  - Create a plugin that excites you and share it with others:
    - Associate your GitHub project with the `dsh-plugin` topic to help others discover your plugin.
  - Write blog posts and how-to guides about DeepSeek Harness.
  - Answer questions and help other members of the community.

DeepSeek Harness is designed to be deeply customizable. We do not believe that packages in the official repository are inherently more important than packages created by the community. You may consider this repository an idea, an official showcase, and a source of inspiration, but not a mandate from us.

We have already seen exciting projects emerge from the community, and we hope to see the ecosystem continue to grow in its own directions.

## Parity work in this fork

`sonle5/deepseek-harness` measures Nexus Superharness against Codex Desktop and
closes the gaps one at a time. Work lands on `develop`:

- **Pull requests target `develop`.** `master` mirrors upstream and is never a
  merge target here. The [Parity loop](.github/workflows/parity-loop.yml)
  workflow rejects any other base.
- **Every pull request closes an Issue.** Say `Fixes #N`. The Issue body is the
  fixing agent's brief, so it must record the surface, the current behaviour,
  the reference behaviour, and checkable acceptance criteria — the
  [Parity gap](.github/ISSUE_TEMPLATE/parity-gap.md) form asks for exactly that.
- **Label it.** Exactly one `kind/*` and at least one `area/*`, as the
  [issue policy](.github/issue-management/README.md) requires.
- **Review goes to `@onenexus-superagent`.** The loop requests it
  automatically; re-requesting after a dismissal is also automatic. A pull
  request the agent opened is not routed to it — GitHub refuses the request and
  an author cannot approve — so those wait for a human reviewer.
- **`develop` is protected.** It needs one approving review from someone other
  than the author, dismisses stale approvals when the branch moves, requires an
  approval of the last push, and requires every review conversation to be
  resolved. The loop enables GitHub's auto-merge rather than merging, so those
  rules apply to the exact commit that lands.

See [the parity review procedure](.github/PARITY-REVIEW.md) for how a release is
reviewed and how gaps are written up.

Into the unknown.
