/**
 * Live detectors for PROCTORING_ACTIVE.
 *
 * Each detector turns a browser event into raw events on the engine; the engine
 * decides dedup, severity and escalation. Detectors never block the candidate,
 * never end the session, and never show anything - the only candidate-facing
 * output is the recovery prompt the engine derives from an open
 * candidate-visible signal (§8.2).
 */

import {
  detectVirtualCameras,
  hasMultipleDisplays,
  isFullscreen,
  looksAutomated,
  looksLikeDevtoolsOpen,
} from './browser'
import type { ProctorSession } from './session'

const ENVIRONMENT_POLL_MS = 5_000
const RELOAD_MARKER = (token: string) => `proctor:in-room:${token}`

export interface DetectorHandle {
  detach: () => void
  /** Called by the room when the screen-share stream is replaced after recovery. */
  watchScreenStream: (stream: MediaStream | null) => void
}

export function attachDetectors(session: ProctorSession): DetectorHandle {
  const { engine } = session
  const cleanups: Array<() => void> = []

  // ── One-shot environment observations ─────────────────────────────────────
  if (looksAutomated()) engine.discreteOnce('AUTOMATION_DETECTED')
  if (hasMultipleDisplays())
    engine.discreteOnce('MULTIPLE_DISPLAYS', { source: 'screen.isExtended' })
  void detectVirtualCameras().then((labels) => {
    if (labels.length > 0) engine.discreteOnce('VIRTUAL_CAMERA_PRESENT', { devices: labels })
  })

  try {
    if (sessionStorage.getItem(RELOAD_MARKER(session.token)) === '1') {
      engine.discrete('PAGE_RELOADED')
    }
    sessionStorage.setItem(RELOAD_MARKER(session.token), '1')
    cleanups.push(() => sessionStorage.removeItem(RELOAD_MARKER(session.token)))
  } catch {
    // Storage unavailable - reload detection is simply skipped.
  }

  // ── Fullscreen (§10.3, Soft → Hard at 15s) ────────────────────────────────
  const onFullscreenChange = () => {
    if (isFullscreen()) engine.end('FULLSCREEN_EXITED', { recovered: true })
    else engine.start('FULLSCREEN_EXITED')
  }
  if (!isFullscreen()) engine.start('FULLSCREEN_EXITED', { at_attach: true })
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  cleanups.push(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  })

  // ── Tab change (§10.3, Soft → Hard at 2s) ─────────────────────────────────
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') engine.start('TAB_CHANGE')
    else engine.end('TAB_CHANGE')
  }
  document.addEventListener('visibilitychange', onVisibility)
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

  // ── Window change (§10.3, Soft → Hard at 10s) ─────────────────────────────
  // Focus loss while the tab is still visible means another window or app took
  // over; a hidden document is a tab change and is handled above.
  const onBlur = () => {
    if (document.visibilityState === 'hidden') return
    engine.start('WINDOW_CHANGE')
  }
  const onFocus = () => engine.end('WINDOW_CHANGE')
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  cleanups.push(() => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
  })

  // ── Network (§10.5, informational) ────────────────────────────────────────
  const onOffline = () => engine.start('NETWORK_INTERRUPTED')
  const onOnline = () => engine.end('NETWORK_INTERRUPTED')
  if (!navigator.onLine) engine.start('NETWORK_INTERRUPTED', { at_attach: true })
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  cleanups.push(() => {
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  })

  // ── Clipboard (out of registry - observed, and blocked) ───────────────────
  // A voice interview has no text entry, so blocking costs the candidate
  // nothing while preventing question text from being lifted out. Recorded as
  // Informational: it never affects severity and is invisible to the candidate.
  const clipboardHandler = (action: 'copy' | 'cut' | 'paste') => (e: ClipboardEvent) => {
    e.preventDefault()
    engine.discrete('CLIPBOARD_USE', { action })
  }
  const onCopy = clipboardHandler('copy')
  const onCut = clipboardHandler('cut')
  const onPaste = clipboardHandler('paste')
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCut)
  document.addEventListener('paste', onPaste)
  cleanups.push(() => {
    document.removeEventListener('copy', onCopy)
    document.removeEventListener('cut', onCut)
    document.removeEventListener('paste', onPaste)
  })

  // ── Environment poll: devtools + displays ─────────────────────────────────
  let devtoolsOpen = false
  const poll = setInterval(() => {
    const open = looksLikeDevtoolsOpen()
    if (open && !devtoolsOpen) {
      engine.discrete('DEVTOOLS_OPENED', {
        width_gap: window.outerWidth - window.innerWidth,
        height_gap: window.outerHeight - window.innerHeight,
      })
    }
    devtoolsOpen = open
    if (hasMultipleDisplays()) engine.discreteOnce('MULTIPLE_DISPLAYS', { source: 'poll' })
  }, ENVIRONMENT_POLL_MS)
  cleanups.push(() => clearInterval(poll))

  // ── Screen share (§10.3, Soft → Hard at 30s) ──────────────────────────────
  let watchedTrack: MediaStreamTrack | null = null
  let trackCleanup: (() => void) | null = null

  const watchScreenStream = (stream: MediaStream | null) => {
    trackCleanup?.()
    trackCleanup = null
    watchedTrack = stream?.getVideoTracks()[0] ?? null

    if (!watchedTrack || watchedTrack.readyState !== 'live') {
      engine.start('SCREEN_SHARE_INTERRUPTED')
      return
    }

    // A live track after an interruption is a recovery.
    engine.end('SCREEN_SHARE_INTERRUPTED', { recovered: true })
    engine.discrete('SCREEN_SHARE_RESUMED')

    const onEnded = () => engine.start('SCREEN_SHARE_INTERRUPTED', { reason: 'track_ended' })
    const onMute = () => engine.start('SCREEN_SHARE_INTERRUPTED', { reason: 'track_muted' })
    const onUnmute = () => engine.end('SCREEN_SHARE_INTERRUPTED', { recovered: true })
    watchedTrack.addEventListener('ended', onEnded)
    watchedTrack.addEventListener('mute', onMute)
    watchedTrack.addEventListener('unmute', onUnmute)
    trackCleanup = () => {
      watchedTrack?.removeEventListener('ended', onEnded)
      watchedTrack?.removeEventListener('mute', onMute)
      watchedTrack?.removeEventListener('unmute', onUnmute)
    }
  }

  // The stream that came out of the pre-flight is already live; watch it
  // without emitting a spurious "resumed" marker on attach.
  const initial = session.screenStream?.getVideoTracks()[0] ?? null
  if (initial && initial.readyState === 'live') {
    const onEnded = () => engine.start('SCREEN_SHARE_INTERRUPTED', { reason: 'track_ended' })
    const onMute = () => engine.start('SCREEN_SHARE_INTERRUPTED', { reason: 'track_muted' })
    const onUnmute = () => engine.end('SCREEN_SHARE_INTERRUPTED', { recovered: true })
    initial.addEventListener('ended', onEnded)
    initial.addEventListener('mute', onMute)
    initial.addEventListener('unmute', onUnmute)
    watchedTrack = initial
    trackCleanup = () => {
      initial.removeEventListener('ended', onEnded)
      initial.removeEventListener('mute', onMute)
      initial.removeEventListener('unmute', onUnmute)
    }
  } else {
    engine.start('SCREEN_SHARE_INTERRUPTED', { at_attach: true })
  }
  cleanups.push(() => trackCleanup?.())

  return {
    detach: () => cleanups.forEach((fn) => fn()),
    watchScreenStream,
  }
}
