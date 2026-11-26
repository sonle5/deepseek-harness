---
description: "Nexus Superharness sidebar and blank-home brand artwork."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-nexus

English | [中文](README.zh.md)

## Summary

This package supplies the canonical Nexus N monogram and wordmark in the application sidebar and a restrained cool-neutral treatment on the blank home. The monogram is the mark Nexus Composer has shipped since its first release, carried over now that Composer and Superharness are one application, and the wordmark names the merged product. The shipped Web and Desktop compositions mount it in place of the official brand package.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package registers `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, and `conversation.hero.frame`. The artwork is fixed presentation and takes no configuration. A different product identity replaces this package and occupies the same slots.

The product name in the mark's accessible label and in the wordmark comes from the `brandNexus` locale namespace, so a translated build names the product in its own language.

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md)
- [ui-conversation](../ui-conversation/README.md)
- [Web client architecture](../../../docs/subsystems/web-client.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative artwork belongs in another Cordis package occupying the same slots.
- **Fixed artwork** — the mark, the wordmark and the home treatment take no configuration and follow the active theme.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The monogram is one filled path, so the mark takes its colour from `currentColor` and needs no per-theme artwork or package asset. The wordmark's product name is localized, which is why this package carries a locale catalog of its own rather than borrowing the shell's.

</details>
