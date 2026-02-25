"""
T035 / T036 - Order and OrderItem models with status/type enums.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin


class OrderStatus(str, enum.Enum):
    CREATED = "created"
    PRICED = "priced"
    CONFIRMED = "confirmed"
    READY = "ready"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class OrderType(str, enum.Enum):
    MEDICINE_SEARCH = "medicine_search"
    PRESCRIPTION = "prescription"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CLICK = "click"
    PAYME = "payme"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"


class Order(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "orders"

    order_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pharmacies.id"), nullable=False
    )
    staff_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pharmacy_staff.id"), nullable=True
    )

    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status", values_callable=lambda x: [e.value for e in x]),
        default=OrderStatus.CREATED,
        nullable=False,
        index=True,
    )
    order_type: Mapped[OrderType] = mapped_column(
        Enum(OrderType, name="order_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    total_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="UZS", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Staff reply image (screenshot from POS/calculator app)
    reply_image_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Payment fields (T068)
    payment_method: Mapped[PaymentMethod | None] = mapped_column(
        Enum(PaymentMethod, name="payment_method", values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    payment_status: Mapped[PaymentStatus | None] = mapped_column(
        Enum(PaymentStatus, name="payment_status", values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # Timestamps for state transitions
    priced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="orders")
    pharmacy = relationship("Pharmacy", back_populates="orders")
    staff_member = relationship("PharmacyStaff", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", lazy="selectin", cascade="all, delete-orphan")
    prescriptions = relationship("Prescription", back_populates="order", lazy="selectin")


class OrderItem(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medicines.id"), nullable=True
    )
    medicine_name: Mapped[str] = mapped_column(String(300), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    order = relationship("Order", back_populates="items")
    medicine = relationship("Medicine")
