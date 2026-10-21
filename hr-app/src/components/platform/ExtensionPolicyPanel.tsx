import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, ChevronDown, ExternalLink, Eye, Inbox, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react'
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
import {
  BTN_DANGER,
  BTN_GHOST,
  BTN_PRIMARY,
  Badge,
  Card,
  EmptyState,
  INPUT,
} from '@/components/ui/Surface'
import Modal from '@/components/ui/Modal'
import { FieldError, RequiredMark } from '@/components/FieldError'
import { BackendError } from '@/components/BackendError'

const POLICY_KEY = ['platform-extension-policy']
const BLOCKLIST_KEY = ['platform-extension-blocklist']
const OBSERVED_KEY = ['platform-observed-extensions']
const OBSERVED_PAGE_SIZE = 10

const CATEGORY_LABEL: Record<BlocklistCategory, string> = {
  ai_assistant: 'AI assistant',
  interview_assistant: 'Interview assistant',
}

const MODE_COPY: Record<ExtensionPolicyMode, { title: string; summary: string; body: string }> = {
  shadow: {
    title: 'Shadow',
    summary: 'Only extensions on the blocklist are blocked. Others are recorded for HR.',
    body: 'Extensions on the blocklist are blocked. Other suspicious extensions are only recorded for HR and never stop a candidate. Use this while you gather data.',
  },
  enforce: {
    title: 'Enforce',
    summary: 'The blocklist is blocked, and so are extensions that clearly look like AI assistants.',
    body: 'Extensions on the blocklist are blocked, and so are other extensions that clearly look like AI assistants that can read the page or capture audio.',
  },
}

type View = 'seen' | 'blocklist'

/** What the add dialog opens with: nothing for a blank form, or a seen extension's details. */
interface AddEntryInitial {
  extension_id?: string
  name?: string
  listing_url?: string | null
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** A count, in the product's figure style (UI.md rule 4). */
function Num({ children }: { children: number | string }) {
  return <span className="font-mono tabular-nums">{children}</span>
}

// ── Add dialog ───────────────────────────────────────────────────────────────

function AddEntryForm({
  initial,
  onDone,
  onCancel,
  onPendingChange,
}: {
  initial?: AddEntryInitial
  /** Called after the entry was added. */
  onDone: () => void
  onCancel: () => void
  onPendingChange: (pending: boolean) => void
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
      onDone()
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not add the extension')),
  })

  // The dialog blocks closing while the request runs.
  useEffect(() => {
    onPendingChange(add.isPending)
  }, [add.isPending, onPendingChange])

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
    <form onSubmit={onSubmit} noValidate>
      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="ext-id" className="mb-1.5 block text-xs font-medium text-ink-muted">
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
            className={`${INPUT} font-mono`}
          />
          <FieldError message={errors.id} />
        </div>
        <div>
          <label htmlFor="ext-name" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Name
            <RequiredMark />
          </label>
          <input
            id="ext-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            className={INPUT}
          />
          <FieldError message={errors.name} />
        </div>
        <div>
          <label htmlFor="ext-category" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Category
          </label>
          <select
            id="ext-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as BlocklistCategory)}
            className={INPUT}
          >
            {(Object.keys(CATEGORY_LABEL) as BlocklistCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ext-reason" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Reason shown to candidates
            <RequiredMark />
          </label>
          <input
            id="ext-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className={INPUT}
          />
          <FieldError message={errors.reason} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ext-url" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Chrome Web Store listing (optional)
          </label>
          <input
            id="ext-url"
            value={listingUrl}
            onChange={(e) => setListingUrl(e.target.value)}
            placeholder="https://chromewebstore.google.com/detail/…"
            className={INPUT}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
        <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={add.isPending}>
          Cancel
        </button>
        <button type="submit" className={BTN_PRIMARY} disabled={add.isPending}>
          {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add to blocklist
        </button>
      </div>
    </form>
  )
}

function AddEntryDialog({
  initial,
  onClose,
}: {
  initial: AddEntryInitial
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const fromSeen = Boolean(initial.extension_id)
  return (
    <Modal
      title="Add to the blocklist"
      description={
        fromSeen
          ? 'Seen on a candidate’s browser. Check the details, then add a reason candidates will see.'
          : 'Candidates with this extension enabled are stopped until they turn it off.'
      }
      onClose={onClose}
      busy={busy}
    >
      <AddEntryForm initial={initial} onDone={onClose} onCancel={onClose} onPendingChange={setBusy} />
    </Modal>
  )
}

// ── Views: Seen / Blocklist ──────────────────────────────────────────────────

/**
 * Two tab cards rather than a text switch: each says what its list holds, which is the
 * whole difference between them (waiting for a decision vs added and blocking), and a
 * bordered, filled card reads as something to click where a pill of words did not.
 */
function ViewTabs({
  view,
  onChange,
  seenCount,
  blocklistCount,
}: {
  view: View
  onChange: (next: View) => void
  seenCount: number | undefined
  blocklistCount: number
}) {
  const items: Array<{
    id: View
    label: string
    hint: string
    icon: ReactNode
    count: number | undefined
  }> = [
    {
      id: 'seen',
      label: 'Seen',
      hint: 'Flagged on candidates’ browsers, waiting for your decision',
      icon: <Eye className="h-4 w-4" />,
      count: seenCount,
    },
    {
      id: 'blocklist',
      label: 'Blocklist',
      hint: 'Added by you and blocked for every candidate',
      icon: <Ban className="h-4 w-4" />,
      count: blocklistCount,
    },
  ]
  return (
    <div role="tablist" aria-label="Extension lists" className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const on = item.id === view
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`ext-tab-${item.id}`}
            aria-selected={on}
            aria-controls="ext-view"
            onClick={() => onChange(item.id)}
            className={`flex flex-col gap-1.5 rounded-card border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              on
                ? 'border-accent bg-accent-soft shadow-e1'
                : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={`flex items-center gap-2 text-[14px] font-semibold ${on ? 'text-accent' : 'text-ink'}`}
              >
                {item.icon}
                {item.label}
              </span>
              {item.count !== undefined && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                    on ? 'bg-surface text-accent' : 'bg-surface-3 text-ink-muted'
                  }`}
                >
                  <Num>{item.count}</Num>
                </span>
              )}
            </span>
            <span className="hidden text-[12px] leading-relaxed text-ink-muted sm:block">{item.hint}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Blocklist: extensions that have been added ───────────────────────────────

function BlocklistView({
  entries,
  onAdd,
}: {
  entries: ExtensionBlocklistEntry[]
  onAdd: () => void
}) {
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

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="Nothing on the blocklist yet"
          body="Add the extensions you want blocked, or review the ones already seen on candidates’ browsers."
          action={
            <button type="button" className={BTN_GHOST} onClick={onAdd}>
              <Plus size={14} />
              Add extension
            </button>
          }
        />
      </Card>
    )
  }

