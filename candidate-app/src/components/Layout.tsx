import { Outlet } from 'react-router-dom'

/**
 * Candidate App Layout
 *
 * Minimal, full-screen dark layout optimised for the interview experience.
 * No sidebar — the interview room occupies the full viewport.
 */
export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Subtle branded header — stays out of the way */}
      <header className="flex items-center justify-center py-4 border-b border-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-400 tracking-wide">
          Webknot · AI Interview
        </span>
      </header>

      {/* Full-screen content area */}
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
