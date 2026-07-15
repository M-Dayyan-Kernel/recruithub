import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import PlatformLayout from '@/components/PlatformLayout'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

/**
 * Picks platform console vs HR workspace shell for the signed-in user.
 * Superadmin (not acting in a tenant) → PlatformLayout only.
 * Everyone else (including superadmin after Enter) → HR Layout.
 */
export function AppShellRoute() {
  const { isSuperAdmin, isActingInTenant, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
      </div>
    )
  }

  const onPlatform = isSuperAdmin && !isActingInTenant

  if (onPlatform) {
    // Keep superadmin on the platform console — no jobs/dashboard/archived
    if (location.pathname !== '/admin') {
      return <Navigate to="/admin" replace />
    }
    return <PlatformLayout />
  }

  // Acting superadmin or tenant user — block bare /admin (send to jobs)
  if (location.pathname === '/admin') {
    return <Navigate to="/jobs" replace />
  }

  return <Layout />
}

export function AdminRoute() {
  const { isAdmin, isSuperAdmin, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
      </div>
    )
  }

  if (!isAdmin) {
    return <Navigate to={isSuperAdmin ? '/admin' : '/'} replace />
  }

  return <Outlet />
}
