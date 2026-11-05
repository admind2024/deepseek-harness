---
description: "Sync the active profile patch, model selection, and stored API keys across devices through a Supabase account with end-to-end encryption."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-settings-sync

English | [中文](README.zh.md)

## Summary

The `settingsSync` Remote signs in to a Supabase project and exchanges the active profile's `cordis.patch.yml`, `<DSH_HOME>/flashx.yml`, and the credential references stored in `.credentials.yaml`. Every item is encrypted on the device with a key derived from a separate sync password; Supabase stores only ciphertext and keyed digests.

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

Compose with the credential provider, `profileContext`, and Typert. `supabaseUrl` is the project's HTTPS origin and `supabaseKey` its publishable key; both are required. `requestTimeoutMs` bounds each request. `scryptCostLog2` sets the scrypt cost of a newly created key envelope; existing envelopes keep their stored cost.

The project needs the `dsh_sync_devices`, `dsh_sync_key_envelopes`, and `dsh_sync_items` tables with owner-only row-level security and the `dsh_sync_put_item` function, which rejects a stale `p_expected_version` with SQLSTATE `PT409` (HTTP 409).

A device signs in with `signInWithPassword(email, password)` or `requestCode(email)` then `verifyCode(email, code)`, and calls `unlock(syncPassword)`. The first `unlock` for an account creates its key envelope; later devices must enter the same sync password, or the call fails with `settings-sync/wrong-password`. `sync(mode)` returns the uploaded, downloaded, unchanged, and conflicting logical paths. `signOut()` removes the session and item key from this device and leaves synced data in the account.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

scrypt (`N = 2^scryptCostLog2`, `r = 8`, `p = 1`) derives a 256-bit key from the NFKC-normalized sync password and the envelope salt. AES-256-GCM seals each item with its logical path as associated data, so a row moved to another path fails authentication. The envelope stores a sealed verifier for password checks. Digests are HMAC-SHA-256 under the item key, so the server cannot confirm a guessed secret.

The Supabase session and derived key are `grant` records `settings-sync/session` and `settings-sync/item-key` in the local credential store, which is never synced. An access token that expires within 60 seconds is refreshed first; a rejected refresh removes the session and reports `settings-sync/signed-out`.

Each pass compares local digests, server versions, and `<DSH_HOME>/settings-sync/state.json`. A change on one side moves to the other side; equal content adopts the server version; a change on both sides is reported under `merge`, uploaded under `prefer-local`, and downloaded under `prefer-remote`. Uploads pass the last seen version, so a concurrent writer causes a conflict rather than an overwrite. Operations on one Host run serially.

Downloaded files are written atomically with mode `0600`; credential references go through `ctx.credentials.set`. Only references the credential file stores are uploaded; environment and `.env` values stay local. Items of another profile name are left on the server. Credential references merge by name instead of conflicting: when this device changed them since its last pass its values win for shared names, otherwise the server's values win, and names present on only one side are kept. A removed reference is therefore not removed on other devices.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Credential store](../../credentials/credentials-local/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as sync changes files and credentials outside model requests; a downloaded profile patch affects models only through the plugins it configures.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No live Realtime sync; passes run on request.
- A forgotten sync password cannot be recovered; synced keys must then be entered again.
- Desktop keybindings, Session history, attachments, and OAuth grant records are not synced.
- Replacing the profile patch can disable this plugin when the downloaded patch omits its row.
- Supabase responses are trusted after HTTP status checks; row fields are not schema-validated.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The Desktop Host runs under Electron's BoringSSL-based Node, which lacks `crypto.argon2`; scrypt is used for that reason.

</details>
