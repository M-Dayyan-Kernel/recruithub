import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CandidateProfile } from '@/types/api'
import { useUpdateCandidate } from '@/hooks/useUpdateCandidate'
import { WORKFLOW_INPUT_CLASS } from '@/lib/workflow'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hired', label: 'Hired' },
]

interface Props {
  profile: CandidateProfile
}

export function CandidateOverviewForm({ profile }: Props) {
  const mutation = useUpdateCandidate(profile.id)
  const [form, setForm] = useState({
    name: profile.name,
    email: profile.email,
    phone: profile.phone ?? '',
    status: profile.status,
    years_experience: profile.years_experience?.toString() ?? '',
    current_ctc: profile.current_ctc ?? '',
    expected_ctc: profile.expected_ctc ?? '',
    notice_period: profile.notice_period ?? '',
    last_working_day: profile.last_working_day ?? '',
  })

  useEffect(() => {
    setForm({
      name: profile.name,
      email: profile.email,
      phone: profile.phone ?? '',
      status: profile.status,
      years_experience: profile.years_experience?.toString() ?? '',
      current_ctc: profile.current_ctc ?? '',
      expected_ctc: profile.expected_ctc ?? '',
      notice_period: profile.notice_period ?? '',
      last_working_day: profile.last_working_day ?? '',
    })
  }, [profile])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      name: form.name,
      email: form.email,
      phone: form.phone || null,
      status: form.status,
      years_experience: form.years_experience ? Number(form.years_experience) : null,
      current_ctc: form.current_ctc || null,
      expected_ctc: form.expected_ctc || null,
      notice_period: form.notice_period || null,
      last_working_day: form.last_working_day || null,
    })
  }

  const fields: Array<{
    key: keyof typeof form
    label: string
    type?: string
  }> = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone' },
    { key: 'years_experience', label: 'Years of experience', type: 'number' },
    { key: 'current_ctc', label: 'Current CTC' },
    { key: 'expected_ctc', label: 'Expected CTC' },
    { key: 'notice_period', label: 'Notice period' },
    { key: 'last_working_day', label: 'Last working day', type: 'date' },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, type = 'text' }) => (
          <div key={key}>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
            <input
              type={type}
              value={form[key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
              className={WORKFLOW_INPUT_CLASS}
            />
          </div>
        ))}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
            className={WORKFLOW_INPUT_CLASS}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Applied job</label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {profile.job_title}
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Hiring stage</label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {profile.hiring_stage}
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700',
          mutation.isPending && 'opacity-70',
        )}
      >
        {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
        Save changes
      </button>
    </form>
  )
}
