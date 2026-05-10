"""In-memory pub/sub broker for Server-Sent Events.

Each subscriber receives an asyncio.Queue scoped to a channel string.
Publishers fan out a single payload to every subscriber on that channel.

Channel naming convention:
    pharmacy:{pharmacy_id}   — all order events for a pharmacy (staff stream)
    user:{user_id}           — all order events for a customer
    order:{order_id}         — events for one specific order

A single mutation typically fans out to multiple channels (e.g. confirming
an order publishes to pharmacy:X, user:Y, and order:Z).

Single-process only — for multi-worker deployments switch to Postgres
LISTEN/NOTIFY or Redis pub/sub.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)

QUEUE_MAXSIZE = 64


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(
            set
        )
        self._lock = asyncio.Lock()

    async def publish(self, channels: str | list[str], event: dict[str, Any]) -> None:
        """Fan out an event to every subscriber on the given channel(s)."""
        targets = [channels] if isinstance(channels, str) else channels
        async with self._lock:
            queues: list[asyncio.Queue[dict[str, Any]]] = []
            for ch in targets:
                queues.extend(self._subscribers.get(ch, ()))

        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "event broker queue full, dropping event %s", event.get("type")
                )

    async def subscribe(
        self, channels: str | list[str]
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield events for the given channel(s) until the consumer cancels."""
        targets = [channels] if isinstance(channels, str) else channels
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)

        async with self._lock:
            for ch in targets:
                self._subscribers[ch].add(queue)

        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            async with self._lock:
                for ch in targets:
                    self._subscribers[ch].discard(queue)
                    if not self._subscribers[ch]:
                        self._subscribers.pop(ch, None)


broker = EventBroker()


async def publish_order_event(order, event_type: str) -> None:
    """Fan out an order mutation to pharmacy, user, and order-specific channels."""
    payload = {
        "type": event_type,
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": order.status.value
        if hasattr(order.status, "value")
        else order.status,
    }
    channels = [
        f"pharmacy:{order.pharmacy_id}",
        f"order:{order.id}",
    ]
    if order.user_id:
        channels.append(f"user:{order.user_id}")
    await broker.publish(channels, payload)
