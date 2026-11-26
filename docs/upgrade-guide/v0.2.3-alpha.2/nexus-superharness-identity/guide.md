---
kind: upgrade-guide
description: "The Desktop application identifies as Nexus Superharness, adds the nexus-superharness:// scheme beside dsh://, and renames its release artifacts; its user data directory is deliberately unchanged so existing settings carry over."
---
# Desktop is Nexus Superharness

English | [中文](guide.zh.md)

## Change

The Desktop application now identifies as **Nexus Superharness**, and the embedded Composer becomes a second product in the same window instead of a separately installed app.

| Surface | Before | After |
|:--|:--|:--|
| Product name | DeepSeek Harness Desktop | Nexus Superharness |
| Deep-link scheme | `dsh://` | `nexus-superharness://`, still accepting `dsh://` |
| Artifact prefix | `dsh-desktop` | `nexus-superharness` |
| Dock icon | DeepSeek whale | Nexus monogram |
| Composer | Separate application | A product inside the window |

The bundle identifier is set at packaging time from `DSH_DESKTOP_APP_ID`, which releases now set to `com.onenexus.superharness`; the application does not carry a hardcoded default.

The user data directory is **not** renamed: `main.ts` still points `userData` at the established `@deepseek-ai/dsh-desktop` path so the rename keeps existing settings and plugin-operation state. Because the bundle identifier does change, an installed DeepSeek Harness Desktop is nevertheless a different application to macOS and does not update in place.

## Migration

1. Install Nexus Superharness from the release artifact; do not expect an existing DeepSeek Harness Desktop to update itself into it.
2. Settings, profiles and plugin-operation state carry over on their own — the user data path is unchanged. Do not copy that directory by hand.
3. Packaging scripts that read the old artifact name or scheme must be updated: artifacts are now `nexus-superharness-<version>-<os>-<arch>`, and links should use `nexus-superharness://`.
4. Quit the standalone Nexus Composer before selecting Composer in Superharness. While the standalone owns routing the embedded surface is read-only and says so.
5. Confirm `open -a "Nexus Superharness"` launches it, that the Dock shows the Nexus monogram, and that a `nexus-superharness://` link opens it.
