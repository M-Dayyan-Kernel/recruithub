import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  ListChecks,
  Phone,
  Trophy,
  UserX,
  Video,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { FinalistsResponse, Job, RejectedListResponse } from '@/types/api'
import { isVoiceScreeningEffective } from '@/lib/voiceScreening'
import { ScreeningStatusTabs } from '@/components/screening/ScreeningStatusTabs'
import { InterviewTopicsPanel } from '@/components/InterviewTopicsPanel'
import { downloadFinalistsExcel } from '@/lib/finalistsExport'
import { PHONE_SCREENING_LABEL, REJECTED_LABEL, RESUME_SCREENING_LABEL } from '@/lib/stageLabels'

const PHASES = [
  {
    label: RESUME_SCREENING_LABEL,
    segment: 'shortlist',
    icon: ListChecks,
    description: 'Evaluate resumes against the job description',
  },
  {
    label: PHONE_SCREENING_LABEL,
    segment: 'screening',
    icon: Phone,
    description: 'Phone screening calls',
  },
  {
    label: 'Interviews',
    segment: 'interviews',
    icon: Video,
    description: 'AI video interviews',
  },
  {
    label: 'Finalists',
    segment: 'finalists',
    icon: Trophy,
    description: 'Top candidates',
  },
  {
    label: REJECTED_LABEL,
    segment: 'rejected',
    icon: UserX,
    description: 'Rejected candidates, and telling them',
  },
] as const

export function currentPhaseSegment(pathname: string, jobId: string): string {
  const base = `/jobs/${jobId}`
  if (pathname === base || pathname === `${base}/`) return ''
  const rest = pathname.slice(base.length + 1)
  return rest.split('/')[0] ?? ''
}

export function jobPhasePath(jobId: string, segment: string): string {
  return segment ? `/jobs/${jobId}/${segment}` : `/jobs/${jobId}`
}

function phaseLabel(phase: string, phases: Array<(typeof PHASES)[number]>): string {
  if (phase === '') return 'Job overview'
  return phases.find((p) => p.segment === phase)?.label ?? 'Pipeline'
}

/**
 * Label for a pipeline segment, for callers outside the nav (breadcrumbs).
 * Looks at every phase, not the filtered set, so a segment reached by URL
 * still names itself even when its tab is hidden.
 */
export function jobPhaseLabel(segment: string): string {
  return phaseLabel(segment, [...PHASES])
}

export interface JobPhaseStep {
  segment: string
  label: string
}

/**
 * The pipeline steps in order, filtered exactly as the nav tabs are, so a
 * breadcrumb trail never offers a step this job does not actually have.
 */
export function jobPhaseSteps(
  job: { voice_screening_enabled?: boolean },
  showScreening: boolean = isVoiceScreeningEffective(null, job),
): JobPhaseStep[] {
  const phases = showScreening ? [...PHASES] : PHASES.filter((p) => p.segment !== 'screening')
  return phases.map(({ segment, label }) => ({ segment, label }))
}

function PhaseToolbar({
  children,
  end,
}: {
  children: ReactNode
  end?: ReactNode
}) {
  return (
    <div className="flex h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 shadow-sm sm:px-4">
      <div className="min-w-0 flex-1 overflow-x-auto">{children}</div>
      {end && (
        <div className="flex shrink-0 items-center gap-2 border-l border-slate-100 pl-3">{end}</div>
      )}
    </div>
  )
}

function PhaseTitle({
  icon: Icon,
  title,
  subtitle,
  badge,
}: {
  icon: typeof Trophy
  title: string
  subtitle: string
  badge?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500 ring-1 ring-slate-200/70">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          {badge}
        </div>
        <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
      </div>
    </div>
  )
}

interface Props {
  job: Job
}

export function JobPhaseNav({ job }: Props) {
  const location = useLocation()
  const phase = currentPhaseSegment(location.pathname, job.id)

  const { data: finalistsData } = useQuery<FinalistsResponse>({
    queryKey: ['finalists', job.id],
    queryFn: () =>
      api.get(`/api/jobs/${job.id}/finalists`) as unknown as Promise<FinalistsResponse>,
    enabled: phase === 'finalists',
  })

  const { data: rejectedData } = useQuery<RejectedListResponse>({
    queryKey: ['rejected', job.id],
    queryFn: () =>
      api.get(`/api/jobs/${job.id}/rejected`) as unknown as Promise<RejectedListResponse>,
    enabled: phase === 'rejected',
  })

  const finalists = finalistsData?.candidates ?? []

  const toolbar =
    phase === 'interviews' ? (
      <InterviewTopicsPanel job={job} />
    ) : phase === 'screening' ? (
      <PhaseToolbar>
        <ScreeningStatusTabs jobId={job.id} />
      </PhaseToolbar>
    ) : phase === 'finalists' ? (
      <PhaseToolbar
        end={
          <button
            type="button"
            disabled={finalists.length === 0}
            onClick={() => downloadFinalistsExcel(job.title, finalists)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export Excel</span>
          </button>
        }
      >
        <PhaseTitle
          icon={Trophy}
          title="Finalists"
          subtitle="Approved after interview — ready for offer discussions"
          badge={
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-600">
              {finalists.length}
            </span>
          }
        />
      </PhaseToolbar>
    ) : phase === 'rejected' ? (
      <PhaseToolbar>
        <PhaseTitle
          icon={UserX}
          title={REJECTED_LABEL}
          subtitle="Reconsider until a candidate is emailed; emailing is final"
          badge={
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
              {rejectedData?.candidates.length ?? 0}
            </span>
          }
        />
      </PhaseToolbar>
    ) : null

  return (
    <>
      <div className="w-full min-w-0">{toolbar}</div>
    </>
  )
}
