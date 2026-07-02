import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CreateJobForm } from '@/components/CreateJobForm'

export default function CreateJobPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-lg font-semibold text-slate-900">Create New Job</h2>
        <CreateJobForm
          onSuccess={(job) => navigate(`/jobs/${job.id}`)}
          onCancel={() => navigate('/')}
        />
      </div>
    </div>
  )
}
