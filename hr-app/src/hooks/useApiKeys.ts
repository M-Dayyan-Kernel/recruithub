import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  connectTalentos,
  createApiKey,
  disconnectTalentos,
  fetchApiKeys,
  fetchTalentosConnectStatus,
  fetchTalentosConnection,
  revokeApiKey,
  rotateApiKey,
  updateApiKey,
  updateTalentosConnection,
} from '@/lib/apiKeys'
import type {
  ApiKey,
  TalentosConnectResponse,
  TalentosConnectionUpdate,
} from '@/types/api'

export function useApiKeys() {
  return useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: fetchApiKeys,
  })
}

export function useTalentosConnection() {
  return useQuery({
    queryKey: ['talentos-connection'],
    queryFn: fetchTalentosConnection,
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null }) => createApiKey(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; description?: string | null } }) =>
      updateApiKey(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
}

export function useRotateApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rotateApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
}

export function useUpdateTalentosConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TalentosConnectionUpdate) => updateTalentosConnection(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['talentos-connection'] })
    },
  })
}

/** Live one-click connect status. Polls every 2.5s while a flow is in flight. */
export function useTalentosConnectStatus() {
  return useQuery({
    queryKey: ['talentos-connect-status'],
    queryFn: fetchTalentosConnectStatus,
    refetchInterval: (query) => {
      const state = (query.state.data as TalentosConnectResponse | undefined)?.state
      return state && state !== 'none' ? 2500 : false
    },
  })
}

export function useConnectTalentos() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => connectTalentos(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['talentos-connect-status'] })
    },
  })
}

export function useDisconnectTalentos() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => disconnectTalentos(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['talentos-connect-status'] })
    },
  })
}
