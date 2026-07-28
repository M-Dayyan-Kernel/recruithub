"""Domain exception HTTP mapping."""

import unittest

from app.exceptions import (
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
    ConflictError,
    DomainError,
    NotFoundError,
    ServiceUnavailableError,
    UpstreamError,
    ValidationError,
)


class DomainExceptionTests(unittest.TestCase):
    def test_authentication_error_status(self):
        exc = AuthenticationError(public_message="Invalid email or password")
        self.assertEqual(exc.status_code, 401)
        self.assertIn("WWW-Authenticate", exc.headers or {})

    def test_authorization_error_status(self):
        self.assertEqual(AuthorizationError().status_code, 403)

    def test_not_found_status(self):
        self.assertEqual(NotFoundError().status_code, 404)

    def test_conflict_status(self):
        self.assertEqual(ConflictError().status_code, 409)

    def test_validation_status(self):
        self.assertEqual(ValidationError().status_code, 422)

    def test_bad_request_status(self):
        self.assertEqual(BadRequestError().status_code, 400)

    def test_upstream_status(self):
        self.assertEqual(UpstreamError().status_code, 502)

    def test_service_unavailable_status(self):
        self.assertEqual(ServiceUnavailableError().status_code, 503)

    def test_public_message_preserved(self):
        exc = DomainError(public_message="custom message")
        self.assertEqual(exc.public_message, "custom message")


if __name__ == "__main__":
    unittest.main()
