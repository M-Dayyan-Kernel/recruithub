import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Check,
  Download,
  FileText,
  LogIn,
  Mail,
  Plus,
  Power,
  Search,
  Users,
  LayoutGrid,
  Rows3,
  Briefcase,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { api, getStoredToken } from '@/lib/api'
import type { TenantCreateRequest, TenantListItem, TenantUpdateRequest } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { CharCount, FieldError, RequiredMark } from '@/components/FieldError'
import { PasswordInput } from '@/components/PasswordInput'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAuth } from '@/context/AuthContext'
import { BTN_PRIMARY, PageHeader } from '@/components/ui/Surface'
import OrgArt, { paletteFor } from '@/components/ui/OrgArt'
import {
  ORG_NAME_MAX_LENGTH,
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  isValid,
  validateEmail,
  validateName,
  validateOrgName,
  validatePassword,
} from '@/lib/validation'

interface CreateFormErrors {
  name?: string | null
  adminName?: string | null
  adminEmail?: string | null
  adminPassword?: string | null
}

/** Slug of the built-in organization the backend refuses to deactivate. */
const DEFAULT_TENANT_SLUG = 'default'

/** Row action awaiting confirmation in the dialog. */
type PendingConfirm = {
  tenant: TenantListItem
  action: 'activate' | 'deactivate' | 'reject' | 'delete'
}

/** The default organization must stay reachable, so it can never be switched off. */
function isProtectedFromDeactivation(tenant: TenantListItem): boolean {
  return tenant.is_active && tenant.slug === DEFAULT_TENANT_SLUG
}

/** Input styling for the create-organization form, reddened when invalid. */
/** "Label above value" column, the shape the reference card uses. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-ink-subtle">{label}</p>
      <div className="mt-0.5 truncate text-[13px] font-semibold text-ink">{children}</div>
    </div>
  )
}

/** Short, unambiguous date. `created_at` is ISO from the API. */
function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function fieldClass(hasError?: string | null): string {
  const base =
    'w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2'
  return hasError
    ? `${base} border-red-500/70 focus:border-red-500 focus:ring-red-500`
    : `${base} border-line focus:border-accent focus:ring-accent-soft`
}

/**
 * `className` is the filled pill for the list row; `textClass` is the ink only,
 * for the pill that sits on the illustrated header and supplies its own
 * translucent white ground.
 */
function verificationBadge(status: TenantListItem['verification_status'], isActive: boolean) {
  if (status === 'pending') {
    return {
      label: 'Pending verification',
      className: 'bg-warn-soft text-warn',
      textClass: 'text-warn',
    }
  }
  if (status === 'rejected') {
    return {
      label: 'Rejected',
      className: 'bg-neg-soft text-neg',
      textClass: 'text-neg',
    }
  }
  return {
    label: isActive ? 'Active' : 'Inactive',
    className: isActive ? 'bg-pos-soft text-pos' : 'bg-surface-3 text-ink-muted',
    textClass: isActive ? 'text-pos' : 'text-ink-muted',
  }
}

interface GstViewerState {
  tenantId: string
  filename: string
  url: string | null
  loading: boolean
  error: string | null
}

