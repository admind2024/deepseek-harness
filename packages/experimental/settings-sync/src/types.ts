/** JSON-safe inputs and results of the experimental settings sync Remote namespace. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The operation needs a Supabase sign-in that is absent or was revoked. */
    'settings-sync/signed-out': {}
    /** The operation needs the sync password entered on this device. */
    'settings-sync/locked': {}
    /** The sync password does not open the account's key envelope. */
    'settings-sync/wrong-password': {}
    /** Supabase rejected or failed a request; `status` is the HTTP status, or 0 when no response arrived. */
    'settings-sync/service-failed': { readonly status: number; readonly reason: string }
  }
}

/** Supabase Auth user id that owns synced rows. */
export type SyncUserId = Branded<'SyncUserId'>

/** Server-issued id of one registered device. */
export type SyncDeviceId = Branded<'SyncDeviceId'>

/** Item classes this package uploads; each maps to one local file or credential space. */
export type SyncItemKind = 'profile-patch' | 'model-selection' | 'credentials'

/** Sign-in and key state of this device, safe to display. */
export interface SyncStatus {
  readonly signedIn: boolean
  /** Signed-in account email; absent while signed out. */
  readonly email?: string
  /** Whether the derived encryption key is stored on this device. */
  readonly unlocked: boolean
}

/**
 * How {@link SettingsSync.sync} resolves an item changed both locally and remotely.
 * `merge` reports the conflict and changes neither side; `prefer-local` uploads; `prefer-remote` downloads.
 */
export type SyncMode = 'merge' | 'prefer-local' | 'prefer-remote'

/** Logical item paths grouped by the action one sync pass took. */
export interface SyncReport {
  readonly uploaded: readonly string[]
  readonly downloaded: readonly string[]
  readonly unchanged: readonly string[]
  /** Items changed on both sides and left untouched under `merge`. */
  readonly conflicts: readonly string[]
}
