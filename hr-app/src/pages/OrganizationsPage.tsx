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

type CreateFormErrors = {
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
function fieldClass(hasError?: string | null): string {
  const base =
    'w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1'
  return hasError
    ? `${base} border-red-500/70 focus:border-red-500 focus:ring-red-500`
    : `${base} border-slate-700 focus:border-teal-600 focus:ring-teal-600`
}

function verificationBadge(status: TenantListItem['verification_status'], isActive: boolean) {
  if (status === 'pending') {
    return {
      label: 'Pending verification',
      className: 'bg-amber-500/15 text-amber-400',
    }
  }
  if (status === 'rejected') {
    return {
      label: 'Rejected',
      className: 'bg-red-500/15 text-red-400',
    }
  }
  return {
    label: isActive ? 'Active' : 'Inactive',
    className: isActive
      ? 'bg-teal-500/15 text-teal-400'
      : 'bg-slate-700/60 text-slate-400',
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
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {viewer.filename || 'GST document'}
            </p>
            <p className="text-xs text-slate-500">In-app preview</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {viewer.url && (
              <button
                type="button"
                onClick={downloadCurrent}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close document viewer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-slate-950">
          {viewer.loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Loading document…
            </div>
          )}
          {viewer.error && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-400">
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

  const filtered = useMemo(() => {
    const list = data ?? []
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
  }, [data, search])

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
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-900" />
  }

  if (isError || !data) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Organizations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Review GST documents, approve new signups, and manage tenant organizations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
        >
          <Plus className="h-4 w-4" />
          {showCreate ? 'Close' : 'New organization'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Organizations', value: stats.total, icon: Building2 },
          { label: 'Pending', value: stats.pending, icon: FileText },
          { label: 'Active', value: stats.active, icon: Power },
          { label: 'Users', value: stats.users, icon: Users },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <Icon className="h-3.5 w-3.5 text-slate-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
          </div>
        ))}
      </div>

      {showCreate && (
        <form
          noValidate
          onSubmit={onCreate}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-6"
        >
          <h2 className="mb-4 text-sm font-semibold text-white">Create organization</h2>
          <p className="mb-4 text-xs text-slate-500">
            Orgs you create here are approved and active immediately (no GST review).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label className="block text-xs font-medium text-slate-400">
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
                <label className="block text-xs font-medium text-slate-400">
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
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
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
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
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
                toggleClassName="hover:text-slate-200"
              />
              {createErrors.adminPassword ? (
                <FieldError message={createErrors.adminPassword} />
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">{PASSWORD_HINT}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organizations…"
          className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((t) => {
          const badge = verificationBadge(t.verification_status, t.is_active)
          return (
            <div
              key={t.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 title={t.name} className="truncate text-base font-semibold text-white">
                    {t.name}
                  </h3>
                  <p title={t.slug} className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {t.slug}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="mt-4 space-y-1.5 text-xs text-slate-400">
                {t.admin_email && (
                  <p className="flex min-w-0 items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-slate-300">
                      {t.admin_full_name ? `${t.admin_full_name} · ` : ''}
                      {t.admin_email}
                    </span>
                  </p>
                )}
                <div className="flex gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {t.user_count} users
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5" />
                    {t.job_count} jobs
                  </span>
                </div>
                {t.company_registration_number && (
                  <p className="truncate">
                    Reg. no:{' '}
                    <span className="text-slate-300">{t.company_registration_number}</span>
                  </p>
                )}
                {t.has_gst_document && (
                  <button
                    type="button"
                    onClick={() => void openGstDocument(t.id, t.gst_document_filename)}
                    className="flex min-w-0 items-center gap-1.5 text-teal-400 hover:text-teal-300"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {t.gst_document_filename || 'View GST PDF'}
                    </span>
                  </button>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                {t.verification_status === 'pending' && (
                  <>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => approveMutation.mutate(t.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => setPendingConfirm({ tenant: t, action: 'reject' })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/40 disabled:opacity-50"
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:opacity-50"
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 px-6 py-16 text-center">
            <Building2 className="mx-auto h-8 w-8 text-slate-700" />
            <p className="mt-3 text-sm text-slate-400">
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
