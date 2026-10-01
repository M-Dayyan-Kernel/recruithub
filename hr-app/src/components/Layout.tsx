import { useEffect, useState, type ReactNode } from 'react'
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
  Contact,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { filterArchivedJobs } from '@/lib/jobStatus'
import { useAuth } from '@/context/AuthContext'

/**
 * Nav items on the dark rail. Collapsed, the row becomes a centred icon and the
 * label is dropped from the flow rather than hidden with opacity, so it cannot
 * be read by a screen reader or catch a click.
 */
function navLinkClass(isActive: boolean, collapsed: boolean) {
  return cn(
    'relative flex items-center rounded-lg text-sm font-medium transition-colors',
    collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
    isActive
      ? 'bg-accent text-accent-ink shadow-accent'
      : 'text-rail-muted hover:bg-rail-2 hover:text-rail-ink',
  )
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed?: boolean }) {
  if (collapsed) return <div className="mx-auto my-2 h-px w-6 bg-rail-line" />
  return (
    <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-rail-muted/70">
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

const RAIL_KEY = 'hub:rail-collapsed'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Persisted, because a rail that reopens on every navigation is worse than
  // one that never collapsed.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode; the rail just will not remember */
    }
  }, [collapsed])
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
    if (location.pathname === '/candidates' || location.pathname.startsWith('/candidates/')) {
      return 'Candidates'
    }
    if (location.pathname === '/jobs/new') return 'Create Job'
    if (location.pathname === '/jobs/archived') return 'Archived jobs'
    if (location.pathname.match(/^\/jobs\/[^/]+\/screening/)) return 'Screening'
    if (location.pathname.match(/^\/jobs\/[^/]+\/finalists/)) return 'Finalists'
    if (location.pathname.match(/^\/jobs\/[^/]+\/interviews/)) return 'Interviews'
    if (location.pathname.match(/^\/jobs\/[^/]+\/shortlist/)) return 'Resume Screening'
    if (location.pathname.match(/^\/jobs\/[^/]+$/)) return 'Job details'
    if (location.pathname.startsWith('/report/')) return 'Interview Report'
    if (location.pathname === '/settings') return 'Settings'
    if (location.pathname === '/users') return 'Users'
    if (location.pathname === '/activity') return 'Activity'
    return 'Recruitment Hub'
  })()

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/*
        A floating rail, inset from the viewport rather than flush to it, so the
        page ground runs behind it on all four sides.
      */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col rounded-none bg-rail transition-all duration-200',
          'lg:static lg:m-3 lg:translate-x-0 lg:rounded-card lg:shadow-e3',
          collapsed ? 'w-60 lg:w-[76px]' : 'w-60',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cn(
            'flex items-center border-b border-rail-line py-4',
            collapsed ? 'justify-center px-0 lg:px-2' : 'gap-2.5 px-4',
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
            <Zap className="h-[18px] w-[18px] text-accent-ink" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-rail-ink">Recruitment Hub</p>
              <p className="text-[11px] text-rail-muted">HR Portal</p>
            </div>
          )}
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-rail-muted hover:bg-rail-2 hover:text-rail-ink lg:hidden"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="hidden shrink-0 rounded-md p-1 text-rail-muted transition-colors hover:bg-rail-2 hover:text-rail-ink lg:block"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mx-auto mt-3 hidden rounded-md p-1.5 text-rail-muted transition-colors hover:bg-rail-2 hover:text-rail-ink lg:block"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </button>
        )}

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
          <SectionLabel collapsed={collapsed}>Overview</SectionLabel>
          <div className="space-y-1">
            <NavLink
              to="/"
              end
              title={collapsed ? 'Dashboard' : undefined}
              onClick={closeSidebar}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <LayoutDashboard className="h-[18px] w-[18px] shrink-0" />
              {collapsed ? null : 'Dashboard'}
            </NavLink>
            <NavLink
              to="/jobs"
              end
              title={collapsed ? 'Jobs' : undefined}
              onClick={closeSidebar}
              className={() => navLinkClass(isJobsNavActive(location.pathname), collapsed)}
            >
              <Briefcase className="h-[18px] w-[18px] shrink-0" />
              {collapsed ? null : 'Jobs'}
            </NavLink>
            <NavLink
              to="/candidates"
              title={collapsed ? 'Candidates' : undefined}
              onClick={closeSidebar}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <Contact className="h-[18px] w-[18px] shrink-0" />
              {collapsed ? null : 'Candidates'}
            </NavLink>
          </div>
        </nav>

        <div className="space-y-3 border-t border-rail-line px-3 py-3">
          <div>
            <SectionLabel collapsed={collapsed}>Library</SectionLabel>
            <NavLink
              to="/jobs/archived"
              title={collapsed ? 'Archived' : undefined}
              onClick={closeSidebar}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <Archive className="h-[18px] w-[18px] shrink-0" />
              {collapsed ? null : (
                <>
                  <span className="flex-1">Archived</span>
                  {archivedCount > 0 && (
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                        location.pathname === '/jobs/archived'
                          ? 'bg-black/20 text-accent-ink'
                          : 'bg-rail-2 text-rail-muted',
                      )}
                    >
                      {archivedCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </div>

          {isAdmin && (
            <div>
              <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
              <div className="space-y-1">
                <NavLink
                  to="/activity"
                  title={collapsed ? 'Activity' : undefined}
                  onClick={closeSidebar}
                  className={({ isActive }) => navLinkClass(isActive, collapsed)}
                >
                  <Activity className="h-[18px] w-[18px] shrink-0" />
                  {collapsed ? null : 'Activity'}
                </NavLink>
                <NavLink
                  to="/users"
                  title={collapsed ? 'Users' : undefined}
                  onClick={closeSidebar}
                  className={({ isActive }) => navLinkClass(isActive, collapsed)}
                >
                  <Users className="h-[18px] w-[18px] shrink-0" />
                  {collapsed ? null : 'Users'}
                </NavLink>
                <NavLink
                  to="/settings"
                  title={collapsed ? 'Settings' : undefined}
                  onClick={closeSidebar}
                  className={({ isActive }) => navLinkClass(isActive, collapsed)}
                >
                  <Settings className="h-[18px] w-[18px] shrink-0" />
                  {collapsed ? null : 'Settings'}
                </NavLink>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-rail-line p-3">
          <div
            className={cn(
              'flex items-center rounded-lg py-1',
              collapsed ? 'justify-center px-0' : 'gap-2.5 px-1.5',
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rail-2 text-[11px] font-semibold text-rail-ink ring-1 ring-rail-line">
              {userInitials(user?.full_name, user?.email)}
            </div>
            
            {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-rail-ink">
                {user?.full_name ?? 'User'}
              </p>
              <p className="truncate text-[11px] text-rail-muted">
                {isActingInTenant && user?.active_tenant_name
                  ? `${user.active_tenant_name} · `
                  : user?.tenant_name
                    ? `${user.tenant_name} · `
                    : ''}
                <span className="capitalize">{user?.role}</span>
              </p>
            </div>
            )}
            {!collapsed && (
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="shrink-0 rounded-md p-1.5 text-rail-muted transition-colors hover:bg-rail-2 hover:text-rail-ink"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
          {collapsed && (
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="mx-auto mt-2 flex h-9 w-9 items-center justify-center rounded-lg text-rail-muted transition-colors hover:bg-rail-2 hover:text-rail-ink"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isActingInTenant && (
          <div className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-lg bg-gradient-to-r from-warn to-orange-500 px-4 py-2.5 text-[13px] text-white shadow-lg shadow-warn/25">
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              <span className="rounded bg-black/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                Impersonating
              </span>
              Viewing as{' '}
              <strong className="font-bold">{user?.active_tenant_name ?? 'organization'}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                void clearTenantSwitch().then(() => {
                  window.location.assign('/admin')
                })
              }}
              className="shrink-0 rounded-md bg-white/20 px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-white/30"
            >
              Back to platform console
            </button>
          </div>
        )}
        {/*
          Mobile only. On desktop the sidebar already marks the active section
          and every page renders its own PageHeader, so a third copy of the
          title was pure redundancy.
        */}
        <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-6 py-4 lg:hidden">
          <button
            type="button"
            className="text-ink-subtle hover:text-ink"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-semibold text-ink">{pageTitle}</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
