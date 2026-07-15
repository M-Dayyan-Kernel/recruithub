import { type FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  LogIn,
  Plus,
  Power,
  Search,
  Users,
  Briefcase,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { TenantCreateRequest, TenantListItem, TenantUpdateRequest } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { useAuth } from '@/context/AuthContext'

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

  const filtered = useMemo(() => {
    const list = data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    )
  }, [data, search])

  const stats = useMemo(() => {
    const list = data ?? []
    return {
      total: list.length,
      active: list.filter((t) => t.is_active).length,
      users: list.reduce((n, t) => n + t.user_count, 0),
      jobs: list.reduce((n, t) => n + t.job_count, 0),
    }
  }, [data])

  async function onEnter(tenant: TenantListItem) {
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

  function onCreate(e: FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      name: name.trim(),
      admin_email: adminEmail.trim(),
      admin_full_name: adminName.trim(),
      admin_password: adminPassword,
    })
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
            Create, enter, or activate/deactivate tenant organizations on this platform.
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
          { label: 'Active', value: stats.active, icon: Power },
          { label: 'Users', value: stats.users, icon: Users },
          { label: 'Jobs', value: stats.jobs, icon: Briefcase },
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
          onSubmit={onCreate}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-6"
        >
          <h2 className="mb-4 text-sm font-semibold text-white">Create organization</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Organization name
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Admin name</label>
              <input
                required
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Admin email</label>
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                placeholder="admin@acme.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Admin password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
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
        {filtered.map((t) => (
          <div
            key={t.id}
            className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/90 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white">{t.name}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">{t.slug}</p>
              </div>
              <span
                className={
                  t.is_active
                    ? 'shrink-0 rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-400'
                    : 'shrink-0 rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] font-medium text-slate-400'
                }
              >
                {t.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="mt-4 flex gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                {t.user_count} users
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" />
                {t.job_count} jobs
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                disabled={!t.is_active}
                onClick={() => onEnter(t)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <LogIn className="h-3.5 w-3.5" />
                Enter
              </button>
              <button
                type="button"
                disabled={updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate({
                    id: t.id,
                    body: { is_active: !t.is_active },
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                <Power className="h-3.5 w-3.5" />
                {t.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}

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
    </div>
  )
}
