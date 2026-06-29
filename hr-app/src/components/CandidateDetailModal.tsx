import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  X,
  Download,
  Mail,
  Phone,
  Building,
  Briefcase,
  GraduationCap,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Pencil,
  Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { Candidate } from '@/types/api'
import { BackendError } from '@/components/BackendError'
import { CandidateTimeline } from '@/components/CandidateTimeline'

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-slate-200 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-5 bg-slate-200 rounded w-1/3" />
          <div className="h-3.5 bg-slate-100 rounded w-1/4" />
          <div className="h-3.5 bg-slate-100 rounded w-1/5" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-slate-200 rounded w-16" />
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 w-16 bg-slate-100 rounded-full" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-slate-200 rounded w-24" />
        <div className="h-16 bg-slate-100 rounded-lg" />
        <div className="h-16 bg-slate-100 rounded-lg" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Experience item with show-more toggle
// ---------------------------------------------------------------------------

function ExperienceItem({
  company,
  title,
  duration,
  description,
}: {
  company: string
  title: string
  duration?: string | null
  description?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = !!description && description.length > 120

  return (
    <div className="pl-6 relative">
      {/* Timeline dot */}
      <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-indigo-400 bg-white" />
      <p className="text-sm font-semibold text-slate-800">{title ?? '—'}</p>
      <p className="text-sm text-slate-500">{company ?? '—'}</p>
      {duration && <p className="text-xs text-slate-400 mt-0.5">{duration}</p>}
      {description && (
        <>
          <p
            className={`text-xs text-slate-500 mt-1 leading-relaxed ${
              !expanded && isLong ? 'line-clamp-2' : ''
            }`}
          >
            {description}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded(p => !p)}
              className="flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 mt-1 font-medium"
            >
              {expanded ? (
                <>Show less <ChevronUp size={11} /></>
              ) : (
                <>Show more <ChevronDown size={11} /></>
              )}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidate Detail Modal (Task 3.14)
// ---------------------------------------------------------------------------

interface Props {
  candidateId: string
  jobId?: string
  onClose: () => void
}

export function CandidateDetailModal({ candidateId, jobId, onClose }: Props) {
  const queryClient = useQueryClient()
  const [showTimeline, setShowTimeline] = useState(false)

  // Phone inline edit state
  const [isEditingPhone, setIsEditingPhone] = useState(false)
  const [phoneInputValue, setPhoneInputValue] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)

  const phoneMutation = useMutation<Candidate, Error, string>({
    mutationFn: (phone) =>
      api.patch(`/api/candidates/${candidateId}`, { phone }) as Promise<Candidate>,
    onSuccess: () => {
      setIsEditingPhone(false)
      setPhoneError(null)
      queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] })
      if (jobId) queryClient.invalidateQueries({ queryKey: ['candidates', jobId] })
      toast.success('Phone number updated')
    },
    onError: (err) => {
      setPhoneError(err.message ?? 'Failed to update phone number')
    },
  })

  const { data: candidate, isLoading, isError, refetch } = useQuery<Candidate>({
    queryKey: ['candidate', candidateId],
    queryFn: () => api.get(`/api/candidates/${candidateId}`) as unknown as Promise<Candidate>,
  })

  const pd = candidate?.parsed_data

  // Resume download link — served by backend at /uploads/<path>
  const resumeUrl = candidate?.resume_file_path
    ? `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/uploads/${candidate.resume_file_path}`
    : null

  const displayName =
    pd?.name ??
    candidate?.name ??
    `Candidate #${candidateId}`

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-base font-semibold text-slate-900 truncate pr-4">
            {isLoading ? 'Loading profile…' : displayName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading && <LoadingSkeleton />}

          {isError && <BackendError onRetry={refetch} />}

          {candidate && (
            <>
              {/* ── Header: name, email, phone, company, role ── */}
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xl uppercase shrink-0">
                  {displayName[0] ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 truncate">{displayName}</h3>
                  <div className="mt-1.5 space-y-1">
                    {(pd?.email ?? candidate.email) && (
                      <p className="flex items-center gap-2 text-sm text-slate-500">
                        <Mail size={13} className="shrink-0" />
                        {pd?.email ?? candidate.email}
                      </p>
                    )}
                    {/* Phone field with inline edit */}
                    {isEditingPhone ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Phone size={13} className="shrink-0 text-slate-400" />
                          <input
                            type="tel"
                            value={phoneInputValue}
                            onChange={(e) => {
                              setPhoneInputValue(e.target.value)
                              setPhoneError(null)
                            }}
                            placeholder="Enter phone number"
                            autoFocus
                            className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <button
                            onClick={() => phoneMutation.mutate(phoneInputValue.trim())}
                            disabled={phoneMutation.isPending || !phoneInputValue.trim()}
                            className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1"
                          >
                            {phoneMutation.isPending ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : 'Save'}
                          </button>
                          <button
                            onClick={() => { setIsEditingPhone(false); setPhoneError(null) }}
                            className="px-2 py-1 border border-slate-200 text-slate-500 text-xs rounded hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                        {phoneError && (
                          <p className="text-xs text-rose-600 pl-5">{phoneError}</p>
                        )}
                      </div>
                    ) : (pd?.phone ?? candidate.phone) ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500 group">
                        <Phone size={13} className="shrink-0" />
                        <span>{pd?.phone ?? candidate.phone}</span>
                        <button
                          onClick={() => {
                            setIsEditingPhone(true)
                            setPhoneInputValue(pd?.phone ?? candidate.phone ?? '')
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-indigo-600 transition-opacity rounded"
                          title="Edit phone"
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setIsEditingPhone(true); setPhoneInputValue('') }}
                        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-indigo-600 transition-colors"
                      >
                        <Phone size={13} className="shrink-0" />
                        <span className="italic">No phone — click to add</span>
                        <Pencil size={11} />
                      </button>
                    )}
                    {pd?.current_company && (
                      <p className="flex items-center gap-2 text-sm text-slate-500">
                        <Building size={13} className="shrink-0" />
                        {pd.current_company}
                      </p>
                    )}
                    {pd?.current_role && (
                      <p className="flex items-center gap-2 text-sm text-slate-500">
                        <Briefcase size={13} className="shrink-0" />
                        {pd.current_role}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Skills chips ── */}
              {pd?.skills && pd.skills.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
                    Skills
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {pd.skills.map((skill, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Experience timeline ── */}
              {pd?.experience && pd.experience.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Briefcase size={11} />
                    Experience
                    {pd.total_experience_years != null && (
                      <span className="font-normal normal-case text-slate-400">
                        · {pd.total_experience_years} yr{pd.total_experience_years !== 1 ? 's' : ''} total
                      </span>
                    )}
                  </h4>
                  {/* Timeline */}
                  <div className="relative">
                    <div className="absolute left-[5px] top-2 bottom-2 w-px bg-slate-200" />
                    <div className="space-y-5">
                      {pd.experience.map((exp, i) => (
                        <ExperienceItem
                          key={i}
                          company={exp.company ?? '—'}
                          title={exp.title ?? '—'}
                          duration={exp.duration}
                          description={exp.description}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Education ── */}
              {pd?.education && pd.education.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <GraduationCap size={11} />
                    Education
                  </h4>
                  <div className="space-y-3">
                    {pd.education.map((edu, i) => (
                      <div key={i} className="flex items-start gap-3 bg-slate-50 rounded-lg px-3.5 py-3">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                          <BookOpen size={13} className="text-slate-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {edu.degree ?? '—'}{edu.field ? ` in ${edu.field}` : ''}
                          </p>
                          <p className="text-sm text-slate-500">{edu.institution ?? '—'}</p>
                          {edu.year && (
                            <p className="text-xs text-slate-400 mt-0.5">{edu.year}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── No parsed data ── */}
              {!pd && (
                <div className="py-6 text-center text-slate-400 text-sm">
                  Resume is still being parsed. Check back in a moment.
                </div>
              )}

              {/* ── Pipeline Timeline ── */}
              {jobId && (
                <section className="border-t border-slate-100 pt-4">
                  <button
                    onClick={() => setShowTimeline((v) => !v)}
                    className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-indigo-600 transition-colors mb-3"
                  >
                    <GitBranch size={14} />
                    Pipeline Timeline
                    <ChevronDown
                      size={13}
                      className={`transition-transform ml-auto ${showTimeline ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {showTimeline && (
                    <CandidateTimeline candidateId={candidateId} jobId={jobId} />
                  )}
                </section>
              )}

              {/* ── Resume download ── */}
              {resumeUrl && (
                <section className="pt-2 border-t border-slate-100">
                  <a
                    href={resumeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Download size={14} />
                    Download Resume
                  </a>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default CandidateDetailModal
