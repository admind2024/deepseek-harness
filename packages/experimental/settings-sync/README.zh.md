---
description: "通过 Supabase 账户以端到端加密在设备之间同步当前 profile 补丁、模型选择与已存储的 API 密钥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-settings-sync

[English](README.md) | 中文

## 概述

`settingsSync` Remote 登录 Supabase 项目，并交换当前 profile 的 `cordis.patch.yml`、`<DSH_HOME>/flashx.yml` 以及 `.credentials.yaml` 中存储的凭据引用。每个条目都在设备上用由独立同步密码派生的密钥加密；Supabase 只保存密文与带密钥的摘要。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

与凭据提供方、`profileContext` 和 Typert 组合。`supabaseUrl` 是项目的 HTTPS 源，`supabaseKey` 是其可公开密钥，二者均为必填。`requestTimeoutMs` 限制每个请求。`scryptCostLog2` 设定新建密钥信封的 scrypt 成本；已有信封保留其存储的成本。

项目需要带仅属主行级安全的 `dsh_sync_devices`、`dsh_sync_key_envelopes`、`dsh_sync_items` 表，以及 `dsh_sync_put_item` 函数；该函数以 SQLSTATE `PT409`（HTTP 409）拒绝过期的 `p_expected_version`。

设备通过 `signInWithPassword(email, password)`，或先 `requestCode(email)` 再 `verifyCode(email, code)` 登录，然后调用 `unlock(syncPassword)`。账户的首次 `unlock` 会创建密钥信封；之后的设备必须输入相同的同步密码，否则调用以 `settings-sync/wrong-password` 失败。`sync(mode)` 返回已上传、已下载、未变化与冲突的逻辑路径。`signOut()` 从本设备移除会话与条目密钥，账户中的已同步数据保持不变。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

scrypt（`N = 2^scryptCostLog2`、`r = 8`、`p = 1`）由经 NFKC 规范化的同步密码与信封盐派生 256 位密钥。AES-256-GCM 以条目的逻辑路径作为关联数据封装每个条目，因此被移到其他路径的行无法通过认证。信封保存一个封装的校验值用于检查密码。摘要是条目密钥下的 HMAC-SHA-256，因此服务器无法确认猜测的密钥。

Supabase 会话与派生密钥是本地凭据存储中的 `grant` 记录 `settings-sync/session` 与 `settings-sync/item-key`，它们从不同步。60 秒内过期的访问令牌会先刷新；刷新被拒绝时移除会话并报告 `settings-sync/signed-out`。

每轮比较本地摘要、服务器版本与 `<DSH_HOME>/settings-sync/state.json`。一侧的变更移到另一侧；内容相同时采用服务器版本；两侧都变更时，`merge` 报告冲突，`prefer-local` 上传，`prefer-remote` 下载。上传携带最后看到的版本，因此并发写入者导致冲突而不是覆盖。同一 Host 上的操作串行执行。

下载的文件以模式 `0600` 原子写入；凭据引用通过 `ctx.credentials.set` 写入。只上传凭据文件存储的引用；环境变量与 `.env` 中的值留在本地。其他 profile 名的条目留在服务器上。凭据引用按名称合并而不是冲突：若本设备自上次同步后修改过，则同名时以本设备的值为准，否则以服务器的值为准；只存在于一侧的名称都会保留。因此删除的引用不会在其他设备上被删除。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[凭据存储](../../credentials/credentials-local/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为同步在模型请求之外修改文件与凭据；下载的 profile 补丁只通过其配置的插件影响模型。

#### KV 缓存影响

无直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 没有 Realtime 实时同步；同步按请求执行。
- 忘记的同步密码无法找回；此时需重新输入已同步的密钥。
- 不同步 Desktop 快捷键、Session 历史、附件与 OAuth grant 记录。
- 当下载的补丁缺少本插件的行时，替换 profile 补丁可能停用本插件。
- Supabase 响应在 HTTP 状态检查后即被信任；行字段未经 schema 校验。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

Desktop Host 运行在基于 BoringSSL 的 Electron Node 下，缺少 `crypto.argon2`，因此使用 scrypt。

</details>
