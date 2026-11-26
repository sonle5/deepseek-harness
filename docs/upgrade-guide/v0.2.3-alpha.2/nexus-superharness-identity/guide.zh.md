---
kind: upgrade-guide
description: "Desktop 应用现以 Nexus Superharness 为名，在 dsh:// 之外新增 nexus-superharness:// 协议并重命名发布构件；用户数据目录刻意保持原路径，现有设置随升级保留。"
---
# Desktop 现为 Nexus Superharness

[English](guide.md) | 中文

## 变更

Desktop 应用现以 **Nexus Superharness** 为名，内嵌 Composer 成为同一窗口中的第二个产品，而不再是单独安装的应用。

| 界面 | 变更前 | 变更后 |
|:--|:--|:--|
| 产品名称 | DeepSeek Harness Desktop | Nexus Superharness |
| 深链协议 | `dsh://` | `nexus-superharness://`，仍接受 `dsh://` |
| 构件前缀 | `dsh-desktop` | `nexus-superharness` |
| Dock 图标 | DeepSeek 鲸鱼 | Nexus 字母标记 |
| Composer | 独立应用 | 窗口内的一个产品 |

应用标识符在打包时由 `DSH_DESKTOP_APP_ID` 提供，发布流程现将其设为 `com.onenexus.superharness`；应用本身不内置默认值。

用户数据目录**不会**改名：`main.ts` 仍将 `userData` 指向既有的 `@deepseek-ai/dsh-desktop` 路径，因此改名后现有设置与插件操作状态得以保留。但由于应用标识符确实改变，对 macOS 而言已安装的 DeepSeek Harness Desktop 仍是另一个应用，不会就地升级。

## 迁移

1. 从发布构件安装 Nexus Superharness；不要期望已安装的 DeepSeek Harness Desktop 自行更新为它。
2. 设置、配置档与插件操作状态会自动保留——用户数据路径未变。请勿手动复制该目录。
3. 读取旧构件名或协议的打包脚本需要更新：构件现为 `nexus-superharness-<version>-<os>-<arch>`，链接请使用 `nexus-superharness://`。
4. 在 Superharness 中选择 Composer 之前，请先退出独立的 Nexus Composer。当独立应用仍持有路由时，内嵌界面为只读，并会说明这一点。
5. 确认 `open -a "Nexus Superharness"` 可以启动它，Dock 显示 Nexus 字母标记，且 `nexus-superharness://` 链接可以打开它。
