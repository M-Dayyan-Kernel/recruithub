import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { buildSkillMatchMap, type SkillMatchEntry } from '@/lib/skillMatch'
import { exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'
import type { ShortlistResultWithCandidate } from '@/types/api'

const PAGE_MARGIN = 14
const CONTENT_WIDTH = 182
const FOOTER_Y = 285

const COLORS = {
  indigo: [79, 70, 229] as [number, number, number],
  slate: [100, 116, 139] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
  matched: [5, 150, 105] as [number, number, number],
  gap: [225, 29, 72] as [number, number, number],
  unclear: [100, 116, 139] as [number, number, number],
  emerald: [16, 185, 129] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  rose: [244, 63, 94] as [number, number, number],
}

const SKILL_STATUS_LABEL: Record<SkillMatchEntry['status'], string> = {
  matched: 'Matched',
  gap: 'Gap',
  unclear: 'Unclear',
}

function formatRecommendation(rec: ShortlistResultWithCandidate['recommendation']): string {
  if (rec === 'shortlisted') return 'Shortlisted'
  if (rec === 'rejected') return 'Rejected'
  return 'Review'
}

function formatHrDecision(decision: ShortlistResultWithCandidate['hr_decision']): string {
  if (decision === 'pending') return 'Pending'
  if (decision === 'approved') return 'Approved'
  if (decision === 'rejected') return 'Rejected'
  return 'Overridden'
}

function scoreColor(score: number): [number, number, number] {
  if (score >= 70) return COLORS.emerald
  if (score >= 50) return COLORS.amber
  return COLORS.rose
}

function skillStatusColor(status: SkillMatchEntry['status']): [number, number, number] {
  if (status === 'matched') return COLORS.matched
  if (status === 'gap') return COLORS.gap
  return COLORS.unclear
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > FOOTER_Y - 10) {
    doc.addPage()
    return PAGE_MARGIN + 8
  }
  return y
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  y = ensureSpace(doc, y, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.dark)
  doc.text(title.toUpperCase(), PAGE_MARGIN, y)
  doc.setDrawColor(226, 232, 240)
  doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + CONTENT_WIDTH, y + 2)
  return y + 10
}

function drawBulletList(
  doc: jsPDF,
  items: string[],
  y: number,
  bulletColor: [number, number, number],
): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.dark)

  for (const item of items) {
    const lines = doc.splitTextToSize(item, CONTENT_WIDTH - 8)
    y = ensureSpace(doc, y, lines.length * 5 + 4)
    doc.setFillColor(...bulletColor)
    doc.circle(PAGE_MARGIN + 2, y - 2.5, 1.2, 'F')
    doc.text(lines, PAGE_MARGIN + 8, y)
    y += lines.length * 5 + 3
  }
  return y
}

function drawWrappedParagraph(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH)
  y = ensureSpace(doc, y, lines.length * 5 + 4)
  doc.text(lines, PAGE_MARGIN, y)
  return y + lines.length * 5 + 6
}

function drawPageFooter(doc: jsPDF, pageNumber: number, totalPages: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.slate)
  doc.text(`Recruitment Hub · AI Shortlist Report · Page ${pageNumber} of ${totalPages}`, PAGE_MARGIN, FOOTER_Y)
  doc.text(new Date().toLocaleDateString(), PAGE_MARGIN + CONTENT_WIDTH, FOOTER_Y, { align: 'right' })
}

