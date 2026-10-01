import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getStoredToken, queryClient, setStoredToken } from '@/lib/api'
import type {
  AcceptInviteRequest,
  LoginRequest,
  SignupPendingResponse,
  SignupRequest,
  TokenResponse,
  User,
} from '@/types/api'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  isSuperAdmin: boolean
  isActingInTenant: boolean
  login: (credentials: LoginRequest) => Promise<User>
  signup: (payload: SignupRequest) => Promise<SignupPendingResponse>
  acceptInvite: (payload: AcceptInviteRequest) => Promise<void>
  switchTenant: (tenantId: string) => Promise<void>
  clearTenantSwitch: () => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setUser(null)
      return
    }
    const me = (await api.get('/api/auth/me')) as unknown as User
    setUser(me)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (getStoredToken()) {
          await refreshUser()
        } else {
          setUser(null)
        }
      } catch {
        if (!cancelled) {
          setStoredToken(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshUser])

  const applyAuth = useCallback((result: TokenResponse) => {
    setStoredToken(result.access_token)
    setUser(result.user)
    queryClient.clear()
  }, [])

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = (await api.post('/api/auth/login', credentials)) as unknown as TokenResponse
      applyAuth(result)
      return result.user
    },
    [applyAuth],
  )

  const signup = useCallback(async (payload: SignupRequest) => {
    const form = new FormData()
    form.append('organization_name', payload.organization_name)
    form.append('full_name', payload.full_name)
    form.append('email', payload.email)
    form.append('password', payload.password)
    if (payload.company_registration_number?.trim()) {
      form.append(
        'company_registration_number',
        payload.company_registration_number.trim(),
      )
    }
    form.append('gst_document', payload.gst_document)
    return (await api.post(
      '/api/auth/signup',
      form,
    )) as unknown as SignupPendingResponse
  }, [])

  const acceptInvite = useCallback(
    async (payload: AcceptInviteRequest) => {
      const result = (await api.post(
        '/api/auth/accept-invite',
        payload,
      )) as unknown as TokenResponse
      applyAuth(result)
    },
    [applyAuth],
  )

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = (await api.post('/api/auth/switch-tenant', {
        tenant_id: tenantId,
      })) as unknown as TokenResponse
      applyAuth(result)
    },
    [applyAuth],
  )

  const clearTenantSwitch = useCallback(async () => {
    const result = (await api.post(
      '/api/auth/clear-tenant-switch',
      {},
    )) as unknown as TokenResponse
    applyAuth(result)
  }, [applyAuth])

  const logout = useCallback(() => {
    setStoredToken(null)
    setUser(null)
    queryClient.clear()
    window.location.assign('/login')
  }, [])

  const isSuperAdmin = user?.role === 'superadmin'
  const isActingInTenant =
    !!isSuperAdmin &&
    !!user?.active_tenant_id &&
    !!user?.home_tenant_id &&
    user.active_tenant_id !== user.home_tenant_id

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin' || isActingInTenant,
      isSuperAdmin: !!isSuperAdmin,
      isActingInTenant,
      login,
      signup,
      acceptInvite,
      switchTenant,
      clearTenantSwitch,
      logout,
      refreshUser,
    }),
    [
      user,
      isLoading,
      isSuperAdmin,
      isActingInTenant,
      login,
      signup,
      acceptInvite,
      switchTenant,
      clearTenantSwitch,
      logout,
      refreshUser,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
