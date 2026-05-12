"""
Admin API endpoints for pharmacy management.

Protected by admin_telegram_id check.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.db.session import get_db
from app.models.analytics_event import AnalyticsEvent
from app.models.order import Order
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
    response_model=None,
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


# ---------------------------------------------------------------------------
# GET /admin/stats — acquisition funnel + sources for the last N days
# ---------------------------------------------------------------------------


FUNNEL_STEPS = ("bot_start", "phone_shared", "webapp_opened", "order_placed")


class FunnelStep(BaseModel):
    name: str
    users: int
    events: int


class DailyCount(BaseModel):
    date: str
    new_users: int


class SourceBreakdown(BaseModel):
    source: str | None
    users: int


class StatsResponse(BaseModel):
    days: int
    since: datetime
    total_users: int
    total_orders: int
    funnel: list[FunnelStep]
    new_users_by_day: list[DailyCount]
    top_sources: list[SourceBreakdown]


@router.get(
    "/stats",
    response_model=StatsResponse,
    summary="Acquisition funnel and source breakdown",
)
async def get_stats(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StatsResponse:
    since = datetime.now(timezone.utc) - timedelta(days=days)

    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_orders = (await db.execute(select(func.count(Order.id)))).scalar_one()

    funnel: list[FunnelStep] = []
    for step in FUNNEL_STEPS:
        rows = await db.execute(
            select(
                func.count(func.distinct(AnalyticsEvent.user_id)),
                func.count(AnalyticsEvent.id),
            ).where(
                AnalyticsEvent.name == step,
                AnalyticsEvent.created_at >= since,
            )
        )
        users_count, events_count = rows.one()
        funnel.append(
            FunnelStep(name=step, users=users_count or 0, events=events_count or 0)
        )

    daily_rows = await db.execute(
        select(
            func.date_trunc("day", User.created_at).label("day"),
            func.count(User.id),
        )
        .where(User.created_at >= since)
        .group_by("day")
        .order_by("day")
    )
    new_users_by_day = [
        DailyCount(date=day.date().isoformat(), new_users=count)
        for day, count in daily_rows.all()
    ]

    source_rows = await db.execute(
        select(User.source, func.count(User.id))
        .where(User.created_at >= since)
        .group_by(User.source)
        .order_by(func.count(User.id).desc())
        .limit(20)
    )
    top_sources = [
        SourceBreakdown(source=src, users=cnt) for src, cnt in source_rows.all()
    ]

    return StatsResponse(
        days=days,
        since=since,
        total_users=total_users,
        total_orders=total_orders,
        funnel=funnel,
        new_users_by_day=new_users_by_day,
        top_sources=top_sources,
    )
