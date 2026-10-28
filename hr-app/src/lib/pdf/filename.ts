/**
 * File names for downloaded reports. A name written in another script has no ASCII letters, so a
 * plain slug of it is empty: use a stated fallback instead of the old catch-all "export".
 */

/** Lower-case ASCII words joined by dashes, or the fallback when nothing is left. */
export function slug(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return cleaned || fallback
}

export interface ReportFilename {
  /** Who or what the report is about: a candidate or a job. */
  subject: string | null | undefined
  /** Used when the subject has no Latin letters, e.g. "candidate". */
  fallback: string
  /** The kind of report: "interview-report", "screening-report", "shortlist-report". */
  kind: string
  /** A date stamp such as 2026-10-28. */
  stamp: string
}

export function reportFilename({ subject, fallback, kind, stamp }: ReportFilename): string {
  return `${slug(subject, fallback)}-${kind}-${stamp}.pdf`
}
