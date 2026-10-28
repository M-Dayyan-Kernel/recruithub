import { Link, StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_FAMILY, TYPE } from '../theme.ts'
import type { InterviewReportModel, QuestionModel } from '../viewModels/interview.ts'
import { PdfDocument } from '../ui/PdfDocument.tsx'
import { PdfPage } from '../ui/PdfPage.tsx'
import { RichText } from '../ui/RichText.tsx'
import { Badge, BulletList, CoverageMark, KeyValueList, MetricTile, ScoreBar, Section, Table } from '../ui/primitives.tsx'
import { ProctoringSection } from './ProctoringSection.tsx'

const s = StyleSheet.create({
  kicker: { fontSize: TYPE.micro, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 },
  name: { fontSize: 20, fontWeight: 700, marginTop: 3, lineHeight: 1.25 },
  role: { fontSize: TYPE.subtitle, color: COLORS.inkMuted, marginTop: 2 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headRight: { alignItems: 'flex-end' },
  meta: { fontSize: TYPE.small, color: COLORS.inkMuted, marginTop: 8 },
  link: { fontSize: TYPE.small, color: COLORS.accent, textDecoration: 'underline', marginTop: 4 },
  muted: { fontSize: TYPE.small, color: COLORS.inkMuted, marginTop: 4 },
  body: { color: COLORS.ink700 },
  two: { flexDirection: 'row', marginTop: 16 },
  col: { flex: 1 },
  colTitle: { fontSize: TYPE.small, fontWeight: 700, color: COLORS.ink700, letterSpacing: 0.5, marginBottom: 6 },
  card: { borderWidth: 0.75, borderColor: COLORS.line, borderRadius: 8, padding: 11, marginBottom: 9, backgroundColor: COLORS.surface },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  qNo: { fontSize: TYPE.small, fontWeight: 700, color: COLORS.accent },
  qScore: { fontFamily: FONT_FAMILY.mono, fontSize: TYPE.small, fontWeight: 500 },
  qText: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.4 },
  pointRow: { flexDirection: 'row', marginTop: 3 },
  answer: { marginTop: 7, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: COLORS.line },
  answerLabel: { fontSize: TYPE.micro, fontWeight: 700, color: COLORS.inkSubtle, letterSpacing: 0.5 },
})

function QuestionCard({ q }: { q: QuestionModel }) {
  return (
    <View style={s.card}>
      {/* The heading stays with the first lines after it, so a card never starts at the foot of a page. */}
      <View wrap={false} minPresenceAhead={110}>
        <View style={s.cardHead}>
          <Text style={s.qNo}>QUESTION {q.number}</Text>
          <Text style={s.qScore}>{q.scoreLabel}</Text>
        </View>
        <RichText style={s.qText}>{q.text}</RichText>
        {q.coverage != null && (
          <View style={{ marginTop: 8 }}>
            <ScoreBar value={q.coverage} tone={q.coverage >= 0.7 ? 'pos' : q.coverage >= 0.4 ? 'warn' : 'neg'} />
            <Text style={s.muted}>{q.coverageLabel}</Text>
          </View>
        )}
      </View>
      {q.points.map((p, index) => (
        <View key={`${index}-${p.text}`} style={s.pointRow} wrap={false}>
          <CoverageMark covered={p.covered} />
          <RichText style={{ flex: 1, fontSize: TYPE.small, color: p.covered ? COLORS.ink : COLORS.inkMuted }}>{p.text}</RichText>
        </View>
      ))}
      {q.answerExcerpt && (
        <View style={s.answer} wrap={false}>
          <Text style={s.answerLabel}>CANDIDATE'S ANSWER</Text>
          <RichText style={{ fontSize: TYPE.small, color: COLORS.ink700, marginTop: 2 }}>{q.answerExcerpt}</RichText>
        </View>
      )}
    </View>
  )
}

