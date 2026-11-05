/** Two devices sharing one account exchange settings and credential references through ciphertext only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { expect, it } from 'vitest'
import { device, server } from './fixture.ts'

it('moves settings and stored keys to a second device without sending plaintext', async () => {
  const a = await device()
  expect(await a.sync.status()).toEqual({ signedIn: false, unlocked: false })
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/signed-out' })
  await expect(a.sync.signInWithPassword('me@example.com', 'bad')).rejects.toMatchObject({ code: 'settings-sync/service-failed', details: { status: 400 } })
  expect(await a.sync.signInWithPassword('me@example.com', 'login-pass')).toEqual({ signedIn: true, email: 'me@example.com', unlocked: false })
  await expect(a.sync.sync('merge')).rejects.toMatchObject({ code: 'settings-sync/locked' })
  expect(await a.sync.unlock('sync-pass')).toMatchObject({ unlocked: true })

  await writeFile(join(a.home, 'flashx.yml'), '- id: model\n')
  await a.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'sk-very-secret')
  await mkdir(join(a.home, 'profiles', 'web'), { recursive: true })
  await writeFile(a.patchPath, '- id: settings-sync\n')
  expect(await a.sync.sync('merge')).toEqual({ uploaded: ['credentials/refs', 'flashx.yml', 'profile/cordis.patch.yml'], downloaded: [], unchanged: [], conflicts: [] })
  const stored = JSON.stringify([...server.items.get('me@example.com')!.values()])
  expect(stored).not.toContain(Buffer.from('sk-very-secret').toString('hex'))
  expect(stored).not.toContain('sk-very-secret')
  expect(await a.sync.sync('merge')).toMatchObject({ uploaded: [], unchanged: ['credentials/refs', 'flashx.yml', 'profile/cordis.patch.yml'] })

  const b = await device()
  await b.sync.verifyCode('me@example.com', '123456')
  await expect(b.sync.unlock('not-it')).rejects.toMatchObject({ code: 'settings-sync/wrong-password' })
  await b.sync.unlock('sync-pass')
  expect(await b.sync.sync('merge')).toMatchObject({ downloaded: ['credentials/refs', 'flashx.yml', 'profile/cordis.patch.yml'] })
  expect(await readFile(b.patchPath, 'utf8')).toBe('- id: settings-sync\n')
  expect(await readFile(join(b.home, 'flashx.yml'), 'utf8')).toBe('- id: model\n')
  expect(await b.ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toEqual({ value: 'sk-very-secret', source: 'file' })
})

it('reports a two-sided change under merge and resolves it by mode', async () => {
  const a = await device(), b = await device()
  for (const d of [a, b]) { await d.sync.signInWithPassword('me@example.com', 'login-pass'); await d.sync.unlock('sync-pass') }
  await writeFile(join(a.home, 'flashx.yml'), 'a1\n'); await a.sync.sync('merge')
  await b.sync.sync('merge')
  await writeFile(join(a.home, 'flashx.yml'), 'a2\n'); await a.sync.sync('merge')
  await writeFile(join(b.home, 'flashx.yml'), 'b2\n')
  expect(await b.sync.sync('merge')).toMatchObject({ conflicts: ['flashx.yml'] })
  expect(await readFile(join(b.home, 'flashx.yml'), 'utf8')).toBe('b2\n')
  expect(await b.sync.sync('prefer-remote')).toMatchObject({ downloaded: ['flashx.yml'] })
  expect(await readFile(join(b.home, 'flashx.yml'), 'utf8')).toBe('a2\n')
  await writeFile(join(b.home, 'flashx.yml'), 'b3\n'); await writeFile(join(a.home, 'flashx.yml'), 'a3\n')
  await a.sync.sync('merge')
  expect(await b.sync.sync('prefer-local')).toMatchObject({ uploaded: ['flashx.yml'] })
})

it('refreshes an expiring session and forgets local secrets on sign-out', async () => {
  server.expiresIn = 30
  const a = await device()
  await a.sync.signInWithPassword('me@example.com', 'login-pass')
  await a.sync.unlock('sync-pass')
  expect(server.refreshes).toBe(1)
  await a.sync.requestCode('me@example.com')
  expect(await a.sync.signOut()).toEqual({ signedIn: false, unlocked: false })
  expect(await a.sync.signOut()).toEqual({ signedIn: false, unlocked: false })
})

it('accumulates keys held by different devices instead of conflicting', async () => {
  const a = await device(), b = await device()
  for (const d of [a, b]) { await d.sync.signInWithPassword('me@example.com', 'login-pass'); await d.sync.unlock('sync-pass') }
  await a.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'sk-a')
  await a.ctx.credentials.set(credentialRef('SHARED_KEY'), 'old')
  await a.sync.sync('merge')
  await b.ctx.credentials.set(credentialRef('ANTHROPIC_API_KEY'), 'sk-ant')
  await b.ctx.credentials.set(credentialRef('SHARED_KEY'), 'new')
  expect(await b.sync.sync('merge')).toMatchObject({ uploaded: ['credentials/refs'], downloaded: ['credentials/refs'], conflicts: [] })
  expect(await b.ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toMatchObject({ value: 'sk-a' })
  expect(await b.ctx.credentials.resolve(credentialRef('SHARED_KEY'))).toMatchObject({ value: 'new' })
  expect(await a.sync.sync('merge')).toMatchObject({ downloaded: ['credentials/refs'], conflicts: [] })
  expect(await a.ctx.credentials.resolve(credentialRef('ANTHROPIC_API_KEY'))).toMatchObject({ value: 'sk-ant' })
  expect(await a.ctx.credentials.resolve(credentialRef('SHARED_KEY'))).toMatchObject({ value: 'new' })
  expect(await a.sync.sync('merge')).toMatchObject({ uploaded: [], downloaded: [], conflicts: [], unchanged: ['credentials/refs'] })
  expect(await b.sync.sync('merge')).toMatchObject({ uploaded: [], downloaded: [], conflicts: [] })
})
