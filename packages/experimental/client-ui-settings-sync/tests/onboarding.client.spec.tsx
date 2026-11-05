// @vitest-environment jsdom
/** First run offers sync sign-in, restores without overwriting local choices, and stays out of the way once set up. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import type { SyncReport, SyncStatus } from '@deepseek-ai/dsh-experimental-settings-sync/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SyncController, type SyncRemote } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import { SKIP_KEY, SyncOnboarding } from '../src/client/SyncOnboarding.tsx'

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const signedOut: SyncStatus = { signedIn: false, unlocked: false }
const locked: SyncStatus = { signedIn: true, email: 'me@example.com', unlocked: false }
const ready: SyncStatus = { signedIn: true, email: 'me@example.com', unlocked: true }
const report = (over: Partial<SyncReport> = {}): SyncReport => ({ uploaded: [], downloaded: [], unchanged: [], conflicts: [], ...over })

function t(key: keyof typeof en, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key])
}

function fixture(remote: Partial<SyncRemote>) {
  const controller = new SyncController({
    status: vi.fn(() => ok(signedOut)), signInWithPassword: vi.fn(() => ok(locked)), requestCode: vi.fn(() => ok(undefined)),
    verifyCode: vi.fn(() => ok(locked)), unlock: vi.fn(() => ok(ready)), sync: vi.fn(() => ok(report())),
    signOut: vi.fn(() => ok(signedOut)), ...remote,
  })
  const complete = vi.fn()
  const props = { useSync: bindSnapshotSelector(controller.state), controller, t, complete } as ComponentProps<typeof SyncOnboarding>
  const view = render(<SyncOnboarding {...props} />)
  return { complete, view }
}

it('restores synced settings after sign-in and the sync password, then finishes', async () => {
  const sync = vi.fn(() => ok(report({ downloaded: ['credentials/refs'] })))
  const { complete } = fixture({ sync })
  expect(await screen.findByRole('heading', { name: en.onboardingTitle })).toBeDefined()
  expect(document.getElementById('root')?.inert).toBe(true)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('heading', { name: en.onboardingTitle })).toBeDefined()
  fireEvent.change(screen.getByLabelText(en.email), { target: { value: 'me@example.com' } })
  fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'login' } })
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  fireEvent.change(await screen.findByLabelText(en.syncPassword), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: en.unlock }))
  await waitFor(() => { expect(complete).toHaveBeenCalled() })
  expect(sync).toHaveBeenCalledWith('merge')
})

it.each([
  ['useRemote', 'prefer-remote'],
  ['keepLocal', 'prefer-local'],
] as const)('asks which side to keep when this device already has different settings (%s)', async (button, mode) => {
  const sync = vi.fn()
    .mockImplementationOnce(() => ok(report({ conflicts: ['profiles/web/cordis.patch.yml'] })))
    .mockImplementation(() => ok(report({ downloaded: ['profiles/web/cordis.patch.yml'] })))
  const { complete } = fixture({ status: () => ok(locked), sync })
  fireEvent.change(await screen.findByLabelText(en.syncPassword), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: en.unlock }))
  expect((await screen.findByRole('alert')).textContent).toContain('profiles/web/cordis.patch.yml')
  expect(complete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en[button] }))
  await waitFor(() => { expect(complete).toHaveBeenCalled() })
  expect(sync).toHaveBeenLastCalledWith(mode)
})

it('finishes without showing anything on a device that already syncs', async () => {
  const { complete, view } = fixture({ status: () => ok(ready) })
  await waitFor(() => { expect(complete).toHaveBeenCalled() })
  expect(view.container.innerHTML).toBe('')
  expect(document.getElementById('root')?.inert).not.toBe(true)
})

it('remembers a skip and stays hidden on the next run', async () => {
  const first = fixture({})
  fireEvent.click(await screen.findByRole('button', { name: en.skip }))
  expect(first.complete).toHaveBeenCalled()
  expect(localStorage.getItem(SKIP_KEY)).toBe('1')
  cleanup()
  const second = fixture({})
  await waitFor(() => { expect(second.complete).toHaveBeenCalled() })
  expect(screen.queryByRole('heading', { name: en.onboardingTitle })).toBeNull()
})

it('offers a retry when the Host status cannot be read and tolerates blocked storage', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  document.body.innerHTML = ''
  const status = vi.fn()
    .mockImplementationOnce(() => Promise.resolve({ ok: false as const, error: new RemoteError('settings-sync/service-failed', 'x', { status: 0, reason: 'x' }) }))
    .mockImplementation(() => ok(signedOut))
  const { complete } = fixture({ status })
  expect((await screen.findByRole('alert')).textContent).toBe(en.errorNetwork)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(await screen.findByLabelText(en.email)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: en.skip }))
  expect(complete).toHaveBeenCalled()
})
