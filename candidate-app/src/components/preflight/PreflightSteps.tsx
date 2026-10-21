import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Cpu,
  Loader2,
  Maximize2,
  Mic,
  MonitorUp,
  Puzzle,
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
import type { GateResult, ProhibitedExtension, UnavailableReason } from '@/lib/extensionCheck'
import { installMode, scanForGate } from '@/lib/extensionGate'
import { offersInstall } from '@/lib/extensionInstall'
import { ExtensionInstallGuide } from './ExtensionInstallGuide'
import {
  createReadinessRunner,
  preconditionsToInvalidate,
  type ReadinessFailure,
  type ReadinessReport,
} from '@/lib/readiness'
import { collectReadiness } from '@/lib/readinessGate'

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
// Shared media acquisition (first-time steps and final-gate recovery)
// ---------------------------------------------------------------------------

type AcquireResult = { ok: true } | { ok: false; message: string }

/**
 * One getUserMedia call for camera and microphone. `setCameraStream` stops any
 * stream it replaces, so a recovery never leaves a second one running.
 */
async function acquireCameraAndMic(session: ProctorSession): Promise<AcquireResult> {
  try {
    const stream = await requestCameraAndMic()
    session.setCameraStream(stream)
    session.pass('permission_camera')
    session.pass('permission_microphone')
    return { ok: true }
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'permission_denied'
    session.fail('permission_camera', reason)
    session.fail('permission_microphone', reason)
    return {
      ok: false,
      message:
        'Access was blocked. Allow the camera and microphone from your browser address bar, then try again.',
    }
  }
}

/** Screen share, validated for "entire screen". Replaces (and stops) a dead stream. */
async function acquireScreenShare(session: ProctorSession): Promise<AcquireResult> {
  try {
    const stream = await requestScreenShare()
    session.pass('permission_screen')

    const surface = screenSurfaceKind(stream)
    // The browser cannot force a whole screen pick, so validate what came back.
    if (surface && surface !== 'monitor') {
      stream.getTracks().forEach((t) => t.stop())
      session.fail('screen_share', `wrong surface: ${surface}`)
      return {
        ok: false,
        message:
          'Please share your entire screen, not a single tab or window. Choose "Entire Screen" and try again.',
      }
    }

    session.setScreenStream(stream)
    session.pass('screen_share')
    return { ok: true }
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'screen_share_denied'
    session.fail('permission_screen', reason)
    session.fail('screen_share', reason)
    return { ok: false, message: 'Screen sharing was not started. It is required for this interview.' }
  }
}

// ---------------------------------------------------------------------------
// 0. Extension check
// ---------------------------------------------------------------------------

const UNAVAILABLE_COPY: Record<UnavailableReason, { title: string; body: string }> = {
  unsupported_browser: {
    title: 'Please use Google Chrome',
    body: 'This interview can only be started in Google Chrome on a computer, with the Recruit Hub Interview Check extension installed.',
  },
  not_configured: {
    title: 'The extension check is not set up',
    body: 'We could not verify your browser. Please contact the hiring team and tell them this check is not configured.',
  },
  extension_unreachable: {
    title: 'Install the Recruit Hub Interview Check extension',
    body: 'We could not reach the extension. Install it, make sure it is enabled for this browser profile, then check again.',
  },
  timeout: {
    title: 'The extension did not respond',
    body: 'Make sure the Recruit Hub Interview Check extension is enabled, then check again.',
  },
  scan_failed: {
    title: 'The extension check could not finish',
    body: 'Your extensions could not be checked, so we cannot start yet. Check again, or restart Chrome if it keeps happening.',
  },
  invalid_response: {
    title: 'The extension check returned an unexpected result',
    body: 'Update or reinstall the Recruit Hub Interview Check extension, then check again.',
  },
  stale_result: {
    title: 'The extension check was out of date',
    body: 'Please check again.',
  },
}

