import axios, { type AxiosError } from 'axios'
import { QueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  timeout: 30_000,
})

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

// Request interceptor — set Content-Type
// Skip for FormData: axios computes multipart/form-data + boundary automatically
api.interceptors.request.use((config) => {
  if (!(config.data instanceof FormData)) {
    config.headers['Content-Type'] = config.headers['Content-Type'] ?? 'application/json'
  }
  return config
})

// Response interceptor — unwrap data, normalise errors
api.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError<{ detail?: unknown; message?: string }>) => {
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
