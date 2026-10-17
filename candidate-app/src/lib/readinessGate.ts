import { isFullscreen } from '@/proctoring/browser'
import type { ProctorSession } from '@/proctoring/session'
import { scanForGate } from './extensionGate'
import type { ScanPhase } from './extensionCheck'
import { evaluateReadiness, type ReadinessReport } from './readiness'

/**
 * Collects the live resources and evaluates them. Shared by the final
 * "I'm ready" gate and the start-time check so the two cannot disagree.
 *
 * The scan comes first and the streams are read afterwards, so a track that
 * died while the scan was awaited is seen as dead.
 */
export async function collectReadiness(
  session: ProctorSession,
  phase: Extract<ScanPhase, 'final' | 'start'>,
): Promise<ReadinessReport> {
  const extension = await scanForGate({ token: session.token, phase })
  return evaluateReadiness({
    extension,
    camera: session.cameraStream,
    microphone: session.cameraStream,
    screen: session.screenStream,
    fullscreen: isFullscreen(),
  })
}
