import { useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { BackendError } from '@/components/BackendError'
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
} from '@/hooks/useApiKeys'
import {
  WORKFLOW_CARD_CLASS,
  WORKFLOW_INPUT_CLASS,
  WORKFLOW_PRIMARY_BUTTON_CLASS,
  WORKFLOW_TABLE_CLASS,
} from '@/lib/workflow'
import type { ApiKey, ApiKeyCreatedResponse } from '@/types/api'

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
  const [createOpen, setCreateOpen] = useState(false)
  const [rotateItem, setRotateItem] = useState<ApiKey | null>(null)

  function onRevoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}" (${key.key_prefix}…)? This cannot be undone.`)) return
    revokeMutation.mutate(key.id, {
      onSuccess: () => toast.success('App key revoked'),
      onError: (err: Error) => toast.error(err.message || 'Failed to revoke app key'),
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <ApiKeysTab
        keys={keys ?? null}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRevoke={onRevoke}
        onRotate={(key) => setRotateItem(key)}
        onCreate={() => setCreateOpen(true)}
      />

      <CreateKeyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => {}} />
      {rotateItem && <RotateModal keyItem={rotateItem} onClose={() => setRotateItem(null)} />}
    </div>
  )
}
