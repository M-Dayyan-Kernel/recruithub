import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Menu, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Jobs',      to: '/jobs', icon: Briefcase },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Derive page title from current route
  const pageTitle = (() => {
    if (location.pathname === '/') return 'Dashboard'
    if (location.pathname.startsWith('/jobs/')) return 'Job Detail'
    if (location.pathname === '/jobs') return 'Jobs'
    if (location.pathname.startsWith('/report/')) return 'Interview Report'
    return 'Recruitment Hub'
  })()

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Sidebar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <>
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex flex-col w-64 bg-slate-900 transition-transform duration-200',
            // Desktop: always visible
            'lg:static lg:translate-x-0',
            // Mobile: slide in/out
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {/* Logo / branding */}
          <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-700">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-50 leading-tight">Recruitment Hub</p>
              <p className="text-xs text-slate-400 leading-tight">HR Portal</p>
            </div>
            {/* Mobile close button */}
            <button
              className="ml-auto text-slate-400 hover:text-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
            {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800',
                  )
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-700">
            <p className="text-xs text-slate-500">Powered by Olympus ⚡</p>
          </div>
        </aside>
      </>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-4 px-6 py-4 bg-white border-b border-zinc-200 shrink-0">
          {/* Mobile hamburger */}
          <button
            className="text-slate-500 hover:text-slate-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Page title slot */}
          <h1 className="text-lg font-semibold text-slate-800 truncate">{pageTitle}</h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
