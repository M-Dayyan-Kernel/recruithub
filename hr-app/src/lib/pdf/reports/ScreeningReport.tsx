import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, TYPE } from '../theme.ts'
import type { ScreeningReportModel } from '../viewModels/screening.ts'
import { PdfDocument } from '../ui/PdfDocument.tsx'
import { PdfPage } from '../ui/PdfPage.tsx'
import { RichText } from '../ui/RichText.tsx'
import { KeyValueList, MetricTile, Section } from '../ui/primitives.tsx'

const s = StyleSheet.create({
  kicker: { fontSize: TYPE.micro, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 },
  name: { fontSize: 20, fontWeight: 700, marginTop: 3, lineHeight: 1.25 },
  role: { fontSize: TYPE.subtitle, color: COLORS.inkMuted, marginTop: 2 },
  meta: { fontSize: TYPE.small, color: COLORS.inkMuted, marginTop: 8 },
  tiles: { flexDirection: 'row', marginTop: 16 },
  gap: { width: 8 },
})

/** The phone-screening report, composed from the model. No call transcript, by design. */
export function ScreeningReport({ model }: { model: ScreeningReportModel }) {
  return (
    <PdfDocument title={`${model.candidateName} - ${model.title}`} subject={model.jobTitle ?? undefined}>
      <PdfPage footerTitle={model.footerTitle} footerDate={model.generatedOn}>
        <Text style={s.kicker}>{model.title.toUpperCase()}</Text>
        <RichText style={s.name}>{model.candidateName}</RichText>
        {model.jobTitle && <RichText style={s.role}>{model.jobTitle}</RichText>}
        {model.meta.length > 0 && <RichText style={s.meta}>{model.meta.join('  ·  ')}</RichText>}

        <View style={s.tiles}>
          {model.metrics.map((m, index) => (
            <View key={m.label} style={{ flex: 1, flexDirection: 'row' }}>
              {index > 0 && <View style={s.gap} />}
              <MetricTile label={m.label} value={m.value} tone={m.tone} />
            </View>
          ))}
        </View>

        {model.summary && (
          <Section title="AI summary">
            <RichText style={{ color: COLORS.ink700 }}>{model.summary}</RichText>
          </Section>
        )}
        {model.details.length > 0 && (
          <Section title="Screening details">
            <KeyValueList rows={model.details} />
          </Section>
        )}
      </PdfPage>
    </PdfDocument>
  )
}
