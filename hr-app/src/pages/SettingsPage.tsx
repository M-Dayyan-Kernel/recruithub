import { Settings } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { SystemSettings } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { WORKFLOW_CARD_CLASS, WORKFLOW_PRIMARY_BUTTON_CLASS } from '@/lib/workflow'

export default function SettingsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings') as unknown as Promise<SystemSettings>,
  })

  const mutation = useMutation({
    mutationFn: (enforce: boolean) =>
      api.patch('/api/settings', {
        enforce_phone_geography: enforce,
        allowed_phone_regions: enforce ? ['IN'] : ['IN'],
      }) as unknown as Promise<SystemSettings>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Settings saved')
    },
    onError: () => toast.error('Failed to save settings'),
  })

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  }

  if (isError || !data) {
    return <BackendError onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">System Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure platform-wide rules for outbound screening calls.
        </p>
      </div>

      <div className={`${WORKFLOW_CARD_CLASS} p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Geography</h3>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          When enabled, only Indian mobile numbers (+91) can receive outbound screening calls.
          Other numbers are skipped at trigger time with a clear reason.
        </p>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={data.enforce_phone_geography}
            onChange={(e) => mutation.mutate(e.target.checked)}
            disabled={mutation.isPending}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              Restrict outbound calls to India (+91)
            </span>
            <span className="block text-xs text-slate-500">
              Allowed regions: {data.allowed_phone_regions.join(', ') || 'None'}
            </span>
          </span>
        </label>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => mutation.mutate(data.enforce_phone_geography)}
            disabled={mutation.isPending}
            className={WORKFLOW_PRIMARY_BUTTON_CLASS}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
