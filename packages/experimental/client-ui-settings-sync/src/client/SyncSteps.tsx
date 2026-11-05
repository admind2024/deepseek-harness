/** Sign-in, emailed-code, and sync-password forms shared by the settings page and first-run onboarding. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncController, SyncViewState } from './controller.ts'
import css from './SyncSection.module.css'

/** Inputs of {@link SignInSteps}. */
export interface SignInStepsProps {
  readonly state: SyncViewState
  readonly controller: SyncController
  readonly t: PropsLocale<'settingsSync'>['t']
}

function submit(action: () => void) {
  return (event: FormEvent) => { event.preventDefault(); action() }
}

/**
 * Render the form for the signed-out, code-sent, or locked step.
 * @param props - page state, controller and localized copy.
 * @returns the step form, or null in other steps.
 */
export function SignInSteps({ state, controller, t }: SignInStepsProps): ReactNode {
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => { setSecret('') }, [state.phase])
  return <>
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

  </>
}