  const active = entries.filter((e) => e.status === 'active').length

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3 text-[13px] text-ink-muted">
        Blocked for every candidate while on. Changes apply on the next check, with no release.{' '}
        <span className="text-ink-subtle">
          <Num>{active}</Num> blocking · <Num>{entries.length - active}</Num> off
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-subtle">
              <th className="px-5 py-2.5 font-semibold">Extension</th>
              <th className="py-2.5 pr-3 font-semibold">Category</th>
              <th className="py-2.5 pr-3 font-semibold">Status</th>
              <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-5 py-3.5">
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
                <td className="py-3.5 pr-3 text-ink-muted">{CATEGORY_LABEL[entry.category]}</td>
                <td className="py-3.5 pr-3">
                  <Badge tone={entry.status === 'active' ? 'pos' : 'neutral'}>
                    {entry.status === 'active' ? 'Blocking' : 'Off'}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-right">
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
    </Card>
  )
}

// ── Seen: flagged on candidates' browsers, awaiting a decision ───────────────

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

function SeenRow({
  ext,
  onAdd,
}: {
  ext: ObservedExtension
  onAdd: (initial: AddEntryInitial) => void
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
    <li className="px-5 py-4">
      {/* Stacked below sm: beside the text, the buttons squeeze it to a few characters wide. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
            Seen <Num>{ext.times_seen}</Num> {ext.times_seen === 1 ? 'time' : 'times'} · last seen{' '}
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

        {/* Ghost, not primary: a list of ten rows must not carry ten accent buttons. */}
        <div className="flex shrink-0 gap-2">
          {ext.status === 'new' ? (
            <>
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() =>
                  onAdd({
                    extension_id: ext.extension_id,
                    name: ext.name,
                    listing_url: ext.listing_url,
                  })
                }
              >
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
    </li>
  )
}

function SeenView({ onAdd }: { onAdd: (initial: AddEntryInitial) => void }) {
  const [status, setStatus] = useState<ObservedStatus>('new')
  const [page, setPage] = useState(0)
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
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Check the listing, then add the ones that are AI assistants; they move to the Blocklist.
          Nothing here is blocked automatically, and no candidate information is shown.
        </p>
        {/*
          Bordered chips with a check on the chosen one, so it reads as a control and the
          choice is not carried by colour alone. Neutral: the accent is spent on the active
          view and the primary action.
        */}
        <div role="group" aria-label="Show" className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-ink-subtle">Show</span>
          {(['new', 'dismissed'] as ObservedStatus[]).map((value) => {
            const on = status === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => choose(value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  on
                    ? 'border-ink/30 bg-surface-3 text-ink'
                    : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                {value === 'new' ? 'To review' : 'Dismissed'}
                {on && data ? (
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] leading-none">
                    <Num>{data.total}</Num>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {query.isLoading ? (
        <div className="m-5 h-24 animate-pulse rounded-card bg-surface-2" />
      ) : query.isError || !data ? (
        <p className="px-5 py-6 text-[13px] text-ink-muted">
          Could not load this list.{' '}
          <button type="button" className="text-accent underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title={status === 'new' ? 'Nothing waiting for review' : 'No dismissed extensions'}
          body={
            status === 'new'
              ? 'New extensions appear here as candidates are checked.'
              : 'Extensions you dismiss are kept here, and come back if they change.'
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {data.items.map((ext) => (
              <SeenRow key={ext.id} ext={ext} onAdd={onAdd} />
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px] text-ink-muted">
              <button
                type="button"
                className={BTN_GHOST}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page <Num>{page + 1}</Num> of <Num>{totalPages}</Num>
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
    </Card>
  )
}

// ── Detection mode: rarely changed, so it stays folded away ──────────────────

function DetectionSettings({ policy }: { policy: ExtensionPolicy }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
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
    <Card className="overflow-hidden">
      {/* The current mode stays readable while folded: it decides who gets blocked. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="detection-mode-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-ink-muted">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">Detection mode</span>
          <span className="block text-[12px] leading-relaxed text-ink-muted">
            {MODE_COPY[policy.mode].summary}
          </span>
        </span>
        {dirty && <span className="shrink-0 text-[12px] text-ink-muted">Unsaved change</span>}
        <Badge tone="neutral">{MODE_COPY[policy.mode].title}</Badge>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id="detection-mode-body" className="border-t border-line px-5 py-5">
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
            <span className="mr-auto text-[12px] text-ink-subtle">
              Version <Num>{policy.version}</Num> · takes effect on the next check
            </span>
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
        </div>
      )}
    </Card>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function ExtensionPolicyPanel() {
  const [params, setParams] = useSearchParams()
  // In the URL so a list can be linked to and survives a refresh.
  const view: View = params.get('view') === 'blocklist' ? 'blocklist' : 'seen'
  const setView = (next: View) => {
    const updated = new URLSearchParams(params)
    if (next === 'blocklist') updated.set('view', 'blocklist')
    else updated.delete('view')
    setParams(updated, { replace: true })
  }

  // null = closed, {} = a blank form, anything else = prefilled from a seen extension.
  const [adding, setAdding] = useState<AddEntryInitial | null>(null)

  const policy = useQuery<ExtensionPolicy>({
    queryKey: POLICY_KEY,
    queryFn: () => api.get('/api/platform/extension-policy') as unknown as Promise<ExtensionPolicy>,
  })
  const blocklist = useQuery<ExtensionBlocklistEntry[]>({
    queryKey: BLOCKLIST_KEY,
    queryFn: () =>
      api.get('/api/platform/extension-blocklist') as unknown as Promise<ExtensionBlocklistEntry[]>,
  })
  // Only the total is wanted, so the tab can show it from the other view too.
  const seenCount = useQuery<number>({
    queryKey: [...OBSERVED_KEY, 'new-count'],
    queryFn: async () => {
      const page = (await api.get(
        '/api/platform/observed-extensions?status=new&limit=1&offset=0',
      )) as unknown as ObservedExtensionPage
      return page.total
    },
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Candidates are checked for AI-assistant browser extensions before an interview starts.
        </p>
        <button type="button" className={BTN_PRIMARY} onClick={() => setAdding({})}>
          <Plus size={14} />
          Add extension
        </button>
      </div>

      <ViewTabs
        view={view}
        onChange={setView}
        seenCount={seenCount.data}
        blocklistCount={blocklist.data.length}
      />

      <div id="ext-view" role="tabpanel" aria-labelledby={`ext-tab-${view}`}>
        {view === 'seen' ? (
          <SeenView onAdd={setAdding} />
        ) : (
          <BlocklistView entries={blocklist.data} onAdd={() => setAdding({})} />
        )}
      </div>

      <DetectionSettings policy={policy.data} />

      <p className="px-1 text-[12px] leading-relaxed text-ink-subtle">
        Detection runs in the candidate&rsquo;s own browser, so a result is evidence for HR to weigh,
        not proof. It cannot see desktop applications, other browsers or profiles, or a second device.
      </p>

      {adding && <AddEntryDialog initial={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}
