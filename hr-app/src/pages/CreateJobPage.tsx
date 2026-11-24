import { Link, useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { CreateJobForm } from '@/components/CreateJobForm'
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'

export default function CreateJobPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  // A half-written job used to vanish on Cancel, a sidebar link or Back. While it has unsaved
  // changes, leaving asks first, and can keep the work as a draft on the way out.
  const [dirty, setDirty] = useState(false)
  const saveDraftRef = useRef<(() => boolean) | null>(null)
  const blocker = useUnsavedChangesGuard(dirty)

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <Link
        to="/jobs"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to Jobs
      </Link>

      <CreateJobForm
        step={step}
        onStepChange={setStep}
        onSuccess={(job) => navigate(`/jobs/${job.id}`)}
        onCancel={() => navigate('/jobs')}
        onDirtyChange={setDirty}
        saveDraftRef={saveDraftRef}
      />

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
