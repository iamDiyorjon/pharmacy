"""
Admin API endpoints for pharmacy management.

Protected by admin_telegram_id check.
"""

from __future__ import annotations

import logging
import uuid
from datetime import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.db.session import get_db
from app.models.pharmacy import Pharmacy
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Admin guard
# ---------------------------------------------------------------------------

async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Check that the current user is the admin."""
    if current_user.telegram_user_id != settings.admin_telegram_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PharmacyCreate(BaseModel):
    name: str
    address: str
    phone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    opens_at: str = "08:00"
    closes_at: str = "22:00"


class PharmacyUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    opens_at: str | None = None
    closes_at: str | None = None
    is_active: bool | None = None


class PharmacyResponse(BaseModel):
    id: str
    name: str
    address: str
    phone: str | None
    latitude: float | None
    longitude: float | None
    opens_at: str
    closes_at: str
    is_active: bool

    model_config = {"from_attributes": True}


def _parse_time(value: str) -> time:
    """Parse HH:MM string to time object."""
    parts = value.split(":")
    return time(int(parts[0]), int(parts[1]))


def _pharmacy_to_response(p: Pharmacy) -> PharmacyResponse:
    return PharmacyResponse(
        id=str(p.id),
        name=p.name,
        address=p.address,
        phone=p.phone,
        latitude=float(p.latitude) if p.latitude else None,
        longitude=float(p.longitude) if p.longitude else None,
        opens_at=p.opens_at.strftime("%H:%M"),
        closes_at=p.closes_at.strftime("%H:%M"),
        is_active=p.is_active,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/pharmacies",
    response_model=PharmacyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new pharmacy",
)
async def create_pharmacy(
    body: PharmacyCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PharmacyResponse:
    pharmacy = Pharmacy(
        name=body.name,
        address=body.address,
        phone=body.phone,
        latitude=body.latitude,
        longitude=body.longitude,
        opens_at=_parse_time(body.opens_at),
        closes_at=_parse_time(body.closes_at),
        is_active=True,
    )
    db.add(pharmacy)
    await db.commit()
    await db.refresh(pharmacy)
    logger.info("Admin created pharmacy: %s", pharmacy.name)
    return _pharmacy_to_response(pharmacy)


@router.put(
    "/pharmacies/{pharmacy_id}",
    response_model=PharmacyResponse,
    summary="Update a pharmacy",
)
async def update_pharmacy(
    pharmacy_id: uuid.UUID,
    body: PharmacyUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PharmacyResponse:
    result = await db.execute(select(Pharmacy).where(Pharmacy.id == pharmacy_id))
    pharmacy = result.scalar_one_or_none()
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field in ("opens_at", "closes_at") and value is not None:
            setattr(pharmacy, field, _parse_time(value))
        else:
            setattr(pharmacy, field, value)

    await db.commit()
    await db.refresh(pharmacy)
    logger.info("Admin updated pharmacy: %s", pharmacy.name)
    return _pharmacy_to_response(pharmacy)


@router.delete(
    "/pharmacies/{pharmacy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deactivate a pharmacy",
)
async def delete_pharmacy(
    pharmacy_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    result = await db.execute(select(Pharmacy).where(Pharmacy.id == pharmacy_id))
    pharmacy = result.scalar_one_or_none()
    if pharmacy is None:
        raise HTTPException(status_code=404, detail="Pharmacy not found")

    pharmacy.is_active = False
    await db.commit()
    logger.info("Admin deactivated pharmacy: %s", pharmacy.name)
