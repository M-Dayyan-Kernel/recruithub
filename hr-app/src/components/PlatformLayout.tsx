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
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">Platform Console</p>
              <p className="text-[11px] text-slate-500">Organization management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <Building2 className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs text-slate-400">Superadmin</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold">
                {userInitials(user?.full_name, user?.email)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">
                  {user?.full_name ?? 'Superadmin'}
                </p>
                <p className="truncate text-[10px] text-slate-500">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
                className="ml-1 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
