import { RefreshCw, WifiOff } from 'lucide-react'

interface BackendErrorProps {
  message?: string
  onRetry?: () => void
}

/**
 * Shared error component shown when the backend is unreachable or returns an
 * unexpected error. Used on every query error state across the app.
 */
export function BackendError({ message, onRetry }: BackendErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4">
        <WifiOff className="w-6 h-6 text-rose-400" />
      </div>
      <p className="text-slate-700 font-semibold mb-1">Unable to reach the server</p>
      <p className="text-slate-400 text-sm max-w-xs mb-5">
        {message ?? 'Make sure the backend is running and try again.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  )
}
