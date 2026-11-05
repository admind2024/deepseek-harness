/** Fake Supabase endpoints and per-device Hosts for settings sync tests. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { afterEach, beforeEach, vi } from 'vitest'
import SettingsSync from '../src/index.ts'

export interface Row { path: string; kind: string; ciphertext: string; nonce: string; sha256: string; version: number; deleted: boolean }

/** In-memory stand-in for the Supabase endpoints the client calls, enforcing per-user ownership like row-level security. */
type Intercept = (method: string, path: string, body: Record<string, unknown> | undefined) => Response | Promise<Response> | undefined

export class FakeSupabase {
  envelopes = new Map<string, object>()
  items = new Map<string, Map<string, Row>>()
  devices = 0
  refreshes = 0
  expiresIn = 3600
  /** Optional override consulted before routing; return a Response to replace the normal answer. */
  intercept: Intercept | undefined = undefined

  handle = async (input: URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    const auth = new Headers(init?.headers).get('Authorization') ?? ''
    const user = auth.startsWith('Bearer token-') ? auth.slice('Bearer token-'.length) : undefined
    const intercepted = this.intercept?.(String(init?.method), url.pathname, body)
    if (intercepted !== undefined) return intercepted
    const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }))
    const session = (email: string) => json({ access_token: `token-${email}`, refresh_token: `refresh-${email}`, expires_in: this.expiresIn, user: { id: email, email } })
    switch (`${init?.method} ${url.pathname}`) {
      case 'POST /auth/v1/token':
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          this.refreshes++
          const token = String(body?.refresh_token)
          return token.startsWith('refresh-') ? session(token.slice('refresh-'.length)) : json({ error: 'invalid_grant' }, 400)
        }
        return body?.password === 'login-pass' ? session(String(body.email)) : json({ error: 'invalid_credentials' }, 400)
      case 'POST /auth/v1/otp': return new Response(null, { status: 200 })
      case 'POST /auth/v1/verify': return body?.token === '123456' ? session(String(body.email)) : json({ error: 'otp_expired' }, 403)
      case 'POST /auth/v1/logout': return new Response(null, { status: 204 })
    }
    if (user === undefined) return json({ message: 'JWT required' }, 401)
    const items = this.items.get(user) ?? new Map<string, Row>()
    this.items.set(user, items)
    switch (`${init?.method} ${url.pathname}`) {
      case 'GET /rest/v1/dsh_sync_key_envelopes': return json(this.envelopes.has(user) ? [this.envelopes.get(user)] : [])
      case 'POST /rest/v1/dsh_sync_key_envelopes':
        if (this.envelopes.has(user)) return json({ code: '23505' }, 409)
        this.envelopes.set(user, body ?? {})
        return new Response(null, { status: 201 })
      case 'POST /rest/v1/dsh_sync_devices': return json([{ id: `00000000-0000-0000-0000-00000000000${++this.devices}` }], 201)
      case 'GET /rest/v1/dsh_sync_items': return json([...items.values()])
      case 'POST /rest/v1/rpc/dsh_sync_put_item': {
        const path = String(body?.p_path), expected = Number(body?.p_expected_version), current = items.get(path)
        if ((current?.version ?? 0) !== expected) return json({ code: 'PT409', message: 'dsh_sync version conflict' }, 409)
        const version = expected + 1
        items.set(path, {
          path, kind: String(body?.p_kind), ciphertext: String(body?.p_ciphertext), nonce: String(body?.p_nonce),
          sha256: String(body?.p_sha256), version, deleted: false,
        })
        return json(version)
      }
      default: return json({ message: `unhandled ${url.pathname}` }, 404)
    }
  }
}

/** Fake server of the running test. */
export let server: FakeSupabase
const roots: Context[] = [], dirs: string[] = []
beforeEach(() => {
  server = new FakeSupabase()
  vi.stubGlobal('fetch', vi.fn(server.handle))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** @returns one Host with its own home and credential file. */
export async function device(profileName = 'web') {
  const home = await mkdtemp(join(tmpdir(), 'dsh-settings-sync-')); dirs.push(home)
  const ctx = new Context(); roots.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false })
  const patchPath = join(home, 'profiles', profileName, 'cordis.patch.yml')
  ctx.provide('profileContext', { name: profileName, home, dir: join(home, 'profiles', profileName), patchPath } as Partial<ProfileContext> as ProfileContext)
  const sync = new SettingsSync(ctx, SettingsSync.Config({
    supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_test', requestTimeoutMs: 30_000, scryptCostLog2: 14,
  }))
  return { ctx, home, patchPath, sync }
}
