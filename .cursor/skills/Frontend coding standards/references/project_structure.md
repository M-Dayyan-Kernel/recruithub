# Frontend project structure — feature-first

Organize by feature, not by file type. A feature owns its components, hooks, API
module, and types together, so it's one place to look and deletes cleanly.
Shared primitives live in shared folders. Import via the `@/*` alias (`@/* → src/*`).

```
src/
├── main.tsx                  # entry: mounts App, QueryClientProvider, Router
├── App.tsx                   # route tree (React Router v6), layout, providers
├── lib/
│   ├── api-client.ts         # the ONE configured Axios instance (+ interceptors)
│   ├── query-client.ts       # the QueryClient config
│   └── cn.ts                 # clsx + tailwind-merge helper (see below)
├── components/               # shared, generic, presentational components
│   ├── layout/               # sidebar, header, page shells (per-app theme)
│   └── ...                   # Button, Modal, Table — custom Tailwind, NOT shadcn
├── features/
│   ├── candidates/
│   │   ├── api.ts            # typed endpoint functions for this feature
│   │   ├── types.ts          # request/response + domain interfaces
│   │   ├── queries.ts        # query keys + useQuery/useMutation hooks
│   │   ├── components/       # feature-specific components
│   │   └── pages/            # route-level page components
│   └── auth/                 # (HR) login, token handling, route guard
├── hooks/                    # shared cross-feature hooks
└── routes/                   # route guards / wrappers (e.g. RequireAuth)
```

## Import & layering rules

- **Components call custom hooks, not `useQuery`/`axios` directly.** Data flows:
  component → feature query hook → feature api module → shared `apiClient`.
- **No bare `axios` or `fetch` in components.** Always the typed api module.
- **No server data in `useState`/`useEffect`.** React Query owns it.
- **Shared before feature-local.** If two features need it, it moves to
  `components/`, `hooks/`, or `lib/` — don't cross-import between features.
- **Use the `@/*` alias**, not deep relative paths (`../../../lib/...`).

## The cn() helper (src/lib/cn.ts)

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose class names; tailwind-merge resolves conflicting utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

Use `cn()` for any conditional or merge-prone className. It dedupes conflicting
Tailwind utilities correctly (`cn('px-2', condition && 'px-4')` yields `px-4`),
which raw template strings do not.

```tsx
<button
  className={cn(
    'rounded-md px-4 py-2 text-sm font-medium',
    variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-700',
    disabled && 'cursor-not-allowed opacity-50',
  )}
/>
```

## Component libraries — what NOT to do

There is **no `components/ui/` folder and no shadcn/ui in practice**, despite the
docs mentioning it. Do not scaffold shadcn, do not import from `@/components/ui`.
Build components directly with Tailwind, matching the existing custom component
style. Icons come from `lucide-react`; toasts from `react-hot-toast`.

## Per-app theming

- **HR app** — indigo primary, slate sidebar. Inter font.
- **Candidate app** — dark slate. Inter font.
- Use `tailwindcss-animate` utilities for transitions rather than hand-rolled
  keyframes.

## Providers at the root (main.tsx / App.tsx)

The `QueryClientProvider`, the React Router `BrowserRouter`, and the
`react-hot-toast` `<Toaster />` are mounted once at the root. HR app also mounts
`ReactQueryDevtools`. Don't create per-page QueryClients.
