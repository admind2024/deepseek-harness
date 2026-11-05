/** Register the settings sync page and its Remote for one client plugin lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-experimental-settings-sync/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { SyncController } from './controller.ts'
import { de, en, es, fr, ja, pt, ru, zh, type SyncKey } from './locales.ts'
import { SyncSection, type SyncInjected } from './SyncSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings sync page copy. */
    settingsSync: SyncKey
  }
}

/** Services the page needs. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Mount the Remote, then register the page for the same lifetime.
 * @param ctx - client plugin context.
 * @param contribution - generated Remote descriptors supplied by the built entry.
 * @returns disposer removing the page before the Remote contribution.
 */
export async function mountSettingsSync(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution)
  const page = ctx.inject(['remote.settingsSync'], registerPage)
  try { await page } catch (error) { await page.dispose(); await unmount(); throw error }
  return async () => { await page.dispose(); await unmount() }
}

function registerPage(ctx: Context): void {
  const controller = new SyncController(ctx.remote.settingsSync)
  const t = ctx.locale.bind('settingsSync')
  const face = (): SyncInjected => ({ hooks: { sync: controller.state }, controller })
  ctx.effect(() => ctx.locale.register('settingsSync', { en, zh, ja, es, fr, de, ru, pt }), 'settings-sync: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'settings-sync', order: 60, label: () => t('nav'), locale: 'settingsSync', inject: face,
  }, SyncSection))
}
