import axios, { type AxiosError } from 'axios'
import { QueryClient } from '@tanstack/react-query'
import type { PaginatedResponse } from '@/types/api'

export const DEFAULT_LIST_LIMIT = 200

/** Unwrap list endpoints that may return a bare array or paginated envelope. */
export function unwrapPaginated<T>(
  data: T[] | PaginatedResponse<T> | null | undefined,
): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.items)) return data.items
  return []
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const AUTH_TOKEN_KEY = 'hr_access_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  timeout: 30_000,
})

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: unknown }).msg)
        }
        return JSON.stringify(item)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return 'An unexpected error occurred'
}

// Request interceptor — attach JWT + Content-Type
api.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (!(config.data instanceof FormData)) {
    config.headers['Content-Type'] = config.headers['Content-Type'] ?? 'application/json'
  }
  return config
})

// Response interceptor — unwrap data, normalise errors, redirect on 401
api.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError<{ detail?: unknown; message?: string }>) => {
    if (error.response?.status === 401) {
      const url = error.config?.url ?? ''
      const isAuthEndpoint = url.includes('/api/auth/login')
      if (!isAuthEndpoint) {
        setStoredToken(null)
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
      }
    }

    const detail =
      error.response?.data?.detail ??
      error.response?.data?.message ??
      error.message

    const message =
      error.code === 'ERR_NETWORK'
        ? `Cannot reach API at ${api.defaults.baseURL}. Is the backend running?`
        : formatApiErrorDetail(detail)

    return Promise.reject(new Error(message))
  },
)

// ---------------------------------------------------------------------------
// TanStack Query client
// ---------------------------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,       // 30 seconds
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
