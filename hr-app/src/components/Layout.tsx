import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Archive,
  Briefcase,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { filterArchivedJobs } from '@/lib/jobStatus'
import { useAuth } from '@/context/AuthContext'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-600 text-white'
      : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100',
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </p>
  )
}

function userInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function isJobsNavActive(pathname: string): boolean {
  if (pathname === '/jobs' || pathname === '/jobs/') return true
  if (pathname === '/jobs/new' || pathname.startsWith('/jobs/new/')) return true
  if (pathname.startsWith('/jobs/') && !pathname.startsWith('/jobs/archived')) return true
  return false
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { user, isAdmin, isActingInTenant, clearTenantSwitch, logout } = useAuth()

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/api/jobs') as unknown as Promise<Job[]>,
  })

  const archivedCount = filterArchivedJobs(jobs ?? []).length
  const closeSidebar = () => setSidebarOpen(false)

  const pageTitle = (() => {
    if (location.pathname === '/') return 'Dashboard'
    if (location.pathname === '/jobs') return 'Jobs'
    if (location.pathname === '/jobs/new') return 'Create Job'
    if (location.pathname === '/jobs/archived') return 'Archived jobs'
    if (location.pathname.match(/^\/jobs\/[^/]+\/screening/)) return 'Screening'
    if (location.pathname.match(/^\/jobs\/[^/]+\/finalists/)) return 'Finalists'
    if (location.pathname.match(/^\/jobs\/[^/]+\/interviews/)) return 'Interviews'
    if (location.pathname.match(/^\/jobs\/[^/]+\/shortlist/)) return 'AI Shortlist'
    if (location.pathname.match(/^\/jobs\/[^/]+$/)) return 'Job details'
    if (location.pathname.startsWith('/report/')) return 'Interview Report'
    if (location.pathname === '/settings') return 'Settings'
    if (location.pathname === '/users') return 'Users'
    if (location.pathname === '/activity') return 'Activity'
    return 'Recruitment Hub'
  })()

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-slate-900 transition-transform duration-200',
          'lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-50">Recruitment Hub</p>
            <p className="text-[11px] text-slate-500">HR Portal</p>
          </div>
          <button
            type="button"
            className="shrink-0 text-slate-500 hover:text-slate-200 lg:hidden"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
          <SectionLabel>Overview</SectionLabel>
          <div className="space-y-0.5">
            <NavLink to="/" end onClick={closeSidebar} className={navLinkClass}>
              <LayoutDashboard className="h-4 w-4 shrink-0 opacity-80" />
              Dashboard
            </NavLink>
            <NavLink
              to="/jobs"
              end
              onClick={closeSidebar}
              className={() => navLinkClass({ isActive: isJobsNavActive(location.pathname) })}
            >
              <Briefcase className="h-4 w-4 shrink-0 opacity-80" />
              Jobs
            </NavLink>
          </div>
        </nav>

        <div className="space-y-3 border-t border-slate-800 px-2.5 py-3">
          <div>
            <SectionLabel>Library</SectionLabel>
            <NavLink to="/jobs/archived" onClick={closeSidebar} className={navLinkClass}>
              <Archive className="h-4 w-4 shrink-0 opacity-80" />
              <span className="flex-1">Archived</span>
              {archivedCount > 0 && (
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    location.pathname === '/jobs/archived'
                      ? 'bg-indigo-500/80 text-white'
                      : 'bg-slate-800 text-slate-400',
                  )}
                >
                  {archivedCount}
                </span>
              )}
            </NavLink>
          </div>

          {isAdmin && (
            <div>
              <SectionLabel>Admin</SectionLabel>
              <div className="space-y-0.5">
                <NavLink to="/activity" onClick={closeSidebar} className={navLinkClass}>
                  <Activity className="h-4 w-4 shrink-0 opacity-80" />
                  Activity
                </NavLink>
                <NavLink to="/users" onClick={closeSidebar} className={navLinkClass}>
                  <Users className="h-4 w-4 shrink-0 opacity-80" />
                  Users
                </NavLink>
                <NavLink to="/settings" onClick={closeSidebar} className={navLinkClass}>
                  <Settings className="h-4 w-4 shrink-0 opacity-80" />
                  Settings
                </NavLink>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-100">
              {userInitials(user?.full_name, user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">
                {user?.full_name ?? 'User'}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {isActingInTenant && user?.active_tenant_name
                  ? `${user.active_tenant_name} · `
                  : user?.tenant_name
                    ? `${user.tenant_name} · `
                    : ''}
                <span className="capitalize">{user?.role}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isActingInTenant && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-teal-800/40 bg-teal-950 px-6 py-2 text-xs text-teal-100">
            <span>
              Viewing as{' '}
              <strong className="font-semibold">{user?.active_tenant_name ?? 'organization'}</strong>
              {' '}(superadmin)
            </span>
            <button
              type="button"
              onClick={() => {
                void clearTenantSwitch().then(() => {
                  window.location.assign('/organizations')
                })
              }}
              className="font-medium text-teal-200 underline-offset-2 hover:underline"
            >
              Back to platform console
            </button>
          </div>
        )}
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