/** The interview report, composed from the model. No transcript, by design. */
export function InterviewReport({ model }: { model: InterviewReportModel }) {
  return (
    <PdfDocument title={`${model.candidateName} - ${model.title}`} subject={model.jobTitle ?? undefined}>
      <PdfPage footerTitle={model.footerTitle} footerDate={model.generatedOn}>
        <View style={s.headRow}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={s.kicker}>{model.title.toUpperCase()}</Text>
            <RichText style={s.name}>{model.candidateName}</RichText>
            {model.jobTitle && <RichText style={s.role}>{model.jobTitle}</RichText>}
          </View>
          <View style={s.headRight}>
            {model.recommendation && <Badge text={model.recommendation.label} tone={model.recommendation.tone} />}
            {model.overall && (
              <View style={{ marginTop: 8, width: 130 }}>
                <MetricTile label="Overall score" value={model.overall.label} tone={model.overall.tone} mono fill={false} />
              </View>
            )}
          </View>
        </View>
        <Text style={s.meta}>Generated {model.generatedOn}</Text>
        {model.recording.available ? (
          <Link src={model.recording.url} style={s.link}>
            {model.recording.label} (opens in the Recruitment Hub, sign-in required)
          </Link>
        ) : (
          <Text style={s.muted}>{model.recording.label}</Text>
        )}

        {model.summary && (
          <Section title="Executive summary">
            <RichText style={s.body}>{model.summary}</RichText>
          </Section>
        )}
        {model.jdFit && (
          <Section title="Fit for the role">
            <RichText style={s.body}>{model.jdFit}</RichText>
          </Section>
        )}

        {(model.strengths.length > 0 || model.weaknesses.length > 0) && (
          <View style={s.two} wrap={false}>
            <View style={[s.col, { paddingRight: 14 }]}>
              <Text style={s.colTitle}>STRENGTHS</Text>
              {model.strengths.length > 0 ? (
                <BulletList items={model.strengths} tone="pos" />
              ) : (
                <Text style={s.muted}>None recorded.</Text>
              )}
            </View>
            <View style={s.col}>
              <Text style={s.colTitle}>AREAS TO IMPROVE</Text>
              {model.weaknesses.length > 0 ? (
                <BulletList items={model.weaknesses} tone="neg" />
              ) : (
                <Text style={s.muted}>None recorded.</Text>
              )}
            </View>
          </View>
        )}

        {model.questions.length > 0 ? (
          <>
            <Section title="Score summary">
              <Table
                columns={[
                  { label: '#', width: 22, render: (q) => <Text style={{ fontSize: TYPE.small }}>Q{q.number}</Text> },
                  { label: 'Question', flex: 1, render: (q) => <RichText style={{ fontSize: TYPE.small }}>{q.text}</RichText> },
                  {
                    label: 'Score',
                    width: 58,
                    align: 'right',
                    render: (q) => <Text style={{ fontFamily: FONT_FAMILY.mono, fontSize: TYPE.small }}>{q.scoreLabel}</Text>,
                  },
                  {
                    label: 'Coverage',
                    width: 78,
                    render: (q) =>
                      q.coverage != null ? (
                        <View>
                          <ScoreBar value={q.coverage} tone={q.coverage >= 0.7 ? 'pos' : q.coverage >= 0.4 ? 'warn' : 'neg'} />
                          <Text style={{ fontSize: TYPE.micro, color: COLORS.inkMuted, marginTop: 2 }}>
                            {q.points.filter((p) => p.covered).length}/{q.points.length}
                          </Text>
                        </View>
                      ) : (
                        <Text style={{ fontSize: TYPE.small, color: COLORS.inkSubtle }}>—</Text>
                      ),
                  },
                ]}
                rows={model.questions}
              />
            </Section>
            <Section title="Question details" keepWith={200}>
              {model.questions.map((q) => (
                <QuestionCard key={q.number} q={q} />
              ))}
            </Section>
          </>
        ) : (
          model.legacyScores.length > 0 && (
            <Section title="Score breakdown">
              <KeyValueList rows={model.legacyScores.map((r) => ({ label: r.label, value: r.value }))} />
            </Section>
          )
        )}

        <ProctoringSection model={model.proctoring} />
      </PdfPage>
    </PdfDocument>
  )
}
