---
name: dsh-pr-description
description: Use when creating a deepseek-harness pull request, or when updating its description after later changes or a handled review round. Defines each description section, Issue references, module responsibilities and dependency edges, test design, and change-specific disclosures.
user-invocable: false
---

# Writing PR descriptions

This skill defines what a deepseek-harness PR description contains, how to write it, and when to update it. The [PR template](../../../.github/pull_request_template.md) supplies only the section headings and placeholders; this skill owns the requirements for each section. Every PR description follows this skill, including PRs created with `gh pr create --body-file`, which skips the template.

## Scope

- Write the complete description when you create the PR.
- After the PR exists, update the affected sections when the description no longer matches the PR, at times you judge suitable.
- Each PR in a stack has its own description, which covers only that layer's changes against its base branch.

## Description structure

The description uses four second-level headings, in this order: `## Motivation`, `## Changes`, `## Testing`, and `## User-visible evidence`.

Write fixed section headings and labels, such as **Interface changes**, **Behavior changes**, **Module responsibilities and dependencies**, **Test design**, and **Test entries**, in English. Write table headers and the rest of the description in the PR description's language, Chinese unless a human asked for another language.

### Motivation

- State the problem in one sentence.
- Reference at least one same-repository Issue: use `Fixes #N`, `Closes #N`, or `Resolves #N` when the PR resolves it, and `Refs #N` when it only gives context. PR numbers do not count as Issue references, and neither do references inside HTML comments, code fences, or inline code. [Issue management](../../../.github/issue-management/README.md) owns the exact rules and the Priority matching.

### Changes

