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
  ShieldCheck,
  Users,
  X,
  Zap,
  Contact,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { Job } from '@/types/api'
import { filterArchivedJobs } from '@/lib/jobStatus'
import { PHONE_SCREENING_LABEL, RESUME_SCREENING_LABEL } from '@/lib/stageLabels'
import { useAuth } from '@/context/AuthContext'

/**
 * Nav items on the dark rail. The rail's contents are laid out at their full, open width at all
 * times and the rail clips them, so opening is a reveal rather than a reflow: labels never
 * re-wrap while the width animates. The left padding puts every icon's centre at 38px, the
 * middle of the 76px collapsed rail, so icons stay put as it opens.
 */
function navLinkClass(isActive: boolean, collapsed: boolean) {
  return cn(
    'relative flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-lg py-2.5 pl-[17px] pr-3 text-sm font-medium transition-[width,background-color,color] duration-200',
    // Collapsed, the link is only as wide as the visible rail. At full width it would run under
    // the clipped edge, so the active highlight looked cut off, not like a rounded chip.
    collapsed ? 'w-[52px]' : 'w-full',
    isActive
      ? 'bg-accent text-accent-ink shadow-accent'
      : 'text-rail-muted hover:bg-rail-2 hover:text-rail-ink',
  )
}

/** A label that fades out while the rail is collapsed; it is clipped, so it cannot catch a click. */
function RailText({ collapsed, className, children }: { collapsed: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('transition-opacity duration-150', collapsed && 'opacity-0', className)}>{children}</span>
  )
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed?: boolean }) {
  return (
    <div className="relative h-6">
      <p
        className={cn(
          'absolute inset-x-0 bottom-1.5 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-rail-muted/70 transition-opacity duration-150',
          collapsed && 'opacity-0',
        )}
      >
        {children}
      </p>
      <div
        aria-hidden
        className={cn(
          'absolute bottom-2.5 left-[26px] h-px w-6 bg-rail-line transition-opacity duration-150',
          !collapsed && 'opacity-0',
        )}
      />
    </div>
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

const DESKTOP_QUERY = '(min-width: 1024px)'

/** Whether the rail is the desktop one (collapsed until hovered) or the mobile drawer. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Desktop: an icon rail that opens while the pointer (or keyboard focus) is on it and closes
  // when it leaves. No button, nothing to remember. The mobile drawer is always full width.
  const isDesktop = useIsDesktop()
  const [hovered, setHovered] = useState(false)
  const collapsed = isDesktop && !hovered
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
    if (location.pathname === '/extension-check') return 'AI extension check'
    if (location.pathname === '/jobs/new') return 'Create Job'
    if (location.pathname === '/jobs/archived') return 'Archived jobs'
    if (location.pathname.match(/^\/jobs\/[^/]+\/screening/)) return PHONE_SCREENING_LABEL
    if (location.pathname.match(/^\/jobs\/[^/]+\/finalists/)) return 'Finalists'
    if (location.pathname.match(/^\/jobs\/[^/]+\/rejected/)) return 'Rejected'
    if (location.pathname.match(/^\/jobs\/[^/]+\/interviews/)) return 'Interviews'
    if (location.pathname.match(/^\/jobs\/[^/]+\/shortlist/)) return RESUME_SCREENING_LABEL
    if (location.pathname.match(/^\/jobs\/[^/]+$/)) return 'Job details'
    if (location.pathname.startsWith('/report/')) return 'Interview Report'
    if (location.pathname === '/settings') return 'Settings'
    if (location.pathname === '/account') return 'Account'
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
        A floating rail, inset from the viewport rather than flush to it, so the page ground
        runs behind it on all four sides. On desktop the wrapper reserves the collapsed width
        and the rail grows over the page when opened, so the content never shifts under the
        pointer. On mobile the wrapper vanishes and the rail is a drawer.
      */}
      <div className="contents lg:relative lg:m-3 lg:block lg:w-[76px] lg:shrink-0">
        <aside
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false)
          }}
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-60 flex-col overflow-hidden rounded-none bg-rail transition-[width,transform] duration-200',
            'lg:absolute lg:inset-y-0 lg:translate-x-0 lg:rounded-card lg:shadow-e3',
            collapsed ? 'lg:w-[76px]' : 'lg:w-60',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-full w-60 shrink-0 flex-col">
            <div className="flex items-center gap-2.5 border-b border-rail-line px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
                <Zap className="h-[18px] w-[18px] text-accent-ink" />
              </div>
              <div className="min-w-0 flex-1 whitespace-nowrap">
                <RailText collapsed={collapsed} className="block">
                  <span className="block truncate text-sm font-semibold text-rail-ink">Recruitment Hub</span>
                  <span className="block text-[11px] text-rail-muted">HR Portal</span>
                </RailText>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-rail-muted hover:bg-rail-2 hover:text-rail-ink lg:hidden"
                onClick={closeSidebar}
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
              <SectionLabel collapsed={collapsed}>Overview</SectionLabel>
              <div className="space-y-1">
                <NavLink to="/" end onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                  <LayoutDashboard className="h-[18px] w-[18px] shrink-0" />
                  <RailText collapsed={collapsed}>Dashboard</RailText>
                </NavLink>
                <NavLink
                  to="/jobs"
                  end
                  onClick={closeSidebar}
                  className={() => navLinkClass(isJobsNavActive(location.pathname), collapsed)}
                >
                  <Briefcase className="h-[18px] w-[18px] shrink-0" />
                  <RailText collapsed={collapsed}>Jobs</RailText>
                </NavLink>
                <NavLink to="/candidates" onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                  <Contact className="h-[18px] w-[18px] shrink-0" />
                  <RailText collapsed={collapsed}>Candidates</RailText>
                </NavLink>
                {(isAdmin || user?.role === 'hr') && (
                  <NavLink
                    to="/extension-check"
                    onClick={closeSidebar}
                    className={({ isActive }) => navLinkClass(isActive, collapsed)}
                  >
                    <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
                    <RailText collapsed={collapsed}>AI extension check</RailText>
                  </NavLink>
                )}
              </div>
            </nav>

            <div className="space-y-1 border-t border-rail-line px-3 py-3">
              <div>
                <SectionLabel collapsed={collapsed}>Library</SectionLabel>
                <NavLink to="/jobs/archived" onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                  <Archive className="h-[18px] w-[18px] shrink-0" />
                  <RailText collapsed={collapsed} className="flex-1">
                    Archived
                  </RailText>
                  {archivedCount > 0 && (
                    <RailText
                      collapsed={collapsed}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                        location.pathname === '/jobs/archived'
                          ? 'bg-black/20 text-accent-ink'
                          : 'bg-rail-2 text-rail-muted',
                      )}
                    >
                      {archivedCount}
                    </RailText>
                  )}
                </NavLink>
              </div>

              {isAdmin && (
                <div>
                  <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
                  <div className="space-y-1">
                    <NavLink to="/activity" onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                      <Activity className="h-[18px] w-[18px] shrink-0" />
                      <RailText collapsed={collapsed}>Activity</RailText>
                    </NavLink>
                    <NavLink to="/users" onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                      <Users className="h-[18px] w-[18px] shrink-0" />
                      <RailText collapsed={collapsed}>Users</RailText>
                    </NavLink>
                    <NavLink to="/settings" onClick={closeSidebar} className={({ isActive }) => navLinkClass(isActive, collapsed)}>
                      <Settings className="h-[18px] w-[18px] shrink-0" />
                      <RailText collapsed={collapsed}>Settings</RailText>
                    </NavLink>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-rail-line p-3">
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1">
                <NavLink
                  to="/account"
                  title="Account and password"
                  aria-label="Account and password"
                  onClick={closeSidebar}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rail-2 text-[11px] font-semibold text-rail-ink ring-1 ring-rail-line transition-colors hover:ring-rail-muted"
                >
                  {userInitials(user?.full_name, user?.email)}
                </NavLink>
                <div className="min-w-0 flex-1 whitespace-nowrap">
                  <RailText collapsed={collapsed} className="block">
                    <span className="block truncate text-sm font-medium text-rail-ink">{user?.full_name ?? 'User'}</span>
                    <span className="block truncate text-[11px] text-rail-muted">
                      {isActingInTenant && user?.active_tenant_name
                        ? `${user.active_tenant_name} · `
                        : user?.tenant_name
                          ? `${user.tenant_name} · `
                          : ''}
                      <span className="capitalize">{user?.role}</span>
                    </span>
                  </RailText>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="shrink-0 rounded-md p-1.5 text-rail-muted transition-colors hover:bg-rail-2 hover:text-rail-ink"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

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
