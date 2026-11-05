---
description: "默认关闭的设置同步及其设置页面组合，已配置为使用 MOA Supabase 项目。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-settings-sync-bundle

[English](README.md) | 中文

## 概述

向 profile 插入 `settingsSync` Remote 与 **设置同步** 页面。Remote 配置为 MOA 项目的源与其可公开密钥。

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

在 **插件 → 实验插件 → 设置同步** 中开启，然后打开 **设置 → 设置同步**。要使用其他 Supabase 项目，请在 profile 补丁中覆盖 `settings-sync` 行的 `supabaseUrl` 与 `supabaseKey`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`cordis.patch.yml` 插入 `settings-sync` 与 `ui-settings-sync` 两行。由于所有同步表都使用仅属主的行级安全，可公开密钥在没有已登录用户时不授予任何权限。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[设置同步 Remote](../settings-sync/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为组合的包在模型请求之外修改文件与凭据。

#### KV 缓存影响

没有直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Supabase 项目固定在 bundle 补丁中；使用其他项目需要 profile 覆盖。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