/** The prohibited extensions found, and the manual steps to turn them off. */
function BlockedExtensionList({ extensions }: { extensions: ProhibitedExtension[] }) {
  return (
    <>
      <ul className="flex flex-col gap-2">
        {extensions.map((ext) => (
          <li key={ext.id} className="rounded-[9px] border border-line bg-panel px-4 py-3">
            <p className="text-[0.9rem] font-semibold text-ink">{ext.name}</p>
            {ext.reason && <p className="mt-0.5 text-[0.8rem] text-ink-muted">{ext.reason}</p>}
          </li>
        ))}
      </ul>
      <ol className="mt-5 list-decimal pl-5 text-left text-[0.86rem] leading-relaxed text-ink">
        <li>
          Open a new tab and go to <strong className="font-semibold">chrome://extensions</strong>.
        </li>
        <li>Turn off each extension listed above.</li>
        <li>Come back to this page and choose Rescan.</li>
      </ol>
      <p className="mt-4 text-left text-[0.8rem] leading-relaxed text-ink-muted">
        Quicker: open this interview in a new Chrome profile or a Guest window that has only the
        Recruit Hub Interview Check extension.
      </p>
    </>
  )
}

function failureReason(result: GateResult): string {
  if (result.status === 'blocked') {
    return `prohibited_extension_enabled: ${result.extensions.map((e) => e.id).join(',')}`
  }
  if (result.status === 'unavailable') return `extension_check_${result.reason}`
  return 'extension_check'
}

/**
 * Asks the Recruit Hub Interview Check extension for a fresh scan and only
 * lets the candidate on when it reports a completed scan with nothing
 * prohibited enabled. Anything else - missing extension, failed scan - holds
 * the candidate here (fail closed). The same scan runs again at the moment the
 * interview starts; passing this screen is not the last word.
 */
