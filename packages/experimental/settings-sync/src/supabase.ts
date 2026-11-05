/** Minimal Supabase Auth and PostgREST client over `fetch`, limited to the endpoints settings sync uses. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SyncDeviceId, SyncItemKind, SyncUserId } from './types.ts'
import type { KdfParams, Sealed } from './crypto.ts'

/** Supabase Auth session persisted in the local credential store. */
export interface SupabaseSession {
  readonly accessToken: string
  readonly refreshToken: string
  /** Epoch milliseconds after which the access token is expired. */
  readonly expiresAt: number
  readonly userId: SyncUserId
  readonly email: string
}

/** Resolved connection settings for one Supabase project. */
export interface SupabaseSpec {
  /** HTTPS project origin. */
  readonly url: string
  /** Publishable (anon) API key; grants nothing without a user session because every table uses row-level security. */
  readonly key: string
  readonly timeoutMs: number
}

/** The account's key envelope; never contains the password or the key. */
export interface KeyEnvelope {
  readonly params: KdfParams
  readonly salt: Buffer
  readonly verifier: Sealed
}

/** One synced item row as stored server-side. */
export interface RemoteItem {
  readonly path: string
  readonly kind: SyncItemKind
  readonly sealed: Sealed
  /** Keyed plaintext digest. */
  readonly sha256: string
  readonly version: number
  readonly deleted: boolean
}

interface AuthResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string; email?: string }
}

interface ItemRow {
  path: string
  kind: SyncItemKind
  ciphertext: string
  nonce: string
  sha256: string
  version: number
  deleted: boolean
}

interface EnvelopeRow {
  kdf: string
  kdf_params: KdfParams
  salt: string
  verifier: string
}

/**
 * HTTP status of a Supabase request failure.
 * @param error - any thrown value.
 * @returns the status for `settings-sync/service-failed`, otherwise undefined.
 */
export function serviceStatus(error: unknown): number | undefined {
  if (!(error instanceof RemoteError) || error.code !== 'settings-sync/service-failed') return undefined
  return (error as RemoteError<'settings-sync/service-failed'>).details.status
}

/** PostgREST `bytea` hex literal. */
function toBytea(value: Buffer): string {
  return `\\x${value.toString('hex')}`
}

function fromBytea(value: string): Buffer {
  if (!value.startsWith('\\x')) throw new RemoteError('settings-sync/service-failed', 'Unexpected bytea encoding', { status: 200, reason: 'bytea' })
  return Buffer.from(value.slice(2), 'hex')
}

/** Verifier is stored as nonce followed by ciphertext. */
function packSealed(sealed: Sealed): Buffer {
  return Buffer.concat([sealed.nonce, sealed.ciphertext])
}

function unpackSealed(packed: Buffer): Sealed {
  return { nonce: packed.subarray(0, 12), ciphertext: packed.subarray(12) }
}

/** Stateless request helper; callers own session refresh and persistence. */
export class SupabaseClient {
  constructor(private readonly spec: SupabaseSpec) {}

