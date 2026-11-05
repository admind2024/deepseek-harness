---
description: "Default-disabled composition of settings sync and its settings page, configured for the MOA Supabase project."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-settings-sync-bundle

English | [中文](README.zh.md)

## Summary

Inserts the `settingsSync` Remote and the **Settings sync** page into a profile. The Remote is configured with the MOA project origin and its publishable key.

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

Turn it on under **Plugins → Experimental plugins → Settings sync**, then open **Settings → Settings sync**. To use another Supabase project, override `supabaseUrl` and `supabaseKey` of the `settings-sync` row in the profile patch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` inserts rows `settings-sync` and `ui-settings-sync`. The publishable key grants nothing without a signed-in user because every sync table uses owner-only row-level security.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Settings sync Remote](../settings-sync/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the composed packages change files and credentials outside model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Supabase project is fixed in the bundle patch; another project needs a profile override.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
