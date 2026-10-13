"""CandidateUpdate: mandatory fields can never be blanked or malformed."""

import unittest

from pydantic import ValidationError

from app.schemas.schemas import CANDIDATE_STATUSES, CandidateUpdate


def _errors(**kwargs) -> list[str]:
    with unittest.TestCase().assertRaises(ValidationError) as ctx:
        CandidateUpdate(**kwargs)
    return [e["msg"] for e in ctx.exception.errors()]


class MandatoryFieldTests(unittest.TestCase):
    def test_blank_or_whitespace_name_is_rejected(self):
        for blank in ("", "   ", "\t\n"):
            self.assertIn("Name cannot be blank", " ".join(_errors(name=blank)))

    def test_name_is_trimmed_and_whitespace_collapsed(self):
        self.assertEqual(CandidateUpdate(name="  Ada   Lovelace ").name, "Ada Lovelace")

    def test_over_long_name_is_rejected(self):
        self.assertIn("at most 255", " ".join(_errors(name="x" * 256)))

    def test_malformed_email_is_rejected(self):
        for bad in ("nope", "a@", "@b.com", "a b@c.com", ""):
            _errors(email=bad)

    def test_email_is_trimmed_and_lowercased(self):
        self.assertEqual(CandidateUpdate(email="  Ada@Example.COM ").email, "ada@example.com")

    def test_placeholder_email_cannot_be_saved(self):
        # It means "email missing"; accepting it would make the field mandatory in name only.
        msg = " ".join(_errors(email="pending_ab12cd34@upload.pending"))
        self.assertIn("real email", msg)

    def test_omitted_fields_are_left_alone(self):
        update = CandidateUpdate(phone="+91 98765 43210")
        self.assertIsNone(update.name)
        self.assertIsNone(update.email)


class OptionalFieldTests(unittest.TestCase):
    def test_valid_phone_numbers(self):
        for ok in ("+91 98765-43210", "(022) 2345 6789", "9876543210"):
            self.assertEqual(CandidateUpdate(phone=ok).phone, ok)

    def test_invalid_phone_numbers(self):
        for bad in ("12", "abc", "98765abc43", "1" * 16, "+" * 8):
            _errors(phone=bad)

    def test_blank_phone_means_not_provided_never_an_empty_string(self):
        self.assertIsNone(CandidateUpdate(phone="   ").phone)

    def test_status_must_be_known(self):
        for status in CANDIDATE_STATUSES:
            self.assertEqual(CandidateUpdate(status=status).status, status)
        self.assertIn("Status must be one of", " ".join(_errors(status="fired")))

    def test_years_of_experience_range(self):
        self.assertEqual(CandidateUpdate(years_experience=4.5).years_experience, 4.5)
        self.assertEqual(CandidateUpdate(years_experience=0).years_experience, 0)
        for bad in (-1, 61):
            _errors(years_experience=bad)

    def test_free_text_is_trimmed_and_capped(self):
        self.assertEqual(CandidateUpdate(notice_period="  30 days ").notice_period, "30 days")
        self.assertIsNone(CandidateUpdate(current_ctc="   ").current_ctc)
        _errors(expected_ctc="x" * 101)


class OverTheWireTests(unittest.TestCase):
    """The same rules hold for a raw API call, not just the web form."""

    def test_patch_with_blank_name_returns_422(self):
        from fastapi.testclient import TestClient

        import uuid

        from app.dependencies import get_current_user
        from app.main import app
        from app.models.models import User

        hr = User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com",
            full_name="HR", hashed_password="x", role="hr", is_active=True,
        )
        app.dependency_overrides[get_current_user] = lambda: hr
        try:
            response = TestClient(app).patch(
                "/api/candidates/00000000-0000-0000-0000-000000000001",
                json={"name": "   "},
            )
        finally:
            app.dependency_overrides.clear()
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
