"""Shared pagination helpers for list endpoints."""

from __future__ import annotations

from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginationParams:
    def __init__(
        self,
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ):
        self.limit = limit
        self.offset = offset


class PaginatedResult(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
