import { useEffect, useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { BackendError } from '@/components/BackendError'
import {
  useApiKeys,
  useConnectTalentos,
  useCreateApiKey,
  useDisconnectTalentos,
  useRevokeApiKey,
  useRotateApiKey,
  useTalentosConnectStatus,
  useTalentosConnection,
  useUpdateTalentosConnection,
} from '@/hooks/useApiKeys'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
  WORKFLOW_TABLE_CLASS,
} from '@/lib/workflow'
import type {
  ApiKey,
  ApiKeyCreatedResponse,
  ConnectionFieldResponse,
  TalentosConnectResponse,
} from '@/types/api'

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error('Could not copy — select it manually')
  }
}

function sourceLabel(source: ConnectionFieldResponse['source']): string {
  switch (source) {
    case 'tenant':
      return 'Tenant override'
    case 'platform':
      return 'Platform default'
    default:
      return 'Not configured'
  }
}

function sourceBadge(source: ConnectionFieldResponse['source']) {
  const cls =
    source === 'tenant'
      ? 'bg-indigo-500/15 text-indigo-700'
      : source === 'platform'
        ? 'bg-teal-500/15 text-teal-700'
        : 'bg-slate-200/60 text-slate-500'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {sourceLabel(source)}
    </span>
  )
}

