import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Upload, Link2, Play, PhoneCall, AlertTriangle, CheckCircle, XCircle, HelpCircle, FileText } from 'lucide-react'
import { jobs, candidates, type Candidate } from '../data/stub'
import Badge from '../components/Badge'
import ScoreBar from '../components/ScoreBar'

function CandidateDetailModal({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{candidate.name}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-4 text-sm text-zinc-600">
            <span>{candidate.email}</span>
            <span>·</span>
            <span>{candidate.phone || 'No phone'}</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Skills</p>
            <div className="flex flex-wrap gap-1.5">
              {candidate.skills.map(s => <span key={s} className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full">{s}</span>)}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Experience</p>
            <div className="space-y-2">
              {candidate.experience.map((e, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{e.role}</p>
                    <p className="text-xs text-zinc-500">{e.company} · {e.duration}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Education</p>
            <p className="text-sm text-zinc-700">{candidate.education}</p>
          </div>
          <button className="text-sm text-indigo-600 hover:underline">Download Resume ↓</button>
        </div>
      </div>
    </div>
  )
}

function CandidatesTab({ jobCandidates }: { jobCandidates: Candidate[] }) {
  const [selected, setSelected] = useState<Candidate | null>(null)
  const statusBadge = (s: Candidate['parsingStatus']) => {
    if (s === 'ready') return <Badge variant="green">Ready</Badge>
    if (s === 'parsing') return <Badge variant="amber">Parsing…</Badge>
    if (s === 'failed') return <Badge variant="red">Failed</Badge>
    return <Badge variant="zinc">Pending</Badge>
  }
  return (
    <div>
      {selected && <CandidateDetailModal candidate={selected} onClose={() => setSelected(null)} />}
      {/* Upload area */}
      <div className="border-2 border-dashed border-zinc-200 rounded-xl p-8 text-center mb-6 hover:border-indigo-300 transition-colors">
        <Upload size={24} className="mx-auto text-zinc-400 mb-2" />
        <p className="text-sm font-medium text-zinc-700">Drop resumes here or <span className="text-indigo-600 cursor-pointer">browse files</span></p>
        <p className="text-xs text-zinc-400 mt-1">PDF or DOCX · Single or bulk upload</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <input type="text" placeholder="Or paste Google Drive folder link…" className="border border-zinc-200 rounded-lg px-3 py-1.5 text-xs w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700">
            <Link2 size={12} /> Import
          </button>
        </div>
      </div>
      {/* Candidate list */}
      <div className="grid grid-cols-2 gap-3">
        {jobCandidates.map(c => (
          <div key={c.id} onClick={() => c.parsingStatus === 'ready' && setSelected(c)}
            className={`bg-white border border-zinc-200 rounded-xl p-4 ${c.parsingStatus === 'ready' ? 'cursor-pointer hover:border-indigo-300 hover:shadow-sm' : ''} transition-all`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-800">{c.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{c.email}</p>
              </div>
              {statusBadge(c.parsingStatus)}
            </div>
            {c.parsingStatus === 'ready' && (
              <div className="flex flex-wrap gap-1 mt-3">
                {c.skills.slice(0, 4).map(s => <span key={s} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded">{s}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ShortlistTab({ jobCandidates }: { jobCandidates: Candidate[] }) {
  const shortlisted = jobCandidates.filter(c => c.matchScore !== undefined)
  const sorted = [...shortlisted].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
  const [ran, setRan] = useState(shortlisted.length > 0)
  const [showFeedback, setShowFeedback] = useState<string | null>(null)

  const scoreBadge = (score: number) => {
    if (score >= 80) return <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">{score}%</span>
    if (score >= 60) return <span className="text-sm font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">{score}%</span>
    return <span className="text-sm font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">{score}%</span>
  }

  return (
    <div>
      {!ran ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 mb-4">Run AI shortlisting to score and rank candidates against this JD.</p>
          <button onClick={() => setRan(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 mx-auto">
            <Play size={16} /> Run AI Shortlist
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {showFeedback && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl w-full max-w-md p-6">
                <h3 className="font-semibold text-zinc-800 mb-4">Feedback on AI Recommendation</h3>
                <div className="space-y-2 mb-4">
                  {['Correctly shortlisted', 'Incorrectly shortlisted', 'Correctly rejected', 'Incorrectly rejected'].map(f => (
                    <label key={f} className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                      <input type="radio" name="feedback" className="accent-indigo-600" /> {f}
                    </label>
                  ))}
                </div>
                <textarea rows={2} placeholder="Additional comments (optional)…" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowFeedback(null)} className="px-4 py-2 text-sm text-zinc-600">Cancel</button>
                  <button onClick={() => setShowFeedback(null)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg">Submit Feedback</button>
                </div>
              </div>
            </div>
          )}
          {sorted.map(c => (
            <div key={c.id} className="bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-zinc-800">{c.name}</p>
                  <Badge variant={c.recommendation === 'shortlist' ? 'indigo' : 'red'}>{c.recommendation === 'shortlist' ? 'AI: Shortlist' : 'AI: Reject'}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  {scoreBadge(c.matchScore!)}
                  {c.hrDecision === 'approved' && <Badge variant="green">Approved</Badge>}
                  {c.hrDecision === 'rejected' && <Badge variant="red">Rejected</Badge>}
                </div>
              </div>
              <p className="text-sm text-zinc-600 mb-3">{c.reason}</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase mb-1">Strengths</p>
                  {c.strengths?.map(s => <p key={s} className="text-xs text-emerald-700">✓ {s}</p>)}
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase mb-1">Gaps</p>
                  {c.gaps?.map(g => <p key={g} className="text-xs text-rose-600">✗ {g}</p>)}
                </div>
              </div>
              {!c.hrDecision || c.hrDecision === 'pending' ? (
                <div className="flex gap-2 pt-2 border-t border-zinc-100">
                  <button onClick={() => setShowFeedback(c.id)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700"><CheckCircle size={12} /> Approve</button>
                  <button onClick={() => setShowFeedback(c.id)} className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700"><XCircle size={12} /> Reject</button>
                  <button onClick={() => setShowFeedback(c.id)} className="flex items-center gap-1 px-3 py-1.5 border border-zinc-200 text-zinc-600 text-xs rounded-lg hover:bg-zinc-50"><HelpCircle size={12} /> Override</button>
                </div>
              ) : (
                <button onClick={() => setShowFeedback(c.id)} className="mt-2 text-xs text-zinc-500 hover:text-indigo-600">Give feedback →</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ScreeningTab({ jobCandidates }: { jobCandidates: Candidate[] }) {
  const approved = jobCandidates.filter(c => c.hrDecision === 'approved')
  const missingPhone = approved.filter(c => !c.phone)

  const resultBadge = (r?: 'pass' | 'fail' | 'needs_review') => {
    if (r === 'pass') return <Badge variant="green">Pass ✅</Badge>
    if (r === 'fail') return <Badge variant="red">Fail ❌</Badge>
    if (r === 'needs_review') return <Badge variant="amber">Needs Review ⚠️</Badge>
    return <Badge variant="zinc">Not Started</Badge>
  }

  return (
    <div>
      {missingPhone.length > 0 && (
        <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Missing phone numbers</p>
            <p className="text-xs text-amber-600 mt-0.5">{missingPhone.map(c => c.name).join(', ')} — enter their phone before starting screening.</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-600">{approved.length} approved candidates</p>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
          <PhoneCall size={14} /> Start AI Screening
        </button>
      </div>
      <div className="space-y-4">
        {approved.map(c => (
          <div key={c.id} className="bg-white border border-zinc-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-zinc-800">{c.name}</p>
              {resultBadge(c.screening?.status)}
            </div>
            {c.screening ? (
              <>
                <p className="text-sm text-zinc-600 mb-3 italic">"{c.screening.summary}"</p>
                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  {[
                    ['Current CTC', c.screening.currentCtc],
                    ['Expected CTC', c.screening.expectedCtc],
                    ['Notice Period', c.screening.noticePeriod],
                    ['Availability', c.screening.availability],
                    ['Location', c.screening.locationPref],
                    ['Communication', c.screening.communicationQuality],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-zinc-50 rounded-lg p-2">
                      <p className="text-zinc-400">{label}</p>
                      <p className="font-medium text-zinc-700 mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
                {c.screening.status === 'pass' && !c.interviewStatus && (
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">
                    <Link2 size={12} /> Send Interview Link
                  </button>
                )}
              </>
            ) : !c.phone ? (
              <input type="text" placeholder="Enter phone number…" className="border border-zinc-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            ) : (
              <p className="text-sm text-zinc-400">Awaiting screening call…</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function InterviewsTab({ jobCandidates }: { jobCandidates: Candidate[] }) {
  const interviewed = jobCandidates.filter(c => c.interviewStatus)

  const statusBadge = (s: Candidate['interviewStatus']) => {
    if (s === 'report_ready') return <Badge variant="green">Report Ready</Badge>
    if (s === 'completed') return <Badge variant="blue">Completed</Badge>
    if (s === 'in_progress') return <Badge variant="amber">In Progress</Badge>
    return <Badge variant="zinc">Link Sent</Badge>
  }

  if (interviewed.length === 0) {
    return <div className="text-center py-16 text-zinc-400 text-sm">No interview links sent yet.</div>
  }

  return (
    <div className="space-y-3">
      {interviewed.map(c => (
        <div key={c.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="font-semibold text-zinc-800">{c.name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{c.email}</p>
          </div>
          <div className="flex items-center gap-3">
            {statusBadge(c.interviewStatus)}
            {c.interviewStatus === 'report_ready' && (
              <Link to={`/report/${c.id}`} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700">
                <FileText size={12} /> View Report
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const TABS = ['Candidates', 'Shortlist', 'Screening', 'Interviews'] as const
type Tab = typeof TABS[number]

export default function JobDetail() {
  const { id } = useParams()
  const job = jobs.find(j => j.id === id)
  const jobCandidates = candidates.filter((_, i) => i < 6)
  const [activeTab, setActiveTab] = useState<Tab>('Candidates')

  if (!job) return <div className="p-8 text-zinc-500">Job not found.</div>

  return (
    <div className="p-8">
      <Link to="/jobs" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 mb-6">
        <ArrowLeft size={14} /> Back to Jobs
      </Link>

      {/* Job header */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{job.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="green">{job.status}</Badge>
              <span className="text-sm text-zinc-500">{job.experienceMin}–{job.experienceMax} years experience</span>
              <span className="text-sm text-zinc-500">{jobCandidates.length} candidates</span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-zinc-600 line-clamp-2">{job.description}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {job.requiredSkills.map(s => <span key={s} className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full">{s}</span>)}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200 mb-6">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'Candidates' && <CandidatesTab jobCandidates={jobCandidates} />}
      {activeTab === 'Shortlist' && <ShortlistTab jobCandidates={jobCandidates} />}
      {activeTab === 'Screening' && <ScreeningTab jobCandidates={jobCandidates} />}
      {activeTab === 'Interviews' && <InterviewsTab jobCandidates={jobCandidates} />}
    </div>
  )
}
