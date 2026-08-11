/**
 * Reference: server state via TanStack React Query v5. The rule that matters:
 * server data NEVER lives in useState + useEffect. Reads = useQuery, writes =
 * useMutation that invalidates. Components call custom hooks, not useQuery
 * inline.
 *
 *   - Query keys are structured arrays, centralized, so invalidation is precise.
 *   - Custom hooks wrap the queries/mutations (reusable, testable).
 *   - Mutations invalidate affected keys on success (no hand-patching cache).
 *   - Components render loading / error / empty / data — every one of them.
 */

// ---------------------------------------------------------------------------
// src/features/candidates/queries.ts  — centralized query keys + hooks
// ---------------------------------------------------------------------------
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { candidatesApi } from './api';
import type { CandidateFilters, CreateCandidatePayload } from './types';

// Structured keys — one place, so invalidation targets exactly what changed.
export const candidateKeys = {
  all: ['candidates'] as const,
  list: (filters: CandidateFilters) =>
    [...candidateKeys.all, 'list', filters] as const,
  detail: (id: string) => [...candidateKeys.all, 'detail', id] as const,
};

// --- read: list -------------------------------------------------------------
export function useCandidates(filters: CandidateFilters) {
  return useQuery({
    queryKey: candidateKeys.list(filters),
    queryFn: () => candidatesApi.list(filters),
  });
}

// --- read: one --------------------------------------------------------------
export function useCandidate(id: string) {
  return useQuery({
    queryKey: candidateKeys.detail(id),
    queryFn: () => candidatesApi.getById(id),
    enabled: Boolean(id), // don't fire until we have an id
  });
}

// --- write: create, then invalidate the lists ------------------------------
export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCandidatePayload) =>
      candidatesApi.create(payload),
    onSuccess: () => {
      // invalidate, don't hand-patch the cache
      queryClient.invalidateQueries({ queryKey: candidateKeys.all });
      toast.success('Candidate added');
    },
    onError: () => {
      toast.error('Could not add candidate');
    },
  });
}

// ---------------------------------------------------------------------------
// src/features/candidates/components/CandidateList.tsx  — consuming the hook
// ---------------------------------------------------------------------------
import type { CandidateFilters } from '../types';
import { useCandidates } from '../queries';

export function CandidateList({ filters }: { filters: CandidateFilters }) {
  const { data, isPending, isError } = useCandidates(filters);

  // loading — a skeleton/spinner, never a blank screen
  if (isPending) return <CandidateListSkeleton />;

  // error — readable, never a silent failure
  if (isError) {
    return (
      <p className="text-sm text-red-600">
        Couldn&apos;t load candidates. Try again.
      </p>
    );
  }

  // empty — intentional, not a bare empty table
  if (data.length === 0) {
    return <EmptyState message="No candidates match these filters." />;
  }

  // data
  return (
    <ul className="divide-y divide-slate-200">
      {data.map((c) => (
        <li key={c.id} className="py-3">
          {c.name} — {c.status}
        </li>
      ))}
    </ul>
  );
}

// placeholders (built as real custom Tailwind components in the app)
function CandidateListSkeleton() {
  return <div className="animate-pulse space-y-2">{/* ... */}</div>;
}
function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-slate-500">{message}</p>;
}
