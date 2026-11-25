---
description: "Nexus Superharness sidebar and blank-home brand artwork."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-nexus

English | [中文](README.zh.md)

## Summary

This package supplies the canonical 82-by-70 Orbit Link mark and wordmark in the application sidebar and a restrained cool-neutral treatment on the blank home. Two opposing trajectories meet through a coordinator node, expressing supervised human-agent collaboration without borrowing Nexus Composer's N monogram. The shipped Web and Desktop compositions mount it in place of the official brand package.

## Use this package

The package registers `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, and `conversation.hero.frame`. The artwork is fixed presentation and takes no configuration. A different product identity replaces this package and occupies the same slots.

## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md)
- [ui-conversation](../ui-conversation/README.md)
- [Web client architecture](../../../docs/subsystems/web-client.md)

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative artwork belongs in another Cordis package occupying the same slots.
- **Fixed artwork** — the mark, the wordmark and the home treatment take no configuration and follow the active theme.
