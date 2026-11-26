# 贡献

[English](CONTRIBUTING.md) | 中文

感谢你愿意为 DeepSeek Harness 作出贡献！

我们深信开源社区的力量，这份信念从项目最初就塑造着 DeepSeek Harness。

DeepSeek Harness 仍处于早期阶段，并在积极开发中。很抱歉，我们目前无法接受外部 PR（Pull Request）。不过，贡献代码远非帮助本仓库建设的唯一途径。你还可以通过许多其他方式参与进来：

- 在 GitHub Discussions 中发现并报告问题或 bug：
  - 为你希望引起团队关注的讨论投票。我们的团队规模很小，可能无法回复每个帖子，但我们会持续关注，并在分配资源时将这些讨论纳入考虑。
- 为生态系统作出贡献：
  - 创建令你感兴趣的插件，并分享给其他人：
    - 为你的 GitHub 项目添加 `dsh-plugin` 话题，让其他人更容易找到你的插件。
  - 撰写有关 DeepSeek Harness 的博客文章和操作指南。
  - 回答问题并帮助其他社区成员。

DeepSeek Harness 的设计支持深度定制。我们并不认为官方仓库中的包天然就比社区开发的包更重要。你可以将本仓库看作一种理念、一份官方示例以及一处灵感来源，而不是我们要求社区遵循的方向。

我们已经看到社区中涌现出令人期待的项目，也希望生态系统继续沿着自己的方向发展。

## 本分支的 Parity 工作

`sonle5/deepseek-harness` 以 Codex Desktop 为基准衡量 Nexus Superharness，并逐项消除差距。工作进入 `develop`：

- **PR 面向 `develop`。** `master` 镜像上游，不是本仓库的合并目标。[Parity loop](.github/workflows/parity-loop.yml) 工作流会拒绝其他基准分支。
- **每个 PR 关闭一个 Issue。** 写明 `Fixes #N`。Issue 正文即修复者的任务说明，须记录界面、当前行为、参考行为与可勾选的验收标准——[Parity gap](.github/ISSUE_TEMPLATE/parity-gap.md) 表单正是要求这些。
- **打标签。** 恰好一个 `kind/*`，至少一个 `area/*`，符合 [issue policy](.github/issue-management/README.zh.md) 的要求。
- **评审交给 agent，且绝不是作者本人。** 工作流会自动请求评审；评审被驳回后也会自动重新请求。人工发起的 PR 交由 `@onenexus-superagent` 评审；由某个 agent 发起的 PR 则交给另一个 agent 评审，从而写代码的 agent 永远不会被要求批准自己的改动。
- **`develop` 受保护。** 需要一位非作者的批准，分支移动时旧的批准会被作废，需要批准最后一次推送，且所有评审讨论线程必须解决。工作流启用 GitHub 的自动合并而非自行合并，因此这些规则作用于真正合入的那个提交。

发布如何评审、差距如何撰写，见[parity 评审流程](.github/PARITY-REVIEW.md)。

探索未至之境。
