import { AlertCircle, Building2, Home, Laptop } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkMode } from '@/types/api'
import { RequiredMark } from '@/components/FieldError'
import { WORK_MODE_OPTIONS } from '@/lib/screeningQuestions'
import { WORK_LOCATION_MAX_LENGTH } from '@/lib/validation'

interface Props {
  mode: WorkMode | null
  location: string
  onModeChange: (mode: WorkMode) => void
  onLocationChange: (location: string) => void
  disabled?: boolean
  /** Shown under the mode choice once the user has tried to save without one. */
  modeError?: string | null
  locationError?: string | null
  /** From the API once loaded; the mirrored constant until then. */
  maxLocationChars?: number
  /** A note under the label, e.g. that the JD did not say. */
  hint?: ReactNode
}

const MODE_ICONS: Record<WorkMode, ReactNode> = {
  remote: <Home size={14} aria-hidden />,
  hybrid: <Laptop size={14} aria-hidden />,
  onsite: <Building2 size={14} aria-hidden />,
}

const locationClass =
  'w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-surface-2 disabled:text-ink-muted'

/**
 * How the job is worked: remote, hybrid or on-site, plus where for the last two. The screening
 * call's location question is built from this, so a job cannot be saved without a mode.
 */
export function WorkModeFields({
  mode,
  location,
  onModeChange,
  onLocationChange,
  disabled,
  modeError,
  locationError,
  maxLocationChars = WORK_LOCATION_MAX_LENGTH,
  hint,
}: Props) {
  const needsLocation = mode === 'hybrid' || mode === 'onsite'
  return (
    <div className="space-y-3">
      <div>
        <p id="work-mode-label" className="mb-1.5 text-sm font-medium text-ink">
          Work mode
          <RequiredMark />
        </p>
        {hint && <p className="mb-1.5 text-xs text-ink-muted">{hint}</p>}
        <div
          role="radiogroup"
          aria-labelledby="work-mode-label"
          aria-invalid={Boolean(modeError)}
          className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
        >
          {WORK_MODE_OPTIONS.map(({ value, label }) => {
            const selected = mode === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onModeChange(value)}
                className={`inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? 'bg-surface text-ink shadow-e2'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {MODE_ICONS[value]}
                {label}
              </button>
            )
          })}
        </div>
        {modeError && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-neg" role="alert">
            <AlertCircle size={11} aria-hidden />
            {modeError}
          </p>
        )}
      </div>

      {needsLocation && (
        <div>
          <label htmlFor="work-location" className="mb-1.5 block text-sm font-medium text-ink">
            Work location
            <RequiredMark />
          </label>
          <input
            id="work-location"
            type="text"
            value={location}
            onChange={(e) => onLocationChange(e.target.value)}
            disabled={disabled}
            maxLength={maxLocationChars}
            placeholder="e.g. Bengaluru"
            aria-invalid={Boolean(locationError)}
            className={`${locationClass} ${locationError ? 'border-neg' : ''}`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            The screening call asks candidates whether they are comfortable working from here.
          </p>
          {locationError && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-neg" role="alert">
              <AlertCircle size={11} aria-hidden />
              {locationError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
