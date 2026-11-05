/** Settings page for sync sign-in, the sync password, and manual sync passes. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncController, SyncViewState } from './controller.ts'
import { SignInSteps } from './SyncSteps.tsx'
import css from './SyncSection.module.css'

/** State and actions supplied by the plugin. */
export interface SyncInjected {
  hooks: { sync: ObservableSnapshot<SyncViewState> }
  controller: SyncController
}

type Props = PropsRuntime<'settings.section'> & InjectFace<SyncInjected> & PropsLocale<'settingsSync'>

/**
 * Render the step that matches the Host sync status.
 * @param props - sync state hook, controller and localized copy.
 * @returns the settings page body.
 */
export function SyncSection({ useSync, controller, t }: Props) {
  const state = useSync(value => value)
  useEffect(() => { void controller.refresh() }, [controller])

  const report = state.report
  return <section className={css.section} aria-label={t('title')}>
    <p className={css.description}>{t('description')}</p>

    {state.phase === 'loading' && <div className={css.card}>
      <span role="status">{t('loading')}</span>
      {state.error !== undefined && <Button variant="outline" disabled={state.busy} onClick={() => { void controller.refresh() }}>{t('retry')}</Button>}
    </div>}

    <SignInSteps state={state} controller={controller} t={t} />

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
