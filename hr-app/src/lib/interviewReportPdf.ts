import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { exportTimestamp, slugifyFilename } from '@/lib/shortlistReportExport'
import { parseTranscript } from '@/lib/transcript'
import type { InterviewReport, InterviewQuestionScore } from '@/types/api'

const PAGE_MARGIN = 14
const CONTENT_WIDTH = 182
const FOOTER_Y = 285

const COLORS = {
  indigo: [79, 70, 229] as [number, number, number],
  indigoLight: [238, 242, 255] as [number, number, number],
  slate: [100, 116, 139] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
  muted: [71, 85, 105] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  cardBg: [248, 250, 252] as [number, number, number],
  emerald: [16, 185, 129] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  rose: [244, 63, 94] as [number, number, number],
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  hold: 'Hold',
  no_hire: 'No Hire',
  needs_review: 'Needs Review',
}

type JsPDFWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } }

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
  doc.setDrawColor(...COLORS.border)
  doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + CONTENT_WIDTH, y + 2)
  return y + 10
}

function measureWrappedText(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  fontSize = 10,
): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  return doc.splitTextToSize(text, maxWidth).length * 5
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize = 10,
  color: [number, number, number] = COLORS.muted,
): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(...color)
  const lines = doc.splitTextToSize(text, maxWidth)
  y = ensureSpace(doc, y, lines.length * 5 + 2)
  doc.text(lines, x, y)
  return y + lines.length * 5
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
  return y + 4
}

function drawPageFooter(doc: jsPDF, pageNumber: number, totalPages: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.slate)
  doc.text(
    `Recruitment Hub · Interview Report · Page ${pageNumber} of ${totalPages}`,
    PAGE_MARGIN,
    FOOTER_Y,
  )
  doc.text(new Date().toLocaleDateString(), PAGE_MARGIN + CONTENT_WIDTH, FOOTER_Y, { align: 'right' })
}

function recommendationColor(rec?: string): [number, number, number] {
  if (rec === 'strong_hire' || rec === 'hire') return COLORS.emerald
  if (rec === 'no_hire') return COLORS.rose
  if (rec === 'hold' || rec === 'needs_review') return COLORS.amber
  return COLORS.slate
}

function drawOverviewTable(
  doc: jsPDF,
  report: InterviewReport,
  candidateName: string,
  rubricTotal: number,
  y: number,
): number {
  const recLabel =
    RECOMMENDATION_LABEL[report.final_recommendation ?? ''] ??
    report.final_recommendation ??
    '—'

  const rows: [string, string][] = [
    ['Candidate', candidateName],
    ...(report.job_title ? [['Role', report.job_title] as [string, string]] : []),
    ['Recommendation', recLabel],
    ...(report.overall_score != null
      ? [['Overall score', `${report.overall_score} / ${rubricTotal}`] as [string, string]]
      : []),
    ['Generated', new Date().toLocaleString()],
  ]

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Field', 'Value']],
    body: rows,
    styles: {
      fontSize: 9,
      cellPadding: 3.5,
      textColor: COLORS.dark,
      lineColor: COLORS.border,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COLORS.indigo,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold', textColor: COLORS.slate },
      1: { cellWidth: 134 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const field = (data.row.raw as [string, string])[0]
      if (field === 'Recommendation' || field === 'Overall score') {
        data.cell.styles.textColor = recommendationColor(report.final_recommendation)
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10
}

function drawQuestionScoresSummary(
  doc: jsPDF,
  questions: InterviewQuestionScore[],
  y: number,
): number {
  const body = questions.map((qs, i) => [
    `Q${i + 1}`,
    qs.question,
    qs.earned_score != null ? String(qs.earned_score) : '—',
    String(qs.score),
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['#', 'Question', 'Earned', 'Max']],
    body,
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
      textColor: COLORS.dark,
      lineColor: COLORS.border,
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLORS.indigo,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 128 },
      2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 18, halign: 'center' },
    },
  })

  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10
}

