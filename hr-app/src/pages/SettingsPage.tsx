import { useEffect, useState } from 'react'
import { Clock, Phone, Settings } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { SystemSettings } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { WORKFLOW_CARD_CLASS, WORKFLOW_INPUT_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'
import { EmailTemplatesSettings } from '@/components/EmailTemplatesSettings'
import { IntegrationsSettings } from '@/components/IntegrationsSettings'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MINUTES = 30

function formatDelayLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`
  return `${Math.round(minutes / 1440)} day`
}

export default function SettingsPage() {
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
    return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  }

  if (isError || !data) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">System Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure organization rules, integrations, and email templates.
        </p>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Geography</h3>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          When enabled, only Indian mobile numbers (+91) can receive outbound screening calls.
          Other numbers are skipped at trigger time with a clear reason.
        </p>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enforceGeography}
            onChange={(e) => setEnforceGeography(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              Restrict outbound calls to India (+91)
            </span>
            <span className="block text-xs text-slate-500">
              Allowed regions: {data.allowed_phone_regions.join(', ') || 'None'}
            </span>
          </span>
        </label>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <Phone className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Voice screening</h3>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          When enabled, approved candidates go through AI voice screening before interviews.
          When disabled, approving on the shortlist sends the interview link immediately and
          moves the candidate to Scheduled interviews.
        </p>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={screeningEnabled}
            onChange={(e) => setScreeningEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              Enable voice screening
            </span>
            <span className="block text-xs text-slate-500">
              Turn off to skip screening and go straight to interviews on approve
            </span>
          </span>
        </label>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6 ${!screeningEnabled ? 'opacity-60' : ''}`}>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Screening Attempts</h3>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          {screeningEnabled
            ? 'When a candidate cannot be reached (no answer, voicemail, or hangs up early), the system automatically redials using the same delay between each attempt, up to the maximum below. After all attempts are used, the candidate is moved to Flagged.'
            : 'Retry settings apply only when voice screening is enabled.'}
        </p>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="max-retries" className="w-36 text-sm font-medium text-slate-700">
              Maximum attempts
            </label>
            <input
              id="max-retries"
              type="number"
              min={1}
              max={10}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              disabled={!screeningEnabled}
              className={`${WORKFLOW_INPUT_CLASS} w-28 disabled:cursor-not-allowed disabled:opacity-50`}
            />
            <span className="text-sm text-slate-500">
              {maxRetries === 1
                ? 'One dial attempt only (no automatic retries)'
                : `Up to ${maxRetries} dial attempts, then flagged`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="retry-delay" className="w-36 text-sm font-medium text-slate-700">
              Delay between attempts
            </label>
            <input
              id="retry-delay"
              type="number"
              min={1}
              max={10080}
              value={retryDelayMinutes}
              onChange={(e) => setRetryDelayMinutes(Number(e.target.value))}
              disabled={!screeningEnabled || maxRetries <= 1}
              className={`${WORKFLOW_INPUT_CLASS} w-28 disabled:cursor-not-allowed disabled:opacity-50`}
            />
            <span className="text-sm text-slate-500">
              minutes ({formatDelayLabel(retryDelayMinutes)})
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tip: use 1–2 minutes while testing, then restore 30 minutes for production.
        </p>
      </div>

      <IntegrationsSettings />

      <EmailTemplatesSettings />

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={WORKFLOW_PRIMARY_BUTTON_CLASS}
      >
        {mutation.isPending ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
