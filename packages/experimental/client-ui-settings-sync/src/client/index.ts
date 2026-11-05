/** Bind the generated Remote contribution to the source-tested browser lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-experimental-settings-sync/remote'
import { mountSettingsSync } from './mount.ts'
export { inject } from './mount.ts'

/**
 * Mount the settings sync page and its Remote.
 * @param ctx - client plugin context.
 * @returns disposer for both contributions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountSettingsSync(ctx, remote)
}
