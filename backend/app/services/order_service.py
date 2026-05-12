"""Order service for order lifecycle management."""

import random
import string
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.medicine import MedicineAvailability
from app.models.order import (
    Order,
    OrderItem,
    OrderStatus,
    OrderType,
)
from app.models.pharmacy import Pharmacy


class CancelLimitExceededError(ValueError):
    """Raised when a user has reached the ready-order cancel quota."""


class OrderService:
    """Service layer for order lifecycle operations."""

    # Customer cancel: CREATED freely; READY only within quota.
    CUSTOMER_CANCELLABLE_STATES = {OrderStatus.CREATED, OrderStatus.READY}
    # Staff cancel: same states but no quota.
    STAFF_CANCELLABLE_STATES = {OrderStatus.CREATED, OrderStatus.READY}
    # Reject: only before staff confirms (i.e. before READY).
    REJECTABLE_STATES = {OrderStatus.CREATED}

    READY_CANCEL_LIMIT = 3
    READY_CANCEL_WINDOW_DAYS = 30

    def generate_order_number(self) -> str:
        """Generate unique order number like 'ORD-20260223-XXXX'."""
        date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
        random_part = "".join(
            random.choices(string.ascii_uppercase + string.digits, k=4)
        )
        return f"ORD-{date_part}-{random_part}"

    async def create_order(
        self,
        db: AsyncSession,
        user_id: UUID,
        pharmacy_id: UUID,
        order_type: OrderType,
        items: list[dict] | None = None,
        notes: str | None = None,
        contact_phone: str | None = None,
        recipient_name: str | None = None,
    ) -> Order:
        """Create order with items, validate pharmacy exists.

        Pre-fills unit_price and total_price from the pharmacy catalog when
        every item has a price; staff can still adjust before confirming.
        Sets expires_at to 2 hours from now.
        """
        stmt = select(Pharmacy).where(Pharmacy.id == pharmacy_id)
        result = await db.execute(stmt)
        pharmacy = result.scalar_one_or_none()
        if pharmacy is None:
            raise ValueError("Pharmacy not found")

        now = datetime.now(timezone.utc)
        order = Order(
            order_number=self.generate_order_number(),
            user_id=user_id,
            pharmacy_id=pharmacy_id,
            order_type=order_type,
            status=OrderStatus.CREATED,
            notes=notes,
            contact_phone=contact_phone,
            recipient_name=recipient_name,
            expires_at=now + timedelta(hours=2),
        )
        db.add(order)
        await db.flush()

        if items:
            medicine_ids = [i["medicine_id"] for i in items if i.get("medicine_id")]
            price_map: dict[str, Decimal] = {}
            if medicine_ids:
                avail_stmt = select(MedicineAvailability).where(
                    and_(
                        MedicineAvailability.pharmacy_id == pharmacy_id,
                        MedicineAvailability.medicine_id.in_(medicine_ids),
                        MedicineAvailability.is_available == True,  # noqa: E712
                        MedicineAvailability.price.isnot(None),
                    )
                )
                avail_result = await db.execute(avail_stmt)
                for avail in avail_result.scalars().all():
                    price_map[str(avail.medicine_id)] = Decimal(str(avail.price))

            all_priced = True
            total = Decimal("0")

            for item_data in items:
                med_id = item_data.get("medicine_id")
                catalog_price = price_map.get(str(med_id)) if med_id else None
                qty = item_data.get("quantity", 1)

                order_item = OrderItem(
                    order_id=order.id,
                    medicine_id=med_id,
                    medicine_name=item_data.get("medicine_name", ""),
                    quantity=qty,
                    unit_price=catalog_price,
                )
                db.add(order_item)

                if catalog_price is not None:
                    total += catalog_price * qty
                else:
                    all_priced = False

            if all_priced and items:
                order.total_price = total

        await db.commit()
        return await self.get_order(db, order.id)  # type: ignore[return-value]

    async def get_order(
        self,
        db: AsyncSession,
        order_id: UUID,
    ) -> Order | None:
        """Get order with items, prescriptions, pharmacy, and user."""
        stmt = (
            select(Order)
            .where(Order.id == order_id)
            .options(
                selectinload(Order.items),
                selectinload(Order.prescriptions),
                selectinload(Order.pharmacy),
                selectinload(Order.user),
            )
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_user_orders(
        self,
        db: AsyncSession,
        user_id: UUID,
        status: OrderStatus | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Order], int]:
        """List orders for user with optional status filter."""
        base_filter = [Order.user_id == user_id]
        if status is not None:
            base_filter.append(Order.status == status)

        count_stmt = select(func.count(Order.id)).where(*base_filter)
        total = (await db.execute(count_stmt)).scalar() or 0

        stmt = (
            select(Order)
            .where(*base_filter)
            .options(
                selectinload(Order.items),
                selectinload(Order.pharmacy),
            )
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await db.execute(stmt)
        return list(result.scalars().unique().all()), total

    # ── Cancel quota ─────────────────────────────────────────────────

    async def count_recent_ready_cancellations(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> int:
        """Count cancellations of READY orders by this user in the rolling window."""
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=self.READY_CANCEL_WINDOW_DAYS
        )
        stmt = select(func.count(Order.id)).where(
            and_(
                Order.user_id == user_id,
                Order.status == OrderStatus.CANCELLED,
                Order.ready_at.is_not(None),
                Order.cancelled_at.is_not(None),
                Order.cancelled_at >= cutoff,
            )
        )
        result = await db.execute(stmt)
        return result.scalar() or 0

    async def get_cancel_availability(
        self,
        db: AsyncSession,
        order: Order,
    ) -> tuple[bool, str | None]:
        """Whether the customer can cancel this order, with i18n reason key when not."""
        if order.status == OrderStatus.CREATED:
            return True, None
        if order.status == OrderStatus.READY:
            count = await self.count_recent_ready_cancellations(db, order.user_id)
            if count >= self.READY_CANCEL_LIMIT:
                return False, "ready_cancel_limit_exceeded"
            return True, None
        return False, "wrong_state"

    async def cancel_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        user_id: UUID,
    ) -> Order:
        """Customer cancel. Free from CREATED; from READY only within quota."""
        order = await self._get_order_or_raise(db, order_id)

        if order.user_id != user_id:
            raise ValueError("Order does not belong to this user")
        if order.status not in self.CUSTOMER_CANCELLABLE_STATES:
            raise ValueError(f"Cannot cancel order in '{order.status.value}' state.")

        if order.status == OrderStatus.READY:
            count = await self.count_recent_ready_cancellations(db, user_id)
            if count >= self.READY_CANCEL_LIMIT:
                raise CancelLimitExceededError(
                    f"Cancel limit reached: {count}/{self.READY_CANCEL_LIMIT} "
                    f"in the last {self.READY_CANCEL_WINDOW_DAYS} days"
                )

        order.status = OrderStatus.CANCELLED
        order.cancelled_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def staff_cancel_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
    ) -> Order:
        """Staff cancel from CREATED or READY. No quota."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status not in self.STAFF_CANCELLABLE_STATES:
            raise ValueError(f"Cannot cancel order in '{order.status.value}' state.")

        order.status = OrderStatus.CANCELLED
        order.cancelled_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    # ── Pharmacy queue ───────────────────────────────────────────────

    async def list_pharmacy_orders(
        self,
        db: AsyncSession,
        pharmacy_id: UUID,
        status: OrderStatus | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Order], int]:
        """List orders for a pharmacy with total count."""
        base_filter = [Order.pharmacy_id == pharmacy_id]
        if status is not None:
            base_filter.append(Order.status == status)

        count_stmt = select(func.count(Order.id)).where(*base_filter)
        total = (await db.execute(count_stmt)).scalar() or 0

        stmt = (
            select(Order)
            .where(*base_filter)
            .options(
                selectinload(Order.items),
                selectinload(Order.prescriptions),
                selectinload(Order.pharmacy),
                selectinload(Order.user),
            )
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await db.execute(stmt)
        return list(result.scalars().unique().all()), total

    async def claim_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
    ) -> Order:
        """First-to-act claim (set staff_id only if null)."""
        order = await self._get_order_or_raise(db, order_id)

        if order.staff_id is not None:
            raise ValueError("Order has already been claimed by another staff member")

        order.staff_id = staff_id

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    # ── Staff edits ──────────────────────────────────────────────────

    async def update_order_items(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
        items: list[dict],
        total_price: Decimal | None = None,
    ) -> Order:
        """Replace items + total_price on a CREATED order. No state change.

        items: list of {medicine_id?, medicine_name, quantity, unit_price?}
        """
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status != OrderStatus.CREATED:
            raise ValueError(
                f"Cannot edit order in '{order.status.value}' state. "
                f"Only 'created' orders can be edited."
            )

        await db.execute(delete(OrderItem).where(OrderItem.order_id == order_id))

        for item_data in items:
            unit_price = item_data.get("unit_price")
            order_item = OrderItem(
                order_id=order_id,
                medicine_id=item_data.get("medicine_id"),
                medicine_name=item_data.get("medicine_name", ""),
                quantity=item_data.get("quantity", 1),
                unit_price=Decimal(str(unit_price)) if unit_price is not None else None,
            )
            db.add(order_item)

        if total_price is not None:
            order.total_price = total_price

        # Claim the order if it isn't already claimed
        if order.staff_id is None:
            order.staff_id = staff_id

        await db.commit()
        # Session uses expire_on_commit=False, so items loaded earlier aren't
        # invalidated after the DELETE/INSERT above. Drop the cached items so
        # the response reflects the rows we just inserted.
        db.expire_all()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def confirm_to_ready(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
    ) -> Order:
        """CREATED -> READY. Sets ready_at."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status != OrderStatus.CREATED:
            raise ValueError(
                f"Cannot confirm order in '{order.status.value}' state. "
                f"Order must be in 'created' state."
            )
        if order.total_price is None or order.total_price <= 0:
            raise ValueError("Cannot confirm order without a total price.")

        order.status = OrderStatus.READY
        order.ready_at = datetime.now(timezone.utc)
        if order.staff_id is None:
            order.staff_id = staff_id

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def mark_complete(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
    ) -> Order:
        """READY -> COMPLETED. Set completed_at."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status != OrderStatus.READY:
            raise ValueError(
                f"Cannot complete order in '{order.status.value}' state. "
                f"Order must be in 'ready' state to complete."
            )

        order.status = OrderStatus.COMPLETED
        order.completed_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def reject_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
        reason: str,
    ) -> Order:
        """Reject from CREATED with reason."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status not in self.REJECTABLE_STATES:
            raise ValueError(f"Cannot reject order in '{order.status.value}' state.")

        order.status = OrderStatus.REJECTED
        order.rejection_reason = reason
        order.rejected_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def reorder(
        self,
        db: AsyncSession,
        order_id: UUID,
        user_id: UUID,
    ) -> Order:
        """Clone items from completed order into new order."""
        original = await self.get_order(db, order_id)
        if original is None:
            raise ValueError("Order not found")
        if original.user_id != user_id:
            raise ValueError("Order does not belong to this user")
        if original.status != OrderStatus.COMPLETED:
            raise ValueError("Can only reorder from a completed order")

        items = []
        for item in original.items:
            items.append(
                {
                    "medicine_id": item.medicine_id,
                    "medicine_name": item.medicine_name,
                    "quantity": item.quantity,
                }
            )

        new_order = await self.create_order(
            db=db,
            user_id=user_id,
            pharmacy_id=original.pharmacy_id,
            order_type=original.order_type,
            items=items,
            notes=original.notes,
        )
        return new_order

    # ── Private helpers ──────────────────────────────────────────────

    async def _get_order_or_raise(self, db: AsyncSession, order_id: UUID) -> Order:
        """Fetch an order by ID or raise ValueError."""
        stmt = select(Order).where(Order.id == order_id)
        result = await db.execute(stmt)
        order = result.scalar_one_or_none()
        if order is None:
            raise ValueError("Order not found")
        return order

    @staticmethod
    def _validate_staff(order: Order, staff_id: UUID) -> None:
        """Ensure the staff member is assigned to this order (if claimed)."""
        if order.staff_id is not None and order.staff_id != staff_id:
            raise ValueError("This order is assigned to a different staff member")


order_service = OrderService()
