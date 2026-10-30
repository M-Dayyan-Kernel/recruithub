"""JobService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError as PydanticValidationError

from app.exceptions import ConflictError, ValidationError
from app.models.models import User
from app.schemas.schemas import (
    INTERVIEW_SCORE_MAX,
    INTERVIEW_SCORE_MIN,
    InterviewQuestionPublic,
    JobCreate,
    JobUpdate,
)
from app.services.job_service import JobService



def _org_defaults(enabled: bool = True, mode: str = "shadow"):
    """An integrity service whose org defaults are what a new job starts from."""
    service = MagicMock()
    service.ensure_defaults = AsyncMock(
        return_value=MagicMock(default_enabled=enabled, default_mode=mode)
    )
    return service


class JobServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_applies_default_screening_questions(self):
        session = AsyncMock()
        job_repo = MagicMock()
        audit = AsyncMock()
        expected = AsyncMock()
        integrations = AsyncMock()

        created_job = MagicMock()
        created_job.id = uuid.uuid4()
        created_job.title = "Backend Engineer"
        created_job.status = "active"

        def add_job(job):
            job.id = created_job.id
            job.title = created_job.title
            job.status = created_job.status
            return job

        job_repo.add.side_effect = add_job
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=audit,
            expected_answers=expected,
            integrations_service=integrations,
            integrity_service=_org_defaults(),
        )

        # Field omitted entirely -> the service seeds the defaults.
        payload = JobCreate(
            work_mode="remote",
            title="Backend Engineer",
            description="Build services",
            interview_questions=[],
        )
        job = await service.create(actor, payload)

        self.assertIsNone(payload.screening_questions)
        stored = job_repo.add.call_args.args[0]
        self.assertGreater(len(stored.screening_questions), 0)
        expected.enrich.assert_not_awaited()
        audit.log_change.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_create_enriches_interview_questions_when_present(self):
        session = AsyncMock()
        job_repo = MagicMock()
        audit = AsyncMock()
        expected = AsyncMock()
        integrations = AsyncMock()
        integrations.load = AsyncMock(
            return_value=MagicMock(
                openai_api_key="key",
                require=MagicMock(),
            )
        )
        expected.enrich = AsyncMock(return_value=[{"id": "q1", "question": "Q", "score": 5}])

        job_repo.add = MagicMock(side_effect=lambda j: j)
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=audit,
            expected_answers=expected,
            integrations_service=integrations,
            integrity_service=_org_defaults(),
        )

        payload = JobCreate(
            work_mode="remote",
            title="Backend Engineer",
            description="Build services",
            interview_questions=[{"id": "q1", "question": "Q", "score": 5}],
        )
        await service.create(actor, payload)
        expected.enrich.assert_awaited_once()


class ExtensionCheckDefaultsTests(unittest.IsolatedAsyncioTestCase):
    """A new job starts from its organization's extension-check defaults."""

    def _service(self, integrity):
        job_repo = MagicMock()
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()
        job_repo.add.side_effect = lambda job: job
        return JobService(
            AsyncMock(),
            job_repo=job_repo,
            audit_service=AsyncMock(),
            expected_answers=AsyncMock(),
            integrations_service=AsyncMock(),
            integrity_service=integrity,
        )

    def _actor(self):
        return User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
            hashed_password="x", role="hr", is_active=True,
        )

    def _payload(self, **extra):
        return JobCreate(
            work_mode="remote", title="Backend Engineer", description="Build services",
            interview_questions=[], **extra,
        )

    async def test_missing_fields_come_from_the_org_defaults(self):
        integrity = _org_defaults(enabled=False, mode="enforce")
        actor = self._actor()
        job = await self._service(integrity).create(actor, self._payload())
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (False, "enforce"))
        integrity.ensure_defaults.assert_awaited_once_with(actor.tenant_id)

    async def test_an_explicit_choice_wins_over_the_defaults(self):
        integrity = _org_defaults(enabled=True, mode="shadow")
        job = await self._service(integrity).create(
            self._actor(), self._payload(extension_check_enabled=False, extension_check_mode="enforce")
        )
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (False, "enforce"))
        integrity.ensure_defaults.assert_not_awaited()

    async def test_only_the_missing_field_is_filled(self):
        integrity = _org_defaults(enabled=True, mode="enforce")
        job = await self._service(integrity).create(
            self._actor(), self._payload(extension_check_enabled=False)
        )
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (False, "enforce"))

    def test_the_mode_must_be_shadow_or_enforce(self):
        with self.assertRaises(PydanticValidationError):
            self._payload(extension_check_mode="off")


if __name__ == "__main__":
    unittest.main()


