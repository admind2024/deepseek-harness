/**
 * End-to-end encrypted settings sync through the user's Supabase project. Sign-in, the derived item key, and the
 * device id stay in the local credential store; Supabase stores only ciphertext and keyed digests.
 */
import { hostname } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { checkVerifier, createSalt, createVerifier, deriveKey, digest, open, seal, type KdfParams } from './crypto.ts'
import { decide } from './decide.ts'
import { applyItem, collectLocalItems, type ItemLocations } from './items.ts'
import { serviceStatus, SupabaseClient, type SupabaseSession, type SupabaseSpec } from './supabase.ts'
import type { SyncDeviceId, SyncMode, SyncReport, SyncStatus, SyncUserId } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental encrypted settings sync. */
    settingsSync: SettingsSync
  }
}

/** Deployment settings for the Supabase project and key derivation cost. */
export interface Config {
  /** HTTPS origin of the Supabase project. */
  supabaseUrl: string
  /** Publishable (anon) key of that project. */
  supabaseKey: string
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number
  /** scrypt cost exponent used when a new key envelope is created; existing envelopes keep their stored cost. */
  scryptCostLog2: number
}

/** Per-device record of the last version and digest seen for each path. */
interface SyncState {
  userId: SyncUserId
  deviceId?: SyncDeviceId
  items: Record<string, { version: number; sha256: string }>
}

const SESSION_KEY = credentialKey('settings-sync', 'session')
const ITEM_KEY = credentialKey('settings-sync', 'item-key')
const REFRESH_MARGIN_MS = 60_000

function grant(record: CredentialRecord | undefined): Record<string, unknown> | undefined {
  return record?.kind === 'grant' && typeof record.payload === 'object' && record.payload !== null && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : undefined
}

function platform(): 'darwin' | 'win32' | 'linux' {
  /* v8 ignore next -- each test run has one host platform */
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
}

/** Settings sync Remote; every operation runs serialized so two passes never interleave writes. */
export default class SettingsSync extends TypertRemoteService {
  static inject = ['credentials', 'profileContext', 'typert']
  static Config: z<Config> = z.object({
    supabaseUrl: z.string().pattern(/^https:\/\/[^/?#]+$/).required(),
    supabaseKey: z.string().min(1).required(),
    requestTimeoutMs: z.natural().min(1).default(30_000),
    scryptCostLog2: z.natural().min(14).max(20).default(17),
  })

  private readonly client: SupabaseClient
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'settingsSync', { namespace: 'settingsSync' })
    this.client = new SupabaseClient(this.resolve(config))
  }

  /**
   * @param config - validated plugin configuration.
   * @returns explicit Supabase connection settings.
   */
  resolve(config: Config): SupabaseSpec {
    return { url: config.supabaseUrl, key: config.supabaseKey, timeoutMs: config.requestTimeoutMs }
  }

  /** @returns sign-in and key state of this device. */
  @Remote
  async status(): Promise<SyncStatus> {
    const session = await this.storedSession()
    const key = grant(await this.ctx.credentials.readRecord(ITEM_KEY))
    return {
      signedIn: session !== undefined,
      ...session === undefined ? {} : { email: session.email },
      unlocked: session !== undefined && key?.userId === session.userId,
    }
  }

