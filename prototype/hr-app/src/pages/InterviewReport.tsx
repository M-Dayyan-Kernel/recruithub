import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { candidates } from '../data/stub'
import Badge from '../components/Badge'
import ScoreBar from '../components/ScoreBar'

export default function InterviewReport() {
  const { id } = useParams()
  const candidate = candidates.find(c => c.id === id)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  if (!candidate?.report) return <div className="p-8 text-zinc-500">Report not found.</div>

  const r = candidate.report
  const recVariant = r.recommendation.includes('Strong') ? 'green' : r.recommendation.includes('Consider') ? 'amber' : 'red'

  return (
    <div className="p-8 max-w-3xl">
      <Link to="/jobs/job-1" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 mb-6">
        <ArrowLeft size={14} /> Back to Job
      </Link>

      <div className="bg-white border border-zinc-200 rounded-2xl p-8 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{candidate.name}</h1>
            <p className="text-sm text-zinc-500 mt-1">Senior Frontend Engineer · Interview Assessment</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black text-indigo-600">{r.overallScore}</p>
            <p className="text-xs text-zinc-400">out of 100</p>
            <div className="mt-2"><Badge variant={recVariant}>{r.recommendation}</Badge></div>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <ScoreBar label="Technical Fit" value={r.technicalFit} />
          <ScoreBar label="Communication" value={r.communication} />
          <ScoreBar label="Problem Solving" value={r.problemSolving} />
          <ScoreBar label="Relevant Experience" value={r.experience} />
          <ScoreBar label="Role Alignment" value={r.roleAlignment} />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Strengths</p>
            <div className="space-y-1">
              {r.strengths.map(s => <p key={s} className="text-xs text-emerald-700 flex items-start gap-1.5"><span>✓</span>{s}</p>)}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Areas to Improve</p>
            <div className="space-y-1">
              {r.weaknesses.map(w => <p key={w} className="text-xs text-amber-700 flex items-start gap-1.5"><span>△</span>{w}</p>)}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">JD Fit</p>
          <p className="text-sm text-zinc-700">{r.jdFit}</p>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Interview Summary</p>
          <p className="text-sm text-zinc-700">{r.summary}</p>
        </div>

        <button onClick={() => setTranscriptOpen(!transcriptOpen)}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700">
          <ChevronDown size={14} className={`transition-transform ${transcriptOpen ? 'rotate-180' : ''}`} />
          {transcriptOpen ? 'Hide' : 'Show'} Transcript Summary
        </button>
        {transcriptOpen && (
          <div className="mt-3 bg-zinc-50 rounded-xl p-4 text-sm text-zinc-700">{r.transcriptSummary}</div>
        )}
      </div>
    </div>
  )
}
