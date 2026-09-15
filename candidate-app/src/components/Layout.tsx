import { Outlet } from 'react-router-dom'

/**
 * Candidate app layout.
 *
 * Deliberately chrome free: every screen owns its own full bleed background.
 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-page bg-app text-ink">
      <Outlet />
    </div>
  )
}
