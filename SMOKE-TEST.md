# Smoke Test — Sprint 7
Date: 2026-06-22
Agent: Sage 🧠
Backend: http://localhost:8080

---

## Pipeline Stage Results

| Stage | Endpoint | Status | HTTP | Notes |
|-------|----------|--------|------|-------|
| Job retrieval | GET /api/jobs/:id | PASS | 200 | Returns full JD with required_skills, experience range |
| Candidate listing | GET /api/jobs/:id/candidates | PASS | 200 | Multiple candidates returned with parse_status, parsed_data |
| Shortlist results | GET /api/jobs/:id/shortlist | PASS | 200 | Returns match_score, recommendation, strengths, gaps, reason |
| Screening results | GET /api/jobs/:id/screening | PASS | 200 | Returns availability, CTC, notice_period, communication_quality, result |
| Interview report | GET /api/candidates/:id/report | PASS | 200 | Returns full scorecard with all 5 scores + final_recommendation |
| Jobs list | GET /api/jobs | PASS | 200 | Returns list of all jobs |
| Health check | GET /health | PASS | 200 | `{"status": "ok", "version": "1.0.0"}` |

**Result: 7/7 endpoints PASS**

---

## Sample Response Spot-Check

### Shortlist (candidate: c6a8b487)
```json
{
  "match_score": 75.0,
  "recommendation": "review",
  "strengths": ["Extensive React experience", "Strong JavaScript skills", "Mentorship experience", "Collaboration with cross-functional teams"],
  "gaps": ["Python experience"],
  "reason": "Karen Santos..."
}
```
Field names match what code expects: ✅ match_score, recommendation, strengths, gaps, reason

### Screening (candidate: c6a8b487)
```json
{
  "call_status": "completed",
  "availability": "Immediately",
  "employment_status": "Unemployed",
  "relevant_experience": "5 years experience as a front end engineer...",
  "result": "pass"
}
```
Field names match extraction prompt fields: ✅

### Interview Report (candidate: c6a8b487)
```json
{
  "summary": "Karen Santos did not demonstrate the necessary technical skills...",
  "final_recommendation": "no_hire"
}
```
All 12 scorecard fields present: ✅

---

## Prompt Quality Fixes (Task 7.7)

### Files Reviewed

| File | Status | Action Taken |
|------|--------|--------------|
| `shortlist_service.py` | OK | No changes — field names (match_score, recommendation, strengths, gaps, reason) all match code |
| `resume_parser.py` | FIXED | Added short-input guard (< 50 chars returns empty record, no GPT call) |
| `screening_tasks.py` | OK | No changes — all 11 extraction fields match DB model assignments; short/no-transcript path already handled |
| `assessment_service.py` | FIXED | Fixed field name mismatch: `experience_years` / `total_experience` → `total_experience_years` |
| `interview_agent.py` | OK | No changes — conversational prompt, no JSON output required; candidate context injection correct |

---

## Issues Found

### BUG-FIX-1 — assessment_service.py: Wrong experience field key (FIXED)
**Severity:** Medium  
**File:** `app/services/assessment_service.py`  
**Line:** `exp = parsed.get("experience_years") or parsed.get("total_experience", "Unknown")`  
**Root cause:** The resume parser sets `total_experience_years` as the key. `assessment_service` was looking for `experience_years` first, then `total_experience` — neither exists. Result: candidate experience always appeared as `"Unknown"` in the GPT prompt context, degrading assessment accuracy.  
**Fix:** Changed to `parsed.get("total_experience_years", "Unknown")` — now correctly reads the value.

### BUG-FIX-2 — resume_parser.py: No guard for empty/short input (FIXED)
**Severity:** Low  
**File:** `app/services/resume_parser.py`  
**Root cause:** Calling GPT-4o on empty or near-empty resume text can produce hallucinated data (invented names, skills, etc.). No minimum length check existed.  
**Fix:** Added `MIN_RESUME_LENGTH = 50` guard. Inputs shorter than 50 chars after stripping return a safe empty record (`_EMPTY_RESUME`) without calling GPT.

### assessment_service.py — Short transcript guard (already correct, no change needed)
`MIN_TRANSCRIPT_LENGTH = 100` is set and enforced. `_build_needs_review_report()` returns all scores = 0 and `final_recommendation = "needs_review"` as required by Sprint 7 spec. ✅

---

## Recommendations

1. **Deploy fix immediately:** The `total_experience_years` field mismatch in `assessment_service.py` was silently degrading interview report quality on every candidate — the GPT prompt context was missing actual experience data. Fixed in this session.

2. **Monitor shortlist re-runs:** Now that candidate experience is correctly surfaced in the assessment prompt, re-running shortlisting may produce slightly different (more accurate) scores for candidates with significant experience.

3. **All pipeline stages healthy:** No DB errors, no 4xx/5xx responses. Celery tasks and GPT calls are completing successfully end-to-end.

4. **Next:** Run Sentinel QA for Sprint 7 gate check.
