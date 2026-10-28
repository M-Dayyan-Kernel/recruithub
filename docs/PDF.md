# PDF reports

The HR app builds its PDFs in the browser with `@react-pdf/renderer`: the interview report, the phone
screening report, and the resume-screening (shortlist) report, single and bulk. Everything lives in
`hr-app/src/lib/pdf/`. The look follows `docs/UI.md`; `theme.ts` copies the product tokens as hex, and
`tests/pdfTheme.test.ts` fails if they drift from `src/styles/tokens.css`.

## Map

```
src/lib/pdf/
  index.ts                     the only file the UI imports: downloadInterviewReport, downloadScreeningReport,
                               downloadShortlistReport, downloadShortlistBundle
  limits.ts                    how many candidates one bulk PDF may hold (and when to warn)
  download.ts  fonts.ts        render to a Blob and download it; register the fonts once
  theme.ts  format.ts          colours/type scale; dates (en-IN day-month-year) and numbers
  filename.ts  scriptRuns.ts   file names (non-Latin fallback); split text by writing system
  viewModels/                  API data -> plain objects: all wording, tones, caps and branching
    interview.ts  proctoring.ts  screening.ts  shortlist.ts
  ui/                          layout primitives: PdfDocument, PdfPage, Section, MetricTile, Badge,
                               ScoreBar, KeyValueList, BulletList, Callout, Table, CoverageMark, RichText
  reports/                     the documents: InterviewReport, ScreeningReport, ShortlistReport, ShortlistBundle
src/lib/reportLabels.ts        recommendation/decision wording shared with the CSV export
src/lib/proctoringFlags.ts     hard/soft flag counting shared with the Report page
src/assets/fonts/              the fonts (see its README)
```

**The rule:** `viewModels/`, `format.ts`, `filename.ts`, `scriptRuns.ts` and `theme.ts` are pure. They
use relative `.ts` imports and no JSX, so `node --test` can load them (the `@/` alias does not resolve
under node). `ui/` and `reports/` only lay out what a view-model gives them: no branching on raw API data.

## What the reports do and do not contain

- The **interview report** never includes the transcript. It has the recommendation, score, a link to
  the recording, the summary and JD fit, strengths and gaps, per-question scores with coverage and an
  answer excerpt, and a proctoring section (video verdict and flags, browser-extension checks).
- The recording link points at the **report page in the HR app** (`/jobs/{job}/candidates/{candidate}/report`),
  which needs a login, and never at the storage URL (that expires in an hour and has no access control).
- The proctoring section never prints the recording URL or key, the raw analysis error, extension ids,
  heuristic scores or policy mode. A failed analysis reads only "The recording could not be analysed."
  A scan that was not recorded is never described as clear. Green, amber and red are used only for the
  verdict and flag severity.
- The **screening report** has no call transcript either.

## Adding a report

1. Add a view-model in `viewModels/` that turns the data into labels, tones and lists. Test it in `tests/`.
2. Compose a document in `reports/` from the `ui/` primitives.
3. Export a `download…` function from `index.ts` and call it from the UI as
   `const { downloadX } = await import('@/lib/pdf')` inside the click handler, with a busy state and a toast.

## Page-break rules (react-pdf)

- A unitless `lineHeight` is resolved against the font size on the same node, not the inherited one:
  `RichText` always sets both. Do not put `lineHeight` on the page.
- `Section` keeps its title with the content after it (`keepWith`); raise it when the first block is tall.
- Rows, bullets and coverage points use `wrap={false}`; a question card is allowed to split, but its
  heading, text and bar stay together.
- `fixed` repeats on **every** page, so a table header cannot be repeated per table: keep tables short.
- react-pdf has no per-glyph font fallback and no table element. Text goes through `RichText`, which gives
  Devanagari its own font.

## Tests

- `npm test` runs the pure tests and `tests/pdfRender.test.ts`, which bundles `tests/pdf/smokeEntry.tsx`
  with esbuild and renders every report from `tests/pdf/fixtures.ts` in Node. `PDF_SMOKE_KEEP=1` keeps the
  PDFs in `node_modules/.cache/pdf-smoke/kept/` to open and look at.
- `e2e/pdf-download.spec.ts` downloads the PDFs in Chromium and checks the library and fonts load only
  on click.

## Notes

- Layout runs on the main thread, at about 30 ms per candidate (Node): a bulk export warns above 50
  candidates and stops at 200 (`limits.ts`). A Web Worker is the next step if that is not enough.
- The library and fonts are a separate lazy chunk (about 470 KB gzipped plus roughly 600 KB of fonts);
  the page itself does not load them.
