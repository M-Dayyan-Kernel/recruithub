import type { ReactNode } from 'react'
import { StyleSheet, Svg, Path, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_FAMILY, TONES, TYPE, type Tone } from '../theme.ts'
import { RichText } from './RichText.tsx'

const s = StyleSheet.create({
  sectionWrap: { marginTop: 16 },
  sectionHead: { borderBottomWidth: 0.75, borderBottomColor: COLORS.line, paddingBottom: 4, marginBottom: 8 },
  sectionTitle: { fontSize: TYPE.section, fontWeight: 700, letterSpacing: 0.6, color: COLORS.ink },
  tile: { borderWidth: 0.75, borderColor: COLORS.line, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 7 },
  tileLabel: { fontSize: TYPE.micro, color: COLORS.inkMuted },
  tileValue: { fontSize: 13, fontWeight: 700, marginTop: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2.5 },
  badgeText: { fontSize: 8.5, fontWeight: 700 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: COLORS.surface3 },
  barFill: { height: 5, borderRadius: 3 },
  kvRow: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
  kvLabel: { width: 130, color: COLORS.inkMuted, fontSize: TYPE.small, fontWeight: 600 },
  kvValue: { flex: 1, fontSize: TYPE.body },
  bulletRow: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, marginTop: 5, marginRight: 8 },
  callout: { flexDirection: 'row', borderRadius: 6, borderWidth: 0.75 },
  calloutBar: { width: 3, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  calloutBody: { flex: 1, paddingHorizontal: 10, paddingVertical: 7 },
  th: { flexDirection: 'row', backgroundColor: COLORS.accentSoft, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 6 },
  thText: { fontSize: TYPE.micro, fontWeight: 700, color: COLORS.accent, letterSpacing: 0.4 },
  tr: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
})

/** A titled block. The title never ends a page: it stays with at least the next few lines. */
export function Section({
  title,
  children,
  keepWith = 90,
}: {
  title: string
  children: ReactNode
  /** Space, in points, that must follow the title on the page; raise it when the first block is tall. */
  keepWith?: number
}) {
  return (
    <View style={s.sectionWrap}>
      <View style={s.sectionHead} minPresenceAhead={keepWith}>
        <Text style={s.sectionTitle}>{title.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  )
}

/** A labelled value in a box: a score, a decision, a count. Zero counts should be passed neutral. */
export function MetricTile({
  label,
  value,
  tone = 'neutral',
  mono,
  fill = true,
}: {
  label: string
  value: string
  tone?: Tone
  mono?: boolean
  /** Share the width of a row with its siblings. Turn off for a tile on its own. */
  fill?: boolean
}) {
  const colour = tone === 'neutral' ? COLORS.ink : TONES[tone].fg
  return (
    <View style={[s.tile, fill ? { flex: 1 } : {}]} wrap={false}>
      <Text style={s.tileLabel}>{label}</Text>
      <RichText
        style={[s.tileValue, { color: colour }, mono ? { fontFamily: FONT_FAMILY.mono, fontWeight: 500 } : {}]}
      >
        {value}
      </RichText>
    </View>
  )
}

/** A short status or category pill. Status colours (pos, warn, neg) are for statuses only. */
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const t = TONES[tone]
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      <Text style={[s.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  )
}

/** A horizontal bar filled to a share of 0..1. */
export function ScoreBar({ value, tone = 'accent', width }: { value: number; tone?: Tone; width?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <View style={[s.barTrack, width ? { width } : {}]}>
      <View style={[s.barFill, { width: `${pct}%`, backgroundColor: TONES[tone].fg }]} />
    </View>
  )
}

/** Label and value rows, with no header. Each row stays on one page. */
export function KeyValueList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View>
      {rows.map((row) => (
        <View key={row.label} style={s.kvRow} wrap={false}>
          <Text style={s.kvLabel}>{row.label}</Text>
          <RichText style={s.kvValue}>{row.value}</RichText>
        </View>
      ))}
    </View>
  )
}

/** A list with a coloured dot. The dot colour is the only status colour; the text stays ink. */
export function BulletList({ items, tone = 'neutral' }: { items: string[]; tone?: Tone }) {
  const dot = tone === 'neutral' ? COLORS.inkSubtle : TONES[tone].fg
  return (
    <View>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={s.bulletRow} wrap={false}>
          <View style={[s.bulletDot, { backgroundColor: dot }]} />
          <RichText style={{ flex: 1 }}>{item}</RichText>
        </View>
      ))}
    </View>
  )
}

/** A note on a tinted background with a bar in the tone's colour. */
export function Callout({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const t = TONES[tone]
  return (
    <View style={[s.callout, { backgroundColor: t.bg, borderColor: t.border }]} wrap={false}>
      <View style={[s.calloutBar, { backgroundColor: t.fg }]} />
      <View style={s.calloutBody}>
        {title && <Text style={{ fontSize: TYPE.small, fontWeight: 700, color: t.fg, marginBottom: 2 }}>{title}</Text>}
        {children}
      </View>
    </View>
  )
}

export interface Column<Row> {
  label: string
  width?: number
  flex?: number
  align?: 'left' | 'right' | 'center'
  render: (row: Row) => ReactNode
}

/**
 * A simple table: a tinted header, rows that never split across pages. react-pdf has no table
 * element, and `fixed` repeats on every page of the document, so the header is not repeated on a
 * continuation page. Keep the table short enough that this rarely matters.
 */
export function Table<Row>({ columns, rows }: { columns: Column<Row>[]; rows: Row[] }) {
  const cell = (c: Column<Row>) => ({
    width: c.width,
    flex: c.width ? undefined : (c.flex ?? 1),
    textAlign: c.align,
    paddingRight: 6,
  })
  return (
    <View>
      <View style={s.th} minPresenceAhead={50}>
        {columns.map((c) => (
          <Text key={c.label} style={[s.thText, cell(c)]}>
            {c.label.toUpperCase()}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={s.tr} wrap={false}>
          {columns.map((c) => (
            <View key={c.label} style={cell(c)}>
              {c.render(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

/** A drawn tick or cross, so the mark never depends on a font having the glyph. */
export function CoverageMark({ covered }: { covered: boolean }) {
  const colour = covered ? COLORS.pos : COLORS.neg
  return (
    <Svg width={10} height={10} viewBox="0 0 10 10" style={{ marginTop: 2.5, marginRight: 7 }}>
      {covered ? (
        <Path d="M1.4 5.4 L4 8 L8.6 2.2" stroke={colour} strokeWidth={1.6} fill="none" />
      ) : (
        <Path d="M2 2 L8 8 M8 2 L2 8" stroke={colour} strokeWidth={1.6} fill="none" />
      )}
    </Svg>
  )
}
