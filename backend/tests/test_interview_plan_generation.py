"""Writing an interview's questions for one candidate, from their resume and the job's topics."""

import random
import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.enums import PlanStatus
from app.models.models import InterviewPlanItem, Job, JobInterviewTopic
from app.prompts.interview_plan import ANGLES
from app.services import interview_plan_service as plans
from app.services.interview_plan_service import (
    is_repeat,
    project_material,
    question_similarity,
)


class ProjectMaterialTests(unittest.TestCase):
    def test_projects_are_offered_first(self):
        material = project_material({
            "projects": [{"name": "Chat app", "description": "Realtime chat", "technologies": ["Node", "Redis"]}],
            "experience": [{"title": "Dev", "company": "Acme", "description": "Built things"}],
        })
        self.assertEqual(material, [{"name": "Chat app", "description": "Realtime chat", "technologies": ["Node", "Redis"]}])

    def test_without_projects_the_roles_are_used(self):
        material = project_material({"experience": [
            {"title": "Backend Intern", "company": "Acme", "description": "Built an API"},
            {"title": "Dev", "company": "NoDescription", "description": ""},
        ]})
        self.assertEqual([m["name"] for m in material], ["Backend Intern at Acme"])

    def test_nothing_to_ask_about(self):
        for parsed in (None, {}, {"projects": [], "experience": []}, {"projects": [{"description": "no name"}]}):
            self.assertEqual(project_material(parsed), [], parsed)

    def test_only_a_few_are_offered(self):
        parsed = {"projects": [{"name": f"P{n}", "description": "d"} for n in range(10)]}
        self.assertEqual(len(project_material(parsed)), 4)


class SimilarityTests(unittest.TestCase):
    def test_same_words_are_a_repeat_and_different_ones_are_not(self):
        asked = ["Explain how database indexing speeds up queries."]
        self.assertTrue(is_repeat("Explain how database indexing speeds up your queries.", asked))
        self.assertFalse(is_repeat("A page loads slowly after a deploy. How would you find the cause?", asked))

    def test_similarity_ignores_case_punctuation_and_short_words(self):
        self.assertEqual(question_similarity("Explain CACHING, please!", "explain caching please"), 1.0)

    def test_empty_questions_are_not_similar(self):
        self.assertEqual(question_similarity("", "Explain caching"), 0.0)
        self.assertFalse(is_repeat("Explain caching", []))


def _topic(n):
    return JobInterviewTopic(
        id=uuid.UUID(int=n + 1), job_id=uuid.UUID(int=99), position=n, name=f"Topic {n}", scope=f"Scope {n}",
        skill_tag=f"skill {n}", seed_question=f"Explain topic {n} on a real project.",
        seed_expected_points=["seed a", "seed b"], is_mandatory=False,
    )


def _item(position, section, question, points, topic=None):
    return InterviewPlanItem(
        id=uuid.uuid4(), session_id=uuid.UUID(int=7), position=position, section=section,
        topic_id=topic.id if topic else None, topic_name=topic.name if topic else "Introduction",
        question=question, expected_points=list(topic.seed_expected_points) if topic else ["intro point"],
        points=points,
    )


TOPICS = [_topic(n) for n in range(3)]
RESUME = {"skills": ["Python"], "projects": [
    {"name": "Chat app", "description": "Realtime chat", "technologies": ["Node"]},
    {"name": "Budget tracker", "description": "Personal finance", "technologies": ["Django"]},
    {"name": "Compiler", "description": "Toy compiler", "technologies": ["Rust"]},
]}


def _answer(topics=TOPICS, projects=("Chat app", "Budget tracker")):
    return {
        "topics": [
            {"topic_id": str(t.id), "question": f"Walk me through how you would handle {t.name.lower()} in production.",
             "expected_points": ["p1", "p2", "p3"]} for t in topics
        ],
        "projects": [
            {"project": name, "question": f"In {name}, what were the main technical choices and why?",
             "expected_points": ["q1", "q2", "q3"]} for name in projects
        ],
    }


