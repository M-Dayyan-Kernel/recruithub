import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type {
  BlocklistCategory,
  ExtensionBlocklistCreate,
  ExtensionBlocklistEntry,
  ExtensionPolicy,
  ExtensionPolicyMode,
  ObservedExtension,
  ObservedExtensionPage,
  ObservedStatus,
} from '@/types/integrity'
import { validateExtensionId } from '@/lib/validation'
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, Badge, Card, SectionCard } from '@/components/ui/Surface'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { BackendError } from '@/components/BackendError'

const POLICY_KEY = ['platform-extension-policy']
const BLOCKLIST_KEY = ['platform-extension-blocklist']
const OBSERVED_KEY = ['platform-observed-extensions']
const OBSERVED_PAGE_SIZE = 10

const CATEGORY_LABEL: Record<BlocklistCategory, string> = {
  ai_assistant: 'AI assistant',
  interview_assistant: 'Interview assistant',
}

const MODE_COPY: Record<ExtensionPolicyMode, { title: string; body: string }> = {
  shadow: {
    title: 'Shadow',
    body: 'Extensions on the list below are blocked. Other suspicious extensions are only recorded for HR and never stop a candidate. Use this while you gather data.',
  },
  enforce: {
    title: 'Enforce',
    body: 'Extensions on the list below are blocked, and so are other extensions that clearly look like AI assistants that can read the page or capture audio.',
  },
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

// ── Policy: detection mode ───────────────────────────────────────────────────

function PolicyCard({ policy }: { policy: ExtensionPolicy }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ExtensionPolicyMode>(policy.mode)

  // A refreshed policy (after saving, or another admin's edit) replaces the draft.
  useEffect(() => {
    setMode(policy.mode)
  }, [policy])

  const save = useMutation({
    mutationFn: (body: { mode: ExtensionPolicyMode }) =>
      api.put('/api/platform/extension-policy', body) as unknown as Promise<ExtensionPolicy>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: POLICY_KEY })
      toast.success('Mode saved')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the mode')),
  })

  const dirty = mode !== policy.mode

  return (
    <SectionCard
      title="Detection mode"
      icon={<ShieldAlert className="h-4 w-4" />}
      action={<Badge tone="neutral">Version {policy.version}</Badge>}
    >
      <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
        Candidates are checked for AI-assistant browser extensions before an interview starts.
        Changes take effect on the next check, with no release.
      </p>

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink">Mode</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(MODE_COPY) as ExtensionPolicyMode[]).map((value) => (
            <label
              key={value}
              className={`cursor-pointer rounded-card border p-4 transition-colors ${
                mode === value ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2'
              }`}
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <input
                  type="radio"
                  name="policy-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {MODE_COPY[value].title}
              </span>
              <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-muted">
                {MODE_COPY[value].body}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex items-center justify-end gap-3">
        {dirty && <span className="mr-auto text-[12px] text-ink-muted">Unsaved change</span>}
        <button
          type="button"
          className={BTN_GHOST}
          disabled={!dirty || save.isPending}
          onClick={() => setMode(policy.mode)}
        >
          Discard
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ mode })}
        >
          {save.isPending && <Loader2 size={14} className="animate-spin" />}
          Save mode
        </button>
      </div>
    </SectionCard>
  )
}

// ── Blocklist ────────────────────────────────────────────────────────────────

interface AddEntryInitial {
  extension_id?: string
  name?: string
  listing_url?: string | null
}

