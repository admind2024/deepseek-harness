/** Failure paths keep local state consistent and report a typed reason. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { expect, it } from 'vitest'
import { applyItem, collectLocalItems, CREDENTIALS_PATH } from '../src/items.ts'
import { serviceStatus } from '../src/supabase.ts'
import { device, server } from './fixture.ts'

async function ready() {
  const d = await device()
  await d.sync.signInWithPassword('me@example.com', 'login-pass')
  await d.sync.unlock('sync-pass')
  return d
}

it('reports a write race as a conflict instead of overwriting the other device', async () => {
  const a = await ready()
  await writeFile(join(a.home, 'flashx.yml'), 'a\n')
  server.intercept = (method, path) => method === 'POST' && path === '/rest/v1/rpc/dsh_sync_put_item'
    ? new Response(JSON.stringify({ code: 'PT409' }), { status: 409 })
    : undefined
  expect(await a.sync.sync('merge')).toMatchObject({ uploaded: [], conflicts: ['flashx.yml'] })
  server.intercept = (method, path) => method === 'POST' && path === '/rest/v1/rpc/dsh_sync_put_item'
    ? new Response('boom', { status: 500 })
    : undefined
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/service-failed', details: { status: 500 } })
})

it('signs out locally when the refresh token is rejected and maps 401 and network failures', async () => {
  server.expiresIn = 30
  const a = await device()
  await a.sync.signInWithPassword('me@example.com', 'login-pass')
  server.intercept = (_method, path) => path === '/auth/v1/token' ? new Response('{}', { status: 400 }) : undefined
  await expect(a.sync.unlock('sync-pass')).rejects.toMatchObject({ code: 'settings-sync/signed-out' })
  expect(await a.sync.status()).toMatchObject({ signedIn: false })

  server.expiresIn = 3600
  server.intercept = undefined
  await a.sync.signInWithPassword('me@example.com', 'login-pass')
  server.intercept = (_method, path) => path === '/auth/v1/token' ? new Response('{}', { status: 503 }) : undefined
  await expect(a.sync.unlock('sync-pass')).resolves.toMatchObject({ unlocked: true })
  server.intercept = (_method, path) => path === '/rest/v1/dsh_sync_items' ? new Response('{}', { status: 401 }) : undefined
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/signed-out' })
  server.intercept = () => Promise.reject(new TypeError('fetch failed'))
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/service-failed', details: { status: 0 } })
  expect(await a.sync.signOut()).toEqual({ signedIn: false, unlocked: false })
})

it('refreshes once and keeps working after an expired access token', async () => {
  server.expiresIn = 30
  const a = await device()
  await a.sync.signInWithPassword('me@example.com', 'login-pass')
  server.intercept = (_method, path) => path === '/auth/v1/token' ? new Response('{}', { status: 503 }) : undefined
  await expect(a.sync.unlock('sync-pass')).rejects.toMatchObject({ code: 'settings-sync/service-failed', details: { status: 503 } })
  expect(await a.sync.status()).toMatchObject({ signedIn: true })
})

it('rejects malformed server rows and an unsupported key derivation', async () => {
  const a = await ready()
  server.intercept = (method, path) => method === 'GET' && path === '/rest/v1/dsh_sync_items'
    ? new Response(JSON.stringify([{ path: 'flashx.yml', kind: 'model-selection', ciphertext: 'zz', nonce: '\\x00', sha256: 'x', version: 1, deleted: false }]))
    : undefined
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/service-failed', details: { reason: 'bytea' } })
  server.intercept = (method, path) => method === 'GET' && path === '/rest/v1/dsh_sync_key_envelopes'
    ? new Response(JSON.stringify([{ kdf: 'argon2id', kdf_params: {}, salt: '\\x00', verifier: '\\x00' }]))
    : undefined
  await expect(a.sync.unlock('sync-pass')).rejects.toMatchObject({ details: { reason: 'kdf' } })
  server.intercept = (method, path) => method === 'POST' && path === '/rest/v1/dsh_sync_devices' ? new Response('[]', { status: 201 }) : undefined
  const b = await ready()
  await expect(b.sync.sync('merge')).rejects.toMatchObject({ details: { reason: 'device' } })
})

it('keeps a sign-in without email, survives revocation failure, and resets state of another account', async () => {
  const a = await device()
  server.intercept = (_method, path) => path === '/auth/v1/verify'
    ? new Response(JSON.stringify({ access_token: 'token-u1', refresh_token: 'refresh-u1', expires_in: 3600, user: { id: 'u1' } }))
    : undefined
  expect(await a.sync.verifyCode('me@example.com', '123456')).toEqual({ signedIn: true, email: '', unlocked: false })
  server.intercept = undefined
  await a.sync.unlock('sync-pass')
  await writeFile(join(a.home, 'flashx.yml'), 'a\n')
  await a.sync.sync('merge')
  await a.ctx.credentials.modifyRecord(credentialKey('settings-sync', 'session'), () => Promise.resolve({ kind: 'grant', payload: { accessToken: 1 } }))
  expect(await a.sync.status()).toEqual({ signedIn: false, unlocked: false })
  server.intercept = (_method, path) => path === '/auth/v1/logout' ? new Response('no', { status: 500 }) : undefined
  await a.sync.signInWithPassword('other@example.com', 'login-pass')
  expect(await a.sync.signOut()).toMatchObject({ signedIn: false })
  server.intercept = undefined
  await a.sync.signInWithPassword('other@example.com', 'login-pass')
  await a.sync.unlock('other-pass')
  expect(await a.sync.sync('merge')).toMatchObject({ uploaded: ['flashx.yml'] })
  await writeFile(join(a.home, 'settings-sync', 'state.json'), '{')
  await expect(a.sync.sync('merge')).rejects.toThrow(SyntaxError)
  await rm(join(a.home, 'settings-sync', 'state.json'))
  await mkdir(join(a.home, 'settings-sync', 'state.json'))
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'EISDIR' })
})

it('uploads only file-stored keys and skips other profiles and invalid credential items', async () => {
  const a = await device()
  const locations = { home: a.home, profileName: 'web', patchPath: a.patchPath }
  expect(await collectLocalItems(locations, a.ctx.credentials)).toEqual([])
  await writeFile(join(a.home, '.credentials.yaml'), 'version: 1\nrefs:\n', { mode: 0o600 })
  expect(await collectLocalItems(locations, a.ctx.credentials)).toEqual([])
  await writeFile(join(a.home, '.credentials.yaml'), 'version: 1\n', { mode: 0o600 })
  expect(await collectLocalItems(locations, a.ctx.credentials)).toEqual([])
  process.env.SETTINGS_SYNC_ENV_ONLY = 'from-env'
  await a.ctx.credentials.set(credentialRef('STORED_KEY'), 'stored')
  expect((await collectLocalItems(locations, a.ctx.credentials)).map(item => item.content.toString())).toEqual(['{"STORED_KEY":"stored"}'])
  delete process.env.SETTINGS_SYNC_ENV_ONLY
  expect(await applyItem(locations, a.ctx.credentials, 'profiles/other/cordis.patch.yml', Buffer.from('x'))).toBe(false)
  expect(await applyItem(locations, a.ctx.credentials, CREDENTIALS_PATH, Buffer.from('{"STORED_KEY":"stored"}'))).toBe(true)
  await expect(applyItem(locations, a.ctx.credentials, CREDENTIALS_PATH, Buffer.from('null'))).rejects.toThrow(/not an object/)
  await expect(applyItem(locations, a.ctx.credentials, CREDENTIALS_PATH, Buffer.from('{"bad name":"x"}'))).rejects.toThrow(/invalid credential/)
  await mkdir(join(a.home, 'flashx.yml'))
  await expect(collectLocalItems(locations, a.ctx.credentials)).rejects.toMatchObject({ code: 'EISDIR' })
  expect(serviceStatus(new Error('x'))).toBeUndefined()
})

it('keeps items of other profiles remote and counts a vanished server row as unchanged', async () => {
  const web = await device('web'), cli = await device('headless')
  for (const d of [web, cli]) { await d.sync.signInWithPassword('me@example.com', 'login-pass'); await d.sync.unlock('sync-pass') }
  await mkdir(join(web.home, 'profiles', 'web'), { recursive: true })
  await writeFile(web.patchPath, '- id: web\n')
  await web.sync.sync('merge')
  expect(await cli.sync.sync('merge')).toEqual({ uploaded: [], downloaded: [], unchanged: [], conflicts: [] })
  server.items.get('me@example.com')?.clear()
  expect(await web.sync.sync('merge')).toMatchObject({ uploaded: [], unchanged: ['profiles/web/cordis.patch.yml'] })
})
