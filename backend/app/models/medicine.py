"""
T033 / T034 - Medicine and MedicineAvailability models.
"""

import uuid

from sqlalchemy import Boolean, Date, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin


class Medicine(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "medicines"

    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_ru: Mapped[str | None] = mapped_column(String(300), nullable=True)
    name_uz: Mapped[str | None] = mapped_column(String(300), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    requires_prescription: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    availability = relationship("MedicineAvailability", back_populates="medicine", lazy="selectin")

    __table_args__ = (
        Index("ix_medicines_name_trgm", "name", postgresql_using="gin",
              postgresql_ops={"name": "gin_trgm_ops"}),
        Index("ix_medicines_name_ru_trgm", "name_ru", postgresql_using="gin",
              postgresql_ops={"name_ru": "gin_trgm_ops"}),
        Index("ix_medicines_name_uz_trgm", "name_uz", postgresql_using="gin",
              postgresql_ops={"name_uz": "gin_trgm_ops"}),
    )


class MedicineAvailability(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "medicine_availability"

    medicine_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medicines.id"), nullable=False
    )
    pharmacy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pharmacies.id"), nullable=False
    )
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)
    expiry_date: Mapped[str | None] = mapped_column(Date, nullable=True)

    medicine = relationship("Medicine", back_populates="availability")
    pharmacy = relationship("Pharmacy")

    __table_args__ = (
        Index("uq_medicine_pharmacy", "medicine_id", "pharmacy_id", unique=True),
    )
