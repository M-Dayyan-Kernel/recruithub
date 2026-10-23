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
        )

        # Field omitted entirely -> the service seeds the defaults.
        payload = JobCreate(
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
        )

        payload = JobCreate(
            title="Backend Engineer",
            description="Build services",
            interview_questions=[{"id": "q1", "question": "Q", "score": 5}],
        )
        await service.create(actor, payload)
        expected.enrich.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()


class ScreeningQuestionRequiredTests(unittest.IsolatedAsyncioTestCase):
    """Clearing every screening question must stick, not silently refill.

    The service used to treat an empty list as "not supplied" and backfill the
    defaults, so questions the user had just deleted came straight back.
    """

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

    async def test_create_rejects_empty_questions_when_voice_screening_on(self):
        service = self._service()
        payload = JobCreate(
            title="Backend Engineer",
            description="Build services",
            screening_questions=[],
            voice_screening_enabled=True,
        )
        with self.assertRaises(ValidationError) as ctx:
            await service.create(self._actor(), payload)
        self.assertIn("at least one screening question", ctx.exception.public_message)
        self.job_repo.add.assert_not_called()

    async def test_create_allows_empty_questions_when_voice_screening_off(self):
        service = self._service()
        payload = JobCreate(
            title="Backend Engineer",
            description="Build services",
            screening_questions=[],
            voice_screening_enabled=False,
        )
        await service.create(self._actor(), payload)
        stored = self.job_repo.add.call_args.args[0]
        self.assertEqual(stored.screening_questions, [])

    async def test_update_rejects_clearing_questions_while_voice_screening_on(self):
        service = self._service()
        job = MagicMock()
        job.voice_screening_enabled = True
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        with self.assertRaises(ValidationError):
            await service.update(
                self._actor(), uuid.uuid4(), JobUpdate(screening_questions=[])
            )
        self.session.commit.assert_not_awaited()

    async def test_update_allows_clearing_questions_once_voice_screening_is_off(self):
        service = self._service()
        job = MagicMock()
        job.voice_screening_enabled = False
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(screening_questions=[]))
        self.assertEqual(job.screening_questions, [])
        self.session.commit.assert_awaited_once()

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
            JobCreate(title="T", description="D", experience_min=-1)
        self.assertIn("cannot be negative", str(ctx.exception))

    def test_create_rejects_max_below_min(self):
        with self.assertRaises(PydanticValidationError) as ctx:
            JobCreate(title="T", description="D", experience_min=6, experience_max=3)
        self.assertIn("cannot be less than", str(ctx.exception))

    def test_create_allows_equal_bounds(self):
        payload = JobCreate(
            title="T", description="D", experience_min=4, experience_max=4
        )
        self.assertEqual(payload.experience_max, 4)

    def test_update_rejects_negative_experience(self):
        with self.assertRaises(PydanticValidationError):
            JobUpdate(experience_max=-2)

    # ── "5+ years": a missing or zero maximum means no upper bound ───────────

    def test_create_allows_min_only(self):
        payload = JobCreate(title="T", description="D", experience_min=5)
        self.assertEqual(payload.experience_min, 5)
        self.assertEqual(payload.experience_max, 0)

    def test_create_treats_explicit_null_bounds_as_unset(self):
        # A parsed JD stating only "5+ years" yields experience_max: null.
        payload = JobCreate(
            title="T", description="D", experience_min=5, experience_max=None
        )
        self.assertEqual(payload.experience_max, 0)
        payload = JobCreate(
            title="T", description="D", experience_min=None, experience_max=None
        )
        self.assertEqual((payload.experience_min, payload.experience_max), (0, 0))

    def test_create_treats_zero_max_as_no_upper_bound(self):
        payload = JobCreate(
            title="T", description="D", experience_min=5, experience_max=0
        )
        self.assertEqual(payload.experience_max, 0)

    def test_create_still_rejects_real_max_below_min(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(title="T", description="D", experience_min=6, experience_max=3)

    def test_create_still_rejects_negative_and_oversized(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(title="T", description="D", experience_min=5, experience_max=-1)
        with self.assertRaises(PydanticValidationError):
            JobCreate(title="T", description="D", experience_min=5, experience_max=61)

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
        return JobCreate(title="T", description="D", interview_questions=[base])

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
