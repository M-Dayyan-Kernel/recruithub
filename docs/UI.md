# UI.md — Design System

> Status: **binding reference.** Build from this document rather than inventing a panel.
> If a value is listed here, use it. Do not re-derive it.

This product asks a hiring manager to trust a machine's judgement about a person. The
interface has to look like something that keeps records, not something that guesses. Calm
surfaces, one accent, numbers you can line up and compare.

---

## 1. Tokens

Single source of truth: **`hr-app/src/styles/tokens.css`**, as CSS custom properties,
mapped into Tailwind in `tailwind.config.ts`.

**No raw hex appears in a component. A hex in a component is a bug.** That rule is not
theoretical here: the admin console drifted to a dark emerald theme while every other page
stayed light indigo, purely because its colours were typed inline.

### 1.1 The layers

**Palette** (indigo, ink, paper, line, state) is referenced *only* by the semantic layer.

**Semantic** is what components use, and the only thing they may use:

| Token | Tailwind | Use |
| --- | --- | --- |
| `--bg` | `bg-bg` | Page ground. Never pure white |
| `--surface` | `bg-surface` | Cards, sheets, the thing you read on |
| `--surface-2` / `--surface-3` | `bg-surface-2` | Insets, hovers, quiet fills |
| `--ink` / `--ink-muted` / `--ink-subtle` | `text-ink` | Body, secondary, labels |
| `--line` / `--line-strong` | `border-line` | Hairlines |
| `--accent` + `-hover -ink -soft -border` | `bg-accent` | The one accent. Indigo |
| `--pos` `--warn` `--neg` + `-soft` | `text-pos` | **Status only** |

### 1.2 Radius and elevation

```
--r-sm 8px   --r-md 12px   --r-lg 16px   --r-xl 24px (rounded-card)   --r-full
--elev-1  contact shadow only
--elev-2  contact + soft lift        <- the default card
--elev-3  hover state of a card
--elev-accent  coloured lift, primary actions only
```

Radius tops out at 24px on a large card. Elevation is a 1px contact shadow plus a wide,
soft lift — never a hard drop shadow.

---

## 2. Hard rules

Not preferences. Breaking one breaks the system.

1. **The accent appears at most twice per viewport.** It marks the primary action and the
   active state. A third indigo element means one of the three is wrong.
2. **Green, amber and red are status only** — a verdict, a flag severity, a pipeline state.
   Never a decorative fill, never a button that isn't destructive.
3. **A count of zero is not coloured.** `0 hard flags` in rose draws the eye to the one
   tile with nothing to say. Fall back to the neutral tone.
4. **Every number is `font-mono` + `tabular-nums`** — scores, counts, timestamps,
   durations. Figures that jitter as they update look amateur.
5. **No glass, no neon, no bounce.** Blur is for a scrim over media, not for chrome.
6. **One card primitive.** `components/ui/Surface.tsx`. If you are typing
   `bg-white border rounded-xl shadow-sm`, you are forking the system.
7. **Dark surfaces are for media only** — a video frame, a scrim over a thumbnail. The
   application chrome is light everywhere.

---

## 3. Primitives

`hr-app/src/components/ui/Surface.tsx` is the vocabulary:

- `Card` — the default panel. `interactive` adds the hover lift.
- `PageHeader` — title, subtitle, actions. Every page starts with one.
- `Stat` — icon chip, tabular figure, micro-caps label, `tone`.
- `Badge` / `Dot` — status, toned.
- `BTN_PRIMARY` / `BTN_GHOST` / `BTN_DANGER` / `INPUT` — control classes.

Auth pages have their own shell (`components/auth/AuthLayout.tsx`) because they are
full-bleed and carry no app chrome.

---

## 4. Layout

- Page: `PageHeader`, then a stat row, then content. Consistent across pages.
- Card grids: `gap-4`, `sm:grid-cols-2 lg:grid-cols-4` for stats.
- Content width: `max-w-6xl` for app pages. Auth is full-bleed.
- **Design at 375px first.** Panels that only work at 1440px are not done.
- A fixed-height container plus `min-h-0 flex-1 overflow-y-auto` is how a column scrolls
  internally. `min-h-screen` on the wrapper scrolls the whole page instead, which strands
  pinned headers off-screen.

---

## 5. Evidence UI

Anything that asserts something about a candidate shows where it came from.

- A proctoring flag renders with its **timestamp** and links to that moment.
- A score renders with its **denominator** (`0/25`), never bare.
- An integrity score is labelled as such and states its direction — low is bad, which is
  the inverse of the interview score beside it.
- A null result says so (*"No assessable transcript was recorded"*) rather than rendering
  as a zero that looks like a measurement.
