---
description: "桌面端 Superharness | Composer 产品切换器与 Composer 视图占位。"
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-product-switcher

[English](README.md) | 中文

## 概述

内置 Composer 的桌面构建会在侧栏品牌旁显示一个紧凑的 Superharness | Composer 控件，侧栏隐藏时也会在窗口控件之后再次显示。选择 Composer 后，应用内容由主进程持有的原生 Composer 视图取代；本包绘制其上方 48px 的栏，以及视图尚未挂载时占据同一矩形区域的启动、正在重启、失败、不兼容与独立运行占位。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

插件仅在桌面应用文档中激活，且仅当 preload 安装的 `window.dshComposer` 桥接支持协议版本 1。普通 `dsh web` 文档没有桥接；未内置或系统不满足要求的桌面构建报告 `available: false`。这两种情况下插件不注册任何内容，外壳保持不变。构建清单只在 `desktop` profile 上启用它，其他 profile 不会加载。

客户端决定当前选中的产品以及原生视图覆盖的矩形区域；视图、sidecar 与菜单快捷键由主进程持有。选择 Composer 时，插件通过 portal 挂载一个非模态的全窗口层：48px 的栏承载控件，其下的区域边界框会作为视图 bounds 发送。插件在挂载时调用 `show(bounds)`，区域随窗口缩放时调用 `setBounds(bounds)`；层卸载或切回产品时调用 `hide()`。失败无需第二条错误路径：所有命令拒绝都被忽略，因为主进程通过 `subscribe` 推送失败，由该层渲染。控件是带按下状态的两个按钮组，而不是标签列表，因为 Composer “面板”是文档之外的原生视图，不存在可关联的 DOM 标签面板。

菜单项、快捷键、托盘与标题栏菜单通过 `onSelect` 到达文档；`superharness` 与 `composer` 选中产品，`toggle` 翻转当前产品。重复选择不产生操作。Escape 不会关闭该层，原生视图周围的焦点、层级与输入阻断仍由主进程负责；该层位于模态、菜单、工具提示与提示条原语之下，因此这些内容仍会叠于 Composer 视图之上。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节</summary>

Cordis 插件读取一次桥接并取得初始状态，然后用一个小的快照 store 保存 `{ product, state }`，供给两个选择器 Hook。它注册来自 [ui-sidebar](../ui-sidebar/README.zh.md) 的 `sidebar.product` 与 `sidebar.leading.product` 占位，以及来自 [ui-layout](../ui-layout/README.zh.md) 的 `shell.overlay` 条目。覆盖层是参照 [ui-settings-account](../ui-settings-account/README.zh.md) 中 Platform 页面打造的 body portal：同样为 48px、可拖动的栏，macOS 上同样的红绿灯内缩。`dshComposer` 契约位于 [Desktop](../../../apps/desktop/README.zh.md) 的 `apps/desktop/src/composer-ipc.ts` 与 `apps/desktop/src/composer-switcher.ts`；本包只重述其消费的接口表面。

</details>

<a id="model-experience"></a>
## 模型体验

无；该插件只改变用户看到的产品界面，不增加模型可见消息或工具。

#### KV Cache effect

无；该插件既不构建也不发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包测试未断言渲染后的几何尺寸；占位相对栏的位置、栏的拖动行，以及控件在品牌旁的适配，是通过阅读样式表而非在运行窗口中验证的。
- 侧栏隐藏时的席位继承框架固定的前导留白。折叠的 macOS 席位中若控件更宽，可能与会话标题重叠；此处未改动框架自身的留白。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
