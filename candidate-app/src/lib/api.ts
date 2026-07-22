import axios, { type AxiosError } from 'axios'
import { QueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  code?: string
  data?: Record<string, unknown>

  constructor(message: string, code?: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

export function isInterviewCapacityError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'interview_capacity_full'
}

export function getRetryAfterMinutes(err: unknown, fallback = 45): number {
  if (err instanceof ApiError) {
    const value = err.data?.retry_after_minutes
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return fallback
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8080',
  timeout: 30_000,
})

// Request interceptor — set Content-Type
api.interceptors.request.use((config) => {
  config.headers['Content-Type'] = config.headers['Content-Type'] ?? 'application/json'
  return config
})

// Response interceptor — unwrap data, normalise errors
api.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError<{ detail?: string | Record<string, unknown>; message?: string }>) => {
    const rawDetail = error.response?.data?.detail
    if (rawDetail && typeof rawDetail === 'object') {
      const detail = rawDetail as Record<string, unknown>
      const message =
        typeof detail.message === 'string'
          ? detail.message
          : 'An unexpected error occurred'
      const code = typeof detail.code === 'string' ? detail.code : undefined
      return Promise.reject(new ApiError(message, code, detail))
    }

    const detail =
      (typeof rawDetail === 'string' ? rawDetail : undefined) ??
      error.response?.data?.message ??
      error.message ??
      'An unexpected error occurred'

    return Promise.reject(new Error(detail))
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
