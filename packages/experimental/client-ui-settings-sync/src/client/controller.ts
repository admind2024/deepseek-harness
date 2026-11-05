/** Browser state for the settings sync page: one serialized Remote call at a time and a localized failure key. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SyncMode, SyncReport, SyncStatus } from '@deepseek-ai/dsh-experimental-settings-sync/types'
import type { SyncKey } from './locales.ts'

/** Remote methods the page calls; the generated `ctx.remote.settingsSync` satisfies it. */
export interface SyncRemote {
  status(): Promise<RemoteResult<SyncStatus>>
  signInWithPassword(email: string, password: string): Promise<RemoteResult<SyncStatus>>
  requestCode(email: string): Promise<RemoteResult<void>>
  verifyCode(email: string, code: string): Promise<RemoteResult<SyncStatus>>
  unlock(password: string): Promise<RemoteResult<SyncStatus>>
  sync(mode: SyncMode): Promise<RemoteResult<SyncReport>>
  signOut(): Promise<RemoteResult<SyncStatus>>
}

/** Page step derived from the Host status plus the pending emailed code. */
export type SyncPhase = 'loading' | 'signed-out' | 'code-sent' | 'locked' | 'ready'

/** Complete page state. */
export interface SyncViewState {
  phase: SyncPhase
  /** Signed-in email, or the email a code was sent to. */
  email: string
  busy: boolean
  /** Localized key of the last failure; cleared by the next call. */
  error: SyncKey | undefined
  /** Result of the last sync pass. */
  report: SyncReport | undefined
}

/** Failure keys for Remote codes; unknown codes fall back to `errorService`. */
function errorKey(error: { readonly code: string; readonly details?: unknown }): SyncKey {
  switch (error.code) {
    case 'settings-sync/signed-out': return 'errorSignedOut'
    case 'settings-sync/locked': return 'errorLocked'
    case 'settings-sync/wrong-password': return 'errorWrongPassword'
    case 'settings-sync/service-failed': {
      const status = (error.details as { status?: unknown } | undefined)?.status
      if (status === 0) return 'errorNetwork'
      if (status === 400 || status === 401 || status === 403) return 'errorCredentials'
      return 'errorService'
    }
    default: return 'errorService'
  }
}

function phaseOf(status: SyncStatus): SyncPhase {
  if (!status.signedIn) return 'signed-out'
  return status.unlocked ? 'ready' : 'locked'
}

/** Page controller; every action ignores input while another call is running. */
export class SyncController {
  /** Page state observed by the section component. */
  readonly state: SnapshotStore<SyncViewState>

  constructor(private readonly remote: SyncRemote) {
    this.state = createSnapshotStore<SyncViewState>({ phase: 'loading', email: '', busy: false, error: undefined, report: undefined }, { flush: 'sync' })
  }

  /**
   * Read the Host status and move to its step.
   * @returns after the Host status was read.
   */
  refresh(): Promise<void> {
    return this.run(() => this.remote.status(), (status) => { this.applyStatus(status) })
  }

  /**
   * Sign in with the account password.
   * @param email - account email.
   * @param password - account password.
   * @returns after the attempt settled.
   */
  signIn(email: string, password: string): Promise<void> {
    return this.run(() => this.remote.signInWithPassword(email, password), (status) => { this.applyStatus(status) })
  }

  /**
   * Email a one-time code and move to code entry.
   * @param email - account email that receives the code.
   * @returns after the request settled.
   */
  requestCode(email: string): Promise<void> {
    return this.run(() => this.remote.requestCode(email), () => { this.state.update((draft) => { draft.phase = 'code-sent'; draft.email = email }) })
  }

  /**
   * Sign in with the emailed code.
   * @param code - code from the email.
   * @returns after the attempt settled.
   */
  verifyCode(code: string): Promise<void> {
    const email = this.state.getSnapshot().email
    return this.run(() => this.remote.verifyCode(email, code), (status) => { this.applyStatus(status) })
  }

  /** Return from code entry to the sign-in form. */
  cancelCode(): void {
    this.state.update((draft) => { draft.phase = 'signed-out'; draft.error = undefined })
  }

  /**
   * Store the item key derived from the sync password on this device.
   * @param password - sync password.
   * @returns after the attempt settled.
   */
  unlock(password: string): Promise<void> {
    return this.run(() => this.remote.unlock(password), (status) => { this.applyStatus(status) })
  }

  /**
   * Run one sync pass and keep its report.
   * @param mode - two-sided change resolution.
   * @returns after the pass settled.
   */
  sync(mode: SyncMode): Promise<void> {
    return this.run(() => this.remote.sync(mode), (report) => { this.state.update((draft) => { draft.report = report }) })
  }

  /**
   * Sign out on this device.
   * @returns after local sign-out settled.
   */
  signOut(): Promise<void> {
    return this.run(() => this.remote.signOut(), (status) => { this.applyStatus(status) })
  }

  private applyStatus(status: SyncStatus): void {
    this.state.update((draft) => {
      draft.phase = phaseOf(status)
      draft.email = status.email ?? ''
      if (draft.phase !== 'ready') draft.report = undefined
    })
  }

  private async run<T>(call: () => Promise<RemoteResult<T>>, accept: (value: T) => void): Promise<void> {
    if (this.state.getSnapshot().busy) return
    this.state.update((draft) => { draft.busy = true; draft.error = undefined })
    try {
      const result = await call()
      if (result.ok) {
        accept(result.value)
      } else {
        const key = errorKey(result.error)
        this.state.update((draft) => {
          draft.error = key
          if (key === 'errorSignedOut') draft.phase = 'signed-out'
          if (key === 'errorLocked') draft.phase = 'locked'
        })
      }
    } finally {
      this.state.update((draft) => { draft.busy = false })
    }
  }
}