function renderCandidateReport(
  doc: jsPDF,
  result: ShortlistResultWithCandidate,
  requiredSkills: string[],
  options?: { jobTitle?: string; isFirstPage?: boolean },
): void {
  if (!options?.isFirstPage) {
    doc.addPage()
  }

  let y = PAGE_MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...COLORS.indigo)
  doc.text('AI Shortlist Report', PAGE_MARGIN, y)

  if (options?.jobTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.slate)
    doc.text(options.jobTitle, PAGE_MARGIN, y + 8)
    y += 8
  }
  y += 14

  const name = result.candidate_name ?? 'Candidate'
  const email = result.candidate_email ?? '—'

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(PAGE_MARGIN, y - 6, CONTENT_WIDTH, 22, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLORS.dark)
  doc.text(name, PAGE_MARGIN + 4, y + 2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.slate)
  doc.text(email, PAGE_MARGIN + 4, y + 10)
  y += 24

  const metrics = [
    { label: 'Match Score', value: `${Math.round(result.match_score)}%`, color: scoreColor(result.match_score) },
    { label: 'AI Recommendation', value: formatRecommendation(result.recommendation), color: COLORS.indigo },
    { label: 'HR Decision', value: formatHrDecision(result.hr_decision), color: COLORS.slate },
  ]

  const metricWidth = CONTENT_WIDTH / 3
  metrics.forEach((metric, index) => {
    const x = PAGE_MARGIN + index * metricWidth
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, y, metricWidth - 4, 24, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.slate)
    doc.text(metric.label, x + 4, y + 8)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...metric.color)
    doc.text(metric.value, x + 4, y + 18)
  })
  y += 32

  const strengths = result.strengths ?? []
  const gaps = result.gaps ?? []
  const skillEntries = buildSkillMatchMap(requiredSkills, strengths, gaps)

  if (skillEntries.length > 0) {
    y = drawSectionTitle(doc, 'Required Skill Match', y)
    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [['Skill', 'Status']],
      body: skillEntries.map((entry) => [entry.skill, SKILL_STATUS_LABEL[entry.status]]),
      styles: {
        fontSize: 9,
        cellPadding: 3,
        textColor: COLORS.dark,
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: COLORS.indigo,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 62 },
      },
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index !== 1) return
        const status = skillEntries[data.row.index]?.status
        if (!status) return
        data.cell.styles.textColor = skillStatusColor(status)
        data.cell.styles.fontStyle = 'bold'
      },
    })
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  if (strengths.length > 0) {
    y = drawSectionTitle(doc, 'Strengths', y)
    y = drawBulletList(doc, strengths, y, COLORS.matched)
    y += 4
  }

  if (gaps.length > 0) {
    y = drawSectionTitle(doc, 'Gaps', y)
    y = drawBulletList(doc, gaps, y, COLORS.gap)
    y += 4
  }

  if (result.reason) {
    y = drawSectionTitle(doc, 'AI Assessment', y)
    drawWrappedParagraph(doc, result.reason, y)
  }
}

export function downloadShortlistReportPdf(
  result: ShortlistResultWithCandidate,
  requiredSkills: string[],
  options?: { jobTitle?: string },
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  renderCandidateReport(doc, result, requiredSkills, { ...options, isFirstPage: true })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    drawPageFooter(doc, page, pageCount)
  }

  const name = slugifyFilename(result.candidate_name ?? 'candidate')
  doc.save(`${name}-shortlist-report-${exportTimestamp()}.pdf`)
}

export function downloadAllShortlistReportsPdf(
  results: ShortlistResultWithCandidate[],
  requiredSkills: string[],
  options?: { jobTitle?: string },
): void {
  const sorted = [...results].sort((a, b) => b.match_score - a.match_score)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...COLORS.indigo)
  doc.text('AI Shortlist Export', PAGE_MARGIN, 30)

  if (options?.jobTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(13)
    doc.setTextColor(...COLORS.dark)
    doc.text(options.jobTitle, PAGE_MARGIN, 42)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COLORS.slate)
  doc.text(`Generated: ${new Date().toLocaleString()}`, PAGE_MARGIN, 52)
  doc.text(`Candidates: ${sorted.length}`, PAGE_MARGIN, 59)

  autoTable(doc, {
    startY: 68,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['#', 'Name', 'Email', 'Score', 'Recommendation', 'HR Decision']],
    body: sorted.map((result, index) => [
      String(index + 1),
      result.candidate_name ?? '—',
      result.candidate_email ?? '—',
      `${Math.round(result.match_score)}%`,
      formatRecommendation(result.recommendation),
      formatHrDecision(result.hr_decision),
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: COLORS.dark,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COLORS.indigo,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 38 },
      2: { cellWidth: 52 },
      3: { cellWidth: 18 },
      4: { cellWidth: 30 },
      5: { cellWidth: 28 },
    },
  })

  sorted.forEach((result) => {
    renderCandidateReport(doc, result, requiredSkills, {
      jobTitle: options?.jobTitle,
      isFirstPage: false,
    })
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    drawPageFooter(doc, page, pageCount)
  }

  const baseName = slugifyFilename(options?.jobTitle ?? 'job')
  doc.save(`${baseName}-ai-shortlisted-reports-${exportTimestamp()}.pdf`)
}
