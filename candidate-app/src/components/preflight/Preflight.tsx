import { useCallback, useEffect, useMemo, useState } from 'react'
import { isFullscreen } from '@/proctoring/browser'
import { Screen } from '@/components/Shell'
import { clearReloadAfterInstall, hasReloadAfterInstall } from '@/lib/extensionInstall'
import { needsGreeting, nextIncompleteIndex } from '@/lib/readiness'
import {
  VOLATILE_PRECONDITIONS,
  type PreconditionType,
  type ProctorState,
} from '@/proctoring/types'
import { useProctorSession } from '@/hooks/useProctoring'
import { describeWindow, type InterviewWindow } from '@/lib/deadline'
import Welcome from './Welcome'
import {
  ConsentStep,
  ExtensionCheckStep,
  EnvironmentStep,
  FullscreenStep,
  PermissionsStep,
  ScreenShareStep,
  type StepProps,
} from './PreflightSteps'

/**
 * A greeting (§7.1 SESSION_NOT_STARTED) followed by the pre-flight gates (§8):
 * extension check → consent → camera and microphone → screen share →
 * fullscreen → environment.
 * The candidate cannot reach the interview room until every gate has a
 * recorded pass (§7.2). The greeting gates nothing, so it records nothing.
 *
 * The current step is derived from the precondition records rather than kept in
 * component state, so a reload resumes exactly where the candidate was and a
 * precondition that gets invalidated (a stream dying) sends them back to it.
 */

interface StepDefinition {
  state: ProctorState
  precondition: PreconditionType
  Component: (props: StepProps) => JSX.Element
}

const ALL_STEPS: StepDefinition[] = [
  {
    state: 'EXTENSION_CHECK',
    precondition: 'extension_check',
    Component: ExtensionCheckStep,
  },
  {
    state: 'CONSENT_PENDING',
    precondition: 'consent',
    Component: ConsentStep,
  },
  {
    state: 'PERMISSION_ACQUISITION',
    precondition: 'permission_camera',
    Component: PermissionsStep,
  },
  {
    state: 'SCREEN_SHARE_VALIDATION',
    precondition: 'screen_share',
    Component: ScreenShareStep,
  },
  {
    state: 'FULLSCREEN_VALIDATION',
    precondition: 'fullscreen',
    Component: FullscreenStep,
  },
  {
    state: 'ENVIRONMENT_PREPARATION',
    precondition: 'environment',
    Component: EnvironmentStep,
  },
]

export default function Preflight({
  token,
  candidateName,
  jobTitle,
  window,
  extensionCheck,
  onReady,
}: {
  token: string
  candidateName?: string | null
  jobTitle?: string | null
  /** When the interview opens (if scheduled) and when its link stops working. */
  window: InterviewWindow
  /** Whether this interview has the extension step. Known before this renders, so it never flashes. */
  extensionCheck: boolean
  onReady: () => void
}) {
  const { session, snapshot } = useProctorSession(token)
  const STEPS = useMemo(
    () => ALL_STEPS.filter((s) => extensionCheck || s.precondition !== 'extension_check'),
    [extensionCheck],
  )
  // The session's own gate list must agree with the steps shown.
  session.setExtensionCheckRequired(extensionCheck)

  // Progression is explicit (each step calls onDone) so a step can finish its
  // own work after its gate has passed. The derived index only decides where to
  // resume, and pulls the candidate back if a gate they cleared is invalidated.
  const derivedIndex = STEPS.findIndex((s) => !session.isPassed(s.precondition))
  const [index, setIndex] = useState(() => (derivedIndex === -1 ? STEPS.length : derivedIndex))

  // The final step is the readiness gate: it re-checks and recovers every
  // earlier gate itself, in place. Pulling the candidate back from it would
  // replay steps that the gate is about to repair with one action.
  const onFinalStep = index === STEPS.length - 1
  useEffect(() => {
    if (!onFinalStep && derivedIndex !== -1 && derivedIndex < index) setIndex(derivedIndex)
  }, [derivedIndex, index, onFinalStep])

  // Next means the first gate that is not passed - never simply index + 1, which
  // would replay gates that already hold. Records are updated synchronously by
  // pass()/fail()/reset(), so reading them here right after onDone is safe.
  const advance = useCallback(
    () => setIndex(nextIncompleteIndex(STEPS, (type) => session.isPassed(type))),
    [session],
  )

  // The greeting is shown once, ahead of the first gate. Anything that survives
  // a reload (consent) means the candidate has already started, so a resume or
  // a recovery lands straight back on the gate that needs them.
  const hasDurableProgress = STEPS.some(
    (s) => !VOLATILE_PRECONDITIONS.includes(s.precondition) && session.isPassed(s.precondition),
  )
  // Also skipped when the page just reloaded to connect to a freshly installed extension.
  const [greeted, setGreeted] = useState(
    () => !needsGreeting(derivedIndex, hasDurableProgress) || hasReloadAfterInstall(session.token),
  )
  useEffect(() => clearReloadAfterInstall(session.token), [session.token])

  const { opens, completeBy } = describeWindow(window)

  const currentIndex = Math.min(index, STEPS.length)
  const step = currentIndex >= STEPS.length ? null : STEPS[currentIndex]
  const showWelcome = !greeted && currentIndex === 0

  // Leaving fullscreen before the session starts sends the candidate back to
  // that gate - the gate records fullscreen entry, so it has to still hold.
  useEffect(() => {
    const onChange = () => {
      if (!isFullscreen() && session.isPassed('fullscreen')) session.reset('fullscreen')
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [session])

  useEffect(() => {
    if (showWelcome) {
      session.setState('SESSION_VALIDATED')
      return
    }
    if (step) {
      session.setState(step.state)
      return
    }
    // Every gate has a recorded pass - §7.2 is satisfied.
    if (session.canEnterActive()) {
      session.setState('BASELINE_ESTABLISHED')
      // The camera stream is deliberately kept: the room's start-time check
      // validates it, and it is released right after /start succeeds, just
      // before LiveKit claims the device (InterviewRoomPage).
      onReady()
    }
  }, [showWelcome, step, session, onReady, snapshot])

  if (showWelcome) {
    return (
      <Welcome
        candidateName={candidateName}
        jobTitle={jobTitle}
        opens={opens}
        completeBy={completeBy}
        onStart={() => setGreeted(true)}
      />
    )
  }

  if (!step) {
    return (
      <Screen>
        <p className="text-[0.92rem] text-ink-muted">Starting your interview</p>
      </Screen>
    )
  }

  const StepBody = step.Component

  return (
    <Screen>
      <StepBody session={session} onDone={advance} />

      <p className="mt-10 text-[0.72rem] text-ink-muted">
        {jobTitle ?? 'Interview'}
        {candidateName ? ` · ${candidateName}` : ''}
        {completeBy ? ` · Complete by ${completeBy}` : ''}
      </p>
    </Screen>
  )
}
