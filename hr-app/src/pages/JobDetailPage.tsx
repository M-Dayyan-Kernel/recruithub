import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, ChevronDown, Loader2, Pencil, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { EditJobModal } from '@/components/EditJobModal'
import { ShortlistTab } from '@/components/ShortlistTab'
import { ParsedResumesTab } from '@/components/ParsedResumesTab'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Job['status'] }) {
  const cfg: Record<Job['status'], { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-indigo-100 text-indigo-700' },
    active: { label: 'Active', className: 'bg-indigo-100 text-indigo-700' },
    closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600' },
    paused: { label: 'Paused', className: 'bg-amber-100 text-amber-700' },
    draft: { label: 'Draft', className: 'bg-slate-100 text-slate-500' },
  }
  const { label, className } = cfg[status] ?? cfg.open
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function JobHeaderSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6 shadow-sm animate-pulse">
      <div className="h-7 bg-slate-200 rounded w-1/3 mb-3" />
      <div className="h-4 bg-slate-200 rounded w-1/5 mb-4" />
      <div className="h-4 bg-slate-200 rounded w-full mb-2" />
      <div className="h-4 bg-slate-200 rounded w-4/5 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 bg-slate-200 rounded-full w-16" />
        <div className="h-6 bg-slate-200 rounded-full w-20" />
        <div className="h-6 bg-slate-200 rounded-full w-14" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = [
  'AI Shortlisted',
  'Upload',
  'Parsing',
  'Parsed Resumes',
  'AI Shortlisting',
] as const
type Tab = (typeof TABS)[number]

const WORKFLOW_SECTION_CLASS = 'space-y-3'
const WORKFLOW_CARD_CLASS = 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm'
const WORKFLOW_TABLE_CLASS = 'min-w-full divide-y divide-slate-200'
const WORKFLOW_TABLE_EMPTY_ROW_CLASS = 'h-[360px]'
const WORKFLOW_TABLE_EMPTY_CELL_CLASS = 'h-[360px] align-middle px-6 text-center text-sm text-slate-400'
const WORKFLOW_INPUT_CLASS =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'
const WORKFLOW_PRIMARY_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function JobDetailPage() {
  const { id: jobId } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('AI Shortlisted')
  const queryClient = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)

  // Job status dropdown (A-14)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
      }
    }
    if (showStatusMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStatusMenu])

  const statusMutation = useMutation<Job, Error, Job['status']>({
    mutationFn: (status) =>
      api.patch(`/api/jobs/${jobId}`, { status }) as Promise<Job>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] })
      toast.success('Job status updated')
      setShowStatusMenu(false)
    },
    onError: () => {
      toast.error('Failed to update job status')
    },
  })

  const getStatusOptions = (
    status: Job['status'],
  ): Array<{ label: string; value: Job['status'] }> => {
    switch (status) {
      case 'open':
      case 'active':
        return [
          { label: 'Pause Job', value: 'paused' },
          { label: 'Close Job', value: 'closed' },
        ]
      case 'paused':
        return [
          { label: 'Reactivate', value: 'open' },
          { label: 'Close Job', value: 'closed' },
        ]
      case 'closed':
        return [{ label: 'Reactivate', value: 'open' }]
      default:
        return [{ label: 'Publish', value: 'open' }]
    }
  }

  const {
    data: job,
    isLoading,
    isError,
    error,
  } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}`) as unknown as Promise<Job>,
    enabled: !!jobId,
    retry: (failureCount, err: Error) => {
      // Don't retry 404s
      if (err.message?.includes('404') || err.message?.toLowerCase().includes('not found')) {
        return false
      }
      return failureCount < 1
    },
  })

  const is404 =
    isError &&
    (error?.message?.includes('404') || error?.message?.toLowerCase().includes('not found'))

  const experienceLabel = () => {
    if (!job) return null
    const { experience_min: min, experience_max: max } = job
    if (min != null && max != null) return `${min}–${max} years`
    if (min != null) return `${min}+ years`
    if (max != null) return `Up to ${max} years`
    return null
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      {/* Back nav */}
      <Link
        to="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeft size={14} />
        Back to Jobs
      </Link>

      {/* Loading skeleton */}
      {isLoading && (
        <>
          <JobHeaderSkeleton />
          <div className="h-10 bg-slate-200 rounded animate-pulse w-80 mb-6" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-slate-200 rounded-lg animate-pulse" />
            ))}
          </div>
        </>
      )}

      {/* 404 state */}
      {is404 && (
        <div className="py-20 text-center">
          <p className="text-slate-700 font-semibold text-lg mb-2">Job not found</p>
          <p className="text-slate-400 text-sm mb-5">
            This job may have been deleted or the URL is incorrect.
          </p>
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <ArrowLeft size={14} />
            Back to Jobs
          </Link>
        </div>
      )}

      {/* Generic error state */}
      {isError && !is404 && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-5 py-4 text-sm text-rose-700">
          Failed to load job details. Please go back and try again.
        </div>
      )}

      {/* Job loaded */}
      {!isLoading && job && (
        <>
          {/* Job header card */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
                  <StatusBadge status={job.status} />
                  <button
                    onClick={() => setEditOpen(true)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                    title="Edit job"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                {/* Job status dropdown */}
                <div className="relative inline-block mb-3" ref={statusMenuRef}>
                  <button
                    onClick={() => setShowStatusMenu((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {statusMutation.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                    Change Status
                  </button>
                  {showStatusMenu && (
                    <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px]">
                      {getStatusOptions(job.status).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => statusMutation.mutate(opt.value)}
                          disabled={statusMutation.isPending}
                          className="w-full px-4 py-2 text-sm text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {experienceLabel() && (
                  <p className="text-sm text-slate-500 mb-3">
                    {experienceLabel()} experience required
                  </p>
                )}

                <p className="text-slate-600 text-sm leading-relaxed mb-4">
                  {job.description}
                </p>

                {(job.required_skills?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {job.required_skills.map(skill => (
                      <span
                        key={skill}
                        className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-medium"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-200">
            <div className="flex gap-0">
              {TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          {activeTab === 'AI Shortlisted' ? (
            <div className={WORKFLOW_SECTION_CLASS}>
              <ShortlistTab
                jobId={jobId ?? ''}
                shortlistTriggered={false}
                onShortlistComplete={() => {}}
                onSwitchToCandidates={() => {}}
                mode="aiShortlisted"
              />
            </div>
          ) : activeTab === 'Upload' ? (
            <div className="space-y-6">
              <div className={WORKFLOW_SECTION_CLASS}>
                <h2 className="text-xl font-semibold text-slate-900">Upload Resumes</h2>
                <p className="text-sm text-slate-500">Upload resumes to begin the parsing process.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
                <label
                  htmlFor="resume-upload"
                  className="group flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-8 py-12 text-center transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <input id="resume-upload" type="file" multiple className="sr-only" />
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 group-hover:ring-indigo-200">
                    <Upload size={22} />
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    Drag &amp; drop resumes here or click to browse.
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    UI only for now. No upload will be started.
                  </p>
                </label>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">Queued Resumes</h2>
                <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
                  <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
                    <thead className="bg-slate-50">
                      <tr>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          Resume Name
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          Uploaded At
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          Status
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                        <td colSpan={4} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                          No resumes in queue.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === 'Parsed Resumes' ? (
            <ParsedResumesTab jobId={jobId ?? ''} />
          ) : activeTab === 'Parsing' ? (
            <div className="space-y-6">
              <div className={WORKFLOW_SECTION_CLASS}>
                <h2 className="text-xl font-semibold text-slate-900">Parsing Queue</h2>
                <p className="text-sm text-slate-500">
                  Resumes currently being processed. They will automatically move to Parsed Resumes once parsing is complete.
                </p>
              </div>

              <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
                <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
                  <thead className="bg-slate-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Resume Name
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Uploaded At
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Progress
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                      <td colSpan={3} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                        No resumes are currently being parsed.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'AI Shortlisting' ? (
            <div className="space-y-6">
              <div className={WORKFLOW_SECTION_CLASS}>
                <h2 className="text-xl font-semibold text-slate-900">AI Shortlisting</h2>
                <p className="text-sm text-slate-500">
                  AI is evaluating selected resumes against the job requirements.
                </p>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="w-full max-w-md">
                  <input
                    type="text"
                    placeholder="Search candidates..."
                    className={WORKFLOW_INPUT_CLASS}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
                  <div className="text-sm font-medium text-slate-600 whitespace-nowrap">
                    Total Shortlisted Candidates: 0
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button type="button" className={WORKFLOW_PRIMARY_BUTTON_CLASS}>
                      Send to AI Shortlisting
                    </button>
                  </div>
                </div>
              </div>

              <div className={`${WORKFLOW_CARD_CLASS} min-h-[360px]`}>
                <table className={`${WORKFLOW_TABLE_CLASS} h-full`}>
                  <thead className="bg-slate-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Candidate Name
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Email ID
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Phone Number
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Years of Experience
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        Progress
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={WORKFLOW_TABLE_EMPTY_ROW_CLASS}>
                      <td colSpan={5} className={WORKFLOW_TABLE_EMPTY_CELL_CLASS}>
                        No resumes are currently being shortlisted.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center">
              <p className="text-slate-700 font-semibold text-lg mb-2">{activeTab}</p>
              <p className="text-slate-400 text-sm">
                This section will be implemented in the next phase.
              </p>
            </div>
          )}
        </>
      )}

      {/* Edit Job Modal — mount only when open so state resets on each open */}
      {editOpen && job && (
        <EditJobModal
          job={job}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  )
}
