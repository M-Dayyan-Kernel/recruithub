/**
 * Reference: the single typed API layer. All HTTP goes through here —
 * never a bare axios.get / fetch() in a component.
 *
 *   - One configured Axios instance owns baseURL + headers.
 *   - HR app: a request interceptor attaches the JWT Bearer token from
 *     localStorage; a response interceptor clears auth + redirects on 401.
 *   - Every endpoint function returns a TYPED promise (strict mode: no `any`).
 *
 * Path alias: import from '@/lib/api-client', '@/features/.../api', etc.
 */

// ---------------------------------------------------------------------------
// src/lib/api-client.ts  — the shared instance
// ---------------------------------------------------------------------------
import axios, { AxiosError } from 'axios';

// Vite env. HR .env.example says 8000, but INTERFACE.md says use 8080.
const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export const apiClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// --- HR app only: attach JWT from localStorage -----------------------------
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- HR app only: on 401, clear auth and bounce to login -------------------
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      // hard redirect keeps this out of React Router's internals
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// src/features/candidates/types.ts  — explicit types at the boundary
// ---------------------------------------------------------------------------
export interface Candidate {
  id: string;
  name: string;
  email: string;
  status: 'new' | 'screening' | 'shortlisted' | 'rejected';
  score: number | null;
}

export interface CandidateFilters {
  status?: Candidate['status'];
  search?: string;
}

export interface CreateCandidatePayload {
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// src/features/candidates/api.ts  — typed endpoint module
// ---------------------------------------------------------------------------
import { apiClient } from '@/lib/api-client';
import type {
  Candidate,
  CandidateFilters,
  CreateCandidatePayload,
} from './types';

export const candidatesApi = {
  list: async (filters: CandidateFilters): Promise<Candidate[]> => {
    const { data } = await apiClient.get<Candidate[]>('/candidates', {
      params: filters,
    });
    return data;
  },

  getById: async (id: string): Promise<Candidate> => {
    const { data } = await apiClient.get<Candidate>(`/candidates/${id}`);
    return data;
  },

  create: async (payload: CreateCandidatePayload): Promise<Candidate> => {
    const { data } = await apiClient.post<Candidate>('/candidates', payload);
    return data;
  },
};
