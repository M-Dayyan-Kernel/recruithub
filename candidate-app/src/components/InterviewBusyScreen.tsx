import { Loader2, Users } from 'lucide-react'

interface InterviewBusyScreenProps {
  retryAfterMinutes: number
  onRetry?: () => void
  retrying?: boolean
}

export default function InterviewBusyScreen({
  retryAfterMinutes,
  onRetry,
  retrying = false,
}: InterviewBusyScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <Users className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">All Interviewers Are Busy</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          All AI interviewers are currently assisting other candidates. Please try again in
          about {retryAfterMinutes} minutes.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="w-full py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-xl text-base transition-colors inline-flex items-center justify-center gap-2"
          >
            {retrying ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Checking availability…
              </>
            ) : (
              'Try Again'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