class ScreeningQuestionRuleTests(unittest.IsolatedAsyncioTestCase):
    """The standard questions are the server's: always present, never taken from a client."""

    def _service(self):
        self.session = AsyncMock()
        self.job_repo = MagicMock()
        self.job_repo.flush = AsyncMock()
        self.job_repo.refresh = AsyncMock()
        self.job_repo.add.side_effect = lambda job: job
        return JobService(
            self.session,
            job_repo=self.job_repo,
            audit_service=AsyncMock(),
            expected_answers=AsyncMock(),
            integrations_service=AsyncMock(),
            integrity_service=_org_defaults(),
        )

    def _actor(self):
        return User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

    def _job(self, **over):
        job = MagicMock()
        job.voice_screening_enabled = True
        job.title = "Backend Engineer"
        job.work_mode = "hybrid"
        job.work_location = "Bengaluru"
        job.screening_questions = []
        for key, value in over.items():
            setattr(job, key, value)
        return job

    def _stored(self):
        return self.job_repo.add.call_args.args[0].screening_questions

    async def test_create_always_adds_the_six_standard_questions(self):
        service = self._service()
        await service.create(
            self._actor(),
            JobCreate(title="Backend Engineer", description="D", work_mode="onsite", work_location="Pune"),
        )
        stored = self._stored()
        self.assertEqual([q["kind"] for q in stored], ["standard"] * 6)
        self.assertIn("work from office in Pune", stored[-1]["question"])
        self.assertIn("Backend Engineer", stored[2]["question"])

    async def test_create_keeps_role_and_custom_questions_after_the_standard_ones(self):
        service = self._service()
        await service.create(
            self._actor(),
            JobCreate(
                title="T",
                description="D",
                work_mode="remote",
                screening_questions=[
                    {"id": "r1", "question": "Have you used Kafka?", "kind": "role"},
                    {"id": "c1", "question": "Can you start on a Monday?"},
                ],
            ),
        )
        stored = self._stored()
        self.assertEqual([q["kind"] for q in stored][6:], ["role", "custom"])

    async def test_a_clients_own_standard_rows_are_ignored(self):
        service = self._service()
        await service.create(
            self._actor(),
            JobCreate(
                title="T",
                description="D",
                work_mode="remote",
                screening_questions=[
                    {"id": "screening-default-expected-ctc", "question": "Hacked?", "kind": "standard"},
                ],
            ),
        )
        stored = self._stored()
        self.assertEqual(len(stored), 6)
        self.assertNotIn("Hacked?", [q["question"] for q in stored])

    async def test_create_rejects_more_than_ten_questions(self):
        service = self._service()
        extra = [{"id": f"x{i}", "question": f"Question number {i}?"} for i in range(5)]
        with self.assertRaises(ValidationError) as ctx:
            await service.create(
                self._actor(),
                JobCreate(title="T", description="D", work_mode="remote", screening_questions=extra),
            )
        self.assertIn("at most 10", ctx.exception.public_message)
        self.job_repo.add.assert_not_called()

    async def test_create_rejects_an_over_long_question(self):
        service = self._service()
        with self.assertRaises(ValidationError) as ctx:
            await service.create(
                self._actor(),
                JobCreate(
                    title="T",
                    description="D",
                    work_mode="remote",
                    screening_questions=[{"id": "x", "question": "q" * 201}],
                ),
            )
        self.assertIn("200 characters", ctx.exception.public_message)

    def test_a_job_needs_a_work_mode(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(title="T", description="D")

    def test_hybrid_and_onsite_need_a_location_and_remote_drops_it(self):
        for mode in ("hybrid", "onsite"):
            with self.subTest(mode=mode), self.assertRaises(PydanticValidationError):
                JobCreate(title="T", description="D", work_mode=mode)
        remote = JobCreate(title="T", description="D", work_mode="remote", work_location="Pune")
        self.assertIsNone(remote.work_location)

    async def test_update_clearing_the_extra_questions_leaves_the_standard_ones(self):
        service = self._service()
        job = self._job(screening_questions=[{"id": "u1", "question": "Old extra?", "kind": "custom"}])
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(screening_questions=[]))
        self.assertEqual([q["kind"] for q in job.screening_questions], ["standard"] * 6)
        self.session.commit.assert_awaited_once()

    async def test_update_rebuilds_the_location_question_when_the_mode_changes(self):
        service = self._service()
        job = self._job()
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(work_mode="remote"))
        self.assertIsNone(job.work_location)
        self.assertIn("fully remote", job.screening_questions[-1]["question"])

    async def test_update_rerenders_the_title_and_keeps_stored_extras(self):
        service = self._service()
        job = self._job(screening_questions=[{"id": "u1", "question": "x" * 300, "kind": "custom"}])
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(title="Platform Engineer"))
        self.assertIn("Platform Engineer", job.screening_questions[2]["question"])
        # A stored question over today's limit must not stop an unrelated rename.
        self.assertEqual(len(job.screening_questions), 7)

    async def test_update_refuses_to_clear_the_work_mode(self):
        service = self._service()
        service._jobs.get_for_tenant = AsyncMock(return_value=self._job())
        with self.assertRaises(ValidationError):
            await service.update(self._actor(), uuid.uuid4(), JobUpdate(work_mode=None))
        self.session.commit.assert_not_awaited()

    async def test_update_needs_a_location_for_the_mode_the_job_will_have(self):
        service = self._service()
        service._jobs.get_for_tenant = AsyncMock(
            return_value=self._job(work_mode="remote", work_location=None)
        )
        with self.assertRaises(ValidationError) as ctx:
            await service.update(self._actor(), uuid.uuid4(), JobUpdate(work_mode="onsite"))
        self.assertIn("location", ctx.exception.public_message)

    async def test_a_status_only_update_leaves_a_legacy_job_alone(self):
        # Archiving a job that predates work modes must not demand one.
        service = self._service()
        job = self._job(work_mode=None, work_location=None, screening_questions=[{"id": "old", "question": "Old?"}])
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(status="closed"))
        self.assertEqual(job.status, "closed")
        self.assertEqual(job.screening_questions, [{"id": "old", "question": "Old?"}])

    async def test_a_plain_edit_cannot_switch_voice_screening_off(self):
        # That is the switch's job: it asks where the phone round goes, under a job lock.
        service = self._service()
        job = MagicMock()
        job.voice_screening_enabled = True
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        with self.assertRaises(ConflictError) as ctx:
            await service.update(self._actor(), uuid.uuid4(), JobUpdate(voice_screening_enabled=False))
        self.assertIn("switch", ctx.exception.public_message)
        self.session.commit.assert_not_awaited()
        self.assertTrue(job.voice_screening_enabled)

    async def test_a_plain_edit_may_still_switch_it_on(self):
        service = self._service()
        job = MagicMock()
        job.voice_screening_enabled = False
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(voice_screening_enabled=True))
        self.assertTrue(job.voice_screening_enabled)


