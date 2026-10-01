import { useCallback, useEffect, useState } from 'react'
import { isFullscreen } from '@/proctoring/browser'
import { Screen } from '@/components/Shell'
import type { PreconditionType, ProctorState } from '@/proctoring/types'
import { useProctorSession } from '@/hooks/useProctoring'
import Welcome from './Welcome'
import {
  ConsentStep,
  EnvironmentStep,
  FullscreenStep,
  PermissionsStep,
  ScreenShareStep,
  type StepProps,
} from './PreflightSteps'

/**
 * A greeting (§7.1 SESSION_NOT_STARTED) followed by the pre-flight gates (§8):
 * consent → camera and microphone → screen share → fullscreen → environment.
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

const STEPS: StepDefinition[] = [
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
  onReady,
}: {
  token: string
  candidateName?: string | null
  jobTitle?: string | null
  onReady: () => void
}) {
  const { session, snapshot } = useProctorSession(token)

  // Progression is explicit (each step calls onDone) so a step can finish its
  // own work after its gate has passed. The derived index only decides where to
  // resume, and pulls the candidate back if a gate they cleared is invalidated.
  const derivedIndex = STEPS.findIndex((s) => !session.isPassed(s.precondition))
  const [index, setIndex] = useState(() => (derivedIndex === -1 ? STEPS.length : derivedIndex))

  useEffect(() => {
    if (derivedIndex !== -1 && derivedIndex < index) setIndex(derivedIndex)
  }, [derivedIndex, index])

  const advance = useCallback(() => setIndex((i) => i + 1), [])

  // The greeting is shown once, ahead of the first gate. A candidate resuming
  // part-way through (a reload after consent) lands straight back on their gate.
  const [greeted, setGreeted] = useState(() => derivedIndex !== 0)

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
      // Hand the camera back to the OS so LiveKit can claim the device.
      session.releaseCamera()
      onReady()
    }
  }, [showWelcome, step, session, onReady, snapshot])

  if (showWelcome) {
    return (
      <Welcome
        candidateName={candidateName}
        jobTitle={jobTitle}
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
      </p>
    </Screen>
  )
}
