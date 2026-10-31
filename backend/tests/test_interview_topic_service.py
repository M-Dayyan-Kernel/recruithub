"""Saving a job's topic pool, and writing or replacing topics."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

from app.exceptions import JobParseFailedError, UpstreamError
from app.models.models import JobInterviewTopic
from app.services import interview_topic_service as topics_svc
from app.services.interview_topic_service import generate_pool, regenerate_topic, replace_topics


def _incoming(n, **extra):
    return {
        "id": None, "name": f"Topic {n}", "scope": "What to probe.", "skill_tag": f"skill {n}",
        "seed_question": f"Explain topic {n}.", "is_mandatory": False, **extra,
    }


def _saved(n, points=("old",), **extra):
    topic = JobInterviewTopic(
        id=uuid.uuid4(), job_id=uuid.uuid4(), position=n, name=f"Topic {n}", scope="What to probe.",
        skill_tag=f"skill {n}", seed_question=f"Explain topic {n}.", seed_expected_points=list(points),
        is_mandatory=False,
    )
    for key, value in extra.items():
        setattr(topic, key, value)
    return topic


def _job(*topics):
    return NS(id=uuid.uuid4(), interview_topics=list(topics), title="Engineer", seniority_level="mid")


class ReplaceTopicsTests(unittest.IsolatedAsyncioTestCase):
    async def _replace(self, job, incoming, points=("new",)):
        generate = AsyncMock(return_value=list(points))
        db = AsyncMock()
        await replace_topics(db, job, incoming, generate_points=generate, api_key="key")
        return generate, db

    async def test_new_topics_are_created_in_order_with_an_answer_key(self):
        job = _job()
        generate, db = await self._replace(job, [_incoming(0), _incoming(1), _incoming(2)])
        self.assertEqual([t.name for t in job.interview_topics], ["Topic 0", "Topic 1", "Topic 2"])
        self.assertEqual([t.position for t in job.interview_topics], [0, 1, 2])
        self.assertTrue(all(t.seed_expected_points == ["new"] for t in job.interview_topics))
        self.assertEqual(generate.await_count, 3)
        db.flush.assert_awaited()

    async def test_an_unchanged_question_keeps_its_answer_key(self):
        keep = _saved(0)
        job = _job(keep)
        generate, _ = await self._replace(job, [_incoming(0, id=keep.id, scope="A new scope")])
        generate.assert_not_awaited()
        self.assertEqual(keep.seed_expected_points, ["old"])
        self.assertEqual(keep.scope, "A new scope")

    async def test_a_reworded_question_gets_a_new_key(self):
        topic = _saved(0)
        job = _job(topic)
        generate, _ = await self._replace(job, [_incoming(0, id=topic.id, seed_question="Explain it differently.")])
        generate.assert_awaited_once()
        self.assertEqual(topic.seed_expected_points, ["new"])

    async def test_a_saved_topic_without_a_key_gets_one(self):
        topic = _saved(0, points=())
        generate, _ = await self._replace(_job(topic), [_incoming(0, id=topic.id)])
        generate.assert_awaited_once()

    async def test_topics_left_out_are_removed_and_the_rest_reordered(self):
        a, b, c = _saved(0), _saved(1), _saved(2)
        job = _job(a, b, c)
        await self._replace(job, [_incoming(2, id=c.id), _incoming(0, id=a.id)])
        self.assertEqual(job.interview_topics, [c, a])
        self.assertEqual((c.position, a.position), (0, 1))

    async def test_the_mandatory_mark_is_saved(self):
        job = _job()
        await self._replace(job, [_incoming(0, is_mandatory=True), _incoming(1)])
        self.assertEqual([t.is_mandatory for t in job.interview_topics], [True, False])

    async def test_an_empty_pool_clears_the_topics_without_asking_the_model(self):
        job = _job(_saved(0))
        generate, _ = await self._replace(job, [])
        generate.assert_not_awaited()
        self.assertEqual(job.interview_topics, [])

    async def test_a_topic_whose_key_could_not_be_written_fails_the_save(self):
        with self.assertRaisesRegex(UpstreamError, "Topic 1"):
            await self._replace(_job(), [_incoming(0), _incoming(1)], points=())


def _incoming_dict(n, **extra):
    """A pool entry as the client sends it back for regeneration: an id only if it has one."""
    return {key: value for key, value in _incoming(n, **extra).items() if key != "id" or value}


class GenerateTests(unittest.IsolatedAsyncioTestCase):
    async def test_mock_mode_writes_a_usable_pool(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=True):
            pool = await generate_pool(
                title="T", description="D", required_skills=["Python"], seniority_level="mid", api_key="k"
            )
        self.assertGreaterEqual(len(pool), 8)
        self.assertFalse(any(t["is_mandatory"] for t in pool))

    async def test_a_model_answer_with_no_usable_topic_is_an_error(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=False), \
             patch.object(topics_svc, "_ask_for", AsyncMock(return_value={"topics": [{"name": "x"}]})):
            with self.assertRaises(JobParseFailedError):
                await generate_pool(
                    title="T", description="D", required_skills=[], seniority_level="mid", api_key="k"
                )

    async def test_regenerating_keeps_the_id_and_mandatory_mark_and_a_new_name(self):
        pool = [_incoming_dict(n, id=uuid.uuid4()) for n in range(8)]
        pool[2]["is_mandatory"] = True
        with patch("app.clients.mocks.mock_openai_enabled", return_value=True):
            topic = await regenerate_topic(
                title="T", description="D", required_skills=[], seniority_level="mid",
                pool=pool, index=2, api_key="k",
            )
        self.assertEqual(topic["id"], pool[2]["id"])
        self.assertTrue(topic["is_mandatory"])
        self.assertNotIn(topic["name"].lower(), {t["name"].lower() for i, t in enumerate(pool) if i != 2})

    async def test_regenerating_never_returns_a_name_already_in_the_pool(self):
        pool = [_incoming_dict(n, id=uuid.uuid4()) for n in range(8)]
        duplicate = {"name": pool[0]["name"], "scope": "s", "skill_tag": "x", "seed_question": "Explain this."}
        with patch("app.clients.mocks.mock_openai_enabled", return_value=False), \
             patch.object(topics_svc, "_ask_for", AsyncMock(return_value={"topic": duplicate})):
            with self.assertRaises(JobParseFailedError):
                await regenerate_topic(
                    title="T", description="D", required_skills=[], seniority_level="mid",
                    pool=pool, index=3, api_key="k",
                )


if __name__ == "__main__":
    unittest.main()
