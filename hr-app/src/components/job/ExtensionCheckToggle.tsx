import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import type { ExtensionPolicyMode } from '@/types/integrity'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'

const MODES: Array<{ id: ExtensionPolicyMode; label: string; hint: string }> = [
  { id: 'shadow', label: 'Shadow', hint: 'Block listed extensions; only record look-alikes' },
  { id: 'enforce', label: 'Enforce', hint: 'Also block extensions that clearly look like AI assistants' },
]

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
 * (the organization's blocklist stays Admin-only). Each change is audited with who and the old
 * and new value; weakening asks for confirmation.
 */
export function ExtensionCheckToggle({ job }: { job: Job }) {
  const queryClient = useQueryClient()
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

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <VoiceScreeningSwitch
          label="Extension check"
          checked={enabled}
          disabled={save.isPending || pending !== null}
          onChange={(next) => request({ enabled: next })}
        />
        {enabled && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 sm:text-sm">
            <span className="sr-only">Extension check mode</span>
            <select
              aria-label="Extension check mode"
              value={mode}
              disabled={save.isPending || pending !== null}
              onChange={(e) => request({ mode: e.target.value as ExtensionPolicyMode })}
              title={MODES.find((m) => m.id === mode)?.hint}
              className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 sm:text-sm"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </span>

      {pending && (
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
      )}
    </>
  )
}
