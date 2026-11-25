import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { CreateJobForm } from '@/components/CreateJobForm'
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog'
import { FormAlert } from '@/components/ui/FormAlert'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { DUPLICATE_PARAM, jobToFormContent } from '@/lib/jobDuplicate'
import { errorMessage } from '@/lib/errorMessage'

export default function CreateJobPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  // A half-written job used to vanish on Cancel, a sidebar link or Back. While it has unsaved
  // changes, leaving asks first, and can keep the work as a draft on the way out.
  const [dirty, setDirty] = useState(false)
  const saveDraftRef = useRef<(() => boolean) | null>(null)
  const blocker = useUnsavedChangesGuard(dirty)

  // "Duplicate as new job" lands here with ?duplicate=<id>. In the URL rather than router
  // state, so a reload keeps the copy.
  const [searchParams] = useSearchParams()
  const duplicateOf = searchParams.get(DUPLICATE_PARAM)
  const source = useQuery<Job>({
    queryKey: ['job', duplicateOf],
    queryFn: () => api.get(`/api/jobs/${duplicateOf}`) as unknown as Promise<Job>,
    enabled: !!duplicateOf,
  })
  const initialContent = useMemo(
    () => (source.data ? { content: jobToFormContent(source.data), sourceTitle: source.data.title } : undefined),
    [source.data],
  )

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <Link
        to="/jobs"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to Jobs
      </Link>

      {duplicateOf && source.isLoading && (
        <p className="flex items-center gap-2 py-10 text-sm text-ink-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Copying the job…
        </p>
      )}
      {duplicateOf && source.isError && (
        <FormAlert className="mb-6">
          {errorMessage(source.error, 'The job to copy could not be loaded.')} You can still create a job from scratch below.
        </FormAlert>
      )}

      {!(duplicateOf && source.isLoading) && (
        <CreateJobForm
          step={step}
          onStepChange={setStep}
          onSuccess={(job) => navigate(`/jobs/${job.id}`)}
          onCancel={() => navigate('/jobs')}
          onDirtyChange={setDirty}
          saveDraftRef={saveDraftRef}
          initialContent={initialContent}
        />
      )}

      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          body="This job has not been created yet. Save a draft to finish it later (drafts are kept in this browser), or discard your changes."
          onStay={() => blocker.reset()}
          onDiscard={() => blocker.proceed()}
          onSaveDraft={() => {
            const saved = saveDraftRef.current?.() ?? false
            if (saved) blocker.proceed()
            return saved
          }}
        />
      )}
    </div>
  )
}
