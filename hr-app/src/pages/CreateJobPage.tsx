import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CreateJobForm } from '@/components/CreateJobForm'

export default function CreateJobPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      <p className="mb-8 text-sm leading-relaxed text-slate-500">
        Upload a job description to auto-fill details, then review screening and
        interview questions before publishing.
      </p>

      <CreateJobForm
        onSuccess={(job) => navigate(`/jobs/${job.id}`)}
        onCancel={() => navigate('/')}
      />
    </div>
  )
}
