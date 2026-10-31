"""JobService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import inspect as sa_inspect

from app.exceptions import AuthorizationError, ConflictError, ValidationError
from app.models.models import User
from app.schemas.schemas import JobCreate, JobUpdate
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
        payload = JobCreate(seniority_level="mid", 
            work_mode="remote",
            title="Backend Engineer",
            description="Build services",
            interview_topics=[],
        )
        job = await service.create(actor, payload)

        self.assertIsNone(payload.screening_questions)
        stored = job_repo.add.call_args.args[0]
        self.assertGreater(len(stored.screening_questions), 0)
        # Initialised on the new job: left unset, the first read would lazy-load, and the async
        # session cannot do that (it fails with MissingGreenlet in a real request).
        self.assertIn("interview_topics", sa_inspect(stored).dict)
        expected.generate.assert_not_awaited()
        audit.log_change.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_create_saves_the_topic_pool_and_writes_an_answer_key_for_each(self):
        session = AsyncMock()
        job_repo = MagicMock()
        audit = AsyncMock()
        expected = AsyncMock()
        expected.generate = AsyncMock(return_value=["point one", "point two"])
        integrations = AsyncMock()
        integrations.load = AsyncMock(return_value=MagicMock(openai_api_key="key", require=MagicMock()))

        job_repo.add = MagicMock(side_effect=lambda j: j)
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()

        actor = User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
            hashed_password="x", role="hr", is_active=True,
        )
        service = JobService(
            session, job_repo=job_repo, audit_service=audit, expected_answers=expected,
            integrations_service=integrations,
        )

        payload = JobCreate(
            seniority_level="mid", work_mode="remote", title="Backend Engineer", description="Build services",
            interview_topics=_pool(8),
        )
        await service.create(actor, payload)

        saved = job_repo.add.call_args.args[0].interview_topics
        self.assertEqual([t.position for t in saved], list(range(8)))
        self.assertEqual(expected.generate.await_count, 8)
        self.assertTrue(all(t.seed_expected_points == ["point one", "point two"] for t in saved))


class ExtensionCheckDefaultsTests(unittest.IsolatedAsyncioTestCase):
    """A new job starts with the extension check on, in shadow mode."""

    def _service(self, org_enabled=True):
        job_repo = MagicMock()
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()
        job_repo.add.side_effect = lambda job: job
        self.integrity = MagicMock()
        self.integrity.org_enabled = AsyncMock(return_value=org_enabled)
        return JobService(
            AsyncMock(),
            job_repo=job_repo,
            audit_service=AsyncMock(),
            expected_answers=AsyncMock(),
            integrations_service=AsyncMock(),
            integrity_service=self.integrity,
        )

    def _actor(self):
        return User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
            hashed_password="x", role="hr", is_active=True,
        )

    def _payload(self, **extra):
        return JobCreate(seniority_level="mid", 
            work_mode="remote", title="Backend Engineer", description="Build services",
            interview_topics=[], **extra,
        )

    async def test_a_new_job_starts_with_the_check_on_in_shadow_mode(self):
        job = await self._service().create(self._actor(), self._payload())
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (True, "shadow"))

    async def test_the_choice_made_on_the_create_form_is_kept(self):
        job = await self._service().create(
            self._actor(), self._payload(extension_check_enabled=False)
        )
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (False, "shadow"))

    async def test_starting_values_need_no_lookup_even_while_the_org_switch_is_off(self):
        # What the greyed-out create form sends: nothing different from the defaults.
        job = await self._service(org_enabled=False).create(self._actor(), self._payload())
        self.assertEqual((job.extension_check_enabled, job.extension_check_mode), (True, "shadow"))
        self.integrity.org_enabled.assert_not_awaited()

    async def test_a_different_choice_is_refused_while_the_org_switch_is_off(self):
        service = self._service(org_enabled=False)
        for extra in ({"extension_check_enabled": False}, {"extension_check_mode": "enforce"}):
            with self.assertRaises(AuthorizationError):
                await service.create(self._actor(), self._payload(**extra))

    async def test_a_different_choice_is_kept_while_the_org_switch_is_on(self):
        job = await self._service(org_enabled=True).create(
            self._actor(), self._payload(extension_check_mode="enforce")
        )
        self.assertEqual(job.extension_check_mode, "enforce")

    def _stored_job(self, **over):
        job = MagicMock()
        job.extension_check_enabled = True
        job.extension_check_mode = "shadow"
        job.work_mode = "remote"
        job.work_location = None
        job.screening_questions = []
        job.title = "Backend Engineer"
        for key, value in over.items():
            setattr(job, key, value)
        return job

    async def test_the_job_switch_cannot_be_changed_while_the_org_switch_is_off(self):
        service = self._service(org_enabled=False)
        service._jobs.get_for_tenant = AsyncMock(return_value=self._stored_job())
        for update in (JobUpdate(extension_check_enabled=False), JobUpdate(extension_check_mode="enforce")):
            with self.assertRaises(AuthorizationError):
                await service.update(self._actor(), uuid.uuid4(), update)

    async def test_resending_the_current_value_is_not_a_change(self):
        service = self._service(org_enabled=False)
        service._jobs.get_for_tenant = AsyncMock(return_value=self._stored_job())
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(extension_check_enabled=True))
        self.integrity.org_enabled.assert_not_awaited()

    async def test_the_job_switch_changes_while_the_org_switch_is_on(self):
        service = self._service(org_enabled=True)
        job = self._stored_job()
        service._jobs.get_for_tenant = AsyncMock(return_value=job)
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(extension_check_enabled=False))
        self.assertFalse(job.extension_check_enabled)

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
            JobCreate(seniority_level="mid", title="Backend Engineer", description="D", work_mode="onsite", work_location="Pune"),
        )
        stored = self._stored()
        self.assertEqual([q["kind"] for q in stored], ["standard"] * 6)
        self.assertIn("work from office in Pune", stored[-1]["question"])
        self.assertIn("Backend Engineer", stored[2]["question"])

    async def test_create_keeps_role_and_custom_questions_after_the_standard_ones(self):
        service = self._service()
        await service.create(
            self._actor(),
            JobCreate(seniority_level="mid", 
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
            JobCreate(seniority_level="mid", 
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
                JobCreate(seniority_level="mid", title="T", description="D", work_mode="remote", screening_questions=extra),
            )
        self.assertIn("at most 10", ctx.exception.public_message)
        self.job_repo.add.assert_not_called()

    async def test_create_rejects_an_over_long_question(self):
        service = self._service()
        with self.assertRaises(ValidationError) as ctx:
            await service.create(
                self._actor(),
                JobCreate(seniority_level="mid", 
                    title="T",
                    description="D",
                    work_mode="remote",
                    screening_questions=[{"id": "x", "question": "q" * 201}],
                ),
            )
        self.assertIn("200 characters", ctx.exception.public_message)

    def test_a_job_needs_a_work_mode(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(seniority_level="mid", title="T", description="D")

    def test_hybrid_and_onsite_need_a_location_and_remote_drops_it(self):
        for mode in ("hybrid", "onsite"):
            with self.subTest(mode=mode), self.assertRaises(PydanticValidationError):
                JobCreate(seniority_level="mid", title="T", description="D", work_mode=mode)
        remote = JobCreate(seniority_level="mid", title="T", description="D", work_mode="remote", work_location="Pune")
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


class SeniorityLevelTests(unittest.IsolatedAsyncioTestCase):
    """Seniority is one of four levels, required on create, and never cleared on update."""

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

    def _service_with_job(self, *, seniority_level="mid"):
        session = AsyncMock()
        job_repo = MagicMock()
        job = MagicMock()
        job.seniority_level = seniority_level
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

    def test_create_requires_seniority(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(work_mode="remote", title="T", description="D")

    def test_create_accepts_every_level(self):
        for level in ("intern", "junior", "mid", "senior"):
            with self.subTest(level=level):
                payload = JobCreate(work_mode="remote", title="T", description="D", seniority_level=level)
                self.assertEqual(payload.seniority_level.value, level)

    def test_create_rejects_unknown_level(self):
        with self.assertRaises(PydanticValidationError):
            JobCreate(work_mode="remote", title="T", description="D", seniority_level="principal")

    def test_update_rejects_unknown_level(self):
        with self.assertRaises(PydanticValidationError):
            JobUpdate(seniority_level="expert")

    async def test_update_changes_level(self):
        service, job, _ = self._service_with_job(seniority_level="mid")
        await service.update(self._actor(), uuid.uuid4(), JobUpdate(seniority_level="senior"))
        self.assertEqual(job.seniority_level.value, "senior")

    async def test_update_refuses_to_clear_level(self):
        service, _, session = self._service_with_job()
        with self.assertRaises(ValidationError):
            await service.update(self._actor(), uuid.uuid4(), JobUpdate(seniority_level=None))
        session.commit.assert_not_awaited()


def _topic(n, **extra):
    return {
        "name": f"Topic {n}", "scope": "What to probe.", "skill_tag": f"skill {n % 4}",
        "seed_question": f"Explain how you would approach topic {n} on a real project.", **extra,
    }


def _pool(size, **mandatory):
    return [_topic(n, is_mandatory=n in mandatory.get("mandatory", ())) for n in range(size)]


class InterviewTopicPoolTests(unittest.TestCase):
    """A job's topic pool: big enough to vary interviews, small enough to review, no repeats."""

    def _create(self, topics):
        return JobCreate(
            seniority_level="mid", work_mode="remote", title="T", description="D", interview_topics=topics
        )

    def test_no_topics_is_allowed(self):
        self.assertEqual(self._create([]).interview_topics, [])

    def test_the_pool_has_a_minimum_and_a_maximum_size(self):
        self.assertEqual(len(self._create(_pool(8)).interview_topics), 8)
        self.assertEqual(len(self._create(_pool(20)).interview_topics), 20)
        for size in (1, 7, 21):
            with self.subTest(size=size), self.assertRaises(PydanticValidationError):
                self._create(_pool(size))

    def test_at_most_two_topics_can_be_mandatory(self):
        self.assertEqual(sum(t.is_mandatory for t in self._create(_pool(10, mandatory=(0, 1))).interview_topics), 2)
        with self.assertRaises(PydanticValidationError):
            self._create(_pool(10, mandatory=(0, 1, 2)))

    def test_topic_names_cannot_repeat(self):
        topics = _pool(8)
        topics[1]["name"] = topics[0]["name"].upper()
        with self.assertRaises(PydanticValidationError):
            self._create(topics)

    def test_new_topics_get_an_id_and_existing_ones_keep_theirs(self):
        keep = uuid.uuid4()
        topics = _pool(8)
        topics[0]["id"] = str(keep)
        saved = self._create(topics).interview_topics
        self.assertEqual(saved[0].id, keep)
        self.assertTrue(all(t.id for t in saved))

    def test_the_example_question_must_be_spoken_and_technical(self):
        for question in ("Write a function that reverses a list", "Tell me about a time you handled conflict"):
            topics = _pool(8)
            topics[0]["seed_question"] = question
            with self.subTest(question), self.assertRaises(PydanticValidationError):
                self._create(topics)

    def test_blank_and_oversized_fields_are_rejected(self):
        for field, value in (("name", "  "), ("scope", ""), ("skill_tag", " "), ("name", "x" * 121)):
            topics = _pool(8)
            topics[0][field] = value
            with self.subTest(field=field, value=value[:5]), self.assertRaises(PydanticValidationError):
                self._create(topics)

    def test_skill_tags_are_lowercased(self):
        topics = _pool(8)
        topics[0]["skill_tag"] = "  PostgreSQL "
        self.assertEqual(self._create(topics).interview_topics[0].skill_tag, "postgresql")

    def test_an_update_checks_the_pool_too(self):
        self.assertEqual(len(JobUpdate(interview_topics=_pool(8)).interview_topics), 8)
        with self.assertRaises(PydanticValidationError):
            JobUpdate(interview_topics=_pool(3))
        self.assertIsNone(JobUpdate().interview_topics)  # not sent: the pool is left alone


class SeniorityGuidanceTests(unittest.TestCase):
    """The text sent to the LLM names the level and carries its difficulty guidance."""

    def test_label(self):
        from app.prompts.common import seniority_label

        self.assertEqual(seniority_label("mid"), "Mid-level")
        self.assertEqual(seniority_label("intern"), "Intern")
        self.assertEqual(seniority_label(None), "Mid-level")

    def test_guidance_covers_every_level(self):
        from app.models.enums import SeniorityLevel
        from app.prompts.common import SENIORITY_GUIDANCE, seniority_guidance

        self.assertEqual(set(SENIORITY_GUIDANCE), set(SeniorityLevel))
        self.assertIn("system design", seniority_guidance("senior"))
        self.assertIn("fundamentals", seniority_guidance("junior"))
