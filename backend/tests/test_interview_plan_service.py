"""Choosing an interview's topics, splitting the points, and building the plan."""

import random
import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.enums import PlanSection, PlanStatus
from app.services import interview_plan_service as plans
from app.services.interview_plan_service import allocate_points, plan_as_rubric, seeded_items, select_topics


def _topic(n, skill=None, mandatory=False, points=("a", "b")):
    return NS(
        id=uuid.UUID(int=n + 1), name=f"Topic {n}", skill_tag=skill or f"skill-{n}",
        seed_question=f"Explain topic {n}.", seed_expected_points=list(points), is_mandatory=mandatory,
    )


def _pool(size, **kw):
    return [_topic(n, **kw) for n in range(size)]


def _rng():
    return random.Random(7)


class SelectTopicsTests(unittest.TestCase):
    def test_picks_the_configured_number_without_repeats(self):
        chosen = select_topics(_pool(15), rng=_rng())
        self.assertEqual(len(chosen), 5)
        self.assertEqual(len({t.id for t in chosen}), 5)

    def test_a_pool_smaller_than_the_interview_is_asked_in_full(self):
        self.assertEqual(len(select_topics(_pool(3), rng=_rng())), 3)

    def test_mandatory_topics_are_always_asked(self):
        pool = _pool(15)
        pool[3].is_mandatory = pool[11].is_mandatory = True
        for seed in range(20):
            chosen = select_topics(pool, rng=random.Random(seed))
            self.assertIn(pool[3], chosen)
            self.assertIn(pool[11], chosen)

    def test_topics_from_an_earlier_round_are_avoided_while_others_remain(self):
        pool = _pool(15)
        prior = {t.id for t in pool[:5]}
        for seed in range(20):
            chosen = select_topics(pool, prior_topic_ids=prior, rng=random.Random(seed))
            self.assertFalse(prior & {t.id for t in chosen})

    def test_a_short_pool_reaches_back_into_earlier_topics_rather_than_asking_fewer(self):
        pool = _pool(7)
        prior = {t.id for t in pool[:5]}
        chosen = select_topics(pool, prior_topic_ids=prior, rng=_rng())
        self.assertEqual(len(chosen), 5)
        self.assertTrue({pool[5].id, pool[6].id} <= {t.id for t in chosen})

    def test_least_used_topics_are_preferred_so_a_batch_spreads_over_the_pool(self):
        pool = _pool(10)
        usage = {t.id: 9 for t in pool[:5]}  # five topics every earlier candidate got
        for seed in range(20):
            chosen = select_topics(pool, usage=usage, rng=random.Random(seed))
            self.assertEqual({t.id for t in chosen}, {t.id for t in pool[5:]})

    def test_a_batch_of_candidates_covers_the_whole_pool(self):
        pool = _pool(15)
        usage: dict = {}
        rng = random.Random(1)
        for _ in range(3):
            for topic in select_topics(pool, usage=usage, rng=rng):
                usage[topic.id] = usage.get(topic.id, 0) + 1
        self.assertEqual(len(usage), 15)
        self.assertEqual(set(usage.values()), {1})

    def test_no_more_than_the_cap_share_a_skill(self):
        pool = [_topic(n, skill="sql" if n < 6 else f"other-{n}") for n in range(12)]
        for seed in range(30):
            chosen = select_topics(pool, rng=random.Random(seed))
            self.assertLessEqual(sum(t.skill_tag == "sql" for t in chosen), 2)

    def test_the_skill_cap_gives_way_when_the_pool_cannot_fill_the_interview(self):
        chosen = select_topics(_pool(8, skill="sql"), rng=_rng())
        self.assertEqual(len(chosen), 5)

    def test_the_order_varies_between_interviews(self):
        orders = {tuple(t.id for t in select_topics(_pool(15), rng=random.Random(s))) for s in range(10)}
        self.assertGreater(len(orders), 1)


class AllocatePointsTests(unittest.TestCase):
    def _total(self, allocation):
        return sum(sum(points) for points in allocation.values())

    def test_introduction_and_topics_total_100_with_the_project_share_moved_to_topics(self):
        allocation = allocate_points({PlanSection.INTRO: 1, PlanSection.TOPIC: 5})
        self.assertEqual(allocation[PlanSection.INTRO], [10])
        self.assertEqual(allocation[PlanSection.TOPIC], [18] * 5)  # 65 + the 25 nobody used

    def test_all_three_sections_use_their_own_weights(self):
        allocation = allocate_points({PlanSection.INTRO: 1, PlanSection.PROJECT: 2, PlanSection.TOPIC: 5})
        self.assertEqual(allocation[PlanSection.INTRO], [10])
        self.assertEqual(allocation[PlanSection.PROJECT], [12, 13])
        self.assertEqual(allocation[PlanSection.TOPIC], [13] * 5)
        self.assertEqual(self._total(allocation), 100)

    def test_the_last_item_takes_the_remainder(self):
        allocation = allocate_points({PlanSection.INTRO: 1, PlanSection.TOPIC: 7})
        self.assertEqual(allocation[PlanSection.TOPIC], [12] * 6 + [18])
        self.assertEqual(self._total(allocation), 100)

    def test_every_size_adds_up_to_100(self):
        for topics in range(1, 21):
            for projects in range(0, 4):
                counts = {PlanSection.INTRO: 1, PlanSection.PROJECT: projects, PlanSection.TOPIC: topics}
                self.assertEqual(self._total(allocate_points(counts)), 100, counts)

    def test_without_topics_the_heaviest_section_takes_the_rest(self):
        self.assertEqual(allocate_points({PlanSection.INTRO: 1}), {PlanSection.INTRO: [100]})

    def test_nothing_to_ask_allocates_nothing(self):
        self.assertEqual(allocate_points({}), {})
        self.assertEqual(allocate_points({PlanSection.TOPIC: 0}), {})

    def test_no_item_is_worth_nothing(self):
        for points in allocate_points({PlanSection.INTRO: 1, PlanSection.TOPIC: 20}).values():
            self.assertTrue(all(p > 0 for p in points))


