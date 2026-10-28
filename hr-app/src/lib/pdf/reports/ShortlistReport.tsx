import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, TYPE } from '../theme.ts'
import type { ShortlistBundleModel, ShortlistCandidateModel, ShortlistReportModel } from '../viewModels/shortlist.ts'
import { PdfDocument } from '../ui/PdfDocument.tsx'
import { PdfPage } from '../ui/PdfPage.tsx'
import { RichText } from '../ui/RichText.tsx'
import { Badge, BulletList, MetricTile, Section, Table } from '../ui/primitives.tsx'

const s = StyleSheet.create({
  kicker: { fontSize: TYPE.micro, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 },
  name: { fontSize: 20, fontWeight: 700, marginTop: 3, lineHeight: 1.25 },
  role: { fontSize: TYPE.subtitle, color: COLORS.inkMuted, marginTop: 2 },
  email: { fontSize: TYPE.small, color: COLORS.inkMuted, marginTop: 6 },
  tiles: { flexDirection: 'row', marginTop: 14 },
  gap: { width: 8 },
  coverTitle: { fontSize: 24, fontWeight: 700, color: COLORS.accent, marginTop: 30, lineHeight: 1.25 },
  coverMeta: { fontSize: TYPE.small, color: COLORS.inkMuted, marginTop: 6 },
})

/** One candidate's page: scores, required-skill match, strengths, gaps and the AI's assessment. */
function CandidateBody({ candidate, kicker, jobTitle }: { candidate: ShortlistCandidateModel; kicker: string; jobTitle: string | null }) {
  return (
    <View>
      <Text style={s.kicker}>{kicker.toUpperCase()}</Text>
      <RichText style={s.name}>{candidate.name}</RichText>
      {jobTitle && <RichText style={s.role}>{jobTitle}</RichText>}
      {candidate.email && <Text style={s.email}>{candidate.email}</Text>}

      <View style={s.tiles}>
        {candidate.metrics.map((m, index) => (
          <View key={m.label} style={{ flex: 1, flexDirection: 'row' }}>
            {index > 0 && <View style={s.gap} />}
            <MetricTile label={m.label} value={m.value} tone={m.tone} />
          </View>
        ))}
      </View>

      {candidate.skills.length > 0 && (
        <Section title="Required skill match">
          <Table
            columns={[
              { label: 'Skill', flex: 1, render: (r) => <RichText>{r.skill}</RichText> },
              { label: 'Status', width: 80, render: (r) => <Badge text={r.status} tone={r.tone} /> },
            ]}
            rows={candidate.skills}
          />
        </Section>
      )}
      {candidate.strengths.length > 0 && (
        <Section title="Strengths">
          <BulletList items={candidate.strengths} tone="pos" />
        </Section>
      )}
      {candidate.gaps.length > 0 && (
        <Section title="Gaps">
          <BulletList items={candidate.gaps} tone="neg" />
        </Section>
      )}
      {candidate.assessment && (
        <Section title="AI assessment">
          <RichText style={{ color: COLORS.ink700 }}>{candidate.assessment}</RichText>
        </Section>
      )}
    </View>
  )
}

/** The resume-screening report for one candidate. */
export function ShortlistReport({ model }: { model: ShortlistReportModel }) {
  return (
    <PdfDocument title={`${model.candidate.name} - ${model.title}`} subject={model.jobTitle ?? undefined}>
      <PdfPage footerTitle={model.footerTitle} footerDate={model.generatedOn}>
        <CandidateBody candidate={model.candidate} kicker={model.title} jobTitle={model.jobTitle} />
      </PdfPage>
    </PdfDocument>
  )
}

/** A cover page and ranked summary, then one report per candidate, each starting on a new page. */
export function ShortlistBundle({ model }: { model: ShortlistBundleModel }) {
  return (
    <PdfDocument title={model.title} subject={model.jobTitle ?? undefined}>
      <PdfPage footerTitle={model.footerTitle} footerDate={model.generatedOn}>
        <Text style={s.kicker}>RECRUITMENT HUB</Text>
        <Text style={s.coverTitle}>{model.title}</Text>
        {model.jobTitle && <RichText style={{ fontSize: 13, marginTop: 6 }}>{model.jobTitle}</RichText>}
        <Text style={s.coverMeta}>
          Generated {model.generatedOn} · {model.count} candidate{model.count === 1 ? '' : 's'}
        </Text>
        <Section title="Candidates by score">
          <Table
            columns={[
              { label: '#', width: 24, render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.rank}</Text> },
              { label: 'Name', flex: 1.2, render: (r) => <RichText style={{ fontSize: TYPE.small }}>{r.name}</RichText> },
              { label: 'Email', flex: 1.5, render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.email}</Text> },
              { label: 'Score', width: 40, align: 'right', render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.score}</Text> },
              { label: 'AI', width: 62, render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.recommendation}</Text> },
              { label: 'HR', width: 52, render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.decision}</Text> },
            ]}
            rows={model.summary}
          />
        </Section>
      </PdfPage>
      {model.candidates.map((candidate, index) => (
        <PdfPage key={index} footerTitle={model.footerTitle} footerDate={model.generatedOn}>
          <CandidateBody candidate={candidate} kicker="Resume Screening Report" jobTitle={model.jobTitle} />
        </PdfPage>
      ))}
    </PdfDocument>
  )
}