  /**
   * Sign in with the account's Supabase password.
   * @param email - account email.
   * @param password - Supabase Auth password; distinct from the sync password.
   * @returns new session.
   */
  async signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
    return this.session(await this.request<AuthResponse>('POST', '/auth/v1/token?grant_type=password', undefined, { email, password }))
  }

  /**
   * Ask Supabase to email a one-time code, creating the account when it does not exist.
   * @param email - account email.
   */
  async requestCode(email: string): Promise<void> {
    await this.request('POST', '/auth/v1/otp', undefined, { email, create_user: true })
  }

  /**
   * Exchange an emailed one-time code for a session.
   * @param email - account email the code was sent to.
   * @param code - code from the email.
   * @returns new session.
   */
  async verifyCode(email: string, code: string): Promise<SupabaseSession> {
    return this.session(await this.request<AuthResponse>('POST', '/auth/v1/verify', undefined, { type: 'email', email, token: code }))
  }

  /**
   * Rotate the session's refresh token.
   * @param session - current session.
   * @returns replacement session.
   */
  async refresh(session: SupabaseSession): Promise<SupabaseSession> {
    return this.session(await this.request<AuthResponse>('POST', '/auth/v1/token?grant_type=refresh_token', undefined, { refresh_token: session.refreshToken }))
  }

  /**
   * Revoke the session server-side.
   * @param session - session to revoke.
   */
  async signOut(session: SupabaseSession): Promise<void> {
    await this.request('POST', '/auth/v1/logout', session)
  }

  /**
   * @param session - signed-in session.
   * @returns the account's key envelope, or undefined before a sync password was set.
   */
  async readEnvelope(session: SupabaseSession): Promise<KeyEnvelope | undefined> {
    const rows = await this.request<EnvelopeRow[]>('GET', '/rest/v1/dsh_sync_key_envelopes?select=kdf,kdf_params,salt,verifier', session)
    const row = rows[0]
    if (row === undefined) return undefined
    if (row.kdf !== 'scrypt') throw new RemoteError('settings-sync/service-failed', `Unsupported key derivation ${row.kdf}`, { status: 200, reason: 'kdf' })
    return { params: row.kdf_params, salt: fromBytea(row.salt), verifier: unpackSealed(fromBytea(row.verifier)) }
  }

  /**
   * Create the account's key envelope; fails when one already exists.
   * @param session - signed-in session.
   * @param envelope - new envelope.
   */
  async createEnvelope(session: SupabaseSession, envelope: KeyEnvelope): Promise<void> {
    await this.request('POST', '/rest/v1/dsh_sync_key_envelopes', session, {
      kdf: 'scrypt', kdf_params: envelope.params, salt: toBytea(envelope.salt), verifier: toBytea(packSealed(envelope.verifier)),
    }, { Prefer: 'return=minimal' })
  }

  /**
   * Register this device.
   * @param session - signed-in session.
   * @param name - display name.
   * @param platform - Node platform.
   * @returns server-issued device id.
   */
  async registerDevice(session: SupabaseSession, name: string, platform: 'darwin' | 'win32' | 'linux'): Promise<SyncDeviceId> {
    const rows = await this.request<{ id: string }[]>('POST', '/rest/v1/dsh_sync_devices?select=id', session, { name, platform }, {
      Prefer: 'return=representation',
    })
    const id = rows[0]?.id
    if (id === undefined) throw new RemoteError('settings-sync/service-failed', 'Device registration returned no row', { status: 200, reason: 'device' })
    return brandString<SyncDeviceId>(id)
  }

  /**
   * @param session - signed-in session.
   * @returns every item row of the signed-in account.
   */
  async listItems(session: SupabaseSession): Promise<RemoteItem[]> {
    const query = 'select=path,kind,ciphertext,nonce,sha256,version,deleted&deleted=is.false'
    const rows = await this.request<ItemRow[]>('GET', `/rest/v1/dsh_sync_items?${query}`, session)
    return rows.map(row => ({
      path: row.path, kind: row.kind, sha256: row.sha256, version: row.version, deleted: row.deleted,
      sealed: { nonce: fromBytea(row.nonce), ciphertext: fromBytea(row.ciphertext) },
    }))
  }

  /**
   * Write one item if the server still holds `expectedVersion` (0 creates).
   * @param session - signed-in session.
   * @param item - path, kind, sealed bytes, and keyed digest.
   * @param deviceId - writing device.
   * @param expectedVersion - version the caller last read.
   * @returns the new version, or undefined when another device wrote first.
   */
  async putItem(session: SupabaseSession, item: Omit<RemoteItem, 'version' | 'deleted'>, deviceId: SyncDeviceId, expectedVersion: number): Promise<number | undefined> {
    try {
      return await this.request<number>('POST', '/rest/v1/rpc/dsh_sync_put_item', session, {
        p_path: item.path, p_kind: item.kind, p_encrypted: true, p_content: null,
        p_ciphertext: toBytea(item.sealed.ciphertext), p_nonce: toBytea(item.sealed.nonce), p_storage_path: null,
        p_sha256: item.sha256, p_deleted: false, p_device_id: deviceId, p_expected_version: expectedVersion,
      })
    } catch (error) {
      if (serviceStatus(error) === 409) return undefined
      throw error
    }
  }

  private session(response: AuthResponse): SupabaseSession {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      userId: brandString<SyncUserId>(response.user.id),
      email: response.user.email ?? '',
    }
  }

  private async request<T = unknown>(method: 'GET' | 'POST', path: string, session: SupabaseSession | undefined, body?: object, headers: Record<string, string> = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(new URL(path, this.spec.url), {
        method,
        headers: {
          apikey: this.spec.key,
          Authorization: `Bearer ${session?.accessToken ?? this.spec.key}`,
          ...body === undefined ? {} : { 'Content-Type': 'application/json' },
          ...headers,
        },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.spec.timeoutMs),
      })
    } catch (error) {
      throw new RemoteError('settings-sync/service-failed', `Supabase request failed: ${String(error)}`, { status: 0, reason: String(error) }, { cause: error })
    }
    const text = await response.text()
    if (response.status === 401 && session !== undefined) throw new RemoteError('settings-sync/signed-out', 'Supabase rejected the session', {})
    if (!response.ok) {
      throw new RemoteError('settings-sync/service-failed', `Supabase ${method} ${new URL(path, this.spec.url).pathname} returned ${response.status}: ${text.slice(0, 300)}`, { status: response.status, reason: text.slice(0, 300) })
    }
    return (text === '' ? undefined : JSON.parse(text)) as T
  }
}
