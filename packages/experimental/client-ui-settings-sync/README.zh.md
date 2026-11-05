---
description: "用于登录设置同步、输入同步密码并执行同步的设置页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-settings-sync

[English](README.md) | 中文

## 概述

在设置中添加 **设置同步** 页面。它通过 `settingsSync` Remote 完成密码或邮件验证码登录、同步密码、手动同步、冲突处理与退出登录。

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

Web 应用 bundle 将其与 `@deepseek-ai/dsh-experimental-settings-sync` 组合。页面以 id `settings-sync` 注册到 `settings.section` 插槽；首次运行步骤以 id `settings-sync`、顺序 -50 注册到 `settings.onboarding`，位于 DeepSeek 凭据步骤之前。该步骤完成登录与解锁并执行一次 `merge` 同步；出现冲突时询问保留哪一侧。当设备已在同步或用户此前跳过时，它不显示任何内容直接结束，跳过记录保存在浏览器存储中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`SyncController` 维护页面步骤、账户邮箱、最近一次同步结果与本地化失败键的快照。它一次只运行一个 Remote 调用，调用进行中时忽略其他操作。`settings-sync/signed-out` 或 `settings-sync/locked` 失败会将页面切换到对应步骤。密码只保存在组件状态中，并在每次步骤切换时清空。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[设置同步 Remote](../settings-sync/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为该页面只调用 settings-sync Remote，后者在模型请求之外修改文件与凭据。

#### KV 缓存影响

没有直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 首次运行之后，只有在用户点击 **立即同步** 时才会同步；没有后台或 Realtime 同步。
- 冲突一次性对所有冲突条目统一处理。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
