---
description: "桌面端 Superharness | Composer 产品切换器与 Composer 主面板。"
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-product-switcher

[English](README.md) | 中文

## 概述

内置 Composer 的桌面构建会在侧栏品牌行显示一个 Superharness | Composer 控件，侧栏隐藏时也会在窗口控件之后再次显示。选择 Composer 后，框架的中心列被替换为主进程持有的原生 Composer 视图；本包绘制视图尚未挂载时占据同一矩形区域的启动、正在重启、失败、不兼容与独立运行占位。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

插件仅在桌面应用文档中激活，且仅当 preload 安装的 `window.dshComposer` 桥接支持协议版本 1。普通 `dsh web` 文档没有桥接；未内置或系统不满足要求的桌面构建报告 `available: false`。这两种情况下插件不注册任何内容，外壳保持不变。构建清单只在 `desktop` profile 上启用它，其他 profile 不会加载。

Composer 是一个**主面板**，而不是窗口层。两个产品共用同一套外壳：展示 Composer 时，侧栏、拖动行、窗口控件与框架的各列都保持挂载，与插件管理器或定时任务页完全一致。面板把自己的边界框报告给主进程，即中心列——因此原生视图位于侧栏旁、共享的窗口控件之下，侧栏继续可用。覆盖整个窗口的层会重绘整个应用，并遮住侧栏里的切换器。

选中的产品与选中的主面板是同一事实，双向保持同步：选择 Composer 会选中它的面板，而选中任何其他面板（侧栏条目或会话本身）都会让切换器回到 Superharness。面板挂载时插件调用 `show(bounds)`，列随窗口缩放时调用 `setBounds(bounds)`，脱离时调用 `hide()`。失败无需第二条错误路径：所有命令拒绝都被忽略，因为主进程通过 `subscribe` 推送失败，由面板渲染。控件是一个触发按钮，展开包含两个产品的单选菜单，因为 Composer 表面是文档之外的原生视图，不存在可关联的 DOM 标签面板。

在 macOS 上，面板在顶部保留一条 20px 的窗口拖动行，报告的矩形从该行下方开始：Composer 文档不声明窗口拖动区域，否则原生视图会覆盖中间列的整条顶部带。当框架挂载 `shell.leading` 席位（折叠的 macOS 侧栏的红绿灯与重新打开控件带）时，报告的矩形从该带下方开始：原生视图绘制在文档之上，覆盖该席位会让红绿灯无法点击。窄窗口以抽屉形式显示侧栏时，视图在抽屉打开期间脱离，原因相同。

菜单项、快捷键、托盘与标题栏菜单通过 `onSelect` 到达文档；`superharness` 与 `composer` 选中产品，`toggle` 翻转当前产品。重复选择不产生操作。原生视图周围的焦点、层级与输入阻断仍由主进程负责。

所选产品在文档重新加载、主窗口重建与应用重新启动后保持不变。文档把每次选择保存在源本地的 `dsh.productSwitcher.product` 存储中。加载时，若主进程报告原生视图可见，文档从 Composer 开始，因为主进程在重新加载时保持该视图挂载，并把它重新挂到重建的窗口；保存的选择为 `composer` 时也从 Composer 开始；缺失、无法读取或其他存储值均从 Superharness 开始。从 Superharness 开始的文档会调用一次 `hide()`，因为主进程可能仍在阻塞覆盖层或未提供服务的界面后保留 Composer 请求，否则会在其解除后挂载该视图。因此切换器标签与中间栏绘制的内容从首次渲染起保持一致。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节</summary>

Cordis 插件读取一次桥接并取得初始状态，然后用一个小的快照 store 保存 `{ product, state }`，供给两个选择器 Hook。它注册来自 [ui-sidebar](../ui-sidebar/README.zh.md) 的 `sidebar.product` 与 `sidebar.leading.product` 占位，以及来自 [ui-layout](../ui-layout/README.zh.md) 的 `main` 面板，键为 `composer`，通过 `ctx.layout.selectPanel` 选中。`dshComposer` 契约位于 [Desktop](../../../apps/desktop/README.zh.md) 的 `apps/desktop/src/composer-ipc.ts` 与 `apps/desktop/src/composer-switcher.ts`；本包只重述其消费的接口表面。

</details>

<a id="model-experience"></a>
## 模型体验

无；该插件只改变用户看到的产品界面，不增加模型可见消息或工具。

#### KV Cache effect

无；该插件既不构建也不发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包测试不断言面板渲染后的矩形（jsdom 报告零尺寸盒）；列的几何尺寸属于 [ui-layout](../ui-layout/README.zh.md)，报告的盒子就是面板在运行时测到的值。
- 侧栏隐藏时的席位继承框架固定的前导留白。折叠的 macOS 席位中若控件更宽，可能与会话标题重叠；此处未改动框架自身的留白。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
