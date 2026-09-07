"""Test-wide setup, imported by pytest before any test module.

APP_ENV is set here rather than in the workflow so the engine is built with a
NullPool: TestClient runs each test on its own event loop, and an asyncpg
connection is bound to the loop that opened it. A pooled connection reused by a
later test fails with "attached to a different loop".
"""

import os

os.environ.setdefault("APP_ENV", "test")
