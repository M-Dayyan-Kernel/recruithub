import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { CreateJobForm } from '@/components/CreateJobForm'

export default function CreateJobPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      <CreateJobForm
        step={step}
        onStepChange={setStep}
        onSuccess={(job) => navigate(`/jobs/${job.id}`)}
        onCancel={() => navigate('/')}
      />
    </div>
  )
}
