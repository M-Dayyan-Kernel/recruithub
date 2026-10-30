import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ExtensionOrgPolicy } from '@/types/integrity'

export const EXTENSION_POLICY_KEY = ['extension-policy']

/**
 * Whether the organization's master switch for the AI extension check is on. Shared by the org
 * page, the job page and the create form so they all agree and fetch it once.
 *
 * Until it loads (or if it fails) the switch reads as on: the server enforces the real rule, so
 * a slow request never locks a recruiter out of a control they are allowed to use.
 */
export function useExtensionOrgEnabled(): boolean {
  const policy = useQuery<ExtensionOrgPolicy>({
    queryKey: EXTENSION_POLICY_KEY,
    queryFn: () => api.get('/api/extension-policy') as unknown as Promise<ExtensionOrgPolicy>,
    staleTime: 30_000,
  })
  return policy.data?.enabled !== false
}
