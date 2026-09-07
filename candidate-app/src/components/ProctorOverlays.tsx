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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/92 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-6">
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
      <Icon size={20} className="mb-4 text-slate-400" aria-hidden />
      <h2 className="mb-1.5 text-base font-medium text-slate-100">{prompt.title}</h2>
      <p className="mb-5 text-sm leading-relaxed text-slate-400">{prompt.message}</p>

      {action ? (
        <button
          onClick={action}
          className="h-10 w-full cursor-pointer rounded-md bg-indigo-600 text-sm font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          {prompt.action}
        </button>
      ) : (
        <p className="text-xs text-slate-500">
          This clears on its own once the device reconnects.
        </p>
      )}

      {prompts.length > 1 && (
        <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
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
      <h2 className="mb-1.5 text-base font-medium text-slate-100">Warning</h2>
      <p className="mb-2 text-sm leading-relaxed text-slate-300">{message}</p>
      <p className="mb-5 text-sm leading-relaxed text-amber-300/90">
        {remaining > 0
          ? `You have ${remaining} warning left. Leaving the interview screen again will end your interview.`
          : 'Leaving the interview screen again will end your interview.'}
      </p>
      <button
        onClick={onDismiss}
        className="h-10 w-full cursor-pointer rounded-md bg-slate-800 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
      >
        Continue interview
      </button>
    </Sheet>
  )
}

export function EndedNotice({ reason }: { reason: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950 p-6">
      <div className="max-w-sm text-center">
        <h2 className="mb-2 text-lg font-medium text-slate-100">Interview ended</h2>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">{reason}</p>
        <p className="inline-flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Saving your session
        </p>
      </div>
    </div>
  )
}
