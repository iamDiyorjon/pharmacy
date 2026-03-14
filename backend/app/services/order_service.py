"""Order service for order lifecycle management."""

import random
import string
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import (
    Order,
    OrderItem,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PaymentStatus,
)
from app.models.pharmacy import Pharmacy
from app.models.medicine import Medicine, MedicineAvailability


class OrderService:
    """Service layer for order lifecycle operations."""

    # Valid state transitions
    CANCELLABLE_STATES = {OrderStatus.CREATED, OrderStatus.PRICED, OrderStatus.CONFIRMED}
    REJECTABLE_STATES = {OrderStatus.CREATED, OrderStatus.PRICED, OrderStatus.CONFIRMED}

    def generate_order_number(self) -> str:
        """Generate unique order number like 'ORD-20260223-XXXX'."""
        date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
        random_part = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        return f"ORD-{date_part}-{random_part}"

    async def create_order(
        self,
        db: AsyncSession,
        user_id: UUID,
        pharmacy_id: UUID,
        order_type: OrderType,
        items: list[dict] | None = None,
        notes: str | None = None,
    ) -> Order:
        """Create order with items, validate pharmacy is open.

        Sets expires_at to 2 hours from now.
        """
        # Validate pharmacy exists
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
            expires_at=now + timedelta(hours=2),
        )
        db.add(order)
        await db.flush()

        if items:
            # Collect medicine_ids to look up catalog prices in one query
            medicine_ids = [
                i["medicine_id"] for i in items if i.get("medicine_id")
            ]
            price_map: dict[str, Decimal] = {}
            if medicine_ids:
                avail_stmt = select(MedicineAvailability).where(
                    and_(
                        MedicineAvailability.pharmacy_id == pharmacy_id,
                        MedicineAvailability.medicine_id.in_(medicine_ids),
                        MedicineAvailability.is_available == True,
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
                catalog_price = price_map.get(med_id) if med_id else None
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

            # Auto-set to PRICED if all items have catalog prices
            if all_priced and items:
                order.total_price = total
                order.status = OrderStatus.PRICED
                order.priced_at = now

        await db.commit()

        # Reload with relationships for the response
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

    async def confirm_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        user_id: UUID,
        payment_method: str = "cash",
    ) -> Order:
        """Transition PRICED -> CONFIRMED. Set payment_method and payment_status."""
        order = await self._get_order_or_raise(db, order_id)

        if order.user_id != user_id:
            raise ValueError("Order does not belong to this user")
        if order.status != OrderStatus.PRICED:
            raise ValueError(
                f"Cannot confirm order in '{order.status.value}' state. "
                f"Order must be in 'priced' state to confirm."
            )

        order.status = OrderStatus.CONFIRMED
        order.payment_method = PaymentMethod(payment_method)
        order.payment_status = PaymentStatus.PENDING
        order.confirmed_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def cancel_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        user_id: UUID,
    ) -> Order:
        """Cancel from any active state (CREATED, PRICED, CONFIRMED). Set cancelled_at."""
        order = await self._get_order_or_raise(db, order_id)

        if order.user_id != user_id:
            raise ValueError("Order does not belong to this user")
        if order.status not in self.CANCELLABLE_STATES:
            raise ValueError(
                f"Cannot cancel order in '{order.status.value}' state. "
                f"Order can only be cancelled from: {', '.join(s.value for s in self.CANCELLABLE_STATES)}."
            )

        order.status = OrderStatus.CANCELLED
        order.cancelled_at = datetime.now(timezone.utc)

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

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

    async def price_order(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
        total_price: float,
        item_prices: list[dict] | None = None,
    ) -> Order:
        """CREATED -> PRICED. Set total_price, priced_at."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status not in (OrderStatus.CREATED, OrderStatus.PRICED):
            raise ValueError(
                f"Cannot price order in '{order.status.value}' state. "
                f"Order must be in 'created' or 'priced' state to price."
            )

        order.status = OrderStatus.PRICED
        order.total_price = total_price
        order.priced_at = datetime.now(timezone.utc)

        if item_prices:
            # Load items to update individual prices
            stmt = select(OrderItem).where(OrderItem.order_id == order_id)
            result = await db.execute(stmt)
            items_by_id = {str(item.id): item for item in result.scalars().all()}

            for ip in item_prices:
                item_id = str(ip.get("item_id"))
                if item_id in items_by_id:
                    items_by_id[item_id].unit_price = ip.get("unit_price")
                    items_by_id[item_id].total_price = ip.get("total_price")

        await db.commit()
        return await self.get_order(db, order_id)  # type: ignore[return-value]

    async def mark_ready(
        self,
        db: AsyncSession,
        order_id: UUID,
        staff_id: UUID,
    ) -> Order:
        """CONFIRMED -> READY. Set ready_at."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status != OrderStatus.CONFIRMED:
            raise ValueError(
                f"Cannot mark order as ready in '{order.status.value}' state. "
                f"Order must be in 'confirmed' state."
            )

        order.status = OrderStatus.READY
        order.ready_at = datetime.now(timezone.utc)

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
        """Reject with reason from any active state."""
        order = await self._get_order_or_raise(db, order_id)
        self._validate_staff(order, staff_id)

        if order.status not in self.REJECTABLE_STATES:
            raise ValueError(
                f"Cannot reject order in '{order.status.value}' state. "
                f"Order can only be rejected from: {', '.join(s.value for s in self.REJECTABLE_STATES)}."
            )

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

        # Build items list from original order items
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
        """Ensure the staff member is assigned to this order."""
        if order.staff_id is not None and order.staff_id != staff_id:
            raise ValueError("This order is assigned to a different staff member")


order_service = OrderService()