class ExperienceRangeTests(unittest.IsolatedAsyncioTestCase):
    """Years of experience must be non-negative, and max must not sit below min."""

    def _actor(self):
        return User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

    def test_create_rejects_negative_experience(self):
        with self.assertRaises(PydanticValidationError) as ctx:
            JobCreate(work_mode="remote", title="T", description="D", experience_min=-1)
        self.assertIn("cannot be negative", str(ctx.exception))

    def test_create_rejects_max_below_min(self):
        with self.assertRaises(PydanticValidationError) as ctx:
            JobCreate(work_mode="remote", title="T", description="D", experience_min=6, experience_max=3)
        self.assertIn("cannot be less than", str(ctx.exception))

    def test_create_allows_equal_bounds(self):
        payload = JobCreate(
            work_mode="remote",
            title="T", description="D", experience_min=4, experience_max=4
        )
        self.assertEqual(payload.experience_max, 4)

    def test_update_rejects_negative_experience(self):
        with self.assertRaises(PydanticValidationError):
            JobUpdate(experience_max=-2)

    # ── "5+ years": a missing or zero maximum means no upper bound ───────────

    def test_create_allows_min_only(self):
        payload = JobCreate(work_mode="remote", title="T", description="D", experience_min=5)
        self.assertEqual(payload.experience_min, 5)
        self.assertEqual(payload.experience_max, 0)

    def test_create_treats_explicit_null_bounds_as_unset(self):
        # A parsed JD stating only "5+ years" yields experience_max: null.
        payload = JobCreate(
            work_mode="remote",
            title="T", description="D", experience_min=5, experience_max=None
        )
        self.assertEqual(payload.experience_max, 0)
        payload = JobCreate(
            work_mode="remote",
            title="T", description="D", experience_min=None, experience_max=None
        )
        self.assertEqual((payload.experience_min, payload.experience_max), (0, 0))

    def test_create_treats_zero_max_as_no_upper_bound(self):
        payload = JobCreate(
            work_mode="remote",
            title="T", description="D", experience_min=5, experience_max=0
        )
        self.assertEqual(payload.experience_max, 0)

    def test_create_still_rejects_real_max_below_min(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(work_mode="remote", title="T", description="D", experience_min=6, experience_max=3)

    def test_create_still_rejects_negative_and_oversized(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(work_mode="remote", title="T", description="D", experience_min=5, experience_max=-1)
        with self.assertRaises(PydanticValidationError):
            JobCreate(work_mode="remote", title="T", description="D", experience_min=5, experience_max=61)

    def _service_with_job(self, *, experience_min, experience_max):
        session = AsyncMock()
        job_repo = MagicMock()
        job = MagicMock()
        job.experience_min = experience_min
        job.experience_max = experience_max
        job_repo.get_for_tenant = AsyncMock(return_value=job)
        job_repo.refresh = AsyncMock()
        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=AsyncMock(),
            expected_answers=AsyncMock(),
            integrations_service=AsyncMock(),
            integrity_service=_org_defaults(),
        )
        return service, job, session

    async def test_update_min_only_against_stored_unbounded_max(self):
        service, job, session = self._service_with_job(
            experience_min=0, experience_max=0
        )
        await service.update(
            self._actor(), uuid.uuid4(), JobUpdate(experience_min=5)
        )
        self.assertEqual(job.experience_min, 5)
        session.commit.assert_awaited_once()

    async def test_update_zero_max_removes_the_upper_bound(self):
        service, job, _ = self._service_with_job(experience_min=6, experience_max=8)
        await service.update(
            self._actor(), uuid.uuid4(), JobUpdate(experience_max=0)
        )
        self.assertEqual(job.experience_max, 0)

    async def test_update_null_max_is_stored_as_zero_not_null(self):
        # The column is NOT NULL; the edit form sends null when max is cleared.
        service, job, _ = self._service_with_job(experience_min=6, experience_max=8)
        await service.update(
            self._actor(), uuid.uuid4(), JobUpdate(experience_max=None)
        )
        self.assertEqual(job.experience_max, 0)

    async def test_update_null_min_is_stored_as_zero_not_null(self):
        service, job, _ = self._service_with_job(experience_min=6, experience_max=8)
        await service.update(
            self._actor(), uuid.uuid4(), JobUpdate(experience_min=None)
        )
        self.assertEqual(job.experience_min, 0)

    async def test_update_min_above_stored_real_max_is_still_rejected(self):
        service, _, session = self._service_with_job(experience_min=2, experience_max=4)
        with self.assertRaises(ValidationError):
            await service.update(
                self._actor(), uuid.uuid4(), JobUpdate(experience_min=9)
            )
        session.commit.assert_not_awaited()

    async def test_update_compares_against_stored_bound(self):
        """Lowering only the max below the job's existing min must be rejected."""
        session = AsyncMock()
        job_repo = MagicMock()
        job = MagicMock()
        job.experience_min = 6
        job.experience_max = 8
        job_repo.get_for_tenant = AsyncMock(return_value=job)
        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=AsyncMock(),
            expected_answers=AsyncMock(),
            integrations_service=AsyncMock(),
            integrity_service=_org_defaults(),
        )
        with self.assertRaises(ValidationError) as ctx:
            await service.update(
                self._actor(), uuid.uuid4(), JobUpdate(experience_max=3)
            )
        self.assertIn("cannot be less than", ctx.exception.public_message)
        session.commit.assert_not_awaited()


