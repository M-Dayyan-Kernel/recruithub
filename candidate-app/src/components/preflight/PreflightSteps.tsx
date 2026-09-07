import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Camera,
  Check,
  Loader2,
  MapPin,
  Maximize2,
  Mic,
  MonitorUp,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  captureFrame,
  capabilityBlockers,
  isFullscreen,
  probeCapabilities,
  requestCameraAndMic,
  requestFullscreen,
  requestLocation,
  requestScreenShare,
  screenSurfaceKind,
  type CapabilityReport,
} from '@/proctoring/browser'
import { CONSENT_VERSION, type ProctorSession } from '@/proctoring/session'
import { GhostButton, IconChip, PrimaryButton } from '@/components/GradientShell'

/**
 * Pre-flight gate screens (§8.1).
 *
 * Every step blocks progression until satisfied and can be retried without
 * limit. No gate failure ever ends a session (§7.3, REQ-STATE-05). Each
 * outcome, pass or fail, is recorded on the session as an auditable attempt.
 */

export interface StepProps {
  session: ProctorSession
  onDone: () => void
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
      {children}
    </p>
  )
}

function OptionRow({
  icon,
  title,
  subtitle,
  state = 'idle',
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  state?: 'idle' | 'done' | 'failed'
}) {
  return (
    <div
      className={`flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 transition-colors ${
        state === 'done'
          ? 'border-indigo-200 bg-indigo-50/60'
          : state === 'failed'
            ? 'border-rose-200 bg-rose-50/60'
            : 'border-slate-200 bg-white'
      }`}
    >
      <IconChip tone={state === 'done' ? 'brand' : state === 'failed' ? 'danger' : 'muted'}>
        {icon}
      </IconChip>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        <p className="text-[13px] text-slate-500">{subtitle}</p>
      </div>
      <span
        className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          state === 'done' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white'
        }`}
      >
        {state === 'done' && <Check size={13} strokeWidth={3} />}
      </span>
    </div>
  )
}

function CheckList({ report }: { report: CapabilityReport }) {
  const items: [string, boolean][] = [
    ['Secure connection', report.secure_context],
    ['Camera and microphone access', report.media_devices],
    ['Camera found', report.camera_present],
    ['Microphone found', report.microphone_present],
    ['Screen sharing', report.screen_capture],
    ['Fullscreen', report.fullscreen],
    ['Tab change detection', report.visibility_api],
    ['Network connection', report.online],
  ]
  return (
    <div className="grid gap-x-6 gap-y-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:grid-cols-2">
      {items.map(([label, ok]) => (
        <div key={label} className="flex items-center gap-2.5">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              ok ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
            }`}
          >
            {ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
          </span>
          <span className={`text-[13px] ${ok ? 'text-slate-600' : 'text-rose-600'}`}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Consent
// ---------------------------------------------------------------------------

const CONSENT_COVERS = [
  'Camera and microphone capture for the whole interview',
  'Screen sharing of your entire screen',
  'A baseline photo used to verify your identity',
  'Recording and storage of the video and audio as review evidence',
  'AI analysis of that recording to detect integrity concerns',
  'Review by an authorised member of the hiring team',
]

export function ConsentStep({ session, onDone }: StepProps) {
  const [declined, setDeclined] = useState(false)

  return (
    <div className="space-y-6">
      <ul className="space-y-2.5">
        {CONSENT_COVERS.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="text-[14px] leading-6 text-slate-600">{item}</span>
          </li>
        ))}
      </ul>

      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-500">
        Leaving the interview screen during the session is recorded. You will be warned once before
        the interview ends.
      </p>

      {declined && (
        <Note>
          A monitored interview cannot start without your agreement. Nothing has been recorded and
          your link is still valid.
        </Note>
      )}

      <div className="space-y-2.5">
        <PrimaryButton
          onClick={() => {
            session.recordConsent()
            onDone()
          }}
        >
          I agree, continue <ArrowRight size={17} />
        </PrimaryButton>
        <button
          onClick={() => {
            session.fail('consent', `declined consent v${CONSENT_VERSION}`)
            setDeclined(true)
          }}
          className="h-10 w-full cursor-pointer text-[14px] font-medium text-slate-400 transition-colors hover:text-slate-600"
        >
          I do not agree
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. System check
// ---------------------------------------------------------------------------

export function SystemCheckStep({ session, onDone }: StepProps) {
  const [report, setReport] = useState<CapabilityReport | null>(null)
  const [checking, setChecking] = useState(true)

  const run = async () => {
    setChecking(true)
    const next = await probeCapabilities()
    setReport(next)
    setChecking(false)
    const blockers = capabilityBlockers(next)
    if (blockers.length > 0) session.fail('system_check', blockers.join('; '))
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blockers = report ? capabilityBlockers(report) : []

  return (
    <div className="space-y-6">
      {checking || !report ? (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-[14px] text-slate-500">
          <Loader2 size={16} className="animate-spin text-indigo-600" aria-hidden />
          Running checks
        </div>
      ) : (
        <>
          <CheckList report={report} />
          <p className="text-[13px] text-slate-400">{report.browser}</p>
        </>
      )}

      {blockers.length > 0 && <Note>{blockers.join(' ')}</Note>}

      {report && blockers.length === 0 ? (
        <PrimaryButton
          onClick={() => {
            session.pass('system_check')
            onDone()
          }}
        >
          Continue <ArrowRight size={17} />
        </PrimaryButton>
      ) : (
        <GhostButton onClick={() => void run()} disabled={checking}>
          <RefreshCw size={16} /> Run checks again
        </GhostButton>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. Permissions
// ---------------------------------------------------------------------------

export function PermissionsStep({ session, onDone }: StepProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [granted, setGranted] = useState(
    () => session.isPassed('permission_camera') && session.isPassed('permission_microphone'),
  )
  const [location, setLocation] = useState<'idle' | 'busy' | 'done'>('idle')

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

  const askLocation = async () => {
    setLocation('busy')
    const position = await requestLocation()
    if (position) session.pass('permission_location')
    else session.fail('permission_location', 'denied or unavailable')
    setLocation('done')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <OptionRow
          icon={<Camera size={17} />}
          title="Camera"
          subtitle="Required for the whole interview"
          state={granted ? 'done' : error ? 'failed' : 'idle'}
        />
        <OptionRow
          icon={<Mic size={17} />}
          title="Microphone"
          subtitle="Required to speak with the interviewer"
          state={granted ? 'done' : error ? 'failed' : 'idle'}
        />
        <OptionRow
          icon={<MapPin size={17} />}
          title="Location"
          subtitle="Optional, you can skip this"
          state={location === 'done' ? 'done' : 'idle'}
        />
      </div>

      {error && <Note>{error}</Note>}

      {!granted ? (
        <PrimaryButton onClick={() => void requestMedia()} busy={busy}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : null}
          Allow camera and microphone
        </PrimaryButton>
      ) : (
        <div className="space-y-2.5">
          <PrimaryButton onClick={onDone}>
            Continue <ArrowRight size={17} />
          </PrimaryButton>
          {location === 'idle' && (
            <GhostButton onClick={() => void askLocation()}>Share location</GhostButton>
          )}
          {location === 'busy' && (
            <p className="text-center text-[13px] text-slate-400">Waiting for location</p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Screen share
// ---------------------------------------------------------------------------

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
    <div className="space-y-6">
      <OptionRow
        icon={<MonitorUp size={17} />}
        title="Entire screen"
        subtitle={live ? 'Sharing now' : 'Choose "Entire Screen" in the picker'}
        state={live ? 'done' : error ? 'failed' : 'idle'}
      />

      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-500">
        Your screen stays shared for the whole interview. If it stops, you will be asked to resume
        it.
      </p>

      {error && <Note>{error}</Note>}

      {live ? (
        <PrimaryButton onClick={onDone}>
          Continue <ArrowRight size={17} />
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={() => void share()} busy={busy}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : null}
          Share entire screen
        </PrimaryButton>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5. Environment
// ---------------------------------------------------------------------------

const ENVIRONMENT_INSTRUCTIONS = [
  'Sit in a well lit room with the light in front of you.',
  'Centre your face in the camera frame.',
  'Make sure you are alone and will not be interrupted.',
  'Close every other tab, window and application.',
]

export function EnvironmentStep({ session, onDone }: StepProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <div className="space-y-6">
      <ul className="space-y-2.5">
        {ENVIRONMENT_INSTRUCTIONS.map((item, i) => (
          <li key={item} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-semibold text-slate-500">
              {i + 1}
            </span>
            <span className="text-[14px] leading-6 text-slate-600">{item}</span>
          </li>
        ))}
      </ul>

      <label
        className={`flex cursor-pointer select-none items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors ${
          acknowledged
            ? 'border-indigo-200 bg-indigo-50/60'
            : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="peer sr-only"
        />
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-white transition-colors peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2">
          <Check size={13} strokeWidth={3} className={acknowledged ? '' : 'opacity-0'} />
        </span>
        <span className="text-[14px] leading-6 text-slate-700">
          My space is ready and I have closed all other tabs and applications.
        </span>
      </label>

      <PrimaryButton
        disabled={!acknowledged}
        onClick={() => {
          session.pass('environment')
          onDone()
        }}
      >
        Continue <ArrowRight size={17} />
      </PrimaryButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6. Fullscreen
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
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 px-6 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm">
          <Maximize2 size={22} />
        </span>
        <p className="max-w-sm text-[14px] leading-relaxed text-slate-600">
          The interview runs in fullscreen. If you leave fullscreen during the session you will be
          asked to return to it.
        </p>
      </div>

      {error && (
        <Note>
          Your browser did not switch to fullscreen. Try again, or check whether fullscreen is
          blocked for this site.
        </Note>
      )}

      <PrimaryButton onClick={() => void enter()}>
        Enter fullscreen <ArrowRight size={17} />
      </PrimaryButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 7. Baseline photo
// ---------------------------------------------------------------------------

export function BaselineStep({ session, onDone }: StepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stream = session.cameraStream
    const video = videoRef.current
    if (!stream || !video) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [session, photo])

  const capture = async () => {
    setBusy(true)
    setError(null)
    const stream = session.cameraStream
    if (!stream) {
      session.fail('baseline', 'no camera stream')
      setError('Your camera is no longer available. Go back and allow camera access again.')
      setBusy(false)
      return
    }
    const frame = await captureFrame(stream)
    if (!frame) {
      session.fail('baseline', 'frame capture failed')
      setError('The photo could not be captured. Please try again.')
      setBusy(false)
      return
    }
    setPhoto(frame)
    setBusy(false)
  }

  const accept = () => {
    if (!photo) return
    session.setBaselineImage(photo)
    session.pass('baseline')
    // Release the device so the interview room can claim the camera.
    session.releaseCamera()
    onDone()
  }

  return (
    <div className="space-y-6">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-200">
        {photo ? (
          <img src={photo} alt="Your baseline photo" className="h-full w-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full scale-x-[-1] object-cover"
          />
        )}
        <span className="pointer-events-none absolute inset-6 rounded-full border-2 border-dashed border-white/25" />
      </div>

      <p className="text-center text-[13px] text-slate-500">
        Centre your face in the circle. You can retake this as many times as you like.
      </p>

      {error && <Note>{error}</Note>}

      {photo ? (
        <div className="space-y-2.5">
          <PrimaryButton onClick={accept}>
            Use this photo <ArrowRight size={17} />
          </PrimaryButton>
          <GhostButton onClick={() => setPhoto(null)}>Retake</GhostButton>
        </div>
      ) : (
        <PrimaryButton onClick={() => void capture()} busy={busy}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Camera size={17} />}
          Take photo
        </PrimaryButton>
      )}
    </div>
  )
}
