"""
T026 - Pharmacy listing endpoints.

GET /pharmacies            — list all active pharmacies with computed is_open field
GET /pharmacies/{pharmacy_id} — retrieve a single pharmacy by UUID
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.pharmacy import Pharmacy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pharmacies", tags=["pharmacies"])


# ---------------------------------------------------------------------------
# Pydantic response schemas
# ---------------------------------------------------------------------------


class PharmacyResponse(BaseModel):
    """Serialised pharmacy DTO returned to clients."""

    id: uuid.UUID
    name: str
    address: str
    phone: str | None
    latitude: float | None
    longitude: float | None
    opens_at: str = Field(description="Opening time in HH:MM format")
    closes_at: str = Field(description="Closing time in HH:MM format")
    is_active: bool
    is_open: bool = Field(description="Whether the pharmacy is currently open")

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


_UZT = timezone(timedelta(hours=5))  # Uzbekistan Time (UTC+5)


def _compute_is_open(pharmacy: Pharmacy) -> bool:
    """Return whether the pharmacy is currently open based on Uzbekistan time.

    Compares the current UZT (UTC+5) wall-clock time against
    ``opens_at`` / ``closes_at``.

    Handles the overnight case (e.g. opens 22:00, closes 02:00) correctly.
    """
    if not pharmacy.is_active:
        return False

    now = datetime.now(tz=_UZT).time().replace(tzinfo=None)
    opens = pharmacy.opens_at
    closes = pharmacy.closes_at

    if opens <= closes:
        # Normal daytime window  e.g. 09:00 – 21:00
        return opens <= now < closes
    else:
        # Overnight window  e.g. 22:00 – 02:00
        return now >= opens or now < closes


def _pharmacy_to_response(pharmacy: Pharmacy) -> PharmacyResponse:
    return PharmacyResponse(
        id=pharmacy.id,
        name=pharmacy.name,
        address=pharmacy.address,
        phone=pharmacy.phone,
        latitude=float(pharmacy.latitude) if pharmacy.latitude is not None else None,
        longitude=float(pharmacy.longitude) if pharmacy.longitude is not None else None,
        opens_at=pharmacy.opens_at.strftime("%H:%M"),
        closes_at=pharmacy.closes_at.strftime("%H:%M"),
        is_active=pharmacy.is_active,
        is_open=_compute_is_open(pharmacy),
    )


# ---------------------------------------------------------------------------
# GET /pharmacies
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[PharmacyResponse],
    summary="List all active pharmacies",
)
async def list_pharmacies(
    include_inactive: bool = Query(
        False,
        description="Set to true to include inactive pharmacies (admin use only)",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[PharmacyResponse]:
    """Return all pharmacies ordered alphabetically.

    Each pharmacy object includes a computed ``is_open`` field that reflects
    whether the pharmacy is currently open based on its ``opens_at`` /
    ``closes_at`` times.

    The ``include_inactive`` query parameter is provided for administrative
    purposes; in production you should guard it behind an admin dependency.
    """
    stmt = select(Pharmacy).order_by(Pharmacy.name)
    if not include_inactive:
        stmt = stmt.where(Pharmacy.is_active.is_(True))

    result = await db.execute(stmt)
    pharmacies = result.scalars().all()

    logger.debug("list_pharmacies: returning %d records", len(pharmacies))
    return [_pharmacy_to_response(p) for p in pharmacies]


# ---------------------------------------------------------------------------
# GET /pharmacies/{pharmacy_id}
# ---------------------------------------------------------------------------


@router.get(
    "/{pharmacy_id}",
    response_model=PharmacyResponse,
    summary="Get a single pharmacy by ID",
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Pharmacy not found"},
    },
)
async def get_pharmacy(
    pharmacy_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> PharmacyResponse:
    """Retrieve a specific pharmacy by its UUID.

    Returns ``404`` if the pharmacy does not exist.  Inactive pharmacies are
    still returned by this endpoint (so deep-linked URLs remain functional);
    callers can check the ``is_active`` field.
    """
    result = await db.execute(
        select(Pharmacy).where(Pharmacy.id == pharmacy_id)
    )
    pharmacy: Pharmacy | None = result.scalar_one_or_none()

    if pharmacy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pharmacy with ID {pharmacy_id} not found",
        )

    return _pharmacy_to_response(pharmacy)