  /**
   * Sign in with the Supabase account password.
   * @param email - account email.
   * @param password - Supabase Auth password, not the sync password.
   * @returns updated status.
   */
  @Remote
  signInWithPassword(email: string, password: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      await this.storeSession(await this.client.signInWithPassword(email, password))
      return this.status()
    })
  }

  /**
   * Email a one-time sign-in code.
   * @param email - account email.
   * @returns after Supabase accepted the request.
   */
  @Remote
  requestCode(email: string): Promise<void> {
    return this.client.requestCode(email)
  }

  /**
   * Sign in with an emailed one-time code.
   * @param email - account email.
   * @param code - code from the email.
   * @returns updated status.
   */
  @Remote
  verifyCode(email: string, code: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      await this.storeSession(await this.client.verifyCode(email, code))
      return this.status()
    })
  }

  /**
   * Sign out and forget the session, item key, and sync state on this device. Synced data stays in the account.
   * @returns updated status.
   */
  @Remote
  signOut(): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const session = await this.storedSession()
      if (session !== undefined) {
        await this.client.signOut(session).catch((error: unknown) => {
          // Server-side revocation is best effort; local sign-out must still complete.
          this.ctx.logger.warn(`settings-sync: Supabase sign-out failed: ${String(error)}`)
        })
      }
      await this.ctx.credentials.deleteRecord(SESSION_KEY)
      await this.ctx.credentials.deleteRecord(ITEM_KEY)
      return this.status()
    })
  }

  /**
   * Derive the item key from the sync password and store it on this device. The first device creates the key envelope.
   * @param password - sync password; never sent to Supabase.
   * @returns updated status.
   */
  @Remote
  unlock(password: string): Promise<SyncStatus> {
    return this.exclusive(async () => {
      const session = await this.requireSession()
      const envelope = await this.client.readEnvelope(session)
      let key: Buffer
      if (envelope === undefined) {
        const params: KdfParams = { N: 2 ** this.config.scryptCostLog2, r: 8, p: 1 }
        const salt = createSalt()
        key = await deriveKey(password, salt, params)
        await this.client.createEnvelope(session, { params, salt, verifier: createVerifier(key) })
      } else {
        key = await deriveKey(password, envelope.salt, envelope.params)
        if (!checkVerifier(key, envelope.verifier)) throw new RemoteError('settings-sync/wrong-password', 'The sync password does not match this account', {})
      }
      await this.ctx.credentials.modifyRecord(ITEM_KEY, () => Promise.resolve({ kind: 'grant', payload: { userId: session.userId, key: key.toString('base64') } }))
      return this.status()
    })
  }

  /**
   * Upload local changes and download remote changes.
   * @param mode - resolution for items changed on both sides.
   * @returns paths grouped by action.
   */
  @Remote
  sync(mode: SyncMode): Promise<SyncReport> {
    return this.exclusive(() => this.syncPass(mode))
  }

  private async syncPass(mode: SyncMode): Promise<SyncReport> {
    const session = await this.requireSession()
    const key = await this.requireKey(session)
    const locations = this.locations()
    const state = await this.readState(session.userId)
    if (state.deviceId === undefined) {
      state.deviceId = await this.client.registerDevice(session, hostname(), platform())
      await this.writeState(state)
    }
    const deviceId = state.deviceId
    const local = new Map((await collectLocalItems(locations, this.ctx.credentials)).map(item => [item.path, item]))
    const remote = new Map((await this.client.listItems(session)).map(item => [item.path, item]))
    const report = { uploaded: [] as string[], downloaded: [] as string[], unchanged: [] as string[], conflicts: [] as string[] }

    for (const path of [...new Set([...local.keys(), ...remote.keys()])].sort()) {
      const localItem = local.get(path)
      const localSide = localItem === undefined ? undefined : { item: localItem, sha256: digest(key, localItem.content) }
      const action = decide(localSide, remote.get(path), state.items[path], mode)
      switch (action.type) {
        case 'upload': {
          const { item, sha256 } = action.local
          const sealed = seal(key, item.content, item.path)
          const version = await this.client.putItem(session, { path, kind: item.kind, sealed, sha256 }, deviceId, action.expectedVersion)
          if (version === undefined) {
            report.conflicts.push(path)
          } else {
            state.items[path] = { version, sha256 }
            report.uploaded.push(path)
          }
          break
        }
        case 'download':
          if (await applyItem(locations, this.ctx.credentials, path, open(key, action.remote.sealed, path))) {
            state.items[path] = { version: action.remote.version, sha256: action.remote.sha256 }
            report.downloaded.push(path)
          }
          break
        case 'adopt':
          state.items[path] = { version: action.remote.version, sha256: action.remote.sha256 }
          report.unchanged.push(path)
          break
        case 'conflict':
          report.conflicts.push(path)
          break
        case 'none':
          report.unchanged.push(path)
          break
        /* v8 ignore next 2 -- closed-union exhaustiveness guard */
        default:
          assertNever(action)
      }
    }
    await this.writeState(state)
    return report
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => {
      // The caller receives this failure; the queue only orders later operations.
    })
    return next
  }

  private locations(): ItemLocations {
    const profile = this.ctx.profileContext
    return { home: profile.home, profileName: profile.name, patchPath: profile.patchPath }
  }

  private statePath(): string {
    return join(this.ctx.profileContext.home, 'settings-sync', 'state.json')
  }

  private async readState(userId: SyncUserId): Promise<SyncState> {
    let text: string
    try {
      text = await readFile(this.statePath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { userId, items: {} }
      throw error
    }
    const state = JSON.parse(text) as SyncState
    // State of a different account would mark that account's versions as already seen.
    return state.userId === userId ? state : { userId, items: {} }
  }

  private writeState(state: SyncState): Promise<void> {
    return writeFileAtomic(this.statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }

  private async storeSession(session: SupabaseSession): Promise<void> {
    await this.ctx.credentials.modifyRecord(SESSION_KEY, () => Promise.resolve({ kind: 'grant', payload: { ...session } }))
  }

  private async storedSession(): Promise<SupabaseSession | undefined> {
    const payload = grant(await this.ctx.credentials.readRecord(SESSION_KEY))
    if (payload === undefined) return undefined
    const { accessToken, refreshToken, expiresAt, userId, email } = payload
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresAt !== 'number' || typeof userId !== 'string' || typeof email !== 'string') return undefined
    return { accessToken, refreshToken, expiresAt, userId: brandString<SyncUserId>(userId), email }
  }

  private async requireSession(): Promise<SupabaseSession> {
    const session = await this.storedSession()
    if (session === undefined) throw new RemoteError('settings-sync/signed-out', 'Sign in to sync settings', {})
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session
    const refreshed = await this.client.refresh(session).catch(async (error: unknown) => {
      if (serviceStatus(error) === 400) {
        await this.ctx.credentials.deleteRecord(SESSION_KEY)
        throw new RemoteError('settings-sync/signed-out', 'The Supabase session expired; sign in again', {}, { cause: error })
      }
      throw error
    })
    await this.storeSession(refreshed)
    return refreshed
  }

  private async requireKey(session: SupabaseSession): Promise<Buffer> {
    const payload = grant(await this.ctx.credentials.readRecord(ITEM_KEY))
    if (payload?.userId !== session.userId || typeof payload.key !== 'string') throw new RemoteError('settings-sync/locked', 'Enter the sync password on this device', {})
    return Buffer.from(payload.key, 'base64')
  }
}
