import { useState } from 'react'
import {
  Camera,
  Check,
  Cpu,
  Loader2,
  Maximize2,
  Mic,
  MonitorUp,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import {
  isFullscreen,
  requestCameraAndMic,
  requestFullscreen,
  requestScreenShare,
  screenSurfaceKind,
} from '@/proctoring/browser'
import { CONSENT_VERSION, type ProctorSession } from '@/proctoring/session'
import { IconBadge, Note, Panel, PrimaryButton, TextButton } from '@/components/Shell'

/**
 * Pre-flight gate screens (§8.1): consent, camera and microphone, screen
 * share, fullscreen, environment.
 *
 * Every step blocks progression until satisfied and can be retried without
 * limit. No gate failure ever ends a session (§7.3, REQ-STATE-05). Each
 * outcome, pass or fail, is recorded on the session as an auditable attempt.
 */

export interface StepProps {
  session: ProctorSession
  onDone: () => void
}

/** A line of body copy introduced by a small square icon badge. */
function PointRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <IconBadge size="sm">{icon}</IconBadge>
      <p className="pt-1 text-[0.86rem] leading-relaxed text-ink">{children}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Consent
// ---------------------------------------------------------------------------

export function ConsentStep({ session, onDone }: StepProps) {
  const [declined, setDeclined] = useState(false)

  return (
    <Panel
      title="Before we begin"
      description="Here's what you should know about this interview."
      align="start"
      action={
        <>
          <PrimaryButton
            onClick={() => {
              session.recordConsent()
              onDone()
            }}
          >
            I understand and agree
          </PrimaryButton>
          <TextButton
            onClick={() => {
              session.fail('consent', `declined consent v${CONSENT_VERSION}`)
              setDeclined(true)
            }}
          >
            Decline
          </TextButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PointRow icon={<Cpu size={17} />}>
          This interview is conducted and evaluated with the help of AI.
        </PointRow>
        <PointRow icon={<ShieldCheck size={17} />}>
          Your camera, microphone, and screen activity will be recorded and monitored throughout
          the session. We kindly ask that you complete this interview with honesty and integrity,
          as no form of malpractice will be tolerated.
        </PointRow>
        <PointRow icon={<TriangleAlert size={17} />}>
          Should any malpractice be identified during review, it may result in disqualification
          from the hiring process.
        </PointRow>
      </div>

      <div className="mt-6 text-center">
        <a
          href="https://webknot.in/privacy"
          target="_blank"
          rel="noreferrer"
          className="text-[0.82rem] text-accent underline underline-offset-[3px]"
        >
          View full privacy policy
        </a>
      </div>

      {declined && (
        <div className="mt-5">
          <Note>
            A monitored interview cannot start without your agreement. Nothing has been recorded
            and your link is still valid.
          </Note>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 2. Camera and microphone
// ---------------------------------------------------------------------------

export function PermissionsStep({ session, onDone }: StepProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [granted, setGranted] = useState(
    () => session.isPassed('permission_camera') && session.isPassed('permission_microphone'),
  )

  const requestMedia = async () => {
    setBusy(true)
    setError(null)
    try {
      const stream = await requestCameraAndMic()
      session.setCameraStream(stream)
      session.pass('permission_camera')
      session.pass('permission_microphone')
      setGranted(true)
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'permission_denied'
      session.fail('permission_camera', reason)
      session.fail('permission_microphone', reason)
      setError(
        'Access was blocked. Allow the camera and microphone from your browser address bar, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      badge={
        <>
          <IconBadge>
            <Camera size={24} />
          </IconBadge>
          <IconBadge>
            <Mic size={24} />
          </IconBadge>
        </>
      }
      title="Enable camera & microphone"
      description="Camera and microphone access are required to proctor this interview."
      action={
        granted ? (
          <PrimaryButton onClick={onDone}>Continue</PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void requestMedia()} busy={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            Allow camera &amp; microphone access
          </PrimaryButton>
        )
      }
      hint={granted ? 'Camera and microphone are ready.' : 'Used only for interview monitoring.'}
    >
      {error && <Note>{error}</Note>}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 3. Screen share
// ---------------------------------------------------------------------------

/** Mirrors the browser's own picker, so the right choice is obvious up front. */
function SurfacePicker() {
  const options: [string, boolean][] = [
    ['Chrome tab', false],
    ['Window', false],
    ['Entire screen', true],
  ]
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[10px] border border-line bg-panel-alt p-3 text-left">
      <p className="mb-2 text-[0.68rem] text-ink-muted">Choose what to share</p>
      {options.map(([label, selected]) => (
        <div
          key={label}
          className={`mb-1.5 flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[0.74rem] last:mb-0 ${
            selected
              ? 'border-[1.4px] border-accent bg-accent-soft font-semibold text-ink'
              : 'text-ink-muted'
          }`}
        >
          <span
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded ${
              selected ? 'bg-accent text-accent-ink' : 'border-[1.4px] border-line'
            }`}
          >
            {selected && <Check size={9} strokeWidth={3} />}
          </span>
          {label}
        </div>
      ))}
    </div>
  )
}

export function ScreenShareStep({ session, onDone }: StepProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(() => session.screenShareLive())

  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      const stream = await requestScreenShare()
      session.pass('permission_screen')

      const surface = screenSurfaceKind(stream)
      // The browser cannot force a whole screen pick, so validate what came back.
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach((t) => t.stop())
        session.fail('screen_share', `wrong surface: ${surface}`)
        setError(
          'Please share your entire screen, not a single tab or window. Choose "Entire Screen" and try again.',
        )
        return
      }

      session.setScreenStream(stream)
      session.pass('screen_share')
      setLive(true)
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'screen_share_denied'
      session.fail('permission_screen', reason)
      session.fail('screen_share', reason)
      setError('Screen sharing was not started. It is required for this interview.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      badge={
        <IconBadge>
          <MonitorUp size={24} />
        </IconBadge>
      }
      title="Share your entire screen to continue"
      description={
        'This interview requires full screen sharing. When prompted, please select "Entire Screen" — not a browser tab or window.'
      }
      action={
        live ? (
          <PrimaryButton onClick={onDone}>Continue</PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void share()} busy={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            Share my screen
          </PrimaryButton>
        )
      }
      hint={live ? 'Your screen stays shared for the whole interview.' : undefined}
    >
      {live ? (
        <div className="mx-auto flex w-full max-w-[320px] items-center justify-center gap-2 rounded-[10px] border-[1.4px] border-accent bg-accent-soft px-4 py-3 text-[0.82rem] font-semibold text-ink">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-accent text-accent-ink">
            <Check size={9} strokeWidth={3} />
          </span>
          Sharing your entire screen
        </div>
      ) : (
        <SurfacePicker />
      )}

      {error && (
        <div className="mt-5">
          <Note>{error}</Note>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 4. Fullscreen
// ---------------------------------------------------------------------------

export function FullscreenStep({ session, onDone }: StepProps) {
  const [error, setError] = useState(false)

  const enter = async () => {
    setError(false)
    const ok = await requestFullscreen()
    if (!ok && !isFullscreen()) {
      session.fail('fullscreen', 'request rejected')
      setError(true)
      return
    }
    session.pass('fullscreen')
    onDone()
  }

  return (
    <Panel
      badge={
        <IconBadge>
          <Maximize2 size={24} />
        </IconBadge>
      }
      title="Enter fullscreen to continue"
      description="This interview requires fullscreen mode. Please remain in fullscreen for the duration of your interview."
      action={<PrimaryButton onClick={() => void enter()}>Enter fullscreen</PrimaryButton>}
    >
      {error && (
        <Note>
          Your browser did not switch to fullscreen. Try again, or check whether fullscreen is
          blocked for this site.
        </Note>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 5. Environment - the last gate before the room
// ---------------------------------------------------------------------------

const ENVIRONMENT_INSTRUCTIONS = [
  'Sit in a well-lit environment so your face is clearly visible.',
  'Position yourself at the center of the camera frame.',
  'Make sure you’re alone in the room. If more than one face is detected, it may be flagged.',
  'Keep your surroundings free of background conversation. If a second voice is recognized, it may be flagged as malpractice.',
  'Close any other tabs, windows, or applications before continuing.',
]

export function EnvironmentStep({ session, onDone }: StepProps) {
  return (
    <Panel
      title="The interview is about to begin"
      description="Please review the following before you continue."
      align="start"
      action={
        <PrimaryButton
          onClick={() => {
            session.pass('environment')
            onDone()
          }}
        >
          I&rsquo;m ready to continue
        </PrimaryButton>
      }
    >
      <ul className="flex flex-col gap-2.5">
        {ENVIRONMENT_INSTRUCTIONS.map((item) => (
          <li key={item} className="relative pl-[1.15rem] text-[0.86rem] leading-relaxed text-ink">
            <span className="absolute left-0 top-[0.55em] h-[5px] w-[5px] rounded-full bg-accent" />
            {item}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
