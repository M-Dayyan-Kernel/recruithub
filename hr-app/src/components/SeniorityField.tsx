import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SeniorityLevel } from '@/types/api'
import { RequiredMark } from '@/components/FieldError'
import { SENIORITY_OPTIONS } from '@/lib/seniority'

interface Props {
  value: SeniorityLevel | null
  onChange: (level: SeniorityLevel) => void
  disabled?: boolean
  error?: string | null
  /** A note under the label, e.g. that the level was suggested from the JD. */
  hint?: ReactNode
}

/**
 * How senior the role is. It sets how hard the interview questions are, so a job cannot be saved
 * without one. The JD parser suggests a level; the recruiter confirms or changes it here.
 */
export function SeniorityField({ value, onChange, disabled, error, hint }: Props) {
  return (
    <div>
      <p id="seniority-label" className="mb-1.5 text-sm font-medium text-ink">
        Seniority level
        <RequiredMark />
      </p>
      {hint && <p className="mb-1.5 text-xs text-ink-muted">{hint}</p>}
      <div
        role="radiogroup"
        aria-labelledby="seniority-label"
        aria-invalid={Boolean(error)}
        className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
      >
        {SENIORITY_OPTIONS.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                selected ? 'bg-surface text-ink shadow-e2' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        Sets how hard the interview questions are for this role.
      </p>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-neg" role="alert">
          <AlertCircle size={11} aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}
