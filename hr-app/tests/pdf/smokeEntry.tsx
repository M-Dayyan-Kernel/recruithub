/** Renders every report with the fixtures. Bundled and run by buildSmoke.ts, not imported directly. */
import { renderToBuffer } from '@react-pdf/renderer'
import { registerPdfFonts } from '../../src/lib/pdf/fonts.ts'
import { InterviewReport } from '../../src/lib/pdf/reports/InterviewReport.tsx'
import { ScreeningReport } from '../../src/lib/pdf/reports/ScreeningReport.tsx'
import { ShortlistBundle, ShortlistReport } from '../../src/lib/pdf/reports/ShortlistReport.tsx'
import { buildInterviewReportModel } from '../../src/lib/pdf/viewModels/interview.ts'
import { buildScreeningReportModel } from '../../src/lib/pdf/viewModels/screening.ts'
import { buildShortlistBundleModel, buildShortlistReportModel } from '../../src/lib/pdf/viewModels/shortlist.ts'
import {
  ORIGIN,
  REQUIRED_SKILLS,
  screeningFull,
  screeningMinimal,
  shortlistResult,
  interviewClean,
  interviewFull,
  interviewLegacyNoProctoring,
  interviewVideoFailed,
  interviewVideoPending,
} from './fixtures.ts'

const NOW = new Date('2026-10-28T15:49:32Z')
const opts = { origin: ORIGIN, now: NOW, timeZone: 'Asia/Kolkata' }

export async function renderAll() {
  registerPdfFonts()
  const jobs: [string, () => Promise<Buffer>][] = [
    ['interview-full', () => renderToBuffer(<InterviewReport model={buildInterviewReportModel(interviewFull, opts)} />)],
    ['interview-clean-hindi', () => renderToBuffer(<InterviewReport model={buildInterviewReportModel(interviewClean, opts)} />)],
    ['interview-legacy', () => renderToBuffer(<InterviewReport model={buildInterviewReportModel(interviewLegacyNoProctoring, opts)} />)],
    ['interview-pending', () => renderToBuffer(<InterviewReport model={buildInterviewReportModel(interviewVideoPending, opts)} />)],
    ['screening-full', () => renderToBuffer(<ScreeningReport model={buildScreeningReportModel(screeningFull, { candidateName: 'Varshini Rao', phone: '+91 98765 43210', jobTitle: 'Full Stack Developer', attemptNumber: 2, timeZone: 'Asia/Kolkata' }, NOW)} />)],
    ['screening-minimal', () => renderToBuffer(<ScreeningReport model={buildScreeningReportModel(screeningMinimal, {}, NOW)} />)],
    ['shortlist-single', () => renderToBuffer(<ShortlistReport model={buildShortlistReportModel(shortlistResult(2), REQUIRED_SKILLS, { jobTitle: 'Senior Frontend Engineer', timeZone: 'Asia/Kolkata' }, NOW)} />)],
    ['shortlist-bundle', () => renderToBuffer(<ShortlistBundle model={buildShortlistBundleModel([1, 2, 3, 4, 5].map(shortlistResult), REQUIRED_SKILLS, { jobTitle: 'Senior Frontend Engineer', timeZone: 'Asia/Kolkata' }, NOW)} />)],
    ['interview-failed', () => renderToBuffer(<InterviewReport model={buildInterviewReportModel(interviewVideoFailed, opts)} />)],
  ]
  const out: { name: string; buffer: Buffer }[] = []
  for (const [name, render] of jobs) out.push({ name, buffer: await render() })
  return out
}

/** Renders a bundle of `count` candidates and reports how long layout took. */
export async function timeBundle(count: number) {
  registerPdfFonts()
  const results = Array.from({ length: count }, (_, i) => shortlistResult(i + 1))
  const started = Date.now()
  const buffer = await renderToBuffer(<ShortlistBundle model={buildShortlistBundleModel(results, REQUIRED_SKILLS, { jobTitle: 'Senior Frontend Engineer' }, NOW)} />)
  return { ms: Date.now() - started, bytes: buffer.length }
}
