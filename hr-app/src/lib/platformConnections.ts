import { api } from '@/lib/api'
import type { PlatformConnectionItem, TalentosConnectResponse } from '@/types/api'

const CONNECTIONS_URL = '/api/platform/connections'

export async function fetchPlatformConnections(): Promise<PlatformConnectionItem[]> {
  return api.get(CONNECTIONS_URL) as unknown as Promise<PlatformConnectionItem[]>
}

export async function connectPlatformTenant(
  tenantId: string,
): Promise<TalentosConnectResponse> {
  return api.post(
    `/api/platform/tenants/${tenantId}/connections/connect`,
    {},
  ) as unknown as Promise<TalentosConnectResponse>
}

export async function disconnectPlatformTenant(
  tenantId: string,
): Promise<TalentosConnectResponse> {
  return api.post(
    `/api/platform/tenants/${tenantId}/connections/disconnect`,
    {},
  ) as unknown as Promise<TalentosConnectResponse>
}
