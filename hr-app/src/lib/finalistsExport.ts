import * as XLSX from 'xlsx'
import type { FinalistCandidate } from '@/types/api'
import { exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'

export function downloadFinalistsExcel(jobTitle: string, candidates: FinalistCandidate[]): void {
  const rows = candidates.map((c) => ({
    Name: c.candidate_name ?? '',
    Email: c.email ?? '',
    Phone: c.phone ?? '',
    'Current CTC': c.current_ctc ?? '',
    'Expected CTC': c.expected_ctc ?? '',
    'Years of Experience': c.total_experience_years ?? '',
    'Interview Score': c.report_overall_score ?? '',
    'Hire Recommendation': c.report_recommendation ?? '',
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Finalists')

  const filename = `${slugifyFilename(jobTitle)}-finalists-${exportTimestamp()}.xlsx`
  XLSX.writeFile(workbook, filename)
}
