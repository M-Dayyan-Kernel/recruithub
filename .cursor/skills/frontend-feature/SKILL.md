---
name: frontend-feature
description: >-
  Builds and reviews frontend code in the HR app or Candidate app — React 18 +
  TypeScript (strict) + Vite 6, React Router v6, Tailwind, Axios, TanStack React
  Query v5. Enforces typed API layer, React Query for all server state (no
  server data in useState/useEffect), feature-based folders, cn() helper, custom
  Tailwind components (not shadcn), and per-app differences (JWT auth + exports
  for HR, LiveKit for Candidate). Use when adding a page/route, building a
  component, wiring an API call, fetching/displaying data, or reviewing React
  code in these apps. Do not use for backend/FastAPI (use fastapi-feature), pure
  visual exploration with no code, or non-React frontends.
---

# Frontend Feature Standards (HR app + Candidate app)

The goal is that new frontend code is indistinguishable from well-written existing code in these two apps — same stack idioms, same structure, same patterns — so nothing needs a later cleanup pass. Build to the standard from the first line (frontend counterpart to `fastapi-feature`).

The fixed stack is not negotiable per-feature. Don't reach for a different data-fetching library, a different styling approach, or a component kit the project doesn't use. Consistency with the existing codebase beats any individual preference — when in doubt, grep for how it's already done and match it.

## Know which app you're in

The two apps share a stack but differ in ways that change what you write. Establish which one before starting:

- **HR app** — JWT Bearer auth stored in localStorage, React Query Devtools enabled, Playwright E2E tests, PDF export (jsPDF + jspdf-autotable) and Excel export (xlsx). Theme: indigo primary, slate sidebar. Backend default port in `.env.example` is 8000, **but use 8080 per INTERFACE.md**.
- **Candidate app** — LiveKit for video/audio (`livekit-client`, `@livekit/components-react`, `@livekit/components-styles`). Theme: dark slate. `VITE_API_URL` defaults to `http://localhost:8080`.

Both: React 18, TypeScript strict, Vite 6, React Router v6, Tailwind 3 + tailwindcss-animate, Axios, React Query v5, Lucide icons, react-hot-toast, `clsx` + `tailwind-merge` via a `cn()` helper, path alias `@/* → src/*`, Docker (Node build → nginx static serve).

If you can't tell which app from context, ask — the auth, exports, and LiveKit differences make it matter.

## Server state is React Query's job — always

This is the single most important rule and the easiest to violate. **Server data never lives in `useState` + `useEffect`.** Every read from the backend goes through a `useQuery`; every write through a `useMutation` that invalidates the affected queries. No manual loading/error booleans, no `useEffect(() => { fetch()... }, [])`, no storing fetched data in component state.

Why it matters here: React Query v5 gives caching, dedup, background refetch, and `isPending`/`isError`/`isSuccess` states for free, and the codebase already relies on them. Hand-rolling fetch-in-effect produces race conditions, stale data, and waterfalls the rest of the app doesn't have.

The shape to follow:
- **Query keys are structured and centralized** — arrays like `['candidates', filters]`, not ad-hoc strings, so invalidation is precise.
- **Custom hooks wrap queries/mutations** — components call `useCandidates()`, not `useQuery` inline, so the data layer is reusable and testable.
- **Mutations invalidate, they don't hand-patch** — on success, `queryClient.invalidateQueries` the affected keys; reach for optimistic updates only when the UX needs it.

`references/data_fetching.tsx` has the query hook, mutation hook, and query-key patterns.

## The typed API layer

All HTTP goes through one configured Axios instance, never a bare `axios.get` in a component or `fetch()`. That instance owns the `VITE_API_URL` base URL, JSON headers, and — in the HR app — the JWT interceptor that attaches the Bearer token from localStorage and handles 401 by clearing auth and redirecting to login.

Request and response types are explicit TypeScript interfaces (strict mode means no implicit `any`). API functions return typed promises; the query hooks consume them. Never let a response flow untyped into a component. `references/api_layer.ts` shows the Axios instance, the interceptor, and a typed endpoint module.

## Folder structure — feature-first

Organize by feature, not by file type. A `candidates` feature owns its components, hooks, API module, and types together, so a feature is one place to look and delete cleanly. Shared primitives (the `cn()` helper, the Axios instance, generic UI components, layout) live in shared folders. `references/project_structure.md` lays out the tree and the import rules, including the `@/*` alias usage.

Keep components focused: a page component composes; presentational components render; hooks hold logic and data. A component doing fetching, transformation, and rendering all at once is the thing to split.

## Styling: Tailwind + cn(), custom components

- **Compose classes with `cn()`** (the `clsx` + `tailwind-merge` helper) for any conditional or merge-prone className — it dedupes conflicting Tailwind utilities correctly where raw template strings don't. Import it from the shared utils path.
- **These are custom Tailwind components, not shadcn/ui.** The docs mention shadcn but there is no `components/ui/` folder in practice — do not scaffold shadcn or import from `@/components/ui`. Build components directly with Tailwind, matching the existing component style.
- **Respect each app's theme** — indigo/slate for HR, dark slate for Candidate — and the Inter font. Use `tailwindcss-animate` for animation utilities rather than hand-rolled keyframes.
- **Icons are Lucide React**; **toasts are react-hot-toast** — use these, not alternatives, for consistency.

## Loading, error, and empty states are part of the feature

Because React Query hands you `isPending` / `isError` / `data`, there's no excuse for a component that only renders the happy path. Every data-driven view handles:
- **Loading** — a skeleton or spinner, not a blank screen.
- **Error** — a readable message (and a toast via react-hot-toast where an action failed), never a silent failure or a raw thrown error.
- **Empty** — an intentional empty state when `data` is an empty list, not a bare table with no rows.

Mutations surface success and failure to the user (toast on save/delete), and disable their trigger while `isPending` to prevent double-submits.

## TypeScript strict — no escape hatches

Strict mode is on. No `any` (use `unknown` + narrowing if a type is truly open), no non-null `!` to silence the compiler where a real check belongs, no `@ts-ignore` without a comment justifying it. Props get explicit interfaces. API payloads get explicit types. This is what keeps the two apps refactorable.

## Per-app specifics to get right

- **HR auth** — token in localStorage, attached by the Axios interceptor; 401 clears and redirects. Guard authenticated routes with a wrapper, don't check auth ad-hoc in each page.
- **HR exports** — PDF via jsPDF + jspdf-autotable, Excel via xlsx. Keep export logic in a dedicated util/hook per export, not inline in a button handler, so it's testable and reusable.
- **HR tests** — new user-facing flows get a Playwright E2E where it's reasonable; match the existing test structure.
- **Candidate LiveKit** — use `@livekit/components-react` and the LiveKit styles; manage room connection lifecycle carefully (connect/disconnect on mount/unmount) and handle permission-denied and connection-failure states as first-class, since they're common.

`references/hr_auth_and_exports.tsx` has the route guard and both export utilities; `references/candidate_livekit.tsx` has the LiveKit token query, room lifecycle, and error/permission states.

## How to deliver

Work in reviewable units. For a feature:
1. Name the app, the feature folder, and the query/mutation hooks you'll add — in a sentence or two — before writing code.
2. Show the new/changed files, matching existing conventions (grep first if unsure how something's done).
3. Confirm loading/error/empty states are handled and server state goes through React Query.
4. Flag anything skipped (a missing E2E, an unhandled edge) so the user decides.

Keep prose tight — let the code and reference files carry the weight; reserve commentary for trade-offs the user needs to weigh in on.
