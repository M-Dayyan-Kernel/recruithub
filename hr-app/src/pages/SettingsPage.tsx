import { useEffect, useState } from 'react'
import { Clock, Globe, Phone } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { SystemSettings } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { BTN_PRIMARY, Card, PageHeader } from '@/components/ui/Surface'
import Tabs, { type TabDef } from '@/components/interview/Tabs'
import Toggle from '@/components/ui/Toggle'
import { EmailTemplatesSettings } from '@/components/EmailTemplatesSettings'
import { clampWholeNumberInput } from '@/lib/validation'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MINUTES = 30

const TABS: TabDef[] = [
  { id: 'screening', label: 'Screening' },
  { id: 'email', label: 'Email templates' },
]

/** One settings group: icon chip, title, explanation, then the controls. */
function SettingSection({
  icon,
  title,
  description,
  muted,
  children,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  /** Dims a section whose controls do nothing in the current configuration. */
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className={`p-6 transition-opacity ${muted ? 'opacity-60' : ''}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {description && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
      </div>
      {children}
    </Card>
  )
}

function formatDelayLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`
  return `${Math.round(minutes / 1440)} day`
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'screening' | 'email'>('screening')
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const [enforceGeography, setEnforceGeography] = useState(true)
  const [screeningEnabled, setScreeningEnabled] = useState(true)
  const [maxRetries, setMaxRetries] = useState(DEFAULT_MAX_RETRIES)
  const [retryDelayMinutes, setRetryDelayMinutes] = useState(DEFAULT_RETRY_DELAY_MINUTES)

  useEffect(() => {
    if (!data) return
    setEnforceGeography(data.enforce_phone_geography)
    setScreeningEnabled(data.screening_enabled)
    setMaxRetries(data.screening_max_retries)
    setRetryDelayMinutes(Math.round(data.screening_retry_delay_seconds / 60))
  }, [data])

  const mutation = useMutation({
    mutationFn: () =>
      api.patch('/api/settings', {
        enforce_phone_geography: enforceGeography,
        screening_enabled: screeningEnabled,
        allowed_phone_regions: ['IN'],
        screening_max_retries: maxRetries,
        screening_retry_delay_seconds: Math.max(1, Math.round(retryDelayMinutes)) * 60,
      }) as unknown as Promise<SystemSettings>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Settings saved')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save settings'),
  })

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-card border border-line bg-surface-2" />
  }

  if (isError || !data) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Platform-wide rules for outbound screening calls and candidate email."
      />

      <div className="mb-6">
        <Tabs tabs={TABS} active={tab} onChange={(id) => setTab(id as typeof tab)} />
      </div>

      {tab === 'email' ? (
        <EmailTemplatesSettings />
      ) : (
      <div className="space-y-4">
      <SettingSection
        icon={<Globe className="h-[18px] w-[18px]" />}
        title="Geography"
        description="Only Indian mobile numbers (+91) can receive outbound screening calls. Other numbers are skipped at trigger time with a clear reason."
      >
        <Toggle
          checked={enforceGeography}
          onChange={setEnforceGeography}
          label="Restrict outbound calls to India (+91)"
          description={`Allowed regions: ${data.allowed_phone_regions.join(', ') || 'None'}`}
        />
      </SettingSection>

      <SettingSection
        icon={<Phone className="h-[18px] w-[18px]" />}
        title="Voice screening"
        description="The default for new jobs. Each job can override this from its overview, including when this tenant-wide setting is off."
      >
        <Toggle
          checked={screeningEnabled}
          onChange={setScreeningEnabled}
          label="Enable voice screening"
          description="Off sends the interview link immediately on approve, skipping the call."
        />
      </SettingSection>

      <SettingSection
        icon={<Clock className="h-[18px] w-[18px]" />}
        title="Screening attempts"
        muted={!screeningEnabled}
        description={''}
      >
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          {screeningEnabled
            ? 'When a candidate cannot be reached (no answer, voicemail, or hangs up early), the system automatically redials using the same delay between each attempt, up to the maximum below. After all attempts are used, the candidate is moved to Flagged.'
            : 'Retry settings apply only when voice screening is enabled.'}
        </p>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="max-retries" className="w-40 text-[13px] font-semibold text-ink">
              Maximum attempts
            </label>
            <input
              id="max-retries"
              type="number"
              min={1}
              max={10}
              value={maxRetries}
              onChange={(e) => {
                const next = clampWholeNumberInput(e.target.value, { min: 1, max: 10 })
                if (next !== null) setMaxRetries(next)
              }}
              disabled={!screeningEnabled}
              className={`${WORKFLOW_INPUT_CLASS} w-28 disabled:cursor-not-allowed disabled:opacity-50`}
            />
            <span className="text-[13px] text-ink-muted">
              {maxRetries === 1
                ? 'One dial attempt only (no automatic retries)'
                : `Up to ${maxRetries} dial attempts, then flagged`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="retry-delay" className="w-40 text-[13px] font-semibold text-ink">
              Delay between attempts
            </label>
            <input
              id="retry-delay"
              type="number"
              min={1}
              max={10080}
              value={retryDelayMinutes}
              onChange={(e) => {
                const next = clampWholeNumberInput(e.target.value, { min: 1, max: 10080 })
                if (next !== null) setRetryDelayMinutes(next)
              }}
              disabled={!screeningEnabled || maxRetries <= 1}
              className={`${WORKFLOW_INPUT_CLASS} w-28 disabled:cursor-not-allowed disabled:opacity-50`}
            />
            <span className="text-[13px] text-ink-muted">
              minutes ({formatDelayLabel(retryDelayMinutes)})
            </span>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-accent-soft px-3.5 py-2.5 text-[12px] text-accent">
          Tip: use 1–2 minutes while testing, then restore 30 minutes for production.
        </p>
      </SettingSection>

      {/* Sticky, because the settings above can run past the fold. */}
      <div className="sticky bottom-0 -mx-1 mt-6 flex items-center justify-end gap-3 rounded-card border border-line bg-surface/90 px-4 py-3 shadow-e2 backdrop-blur">
        <p className="mr-auto text-[12px] text-ink-muted">
          {mutation.isPending ? 'Saving your changes…' : 'Changes apply to every job in this workspace.'}
        </p>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={BTN_PRIMARY}
        >
          {mutation.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      </div>
      )}
    </div>
  )
}