function AddEntryForm({
  initial,
  title = 'Add an extension',
  onDone,
  onCancel,
}: {
  initial?: AddEntryInitial
  title?: string
  /** Called after the entry was added. */
  onDone?: () => void
  onCancel?: () => void
}) {
  const queryClient = useQueryClient()
  const [extensionId, setExtensionId] = useState(initial?.extension_id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<BlocklistCategory>('ai_assistant')
  const [reason, setReason] = useState('')
  const [listingUrl, setListingUrl] = useState(initial?.listing_url ?? '')
  const [errors, setErrors] = useState<{ id?: string; name?: string; reason?: string }>({})

  const add = useMutation({
    mutationFn: (body: ExtensionBlocklistCreate) =>
      api.post('/api/platform/extension-blocklist', body) as unknown as Promise<ExtensionBlocklistEntry>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BLOCKLIST_KEY })
      void queryClient.invalidateQueries({ queryKey: POLICY_KEY })
      // It is on the list now, so it leaves the "seen" list.
      void queryClient.invalidateQueries({ queryKey: OBSERVED_KEY })
      toast.success('Added to the blocklist')
      setExtensionId('')
      setName('')
      setReason('')
      setListingUrl('')
      setErrors({})
      onDone?.()
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the extension')),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next = {
      id: validateExtensionId(extensionId) ?? undefined,
      name: name.trim() ? undefined : 'Name is required',
      reason: reason.trim() ? undefined : 'Reason is required',
    }
    setErrors(next)
    if (next.id || next.name || next.reason) return
    add.mutate({
      extension_id: extensionId.trim().toLowerCase(),
      name: name.trim(),
      category,
      reason: reason.trim(),
      listing_url: listingUrl.trim() || null,
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-card border border-line bg-surface-2 p-4">
      <p className="mb-3 text-[13px] font-semibold text-ink">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="ext-id" className="mb-1 block text-xs font-medium text-ink-muted">
            Extension ID
            <RequiredMark />
          </label>
          <input
            id="ext-id"
            value={extensionId}
            onChange={(e) => setExtensionId(e.target.value)}
            placeholder="32 letters, from the Chrome Web Store URL"
            autoComplete="off"
            spellCheck={false}
            className={`${WORKFLOW_INPUT_CLASS} font-mono`}
          />
          <FieldError message={errors.id} />
        </div>
        <div>
          <label htmlFor="ext-name" className="mb-1 block text-xs font-medium text-ink-muted">
            Name
            <RequiredMark />
          </label>
          <input
            id="ext-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            className={WORKFLOW_INPUT_CLASS}
          />
          <FieldError message={errors.name} />
        </div>
        <div>
          <label htmlFor="ext-category" className="mb-1 block text-xs font-medium text-ink-muted">
            Category
          </label>
          <select
            id="ext-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as BlocklistCategory)}
            className={WORKFLOW_INPUT_CLASS}
          >
            {(Object.keys(CATEGORY_LABEL) as BlocklistCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ext-reason" className="mb-1 block text-xs font-medium text-ink-muted">
            Reason shown to candidates
            <RequiredMark />
          </label>
          <input
            id="ext-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className={WORKFLOW_INPUT_CLASS}
          />
          <FieldError message={errors.reason} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ext-url" className="mb-1 block text-xs font-medium text-ink-muted">
            Chrome Web Store listing (optional)
          </label>
          <input
            id="ext-url"
            value={listingUrl}
            onChange={(e) => setListingUrl(e.target.value)}
            placeholder="https://chromewebstore.google.com/detail/…"
            className={WORKFLOW_INPUT_CLASS}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={add.isPending}>
            Cancel
          </button>
        )}
        <button type="submit" className={BTN_PRIMARY} disabled={add.isPending}>
          {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add to blocklist
        </button>
      </div>
    </form>
  )
}

function BlocklistCard({ entries }: { entries: ExtensionBlocklistEntry[] }) {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: BLOCKLIST_KEY })
    void queryClient.invalidateQueries({ queryKey: POLICY_KEY })
  }

  const toggle = useMutation({
    mutationFn: (entry: ExtensionBlocklistEntry) =>
      api.patch(`/api/platform/extension-blocklist/${entry.id}`, {
        status: entry.status === 'active' ? 'inactive' : 'active',
      }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err, 'Could not update the entry')),
  })
  const remove = useMutation({
    mutationFn: (entry: ExtensionBlocklistEntry) =>
      api.delete(`/api/platform/extension-blocklist/${entry.id}`),
    onSuccess: () => {
      refresh()
      toast.success('Removed')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not remove the entry')),
  })

  return (
    <SectionCard title={`Known AI extensions (${entries.length})`}>
      <div className="mb-4">
        <AddEntryForm />
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-muted">
          The list is empty. Add the extensions you want blocked.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="py-2 pr-3 font-semibold">Extension</th>
                <th className="py-2 pr-3 font-semibold">Category</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line/60 align-top last:border-0">
                  <td className="py-3 pr-3">
                    <p className="font-medium text-ink">{entry.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-subtle">{entry.extension_id}</p>
                    <p className="mt-1 text-[12px] text-ink-muted">{entry.reason}</p>
                    {entry.listing_url && (
                      <a
                        href={entry.listing_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                      >
                        Listing <ExternalLink size={11} />
                      </a>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-ink-muted">{CATEGORY_LABEL[entry.category]}</td>
                  <td className="py-3 pr-3">
                    <Badge tone={entry.status === 'active' ? 'pos' : 'neutral'}>
                      {entry.status === 'active' ? 'Blocking' : 'Off'}
                    </Badge>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className={BTN_GHOST}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(entry)}
                      >
                        {entry.status === 'active' ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${entry.name}`}
                        className={BTN_DANGER}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${entry.name} from the blocklist?`)) {
                            remove.mutate(entry)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ── Seen extensions: flagged on candidates' browsers, awaiting a decision ────

const REOPEN_LABEL: Record<string, string> = {
  content_changed: 'Changed since you dismissed it',
  stronger_match: 'Now a stronger match',
}

const REASON_LABEL: Record<string, string> = {
  heuristic_strong: 'Strong match',
  heuristic_weak: 'Weak match',
}

function formatSeen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ObservedRow({
  ext,
  onAdd,
  adding,
  onCancelAdd,
}: {
  ext: ObservedExtension
  onAdd: () => void
  adding: boolean
  onCancelAdd: () => void
}) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (action: 'dismiss' | 'restore') =>
      api.post(`/api/platform/observed-extensions/${ext.id}/${action}`, {}),
    onSuccess: (_data, action) => {
      void queryClient.invalidateQueries({ queryKey: OBSERVED_KEY })
      toast.success(action === 'dismiss' ? 'Dismissed' : 'Restored')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update the extension')),
  })

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold text-ink">{ext.name}</p>
            <Badge tone={ext.strongest_reason === 'heuristic_strong' ? 'warn' : 'neutral'}>
              {REASON_LABEL[ext.strongest_reason] ?? ext.strongest_reason}
            </Badge>
            {ext.reopened_reason && (
              <Badge tone="accent">{REOPEN_LABEL[ext.reopened_reason] ?? 'Reopened'}</Badge>
            )}
          </div>
          <p className="mt-0.5 break-all font-mono text-[11px] text-ink-subtle">{ext.extension_id}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            {ext.description || 'No description reported.'}
          </p>
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            Seen {ext.times_seen} {ext.times_seen === 1 ? 'time' : 'times'} · last seen{' '}
            {formatSeen(ext.last_seen_at)}
            {ext.listing_url && (
              <>
                {' · '}
                <a
                  href={ext.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Web Store listing <ExternalLink size={11} />
                </a>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {ext.status === 'new' ? (
            <>
              <button type="button" className={BTN_PRIMARY} onClick={onAdd} disabled={adding}>
                <Plus size={14} />
                Add to blocklist
              </button>
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => change.mutate('dismiss')}
                disabled={change.isPending}
              >
                Dismiss
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => change.mutate('restore')}
              disabled={change.isPending}
            >
              Restore
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="mt-4">
          <AddEntryForm
            title="Add to the blocklist"
            initial={{
              extension_id: ext.extension_id,
              name: ext.name,
              listing_url: ext.listing_url,
            }}
            onDone={onCancelAdd}
            onCancel={onCancelAdd}
          />
        </div>
      )}
    </li>
  )
}

function ObservedExtensionsCard() {
  const [status, setStatus] = useState<ObservedStatus>('new')
  const [page, setPage] = useState(0)
  const [addingId, setAddingId] = useState<string | null>(null)
  const offset = page * OBSERVED_PAGE_SIZE

  const query = useQuery<ObservedExtensionPage>({
    queryKey: [...OBSERVED_KEY, status, page],
    queryFn: () =>
      api.get(
        `/api/platform/observed-extensions?status=${status}&limit=${OBSERVED_PAGE_SIZE}&offset=${offset}`,
      ) as unknown as Promise<ObservedExtensionPage>,
    placeholderData: (previous) => previous,
  })

  const data = query.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / OBSERVED_PAGE_SIZE)) : 1

  // Acting on the last row of a page can leave the page empty; step back.
  useEffect(() => {
    if (data && data.items.length === 0 && page > 0) setPage(page - 1)
  }, [data, page])

  const choose = (next: ObservedStatus) => {
    setStatus(next)
    setPage(0)
    setAddingId(null)
  }

  return (
    <SectionCard title="Seen extensions">
      <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
        Extensions flagged on candidates&rsquo; browsers that are not on your blocklist yet. Check the
        Web Store listing, then add the ones that are AI assistants. Nothing here is blocked
        automatically, and no candidate information is shown.
      </p>

      <div className="mb-4 inline-flex rounded-md border border-line p-0.5" role="tablist">
        {(['new', 'dismissed'] as ObservedStatus[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => choose(value)}
            className={`rounded px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              status === value ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {value === 'new' ? 'New' : 'Dismissed'}
            {status === value && data ? ` (${data.total})` : ''}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="h-24 animate-pulse rounded-card bg-surface-2" />
      ) : query.isError || !data ? (
        <p className="py-4 text-[13px] text-ink-muted">
          Could not load this list.{' '}
          <button type="button" className="text-accent underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : data.items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-muted">
          {status === 'new'
            ? 'Nothing waiting for review. New extensions appear here as candidates are checked.'
            : 'No dismissed extensions.'}
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((ext) => (
              <ObservedRow
                key={ext.id}
                ext={ext}
                adding={addingId === ext.id}
                onAdd={() => setAddingId(ext.id)}
                onCancelAdd={() => setAddingId(null)}
              />
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-[12px] text-ink-muted">
              <button
                type="button"
                className={BTN_GHOST}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className={BTN_GHOST}
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function ExtensionPolicyPanel() {
  const policy = useQuery<ExtensionPolicy>({
    queryKey: POLICY_KEY,
    queryFn: () => api.get('/api/platform/extension-policy') as unknown as Promise<ExtensionPolicy>,
  })
  const blocklist = useQuery<ExtensionBlocklistEntry[]>({
    queryKey: BLOCKLIST_KEY,
    queryFn: () =>
      api.get('/api/platform/extension-blocklist') as unknown as Promise<ExtensionBlocklistEntry[]>,
  })

  if (policy.isLoading || blocklist.isLoading) {
    return <div className="h-64 animate-pulse rounded-card border border-line bg-surface-2" />
  }
  if (policy.isError || blocklist.isError || !policy.data || !blocklist.data) {
    return (
      <BackendError
        onRetry={() => {
          void policy.refetch()
          void blocklist.refetch()
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PolicyCard policy={policy.data} />
      <ObservedExtensionsCard />
      <BlocklistCard entries={blocklist.data} />
      <Card className="p-4">
        <p className="text-[12px] leading-relaxed text-ink-muted">
          Detection runs in the candidate&rsquo;s own browser, so a result is evidence for HR to weigh,
          not proof. It cannot see desktop applications, other browsers or profiles, or a second device.
        </p>
      </Card>
    </div>
  )
}
