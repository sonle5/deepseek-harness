---
description: "Nexus Superharness 侧栏与空白首页品牌图形。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-nexus

[English](README.md) | 中文

## 概述

本包在应用侧栏提供规范的 Nexus N 字标与文字标识，并为空白首页提供克制的冷中性氛围。该字标即 Nexus Composer 自首个版本起使用的标志，现随 Composer 与 Superharness 合并为同一应用而沿用；文字标识则标识合并后的产品。随产品提供的 Web 与 Desktop 组合用它替代官方品牌包。

## 使用本包

本包注册 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` 与 `conversation.hero.frame`。图形固定，不接受配置。不同的产品身份应替换本包并占用相同 slot。

## 进一步探索

- [ui-sidebar](../ui-sidebar/README.zh.md)
- [ui-conversation](../ui-conversation/README.zh.md)
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

这些限制说明品牌呈现的提供方式，是当前包的约束，而不是品牌设计对比或任务清单。

- **唯一的占位集** —— 替代图形应属于另一个占用相同 slot 的 Cordis 包。
- **图形固定** —— 标志、文字标识与首页处理不接受配置，并跟随当前主题。