class GenerateTests(unittest.IsolatedAsyncioTestCase):
    def _session(self, status="pending", plan_status=PlanStatus.SEEDED.value):
        return NS(id=uuid.UUID(int=7), job_id=uuid.UUID(int=99), candidate_id=uuid.uuid4(),
                  status=status, plan_status=plan_status, plan_generated_at=None)

    async def _generate(self, session, *, answer=None, writer=None, resume=RESUME, asked=None, items=None, retry=None):
        db = AsyncMock()
        db.add = MagicMock()
        lock = MagicMock()
        lock.scalars.return_value.first.return_value = session
        db.execute = AsyncMock(return_value=lock)
        job = NS(id=session.job_id, title="Backend Engineer", seniority_level="mid", interview_topics=TOPICS)
        candidate = NS(parsed_data=resume)
        db.get = AsyncMock(side_effect=lambda model, pk: job if model is Job else candidate)
        seeded = items if items is not None else [_item(0, "intro", "Introduce yourself.", 10)] + [
            _item(n + 1, "topic", t.seed_question, 30, t) for n, t in enumerate(TOPICS)
        ]
        if writer is None:
            writer = AsyncMock(side_effect=[answer if answer is not None else _answer()] + ([retry] if retry else []))
        with patch.object(plans, "load_plan_items", AsyncMock(return_value=seeded)), \
             patch.object(plans, "_already_asked", AsyncMock(return_value=asked or {t.id: [] for t in TOPICS})), \
             patch.object(plans, "_earlier_rounds", AsyncMock(return_value=[])), \
             patch.object(plans, "_write_questions", writer):
            replaced = await plans.generate_plan(db, session, api_key="key", rng=random.Random(3))
        return replaced, db, writer

    def _written(self, db):
        return [call.args[0] for call in db.add.call_args_list]

    async def test_rewrites_the_plan_with_projects_between_the_introduction_and_the_topics(self):
        session = self._session()
        replaced, db, _ = await self._generate(session)
        self.assertTrue(replaced)
        items = self._written(db)
        self.assertEqual([i.section for i in items], ["intro", "project", "project", "topic", "topic", "topic"])
        self.assertEqual([i.position for i in items], list(range(6)))
        self.assertEqual(sum(i.points for i in items), 100)
        self.assertEqual([i.points for i in items[:3]], [10, 12, 13])
        self.assertEqual(session.plan_status, PlanStatus.GENERATED.value)
        self.assertIsNotNone(session.plan_generated_at)

    async def test_topic_questions_are_the_written_ones_and_keep_their_topic(self):
        _, db, _ = await self._generate(self._session())
        topic_items = [i for i in self._written(db) if i.section == "topic"]
        self.assertEqual([i.topic_id for i in topic_items], [t.id for t in TOPICS])
        self.assertTrue(all(i.question.startswith("Walk me through") for i in topic_items))
        self.assertEqual(topic_items[0].expected_points, ["p1", "p2", "p3"])

    async def test_project_questions_name_the_project_and_have_no_topic(self):
        _, db, _ = await self._generate(self._session())
        projects = [i for i in self._written(db) if i.section == "project"]
        self.assertEqual([i.topic_name for i in projects], ["Chat app", "Budget tracker"])
        self.assertTrue(all(i.topic_id is None for i in projects))

    async def test_a_candidate_without_projects_hands_that_weight_to_the_topics(self):
        replaced, db, writer = await self._generate(
            self._session(), resume={"skills": []}, answer=_answer(projects=())
        )
        items = self._written(db)
        self.assertTrue(replaced)
        self.assertEqual([i.section for i in items], ["intro", "topic", "topic", "topic"])
        self.assertEqual([i.points for i in items], [10, 30, 30, 30])
        self.assertEqual(writer.await_args.kwargs["project_questions"], 0)

    async def test_each_topic_is_put_in_an_angle(self):
        _, _, writer = await self._generate(self._session())
        angles = [t["angle"] for t in writer.await_args.kwargs["topics"]]
        self.assertEqual(len(angles), 3)
        self.assertTrue(set(angles) <= set(ANGLES))

    async def test_a_project_the_resume_does_not_have_is_dropped(self):
        _, db, _ = await self._generate(self._session(), answer=_answer(projects=("Invented", "Chat app")))
        self.assertEqual([i.topic_name for i in self._written(db) if i.section == "project"], ["Chat app"])

    async def test_no_more_project_questions_than_asked_for(self):
        _, db, _ = await self._generate(
            self._session(), answer=_answer(projects=("Chat app", "Budget tracker", "Compiler"))
        )
        self.assertEqual(len([i for i in self._written(db) if i.section == "project"]), 2)

    async def test_an_unusable_question_falls_back_to_the_seeded_one(self):
        answer = _answer()
        answer["topics"][0]["question"] = "Write a function that reverses a list."
        answer["topics"][1]["expected_points"] = ["only one"]
        _, db, _ = await self._generate(self._session(), answer=answer)
        topic_items = [i for i in self._written(db) if i.section == "topic"]
        self.assertEqual(topic_items[0].question, TOPICS[0].seed_question)
        self.assertEqual(topic_items[0].expected_points, ["seed a", "seed b"])
        self.assertEqual(topic_items[1].question, TOPICS[1].seed_question)
        self.assertTrue(topic_items[2].question.startswith("Walk me through"))

    async def test_a_repeat_of_an_earlier_question_is_written_again_once(self):
        repeat = "Walk me through how you would handle topic 0 in production."
        retry = {"topics": [{"topic_id": str(TOPICS[0].id), "question": "A cache is stale after a deploy. What do you check first?",
                             "expected_points": ["r1", "r2", "r3"]}]}
        _, db, writer = await self._generate(
            self._session(), asked={TOPICS[0].id: [repeat], TOPICS[1].id: [], TOPICS[2].id: []}, retry=retry
        )
        self.assertEqual(writer.await_count, 2)
        self.assertEqual([t["id"] for t in writer.await_args.kwargs["topics"]], [str(TOPICS[0].id)])
        self.assertEqual(writer.await_args.kwargs["project_questions"], 0)
        first = [i for i in self._written(db) if i.section == "topic"][0]
        self.assertEqual(first.question, "A cache is stale after a deploy. What do you check first?")

    async def test_a_writer_that_fails_leaves_the_seeded_plan(self):
        session = self._session()
        replaced, db, _ = await self._generate(session, writer=AsyncMock(side_effect=RuntimeError("down")))
        self.assertFalse(replaced)
        db.add.assert_not_called()
        self.assertEqual(session.plan_status, PlanStatus.SEEDED.value)

    async def test_only_a_seeded_interview_that_has_not_started_is_rewritten(self):
        for label, session in (
            ("started", self._session(status="in_progress")),
            ("completed", self._session(status="completed")),
            ("already written", self._session(plan_status=PlanStatus.GENERATED.value)),
            ("no plan yet", self._session(plan_status=PlanStatus.PENDING.value)),
        ):
            with self.subTest(label):
                replaced, db, writer = await self._generate(session)
                self.assertFalse(replaced)
                writer.assert_not_awaited()
                db.add.assert_not_called()

    async def test_the_session_row_is_locked_while_the_plan_changes(self):
        _, db, _ = await self._generate(self._session())
        self.assertIn("FOR UPDATE", str(db.execute.await_args_list[0].args[0]))

    async def test_the_mock_writer_produces_a_valid_plan(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=True):
            answer = await plans._write_questions(
                "key", title="T", seniority_level="mid", skills=[], earlier_rounds=[], project_questions=2,
                topics=[{"id": str(t.id), "name": t.name, "angle": "explain"} for t in TOPICS],
                projects=project_material(RESUME),
            )
        for entry in answer["topics"]:
            self.assertIsNotNone(plans._valid_question(entry["question"]))
        for entry in answer["projects"]:
            self.assertIsNotNone(plans._valid_question(entry["question"]))
        self.assertEqual(len(answer["projects"]), 2)


if __name__ == "__main__":
    unittest.main()
