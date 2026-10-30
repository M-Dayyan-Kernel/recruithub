import { VoiceScreeningSwitch } from '@/components/screening/VoiceScreeningSwitch'
import { EXTENSION_MODES, ExtensionOrgOffHelp } from '@/components/job/extensionCheckCopy'
import type { ExtensionPolicyMode } from '@/types/integrity'

/**
 * The job-creation form's AI-extension check: what it is, the on/off switch, and the two modes.
 * `locked` is the organization's master switch being off: everything is greyed out and a "?"
 * explains why, because only an Admin can turn the check back on.
 */
export function ExtensionCheckFields({
  enabled,
  mode,
  onEnabledChange,
  onModeChange,
  disabled,
  locked,
}: {
  enabled: boolean
  mode: ExtensionPolicyMode
  onEnabledChange: (next: boolean) => void
  onModeChange: (next: ExtensionPolicyMode) => void
  disabled?: boolean
  locked: boolean
}) {
  const frozen = locked || !!disabled

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500">
        Before the interview starts, the candidate&rsquo;s browser is checked for AI-assistant
        extensions, such as answer generators and interview copilots. Choose how strict the check is
        for this job. You can change it later on the job page.
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <VoiceScreeningSwitch
          label="AI extension check"
          checked={enabled}
          disabled={frozen}
          onChange={onEnabledChange}
          className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
        />
        {locked && <ExtensionOrgOffHelp />}
      </div>

      {locked && (
        <p className="text-xs leading-relaxed text-slate-500" role="status">
          Turned off by your organization&rsquo;s Admin. The check will not run for this job until
          they turn it back on.
        </p>
      )}

      {enabled && (
        <fieldset disabled={frozen} className={frozen ? 'opacity-60' : undefined}>
          <legend className="mb-2 text-xs font-semibold text-slate-700">Mode</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {EXTENSION_MODES.map((m) => (
              <label
                key={m.id}
                className={`rounded-lg border p-3.5 transition-colors ${
                  mode === m.id
                    ? 'border-indigo-300 bg-indigo-50/60'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                } ${frozen ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <input
                    type="radio"
                    name="extension-check-mode"
                    checked={mode === m.id}
                    onChange={() => onModeChange(m.id)}
                  />
                  {m.title}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">
                  {m.summary}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
