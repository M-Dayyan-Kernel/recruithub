import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  connectPlatformTenant,
  disconnectPlatformTenant,
  fetchPlatformConnections,
} from '@/lib/platformConnections'
import type { PlatformConnectionItem } from '@/types/api'

const QUERY_KEY = ['platform-connections'] as const

const TRANSIENT_STATES = new Set([
  'keys_issued',
  'provisioning',
  'keys_exchanged',
  'verifying',
  'disconnecting',
])

function hasTransientFlow(rows: PlatformConnectionItem[] | undefined): boolean {
  return (rows ?? []).some((row) => TRANSIENT_STATES.has(row.state))
}

export function usePlatformConnections() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPlatformConnections,
    refetchInterval: (query) =>
      hasTransientFlow(query.state.data as PlatformConnectionItem[] | undefined)
        ? 2500
        : false,
  })
}

export function useConnectPlatformTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tenantId: string) => connectPlatformTenant(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useDisconnectPlatformTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tenantId: string) => disconnectPlatformTenant(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}
