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
