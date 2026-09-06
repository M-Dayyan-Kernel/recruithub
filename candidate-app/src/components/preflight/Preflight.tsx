import { useCallback, useEffect, useState } from 'react'
import { isFullscreen } from '@/proctoring/browser'
import { Brand, Card, GradientShell, ProgressBar } from '@/components/GradientShell'
import type { PreconditionType, ProctorState } from '@/proctoring/types'
import { useProctorSession } from '@/hooks/useProctoring'
import {
  BaselineStep,
  ConsentStep,
  EnvironmentStep,
  FullscreenStep,
  PermissionsStep,
  ScreenShareStep,
  SystemCheckStep,
  type StepProps,
} from './PreflightSteps'

/**
 * The pre-flight sequence (§8): consent → system check → permissions → screen
 * share → environment → fullscreen → baseline. The candidate cannot reach the
 * interview room until every gate has a recorded pass (§7.2).
 *
 * The current step is derived from the precondition records rather than kept in
 * component state, so a reload resumes exactly where the candidate was and a
 * precondition that gets invalidated (a stream dying) sends them back to it.
 */

interface StepDefinition {
  state: ProctorState
  title: string
  heading: string
  blurb: string
  precondition: PreconditionType
  Component: (props: StepProps) => JSX.Element
}

const STEPS: StepDefinition[] = [
  {
    state: 'CONSENT_PENDING',
    title: 'Consent',
    heading: 'Before you begin',
    blurb: 'This interview is monitored. Here is exactly what that covers.',
    precondition: 'consent',
    Component: ConsentStep,
  },
  {
    state: 'SYSTEM_CHECK',
    title: 'System',
    heading: 'System check',
    blurb: 'Making sure your browser and device can run a monitored interview.',
    precondition: 'system_check',
    Component: SystemCheckStep,
  },
  {
    state: 'PERMISSION_ACQUISITION',
    title: 'Devices',
    heading: 'Camera & microphone',
    blurb: 'We need your camera and microphone before you start.',
    precondition: 'permission_camera',
    Component: PermissionsStep,
  },
  {
    state: 'SCREEN_SHARE_VALIDATION',
    title: 'Screen',
    heading: 'Share your screen',
    blurb: 'Share your entire screen for the duration of the interview.',
    precondition: 'screen_share',
    Component: ScreenShareStep,
  },
  {
    state: 'ENVIRONMENT_PREPARATION',
    title: 'Setup',
    heading: 'Prepare your space',
    blurb: 'A few things to set up. These are not checked automatically.',
    precondition: 'environment',
    Component: EnvironmentStep,
  },
  {
    state: 'FULLSCREEN_VALIDATION',
    title: 'Fullscreen',
    heading: 'Enter fullscreen',
    blurb: 'One last step before you meet your interviewer.',
    precondition: 'fullscreen',
    Component: FullscreenStep,
  },
  {
    state: 'BASELINE_FACE_CAPTURE',
    title: 'Identity',
    heading: 'Identity photo',
    blurb: 'A quick photo so we can confirm it is you during the interview.',
    precondition: 'baseline',
    Component: BaselineStep,
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
  // own optional work - location, for instance - after its gate has passed.
  // The derived index only decides where to resume, and pulls the candidate
  // back if a gate they already cleared is later invalidated.
  const derivedIndex = STEPS.findIndex((s) => !session.isPassed(s.precondition))
  const [index, setIndex] = useState(() => (derivedIndex === -1 ? STEPS.length : derivedIndex))

  useEffect(() => {
    if (derivedIndex !== -1 && derivedIndex < index) setIndex(derivedIndex)
  }, [derivedIndex, index])

  const advance = useCallback(() => setIndex((i) => i + 1), [])

  const currentIndex = Math.min(index, STEPS.length)
  const step = currentIndex >= STEPS.length ? null : STEPS[currentIndex]

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
    if (step) {
      session.setState(step.state)
      return
    }
    // Every gate has a recorded pass - §7.2 is satisfied.
    if (session.canEnterActive()) {
      session.setState('BASELINE_ESTABLISHED')
      onReady()
    }
  }, [step, session, onReady, snapshot])

  if (!step) {
    return (
      <GradientShell>
        <Card>
          <p className="py-8 text-center text-[14px] text-slate-500">Starting your interview</p>
        </Card>
      </GradientShell>
    )
  }

  const StepBody = step.Component
  // Show progress for the step in hand, so step one is not an empty bar.
  const percent = ((currentIndex + 1) / STEPS.length) * 100

  return (
    <GradientShell>
      <Card>
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <span className="text-[13px] font-medium text-slate-400">
            Step {currentIndex + 1} of {STEPS.length}
          </span>
        </div>

        <ProgressBar value={percent} />

        <div className="mb-7 mt-7">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-900">
            {step.heading}
          </h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-500">{step.blurb}</p>
        </div>

        <StepBody session={session} onDone={advance} />
      </Card>

      <p className="mt-5 text-center text-[13px] text-white/70">
        {jobTitle ?? 'Interview'}
        {candidateName ? ` · ${candidateName}` : ''}
      </p>
    </GradientShell>
  )
}
