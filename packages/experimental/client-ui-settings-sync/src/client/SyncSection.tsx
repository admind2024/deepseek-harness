/** Settings page for sync sign-in, the sync password, and manual sync passes. */
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncController, SyncViewState } from './controller.ts'
import css from './SyncSection.module.css'

/** State and actions supplied by the plugin. */
export interface SyncInjected {
  hooks: { sync: ObservableSnapshot<SyncViewState> }
  controller: SyncController
}

type Props = PropsRuntime<'settings.section'> & InjectFace<SyncInjected> & PropsLocale<'settingsSync'>

function submit(action: () => void) {
  return (event: FormEvent) => { event.preventDefault(); action() }
}

/**
 * Render the step that matches the Host sync status.
 * @param props - sync state hook, controller and localized copy.
 * @returns the settings page body.
 */
export function SyncSection({ useSync, controller, t }: Props) {
  const state = useSync(value => value)
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => { void controller.refresh() }, [controller])
  useEffect(() => { setSecret('') }, [state.phase])

  const report = state.report
  return <section className={css.section} aria-label={t('title')}>
    <p className={css.description}>{t('description')}</p>

    {state.phase === 'loading' && <div className={css.card}>
      <span role="status">{t('loading')}</span>
      {state.error !== undefined && <Button variant="outline" disabled={state.busy} onClick={() => { void controller.refresh() }}>{t('retry')}</Button>}
    </div>}

    {state.phase === 'signed-out' && <form className={css.card} onSubmit={submit(() => { void controller.signIn(email, secret) })}>
      <label className={css.field}>{t('email')}
        <Input type="email" autoComplete="username" value={email} onChange={(event) => { setEmail(event.target.value) }} required />
      </label>
      <label className={css.field}>{t('password')}
        <Input type="password" autoComplete="current-password" value={secret} onChange={(event) => { setSecret(event.target.value) }} />
      </label>
      <div className={css.actions}>
        <Button type="submit" variant="primary" disabled={state.busy || email === '' || secret === ''}>{t('signIn')}</Button>
        <Button variant="outline" disabled={state.busy || email === ''} onClick={() => { void controller.requestCode(email) }}>{t('sendCode')}</Button>
      </div>
    </form>}

    {state.phase === 'code-sent' && <form className={css.card} onSubmit={submit(() => { void controller.verifyCode(code) })}>
      <p className={css.note} role="status">{t('codeSent', { email: state.email })}</p>
      <label className={css.field}>{t('code')}
        <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => { setCode(event.target.value) }} required />
      </label>
      <div className={css.actions}>
        <Button type="submit" variant="primary" disabled={state.busy || code === ''}>{t('verify')}</Button>
        <Button variant="ghost" disabled={state.busy} onClick={() => { controller.cancelCode() }}>{t('back')}</Button>
      </div>
    </form>}

    {state.phase === 'locked' && <form className={css.card} onSubmit={submit(() => { void controller.unlock(secret) })}>
      <p className={css.note}>{t('signedInAs', { email: state.email })}</p>
      <p className={css.note}>{t('lockedDescription')}</p>
      <label className={css.field}>{t('syncPassword')}
        <Input type="password" autoComplete="new-password" value={secret} onChange={(event) => { setSecret(event.target.value) }} required />
      </label>
      <div className={css.actions}>
        <Button type="submit" variant="primary" disabled={state.busy || secret === ''}>{t('unlock')}</Button>
        <Button variant="ghost" disabled={state.busy} onClick={() => { void controller.signOut() }}>{t('signOut')}</Button>
      </div>
    </form>}

    {state.phase === 'ready' && <div className={css.card}>
      <p className={css.note}>{t('signedInAs', { email: state.email })}</p>
      <div className={css.actions}>
        <Button variant="primary" disabled={state.busy} onClick={() => { void controller.sync('merge') }}>{t('syncNow')}</Button>
        <Button variant="ghost" disabled={state.busy} onClick={() => { void controller.signOut() }}>{t('signOut')}</Button>
      </div>
      {report !== undefined && <p className={css.note} role="status">{t('result', {
        uploaded: String(report.uploaded.length), downloaded: String(report.downloaded.length), unchanged: String(report.unchanged.length),
      })}</p>}
      {report !== undefined && report.downloaded.length > 0 && <p className={css.hint}>{t('restartHint')}</p>}
      {report !== undefined && report.conflicts.length > 0 && <div className={css.conflict} role="alert">
        <p>{t('conflicts', { paths: report.conflicts.join(', ') })}</p>
        <div className={css.actions}>
          <Button variant="outline" disabled={state.busy} onClick={() => { void controller.sync('prefer-local') }}>{t('keepLocal')}</Button>
          <Button variant="outline" disabled={state.busy} onClick={() => { void controller.sync('prefer-remote') }}>{t('useRemote')}</Button>
        </div>
      </div>}
    </div>}

    {state.error !== undefined && <p className={css.error} role="alert">{t(state.error)}</p>}
  </section>
}
