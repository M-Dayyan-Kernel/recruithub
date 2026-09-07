import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestFullscreen, requestScreenShare } from '@/proctoring/browser'
import { attachDetectors, type DetectorHandle } from '@/proctoring/detectors'
import type { EngineSnapshot } from '@/proctoring/engine'
import { EnforcementTracker, enforcementMessage } from '@/proctoring/policy'
import { getProctorSession, type ProctorSession, type SessionSnapshot } from '@/proctoring/session'

/**
 * Subscribes to the pre-flight state of a proctoring session (gates, attempts,
 * consent, baseline). Used by the pre-flight screens.
 */
export function useProctorSession(token: string): {
  session: ProctorSession
  snapshot: SessionSnapshot
} {
  const session = useMemo(() => getProctorSession(token), [token])
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => session.snapshot())

  useEffect(() => session.subscribe(setSnapshot), [session])

  return { session, snapshot }
}

export interface ProctorWarning {
  message: string
  /** Warnings left before the next occurrence ends the interview. */
  remaining: number
}

export interface ActiveProctoring {
  session: ProctorSession
  snapshot: EngineSnapshot
  /** Current warning to show the candidate, or null. */
  warning: ProctorWarning | null
  dismissWarning: () => void
  /** Report LiveKit camera track state - drives CAMERA_INTERRUPTED (§10.4). */
  reportCamera: (live: boolean) => void
  /** Report LiveKit microphone track state - drives MICROPHONE_INTERRUPTED. */
  reportMicrophone: (live: boolean) => void
  /** Recovery actions behind the candidate-facing prompts (§8.2). */
  recoverFullscreen: () => Promise<void>
  recoverScreenShare: () => Promise<void>
}

/**
 * Runs continuous monitoring for PROCTORING_ACTIVE.
 *
 * Detection only: nothing here blocks the interview, ends it, or shows the
 * candidate anything beyond the four recovery prompts the engine surfaces.
 */
export function useActiveProctoring(
  token: string,
  enabled: boolean,
  onEnd?: (reason: string) => void,
): ActiveProctoring {
  const session = useMemo(() => getProctorSession(token), [token])
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => session.engine.snapshot())
  const [warning, setWarning] = useState<ProctorWarning | null>(null)
  const detectorsRef = useRef<DetectorHandle | null>(null)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  // See proctoring/policy.ts for what counts and how many warnings are allowed.
  const enforcement = useRef(new EnforcementTracker())

  useEffect(
    () =>
      session.engine.subscribe((next) => {
        setSnapshot(next)
        if (!enabled) return

        const tracker = enforcement.current
        for (const signal of next.signals) {
          const outcome = tracker.consider(signal)
          if (!outcome) continue

          const message = enforcementMessage(signal.signal_type)
          if (outcome === 'end') {
            session.setEndedReason(message)
            setWarning(null)
            onEndRef.current?.(message)
            return
          }
          setWarning({ message, remaining: tracker.remaining })
        }
      }),
    [session, enabled],
  )

  useEffect(() => {
    if (!enabled) return

    const handle = attachDetectors(session)
    detectorsRef.current = handle

    session.transport.start(() => {
      const snap = session.engine.snapshot()
      const sessionSnap = session.snapshot()
      return {
        events: snap.events,
        signals: snap.signals,
        preconditions: sessionSnap.preconditions,
        attempts: sessionSnap.attempts,
      }
    })

    return () => {
      handle.detach()
      detectorsRef.current = null
      session.transport.stop()
    }
  }, [enabled, session])

  const reportCamera = useCallback(
    (live: boolean) => {
      if (live) session.engine.end('CAMERA_INTERRUPTED', { recovered: true })
      else session.engine.start('CAMERA_INTERRUPTED')
    },
    [session],
  )

  const reportMicrophone = useCallback(
    (live: boolean) => {
      if (live) session.engine.end('MICROPHONE_INTERRUPTED', { recovered: true })
      else session.engine.start('MICROPHONE_INTERRUPTED')
    },
    [session],
  )

  const recoverFullscreen = useCallback(async () => {
    await requestFullscreen()
  }, [])

  const recoverScreenShare = useCallback(async () => {
    try {
      const stream = await requestScreenShare()
      session.setScreenStream(stream)
      detectorsRef.current?.watchScreenStream(stream)
    } catch {
      // Candidate dismissed the picker - the prompt stays up, nothing else changes.
    }
  }, [session])

  const dismissWarning = useCallback(() => setWarning(null), [])

  return {
    session,
    snapshot,
    warning,
    dismissWarning,
    reportCamera,
    reportMicrophone,
    recoverFullscreen,
    recoverScreenShare,
  }
}