class SeededItemsTests(unittest.TestCase):
    def test_the_introduction_comes_first_then_the_topics_in_the_order_given(self):
        topics = _pool(3)
        items = seeded_items(topics)
        self.assertEqual([i["position"] for i in items], [0, 1, 2, 3])
        self.assertEqual(items[0]["section"], PlanSection.INTRO)
        self.assertIsNone(items[0]["topic_id"])
        self.assertEqual([i["topic_id"] for i in items[1:]], [t.id for t in topics])

    def test_each_item_carries_its_question_and_answer_key(self):
        items = seeded_items([_topic(1, points=("x", "y"))])
        self.assertEqual(items[1]["question"], "Explain topic 1.")
        self.assertEqual(items[1]["expected_points"], ["x", "y"])
        self.assertEqual(items[1]["topic_name"], "Topic 1")
        self.assertTrue(items[0]["question"] and items[0]["expected_points"])

    def test_the_points_add_up_to_100(self):
        self.assertEqual(sum(i["points"] for i in seeded_items(_pool(5))), 100)

    def test_a_changed_topic_does_not_change_an_existing_plan(self):
        topic = _topic(1)
        items = seeded_items([topic])
        topic.seed_question = "Edited afterwards."
        self.assertEqual(items[1]["question"], "Explain topic 1.")


class EnsurePlanTests(unittest.IsolatedAsyncioTestCase):
    def _session(self, status=PlanStatus.PENDING.value):
        return NS(id=uuid.uuid4(), candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), plan_status=status)

    def _db(self, topics):
        db = AsyncMock()
        db.add = MagicMock()
        db.get = AsyncMock(return_value=NS(id=uuid.uuid4(), interview_topics=topics))
        return db

    async def _ensure(self, db, session):
        with patch.object(plans, "_prior_topic_ids", AsyncMock(return_value=set())), \
             patch.object(plans, "_topic_usage", AsyncMock(return_value={})):
            return await plans.ensure_plan(db, session, rng=_rng())

    async def test_builds_the_plan_once(self):
        db, session = self._db(_pool(15)), self._session()
        self.assertTrue(await self._ensure(db, session))
        self.assertEqual(db.add.call_count, 6)  # the introduction and five topics
        self.assertEqual(session.plan_status, PlanStatus.SEEDED.value)
        self.assertFalse(await self._ensure(db, session))
        self.assertEqual(db.add.call_count, 6)

    async def test_the_items_belong_to_the_session_and_total_100(self):
        db, session = self._db(_pool(15)), self._session()
        await self._ensure(db, session)
        items = [call.args[0] for call in db.add.call_args_list]
        self.assertTrue(all(i.session_id == session.id for i in items))
        self.assertEqual(sum(i.points for i in items), 100)
        self.assertEqual(items[0].section, "intro")

    async def test_a_job_with_no_topics_gets_no_plan(self):
        db, session = self._db([]), self._session()
        self.assertFalse(await self._ensure(db, session))
        db.add.assert_not_called()
        self.assertEqual(session.plan_status, PlanStatus.PENDING.value)

    async def test_an_interview_that_already_has_a_plan_is_left_alone(self):
        for status in (PlanStatus.SEEDED.value, PlanStatus.GENERATED.value):
            db, session = self._db(_pool(15)), self._session(status)
            self.assertFalse(await self._ensure(db, session))
            db.add.assert_not_called()


class PlanAsRubricTests(unittest.TestCase):
    def test_plan_items_become_the_assessment_rubric(self):
        item = NS(id=uuid.uuid4(), question="Q", points=13, expected_points=["a"], section="topic", topic_name="REST")
        self.assertEqual(
            plan_as_rubric([item]),
            [{"id": str(item.id), "question": "Q", "score": 13, "expected_points": ["a"], "section": "topic", "topic": "REST"}],
        )

    def test_no_plan_is_no_rubric(self):
        self.assertEqual(plan_as_rubric([]), [])


if __name__ == "__main__":
    unittest.main()
