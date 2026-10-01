import { buildSkillMatchMap, type SkillMatchEntry } from '@/lib/skillMatch'

const STATUS_CLASS: Record<SkillMatchEntry['status'], string> = {
  matched: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  gap: 'border-rose-200 bg-rose-50 text-rose-800',
  unclear: 'border-slate-200 bg-slate-50 text-slate-600',
}

const STATUS_LABEL: Record<SkillMatchEntry['status'], string> = {
  matched: 'Matched',
  gap: 'Gap',
  unclear: 'Unclear',
}

interface Props {
  requiredSkills: string[]
  strengths: string[]
  gaps: string[]
}

export function SkillMatchMatrix({ requiredSkills, strengths, gaps }: Props) {
  if (requiredSkills.length === 0) return null

  const entries = buildSkillMatchMap(requiredSkills, strengths, gaps)

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Required skill match
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {entries.map((entry) => (
          <div
            key={entry.skill}
            className={`rounded-md border px-2 py-1.5 ${STATUS_CLASS[entry.status]}`}
            title={entry.source ?? entry.skill}
          >
            <p className="truncate text-xs font-medium">{entry.skill}</p>
            <p className="text-[10px] opacity-80">{STATUS_LABEL[entry.status]}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
