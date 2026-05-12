"""Analytics event logging.

Fire-and-forget: failures are logged but never propagated to the caller, so a
broken events table can't take down user-facing requests.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.db.session import async_session
from app.models.analytics_event import AnalyticsEvent

logger = logging.getLogger(__name__)


async def log_event(
    name: str,
    *,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
    **properties: Any,
) -> None:
    """Persist one analytics event in its own short-lived session."""
    try:
        async with async_session() as session:
            session.add(
                AnalyticsEvent(
                    name=name,
                    user_id=user_id,
                    source=source,
                    properties=properties or {},
                )
            )
            await session.commit()
    except Exception:
        logger.exception("analytics.log_event(%r) failed", name)
