---
description: "Settings page for signing in to settings sync, entering the sync password, and running sync passes."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-settings-sync

English | [中文](README.zh.md)

## Summary

Adds the **Settings sync** page to Settings. It drives the `settingsSync` Remote through sign-in by password or emailed code, the sync password, manual sync, conflict resolution, and sign-out.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web application bundle composes it with `@deepseek-ai/dsh-experimental-settings-sync`. The page registers in the `settings.section` slot with id `settings-sync`, and a first-run step registers in `settings.onboarding` with id `settings-sync` at order -50, before the DeepSeek credential step. The step signs in, unlocks, and runs a `merge` pass; conflicts ask which side to keep. It finishes without showing anything when the device already syncs or when the user skipped it before, which is remembered in browser storage.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`SyncController` keeps one snapshot of the page step, account email, last report, and a localized failure key. It runs one Remote call at a time and ignores actions while a call is pending. A `settings-sync/signed-out` or `settings-sync/locked` failure moves the page to the matching step. Passwords live only in component state and are cleared on each step change.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Settings sync Remote](../settings-sync/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the page only calls the settings-sync Remote, which changes files and credentials outside model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- After first run, sync runs only when the user presses **Sync now**; there is no background or Realtime sync.
- Conflicts are resolved for all conflicting items at once.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
