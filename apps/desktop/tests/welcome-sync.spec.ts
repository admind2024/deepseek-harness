/** The welcome window forwards only well-formed sync steps and learns outcomes without Remote diagnostics. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

vi.mock('electron', () => ({ app: {}, BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
const { welcomeSyncRequest } = await import('../src/welcome-window.ts')

const url = 'http://127.0.0.1:19387/?token=fixture'

function transport(results: Record<string, unknown>) {
  const calls: { method: string; args: unknown }[] = []
  const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method, payload } = JSON.parse(init.body as string) as { rpcId: string; method: string; payload: { args: unknown } }
    calls.push({ method, args: payload.args })
    if (method === 'settingsSync/broken') throw new TypeError('fetch failed')
    return Response.json({ type: 'server-response', rpcId, result: results[method] })
  })
  return { send, calls }
}

describe('welcome sync requests', () => {
  it('accepts each step with exactly its fields', () => {
    expect(welcomeSyncRequest({ method: 'status', extra: 1 })).toEqual({ method: 'status' })
    expect(welcomeSyncRequest({ method: 'signInWithPassword', email: 'a@b.c', password: 'p', extra: 1 })).toEqual({ method: 'signInWithPassword', email: 'a@b.c', password: 'p' })
    expect(welcomeSyncRequest({ method: 'requestCode', email: 'a@b.c' })).toEqual({ method: 'requestCode', email: 'a@b.c' })
    expect(welcomeSyncRequest({ method: 'verifyCode', email: 'a@b.c', code: '1' })).toEqual({ method: 'verifyCode', email: 'a@b.c', code: '1' })
    expect(welcomeSyncRequest({ method: 'unlock', password: 's' })).toEqual({ method: 'unlock', password: 's' })
    for (const mode of ['merge', 'prefer-local', 'prefer-remote']) expect(welcomeSyncRequest({ method: 'sync', mode })).toEqual({ method: 'sync', mode })
  })

  it.each([
    null, 'status', { method: 'signOut' }, { method: 'signInWithPassword', email: 'a@b.c' }, { method: 'requestCode', email: '' },
    { method: 'verifyCode', email: 'a@b.c', code: 1 }, { method: 'unlock', password: 'x'.repeat(1025) }, { method: 'sync', mode: 'all' },
  ])('rejects %j', (value) => {
    expect(() => welcomeSyncRequest(value)).toThrow(/invalid sync request/)
  })
})

describe('welcome sync backend', () => {
  it('projects status and sync results', async () => {
    const host = transport({
      'settingsSync/status': { ok: true, value: { signedIn: true, unlocked: false, email: 'a@b.c' } },
      'settingsSync/requestCode': { ok: true },
      'settingsSync/sync': { ok: true, value: { conflicts: ['flashx.yml', 3], uploaded: [] } },
      'settingsSync/unlock': { ok: true, value: 'odd' },
      'settingsSync/verifyCode': { ok: true, value: {} },
    })
    const backend = await connectDesktopWelcome(url, host.send)
    expect(await backend.sync({ method: 'status' })).toEqual({ ok: true, signedIn: true, unlocked: false, conflicts: [] })
    expect(await backend.sync({ method: 'requestCode', email: 'a@b.c' })).toEqual({ ok: true, signedIn: false, unlocked: false, conflicts: [] })
    expect(await backend.sync({ method: 'sync', mode: 'merge' })).toEqual({ ok: true, signedIn: true, unlocked: true, conflicts: ['flashx.yml'] })
    expect(await backend.sync({ method: 'unlock', password: 's' })).toEqual({ ok: false, failure: 'unavailable' })
    expect(await backend.sync({ method: 'verifyCode', email: 'a@b.c', code: '1' })).toEqual({ ok: true, signedIn: false, unlocked: false, conflicts: [] })
    expect(host.calls.find(call => call.method === 'settingsSync/requestCode')?.args).toEqual({ email: 'a@b.c' })
  })

  it.each([
    [{ code: 'settings-sync/signed-out' }, 'signed-out'],
    [{ code: 'settings-sync/locked' }, 'locked'],
    [{ code: 'settings-sync/wrong-password' }, 'wrong-password'],
    [{ code: 'settings-sync/service-failed', details: { status: 0 } }, 'network'],
    [{ code: 'settings-sync/service-failed', details: { status: 400 } }, 'credentials'],
    [{ code: 'settings-sync/service-failed', details: { status: 401 } }, 'credentials'],
    [{ code: 'settings-sync/service-failed', details: { status: 403 } }, 'credentials'],
    [{ code: 'settings-sync/service-failed', details: { status: 500 } }, 'unavailable'],
    [{ code: 'settings-sync/service-failed' }, 'unavailable'],
    [{ code: 'gateway/internal' }, 'unavailable'],
    ['odd', 'unavailable'],
  ])('maps %j to %s', async (error, failure) => {
    const backend = await connectDesktopWelcome(url, transport({ 'settingsSync/unlock': { ok: false, error } }).send)
    expect(await backend.sync({ method: 'unlock', password: 's' })).toEqual({ ok: false, failure })
  })

  it('reports an unreachable Host as a network failure', async () => {
    const host = transport({})
    const backend = await connectDesktopWelcome(url, host.send)
    host.send.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await backend.sync({ method: 'status' })).toEqual({ ok: false, failure: 'network' })
  })
})
