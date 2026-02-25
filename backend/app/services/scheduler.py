"""
T083 - Auto-cancel background scheduler.

Periodically checks for stale orders and applies auto-cancellation:
  - CREATED orders with no staff response after 30 min → send delay notification
  - PRICED orders with no customer response after 2 hours → cancel
  - READY orders with no pickup after 24 hours → cancel

Run as a background task via asyncio.create_task in the FastAPI lifespan.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.models.order import Order, OrderStatus

logger = logging.getLogger(__name__)

# Intervals
CHECK_INTERVAL_SECONDS = 60  # Check every minute
CREATED_DELAY_NOTIFY_MINUTES = 30
PRICED_CANCEL_HOURS = 2
READY_CANCEL_HOURS = 24


async def _process_stale_orders() -> None:
    """Single pass through stale orders."""
    now = datetime.now(tz=timezone.utc)

    async with async_session() as session:
        # 1. CREATED orders older than 30 min (delay notification)
        # We mark them by setting expires_at if not already set
        created_cutoff = now - timedelta(minutes=CREATED_DELAY_NOTIFY_MINUTES)
        result = await session.execute(
            select(Order).where(
                and_(
                    Order.status == OrderStatus.CREATED,
                    Order.created_at < created_cutoff,
                    Order.expires_at.is_(None),
                )
            )
        )
        stale_created = result.scalars().all()
        for order in stale_created:
            order.expires_at = now + timedelta(hours=PRICED_CANCEL_HOURS)
            logger.info(
                "Order %s (CREATED) has no staff response after %d min, set expiry",
                order.order_number,
                CREATED_DELAY_NOTIFY_MINUTES,
            )

        # 2. PRICED orders older than 2 hours → cancel
        priced_cutoff = now - timedelta(hours=PRICED_CANCEL_HOURS)
        result = await session.execute(
            select(Order).where(
                and_(
                    Order.status == OrderStatus.PRICED,
                    Order.priced_at < priced_cutoff,
                )
            )
        )
        stale_priced = result.scalars().all()
        for order in stale_priced:
            order.status = OrderStatus.CANCELLED
            order.cancelled_at = now
            order.rejection_reason = "Auto-cancelled: no customer response within 2 hours"
            logger.info("Auto-cancelled PRICED order %s", order.order_number)

        # 3. READY orders older than 24 hours → cancel
        ready_cutoff = now - timedelta(hours=READY_CANCEL_HOURS)
        result = await session.execute(
            select(Order).where(
                and_(
                    Order.status == OrderStatus.READY,
                    Order.ready_at < ready_cutoff,
                )
            )
        )
        stale_ready = result.scalars().all()
        for order in stale_ready:
            order.status = OrderStatus.CANCELLED
            order.cancelled_at = now
            order.rejection_reason = "Auto-cancelled: not picked up within 24 hours"
            logger.info("Auto-cancelled READY order %s", order.order_number)

        await session.commit()

        total = len(stale_created) + len(stale_priced) + len(stale_ready)
        if total > 0:
            logger.info(
                "Scheduler pass: %d notified, %d priced cancelled, %d ready cancelled",
                len(stale_created),
                len(stale_priced),
                len(stale_ready),
            )


async def run_scheduler() -> None:
    """Run the order auto-cancel scheduler loop."""
    logger.info("Order scheduler started (interval=%ds)", CHECK_INTERVAL_SECONDS)
    while True:
        try:
            await _process_stale_orders()
        except Exception:
            logger.exception("Scheduler error")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