async function fetchGstDocumentBlob(tenantId: string): Promise<Blob> {
  const token = getStoredToken()
  const base = api.defaults.baseURL ?? 'http://localhost:8000'
  const response = await axios.get(
    `${base}/api/platform/tenants/${tenantId}/gst-document`,
    {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )
  return response.data as Blob
}

function GstDocumentViewer({
  viewer,
  onClose,
}: {
  viewer: GstViewerState
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function downloadCurrent() {
    if (!viewer.url) return
    const a = document.createElement('a')
    a.href = viewer.url
    a.download = viewer.filename || 'gst-document.pdf'
    a.click()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="GST document viewer"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {viewer.filename || 'GST document'}
            </p>
            <p className="text-xs text-ink-muted">In-app preview</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {viewer.url && (
              <button
                type="button"
                onClick={downloadCurrent}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Close document viewer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-surface-2">
          {viewer.loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
              Loading document…
            </div>
          )}
          {viewer.error && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neg">
              {viewer.error}
            </div>
          )}
          {viewer.url && !viewer.loading && !viewer.error && (
            <iframe
              title={viewer.filename || 'GST document'}
              src={viewer.url}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function OrganizationsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { switchTenant, isSuperAdmin } = useAuth()

  const { data, isLoading, isError, refetch } = useQuery<TenantListItem[]>({
    queryKey: ['platform-tenants'],
    queryFn: () => api.get('/api/platform/tenants') as unknown as Promise<TenantListItem[]>,
    enabled: isSuperAdmin,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [createErrors, setCreateErrors] = useState<CreateFormErrors>({})
  const [gstViewer, setGstViewer] = useState<GstViewerState | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    return () => {
      if (gstViewer?.url) URL.revokeObjectURL(gstViewer.url)
    }
  }, [gstViewer?.url])

  async function openGstDocument(tenantId: string, filename?: string | null) {
    if (gstViewer?.url) URL.revokeObjectURL(gstViewer.url)
    setGstViewer({
      tenantId,
      filename: filename || 'gst-document.pdf',
      url: null,
      loading: true,
      error: null,
    })
    try {
      const blob = await fetchGstDocumentBlob(tenantId)
      const pdfBlob =
        blob.type === 'application/pdf'
          ? blob
          : new Blob([blob], { type: 'application/pdf' })
      const url = URL.createObjectURL(pdfBlob)
      setGstViewer({
        tenantId,
        filename: filename || 'gst-document.pdf',
        url,
        loading: false,
        error: null,
      })
    } catch (err) {
      setGstViewer({
        tenantId,
        filename: filename || 'gst-document.pdf',
        url: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not open GST document',
      })
    }
  }

  function closeGstViewer() {
    if (gstViewer?.url) URL.revokeObjectURL(gstViewer.url)
    setGstViewer(null)
  }

  const createMutation = useMutation({
    mutationFn: (payload: TenantCreateRequest) =>
      api.post('/api/platform/tenants', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast.success('Organization created')
      setName('')
      setAdminEmail('')
      setAdminName('')
      setAdminPassword('')
      setCreateErrors({})
      setShowCreate(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create organization'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TenantUpdateRequest }) =>
      api.patch(`/api/platform/tenants/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast.success('Organization updated')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update organization'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/platform/tenants/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast.success('Organization approved')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve'),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/platform/tenants/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast.success('Organization rejected')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to reject'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/platform/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast.success('Organization deleted')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete organization'),
  })

  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('admin:orgs-view') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'inactive'>(
    'all',
  )

  useEffect(() => {
    try {
      localStorage.setItem('admin:orgs-view', view)
    } catch {
      /* private mode */
    }
  }, [view])

  const filtered = useMemo(() => {
    let list = data ?? []

    if (statusFilter === 'pending') {
      list = list.filter((t) => t.verification_status === 'pending')
    } else if (statusFilter === 'approved') {
      list = list.filter((t) => t.verification_status === 'approved' && t.is_active)
    } else if (statusFilter === 'inactive') {
      list = list.filter((t) => !t.is_active)
    }

    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.company_registration_number || '').toLowerCase().includes(q) ||
        (t.admin_email || '').toLowerCase().includes(q) ||
        (t.admin_full_name || '').toLowerCase().includes(q),
    )
  }, [data, search, statusFilter])

  const stats = useMemo(() => {
    const list = data ?? []
    return {
      total: list.length,
      pending: list.filter((t) => t.verification_status === 'pending').length,
      active: list.filter((t) => t.is_active && t.verification_status === 'approved').length,
      users: list.reduce((n, t) => n + t.user_count, 0),
    }
  }, [data])

  async function onEnter(tenant: TenantListItem) {
    if (tenant.verification_status !== 'approved') {
      toast.error('Approve the organization before entering')
      return
    }
    if (!tenant.is_active) {
      toast.error('Organization is inactive')
      return
    }
    try {
      await switchTenant(tenant.id)
      toast.success(`Entered ${tenant.name}`)
      navigate('/jobs')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch organization')
    }
  }

  /** Copy + styling for the dialog backing each confirmable row action. */
  function confirmProps(request: PendingConfirm) {
    const { tenant, action } = request
    if (action === 'deactivate') {
      return {
        tone: 'warning' as const,
        title: `Deactivate "${tenant.name}"?`,
        message: `Everyone in this organization is signed out immediately and cannot sign back in until it is reactivated.\nIts jobs, candidates, and settings are kept and come back on reactivation.`,
        confirmLabel: 'Deactivate',
        busy: updateMutation.isPending,
      }
    }
    if (action === 'activate') {
      return {
        tone: 'default' as const,
        title: `Activate "${tenant.name}"?`,
        message: `${tenant.user_count} user(s) in this organization will be able to sign in and use the platform again.`,
        confirmLabel: 'Activate',
        busy: updateMutation.isPending,
      }
    }
    if (action === 'reject') {
      return {
        tone: 'danger' as const,
        title: `Reject "${tenant.name}"?`,
        message: 'The organization is marked rejected and deactivated. Its admin will not be able to sign in.',
        confirmLabel: 'Reject',
        busy: rejectMutation.isPending,
      }
    }
    return {
      tone: 'danger' as const,
      title: `Delete "${tenant.name}" permanently?`,
      message: `This removes all users, jobs, candidates, and settings for this organization.\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      busy: deleteMutation.isPending,
    }
  }

  function runConfirmedAction() {
    if (!pendingConfirm) return
    const { tenant, action } = pendingConfirm
    // Dismiss on settle rather than on click, so the dialog shows its busy
    // state and errors surface (as a toast) before it disappears.
    const close = { onSettled: () => setPendingConfirm(null) }
    switch (action) {
      case 'deactivate':
        updateMutation.mutate({ id: tenant.id, body: { is_active: false } }, close)
        break
      case 'activate':
        updateMutation.mutate({ id: tenant.id, body: { is_active: true } }, close)
        break
      case 'reject':
        rejectMutation.mutate(tenant.id, close)
        break
      case 'delete':
        deleteMutation.mutate(tenant.id, close)
        break
    }
  }

  function onToggleActive(tenant: TenantListItem) {
    if (isProtectedFromDeactivation(tenant)) return
    setPendingConfirm({
      tenant,
      action: tenant.is_active ? 'deactivate' : 'activate',
    })
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()

    const errors: CreateFormErrors = {
      name: validateOrgName(name),
      adminName: validateName(adminName, 'Admin name'),
      adminEmail: validateEmail(adminEmail, 'Admin email'),
      adminPassword: validatePassword(adminPassword, 'Admin password'),
    }
    setCreateErrors(errors)
    if (!isValid(errors)) return

    createMutation.mutate({
      name: name.trim(),
      admin_email: adminEmail.trim(),
      admin_full_name: adminName.trim(),
      admin_password: adminPassword,
    })
  }

  /** Clear a field's error as soon as the user edits it. */
  function clearCreateError(field: keyof CreateFormErrors) {
    setCreateErrors((prev) => (prev[field] ? { ...prev, [field]: null } : prev))
  }

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-card border border-line bg-surface-2" />
  }

  if (isError || !data) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Organizations"
        subtitle="Review GST documents, approve new signups, and manage tenant organizations."
        actions={
          <button type="button" onClick={() => setShowCreate((v) => !v)} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            {showCreate ? 'Close' : 'New organization'}
          </button>
        }
      />

      {showCreate && (
        <form
          noValidate
          onSubmit={onCreate}
          className="rounded-card border border-line bg-surface p-6 shadow-e2"
        >
          <h2 className="mb-4 text-sm font-semibold text-ink">Create organization</h2>
          <p className="mb-4 text-xs text-ink-muted">
            Orgs you create here are approved and active immediately (no GST review).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label className="block text-xs font-medium text-ink-muted">
                  Organization name
                  <RequiredMark />
                </label>
                <CharCount value={name} max={ORG_NAME_MAX_LENGTH} />
              </div>
              <input
                required
                maxLength={ORG_NAME_MAX_LENGTH}
                aria-invalid={Boolean(createErrors.name)}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  clearCreateError('name')
                }}
                className={fieldClass(createErrors.name)}
                placeholder="Acme Corp"
              />
              <FieldError message={createErrors.name} />
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label className="block text-xs font-medium text-ink-muted">
                  Admin name
                  <RequiredMark />
                </label>
                <CharCount value={adminName} max={PERSON_NAME_MAX_LENGTH} />
              </div>
              <input
                required
                maxLength={PERSON_NAME_MAX_LENGTH}
                aria-invalid={Boolean(createErrors.adminName)}
                value={adminName}
                onChange={(e) => {
                  setAdminName(e.target.value)
                  clearCreateError('adminName')
                }}
                className={fieldClass(createErrors.adminName)}
                placeholder="Jane Doe"
              />
              <FieldError message={createErrors.adminName} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-muted">
                Admin email
                <RequiredMark />
              </label>
              <input
                type="email"
                required
                maxLength={254}
                aria-invalid={Boolean(createErrors.adminEmail)}
                value={adminEmail}
                onChange={(e) => {
                  setAdminEmail(e.target.value)
                  clearCreateError('adminEmail')
                }}
                onBlur={() =>
                  setCreateErrors((prev) => ({
                    ...prev,
                    adminEmail: adminEmail ? validateEmail(adminEmail, 'Admin email') : null,
                  }))
                }
                className={fieldClass(createErrors.adminEmail)}
                placeholder="admin@acme.com"
              />
              <FieldError message={createErrors.adminEmail} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-ink-muted">
                Admin password
                <RequiredMark />
              </label>
              <PasswordInput
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                aria-invalid={Boolean(createErrors.adminPassword)}
                value={adminPassword}
                onChange={(e) => {
                  setAdminPassword(e.target.value)
                  clearCreateError('adminPassword')
                }}
                className={fieldClass(createErrors.adminPassword)}
                toggleClassName="hover:text-ink"
              />
              {createErrors.adminPassword ? (
                <FieldError message={createErrors.adminPassword} />
              ) : (
                <p className="mt-1.5 text-xs text-ink-muted">{PASSWORD_HINT}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      )}

      {/* Toolbar: filter, search, and how to render the results. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'all', label: 'All', count: stats.total },
            { id: 'pending', label: 'Pending', count: stats.pending },
            { id: 'approved', label: 'Active', count: stats.active },
            { id: 'inactive', label: 'Inactive', count: stats.total - stats.active },
          ] as const).map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                statusFilter === id
                  ? 'border-accent bg-accent text-accent-ink shadow-accent'
                  : 'border-line bg-surface text-ink-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent'
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 font-mono text-[11px] tabular-nums ${
                  statusFilter === id ? 'bg-black/15' : 'bg-surface-3 text-ink-subtle'
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Read-only, so it is visually distinct from the filters beside it. */}
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-muted shadow-e1">
          <Users className="h-3.5 w-3.5" />
          <span className="font-mono font-semibold tabular-nums text-ink">{stats.users}</span>
          users
        </span>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations…"
            className="h-11 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm text-ink shadow-e1 transition-colors placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-e1">
          {([
            { id: 'grid', Icon: LayoutGrid, label: 'Grid view' },
            { id: 'list', Icon: Rows3, label: 'List view' },
          ] as const).map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              title={label}
              aria-label={label}
              aria-pressed={view === id}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                view === id
                  ? 'bg-accent text-accent-ink'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <div className={view === 'grid' ? 'grid gap-4 sm:grid-cols-2' : 'flex flex-col gap-2.5'}>
        {filtered.map((t) => {
          const badge = verificationBadge(t.verification_status, t.is_active)
          const tint = paletteFor(t.id)
          const compact = view === 'list'
          return (
            <div
              key={t.id}
              className={`group relative flex min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-e2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-e3 ${
                compact ? 'flex-row items-center gap-4 p-4' : 'flex-col'
              }`}
            >
              {!compact && (
                <div className="relative">
                  <OrgArt id={t.id} className="h-24 w-full" />
                  <span
                    className={`absolute right-4 top-4 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur ${badge.textClass}`}
                  >
                    {badge.label}
                  </span>
                </div>
              )}

              <div
                className={
                  compact
                    ? 'flex min-w-0 flex-1 items-start gap-3'
                    : 'relative -mt-7 flex items-end gap-3 px-5'
                }
              >
                <span
                  className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-bold text-white shadow-lg ${tint.chip} ${
                    compact ? 'h-11 w-11 text-[15px]' : 'h-14 w-14 text-[19px] ring-4 ring-surface'
                  }`}
                >
                  {t.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <div className="min-w-0 flex-1 pb-0.5">
                  <h3 title={t.name} className="truncate text-[16px] font-semibold text-ink">
                    {t.name}
                  </h3>
                  <p title={t.slug} className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">
                    {t.slug}
                  </p>
                </div>
              </div>

              {compact && (
                <>
                  <div className="hidden min-w-0 flex-1 items-center gap-5 text-xs text-ink-muted lg:flex">
                    {t.admin_email && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{t.admin_email}</span>
                      </span>
                    )}
                    <span className="shrink-0 whitespace-nowrap">{shortDate(t.created_at)}</span>
                    {!t.has_gst_document && (
                      <span
                        title="No GST document on file"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn"
                      >
                        <FileText className="h-3 w-3" />
                        No GST
                      </span>
                    )}
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 lg:flex">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] tabular-nums text-ink-muted">
                      <Users className="h-3.5 w-3.5" />
                      {t.user_count}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] tabular-nums text-ink-muted">
                      <Briefcase className="h-3.5 w-3.5" />
                      {t.job_count}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </>
              )}

              <div className={compact ? 'hidden' : 'mt-4 px-5'}>
                <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
                  <Field label="Admin">{t.admin_full_name || t.admin_email || '—'}</Field>
                  <Field label="Created">{shortDate(t.created_at)}</Field>
                  <Field label="Members">
                    <span className="font-mono tabular-nums">{t.user_count}</span>
                    <span className="font-normal text-ink-muted"> user{t.user_count === 1 ? '' : 's'} · </span>
                    <span className="font-mono tabular-nums">{t.job_count}</span>
                    <span className="font-normal text-ink-muted"> job{t.job_count === 1 ? '' : 's'}</span>
                  </Field>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                  {t.admin_email && (
                    <span
                      title={t.admin_email}
                      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-ink-muted"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{t.admin_email}</span>
                    </span>
                  )}
                  {t.company_registration_number && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-muted">
                      {t.company_registration_number}
                    </span>
                  )}
                  {t.has_gst_document ? (
                    <button
                      type="button"
                      onClick={() => void openGstDocument(t.id, t.gst_document_filename)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-ink"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      GST document
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn">
                      <FileText className="h-3 w-3 shrink-0" />
                      No GST on file
                    </span>
                  )}
                </div>
              </div>

              <div className={compact ? 'flex shrink-0 flex-wrap gap-2' : 'mt-5 flex flex-wrap gap-2 border-t border-line px-5 py-4'}>
                {t.verification_status === 'pending' && (
                  <>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => approveMutation.mutate(t.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-500/30 transition-all hover:shadow-lg hover:shadow-emerald-500/40 disabled:opacity-50 disabled:shadow-none"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => setPendingConfirm({ tenant: t, action: 'reject' })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neg/25 bg-neg-soft px-3.5 py-2 text-xs font-semibold text-neg transition-colors hover:bg-neg hover:text-white disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </>
                )}
                {t.verification_status === 'rejected' && (
                  <button
                    type="button"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(t.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-500/30 transition-all hover:shadow-lg hover:shadow-emerald-500/40 disabled:opacity-50 disabled:shadow-none"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                )}
                {t.verification_status === 'approved' && (
                  <>
                    <button
                      type="button"
                      disabled={!t.is_active}
                      onClick={() => onEnter(t)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/30 transition-all hover:shadow-lg hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Enter
                    </button>
                    {/* A disabled button fires no hover events, so the tooltip
                        lives on the wrapper to stay visible when greyed out. */}
                    <span
                      title={
                        isProtectedFromDeactivation(t)
                          ? 'The default organization cannot be deactivated'
                          : undefined
                      }
                      className="inline-flex"
                    >
                      <button
                        type="button"
                        disabled={updateMutation.isPending || isProtectedFromDeactivation(t)}
                        onClick={() => onToggleActive(t)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-xs font-semibold text-ink-muted transition-colors hover:border-warn/40 hover:bg-warn-soft hover:text-warn disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:bg-surface disabled:hover:text-ink-muted"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {t.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </span>
                  </>
                )}
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => setPendingConfirm({ tenant: t, action: 'delete' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neg/25 bg-neg-soft px-3.5 py-2 text-xs font-semibold text-neg transition-colors hover:bg-neg hover:text-white disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-card border border-dashed border-line px-6 py-16 text-center">
            <Building2 className="mx-auto h-8 w-8 text-slate-700" />
            <p className="mt-3 text-sm text-ink-muted">
              {search.trim()
                ? 'No organizations match your search.'
                : 'No organizations yet. Create one to get started.'}
            </p>
          </div>
        )}
      </div>

      {gstViewer && (
        <GstDocumentViewer viewer={gstViewer} onClose={closeGstViewer} />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          open
          {...confirmProps(pendingConfirm)}
          onConfirm={runConfirmedAction}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