function drawQuestionCard(
  doc: jsPDF,
  index: number,
  qs: InterviewQuestionScore,
  y: number,
): number {
  const pad = 5
  const innerX = PAGE_MARGIN + pad
  const innerWidth = CONTENT_WIDTH - pad * 2

  let contentHeight = 9
  contentHeight += measureWrappedText(doc, qs.question, innerWidth, 10) + 4

  const hasAnswer = Boolean(qs.candidate_answer?.trim())
  const hasNotes = Boolean(qs.notes?.trim())

  if (hasAnswer) {
    contentHeight += 5 + measureWrappedText(doc, qs.candidate_answer!.trim(), innerWidth - 4, 9) + 4
  }
  if (hasNotes) {
    contentHeight += 5 + measureWrappedText(doc, qs.notes!.trim(), innerWidth - 4, 9) + 2
  }

  const cardHeight = contentHeight + pad
  y = ensureSpace(doc, y, cardHeight + 6)
  const cardTop = y

  doc.setDrawColor(...COLORS.border)
  doc.setFillColor(...COLORS.cardBg)
  doc.roundedRect(PAGE_MARGIN, cardTop, CONTENT_WIDTH, cardHeight, 2, 2, 'FD')

  y = cardTop + pad
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.indigo)
  doc.text(`Question ${index + 1}`, innerX, y)
  doc.text(
    `Score: ${qs.earned_score != null ? qs.earned_score : '—'} / ${qs.score}`,
    PAGE_MARGIN + CONTENT_WIDTH - pad,
    y,
    { align: 'right' },
  )
  y += 9

  y = drawWrappedText(doc, qs.question, innerX, y, innerWidth, 10, COLORS.dark)
  y += 4

  if (hasAnswer) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.slate)
    doc.text('CANDIDATE ANSWER', innerX, y)
    y += 5
    y = drawWrappedText(doc, qs.candidate_answer!.trim(), innerX + 2, y, innerWidth - 4, 9)
    y += 4
  }

  if (hasNotes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COLORS.slate)
    doc.text('ASSESSOR NOTES', innerX, y)
    y += 5
    y = drawWrappedText(doc, qs.notes!.trim(), innerX + 2, y, innerWidth - 4, 9)
  }

  return cardTop + cardHeight + 6
}

function drawTranscriptTurn(
  doc: jsPDF,
  speaker: 'ai' | 'candidate' | 'unknown',
  text: string,
  y: number,
): number {
  const pad = 4
  const innerX = PAGE_MARGIN + pad
  const innerWidth = CONTENT_WIDTH - pad * 2
  const label =
    speaker === 'ai' ? 'Interviewer' : speaker === 'candidate' ? 'Candidate' : 'Transcript'
  const bg = speaker === 'candidate' ? [241, 245, 249] as [number, number, number] : COLORS.indigoLight

  const contentHeight = 7 + measureWrappedText(doc, text, innerWidth - 2, 9)
  const cardHeight = contentHeight + pad
  y = ensureSpace(doc, y, cardHeight + 4)
  const cardTop = y

  doc.setDrawColor(...COLORS.border)
  doc.setFillColor(...bg)
  doc.roundedRect(PAGE_MARGIN, cardTop, CONTENT_WIDTH, cardHeight, 1.5, 1.5, 'FD')

  y = cardTop + pad
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.indigo)
  doc.text(label.toUpperCase(), innerX, y)
  y += 7
  y = drawWrappedText(doc, text, innerX + 1, y, innerWidth - 2, 9, COLORS.dark)

  return cardTop + cardHeight + 4
}

function drawLegacyScoreBreakdown(doc: jsPDF, report: InterviewReport, y: number): number {
  const scoreRows: [string, string][] = []
  const addScore = (label: string, value?: number) => {
    if (value != null) scoreRows.push([label, `${value} / 100`])
  }
  addScore('Technical fit', report.technical_fit_score)
  addScore('Communication', report.communication_score)
  addScore('Problem solving', report.problem_solving_score)
  addScore('Experience', report.experience_score)
  addScore('Role alignment', report.role_alignment_score)

  if (scoreRows.length === 0) return y

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Dimension', 'Score']],
    body: scoreRows,
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: COLORS.dark,
      lineColor: COLORS.border,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COLORS.indigo,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 92, halign: 'center', fontStyle: 'bold' },
    },
  })

  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10
}