export function ExtensionCheckStep({ session, onDone }: StepProps) {
  const [result, setResult] = useState<GateResult | null>(null)
  const run = useRef(0)

  const check = useCallback(async () => {
    const id = ++run.current
    setResult(null)
    const next = await scanForGate({ token: session.token, phase: 'preflight' })
    if (id !== run.current) return // superseded by a rescan or unmount
    setResult(next)
    if (next.status === 'clear') {
      session.pass('extension_check')
      onDone()
    } else {
      session.fail('extension_check', failureReason(next))
    }
  }, [session, onDone])

  useEffect(() => {
    void check()
    return () => {
      run.current += 1
    }
  }, [check])

  if (!result || result.status === 'clear') {
    return (
      <Panel
        badge={
          <IconBadge>
            <Loader2 size={24} className="animate-spin" />
          </IconBadge>
        }
        title="Checking your browser"
        description="Making sure no AI-assistance extension is enabled. This only takes a moment."
      />
    )
  }

  if (result.status === 'blocked') {
    return (
      <Panel
        badge={
          <IconBadge>
            <TriangleAlert size={24} />
          </IconBadge>
        }
        title="Turn off these extensions to continue"
        description="The extensions below are not allowed during this interview. Nothing has been changed on your browser."
        align="start"
        action={<PrimaryButton onClick={() => void check()}>Rescan</PrimaryButton>}
      >
        <BlockedExtensionList extensions={result.extensions} />
      </Panel>
    )
  }

  const copy = UNAVAILABLE_COPY[result.reason]
  const canInstall = offersInstall(result.reason)

  return (
    <Panel
      badge={
        <IconBadge>
          <Puzzle size={24} />
        </IconBadge>
      }
      title={copy.title}
      description={copy.body}
      align={canInstall && installMode.kind === 'sideload' ? 'start' : 'center'}
      action={
        <>
          <PrimaryButton onClick={() => void check()}>Check again</PrimaryButton>
          {canInstall && installMode.kind === 'store' && (
            <a
              href={installMode.url}
              target="_blank"
              rel="noreferrer"
              className="text-[0.9rem] font-semibold text-accent underline underline-offset-[3px]"
            >
              Get the extension
            </a>
          )}
        </>
      }
    >
      {canInstall && installMode.kind === 'sideload' && (
        <ExtensionInstallGuide zipUrl={installMode.zipUrl} />
      )}
      <Note>
        You cannot start the interview until this check passes. Your link is still valid.
      </Note>
    </Panel>
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
    const result = await acquireCameraAndMic(session)
    if (result.ok) setGranted(true)
    else setError(result.message)
    setBusy(false)
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
    const result = await acquireScreenShare(session)
    if (result.ok) setLive(true)
    else setError(result.message)
    setBusy(false)
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

/**
 * The final readiness gate. "I'm ready to continue" runs a fresh check of
 * everything the room needs - extension scan, camera, microphone, screen share,
 * fullscreen - against the streams as they are right now, not against what was
 * recorded earlier. Only a clean result passes `environment` and moves on.
 *
 * A failure stays here: only the failed checks are shown, each with its own
 * recovery action, and consent and the other valid gates are untouched. After
 * every recovery the whole check re-runs, because fixing one thing (visiting
 * chrome://extensions) can break another (fullscreen, screen sharing).
 */
export function EnvironmentStep({ session, onDone }: StepProps) {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const runner = useMemo(() => createReadinessRunner(() => collectReadiness(session, 'final')), [session])
  // StrictMode mounts effects twice; a ref (not cleanup-invalidation) keeps the
  // first in-flight result usable while still ignoring results after unmount.
  const alive = useRef(false)
  const autoRan = useRef(false)

  const evaluate = useCallback(
    async (supersede: boolean) => {
      setBusy(true)
      const { result, current } = await runner.run({ supersede })
      // A newer run owns the screen (and still owns `busy`); a gone component owns nothing.
      if (!current || !alive.current) return
      setBusy(false)

      if (result.ok) {
        // Re-record only what had been invalidated, then close the gate.
        for (const type of [
          'extension_check',
          'permission_camera',
          'permission_microphone',
          'screen_share',
          'fullscreen',
        ] as const) {
          if (!session.isPassed(type)) session.pass(type)
        }
        setReport(null)
        session.pass('environment')
        onDone()
        return
      }

      // Invalidate exactly what failed - never consent, never what still holds.
      const reasons = new Map<string, string>()
      for (const failure of result.failures) reasons.set(failureKey(failure), describeFailure(failure))
      for (const type of preconditionsToInvalidate(result.failures)) {
        if (session.isPassed(type)) session.fail(type, reasons.get(type) ?? 'readiness_check_failed')
      }
      setReport(result)
    },
    [runner, session, onDone],
  )

  useEffect(() => {
    alive.current = true
    // The room's start-time check bounced the candidate here: show what changed
    // immediately. A clean result still waits for a click, so this cannot loop.
    if (!autoRan.current && session.consumeFinalRecheck()) {
      autoRan.current = true
      void evaluate(true)
    }
    return () => {
      alive.current = false
    }
  }, [evaluate, session])

  // While failures are showing, the world can change under the candidate
  // (leaving fullscreen, ending a share). Re-check rather than show stale advice.
  const hasFailures = Boolean(report && !report.ok)
  useEffect(() => {
    if (!hasFailures) return
    const recheck = () => void evaluate(true)
    const tracks = [
      ...(session.screenStream?.getTracks() ?? []),
      ...(session.cameraStream?.getTracks() ?? []),
    ]
    document.addEventListener('fullscreenchange', recheck)
    tracks.forEach((t) => t.addEventListener('ended', recheck))
    return () => {
      document.removeEventListener('fullscreenchange', recheck)
      tracks.forEach((t) => t.removeEventListener('ended', recheck))
    }
  }, [hasFailures, evaluate, session])

  const recover = async (action: () => Promise<AcquireResult | boolean | void>) => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    const outcome = await action()
    if (outcome && typeof outcome === 'object' && !outcome.ok) setActionError(outcome.message)
    // Whatever the action did, re-run the whole check against the new reality.
    await evaluate(true)
  }

  const failures = report?.failures ?? []
  const byCheck = (check: ReadinessFailure['check']) => failures.find((f) => f.check === check)
  const extension = byCheck('extension')
  const camera = byCheck('camera')
  const microphone = byCheck('microphone')
  const screen = byCheck('screen_share')
  const fullscreen = byCheck('fullscreen')

  if (report && !report.ok) {
    return (
      <Panel
        badge={
          <IconBadge>
            <TriangleAlert size={24} />
          </IconBadge>
        }
        title="A few things need your attention"
        description="Fix the items below, then we'll check again. Everything else you completed is kept."
        align="start"
      >
        <div className="flex flex-col gap-3">
          {extension && extension.check === 'extension' && (
            <FailureCard title="Browser extensions">
              {extension.gate.status === 'blocked' ? (
                <BlockedExtensionList extensions={extension.gate.extensions} />
              ) : (
                <p className="text-[0.86rem] leading-relaxed text-ink">
                  <strong className="font-semibold">
                    {UNAVAILABLE_COPY[extension.gate.reason].title}.
                  </strong>{' '}
                  {UNAVAILABLE_COPY[extension.gate.reason].body}
                  {installMode.kind === 'store' && offersInstall(extension.gate.reason) && (
                    <>
                      {' '}
                      <a
                        href={installMode.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-accent underline underline-offset-[3px]"
                      >
                        Get the extension
                      </a>
                    </>
                  )}
                </p>
              )}
              {extension.gate.status !== 'blocked' &&
                installMode.kind === 'sideload' &&
                offersInstall(extension.gate.reason) && (
                  <div className="mt-3">
                    <ExtensionInstallGuide zipUrl={installMode.zipUrl} />
                  </div>
                )}
              <div className="mt-3">
                <PrimaryButton onClick={() => void recover(async () => undefined)} busy={busy}>
                  Rescan
                </PrimaryButton>
              </div>
            </FailureCard>
          )}

          {(camera || microphone) && (
            <FailureCard title="Camera and microphone">
              <p className="text-[0.86rem] leading-relaxed text-ink">
                {camera && microphone
                  ? 'Your camera and microphone are not available or have stopped.'
                  : camera
                    ? 'Your camera is not available or has stopped.'
                    : 'Your microphone is not available or has stopped.'}
              </p>
              <div className="mt-3">
                <PrimaryButton
                  onClick={() => void recover(() => acquireCameraAndMic(session))}
                  busy={busy}
                >
                  Allow camera &amp; microphone access
                </PrimaryButton>
              </div>
            </FailureCard>
          )}

          {screen && (
            <FailureCard title="Screen sharing">
              <p className="text-[0.86rem] leading-relaxed text-ink">
                Your screen is not being shared. Share your entire screen to continue.
              </p>
              <div className="mt-3">
                <PrimaryButton onClick={() => void recover(() => acquireScreenShare(session))} busy={busy}>
                  Share my screen
                </PrimaryButton>
              </div>
            </FailureCard>
          )}

          {fullscreen && (
            <FailureCard title="Fullscreen">
              <p className="text-[0.86rem] leading-relaxed text-ink">
                This interview must run in fullscreen. Switch back to fullscreen to continue.
              </p>
              <div className="mt-3">
                <PrimaryButton
                  onClick={() => void recover(async () => (await requestFullscreen()) as boolean)}
                  busy={busy}
                >
                  Enter fullscreen
                </PrimaryButton>
              </div>
            </FailureCard>
          )}

          {actionError && <Note>{actionError}</Note>}
        </div>
      </Panel>
    )
  }

  return (
    <Panel
      title="The interview is about to begin"
      description="Please review the following before you continue."
      align="start"
      action={
        <PrimaryButton onClick={() => void evaluate(false)} busy={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
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

function FailureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-line bg-panel p-4">
      <p className="mb-2 text-[0.9rem] font-semibold text-ink">{title}</p>
      {children}
    </div>
  )
}

/** The precondition a failure invalidates, as the key used to look up its reason. */
function failureKey(failure: ReadinessFailure): string {
  return preconditionsToInvalidate([failure])[0]
}

function describeFailure(failure: ReadinessFailure): string {
  if (failure.check === 'extension') {
    return failure.gate.status === 'blocked'
      ? `prohibited_extension_enabled: ${failure.gate.extensions.map((e) => e.id).join(',')}`
      : `extension_check_${failure.gate.reason}`
  }
  return `${failure.check}_${failure.reason}`
}
