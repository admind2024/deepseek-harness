/** Per-item three-way decision between local bytes, the server row, and the version this device last synced. */
import type { SyncMode } from './types.ts'

/** Local side of one item. */
export interface LocalSide<Item> {
  readonly item: Item
  /** Keyed digest of the local bytes. */
  readonly sha256: string
}

/** Server side of one item; `deleted` rows count as absent. */
export interface RemoteSide {
  readonly version: number
  readonly sha256: string
  readonly deleted: boolean
}

/** Last version and digest this device synced for one item. */
export interface SeenSide {
  readonly version: number
  readonly sha256: string
}

/** What one sync pass does for one item. */
export type SyncAction<Item, Remote extends RemoteSide> =
  | { readonly type: 'upload'; readonly local: LocalSide<Item>; readonly expectedVersion: number }
  | { readonly type: 'download'; readonly remote: Remote }
  | { readonly type: 'adopt'; readonly remote: Remote }
  | { readonly type: 'conflict' }
  | { readonly type: 'none' }

/**
 * Decide one item. Equal digests adopt the server version without transfer; a change on one side moves it to the
 * other side; a change on both sides follows `mode`.
 * @param local - local bytes, or undefined when absent locally.
 * @param remote - server row, or undefined when absent remotely.
 * @param seen - state from this device's previous pass, or undefined when never synced.
 * @param mode - resolution for items changed on both sides.
 * @returns the action for this item.
 */
export function decide<Item, Remote extends RemoteSide>(
  local: LocalSide<Item> | undefined, remote: Remote | undefined, seen: SeenSide | undefined, mode: SyncMode,
): SyncAction<Item, Remote> {
  const live = remote !== undefined && !remote.deleted ? remote : undefined
  if (local !== undefined && live !== undefined && local.sha256 === live.sha256) return { type: 'adopt', remote: live }
  const localChanged = local !== undefined && local.sha256 !== seen?.sha256
  const remoteChanged = live !== undefined && live.version !== seen?.version
  if (local !== undefined && localChanged && (!remoteChanged || mode === 'prefer-local')) {
    return { type: 'upload', local, expectedVersion: remote?.version ?? 0 }
  }
  if (live !== undefined && remoteChanged && (!localChanged || mode === 'prefer-remote')) return { type: 'download', remote: live }
  return localChanged && remoteChanged ? { type: 'conflict' } : { type: 'none' }
}
