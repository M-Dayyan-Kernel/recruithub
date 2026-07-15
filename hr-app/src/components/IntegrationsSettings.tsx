import { type FormEvent, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { TenantIntegrationsResponse, TenantIntegrationsUpdate } from '@/types/api'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
} from '@/lib/workflow'

type FieldKey = keyof TenantIntegrationsUpdate

const FIELD_LABELS: { key: FieldKey; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'openai_api_key', label: 'OpenAI API key', hint: 'Used for parsing, embeddings, shortlist, and interview scoring' },
  { key: 'vapi_api_key', label: 'Vapi API key', hint: 'Outbound screening calls' },
  { key: 'vapi_phone_number_id', label: 'Vapi phone number ID', hint: 'Caller ID / phone number resource in Vapi' },
  { key: 'livekit_url', label: 'LiveKit URL', hint: 'wss://… LiveKit project URL' },
  { key: 'livekit_api_key', label: 'LiveKit API key', hint: 'LiveKit project API key' },
  { key: 'livekit_api_secret', label: 'LiveKit API secret', hint: 'LiveKit project API secret' },
  {
    key: 'gmail_credentials_json',
    label: 'Gmail credentials.json',
    hint: 'Paste the full OAuth client JSON from Google Cloud',
    multiline: true,
  },
  {
    key: 'gmail_token_json',
    label: 'Gmail token.json',
    hint: 'Paste the authorized user token JSON (from gmail_auth script)',
    multiline: true,
  },
]

function sourceLabel(source: string | undefined, configured: boolean): string {
  if (!configured) return 'Not set'
  if (source === 'tenant') return 'Configured for this organization'
  if (source === 'platform') return 'Using platform default'
  return 'Configured'
}

export function IntegrationsSettings() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<TenantIntegrationsResponse>({
    queryKey: ['integrations'],
    queryFn: () =>
      api.get('/api/settings/integrations') as unknown as Promise<TenantIntegrationsResponse>,
  })

  const [draft, setDraft] = useState<Partial<Record<FieldKey, string>>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft({})
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: (payload: TenantIntegrationsUpdate) =>
      api.patch('/api/settings/integrations', payload) as unknown as Promise<TenantIntegrationsResponse>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Integrations saved')
      setDraft({})
      setDirty(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save integrations'),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const payload: TenantIntegrationsUpdate = {}
    for (const [key, value] of Object.entries(draft) as [FieldKey, string][]) {
      payload[key] = value
    }
    if (Object.keys(payload).length === 0) {
      toast.error('Change at least one field before saving')
      return
    }
    mutation.mutate(payload)
  }

  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
  }

  return (
    <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
      <div className="mb-4 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-slate-500" />
        <h3 className="font-semibold text-slate-800">Integrations</h3>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Each organization uses its own OpenAI, Vapi, LiveKit, and Gmail credentials. Leave a field
        blank when saving to clear it. Existing secrets are never shown in full — only a status hint.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {FIELD_LABELS.map(({ key, label, hint, multiline }) => {
          const status = data.fields[key]
          const configured = !!status?.configured
          return (
            <div key={key}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <label className="text-sm font-medium text-slate-700">{label}</label>
                <span
                  className={`text-[11px] ${
                    configured ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  {sourceLabel(status?.source, configured)}
                  {status?.hint ? ` · ${status.hint}` : ''}
                </span>
              </div>
              {multiline ? (
                <textarea
                  rows={4}
                  value={draft[key] ?? ''}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    setDirty(true)
                  }}
                  placeholder={configured ? '•••• leave blank to keep current ••••' : 'Paste JSON…'}
                  className={`${WORKFLOW_INPUT_CLASS} font-mono text-xs`}
                />
              ) : (
                <input
                  type="password"
                  autoComplete="off"
                  value={draft[key] ?? ''}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    setDirty(true)
                  }}
                  placeholder={configured ? '•••• leave blank to keep current ••••' : 'Enter value…'}
                  className={WORKFLOW_INPUT_CLASS}
                />
              )}
              <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
            </div>
          )
        })}

        <button
          type="submit"
          disabled={!dirty || mutation.isPending}
          className={`${WORKFLOW_PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            'Save integrations'
          )}
        </button>
      </form>
    </div>
  )
}
