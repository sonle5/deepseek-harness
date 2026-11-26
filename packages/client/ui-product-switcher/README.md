---
description: "Desktop Superharness | Composer product switcher and the Composer main panel."
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-product-switcher

English | [中文](README.zh.md)

## Summary

Desktop builds that embed Composer show one Superharness | Composer control in the sidebar logo row, and again after the window-chrome controls while the sidebar is hidden. Selecting Composer swaps the frame's center column for the native Composer view main owns; this package draws the starting, restarting, failed, incompatible, and external placeholders that occupy the same rectangle while the view is not attached.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The plugin activates only in the Desktop application document, and only when the preload-installed `window.dshComposer` bridge speaks protocol version 1. A plain `dsh web` document has no bridge; a Desktop build without an embedded, OS-compatible Composer reports `available: false`. In both cases the plugin registers nothing and the shell is unchanged. The build rows keep it on the `desktop` profile, so no other profile loads it.

Composer is a **main panel**, not a window layer. The two products share one shell: the sidebar, the drag rows, the window chrome and the frame's columns stay mounted while Composer is showing, exactly as they do for the plugin manager or the schedules page. The panel reports its own bounding box to main, which is the center column — so the native view sits beside the sidebar, under the frame's shared chrome, and the sidebar keeps working. A window-covering layer would repaint the whole app and hide the switcher that lives in the sidebar.

The selected product and the selected main panel are the same fact, kept in step both ways: choosing Composer selects its panel, and selecting any other panel (a sidebar entry, or the conversation itself) returns the switcher to Superharness. The plugin calls `show(bounds)` when the panel attaches, `setBounds(bounds)` as the column resizes with the window, and `hide()` when it detaches. Failures never need a second error path: every command rejection is ignored because main pushes the failure through `subscribe`, and the panel renders it. The control is one trigger button opening a radio menu of the two products, because the Composer surface is a native view outside the document and no DOM tab panel exists to associate.

While the frame mounts its `shell.leading` seat (the collapsed desktop sidebar's traffic lights and reopen control band), the reported rectangle starts below that band: native views paint above the document, and covering the seat would put the traffic lights beyond reach. While a narrow window shows the sidebar as a drawer, the view detaches for as long as the drawer is open, for the same reason.

Menu items, accelerators, the tray, and the caption menu reach the document through `onSelect`; `superharness` and `composer` select a product and `toggle` flips the current one. A repeat selection is a no-op. Focus, z-order, and input blocking around the native view remain main's responsibility.

The selected product survives a document reload, a recreated main window, and a relaunch. The document saves every selection in origin-local `dsh.productSwitcher.product` storage. On load it starts on Composer when main reports the native view as visible, because main keeps that view attached across a reload and reattaches it to a recreated window, or when the saved choice is `composer`; a missing, unreadable, or other stored value starts on Superharness. A document that starts on Superharness calls `hide()` once, because main can still hold a Composer request behind a blocking overlay or a surface that is not serving and would otherwise attach the view when that clears. The switcher label and the painted center column therefore agree from the first render.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Cordis plugin reads the bridge once, takes the initial state, and keeps a small snapshot store of `{ product, state }` that feeds two selector hooks. It registers `sidebar.product` and `sidebar.leading.product` occupants from [ui-sidebar](../ui-sidebar/README.md), plus a `main` panel from [ui-layout](../ui-layout/README.md) under the `composer` key, selecting it through `ctx.layout.selectPanel`. The `dshComposer` contract lives with [Desktop](../../../apps/desktop/README.md) in `apps/desktop/src/composer-ipc.ts` and `apps/desktop/src/composer-switcher.ts`; this package restates only the surface it consumes.

</details>

<a id="model-experience"></a>
## Model Experience

None, as this plugin changes which product surface the user sees without adding model-visible messages or tools.

#### KV Cache effect

None; this plugin neither constructs nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The panel's rendered rectangle is not asserted by this package's tests (jsdom reports zero-size boxes); the column geometry is [ui-layout](../ui-layout/README.md)'s, and the reported box is whatever the panel measures at runtime.
- The hidden-sidebar seat inherits the frame's fixed leading clearance. A wider switcher in the collapsed macOS seat could overlap the conversation title; the frame's own clearance is unchanged here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
