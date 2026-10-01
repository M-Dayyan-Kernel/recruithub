import type { ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  /** Optional count shown as a pill beside the label. */
  count?: number | null
  /** Tints the count pill when the tab carries something to worry about. */
  tone?: 'default' | 'danger'
}

/**
 * Underlined tab bar. Purely presentational - the active id and its setter live
 * in the page, so a tab can be deep-linked or restored later without changing
 * this component.
 */
export default function Tabs({
  tabs,
  active,
  onChange,
  right,
}: {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
  /** Optional trailing content, e.g. an export button. */
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={on ? 'page' : undefined}
            className={`relative -mb-px inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              on ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {/* Gradient underline, glowing while active */}
            <span
              aria-hidden
              className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-opacity ${
                on
                  ? 'bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 opacity-100 shadow-[0_0_8px_rgba(99,102,241,0.6)]'
                  : 'bg-slate-300 opacity-0'
              }`}
            />
            {t.label}
            {t.count != null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  t.tone === 'danger'
                    ? 'bg-rose-100 text-rose-700'
                    : on
                      ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/30'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
      {right && <div className="ml-auto pb-1.5">{right}</div>}
    </div>
  )
}