function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (created: ApiKeyCreatedResponse) => void
}) {
  const createMutation = useCreateApiKey()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [revealed, setRevealed] = useState<ApiKeyCreatedResponse | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      setRevealed(null)
    }
  }, [open])

  if (!open) return null

  function onCreate(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate(
      { name: name.trim(), description: description.trim() || null },
      {
        onSuccess: (created) => {
          setRevealed(created)
          onCreated(created)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to create app key'),
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">Create app key</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              A key scoped to your organization for the talentOS integration
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {revealed ? (
          <div className="px-5 py-4">
            <p className="text-sm text-slate-600">
              Copy this key now — it is shown only once.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
              <code className="flex-1 break-all font-mono text-xs text-indigo-800">
                {revealed.full_key}
              </code>
              <button
                type="button"
                onClick={() => void copyText(revealed.full_key, 'App key copied')}
                className="shrink-0 rounded-md p-1.5 text-indigo-600 hover:bg-indigo-100"
                aria-label="Copy app key"
              >
                <Copy size={15} />
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onCreate}>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Name *</label>
                <input
                  className={WORKFLOW_INPUT_CLASS}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. talentOS integration"
                  required
                  maxLength={255}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Description (optional)
                </label>
                <input
                  className={WORKFLOW_INPUT_CLASS}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this key for?"
                  maxLength={255}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !name.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Create key
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function RotateModal({
  keyItem,
  onClose,
}: {
  keyItem: ApiKey
  onClose: () => void
}) {
  const rotateMutation = useRotateApiKey()
  const [revealed, setRevealed] = useState<ApiKeyCreatedResponse | null>(null)

  if (!keyItem) return null

  function onRotate() {
    rotateMutation.mutate(keyItem.id, {
      onSuccess: (created) => {
        toast.success('App key rotated')
        setRevealed(created)
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to rotate app key'),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800">Rotate app key</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {keyItem.name} — the old key stops working immediately
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {revealed ? (
          <div className="px-5 py-4">
            <p className="text-sm text-slate-600">
              Copy the new key now — it is shown only once.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
              <code className="flex-1 break-all font-mono text-xs text-indigo-800">
                {revealed.full_key}
              </code>
              <button
                type="button"
                onClick={() => void copyText(revealed.full_key, 'App key copied')}
                className="shrink-0 rounded-md p-1.5 text-indigo-600 hover:bg-indigo-100"
                aria-label="Copy app key"
              >
                <Copy size={15} />
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4">
            <p className="text-sm text-slate-600">
              Rotating generates a new secret. Any service using the current key must be updated to
              the new value.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRotate}
                disabled={rotateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {rotateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Rotate key
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectTalentosControl() {
  const { data: status, isLoading } = useTalentosConnectStatus()
  const connectReq = useConnectTalentos()
  const disconnectReq = useDisconnectTalentos()
  const [open, setOpen] = useState(true)

  const state = status?.state ?? 'none'
  const linked = state === 'linked'
  const connecting = ['keys_issued', 'provisioning', 'keys_exchanged', 'verifying'].includes(
    state,
  )
  const busy = connectReq.isPending || disconnectReq.isPending
  const hasFlow = !!status?.flow_id && state !== 'none'
  const switchOn = linked || connecting || connectReq.isPending
  const switchLocked = busy || (isLoading && !status)

  function onToggle() {
    if (busy || switchLocked) return
    if (linked) {
      disconnectReq.mutate(undefined, {
        onSuccess: () => {
          toast.success('Disconnected from talentOS')
          setOpen(true)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to disconnect'),
      })
    } else {
      connectReq.mutate(undefined, {
        onSuccess: () => {
          toast.success('Connecting to talentOS…')
          setOpen(true)
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to connect'),
      })
    }
  }

  const steps = buildConnectSteps(status, connectReq.isPending)
  const showTimeline = hasFlow || busy

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Plug size={15} className="shrink-0 text-slate-400" />
          <span className="text-sm font-medium text-slate-800">Connect to talentOS</span>
          {busy && <Loader2 size={14} className="animate-spin text-indigo-600" />}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {linked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-700">
              <CheckCircle2 size={12} />
              Linked
            </span>
          )}
          {connecting && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
              <Loader2 size={12} className="animate-spin" />
              Connecting
            </span>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={switchOn}
            aria-label="Toggle talentOS connection"
            onClick={onToggle}
            disabled={switchLocked}
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              switchOn ? 'bg-indigo-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                switchOn ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {showTimeline && (
        <div className="border-t border-slate-200">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <span>Handshake steps</span>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {open && (
            <ol className="space-y-0 px-4 pb-4 pt-1">
              {steps.map((step, i) => {
                const last = i === steps.length - 1
                return (
                  <li key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center self-stretch">
                      {step.status === 'done' ? (
                        <span className="flex h-6 items-center">
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                        </span>
                      ) : step.status === 'active' ? (
                        <span className="flex h-6 items-center">
                          <Loader2 size={16} className="shrink-0 animate-spin text-indigo-500" />
                        </span>
                      ) : (
                        <span className="flex h-6 items-center">
                          <Circle size={16} className="shrink-0 text-slate-300" />
                        </span>
                      )}
                      {!last && (
                        <span
                          className={`w-px flex-1 ${
                            step.status === 'done' ? 'bg-emerald-300' : 'bg-slate-200'
                          }`}
                        />
                      )}
                    </div>
                    <div className="min-w-0 pb-4">
                      <p
                        className={`text-sm font-medium ${
                          step.status === 'pending' ? 'text-slate-400' : 'text-slate-800'
                        }`}
                      >
                        {step.label}
                      </p>
                      {step.description && (
                        <p className="text-xs text-slate-400">{step.description}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

interface TimelineStep {
  key: string
  label: string
  description: string
  status: 'pending' | 'active' | 'done'
}

function buildConnectSteps(
  status: TalentosConnectResponse | undefined,
  connecting: boolean,
): TimelineStep[] {
  const state = status?.state ?? 'none'
  const linked = state === 'linked'
  const started = !!status?.flow_id && state !== 'none'
  const exchanged = ['keys_exchanged', 'verifying', 'linked'].includes(state)
  const pingA = status?.ping_a_verified ?? false
  const pingB = status?.ping_b_verified ?? false

  const pending = 'pending' as const
  const active = 'active' as const
  const done = 'done' as const

  return [
    {
      key: 'provision',
      label: 'Provision talentOS',
      description: 'Creates the talentOS workspace and link for this organization.',
      status: !started ? (connecting ? active : pending) : done,
    },
    {
      key: 'keys',
      label: 'Exchange keys',
      description: 'Issues the hub (rhub_) and talentOS (tal_) signing keys.',
      status: !started ? pending : exchanged ? done : pending,
    },
    {
      key: 'ping_a',
      label: 'Verify inbound ping',
      description: 'talentOS confirms it can reach you with the rhub_ key.',
      status: pingA ? done : !exchanged ? pending : linked ? active : active,
    },
    {
      key: 'ping_b',
      label: 'Verify outbound ping',
      description: 'You confirm talentOS is reachable with the tal_ key.',
      status: pingB ? done : !exchanged ? pending : linked ? active : active,
    },
    {
      key: 'linked',
      label: 'Connected',
      description: 'Fully linked — screening and interview results will sync.',
      status: linked ? done : pending,
    },
  ]
}

function ConnectionsCard() {
  const { data, isLoading, isError, refetch } = useTalentosConnection()
  const updateMutation = useUpdateTalentosConnection()
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [urlConfigured, setUrlConfigured] = useState(false)
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (!data?.fields) return
    const urlField = data.fields.talentos_be_url
    const keyField = data.fields.talentos_be_api_key
    setUrl(urlField?.configured ? (urlField.hint ?? '') : '')
    setApiKey(keyField?.configured ? (keyField.hint ?? '') : '')
    setUrlConfigured(urlField?.configured ?? false)
    setKeyConfigured(keyField?.configured ?? false)
  }, [data])

  function onSave(e: FormEvent) {
    e.preventDefault()
    updateMutation.mutate(
      {
        talentos_be_url: url.trim(),
        talentos_be_api_key: apiKey.trim(),
      },
      {
        onSuccess: () => toast.success('Connections saved'),
        onError: (err: Error) => toast.error(err.message || 'Failed to save connections'),
      },
    )
  }

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-200" />
  }
  if (isError || !data) {
    return <BackendError onRetry={() => void refetch()} />
  }

  return (
    <form onSubmit={onSave}>
      <div className="space-y-4">
        <ConnectTalentosControl />

        <div className="rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Advanced
            </span>
          </div>
          <div className="space-y-4 p-4">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-600">talentOS BE URL</label>
            {sourceBadge(data.fields.talentos_be_url?.source ?? 'missing')}
          </div>
          <input
            className={WORKFLOW_INPUT_CLASS}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://talentos.example.com"
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {urlConfigured && data.fields.talentos_be_url?.source === 'tenant'
              ? 'Tenant override — leave blank and save to revert to the platform default.'
              : 'Base URL of the talentOS backend this organization pushes results to.'}
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-600">talentOS BE API key</label>
            {sourceBadge(data.fields.talentos_be_api_key?.source ?? 'missing')}
          </div>
          <div className="flex items-center gap-2">
            <input
              className={WORKFLOW_INPUT_CLASS}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyConfigured ? '••••••••' : 'Paste the bearer API key'}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-50"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Stored encrypted. The talentOS integration uses this key when pushing results back.
          </p>
        </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Save connections
            </button>
          </div>
          </div>
        </div>
      </div>
    </form>
  )
}

function ApiKeysTab({
  keys,
  isLoading,
  isError,
  onRetry,
  onRevoke,
  onRotate,
  onCreate,
}: {
  keys: ApiKey[] | null
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onRevoke: (key: ApiKey) => void
  onRotate: (key: ApiKey) => void
  onCreate: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <KeyRound size={15} className="text-slate-400" />
            App Keys
          </h2>
          <p className="text-xs text-slate-500">
            Used by talentOS or external integrations to authenticate as your organization.
          </p>
        </div>
        <button type="button" onClick={onCreate} className={WORKFLOW_PRIMARY_BUTTON_CLASS}>
          <Plus size={15} />
          New app key
        </button>
      </div>

      <section className={WORKFLOW_CARD_CLASS}>
        {isLoading ? (
          <div className="h-48 animate-pulse bg-slate-100" />
        ) : isError || !keys ? (
          <BackendError onRetry={onRetry} />
        ) : keys.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            No app keys yet. Create one to let an external service authenticate as your organization.
          </div>
        ) : (
          <table className={WORKFLOW_TABLE_CLASS}>
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Name</th>
                <th className="px-5 py-2.5">Prefix</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Last used</th>
                <th className="px-5 py-2.5">Created</th>
                <th className="px-5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {keys.map((key) => (
                <tr key={key.id} className="text-sm">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{key.name}</p>
                    {key.description && (
                      <p className="text-xs text-slate-400">{key.description}</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                      {key.key_prefix}…
                    </code>
                  </td>
                  <td className="px-5 py-3">
                    {key.is_active ? (
                      <span className="inline-flex items-center rounded-full bg-teal-500/15 px-2.5 py-0.5 text-xs font-medium text-teal-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                        Revoked
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {formatDate(key.last_used_at)}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{formatDate(key.created_at)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      {key.is_active && (
                        <button
                          type="button"
                          onClick={() => onRotate(key)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          <RefreshCw size={13} />
                          Rotate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRevoke(key)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={13} />
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default function ApiKeysPage() {
  const { data: keys, isLoading, isError, refetch } = useApiKeys()
  const revokeMutation = useRevokeApiKey()
  const [activeTab, setActiveTab] = useState<'connection' | 'keys'>('connection')
  const [createOpen, setCreateOpen] = useState(false)
  const [rotateItem, setRotateItem] = useState<ApiKey | null>(null)

  function onRevoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}" (${key.key_prefix}…)? This cannot be undone.`)) return
    revokeMutation.mutate(key.id, {
      onSuccess: () => toast.success('App key revoked'),
      onError: (err: Error) => toast.error(err.message || 'Failed to revoke app key'),
    })
  }

  const tabs = [
    { id: 'connection', label: 'TalentOS Connection' },
    { id: 'keys', label: 'API Keys' },
  ] as const

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div
        role="tablist"
        aria-label="API Keys and Connections"
        className="flex gap-1 border-b border-slate-200"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`api-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`api-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                active
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id="api-panel-connection"
        aria-labelledby="api-tab-connection"
        hidden={activeTab !== 'connection'}
      >
        <ConnectionsCard />
      </div>

      <div
        role="tabpanel"
        id="api-panel-keys"
        aria-labelledby="api-tab-keys"
        hidden={activeTab !== 'keys'}
      >
        <ApiKeysTab
          keys={keys ?? null}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          onRevoke={onRevoke}
          onRotate={(key) => setRotateItem(key)}
          onCreate={() => setCreateOpen(true)}
        />
      </div>

      <CreateKeyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => {}} />
      {rotateItem && <RotateModal keyItem={rotateItem} onClose={() => setRotateItem(null)} />}
    </div>
  )
}
