import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Archive, LayoutDashboard, Menu, Settings, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarJobsNav } from '@/components/SidebarJobsNav'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { filterArchivedJobs } from '@/lib/jobStatus'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const archivedCount = filterArchivedJobs(jobs ?? []).length

  const pageTitle = (() => {
    if (location.pathname === '/') return 'Dashboard'
    if (location.pathname === '/jobs/new') return 'Create Job'
    if (location.pathname === '/jobs/archived') return 'Archived jobs'
    if (location.pathname.match(/^\/jobs\/[^/]+\/screening/)) return 'Screening'
    if (location.pathname.match(/^\/jobs\/[^/]+\/interviews/)) return 'Interviews'
    if (location.pathname.match(/^\/jobs\/[^/]+\/shortlist/)) return 'AI Shortlist'
    if (location.pathname.match(/^\/jobs\/[^/]+$/)) return 'Job details'
    if (location.pathname.startsWith('/report/')) return 'Interview Report'
    if (location.pathname === '/settings') return 'Settings'
    return 'Recruitment Hub'
  })()

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      <>
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900 transition-transform duration-200',
            'lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-slate-700 px-5 py-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-50">Recruitment Hub</p>
              <p className="text-xs leading-tight text-slate-400">HR Portal</p>
            </div>
            <button
              type="button"
              className="ml-auto text-slate-400 hover:text-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-3 py-4">
            <NavLink
              to="/"
              end
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                )
              }
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              Dashboard
            </NavLink>

            <SidebarJobsNav onNavigate={() => setSidebarOpen(false)} />
          </nav>

          <div className="space-y-1 border-t border-slate-700 px-3 py-3">
            <NavLink
              to="/jobs/archived"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                )
              }
            >
              <Archive className="h-4 w-4 shrink-0" />
              Archived
              {archivedCount > 0 && (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    location.pathname === '/jobs/archived'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-700 text-slate-300',
                  )}
                >
                  {archivedCount}
                </span>
              )}
            </NavLink>

            <NavLink
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              Settings
            </NavLink>
          </div>
        </aside>
      </>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-6 py-4">
          <button
            type="button"
            className="text-slate-500 hover:text-slate-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          <h1 className="truncate text-lg font-semibold text-slate-800">{pageTitle}</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
