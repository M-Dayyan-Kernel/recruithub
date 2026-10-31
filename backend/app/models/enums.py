"""Enumerations shared by models, schemas, and prompts."""

from enum import StrEnum


class SeniorityLevel(StrEnum):
    """How senior the role is. It sets the difficulty of every interview question for a job."""

    INTERN = "intern"
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"


SENIORITY_VALUES: tuple[str, ...] = tuple(level.value for level in SeniorityLevel)


class PlanSection(StrEnum):
    """What a plan item is for. Items are asked in this order and carry their section's points."""

    INTRO = "intro"
    PROJECT = "project"
    TOPIC = "topic"


class PlanStatus(StrEnum):
    """Where an interview's question plan stands."""

    #: Not built yet.
    PENDING = "pending"
    #: Built from the job's seed questions. Valid to interview on; also what a failed
    #: personalisation falls back to.
    SEEDED = "seeded"
    #: Written for this candidate from their resume.
    GENERATED = "generated"
    #: The interview is starting on the plan it has; it is no longer rewritten.
    FROZEN = "frozen"
