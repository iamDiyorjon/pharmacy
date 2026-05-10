"""One-shot seed script for E2E playwright verification.

Creates: 1 pharmacy, 1 staff user (phone+password), 1 customer user, 1 created order.
Run with DATABASE_URL pointing at the local docker postgres on port 5434.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import bcrypt
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
# Import every model so SQLAlchemy can resolve cross-model relationships.
from app.models.medicine import Medicine, MedicineAvailability  # noqa: F401
from app.models.order import Order, OrderItem, OrderStatus, OrderType
from app.models.pharmacy import Pharmacy
from app.models.prescription import Prescription  # noqa: F401
from app.models.staff import PharmacyStaff
from app.models.user import User

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def main() -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as db:
        # Pharmacy
        pharmacy = Pharmacy(
            id=uuid.uuid4(),
            name="Test Pharmacy",
            address="Tashkent, Demo St 1",
            phone="+998901111111",
            opens_at=time(8, 0),
            closes_at=time(22, 0),
            is_active=True,
        )
        db.add(pharmacy)

        # Staff user (web auth: phone + password)
        staff_user = User(
            id=uuid.uuid4(),
            first_name="Staff",
            last_name="One",
            phone="+998900000001",
            password_hash=hash_password("staffpass"),
            language_code="uz",
        )
        db.add(staff_user)

        await db.flush()

        staff = PharmacyStaff(
            id=uuid.uuid4(),
            pharmacy_id=pharmacy.id,
            user_id=staff_user.id,
            name="Staff One",
            role="pharmacist",
            is_active=True,
        )
        db.add(staff)

        # Customer user
        customer = User(
            id=uuid.uuid4(),
            first_name="Customer",
            last_name="Demo",
            phone="+998900000002",
            password_hash=hash_password("custpass"),
            language_code="uz",
        )
        db.add(customer)

        await db.flush()

        # Order in created state with two items, no prices yet
        order = Order(
            id=uuid.uuid4(),
            order_number="ORD-DEMO-0001",
            user_id=customer.id,
            pharmacy_id=pharmacy.id,
            order_type=OrderType.MEDICINE_SEARCH,
            status=OrderStatus.CREATED,
            currency="UZS",
            notes="Test seed order",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
        )
        db.add(order)
        await db.flush()

        db.add_all(
            [
                OrderItem(
                    order_id=order.id,
                    medicine_name="Paracetamol 500mg",
                    quantity=2,
                    unit_price=None,
                ),
                OrderItem(
                    order_id=order.id,
                    medicine_name="Vitamin C",
                    quantity=1,
                    unit_price=None,
                ),
            ]
        )

        await db.commit()

        print(f"Pharmacy id: {pharmacy.id}")
        print(f"Staff phone: {staff_user.phone} / staffpass")
        print(f"Staff user id: {staff_user.id}")
        print(f"Customer phone: {customer.phone} / custpass")
        print(f"Customer id: {customer.id}")
        print(f"Order id: {order.id}")
        print(f"Order number: {order.order_number}")


if __name__ == "__main__":
    asyncio.run(main())
