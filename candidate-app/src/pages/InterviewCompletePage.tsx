import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InterviewInfo {
  id: string
  unique_token: string
  status: string
  candidate_name?: string
  job_title?: string
  created_at: string
}

// ---------------------------------------------------------------------------
// InterviewCompletePage
// ---------------------------------------------------------------------------

export default function InterviewCompletePage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<InterviewInfo | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .get(`/api/interview/${token}`)
      .then((data) => {
        if (!cancelled) setInfo(data as unknown as InterviewInfo)
      })
      .catch(() => {
        // Best effort — don't surface errors on thank-you page
      })

    return () => { cancelled = true }
  }, [token])

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {/* Big checkmark */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-emerald-900/40 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-extrabold text-slate-100 mb-3">Interview Complete!</h1>

        {/* Personalised message */}
        <p className="text-slate-300 text-base leading-relaxed mb-2">
          {info?.candidate_name ? (
            <>
              Thank you, <span className="font-medium">{info.candidate_name}</span>!
            </>
          ) : (
            'Thank you!'
          )}
        </p>

        {info?.job_title && (
          <p className="text-slate-400 text-sm mb-4">
            Interview for: <span className="font-medium text-slate-300">{info.job_title}</span>
          </p>
        )}

        <p className="text-slate-400 text-sm leading-relaxed">
          Thank you for completing your interview. The hiring team will review your responses and
          be in touch soon.
        </p>

        {/* Contact info */}
        <div className="mt-8 pt-6 border-t border-slate-800 text-center">
          <p className="text-slate-400 text-sm">Questions? Reach out to the hiring team</p>
          <a
            href="mailto:careers@webknot.in"
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mt-1 inline-block"
          >
            careers@webknot.in
          </a>
        </div>

        <p className="text-xs text-slate-600 mt-4">
          You may close this tab. Your responses have been saved.
        </p>
      </div>
    </div>
  )
}
