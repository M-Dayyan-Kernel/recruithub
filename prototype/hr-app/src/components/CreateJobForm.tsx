import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { X } from 'lucide-react'
import type { Job } from '@/data/stub'

interface CreateJobFormProps {
  onSubmit: (data: Partial<Job>) => void
  onCancel: () => void
}

export function CreateJobForm({ onSubmit, onCancel }: CreateJobFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skillInput, setSkillInput] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [expMin, setExpMin] = useState('2')
  const [expMax, setExpMax] = useState('5')
  const [screening, setScreening] = useState('')
  const [interview, setInterview] = useState('')

  const addSkill = () => {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) {
      setSkills(prev => [...prev, s])
      setSkillInput('')
    }
  }

  const removeSkill = (s: string) => setSkills(prev => prev.filter(x => x !== s))

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addSkill()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      title,
      description,
      requiredSkills: skills,
      experienceMin: Number(expMin),
      experienceMax: Number(expMax),
      screeningCriteria: screening,
      interviewEvaluationCriteria: interview,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
      {/* Job Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Job Title *</label>
        <input
          required
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Senior Frontend Engineer"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Job Description *</label>
        <textarea
          required
          rows={4}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the role, responsibilities, and ideal candidate…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Skills */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Required Skills</label>
        <div className="flex gap-2 mb-2">
          <input
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a skill and press Enter or Add"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button type="button" variant="outline" size="md" onClick={addSkill}>Add</Button>
        </div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full border border-indigo-200">
                {s}
                <button type="button" onClick={() => removeSkill(s)} className="hover:text-indigo-900">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Experience */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Experience Required</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={expMin}
            onChange={e => setExpMin(e.target.value)}
            className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-slate-500 text-sm">to</span>
          <input
            type="number"
            min={0}
            value={expMax}
            onChange={e => setExpMax(e.target.value)}
            className="w-20 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-slate-500 text-sm">years</span>
        </div>
      </div>

      {/* Screening Criteria */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Screening Criteria</label>
        <textarea
          rows={3}
          value={screening}
          onChange={e => setScreening(e.target.value)}
          placeholder="What should the AI screening call cover? (e.g. location preference, CTC range, notice period)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Interview Criteria */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Interview Evaluation Criteria</label>
        <textarea
          rows={3}
          value={interview}
          onChange={e => setInterview(e.target.value)}
          placeholder="What should the AI interview assess? (e.g. React architecture, TypeScript, system design)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">Create Job</Button>
      </div>
    </form>
  )
}
