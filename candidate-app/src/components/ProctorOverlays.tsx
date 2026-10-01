import { AlertTriangle, Camera, Loader2, Maximize2, Mic, MonitorUp } from 'lucide-react'
import type { RecoveryPrompt, SignalType } from '@/proctoring/types'

/**
 * The three things proctoring can put in front of a candidate.
 *
 * RecoveryPrompts  a recoverable technical issue, with the action that fixes it
 * WarningNotice    the enforcement policy's warning (see proctoring/policy.ts)
 * EndedNotice      shown while the interview is being closed after a repeat
 */

const RECOVERY_ICONS: Partial<Record<SignalType, typeof AlertTriangle>> = {
  SCREEN_SHARE_INTERRUPTED: MonitorUp,
  FULLSCREEN_EXITED: Maximize2,
  CAMERA_INTERRUPTED: Camera,
  MICROPHONE_INTERRUPTED: Mic,
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/40 p-6">
      <div className="w-full max-w-sm rounded-[14px] border border-line bg-panel p-6 shadow-xl">
        {children}
      </div>
    </div>
  )
}

export function RecoveryPrompts({
  prompts,
  onFullscreen,
  onScreenShare,
}: {
  prompts: RecoveryPrompt[]
  onFullscreen: () => void
  onScreenShare: () => void
}) {
  if (prompts.length === 0) return null
  const prompt = prompts[0]
  const Icon = RECOVERY_ICONS[prompt.signal_type] ?? AlertTriangle
  const action =
    prompt.signal_type === 'FULLSCREEN_EXITED'
      ? onFullscreen
      : prompt.signal_type === 'SCREEN_SHARE_INTERRUPTED'
        ? onScreenShare
        : null

  return (
    <Sheet>
      <Icon size={20} className="mb-4 text-accent" aria-hidden />
      <h2 className="mb-1.5 text-base font-medium text-ink">{prompt.title}</h2>
      <p className="mb-5 text-sm leading-relaxed text-ink-muted">{prompt.message}</p>

      {action ? (
        <button
          onClick={action}
          className="h-11 w-full cursor-pointer rounded-[9px] bg-accent text-[0.9rem] font-semibold text-accent-ink transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {prompt.action}
        </button>
      ) : (
        <p className="text-xs text-ink-muted">
          This clears on its own once the device reconnects.
        </p>
      )}

      {prompts.length > 1 && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
          {prompts.length - 1} other issue{prompts.length > 2 ? 's' : ''} still needs attention.
        </p>
      )}
    </Sheet>
  )
}

export function WarningNotice({
  message,
  remaining,
  onDismiss,
}: {
  message: string
  remaining: number
  onDismiss: () => void
}) {
  return (
    <Sheet>
      <AlertTriangle size={20} className="mb-4 text-amber-400" aria-hidden />
      <h2 className="mb-1.5 text-base font-medium text-ink">Warning</h2>
      <p className="mb-2 text-sm leading-relaxed text-ink">{message}</p>
      <p className="mb-5 text-sm leading-relaxed text-amber-300/90">
        {remaining > 0
          ? `You have ${remaining} warning left. Leaving the interview screen again will end your interview.`
          : 'Leaving the interview screen again will end your interview.'}
      </p>
      <button
        onClick={onDismiss}
        className="h-11 w-full cursor-pointer rounded-[9px] border border-line bg-panel text-[0.9rem] font-semibold text-ink transition-colors hover:bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        Continue interview
      </button>
    </Sheet>
  )
}

export function EndedNotice({ reason }: { reason: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-panel p-6">
      <div className="max-w-sm text-center">
        <h2 className="mb-2 text-lg font-medium text-ink">Interview ended</h2>
        <p className="mb-6 text-sm leading-relaxed text-ink-muted">{reason}</p>
        <p className="inline-flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Saving your session
        </p>
      </div>
    </div>
  )
}
