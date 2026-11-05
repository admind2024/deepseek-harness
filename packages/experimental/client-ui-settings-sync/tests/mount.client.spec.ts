// @vitest-environment jsdom
/** The page registers with its copy and Remote for the plugin lifetime and leaves both on unload. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { inject, mountSettingsSync } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'

it('registers the settings section with localized navigation and releases the Remote on dispose', async () => {
  hostApply()
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  type Options = { id: string; label: () => string; inject: () => { controller: object } }
  const register = vi.fn((_options: Options, _component: unknown) => () => {})
  ctx.provide('slots', { inject: (_name: string, fn: () => () => void) => { ctx.effect(fn) }, register })
  const settingsSync = { status: vi.fn() }
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { settingsSync, $mount: vi.fn(async () => unmount) })
  ctx.provide('remote.settingsSync', settingsSync)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = await ctx.plugin({ inject, apply: (c: Context) => mountSettingsSync(c, { package: '@deepseek-ai/dsh-experimental-settings-sync', descriptors: [] }) })
  const options = register.mock.calls[0]![0]
  expect(options).toMatchObject({ name: 'settings.section', id: 'settings-sync', locale: 'settingsSync' })
  expect(options.label()).toBe('Settings sync')
  expect(options.inject().controller).toBeDefined()
  await fiber.dispose()
  expect(unmount).toHaveBeenCalled()
})

it('releases the Remote when page registration fails without the locale service', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { $mount: vi.fn(async () => unmount) })
  ctx.provide('remote.settingsSync', { status: vi.fn() })
  await expect(mountSettingsSync(ctx, { package: '@deepseek-ai/dsh-experimental-settings-sync', descriptors: [] })).rejects.toThrow()
  expect(unmount).toHaveBeenCalled()
})