class InterviewScoreBoundsTests(unittest.TestCase):
    """Rubric points must stay within 1..100, and questions cannot be blank."""

    def _payload(self, **q):
        base = {"id": "q1", "question": "Walk me through a project you led", "score": 10}
        base.update(q)
        return JobCreate(work_mode="remote", title="T", description="D", interview_questions=[base])

    def test_score_above_cap_rejected(self):
        with self.assertRaises(PydanticValidationError):
            self._payload(score=INTERVIEW_SCORE_MAX + 1)

    def test_negative_and_zero_scores_rejected(self):
        for score in (0, -5):
            with self.subTest(score=score), self.assertRaises(PydanticValidationError):
                self._payload(score=score)

    def test_bounds_are_inclusive(self):
        for score in (INTERVIEW_SCORE_MIN, INTERVIEW_SCORE_MAX):
            with self.subTest(score=score):
                self.assertEqual(self._payload(score=score).interview_questions[0].score, score)

    def test_blank_question_text_rejected(self):
        with self.assertRaises(PydanticValidationError):
            self._payload(question="   ")

    def test_stored_out_of_range_score_still_serialises(self):
        """Legacy rows above the cap must stay readable — the cap is input-only."""
        legacy = InterviewQuestionPublic(id="q1", question="Old question", score=250)
        self.assertEqual(legacy.score, 250)


class ExperienceRequirementFormatTests(unittest.TestCase):
    """The text sent to the LLM must not read "5-0 years" for an open-ended range."""

    def test_open_ended(self):
        from app.prompts.common import format_experience_requirement

        self.assertEqual(format_experience_requirement(5, 0), "5+ years")
        self.assertEqual(format_experience_requirement(5, None), "5+ years")
        self.assertEqual(format_experience_requirement(None, None), "0+ years")

    def test_bounded(self):
        from app.prompts.common import format_experience_requirement

        self.assertEqual(format_experience_requirement(3, 6), "3–6 years")
        self.assertEqual(format_experience_requirement(4, 4), "4 years")
