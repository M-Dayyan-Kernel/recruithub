import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_FAMILY, TONES, TYPE, type Tone } from '../theme.ts'
import type { ProctoringModel, VerdictTone, VideoSection } from '../viewModels/proctoring.ts'
import { Badge, Callout, MetricTile, Section, Table } from '../ui/primitives.tsx'
import { RichText } from '../ui/RichText.tsx'

const toneOf: Record<VerdictTone, Tone> = { neutral: 'neutral', ok: 'pos', warn: 'warn', danger: 'neg' }

const s = StyleSheet.create({
  card: { borderWidth: 0.75, borderRadius: 8, padding: 12 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdictLabel: { fontSize: TYPE.micro, color: COLORS.inkMuted, letterSpacing: 0.5 },
  verdict: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  scoreBox: { alignItems: 'flex-end' },
  score: { fontFamily: FONT_FAMILY.mono, fontSize: 16, fontWeight: 500 },
  note: { fontSize: TYPE.small, color: COLORS.inkMuted },
  tiles: { flexDirection: 'row', marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  chip: { borderRadius: 10, backgroundColor: COLORS.surface3, paddingHorizontal: 8, paddingVertical: 2.5, marginRight: 5, marginBottom: 4 },
  chipText: { fontSize: TYPE.micro, color: COLORS.inkMuted, fontWeight: 600 },
  subTitle: { fontSize: TYPE.small, fontWeight: 700, color: COLORS.ink700, marginTop: 12, marginBottom: 5 },
  extRow: { borderBottomWidth: 0.5, borderBottomColor: COLORS.line, paddingVertical: 6 },
  extName: { fontWeight: 600 },
  extMeta: { fontSize: TYPE.small, color: COLORS.inkMuted },
})

const gap = { width: 8 }

function VideoBlock({ video }: { video: VideoSection }) {
  if (video.state !== 'ready') {
    return (
      <Callout tone="neutral" title={video.state === 'failed' ? 'Video analysis failed' : 'Video analysis'}>
        <Text style={{ fontSize: TYPE.small, color: COLORS.ink700 }}>{video.message}</Text>
      </Callout>
    )
  }
  const tone = toneOf[video.tone]
  const t = TONES[tone]
  return (
    <View>
      <View style={[s.card, { backgroundColor: t.bg, borderColor: t.border }]} wrap={false}>
        <View style={s.verdictRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.verdictLabel}>INTERVIEW INTEGRITY</Text>
            <RichText style={[s.verdict, { color: t.fg }]}>{video.verdict}</RichText>
          </View>
          {video.score != null && (
            <View style={s.scoreBox}>
              <Text style={[s.score, { color: t.fg }]}>{Math.round(video.score)}/100</Text>
              <Text style={[s.note, { maxWidth: 150, textAlign: 'right' }]}>{video.scoreNote}</Text>
            </View>
          )}
        </View>
        <View style={s.tiles}>
          <MetricTile label="Hard flags" value={String(video.hardCount)} tone={video.hardCount > 0 ? 'neg' : 'neutral'} mono />
          <View style={gap} />
          <MetricTile label="Soft flags" value={String(video.softCount)} tone={video.softCount > 0 ? 'warn' : 'neutral'} mono />
          <View style={gap} />
          <MetricTile label="Analysed" value={video.durationLabel ?? '—'} mono />
          {video.frameCount != null && (
            <>
              <View style={gap} />
              <MetricTile label="Frames" value={video.frameCount.toLocaleString('en-IN')} mono />
            </>
          )}
        </View>
        {video.breakdown.length > 0 && (
          <View style={s.chips}>
            {video.breakdown.map((b) => (
              <View key={b.label} style={s.chip}>
                <Text style={s.chipText}>
                  {b.label} {b.value}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {video.flags.length > 0 && (
        <View>
          <Text style={s.subTitle} minPresenceAhead={80}>
            Detections ({video.detections})
          </Text>
          <Table
            columns={[
              { label: 'Time', width: 56, render: (r) => <Text style={{ fontFamily: FONT_FAMILY.mono, fontSize: TYPE.small }}>{r.time}</Text> },
              { label: 'Event', flex: 1, render: (r) => <RichText style={{ fontSize: TYPE.small }}>{r.event}</RichText> },
              {
                label: 'Severity',
                width: 56,
                render: (r) => <Badge text={r.severity} tone={r.severity === 'Hard' ? 'neg' : 'warn'} />,
              },
              { label: 'Confidence', width: 60, align: 'right', render: (r) => <Text style={{ fontSize: TYPE.small }}>{r.confidence ?? '—'}</Text> },
            ]}
            rows={video.flags}
          />
          {video.flagsOmitted > 0 && (
            <Text style={[s.note, { marginTop: 5 }]}>
              Showing {video.flags.length} of {video.flags.length + video.flagsOmitted} detections. The rest are on the Report page.
            </Text>
          )}
        </View>
      )}
    </View>
  )
}

function ExtensionBlock({ model }: { model: ProctoringModel }) {
  const ext = model.extension
  if (ext.state === 'not_recorded') {
    return (
      <Callout tone="neutral" title="Browser extension checks">
        <Text style={{ fontSize: TYPE.small, color: COLORS.ink700 }}>{ext.message}</Text>
      </Callout>
    )
  }
  const tone = toneOf[ext.tone]
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }} minPresenceAhead={60}>
        <Text style={{ fontSize: TYPE.small, fontWeight: 700, color: COLORS.ink700, marginRight: 8 }}>Browser extension checks</Text>
        <Badge text={`Latest: ${ext.label}`} tone={tone} />
      </View>
      <RichText style={{ marginTop: 5, fontSize: TYPE.small, color: COLORS.ink700 }}>{ext.message}</RichText>
      {ext.extras.map((line) => (
        <Text key={line} style={{ marginTop: 3, fontSize: TYPE.small, color: COLORS.inkMuted }}>
          {line}
        </Text>
      ))}
      {ext.items.map((item) => (
        <View key={item.name} style={s.extRow} wrap={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <RichText style={s.extName}>{item.name}</RichText>
            {item.blocked && <Badge text="Blocked the start" tone="neg" />}
          </View>
          <Text style={s.extMeta}>{item.reason}</Text>
          {item.signals.length > 0 && <Text style={s.extMeta}>{item.signals.join(' · ')}</Text>}
          {item.firstSeen && <Text style={s.extMeta}>First seen at: {item.firstSeen}</Text>}
        </View>
      ))}
    </View>
  )
}

/** The proctoring verdict and the browser-extension check, restated for a reader of the PDF. */
export function ProctoringSection({ model }: { model: ProctoringModel }) {
  return (
    <Section title="Proctoring and integrity" keepWith={230}>
      <Text style={[s.note, { marginBottom: 8 }]}>{model.reviewNote}</Text>
      <VideoBlock video={model.video} />
      <View style={{ marginTop: 14 }}>
        <ExtensionBlock model={model} />
      </View>
      <Text style={[s.note, { marginTop: 10, fontSize: TYPE.micro }]}>{model.disclaimer}</Text>
    </Section>
  )
}

