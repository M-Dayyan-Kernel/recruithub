# DESIGN-HANDOFF.md — AI Recruitment Screening & Interview POC

**For:** Pixel  
**Mode:** A — Invent from scratch (no external designs provided)  
**Created by:** Goku  
**Date:** 2026-06-19  

---

## Your Mission

Design and build a complete, runnable React prototype for the AI Recruitment Screening & Interview POC. This is Sprint 1. Your output is the gate before any development begins.

---

## Frontend Stack (from SPEC.md)

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Routing | React Router v6 |
| Data | Static stub data (no real API calls) |
| LiveKit (Candidate App only) | `@livekit/components-react` stub (no real LiveKit connection needed in prototype) |

---

## Two Separate Apps

### App 1: HR App
Path: `projects/ai-recruitment-poc/prototype/hr-app/`

This is used by HR to manage the entire recruitment pipeline.

### App 2: Candidate App
Path: `projects/ai-recruitment-poc/prototype/candidate-app/`

This is used by candidates to attend their AI interview via a unique link.

---

## HR App — Screens to Build

### 1. Dashboard / Home
- Summary metrics: Total Jobs, Total Candidates, By Stage (Parsed / Shortlisted / Screened / Interviewed / Assessed)
- Recent activity list (e.g. "Resume uploaded for Job X", "Screening completed for Candidate Y")
- Quick links to active jobs

### 2. Jobs List
- Table of all jobs: Title, Status (Draft/Active/Closed), Candidate Count, Created Date
- "Create New Job" button (opens Create Job modal or page)
- Row click → navigates to Job Detail

### 3. Create Job (Modal or Page)
- Form fields:
  - Job Title (text input)
  - Job Description (textarea, large)
  - Required Skills (tag input — type to add chips)
  - Experience (min/max number inputs)
  - Screening Criteria (textarea)
  - Interview Evaluation Criteria (textarea)
- Save / Cancel buttons

### 4. Job Detail Page
- Job info header (title, status badge, description summary)
- Tabs: **Candidates | Shortlist | Screening | Interviews**

#### Tab: Candidates
- "Upload Resumes" section: drag-and-drop file area + Google Drive URL input
- Candidate cards grid: name, email, parsing status badge (Pending / Parsing / Ready / Failed)
- Click candidate → Candidate Detail modal

#### Tab: Shortlist
- "Run AI Shortlist" button (disabled if candidates still parsing)
- Candidate cards sorted by match score:
  - Score badge (colour-coded: green 80+, yellow 60-79, red <60)
  - Recommendation chip (Shortlist / Reject)
  - Strengths list (2-3 bullets)
  - Gaps list (1-2 bullets)
  - Reason text (1 sentence)
  - Action buttons: Approve / Reject / Override
- Feedback modal (after approve/reject): radio buttons for feedback type + comment box

#### Tab: Screening
- Phone validation warning banner (if any candidates have missing phones)
- "Start AI Screening" button
- Candidate list with screening status: Not Started / Calling / Completed / Failed
- Screening result card (for completed candidates):
  - Pass / Fail / Needs Review badge (colour-coded)
  - Structured fields: Availability, Employment Status, Current CTC, Expected CTC, Notice Period, Location Preference, Communication Quality
  - Summary text
  - "Send Interview Link" button (for Pass candidates only)

#### Tab: Interviews
- List of candidates who received interview links
- Status per candidate: Link Sent / In Progress / Completed / Report Ready
- "View Report" button for completed interviews

### 5. Candidate Detail (Modal)
- Full parsed profile:
  - Name, email, phone
  - Skills chips
  - Experience (list of roles with company + duration)
  - Education
  - Projects / notable work
- Download resume button (stubbed)

### 6. Interview Report Page
- Candidate name + job title header
- Overall Score — large, prominent (e.g. 82/100)
- 5 score bars/dials: Technical Fit, Communication, Problem Solving, Experience, Role Alignment (0-10 each)
- Final Recommendation badge (e.g. "Strong Hire", "Consider", "Reject")
- JD Fit paragraph
- Strengths chips (green)
- Weaknesses chips (orange)
- Interview Summary (paragraph)
- Transcript Summary (collapsible)

---

## Candidate App — Screens to Build

### 1. Interview Landing Page (token page)
- Webknot / Olympus branding
- Candidate's name + job title (from token)
- What to expect: brief instructions (quiet room, stable internet, audio check)
- "Start Interview" button (prominent CTA)
- Invalid token state: friendly error page
- Already completed state: "You've already completed this interview" page

### 2. Interview Room
- LiveKit-style audio/video layout (stub — no real connection needed)
- AI Interviewer visual indicator (animated avatar or waveform — something that feels alive)
- Candidate self-view (stubbed with placeholder)
- Connection status indicator
- Interview question/context area (optional — could be voice-only)
- "End Interview" button
- Timer

### 3. Interview Completion Page
- "Interview Complete 🎉" message
- Thank you message: "Thank you [name], your interview has been submitted. The HR team will be in touch."
- Clean, warm, professional tone

---

## Design Direction

**Vibe:** Professional, modern, clean. This is an enterprise HR tool — not flashy, but not boring either. Think Notion meets Linear. Calm confidence.

**Suggested Palette:**
- Primary: Indigo / deep blue (professional, trustworthy)
- Accent: Emerald green (for Pass / positive states)
- Warning: Amber (for Needs Review / warnings)
- Danger: Rose/red (for Fail / errors)
- Background: Zinc-50 / white
- Sidebar: Dark (slate-900 or indigo-950)

**Typography:** Inter (Tailwind default, clean and readable)

**Components to define in design system:**
- Status badges (Parsing / Ready / Shortlisted / Pass / Fail / Needs Review etc.)
- Score badges (colour-coded by range)
- Candidate cards
- Pipeline stage chips
- Action buttons (primary / secondary / danger)
- Modal shell
- Tabs
- Empty states (no jobs yet, no candidates, no results)
- Loading skeleton

---

## Stub Data to Use

Use realistic fake data so Pranav can review the prototype meaningfully:

**Job example:** "Senior Frontend Engineer" at Webknot — React, TypeScript, 3-5 years experience

**Candidates (5-6):**
- Arjun Sharma — 4 years React, good match
- Priya Nair — 2 years, some gaps
- Rahul Mehta — 6 years, slight over-qualified
- Sneha Patel — 3 years, strong skills match
- Vikram Iyer — 1 year, weak match

**Screening results:** Mix of Pass / Fail / Needs Review
**Interview report:** For Arjun Sharma — Overall 84/100, Strong hire recommendation

---

## Acceptance Criteria (Sprint 1 Gates)

- [ ] All HR App screens built and navigable
- [ ] All Candidate App screens built and navigable
- [ ] Design system defined (colours, typography, spacing tokens in tailwind.config.ts)
- [ ] Both apps run with `npm run dev` without errors
- [ ] HR App navigation between all pages works
- [ ] Candidate App flow works end-to-end (Landing → Room → Completion)
- [ ] DESIGN-NOTES.md written with decisions documented
- [ ] Pranav opens both apps in browser and says "looks good" ← **the actual gate**

---

## Output Locations

```
projects/ai-recruitment-poc/prototype/
├── hr-app/          ← HR Application prototype
├── candidate-app/   ← Candidate Application prototype
└── DESIGN-NOTES.md ← Pixel's design decisions
```

---

*This is Pranav's first Olympus project. Make it count. The prototype is his first real look at what we're building — it should feel exciting and professional.*
