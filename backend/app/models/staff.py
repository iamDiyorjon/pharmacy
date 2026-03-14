import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin


class PharmacyStaff(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "pharmacy_staff"

    pharmacy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pharmacies.id"), nullable=False
    )
    telegram_user_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="pharmacist", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    pharmacy = relationship("Pharmacy", back_populates="staff")
    orders = relationship("Order", back_populates="staff_member", lazy="noload")
