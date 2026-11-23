---
description: "Desktop Superharness | Composer product switcher and the Composer view placeholder."
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-product-switcher

English | [中文](README.zh.md)

## Summary

Desktop builds that embed Composer show one compact Superharness | Composer control beside the sidebar brand, and again after the window-chrome controls while the sidebar is hidden. Selecting Composer replaces the application content with a native Composer view main owns; this package draws the 48px bar above it and the starting, restarting, failed, incompatible, and external placeholders that occupy the same rectangle while the view is not attached.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The plugin activates only in the Desktop application document, and only when the preload-installed `window.dshComposer` bridge speaks protocol version 1. A plain `dsh web` document has no bridge; a Desktop build without an embedded, OS-compatible Composer reports `available: false`. In both cases the plugin registers nothing and the shell is unchanged. The build rows keep it on the `desktop` profile, so no other profile loads it.

The client owns which product is selected and the rectangle the native view covers; main owns the view, the sidecar, and the menu accelerators. Selecting Composer mounts a non-modal full-window layer in a portal: a 48px bar carrying the control, and below it the region whose bounding box is sent as the view's bounds. The plugin calls `show(bounds)` on mount and `setBounds(bounds)` as the region resizes with the window, and calls `hide()` when the layer unmounts or the product switches back. Failures never need a second error path: every command rejection is ignored because main pushes the failure through `subscribe`, and the layer renders it. The control is a two-button pressed group rather than a tab list, because the Composer "panel" is a native view outside the document and no DOM tab panel exists to associate.

Menu items, accelerators, the tray, and the caption menu reach the document through `onSelect`; `superharness` and `composer` select a product and `toggle` flips the current one. A repeat selection is a no-op. Escape does not dismiss the layer, and focus, z-order, and input blocking around the native view remain main's responsibility; the layer sits below the modal, menu, tooltip, and toast primitives so those still stack above the Composer view.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Cordis plugin reads the bridge once, takes the initial state, and keeps a small snapshot store of `{ product, state }` that feeds two selector hooks. It registers `sidebar.product` and `sidebar.leading.product` occupants from [ui-sidebar](../ui-sidebar/README.md), plus a `shell.overlay` entry from [ui-layout](../ui-layout/README.md). The overlay is a body portal modeled on the Platform page in [ui-settings-account](../ui-settings-account/README.md): the same 48px drag-capable bar and the same traffic-light inset on macOS. The `dshComposer` contract lives with [Desktop](../../../apps/desktop/README.md) in `apps/desktop/src/composer-ipc.ts` and `apps/desktop/src/composer-switcher.ts`; this package restates only the surface it consumes.

</details>

<a id="model-experience"></a>
## Model Experience

None, as this plugin changes which product surface the user sees without adding model-visible messages or tools.

#### KV Cache effect

None; this plugin neither constructs nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The rendered geometry is not asserted by this package's tests; the placeholder's position under the bar, the bar's drag row, and the control's fit beside the brand were verified by reading the stylesheets, not in a running window.
- The hidden-sidebar seat inherits the frame's fixed leading clearance. A wider switcher in the collapsed macOS seat could overlap the conversation title; the frame's own clearance is unchanged here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
