import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { BackendError } from '@/components/BackendError'
import { CandidateOverviewForm } from '@/components/candidates/CandidateOverviewForm'
import { CandidateAiTab } from '@/components/candidates/CandidateAiTab'
import { CandidateScreeningTab } from '@/components/candidates/CandidateScreeningTab'
import { CandidateInterviewTab } from '@/components/candidates/CandidateInterviewTab'
import { CandidateTimelineTab } from '@/components/candidates/CandidateTimelineTab'
import { useCandidateProfile } from '@/hooks/useCandidateProfile'
import { cn } from '@/lib/utils'

const TABS = ['Overview', 'AI Analysis', 'Screening', 'Interview', 'Timeline'] as const
type TabId = (typeof TABS)[number]

export default function CandidateProfilePage() {
  const { candidateId = '' } = useParams<{ candidateId: string }>()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<TabId>('Overview')
  const { data: profile, isLoading, isError, refetch } = useCandidateProfile(candidateId)

  const backHref = `/candidates${location.search}`

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    )
  }

  if (isError || !profile) {
    return (
      <div className="space-y-4">
        <Link to={backHref} className="inline-flex items-center gap-1.5 text-sm text-indigo-600">
          <ArrowLeft size={14} />
          Back to candidates
        </Link>
        <BackendError onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <ArrowLeft size={14} />
          Back to candidates
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">{profile.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {profile.job_title} · {profile.hiring_stage} ·{' '}
          {profile.match_score != null ? `${Math.round(profile.match_score)}% match` : 'No score yet'}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'border-b-2 border-indigo-600 text-indigo-700'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {activeTab === 'Overview' && <CandidateOverviewForm profile={profile} />}
        {activeTab === 'AI Analysis' && <CandidateAiTab profile={profile} />}
        {activeTab === 'Screening' && <CandidateScreeningTab profile={profile} />}
        {activeTab === 'Interview' && <CandidateInterviewTab profile={profile} />}
        {activeTab === 'Timeline' && <CandidateTimelineTab profile={profile} />}
      </div>
    </div>
  )
}