- Interface changes: summarize changes to commands (including repository scripts), flags, configuration keys, environment variables, public exports, plugin registration values, protocols, or persisted formats; write None when there are none.
- Behavior changes: summarize results that users, models, developers, or the system can observe, including defaults, performance, timing, and output; write None when there are none. Changes to documentation and agent instructions, such as READMEs, AGENTS.md, and skills, are behavior changes for the readers they guide.
- Module responsibilities and dependencies: state the responsibility of each package that the structural change involves, and every runtime dependency between workspace packages that the PR adds or removes, in the form that [Module responsibilities and dependencies](#module-responsibilities-and-dependencies) defines; write None when the PR adds or removes no package, adds or removes no runtime dependency between workspace packages, and moves no responsibility between packages.
- State only behavior that the diff guarantees and the tests cover.

#### Module responsibilities and dependencies

A reviewer uses this item, before reading the diff, to judge whether each package has one responsibility and whether each added dependency is necessary. A workspace package is a member that `pnpm-workspace.yaml` lists; name it by the `name` in its manifest without the `@deepseek-ai/` scope, which can differ from its directory name. When the item is not None, it has three parts, in this order:

1. **Responsibility table**: one row for each package that the PR adds or removes, that is the source of an added or removed dependency edge, or that gains or loses a responsibility. The columns are the package, its responsibility in one sentence, and what this PR does to it: added, removed, changed and how, or unchanged and depended on. Packages that have the same role and receive the same change may share a row. A package that the PR does not change and that is only the target of an added edge gets a row when its responsibility explains why the edge is needed; a general utility package, such as `dsh-error`, may be left out. A package whose only change is a composition edge gets no row.
2. **Dependency edges**: a list of every runtime dependency between workspace packages that the PR adds or removes, each written `A → B` for "A depends on B" and marked as added or removed. Take the edges from the diff, never from memory: in `git diff <base>...HEAD -- '*package.json'`, compare the `dependencies`, `peerDependencies`, and `optionalDependencies` of each workspace package's manifest. Leave out `devDependencies`, the `package.json` files of test fixtures and templates, and dependencies on the vendored packages under `vendor/`. Mark an optional peer dependency or an `optionalDependencies` entry as optional. One list item may hold edges that share a source or a target, but every edge appears. List the edges of a bundle, app, or deploy root that only mounts a plugin or adds a package to its closure in a separate composition item, because they are not runtime calls. End the list with a reverse-edge item: for each added edge `A → B`, check that the runtime dependencies of B do not name A, then state that no added edge has a reverse edge, or list each one that has.
3. **Call flow**: three to six lines of pseudo-code, in a code fence, that show the main call path across the packages. Write it only when the PR adds or changes a call between packages.

When the edges involve four or more packages, a Mermaid `graph` may follow the list; it never replaces the list.

Filled in from the manifests, READMEs, and call sites of #8521:

````markdown
**Module responsibilities and dependencies**

| 包 | 职责 | 本 PR 的变化 |
|---|---|---|
| `dsh-deepseek-auth` | `ctx.deepseekAuth`：在 API 密钥与账号登录之间选择，把凭据绑定到所属部署，给出请求头 | 新增 |
| `dsh-llm-deepseek-api-key`、`dsh-llm-deepseek-account` | 注册各自的 DeepSeek 模型路由 | 用 `connect()` 登记自己的部署，用 `authorize()` 取请求头 |
| `dsh-web-deepseek-api`、`dsh-web-search-deepseek` | Search / Fetch API 与 Messages 搜索 | 改为向 `ctx.deepseekAuth` 取凭据，不再自己读账号服务和模型路由配置 |
| `dsh-sdk-jsonrpc-server` | SDK JSON-RPC 服务 | 组合里没有 `deepseekAuth` 时自己挂载它 |
| `dsh-credentials`、`dsh-deepseek-account` | 凭据存取、账号登录 | 不变，被 `dsh-deepseek-auth` 读取 |

依赖边：

- 新增 `dsh-deepseek-auth → dsh-credentials`、`dsh-error`、`dsh-launch-environment`、`dsh-deepseek-account`（可选）
- 新增 `dsh-llm-deepseek-api-key → dsh-deepseek-auth`、`dsh-llm-deepseek-account → dsh-deepseek-auth`
- 新增 `dsh-web-deepseek-api → dsh-deepseek-auth`、`dsh-web-search-deepseek → dsh-deepseek-auth`
- 新增 `dsh-sdk-jsonrpc-server → dsh-deepseek-auth`
- 删除 `dsh-web-deepseek-api → dsh-deepseek-account`（可选）、`dsh-web-deepseek-api → dsh-launch-environment`
- 删除 `dsh-web-search-deepseek → dsh-llm`
- 组合：`dsh-base`、`dsh-sdk-minimal`、`dsh-python-runtime-closure` 新增 `dsh-deepseek-auth`
- 反向边：无。`dsh-deepseek-auth` 的运行时依赖只有第一条中的四个包，不含任何新依赖它的包；这四个包都不依赖 `dsh-deepseek-auth`

调用流程：

```ts
const authorization = await ctx.deepseekAuth.authorize({
  consumer: 'my-plugin', accepts: ['account', 'api-key'], billing: 'auto',
  route, destination: { path: '/v1/tools/search' },
}, signal)
await fetch(authorization.endpoint, { headers: authorization.headers, signal }) // 请求仍由使用方自己发
```
````

### Testing

Testing starts with the test design, followed by the test entries.

**Test design**: summarize how the tests cover each item in Changes and why that coverage is complete. Choose the form by change type:

| Change type | What the test design shows |
|---|---|
| Behavior change | A behavior matrix of scenario × behavior before × behavior after × covering test, showing which scenarios failed or differed before the change |
| Performance change | Before and after values per stage or scenario, with the measurement conditions: machine, run count, and how the value is taken |
| Refactoring or migration without behavior change | How the unchanged behavior is shown: byte-for-byte comparison, unchanged snapshots, or old-versus-new comparison tests |
| Documentation only | How the content is checked: links, bilingual pairing, example compilation, or similar |

When the PR mixes change types, give one form for each type present. Items that Changes lists as None need no test design.

**Test entries**:

- Add one entry per test method; state the command or steps visibly, and the behavior it covers.
- List only tests that have run, with their results; add later runs when the description is updated. State whether the evidence comes from a local run or from CI.
- Put reviewable evidence, such as test output, screenshots, recordings, or logs, in that entry's `<details><summary>Proof</summary>` block; when the full output is long, the block may hold the command, the counts, and a result summary.

### User-visible evidence

The section is required when the PR carries `area/desktop` or `area/client`, or fixes a `parity` Issue; [Reviewing a PR](../../../.github/PARITY-REVIEW.md#reviewing-a-pr) owns the review rules and the list of packaged-only surfaces.

- **Build**: the packaging command, `pnpm run package:desktop:mac:arm64:unsigned` or the equivalent named for the area, and the commit it was built from.
- **Before / after**: screenshots from that packaged build of the same scenario, each captioned with the commit it was built from.
- **Acceptance criteria**: one ticked entry per criterion of the linked Issue, saying how it was checked, with the output or screenshot.
- A PR without a user-visible change writes `N/A — no user-visible change: <reason>` as the whole section.

### Change-specific disclosures

Write each disclosure in the section it concerns, usually Changes, after a bold English label that names it, such as **Existing test behavior**; do not add headings.

| Change | What the description states | Rule owner |
|---|---|---|
| Changing the behavior an existing test describes | Why the behavior changed | The Tests describe behavior rule in [root AGENTS.md](../../../AGENTS.md) |
| Raising a ceiling in `scripts/doc-budgets.manifest.json` | Each raised ceiling with its old and new value, and why the words are necessary | [Wordcount budgets](../../../docs/AGENTS.md#wordcount-budgets) |
| Changing product-user-visible GUI behavior | An embedded demonstration GIF, with the disclosures that record-browser-gif requires beside the embed; for each GUI change without a GIF, a statement that none is embedded and why | [record-browser-gif](../record-browser-gif/SKILL.md#every-gui-pull-request-includes-a-gif) |
| Using a translation term the terminology list lacks | The source of the rendering, or a proposed rendering under pending terms | [Translation rules](../../../docs/i18n/translation-rules.md) |

## Creating and updating the description

1. Write the description to a file that git ignores, such as `.artifacts/pr/body.md`. Create the PR with `gh pr create --body-file <file>`, or update it with `gh pr edit <number> --body-file <file>`; when the description embeds a GIF, follow [record-browser-gif](../record-browser-gif/SKILL.md) and use `--attach`.
2. Before an update, save the current description with `gh pr view <number> --json body --jq .body`, and change only the sections that need it: keep content and media the author wrote, and remove statements that no longer match the code.
3. After writing, read the description back and confirm that all four sections are present and that the dependency edges in Changes match the current diff.
