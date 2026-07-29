"""End-to-end tests for talentOS integration internal endpoints."""
from __future__ import annotations

import uuid
from typing import AsyncGenerator

import httpx
import pytest
import pytest_asyncio

BASE_URL = "http://localhost:8080"
API_KEY = "rhub_test_integration_key_abc123"


@pytest.mark.asyncio
async def test_full_flow():
    """Create job → create candidate → trigger screening → verify result."""
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

    # 1. Create a job
    job_payload = {
        "title": "Senior Software Engineer",
        "description": "We need a senior backend engineer with Python experience.",
        "required_skills": ["Python", "FastAPI", "PostgreSQL"],
        "location": "Bangalore",
        "department": "Engineering",
        "employment_type": "full-time",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs",
            json=job_payload,
            headers=headers,
        )
        assert resp.status_code == 201, f"Create job failed: {resp.text}"
        job = resp.json()
        job_id = job["id"]
        assert job["title"] == "Senior Software Engineer"
        assert job["status"] == "active"

        # Verify description includes location/department/type
        assert "Location: Bangalore" in job["description"]
        assert "Department: Engineering" in job["description"]
        assert "Type: full-time" in job["description"]

        # 2. Create a candidate
        cand_payload = {
            "name": "Rahul Sharma",
            "email": "rahul.sharma@example.com",
            "phone": "+919876543210",
        }
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates",
            json=cand_payload,
            headers=headers,
        )
        assert resp.status_code == 201, f"Create candidate failed: {resp.text}"
        candidate = resp.json()
        candidate_id = candidate["id"]
        assert candidate["name"] == "Rahul Sharma"
        assert candidate["email"] == "rahul.sharma@example.com"
        assert candidate["pipeline_status"] == "queued"

        # 3. Trigger screening
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates/{candidate_id}/trigger-screening",
            headers=headers,
        )
        assert resp.status_code == 200, f"Trigger screening failed: {resp.text}"
        screening = resp.json()
        assert screening["status"] == "triggered"
        screening_call_id = screening["screening_call_id"]

        # 4. Verify screening result
        resp = await client.get(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates/{candidate_id}/screening",
            headers=headers,
        )
        assert resp.status_code == 200, f"Get screening result failed: {resp.text}"
        result = resp.json()
        assert result["id"] == screening_call_id
        assert result["call_status"] == "completed"
        assert result["result"] == "pass"
        assert "Screening bypassed" in (result.get("summary") or "")

        # 5. List candidates
        resp = await client.get(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates",
            headers=headers,
        )
        assert resp.status_code == 200
        candidates = resp.json()
        assert len(candidates) == 1
        assert candidates[0]["id"] == candidate_id

        # 6. Duplicate candidate email should fail
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates",
            json=cand_payload,
            headers=headers,
        )
        assert resp.status_code == 409, f"Expected 409 for duplicate, got {resp.status_code}"

        # 7. Duplicate screening should fail
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates/{candidate_id}/trigger-screening",
            headers=headers,
        )
        assert resp.status_code == 409, f"Expected 409 for duplicate, got {resp.status_code}"

        # 8. Trigger interview
        resp = await client.post(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates/{candidate_id}/trigger-interview",
            headers=headers,
        )
        assert resp.status_code == 200, f"Trigger interview failed: {resp.text}"
        interview = resp.json()
        assert interview["status"] == "created"

        # 9. List interviews
        resp = await client.get(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates/{candidate_id}/interviews",
            headers=headers,
        )
        assert resp.status_code == 200
        interviews = resp.json()
        assert len(interviews) == 1

        # 10. Auth test — no API key should return 401
        resp = await client.get(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates",
        )
        assert resp.status_code == 401, f"Expected 401 without auth, got {resp.status_code}"

        # 11. Invalid API key should return 401
        bad_headers = {"Authorization": "Bearer rhub_invalid_key"}
        resp = await client.get(
            f"{BASE_URL}/internal/talentos/jobs/{job_id}/candidates",
            headers=bad_headers,
        )
        assert resp.status_code == 401, f"Expected 401 with bad key, got {resp.status_code}"


if __name__ == "__main__":
    print("Tests written — requires running server on port 8080 with API key seeded.")
    print(f"Seed an API key named 'test-integration' and use key: {API_KEY}")
