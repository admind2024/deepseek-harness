// @vitest-environment jsdom
/** The page walks from sign-in through the sync password to a sync pass and shows localized failures. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SyncReport, SyncStatus } from '@deepseek-ai/dsh-experimental-settings-sync/types'
import { SyncController, type SyncRemote } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import { SyncSection } from '../src/client/SyncSection.tsx'

afterEach(cleanup)

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const fail = (code: string, details: object = {}) => Promise.resolve({ ok: false as const, error: new RemoteError(code as 'gateway/internal', code, details) })
const signedOut: SyncStatus = { signedIn: false, unlocked: false }
const locked: SyncStatus = { signedIn: true, email: 'me@example.com', unlocked: false }
const ready: SyncStatus = { signedIn: true, email: 'me@example.com', unlocked: true }
const report = (over: Partial<SyncReport> = {}): SyncReport => ({ uploaded: [], downloaded: [], unchanged: [], conflicts: [], ...over })

function t(key: keyof typeof en, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key])
}

function fixture(remote: Partial<SyncRemote>) {
  const full: SyncRemote = {
    status: vi.fn(() => ok(signedOut)), signInWithPassword: vi.fn(() => ok(locked)), requestCode: vi.fn(() => ok(undefined)),
    verifyCode: vi.fn(() => ok(locked)), unlock: vi.fn(() => ok(ready)), sync: vi.fn(() => ok(report())),
    signOut: vi.fn(() => ok(signedOut)),
    ...remote,
  }
  const controller = new SyncController(full)
  const props = { useSync: bindSnapshotSelector(controller.state), controller, t } as ComponentProps<typeof SyncSection>
  render(<SyncSection {...props} />)
  return { remote: full, controller }
}

it('signs in, unlocks, syncs, and offers both resolutions for a conflict', async () => {
  const sync = vi.fn()
    .mockImplementationOnce(() => ok(report({ uploaded: ['flashx.yml'], downloaded: ['credentials/refs'], conflicts: ['profiles/web/cordis.patch.yml'] })))
    .mockImplementation(() => ok(report({ unchanged: ['flashx.yml'] })))
  const signInWithPassword = vi.fn(() => ok(locked))
  fixture({ sync, signInWithPassword })
  fireEvent.change(await screen.findByLabelText(en.email), { target: { value: 'me@example.com' } })
  fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'login' } })
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  expect(await screen.findByText(t('signedInAs', { email: 'me@example.com' }))).toBeDefined()
  expect(signInWithPassword).toHaveBeenCalledWith('me@example.com', 'login')
  expect(screen.getByLabelText<HTMLInputElement>(en.syncPassword).value).toBe('')
  fireEvent.change(screen.getByLabelText(en.syncPassword), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: en.unlock }))
  fireEvent.click(await screen.findByRole('button', { name: en.syncNow }))
  expect(await screen.findByText(t('result', { uploaded: '1', downloaded: '1', unchanged: '0' }))).toBeDefined()
  expect(screen.getByText(en.restartHint)).toBeDefined()
  expect(screen.getByRole('alert').textContent).toContain('profiles/web/cordis.patch.yml')
  fireEvent.click(screen.getByRole('button', { name: en.keepLocal }))
  await waitFor(() => { expect(sync).toHaveBeenLastCalledWith('prefer-local') })
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  sync.mockImplementationOnce(() => ok(report({ conflicts: ['flashx.yml'] })))
  fireEvent.click(screen.getByRole('button', { name: en.syncNow }))
  fireEvent.click(await screen.findByRole('button', { name: en.useRemote }))
  await waitFor(() => { expect(sync).toHaveBeenLastCalledWith('prefer-remote') })
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  expect(await screen.findByLabelText(en.email)).toBeDefined()
})

it('signs in with an emailed code and can go back', async () => {
  const verifyCode = vi.fn(() => ok(locked))
  fixture({ status: () => ok(signedOut), verifyCode })
  fireEvent.change(await screen.findByLabelText(en.email), { target: { value: 'me@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: en.sendCode }))
  expect(await screen.findByText(t('codeSent', { email: 'me@example.com' }))).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: en.back }))
  fireEvent.click(await screen.findByRole('button', { name: en.sendCode }))
  fireEvent.change(await screen.findByLabelText(en.code), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: en.verify }))
  await screen.findByLabelText(en.syncPassword)
  expect(verifyCode).toHaveBeenCalledWith('me@example.com', '123456')
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  expect(await screen.findByLabelText(en.email)).toBeDefined()
})

it.each([
  ['settings-sync/wrong-password', {}, en.errorWrongPassword],
  ['settings-sync/service-failed', { status: 400 }, en.errorCredentials],
  ['settings-sync/service-failed', { status: 0 }, en.errorNetwork],
  ['settings-sync/service-failed', { status: 500 }, en.errorService],
  ['gateway/internal', {}, en.errorService],
])('shows %s as a localized failure', async (code, details, text) => {
  fixture({ status: () => ok(locked), unlock: () => fail(code, details) })
  fireEvent.change(await screen.findByLabelText(en.syncPassword), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: en.unlock }))
  expect((await screen.findByRole('alert')).textContent).toBe(text)
})

it('moves to the matching step when the Host reports sign-out or a missing key, and retries a failed status read', async () => {
  const status = vi.fn().mockImplementationOnce(() => fail('settings-sync/service-failed', { status: 0 })).mockImplementation(() => ok(ready))
  const sync = vi.fn().mockImplementationOnce(() => fail('settings-sync/locked')).mockImplementation(() => fail('settings-sync/signed-out'))
  const { controller } = fixture({ status, sync })
  expect((await screen.findByRole('alert')).textContent).toBe(en.errorNetwork)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  fireEvent.click(await screen.findByRole('button', { name: en.syncNow }))
  expect((await screen.findByRole('alert')).textContent).toBe(en.errorLocked)
  expect(screen.getByLabelText(en.syncPassword)).toBeDefined()
  await controller.sync('merge')
  expect((await screen.findByRole('alert')).textContent).toBe(en.errorSignedOut)
  expect(screen.getByLabelText(en.email)).toBeDefined()
})

it('ignores a second action while one call is running', async () => {
  let release!: (value: { ok: true; value: SyncStatus }) => void
  const unlock = vi.fn(() => new Promise<{ ok: true; value: SyncStatus }>((resolve) => { release = resolve }))
  const { controller } = fixture({ status: () => ok(locked), unlock })
  await screen.findByLabelText(en.syncPassword)
  const first = controller.unlock('a')
  await controller.unlock('b')
  release({ ok: true, value: ready })
  await first
  expect(unlock).toHaveBeenCalledTimes(1)
})
