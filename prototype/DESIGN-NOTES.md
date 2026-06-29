# DESIGN-NOTES.md — AI Recruitment POC Prototype
*Pixel 🎨 | Sprint 1 | 2026-06-19*

---

## Design System

### Colour Palette
- **Primary:** Indigo (`indigo-600` / `#4f46e5`) — trustworthy, professional
- **Sidebar:** Slate-900 (`#0f172a`) — dark, authoritative
- **Pass / Positive:** Emerald-600 (`#059669`)
- **Fail / Danger:** Rose-600 (`#e11d48`)
- **Needs Review / Warning:** Amber-600 (`#d97706`)
- **Background:** Zinc-50 (`#fafafa`) — light, clean
- **Cards:** White with `border-zinc-200`

### Typography
- **Font:** Inter (Google Fonts) — clean, highly legible at small sizes
- **Scale:** Tailwind defaults (text-xs through text-2xl)

### Component Conventions
- **Badges:** Pill-shaped, colour-coded by semantic meaning
- **Cards:** White background, `rounded-xl`, `border-zinc-200`, subtle hover shadow
- **Buttons:** Rounded-lg, solid fill for primary actions, ghost for secondary
- **Score bars:** Colour-coded (emerald ≥80%, amber ≥60%, rose <60%)
- **Modals:** Centered overlay, `rounded-2xl`, max-w-xl/2xl

---

## HR App — Screens Built

1. **Dashboard** — metrics grid (6 KPIs), active jobs list, recent activity feed
2. **Jobs List** — table with status badges, create job modal with full form
3. **Job Detail** — 4-tab layout:
   - **Candidates tab** — drag-drop upload area + Drive link input + candidate cards with parsing status
   - **Shortlist tab** — "Run AI Shortlist" CTA → scored cards with approve/reject/override + feedback modal
   - **Screening tab** — phone validation warning + "Start Screening" + result cards with all structured fields
   - **Interviews tab** — interview status tracking + "View Report" link
4. **Candidate Detail Modal** — full parsed profile (skills, experience timeline, education)
5. **Interview Report Page** — overall score (large), 5 score bars, strengths/weaknesses, JD fit, summary, collapsible transcript

## Candidate App — Screens Built

1. **Interview Landing** — branded welcome, candidate name + job title, pre-interview checklist, CTA
2. **Invalid Token** — friendly error state for bad/expired links  
3. **Interview Room** — AI avatar with animated waveform, live transcript panel, mute control, end interview button + confirmation modal
4. **Interview Complete** — success state with thank-you message + Webknot/Olympus branding

---

## Design Decisions

### HR App dark sidebar
Chose slate-900 sidebar to create clear visual hierarchy — the sidebar is navigation infrastructure, the content area is the workspace. This is the "Linear/Notion" pattern.

### Candidate App dark theme
The interview room is an intense, focused experience. Dark theme reduces eye strain and creates a more "professional interview" feel vs. a bright form. Keeps the candidate focused on the AI interaction.

### Stub data choices
Used realistic Indian candidate profiles (Arjun Sharma, Priya Nair, Rahul Mehta, Sneha Patel, Vikram Iyer, Divya Krishnan) with real-feeling CTC numbers, notice periods, and companies (Razorpay, Swiggy, Flipkart, etc.) so Pranav can evaluate the UX with familiar context.

### No shadcn/ui dependency
Chose to build components from scratch with Tailwind rather than adding shadcn/ui as a dependency. Reasons:
- Avoids shadcn CLI interactive setup issues in automated scaffolding
- Full control over component styling — no overrides needed
- Prototype is lighter and faster to run
- Nova can add shadcn properly when building the real app in Sprint 2+

### Score display
Used horizontal bars instead of radial gauges — cleaner, more accessible, easier to compare across candidates at a glance.

### Phone validation UX
Added an amber warning banner in the Screening tab that surfaces missing phone numbers before HR tries to start screening. HR can edit inline. This matches the SPEC requirement exactly.

---

## Known Gaps (for Nova in Sprint 2+)

- No real API integration (all stub data)
- No TanStack Query setup — will be added in Sprint 2
- shadcn/ui components not used — Nova should introduce them properly in Sprint 2
- LiveKit room is fully stubbed — real LiveKit integration is Sprint 6
- No toast notification system — will be added in Sprint 2
- Mobile responsiveness not fully optimised (HR app is desktop-first, as expected for an HR tool)

---

## How to Run

```bash
# HR App — http://localhost:5173
cd projects/ai-recruitment-poc/prototype/hr-app
npm run dev

# Candidate App — http://localhost:5174
cd projects/ai-recruitment-poc/prototype/candidate-app
npm run dev

# Demo interview links:
# http://localhost:5174/interview/demo-token-arjun  (Arjun Sharma)
# http://localhost:5174/interview/demo-token-sneha  (Sneha Patel)
# http://localhost:5174/interview/bad-token          (invalid token state)
```
