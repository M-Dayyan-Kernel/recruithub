/**
 * Browser primitives used by the pre-flight checks and the live detectors.
 *
 * Everything here is a capability probe or a permission request - no policy,
 * no signals. §8.1 requires "capability exists", "permission granted" and
 * "stream active" to stay distinct conditions, so they are separate functions.
 */

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void>
}

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Fullscreen
// ---------------------------------------------------------------------------

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FullscreenEl
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen)
}

export function isFullscreen(): boolean {
  const doc = document as FullscreenDoc
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement)
}

/** Must be called inside a user gesture or the browser rejects it. */
export async function requestFullscreen(): Promise<boolean> {
  const el = document.documentElement as FullscreenEl
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
    else return false
    return isFullscreen()
  } catch {
    return false
  }
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FullscreenDoc
  try {
    if (!isFullscreen()) return
    if (doc.exitFullscreen) await doc.exitFullscreen()
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Capability probes (§8.1 System/Browser Check)
// ---------------------------------------------------------------------------

export interface CapabilityReport {
  media_devices: boolean
  camera_present: boolean
  microphone_present: boolean
  screen_capture: boolean
  fullscreen: boolean
  /** Tab/window change detection - a browser without it is unsupported. */
  visibility_api: boolean
  online: boolean
  secure_context: boolean
  browser: string
}

export function describeBrowser(): string {
  const ua = navigator.userAgent
  const match =
    /(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/.exec(ua.replace('Edg/', 'Edg/')) ?? null
  if (!match) return 'Unknown browser'
  const name = { Edg: 'Edge', OPR: 'Opera' }[match[1]] ?? match[1]
  return `${name} ${match[2].split('.')[0]}`
}

export async function probeCapabilities(): Promise<CapabilityReport> {
  const mediaDevices = Boolean(navigator.mediaDevices?.getUserMedia)
  let cameraPresent = false
  let microphonePresent = false

  if (mediaDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      cameraPresent = devices.some((d) => d.kind === 'videoinput')
      microphonePresent = devices.some((d) => d.kind === 'audioinput')
    } catch {
      // Enumeration can fail before any permission is granted; the permission
      // step is the authoritative check.
    }
  }

  return {
    media_devices: mediaDevices,
    camera_present: cameraPresent,
    microphone_present: microphonePresent,
    screen_capture: Boolean(navigator.mediaDevices?.getDisplayMedia),
    fullscreen: fullscreenSupported(),
    visibility_api: typeof document.visibilityState === 'string',
    online: navigator.onLine,
    secure_context: window.isSecureContext,
    browser: describeBrowser(),
  }
}

/** Blocking failures - the candidate cannot proceed until these are resolved. */
export function capabilityBlockers(report: CapabilityReport): string[] {
  const blockers: string[] = []
  if (!report.secure_context)
    blockers.push('This page must be served over HTTPS to access your camera and screen.')
  if (!report.media_devices)
    blockers.push('This browser cannot access camera and microphone devices.')
  if (!report.screen_capture)
    blockers.push('This browser does not support screen sharing.')
  if (!report.fullscreen) blockers.push('This browser does not support fullscreen mode.')
  if (!report.visibility_api)
    blockers.push('This browser cannot report tab changes, so it is not supported.')
  if (!report.camera_present) blockers.push('No camera was found on this device.')
  if (!report.microphone_present) blockers.push('No microphone was found on this device.')
  if (!report.online) blockers.push('You appear to be offline.')
  return blockers
}

// ---------------------------------------------------------------------------
// Permissions and streams
// ---------------------------------------------------------------------------

export async function requestCameraAndMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: true,
  })
}

/**
 * Screen share. The candidate picks the source; the PRD requires the whole
 * screen, which the browser cannot force - `monitorTypeSurfaces` asks for it and
 * the returned track's displaySurface tells us what was actually chosen.
 */
export async function requestScreenShare(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor' } as MediaTrackConstraints,
    audio: false,
  })
}

export function screenSurfaceKind(stream: MediaStream | null): string | null {
  const track = stream?.getVideoTracks()[0]
  if (!track) return null
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string }
  return settings.displaySurface ?? null
}

export function streamIsLive(stream: MediaStream | null, kind: 'video' | 'audio'): boolean {
  const tracks = kind === 'video' ? stream?.getVideoTracks() : stream?.getAudioTracks()
  const track = tracks?.[0]
  return Boolean(track && track.readyState === 'live' && !track.muted)
}

export async function requestLocation(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { timeout: 8000 },
    )
  })
}

// ---------------------------------------------------------------------------
// Environment observations (out of the PRD registry - recorded, never shown)
// ---------------------------------------------------------------------------

const DEVTOOLS_GAP_PX = 170

export function looksLikeDevtoolsOpen(): boolean {
  return (
    window.outerWidth - window.innerWidth > DEVTOOLS_GAP_PX ||
    window.outerHeight - window.innerHeight > DEVTOOLS_GAP_PX
  )
}

export function hasMultipleDisplays(): boolean {
  return (screen as Screen & { isExtended?: boolean }).isExtended === true
}

export function looksAutomated(): boolean {
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true
}

const VIRTUAL_DEVICE_PATTERN =
  /obs|virtual|manycam|snap ?camera|droidcam|epoccam|xsplit|camtwist|iriun|screen ?capture|nvidia broadcast/i

/** Labels are only readable once camera permission has been granted. */
export async function detectVirtualCameras(): Promise<string[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'videoinput' && VIRTUAL_DEVICE_PATTERN.test(d.label))
      .map((d) => d.label)
  } catch {
    return []
  }
}

/** Grabs a still frame from a live camera stream, for the identity baseline. */
export async function captureFrame(stream: MediaStream): Promise<string | null> {
  const track = stream.getVideoTracks()[0]
  if (!track) return null

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  try {
    await video.play()
    // Give the pipeline a frame to settle before grabbing one.
    await new Promise((r) => setTimeout(r, 250))
    const width = video.videoWidth || 640
    const height = video.videoHeight || 480
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  } finally {
    video.pause()
    video.srcObject = null
  }
}
