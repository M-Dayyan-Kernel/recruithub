import { useEffect, useRef, useState } from 'react'
import { Check, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import type { ExtensionPolicyMode } from '@/types/integrity'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'
import { OnDot, iconChipClass } from '@/components/ui/IconToggle'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import { useExtensionOrgEnabled } from '@/components/extensions/useExtensionOrgPolicy'
import { EXTENSION_MODES, ExtensionOrgOffHelp } from '@/components/job/extensionCheckCopy'

interface Change {
  enabled?: boolean
  mode?: ExtensionPolicyMode
}

/** Turning the check off, or enforce down to shadow, lets more through: ask first. */
function weakens(change: Change, current: { enabled: boolean; mode: ExtensionPolicyMode }): boolean {
  if (change.enabled === false && current.enabled) return true
  return change.mode === 'shadow' && current.mode === 'enforce' && current.enabled
}

/**
 * The job's AI-extension check: on or off, and which mode. Admins and HR can both change it
 * (the organization's blocklist stays Admin-only) while the organization's master switch is on.
 * When an Admin has turned that off, the controls are greyed out and a "?" explains why. Each
 * change is audited with who and the old and new value; weakening asks for confirmation.
 */
export function ExtensionCheckToggle({
  job,
  variant = 'switch',
}: {
  job: Job
  /** `icon` is the compact pair of chips for the job header; both go through the same confirmation. */
  variant?: 'switch' | 'icon'
}) {
  const queryClient = useQueryClient()
  const orgEnabled = useExtensionOrgEnabled()
  const enabled = job.extension_check_enabled !== false
  const mode: ExtensionPolicyMode = job.extension_check_mode === 'enforce' ? 'enforce' : 'shadow'
  const [pending, setPending] = useState<Change | null>(null)

  const save = useMutation({
    mutationFn: (change: Change) =>
      api.patch(`/api/jobs/${job.id}`, {
        ...(change.enabled !== undefined && { extension_check_enabled: change.enabled }),
        ...(change.mode !== undefined && { extension_check_mode: change.mode }),
      }) as unknown as Promise<Job>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', job.id] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setPending(null)
      toast.success('Extension check updated')
    },
    onError: (err) => {
      setPending(null)
      toast.error(err instanceof Error && err.message ? err.message : 'Could not update the extension check')
    },
  })

  const request = (change: Change) => {
    if (weakens(change, { enabled, mode })) setPending(change)
    else save.mutate(change)
  }

  const turningOff = pending?.enabled === false
  const locked = !orgEnabled

  const busy = locked || save.isPending || pending !== null

  const dialog = pending && (
    <ConfirmDialog
      open
      tone="warning"
      title={turningOff ? 'Turn off the extension check?' : 'Switch to Shadow mode?'}
      message={
        turningOff
          ? 'Candidates for this job will not be checked for AI-assistant extensions, and nothing will be recorded. The report will say the check was turned off.\nInterviews already started keep the setting they started with.'
          : 'Extensions on the blocklist are still blocked, but extensions that only look like AI assistants will be recorded for HR instead of blocked.'
      }
      confirmLabel={turningOff ? 'Turn off' : 'Switch to Shadow'}
      busy={save.isPending}
      onConfirm={() => save.mutate(pending)}
      onCancel={() => setPending(null)}
    />
  )

  if (variant === 'icon') {
    const level: Level = !enabled ? 'off' : mode
    const choose = (next: Level) => {
      if (next === level) return
      if (next === 'off') request({ enabled: false })
      else request(enabled ? { mode: next } : { enabled: true, mode: next })
    }
    return (
      <>
        <span className="inline-flex items-center gap-2">
          <LevelMenu level={level} disabled={busy} locked={locked} onChoose={choose} />
          {locked && <ExtensionOrgOffHelp />}
        </span>
        {dialog}
      </>
    )
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
          title={locked ? 'Turned off by your organization' : undefined}
        >
          <VoiceScreeningSwitch
            label="Extension check"
            checked={enabled}
            disabled={locked || save.isPending || pending !== null}
            onChange={(next) => request({ enabled: next })}
          />
          {enabled && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <span className="sr-only">Extension check mode</span>
              <select
                aria-label="Extension check mode"
                value={mode}
                disabled={locked || save.isPending || pending !== null}
                onChange={(e) => request({ mode: e.target.value as ExtensionPolicyMode })}
                title={EXTENSION_MODES.find((m) => m.id === mode)?.summary}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 sm:text-sm"
              >
                {EXTENSION_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </span>
        {locked && <ExtensionOrgOffHelp />}
      </span>

      {dialog}
    </>
  )
}

type Level = 'off' | ExtensionPolicyMode

const LEVELS: Array<{ id: Level; title: string; icon: typeof ShieldOff; summary: string }> = [
  { id: 'off', title: 'Off', icon: ShieldOff, summary: 'Candidates are not checked for AI-assistant browser extensions.' },
  ...EXTENSION_MODES.map((m) => ({
    id: m.id as Level,
    title: m.title,
    icon: m.id === 'enforce' ? ShieldAlert : ShieldCheck,
    summary: m.summary,
  })),
]

/**
 * One icon for the whole check, showing its level (off, shadow, enforce). Clicking opens the
 * three choices with what each does, so the mode is never a hidden second control that
 * appears and disappears, and its explanation is on screen, not behind a hover.
 */
function LevelMenu({
  level,
  disabled,
  locked,
  onChoose,
}: {
  level: Level
  disabled: boolean
  locked: boolean
  onChoose: (next: Level) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = LEVELS.find((l) => l.id === level) ?? LEVELS[0]
  const Icon = current.icon
  const on = level !== 'off'

  return (
    <span ref={root} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Extension check: ${current.title}`}
        title={locked ? 'Turned off by your organization' : `Extension check: ${current.title}. Click to change.`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={iconChipClass(on, disabled)}
      >
        <Icon size={16} aria-hidden />
        {on && <OnDot />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Extension check level"
          className="absolute right-0 top-full z-30 mt-2 w-80 space-y-2 rounded-xl border border-line bg-surface p-2 shadow-lg"
        >
          {LEVELS.map((l) => {
            const LevelIcon = l.icon
            const selected = l.id === level
            return (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setOpen(false)
                  onChoose(l.id)
                }}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  selected
                    ? 'border-accent-border bg-accent-soft'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <LevelIcon
                  size={16}
                  aria-hidden
                  className={cn('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-ink-muted')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{l.title}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">{l.summary}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface',
                  )}
                >
                  {selected && <Check size={10} strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
