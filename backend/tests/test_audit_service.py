"""AuditService redaction tests."""

import unittest

from app.services.audit_service import redact_state


class AuditServiceTests(unittest.TestCase):
    def test_redact_password_fields(self):
        state = {"email": "a@b.com", "password": "secret", "role": "hr"}
        redacted = redact_state(state)
        self.assertEqual(redacted["password"], "[redacted]")
        self.assertEqual(redacted["email"], "a@b.com")

    def test_redact_none_state(self):
        self.assertIsNone(redact_state(None))


if __name__ == "__main__":
    unittest.main()


class AuditListFilterTests(unittest.TestCase):
    """The Activity page filters by kind of activity, and links rows to their candidate."""

    @staticmethod
    def _sql(**kw):
        import uuid
        from sqlalchemy.dialects import postgresql
        from app.repositories.audit_log_repository import AuditLogRepository

        filters = AuditLogRepository.build_filters(tenant_id=uuid.uuid4(), **kw)
        return [str(f.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False})) for f in filters]

    def test_category_matches_the_start_of_the_action_name(self):
        clauses = " ".join(self._sql(category="screening"))
        self.assertIn("audit_logs.action LIKE", clauses)

    def test_category_is_a_prefix_match_not_an_entity_match(self):
        # screening.triggered is recorded against a job; entity_type would miss it.
        clauses = " ".join(self._sql(category="screening"))
        self.assertNotIn("entity_type", clauses)

    def test_category_value_is_escaped(self):
        # A "%" or "_" in the value must not act as a LIKE wildcard.
        import uuid
        from sqlalchemy.dialects import postgresql
        from app.repositories.audit_log_repository import AuditLogRepository

        (_, clause) = AuditLogRepository.build_filters(tenant_id=uuid.uuid4(), category="100%_x")
        sql = str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        self.assertIn("ESCAPE '/'", sql)
        # Each wildcard is preceded by the escape character (the compiler prints a literal
        # percent doubled, hence the "+").
        self.assertRegex(sql, r"100/%+/_x")

    def test_no_category_adds_no_clause(self):
        self.assertEqual(len(self._sql()), 1)  # tenant scope only

    def test_the_response_carries_the_candidate_id(self):
        from app.schemas.schemas import AuditLogResponse

        self.assertIn("candidate_id", AuditLogResponse.model_fields)

    def test_the_router_only_accepts_known_categories(self):
        import re
        from app.routers.audit import list_audit_logs  # noqa: F401  (imports cleanly)
        import inspect

        param = inspect.signature(list_audit_logs).parameters["category"].default
        pattern = next(m.pattern for m in param.metadata if hasattr(m, "pattern"))
        for ok in ("candidate", "job", "screening", "shortlist", "interview", "user", "settings"):
            self.assertTrue(re.match(pattern, ok), ok)
        for bad in ("", "candidate.", "cand", "tenant", "x%", "job OR 1=1"):
            self.assertFalse(re.match(pattern, bad), bad)
