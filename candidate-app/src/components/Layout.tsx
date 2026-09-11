import { Outlet } from 'react-router-dom'

/**
 * Candidate app layout.
 *
 * Deliberately chrome free: every screen owns its own full bleed background,
 * light gradient for the pre-flight and result pages, dark for the interview
 * room itself.
 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <Outlet />
    </div>
  )
}
