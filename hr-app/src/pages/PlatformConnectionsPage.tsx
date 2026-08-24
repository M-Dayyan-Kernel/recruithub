import { useMemo, useState } from 'react'
import { Building2, CheckCircle2, Loader2, Plug, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { BackendError } from '@/components/BackendError'
import {
  useConnectPlatformTenant,
  useDisconnectPlatformTenant,
  usePlatformConnections,
} from '@/hooks/usePlatformConnections'
import type { PlatformConnectionItem } from '@/types/api'

const TRANSIENT_STATES = new Set([
  'keys_issued',
  'provisioning',
  'keys_exchanged',
  'verifying',
  'disconnecting',
])

function canToggle(row: PlatformConnectionItem): boolean {
  return row.verification_status === 'approved' && row.is_active
}

function isLinked(row: PlatformConnectionItem): boolean {
  return row.state === 'linked'
}

function isConnecting(row: PlatformConnectionItem): boolean {
  return TRANSIENT_STATES.has(row.state)
}

function statusBadge(row: PlatformConnectionItem) {
  if (isLinked(row)) {
    return {
      label: 'Linked',
      className: 'bg-teal-500/15 text-teal-400',
    }
  }
  if (isConnecting(row)) {
    return {
      label: 'Connecting',
      className: 'bg-amber-500/15 text-amber-400',
    }
  }
  if (row.state === 'failed') {
    return {
      label: 'Failed',
      className: 'bg-red-500/15 text-red-400',
    }
  }
  return {
    label: 'Not connected',
    className: 'bg-slate-700/60 text-slate-400',
  }
}

function disabledReason(row: PlatformConnectionItem): string | undefined {
  if (row.verification_status === 'pending') {
    return 'Approve the organization before connecting talentOS'
  }
  if (row.verification_status === 'rejected') {
    return 'Rejected organizations cannot be connected'
  }
  if (!row.is_active) {
    return 'Activate the organization before connecting talentOS'
  }
  return undefined
}

export default function PlatformConnectionsPage() {
  const { data, isLoading, isError, refetch } = usePlatformConnections()
  const connectReq = useConnectPlatformTenant()
  const disconnectReq = useDisconnectPlatformTenant()
  const [search, setSearch] = useState('')
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (row) =>
        row.name.toLowerCase().includes(q) || row.slug.toLowerCase().includes(q),
    )
  }, [data, search])

  const busy = connectReq.isPending || disconnectReq.isPending

  function onToggle(row: PlatformConnectionItem) {
    if (busy || !canToggle(row)) return
    setPendingTenantId(row.tenant_id)
    if (isLinked(row) || isConnecting(row)) {
      disconnectReq.mutate(row.tenant_id, {
        onSuccess: () => toast.success(`Disconnected ${row.name} from talentOS`),
        onError: (err: Error) => toast.error(err.message || 'Failed to disconnect'),
        onSettled: () => setPendingTenantId(null),
      })
      return
    }
    connectReq.mutate(row.tenant_id, {
      onSuccess: () => toast.success(`Connecting ${row.name} to talentOS…`),
      onError: (err: Error) => toast.error(err.message || 'Failed to connect'),
      onSettled: () => setPendingTenantId(null),
    })
  }

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-900" />
  }

  if (isError || !data) {
    return <BackendError onRetry={() => void refetch()} />
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Connections</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connect each organization to talentOS from one place. Screening and interview
          results sync after an organization is linked.
        </p>
      </div>

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

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90">
        {filtered.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Building2 className="mx-auto h-8 w-8 text-slate-700" />
            <p className="mt-3 text-sm text-slate-400">
              {search.trim()
                ? 'No organizations match your search.'
                : 'No organizations yet. Create one from Organizations to get started.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Organization</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">talentOS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((row) => {
                const badge = statusBadge(row)
                const switchOn =
                  isLinked(row) || isConnecting(row) || pendingTenantId === row.tenant_id
                const rowBusy = pendingTenantId === row.tenant_id
                const locked = busy || !canToggle(row)
                const reason = disabledReason(row)
                return (
                  <tr key={row.tenant_id} className="text-sm">
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">{row.slug}</p>
                      {row.state === 'failed' && row.last_error && (
                        <p className="mt-1 text-xs text-red-400">{row.last_error}</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        {isLinked(row) && <CheckCircle2 className="h-3 w-3" />}
                        {isConnecting(row) && <Loader2 className="h-3 w-3 animate-spin" />}
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-3">
                        {rowBusy && (
                          <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                        )}
                        <span title={reason} className="inline-flex">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={switchOn}
                            aria-label={`Toggle talentOS connection for ${row.name}`}
                            disabled={locked}
                            onClick={() => onToggle(row)}
                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${
                              switchOn ? 'bg-teal-600' : 'bg-slate-600'
                            }`}
                          >
                            <span
                              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                switchOn ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Plug className="h-3.5 w-3.5" />
        Connecting provisions a talentOS workspace and completes a mutual ping handshake.
      </p>
    </div>
  )
}
