import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Download, Briefcase, GraduationCap, Wrench, FolderGit2 } from 'lucide-react'
import type { Candidate } from '@/data/stub'

interface Props {
  candidate: Candidate | null
  onClose: () => void
}

export function CandidateDetailModal({ candidate: c, onClose }: Props) {
  if (!c) return null

  return (
    <Modal open={!!c} onClose={onClose} title="Candidate Profile" size="lg">
      <div className="px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xl flex items-center justify-center">
              {c.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{c.name}</h2>
              <p className="text-sm text-slate-500">{c.email}</p>
              <p className="text-sm text-slate-500">{c.phone}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm">
            <Download size={14} />
            Resume
          </Button>
        </div>

        {/* Skills */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench size={12} /> Skills
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {c.skills.map(s => (
              <span key={s} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full border border-indigo-100">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Experience */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Briefcase size={12} /> Experience ({c.totalYears} years total)
          </h3>
          <div className="space-y-3">
            {c.experience.map((exp, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-400 mt-2 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">{exp.role}</div>
                  <div className="text-xs text-slate-500">{exp.company} · {exp.duration}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{exp.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Education */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <GraduationCap size={12} /> Education
          </h3>
          <div className="space-y-1.5">
            {c.education.map((edu, i) => (
              <div key={i} className="text-sm text-slate-700">
                <span className="font-medium">{edu.degree}</span>
                <span className="text-slate-400"> — {edu.institution}, {edu.year}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Projects */}
        {c.projects.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FolderGit2 size={12} /> Projects
            </h3>
            <div className="space-y-2">
              {c.projects.map((p, i) => (
                <div key={i}>
                  <div className="text-sm font-medium text-slate-800">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
