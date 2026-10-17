import { Building2, LogOut, Shield } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

function userInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

/** Dedicated shell for platform superadmin — no HR jobs/dashboard nav. */
export default function PlatformLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      {/*
        A floating dark bar, matching the HR rail so the two shells read as one
        product. Only real controls live here: no decorative bell or search for
        features that do not exist.
      */}
      <header className="px-3 pt-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-card bg-rail px-4 py-3 shadow-e3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
              <Shield className="h-[18px] w-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight text-rail-ink">
                Platform Console
              </p>
              <p className="truncate text-[11px] text-rail-muted">Organization management</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full bg-rail-2 px-3 py-1.5 text-[12px] font-medium text-rail-muted ring-1 ring-rail-line sm:inline-flex">
              <Building2 className="h-3.5 w-3.5" />
              Superadmin
            </span>

            <div className="flex items-center gap-2.5 rounded-full bg-rail-2 py-1.5 pl-1.5 pr-1.5 ring-1 ring-rail-line">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white">
                {userInitials(user?.full_name, user?.email)}
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-[13px] font-semibold leading-tight text-rail-ink">
                  {user?.full_name ?? 'Superadmin'}
                </p>
                <p className="truncate text-[11px] leading-tight text-rail-muted">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rail-muted transition-colors hover:bg-white/10 hover:text-rail-ink"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
        <Outlet />
      </main>
    </div>
  )
}
