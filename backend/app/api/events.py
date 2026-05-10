"""Server-Sent Events endpoints for real-time order updates.

GET /events/staff?token=...           — pharmacy-wide stream for staff
GET /events/orders/{order_id}?token=...  — single-order stream for customers

EventSource cannot send custom headers, so the auth token is passed as a
query parameter. Both ``Bearer <jwt>`` and ``tma <initData>`` style tokens
are accepted (the scheme is detected automatically).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.db.session import get_db
from app.models.staff import PharmacyStaff
from app.models.user import User
from app.services.event_broker import broker
from app.services.order_service import order_service
from app.services.telegram_auth import validate_init_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])

PING_INTERVAL_SECONDS = 25


async def _resolve_user_from_token(token: str, db: AsyncSession) -> User | None:
    """Resolve a User from either a JWT or Telegram initData token."""
    # JWT path
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except (JWTError, KeyError, ValueError):
        payload = None

    if payload:
        uid = payload.get("uid")
        if uid:
            try:
                stmt = select(User).where(User.id == uuid.UUID(uid))
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()
                if user is not None:
                    return user
            except ValueError:
                pass
        sub = payload.get("sub")
        if sub:
            try:
                stmt = select(User).where(User.telegram_user_id == int(sub))
                result = await db.execute(stmt)
                user = result.scalar_one_or_none()
                if user is not None:
                    return user
            except (ValueError, TypeError):
                pass

    # Telegram initData path
    parsed = validate_init_data(token, settings.telegram_bot_token)
    if parsed is None:
        return None

    tg_user = parsed.get("user", {}) or {}
    telegram_user_id = tg_user.get("id")
    if not telegram_user_id:
        return None

    stmt = select(User).where(User.telegram_user_id == telegram_user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _resolve_staff_from_token(
    token: str, db: AsyncSession
) -> PharmacyStaff | None:
    user = await _resolve_user_from_token(token, db)
    if user is None:
        return None

    from sqlalchemy import or_

    id_conditions = []
    if user.id:
        id_conditions.append(PharmacyStaff.user_id == user.id)
    if user.telegram_user_id:
        id_conditions.append(PharmacyStaff.telegram_user_id == user.telegram_user_id)
    if not id_conditions:
        return None

    stmt = (
        select(PharmacyStaff)
        .where(PharmacyStaff.is_active.is_(True), or_(*id_conditions))
        .options(selectinload(PharmacyStaff.pharmacy))
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _stream(request: Request, channels: list[str]) -> AsyncIterator[dict]:
    """Yield SSE events from broker subscriptions, with periodic pings."""
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=64)

    async def relay() -> None:
        async for event in broker.subscribe(channels):
            await queue.put(event)

    relay_task = asyncio.create_task(relay())
    yield {"event": "ready", "data": "{}"}
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(
                    queue.get(), timeout=PING_INTERVAL_SECONDS
                )
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}
                continue

            event_type = event.get("type", "message")
            import json

            yield {"event": event_type, "data": json.dumps(event)}
    finally:
        relay_task.cancel()
        try:
            await relay_task
        except (asyncio.CancelledError, Exception):
            pass


@router.get("/staff", summary="SSE stream of order events for the staff's pharmacy")
async def staff_event_stream(
    request: Request,
    token: str = Query(..., description="JWT or Telegram initData"),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    staff = await _resolve_staff_from_token(token, db)
    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or non-staff token",
        )

    channel = f"pharmacy:{staff.pharmacy_id}"
    return EventSourceResponse(_stream(request, [channel]))


@router.get(
    "/orders/{order_id}",
    summary="SSE stream of events for a single order (customer)",
)
async def order_event_stream(
    request: Request,
    order_id: uuid.UUID,
    token: str = Query(..., description="JWT or Telegram initData"),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    user = await _resolve_user_from_token(token, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    order = await order_service.get_order(db, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )

    channel = f"order:{order_id}"
    return EventSourceResponse(_stream(request, [channel]))
