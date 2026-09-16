import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { getProctorSession } from '@/proctoring/session'
import { StatusScreen } from '@/components/Shell'

interface InterviewInfo {
  id: string
  unique_token: string
  status: string
  candidate_name?: string
  job_title?: string
  created_at: string
}

export default function InterviewCompletePage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<InterviewInfo | null>(null)
  // Set when the enforcement policy ended the interview (proctoring/policy.ts).
  const endedReason = token ? getProctorSession(token).getEndedReason() : null

  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .get(`/api/interview/${token}`)
      .then((data) => {
        if (!cancelled) setInfo(data as unknown as InterviewInfo)
      })
      .catch(() => {
        // Best effort, never surface errors on the thank you page.
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const name = info?.candidate_name ? `${info.candidate_name}, ` : ''

  return (
    <StatusScreen
      icon={endedReason ? <ShieldAlert size={22} /> : <CheckCircle2 size={22} />}
      tone={endedReason ? 'danger' : 'success'}
      title={endedReason ? 'Interview ended early' : 'Interview complete'}
      footer={
        <>
          <p className="text-[0.8rem] text-ink-muted">
            Questions? Reach out to{' '}
            <a
              href="mailto:careers@webknot.in"
              className="font-medium text-accent underline underline-offset-[3px]"
            >
              careers@webknot.in
            </a>
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-muted">
            You can close this tab, your responses are saved.
          </p>
        </>
      }
      body={
        endedReason
          ? `${name}the hiring team will review the part of the interview you completed and will be in touch.`
          : `${name}thank you for your time. The hiring team will review your interview and be in touch soon.`
      }
    >
      {endedReason && (
        <div className="mt-6 w-full rounded-[10px] border border-warn/25 bg-warn-soft px-4 py-3.5 text-left">
          <p className="text-[0.86rem] font-semibold text-warn">{endedReason}</p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-warn/80">
            You were warned once before this happened. Everything recorded up to that point has
            been submitted.
          </p>
        </div>
      )}

      {info?.job_title && (
        <div className="mt-6 w-full rounded-[10px] border border-line bg-panel-alt px-4 py-3 text-left">
          <p className="text-[0.68rem] uppercase tracking-wide text-ink-muted">Interview for</p>
          <p className="mt-0.5 text-[0.86rem] font-semibold text-ink">{info.job_title}</p>
        </div>
      )}

    </StatusScreen>
  )
}
