/** Desktop welcome presentation; account and credential operations stay in the preload. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives/src/Toast.tsx'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives/src/StateDot.tsx'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeApi, WelcomeSyncFailure, WelcomeSyncRequest } from '../welcome-api.ts'

type Page = 'entry' | 'key' | 'account' | 'sync'
type SyncStep = 'email' | 'code' | 'secret' | 'conflict'

/**
 * Render the standalone welcome flow using shell-owned operations and localized copy.
 * Clearing the account attempt returns the sign-in status page to the initial choices.
 * @param props.api - isolated preload API; no account credentials reach the renderer.
 * @returns welcome pages with fixed bottom actions.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [expiryNotice, setExpiryNotice] = useState(false)
  const [page, setPage] = useState<Page>('entry')
  const pageRef = useRef<Page>('entry')
  const visiblePage = useRef<Page>('entry')
  const [attempt, setAttempt] = useState<AccountView['attempt']>(null)
  const attemptRef = useRef<AccountView['attempt']>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'idle' | 'busy' | 'copied' | 'failed' }>({ status: 'idle' })
  const copyState = copyFeedback.status
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)
  const focusEntry = useRef(false)
  const [syncStep, setSyncStep] = useState<SyncStep>('email')
  const [syncEmail, setSyncEmail] = useState('')
  const [syncSecret, setSyncSecret] = useState('')
  const [syncCode, setSyncCode] = useState('')
  const [syncConflicts, setSyncConflicts] = useState<readonly string[]>([])

  function navigate(next: Page) {
    pageRef.current = next
    setPage(next)
  }
  function showAccount(state: AccountView) {
    if (pageRef.current === 'key' || (state.attempt === null && pageRef.current === 'entry')) return
    attemptRef.current = state.attempt
    setAttempt(state.attempt)
    setStarting(false)
    setCopyFeedback({ status: 'idle' })
    navigate(state.attempt === null || state.attempt.phase === 'cancelled' ? 'entry' : 'account')
  }

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    const takeNotice = (): void => {
      void api.takeNotice().then((notice) => {
        if (mounted.current && notice === 'session-expired') setExpiryNotice(true)
      }).catch((_closedChannel: unknown) => {
        // A closed Welcome IPC channel must not interrupt the sign-in page.
      })
    }
    takeNotice()
    const stop = api.onAccountState((state) => {
      revision.current++
      takeNotice()
      showAccount(state)
    })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  useEffect(() => {
    if (page === 'entry' && visiblePage.current !== 'entry') void api.analytics?.('auth_page_view', {})
    visiblePage.current = page
    if (page === 'key') input.current?.focus()
    else if (page === 'entry' && focusEntry.current) {
      focusEntry.current = false
      keyButton.current?.focus()
    }
  }, [page, api])

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return
    const timer = setTimeout(() => { setCopyFeedback({ status: 'idle' }) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copyFeedback])

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    void api.analytics?.('api_key_save_click', {})
    const value = draft.trim()
    if (!/^[\x21-\x7e]+$/.test(value) || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
      || ((value.startsWith('"') || value.startsWith("'") || value.charCodeAt(0) === 96) && value.at(-1) === value[0])) {
      setError(value === '' ? m.welcomeKeyBlank : m.welcomeKeyInvalid)
      input.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.saveApiKey(value)
      if (!mounted.current) return
      if (result.ok) setDraft('')
      else setError(m.welcomeKeyFailed)
    } catch {
      if (mounted.current) setError(m.welcomeKeyFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const syncFailureText = (failure: WelcomeSyncFailure): string => failure === 'wrong-password' ? m.welcomeSyncWrongPassword
    : failure === 'credentials' ? m.welcomeSyncCredentials : failure === 'network' ? m.welcomeSyncNetwork : m.welcomeSyncFailed
  async function syncStepRun(request: WelcomeSyncRequest): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      let result = await api.sync(request)
      if (result.ok && request.method !== 'sync' && request.method !== 'requestCode' && result.unlocked) result = await api.sync({ method: 'sync', mode: 'merge' })
      if (!mounted.current) return
      if (!result.ok) {
        if (result.failure === 'signed-out') setSyncStep('email')
        else if (result.failure === 'locked') setSyncStep('secret')
        setError(syncFailureText(result.failure))
      } else if (request.method === 'requestCode') {
        setSyncStep('code')
      } else if (result.conflicts.length > 0) {
        setSyncConflicts(result.conflicts)
        setSyncStep('conflict')
      } else if (result.signedIn && !result.unlocked) {
        setSyncSecret('')
        setSyncStep('secret')
      } else if (!result.signedIn) {
        setSyncStep('email')
      }
    } catch {
      if (mounted.current) setError(m.welcomeSyncFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  function openSync() {
    setError('')
    setSyncStep('email')
    navigate('sync')
    void syncStepRun({ method: 'status' })
  }
  async function skip() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await api.skip()
      if (mounted.current) setDraft('')
    } catch {
      if (mounted.current) setError(m.welcomeContinueFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function start() {
    navigate('account')
    setStarting(true)
    setAttempt(null)
    attemptRef.current = null
    const current = ++revision.current
    try {
      const state = await api.startSignIn()
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      if (mounted.current && revision.current === current) setStarting(false)
    }
  }
  async function cancel() {
    if (cancelling || attemptRef.current === null) return
    setCancelling(true)
    const current = ++revision.current
    try {
      const state = await api.cancelSignIn(attemptRef.current.id)
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      // The current attempt remains visible so cancellation can be retried.
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }
  async function copyLink() {
    const current = attemptRef.current
    if (current?.phase !== 'waiting-browser' || (copyState === 'busy' || copyState === 'copied')) return
    setCopyFeedback({ status: 'busy' })
    try {
      await api.copySignInLink(current.id)
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'copied' })
    } catch {
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'failed' })
    }
  }

  const phase = starting ? 'initializing' : attempt?.phase ?? 'failed'
  const waiting = phase === 'waiting-browser'
  const failed = phase === 'expired' || phase === 'failed'
  const title = phase === 'initializing' ? m.welcomeAuthStarting
    : waiting ? m.welcomeAuthWaiting : phase === 'expired' ? m.welcomeAuthExpired
      : phase === 'failed' ? m.welcomeAuthFailed : m.welcomeAuthExchanging
  const heading = page === 'entry' ? 'welcome-heading' : page === 'key' ? 'key-title' : page === 'sync' ? 'sync-title' : 'auth-status'

  return <>
    {expiryNotice && <Toast text={m.welcomeSessionExpired} onDone={() => { setExpiryNotice(false) }} />}
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby={heading}>
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline" hidden={page !== 'entry'}>
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
      </div>
      <form id="key-form" className="key-form" hidden={page !== 'key'} noValidate onSubmit={(event) => { void saveKey(event) }} aria-busy={busy}>
        <header className="key-heading"><h1 id="key-title">{m.welcomeKeyTitle}</h1><p id="key-description">{m.welcomeKeyDescription}</p></header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="key-input">{m.welcomeKeyPlaceholder}</label>
          <input ref={input} id="key-input" type="password" autoComplete="new-password" autoCapitalize="off" spellCheck={false} required
            aria-describedby="key-description key-error" aria-invalid={error !== ''} placeholder={m.welcomeKeyPlaceholder}
            value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setError('') }} />
          <p id="key-error" className="key-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <form id="sync-form" className="key-form" hidden={page !== 'sync'} noValidate aria-busy={busy} onSubmit={(event) => {
        event.preventDefault()
        if (syncStep === 'email') void syncStepRun({ method: 'signInWithPassword', email: syncEmail.trim(), password: syncSecret })
        else if (syncStep === 'code') void syncStepRun({ method: 'verifyCode', email: syncEmail.trim(), code: syncCode.trim() })
        else if (syncStep === 'secret') void syncStepRun({ method: 'unlock', password: syncSecret })
      }}>
        <header className="key-heading">
          <h1 id="sync-title">{syncStep === 'secret' ? m.welcomeSyncSecretTitle : m.welcomeSyncTitle}</h1>
          <p id="sync-description">{syncStep === 'secret' ? m.welcomeSyncSecretDescription : syncStep === 'code' ? m.welcomeSyncCodeSent
            : syncStep === 'conflict' ? m.welcomeSyncConflict : m.welcomeSyncDescription}</p>
        </header>
        <div className="key-field">
          {syncStep === 'email' && <>
            <label className="visually-hidden" htmlFor="sync-email">{m.welcomeSyncEmail}</label>
            <input id="sync-email" type="email" autoComplete="username" placeholder={m.welcomeSyncEmail} value={syncEmail} disabled={busy}
              onChange={(event) => { setSyncEmail(event.target.value); setError('') }} />
            <label className="visually-hidden" htmlFor="sync-password">{m.welcomeSyncPassword}</label>
            <input id="sync-password" type="password" autoComplete="current-password" placeholder={m.welcomeSyncPassword} value={syncSecret} disabled={busy}
              onChange={(event) => { setSyncSecret(event.target.value); setError('') }} />
          </>}
          {syncStep === 'code' && <>
            <label className="visually-hidden" htmlFor="sync-code">{m.welcomeSyncCode}</label>
            <input id="sync-code" inputMode="numeric" autoComplete="one-time-code" placeholder={m.welcomeSyncCode} value={syncCode} disabled={busy}
              onChange={(event) => { setSyncCode(event.target.value); setError('') }} />
          </>}
          {syncStep === 'secret' && <>
            <label className="visually-hidden" htmlFor="sync-secret">{m.welcomeSyncSecret}</label>
            <input id="sync-secret" type="password" autoComplete="new-password" placeholder={m.welcomeSyncSecret} value={syncSecret} disabled={busy}
              onChange={(event) => { setSyncSecret(event.target.value); setError('') }} />
          </>}
          {syncStep === 'conflict' && <p id="sync-conflicts">{syncConflicts.join(', ')}</p>}
          {busy && syncStep !== 'email' && <p role="status">{m.welcomeSyncRestoring}</p>}
          <p id="sync-error" className="key-error" role="alert" hidden={error === '' || page !== 'sync'}>{error}</p>
        </div>
      </form>
      <section id="auth-page" className={`key-heading ${waiting ? 'auth-waiting' : phase === 'expired' ? 'auth-expired' : ''}`}
        hidden={page !== 'account'} aria-live="polite">
        <h1 id="auth-status">{title}</h1>
        <p id="auth-description" hidden={!waiting && phase !== 'expired'}>{waiting ? m.welcomeAuthWaitingDescription : m.welcomeAuthExpiredDescription}</p>
        <button id="auth-copy" className="copy-link" type="button" hidden={!waiting} disabled={!waiting || (copyState === 'busy' || copyState === 'copied')} onClick={() => { void copyLink() }}>
          {copyState === 'copied' ? m.welcomeAuthCopied : copyState === 'failed' ? m.welcomeAuthCopyFailed : m.welcomeAuthCopyLink}
        </button>
      </section>
      <div id="auth-actions" className="actions" hidden={page !== 'account'}>
        <button id="auth-loading" className="primary" type="button" hidden={failed} disabled aria-label={m.welcomeAuthExchanging}>
          <StateDot state="ongoing" size={16} className="welcome-loading" />
        </button>
        <button id="auth-retry" className="primary" type="button" hidden={!failed} onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'sign_in' }); void start() }}>{m.welcomeAuthRetry}</button>
        <button id="auth-api-key" className="secondary" type="button" hidden={!failed} onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'api-key' }); navigate('key') }}>{m.welcomeApiKey}</button>
        <button id="auth-cancel" className="secondary" type="button" hidden={failed}
          disabled={cancelling || phase === 'committing' || phase === 'succeeded' || (phase === 'initializing' && !attempt?.id)}
          onClick={() => { void cancel() }}>{m.welcomeAuthCancel}</button>
      </div>
      <div id="entry-actions" className="actions" hidden={page !== 'entry'}>
        <button id="sync-entry" className="primary" type="button" onClick={openSync}>{m.welcomeSync}</button>
        <button ref={keyButton} id="api-key" className="secondary" type="button" onClick={() => { void api.analytics?.('auth_page_click', { button_name: 'api-key' }); navigate('key') }}>{m.welcomeApiKey}</button>
      </div>
      <div id="sync-actions" className="actions" hidden={page !== 'sync'}>
        {syncStep === 'email' && <>
          <button id="sync-sign-in" className="primary" type="submit" form="sync-form" disabled={busy || syncEmail.trim() === '' || syncSecret === ''}>{m.welcomeSyncSignIn}</button>
          <button id="sync-send-code" className="secondary" type="button" disabled={busy || syncEmail.trim() === ''}
            onClick={() => { void syncStepRun({ method: 'requestCode', email: syncEmail.trim() }) }}>{m.welcomeSyncSendCode}</button>
        </>}
        {syncStep === 'code' && <button id="sync-verify" className="primary" type="submit" form="sync-form" disabled={busy || syncCode.trim() === ''}>{m.welcomeSyncVerify}</button>}
        {syncStep === 'secret' && <button id="sync-unlock" className="primary" type="submit" form="sync-form" disabled={busy || syncSecret === ''}>{m.welcomeSyncUnlock}</button>}
        {syncStep === 'conflict' && <>
          <button id="sync-use-remote" className="primary" type="button" disabled={busy}
            onClick={() => { void syncStepRun({ method: 'sync', mode: 'prefer-remote' }) }}>{m.welcomeSyncUseRemote}</button>
          <button id="sync-keep-local" className="secondary" type="button" disabled={busy}
            onClick={() => { void syncStepRun({ method: 'sync', mode: 'prefer-local' }) }}>{m.welcomeSyncKeepLocal}</button>
        </>}
        <button id="sync-back" className="back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setError(''); setSyncSecret(''); setSyncCode(''); focusEntry.current = true; navigate('entry')
        }}>{m.welcomeSyncBack}</button>
      </div>
      <div id="key-actions" className="actions" hidden={page !== 'key'}>
        <button id="save-key" className="primary" type="submit" form="key-form" disabled={busy || draft.trim() === ''}>{m.welcomeKeySave}</button>
        <button id="skip-key" className="secondary" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeKeyLater}</button>
        <button id="back-to-login" className="back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setDraft(''); setError(''); focusEntry.current = true; navigate('entry')
        }}>{m.welcomeKeyBack}</button>
      </div>
    </main>
  </>
}
