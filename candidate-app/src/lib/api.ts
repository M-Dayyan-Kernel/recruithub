import axios, { type AxiosError } from 'axios'
import { QueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

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
  (error: AxiosError<{ detail?: string; message?: string }>) => {
    const detail =
      error.response?.data?.detail ??
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
