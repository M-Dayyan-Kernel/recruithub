import { Link } from 'react-router-dom'
import { Briefcase, Users, CheckCircle, PhoneCall, Video, FileText } from 'lucide-react'
import { jobs, candidates } from '../data/stub'

const stats = [
  { label: 'Active Jobs', value: jobs.filter(j => j.status === 'active').length, icon: Briefcase, color: 'text-indigo-600 bg-indigo-50' },
  { label: 'Total Candidates', value: candidates.length, icon: Users, color: 'text-blue-600 bg-blue-50' },
  { label: 'Shortlisted', value: candidates.filter(c => c.hrDecision === 'approved').length, icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
  { label: 'Screened', value: candidates.filter(c => c.screening).length, icon: PhoneCall, color: 'text-amber-600 bg-amber-50' },
  { label: 'Interviewed', value: candidates.filter(c => c.interviewStatus).length, icon: Video, color: 'text-purple-600 bg-purple-50' },
  { label: 'Reports Ready', value: candidates.filter(c => c.report).length, icon: FileText, color: 'text-rose-600 bg-rose-50' },
]

const activity = [
  { text: 'Resume uploaded: Divya Krishnan — Senior Frontend Engineer', time: '2 minutes ago', type: 'upload' },
  { text: 'AI screening completed: Sneha Patel — Pass ✅', time: '18 minutes ago', type: 'screening' },
  { text: 'Interview report ready: Arjun Sharma — 88/100 Strong Hire', time: '1 hour ago', type: 'report' },
  { text: 'AI shortlist run: Senior Frontend Engineer (6 candidates)', time: '3 hours ago', type: 'shortlist' },
  { text: 'Resume uploaded: 5 resumes — Senior Frontend Engineer', time: '4 hours ago', type: 'upload' },
  { text: 'Job created: Backend Engineer (Python)', time: '2 days ago', type: 'job' },
]

export default function Dashboard() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
        <p className="text-zinc-500 mt-1">Overview of your recruitment pipeline</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-zinc-200 p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
              <Icon size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-zinc-900">{value}</p>
              <p className="text-sm text-zinc-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Active Jobs */}
        <div className="col-span-1 bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-800">Active Jobs</h2>
            <Link to="/jobs" className="text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {jobs.filter(j => j.status === 'active').map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="block p-3 rounded-lg border border-zinc-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors">
                <p className="text-sm font-medium text-zinc-800">{job.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{job.candidateCount} candidates</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div className="col-span-2 bg-white rounded-xl border border-zinc-200 p-5">
          <h2 className="font-semibold text-zinc-800 mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {activity.map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-zinc-700">{item.text}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
