---
description: "Nexus Superharness 侧栏与空白首页品牌标志。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-nexus

[English](README.md) | 中文

## 概述

本包在应用侧栏提供规范的 Nexus N 字标与文字标识，并在空白首页标题上方显示同一字标。该字标即 Nexus Composer 自首个版本起使用的标志，现随 Composer 与 Superharness 合并为同一应用而沿用；文字标识则标识合并后的产品。随产品提供的 Web 与 Desktop 组合用它替代官方品牌包。

## 目录

- [使用本包](#use-this-package)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包注册 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark`；不占用 `conversation.hero.frame`，因此空白首页没有背景装饰。图形固定，不接受配置。不同的产品身份应替换本包并占用相同 slot。

字标的无障碍标签与文字标识中的产品名来自 `brandNexus` locale 命名空间，因此翻译后的构建会用各自语言书写的产品名。

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar](../ui-sidebar/README.zh.md)
- [ui-conversation](../ui-conversation/README.zh.md)
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明品牌呈现的提供方式，是当前包的约束，而不是品牌设计对比或任务清单。

- **唯一的占位集** —— 替代图形应属于另一个占用相同 slot 的 Cordis 包。
- **图形固定** —— 标志与文字标识不接受配置，并跟随当前主题。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

字标是单条填充路径，因此标志取色于 `currentColor`，无需逐主题的图形或包内资源。文字标识中的产品名需要翻译，所以本包自带 locale 目录，而不借用外壳的字典。

</details>
