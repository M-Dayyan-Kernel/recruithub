"""Enumerations shared by models, schemas, and prompts."""

from enum import StrEnum


class SeniorityLevel(StrEnum):
    """How senior the role is. It sets the difficulty of every interview question for a job."""

    INTERN = "intern"
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"


SENIORITY_VALUES: tuple[str, ...] = tuple(level.value for level in SeniorityLevel)
