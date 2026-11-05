/**
 * First-run step offered before the DeepSeek credential step: a device that signs in and unlocks downloads its synced
 * settings and keys, so the later step finds a ready provider and completes on its own.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncPhase } from './controller.ts'
import type { SyncInjected } from './SyncSection.tsx'
import { SignInSteps } from './SyncSteps.tsx'
import css from './SyncSection.module.css'

type Props = PropsRuntime<'settings.onboarding'> & InjectFace<SyncInjected> & PropsLocale<'settingsSync'>

/** Browser preference key recording that this device declined sync during first run. */
export const SKIP_KEY = 'dsh.settingsSync.onboardingSkipped'

function skipped(): boolean {
  try {
    return globalThis.localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    // Storage blocked by the browser profile: offer the step again rather than fail.
    return false
  }
}

function rememberSkip(): void {
  try {
    globalThis.localStorage.setItem(SKIP_KEY, '1')
  } catch {
    // Storage blocked by the browser profile: the step is offered again on the next blank session.
  }
}

const ignoreImplicitDismiss = (): void => {}

/** Keep the application root inert while the visible dialog is mounted. */
function InertRoot(): null {
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])
  return null
}

/**
 * Offer restoring synced settings on a device that has not unlocked sync, then download them and finish the step.
 * @param props - onboarding owner props, sync state hook, controller and localized copy.
 * @returns the blocking dialog, or null while loading and once the step needs no intervention.
 */
export function SyncOnboarding({ useSync, controller, t, complete }: Props): ReactNode {
  const state = useSync(value => value)
  const initial = useRef<SyncPhase | undefined>(undefined)
  if (initial.current === undefined && state.phase !== 'loading') initial.current = state.phase

  useEffect(() => { void controller.refresh() }, [controller])
  useEffect(() => {
    if (initial.current === 'ready' || (initial.current !== undefined && skipped())) complete()
  }, [complete, state.phase])
  // A device with its own settings keeps them until the user chooses; keys always merge on the Host.
  useEffect(() => {
    if (initial.current === 'ready' || state.phase !== 'ready' || state.busy || state.error !== undefined) return
    if (state.report === undefined) void controller.sync('merge')
    else if (state.report.conflicts.length === 0) complete()
  }, [complete, controller, state.phase, state.busy, state.report, state.error])

  const waiting = state.phase === 'loading' && state.error === undefined
  if (waiting || initial.current === 'ready' || (initial.current !== undefined && skipped())) return null
  return <Modal open title={t('onboardingTitle')} onClose={ignoreImplicitDismiss} headless className={css.dialog as string}>
    <InertRoot />
    <div className={css.dialogContent}>
      <h2 className={css.dialogTitle}>{t('onboardingTitle')}</h2>
      <p className={css.description}>{t('onboardingDescription')}</p>
      {state.phase === 'loading' && <Button variant="outline" disabled={state.busy} onClick={() => { void controller.refresh() }}>{t('retry')}</Button>}
      <SignInSteps state={state} controller={controller} t={t} />
      {state.phase === 'ready' && (state.report?.conflicts.length ?? 0) === 0 && <p className={css.note} role="status">{t('restoring')}</p>}
      {state.report !== undefined && state.report.conflicts.length > 0 && <div className={css.conflict} role="alert">
        <p>{t('conflicts', { paths: state.report.conflicts.join(', ') })}</p>
        <div className={css.actions}>
          <Button variant="outline" disabled={state.busy} onClick={() => { void controller.sync('prefer-local') }}>{t('keepLocal')}</Button>
          <Button variant="primary" disabled={state.busy} onClick={() => { void controller.sync('prefer-remote') }}>{t('useRemote')}</Button>
        </div>
      </div>}
      {state.error !== undefined && <p className={css.error} role="alert">{t(state.error)}</p>}
      <div className={css.actions}>
        <Button variant="ghost" disabled={state.busy} onClick={() => { rememberSkip(); complete() }}>{t('skip')}</Button>
      </div>
    </div>
  </Modal>
}
