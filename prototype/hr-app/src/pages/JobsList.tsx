import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Briefcase } from 'lucide-react'
import { jobs, type Job } from '../data/stub'
import Badge from '../components/Badge'

function CreateJobModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Create New Job</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Job Title</label>
            <input type="text" placeholder="e.g. Senior Frontend Engineer" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Job Description</label>
            <textarea rows={4} placeholder="Describe the role, responsibilities, and what you're looking for..." className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Required Skills</label>
            <input type="text" placeholder="e.g. React, TypeScript, Tailwind CSS (comma separated)" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Min Experience (years)</label>
              <input type="number" placeholder="3" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Max Experience (years)</label>
              <input type="number" placeholder="6" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Screening Criteria</label>
            <textarea rows={3} placeholder="e.g. Notice period ≤ 30 days, open to hybrid work from Bangalore, expected CTC within range..." className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">Interview Evaluation Criteria</label>
            <textarea rows={3} placeholder="e.g. Evaluate technical depth, problem-solving, communication, culture fit..." className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-800">Cancel</button>
          <button onClick={onClose} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">Create Job</button>
        </div>
      </div>
    </div>
  )
}

export default function JobsList() {
  const [showCreate, setShowCreate] = useState(false)

  const statusVariant = (status: Job['status']) =>
    status === 'active' ? 'green' : status === 'draft' ? 'zinc' : 'red'

  return (
    <div className="p-8">
      {showCreate && <CreateJobModal onClose={() => setShowCreate(false)} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Jobs</h1>
          <p className="text-zinc-500 mt-1">Manage your open positions</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">
          <Plus size={16} />
          Create Job
        </button>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100 text-left">
              <th className="px-5 py-3.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Job Title</th>
              <th className="px-5 py-3.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
              <th className="px-5 py-3.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Candidates</th>
              <th className="px-5 py-3.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Created</th>
              <th className="px-5 py-3.5 text-xs font-medium text-zinc-500 uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => (
              <tr key={job.id} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Briefcase size={14} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{job.title}</p>
                      <p className="text-xs text-zinc-500">{job.requiredSkills.slice(0, 3).join(' · ')}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4"><Badge variant={statusVariant(job.status)}>{job.status}</Badge></td>
                <td className="px-5 py-4 text-sm text-zinc-700">{job.candidateCount}</td>
                <td className="px-5 py-4 text-sm text-zinc-500">{job.createdAt}</td>
                <td className="px-5 py-4">
                  <Link to={`/jobs/${job.id}`} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
