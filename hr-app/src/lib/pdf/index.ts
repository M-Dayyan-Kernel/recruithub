/**
 * The report downloads. The UI imports only this file, and only through `await import('@/lib/pdf')`
 * inside a click handler, so react-pdf and the fonts load when someone asks for a PDF and not
 * before. Each function builds the report's view-model, renders it, and starts the download.
 */
import { createElement } from 'react'
import type {
  InterviewReport as InterviewReportData,
  ScreeningCall,
  ShortlistResultWithCandidate,
} from '../../types/api.ts'
import { downloadPdf, yieldToBrowser } from './download.ts'
import { reportFilename } from './filename.ts'
import { InterviewReport } from './reports/InterviewReport.tsx'
import { ScreeningReport } from './reports/ScreeningReport.tsx'
import { ShortlistBundle, ShortlistReport } from './reports/ShortlistReport.tsx'
import { buildInterviewReportModel } from './viewModels/interview.ts'
import { buildScreeningReportModel, type ScreeningReportOptions } from './viewModels/screening.ts'
import { buildShortlistBundleModel, buildShortlistReportModel } from './viewModels/shortlist.ts'

/** The date stamp in file names: today, in the viewer's own time zone. */
function stamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export async function downloadInterviewReport(report: InterviewReportData): Promise<void> {
  const model = buildInterviewReportModel(report, { origin: window.location.origin })
  await yieldToBrowser()
  await downloadPdf(
    createElement(InterviewReport, { model }),
    reportFilename({ subject: model.candidateName, fallback: 'candidate', kind: 'interview-report', stamp: stamp() }),
  )
}

export async function downloadScreeningReport(call: ScreeningCall, options: ScreeningReportOptions = {}): Promise<void> {
  const model = buildScreeningReportModel(call, options)
  await yieldToBrowser()
  await downloadPdf(
    createElement(ScreeningReport, { model }),
    reportFilename({ subject: model.candidateName, fallback: 'candidate', kind: 'screening-report', stamp: stamp() }),
  )
}

export async function downloadShortlistReport(
  result: ShortlistResultWithCandidate,
  requiredSkills: string[],
  options: { jobTitle?: string } = {},
): Promise<void> {
  const model = buildShortlistReportModel(result, requiredSkills, options)
  await yieldToBrowser()
  await downloadPdf(
    createElement(ShortlistReport, { model }),
    reportFilename({ subject: model.candidate.name, fallback: 'candidate', kind: 'shortlist-report', stamp: stamp() }),
  )
}

export async function downloadShortlistBundle(
  results: ShortlistResultWithCandidate[],
  requiredSkills: string[],
  options: { jobTitle?: string } = {},
): Promise<void> {
  const model = buildShortlistBundleModel(results, requiredSkills, options)
  await yieldToBrowser()
  await downloadPdf(
    createElement(ShortlistBundle, { model }),
    reportFilename({ subject: options.jobTitle, fallback: 'job', kind: 'ai-shortlisted-reports', stamp: stamp() }),
  )
}