export function downloadInterviewReportPdf(report: InterviewReport): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const candidateName = report.candidate_name ?? 'Candidate'
  const rubricTotal = report.rubric_total ?? 100

  let y = PAGE_MARGIN

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...COLORS.indigo)
  doc.text('AI Interview Report', PAGE_MARGIN, y)
  y += 10

  if (report.job_title) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.slate)
    doc.text(report.job_title, PAGE_MARGIN, y)
    y += 8
  }

  y += 4

  // ── Overview ──────────────────────────────────────────────────────────────
  y = drawSectionTitle(doc, 'Overview', y)
  y = drawOverviewTable(doc, report, candidateName, rubricTotal, y)

  // ── Scores ────────────────────────────────────────────────────────────────
  if (report.question_scores && report.question_scores.length > 0) {
    y = drawSectionTitle(doc, 'Score summary', y)
    y = drawQuestionScoresSummary(doc, report.question_scores, y)

    y = drawSectionTitle(doc, 'Question details', y)
    for (let i = 0; i < report.question_scores.length; i += 1) {
      y = drawQuestionCard(doc, i, report.question_scores[i], y)
    }
  } else {
    y = drawSectionTitle(doc, 'Score breakdown', y)
    y = drawLegacyScoreBreakdown(doc, report, y)
  }

  // ── Assessment insights ─────────────────────────────────────────────────────
  const hasInsights =
    (report.strengths?.length ?? 0) > 0 ||
    (report.weaknesses?.length ?? 0) > 0 ||
    Boolean(report.summary?.trim()) ||
    Boolean(report.jd_fit?.trim())

  if (hasInsights) {
    y = drawSectionTitle(doc, 'Assessment insights', y)

    if (report.summary?.trim()) {
      y = ensureSpace(doc, y, 12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.slate)
      doc.text('EXECUTIVE SUMMARY', PAGE_MARGIN, y)
      y += 5
      y = drawWrappedText(doc, report.summary.trim(), PAGE_MARGIN, y, CONTENT_WIDTH)
      y += 6
    }

    if (report.jd_fit?.trim()) {
      y = ensureSpace(doc, y, 12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.slate)
      doc.text('JD FIT', PAGE_MARGIN, y)
      y += 5
      y = drawWrappedText(doc, report.jd_fit.trim(), PAGE_MARGIN, y, CONTENT_WIDTH)
      y += 6
    }

    if (report.strengths && report.strengths.length > 0) {
      y = ensureSpace(doc, y, 12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.slate)
      doc.text('STRENGTHS', PAGE_MARGIN, y)
      y += 5
      y = drawBulletList(doc, report.strengths, y, COLORS.emerald)
    }

    if (report.weaknesses && report.weaknesses.length > 0) {
      y = ensureSpace(doc, y, 12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...COLORS.slate)
      doc.text('AREAS TO IMPROVE', PAGE_MARGIN, y)
      y += 5
      y = drawBulletList(doc, report.weaknesses, y, COLORS.rose)
    }
  }

  // ── Transcript ────────────────────────────────────────────────────────────
  if (report.transcript?.trim()) {
    y = drawSectionTitle(doc, 'Complete interview transcript', y)
    const turns = parseTranscript(report.transcript)
    if (turns.length > 0) {
      for (const turn of turns) {
        y = drawTranscriptTurn(doc, turn.speaker, turn.text, y)
      }
    } else {
      y = drawWrappedText(doc, report.transcript.trim(), PAGE_MARGIN, y, CONTENT_WIDTH)
    }
  } else if (report.transcript_summary?.trim()) {
    y = drawSectionTitle(doc, 'Transcript summary', y)
    y = drawWrappedText(doc, report.transcript_summary.trim(), PAGE_MARGIN, y, CONTENT_WIDTH)
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    drawPageFooter(doc, page, pageCount)
  }

  doc.save(`${slugifyFilename(candidateName)}-interview-report-${exportTimestamp()}.pdf`)
}
