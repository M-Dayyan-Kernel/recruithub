import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AuthArt from './AuthArt'

/**
 * Shared shell for sign in and sign up.
 *
 * Full bleed on a white page: there is no outer card. The only card is the art
 * panel on the left, inset from the viewport edge. The form sits directly on
 * the page, so nothing frames it twice.
 */
export default function AuthLayout({
  title,
  subtitle,
  switchPrompt,
  switchLabel,
  switchTo,
  children,
}: {
  title: string
  subtitle?: string
  /** The "New organization?" line in the top right. */
  switchPrompt: string
  switchLabel: string
  switchTo: string
  children: ReactNode
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      {/* Art panel - the one card on this page */}
      <aside className="hidden w-1/2 shrink-0 p-5 lg:block">
        <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[28px] bg-gradient-to-br from-[#EEF0FB] via-[#F3F0FA] to-[#E9F5F1] px-10">
          <span
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-20 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-emerald-300/25 blur-3xl"
          />

          <AuthArt />

          <div className="relative mt-10 max-w-[420px] text-center">
            <p className="text-[21px] font-bold leading-snug tracking-tight text-slate-800">
              Hire with evidence, not impressions.
            </p>
            <p className="mt-2.5 text-[14px] leading-relaxed text-slate-500">
              AI-led interviews, proctored end to end and scored against your own rubric.
            </p>
          </div>
        </div>
      </aside>

      {/* Form - no card, straight on the page */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-end px-6 py-7 sm:px-12">
          <p className="text-[13px] text-slate-500">
            {switchPrompt}{' '}
            <Link
              to={switchTo}
              className="font-semibold text-slate-900 underline-offset-4 hover:underline"
            >
              {switchLabel}
            </Link>
          </p>
        </header>

        <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 pb-10 sm:px-12">
          <div className="my-auto w-full max-w-[440px] py-2">
            <h1 className="text-[34px] font-bold leading-none tracking-tight text-slate-900">
              {title}
            </h1>
            {subtitle && <p className="mt-2.5 text-[14px] text-slate-500">{subtitle}</p>}

            <div className="mt-7">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}

/** The filled primary action used by both auth forms. */
export const AUTH_BUTTON_CLASS =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[14px] font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none'

/** Inputs here are taller and rounder than the workflow default. */
export const AUTH_INPUT_CLASS =
  'h-12 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-4 text-[14px] text-slate-800 placeholder:text-slate-400 transition-colors focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100'
