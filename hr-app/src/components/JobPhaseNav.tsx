import {
  ListChecks,
  Phone,
  Trophy,
  UserX,
  Video,
} from 'lucide-react'
import { isVoiceScreeningEffective } from '@/lib/voiceScreening'
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
