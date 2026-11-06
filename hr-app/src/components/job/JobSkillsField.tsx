import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'

export function JobSkillsField({ skills, input, onInputChange, onKeyDown, onAdd, onRemove, disabled }: {
  skills: string[]
  input: string
  onInputChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onAdd: (value: string) => void
  onRemove: (skill: string) => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? skills : skills.slice(0, 7)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="required-skill" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Required skills</label>
        <span aria-live="polite" className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent">{skills.length} {skills.length === 1 ? 'skill' : 'skills'} added</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3.5 py-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
        <Plus size={15} className="shrink-0 text-ink-subtle" aria-hidden />
        <input id="required-skill" type="text" value={input} disabled={disabled}
          onChange={event => onInputChange(event.target.value)} onKeyDown={onKeyDown}
          onBlur={() => { if (input.trim()) onAdd(input) }}
          aria-label="Add required skill" aria-describedby="required-skill-hint"
          placeholder="Type a skill and press Enter…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle disabled:opacity-50" />
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map(skill => (
          <span key={skill} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink">
            <span className="break-words [overflow-wrap:anywhere]">{skill}</span>
            <button type="button" disabled={disabled} onClick={() => onRemove(skill)} aria-label={`Remove ${skill}`}
              className="shrink-0 rounded text-ink-subtle transition-colors hover:text-accent focus-visible:outline-accent disabled:opacity-50"><X size={12} /></button>
          </span>
        ))}
        {skills.length > 7 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
          className="rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs text-ink-muted hover:border-accent-border hover:text-accent">{expanded ? 'Show fewer' : `+ ${skills.length - 7} more`}</button>}
      </div>
      <p id="required-skill-hint" className="text-xs text-ink-subtle">Press Enter or comma to add a skill. These help match candidates to your role.</p>
    </div>
  )
}
