"""ShortlistBatchStore tests."""

import json
import unittest
import uuid
from unittest.mock import MagicMock, patch

from app.services.shortlist_batch_store import ShortlistBatchStore


class ShortlistBatchStoreTests(unittest.TestCase):
    def test_acquire_lock_uses_nx_ex(self):
        client = MagicMock()
        client.set.return_value = True
        store = ShortlistBatchStore(ttl_seconds=60)

        with patch.object(store, "_client", return_value=client):
            job_id = uuid.uuid4()
            self.assertTrue(store.acquire_lock(job_id))
            client.set.assert_called_once_with(
                f"shortlist_lock:{job_id}", "1", nx=True, ex=300
            )

    def test_prepare_batch_sets_keys(self):
        client = MagicMock()
        store = ShortlistBatchStore(ttl_seconds=120)
        job_id = uuid.uuid4()
        ids = ["a", "b"]

        with patch.object(store, "_client", return_value=client):
            store.prepare_batch(job_id, ids)
            client.set.assert_any_call(
                f"shortlist_batch:{job_id}", json.dumps(ids), ex=120
            )
            client.set.assert_any_call(f"shortlist_failed:{job_id}", "0", ex=120)

    def test_read_status_parses_batch(self):
        client = MagicMock()
        client.exists.return_value = 1
        client.get.side_effect = [
            json.dumps(["id1", "id2"]).encode(),
            b"1",
        ]
        store = ShortlistBatchStore()
        job_id = uuid.uuid4()

        with patch.object(store, "_client", return_value=client):
            in_progress, candidate_ids, failed = store.read_status(job_id)

        self.assertTrue(in_progress)
        self.assertEqual(candidate_ids, ["id1", "id2"])
        self.assertEqual(failed, 1)


if __name__ == "__main__":
    unittest.main()
