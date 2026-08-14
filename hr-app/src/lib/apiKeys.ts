import { api } from '@/lib/api'
import type {
  ApiKey,
  ApiKeyCreatedResponse,
  ApiKeyListResponse,
  TalentosConnectResponse,
  TalentosConnectionResponse,
  TalentosConnectionUpdate,
} from '@/types/api'

const KEYS_URL = '/api/tenant/app-keys'
const CONNECTION_URL = '/api/integrations/talentos'

export async function fetchApiKeys(): Promise<ApiKey[]> {
  const data = (await api.get(KEYS_URL)) as ApiKeyListResponse
  return data.data ?? []
}

export async function createApiKey(body: {
  name: string
  description?: string | null
}): Promise<ApiKeyCreatedResponse> {
  return api.post(KEYS_URL, body) as unknown as Promise<ApiKeyCreatedResponse>
}

export async function updateApiKey(
  id: string,
  body: { name?: string; description?: string | null },
): Promise<ApiKey> {
  return api.patch(`${KEYS_URL}/${id}`, body) as unknown as Promise<ApiKey>
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete(`${KEYS_URL}/${id}`)
}

export async function rotateApiKey(id: string): Promise<ApiKeyCreatedResponse> {
  return api.post(`${KEYS_URL}/${id}/rotate`) as unknown as Promise<ApiKeyCreatedResponse>
}

export async function fetchTalentosConnection(): Promise<TalentosConnectionResponse> {
  return api.get(CONNECTION_URL) as unknown as Promise<TalentosConnectionResponse>
}

export async function updateTalentosConnection(
  body: TalentosConnectionUpdate,
): Promise<TalentosConnectionResponse> {
  return api.patch(CONNECTION_URL, body) as unknown as Promise<TalentosConnectionResponse>
}

export async function fetchTalentosConnectStatus(): Promise<TalentosConnectResponse> {
  return api.get(`${CONNECTION_URL}/connect`) as unknown as Promise<TalentosConnectResponse>
}

export async function connectTalentos(): Promise<TalentosConnectResponse> {
  return api.post(`${CONNECTION_URL}/connect`, {}) as unknown as Promise<TalentosConnectResponse>
}

export async function disconnectTalentos(): Promise<TalentosConnectResponse> {
  return api.post(
    `${CONNECTION_URL}/disconnect`,
    {},
  ) as unknown as Promise<TalentosConnectResponse>
}
