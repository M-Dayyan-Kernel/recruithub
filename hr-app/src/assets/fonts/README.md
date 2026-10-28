# PDF report fonts

Static TTFs for the PDF reports (`src/lib/pdf`). They are imported with `?url` inside the lazily
loaded PDF module, so they download only when someone clicks Download.

| File | Family | Used for |
| --- | --- | --- |
| `Inter-400Regular`, `-500Medium`, `-600SemiBold`, `-700Bold` | Inter | All Latin text (matches the app) |
| `NotoSansDevanagari-400Regular`, `-700Bold` | Noto Sans Devanagari | Hindi and other Devanagari text |
| `JetBrainsMono-400Regular`, `-500Medium` | JetBrains Mono | Scores, counts and times (tabular figures) |

All three families are licensed under the SIL Open Font License 1.1; the texts are in `LICENSES/`.

react-pdf needs **static** fonts (variable fonts are unreliable) and every weight a report uses must be
registered in `src/lib/pdf/fonts.ts`. It has no per-glyph fallback, so text in another script is set
in its own font by `src/lib/pdf/scriptRuns.ts`; to support another script, add its Noto font here,
register it in `fonts.ts`, and teach `scriptRuns.ts` its Unicode range.

## Regenerating the subsets

The files are subset to what the reports print (about 600 KB in all instead of 2 MB). The sources are
the static TTFs in the `@expo-google-fonts/*` npm packages.

```bash
pip install fonttools
LATIN="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+2713,U+2717,U+20B9"
pyftsubset Inter_400Regular.ttf --unicodes="$LATIN" --layout-features='kern,liga,calt,tnum,ccmp,locl,mark,mkmk' --output-file=Inter-400Regular.ttf
# Devanagari: keep every layout feature, or conjuncts and vowel signs stop shaping correctly.
pyftsubset NotoSansDevanagari_400Regular.ttf --unicodes="U+0900-097F,U+200C,U+200D,U+0020-007E,U+00A0,U+2010-2027,U+25CC" --layout-features='*' --output-file=NotoSansDevanagari-400Regular.ttf
pyftsubset JetBrainsMono_400Regular.ttf --unicodes="U+0020-007E,U+2212" --layout-features='kern,tnum,zero' --output-file=JetBrainsMono-400Regular.ttf
```
