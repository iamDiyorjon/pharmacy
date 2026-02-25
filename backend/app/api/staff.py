"""
T051-T056 - Staff order management and medicine catalog endpoints.

GET  /staff/orders              — list pharmacy orders
POST /staff/orders/{id}/price   — price an order
POST /staff/orders/{id}/ready   — mark order ready
POST /staff/orders/{id}/complete — complete order
POST /staff/orders/{id}/reject  — reject order
GET  /staff/medicines           — list medicines
POST /staff/medicines           — add medicine
PUT  /staff/medicines/{id}/availability — toggle availability
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_staff
from app.db.session import get_db
from app.models.order import OrderStatus
from app.models.staff import PharmacyStaff
from app.services.medicine_service import MedicineService
from app.services.order_service import OrderService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/staff", tags=["staff"])

order_service = OrderService()
medicine_service = MedicineService()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PriceItemRequest(BaseModel):
    order_item_id: str
    unit_price: float


class PriceOrderRequest(BaseModel):
    total_price: float = Field(gt=0)
    items: list[PriceItemRequest] | None = None


class RejectOrderRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class CreateMedicineRequest(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    name_ru: str | None = None
    name_uz: str | None = None
    description: str | None = None
    category: str | None = None
    requires_prescription: bool = False


class UpdateAvailabilityRequest(BaseModel):
    is_available: bool


class OrderItemResponse(BaseModel):
    id: str
    medicine_name: str
    quantity: int
    unit_price: float | None
    model_config = {"from_attributes": True}


class PrescriptionResponse(BaseModel):
    id: str
    file_name: str
    file_size: int
    mime_type: str
    uploaded_at: str
    download_url: str


class StaffOrderResponse(BaseModel):
    id: str
    order_number: str
    status: str
    order_type: str
    total_price: float | None
    currency: str
    notes: str | None
    rejection_reason: str | None
    payment_method: str | None
    payment_status: str | None
    staff_id: str | None
    user_first_name: str
    user_phone: str | None
    created_at: str
    items: list[OrderItemResponse] = []
    prescriptions: list[PrescriptionResponse] = []
    model_config = {"from_attributes": True}


class StaffOrderListResponse(BaseModel):
    orders: list[StaffOrderResponse]
    total: int


class MedicineResponse(BaseModel):
    id: str
    name: str
    name_ru: str | None
    name_uz: str | None
    description: str | None
    category: str | None
    requires_prescription: bool
    model_config = {"from_attributes": True}


class MedicineListResponse(BaseModel):
    medicines: list[MedicineResponse]
    total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _staff_order_response(order) -> StaffOrderResponse:
    return StaffOrderResponse(
        id=str(order.id),
        order_number=order.order_number,
        status=order.status.value if hasattr(order.status, "value") else order.status,
        order_type=order.order_type.value if hasattr(order.order_type, "value") else order.order_type,
        total_price=float(order.total_price) if order.total_price else None,
        currency=order.currency,
        notes=order.notes,
        rejection_reason=order.rejection_reason,
        payment_method=order.payment_method.value if order.payment_method else None,
        payment_status=order.payment_status.value if order.payment_status else None,
        staff_id=str(order.staff_id) if order.staff_id else None,
        user_first_name=order.user.first_name if order.user else "Unknown",
        user_phone=order.user.phone if order.user else None,
        created_at=order.created_at.isoformat() if order.created_at else "",
        items=[
            OrderItemResponse(
                id=str(item.id),
                medicine_name=item.medicine_name,
                quantity=item.quantity,
                unit_price=float(item.unit_price) if item.unit_price else None,
            )
            for item in (order.items or [])
        ],
        prescriptions=[
            PrescriptionResponse(
                id=str(p.id),
                file_name=p.file_name,
                file_size=p.file_size,
                mime_type=p.mime_type,
                uploaded_at=p.created_at.isoformat() if p.created_at else "",
                download_url=f"/api/v1/orders/{order.id}/prescription/{p.id}",
            )
            for p in (order.prescriptions or [])
        ],
    )


# ---------------------------------------------------------------------------
# GET /staff/orders
# ---------------------------------------------------------------------------


@router.get(
    "/orders",
    response_model=StaffOrderListResponse,
    summary="List orders for staff's pharmacy",
)
async def list_staff_orders(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderListResponse:
    os = None
    if status_filter:
        try:
            os = OrderStatus(status_filter)
        except ValueError:
            pass

    orders, total = await order_service.list_pharmacy_orders(
        db, pharmacy_id=staff.pharmacy_id, status=os, limit=limit, offset=offset
    )
    return StaffOrderListResponse(
        orders=[_staff_order_response(o) for o in orders],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /staff/orders/{order_id}
# ---------------------------------------------------------------------------


@router.get(
    "/orders/{order_id}",
    response_model=StaffOrderResponse,
    summary="Get single order detail for staff",
)
async def get_staff_order(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    order = await order_service.get_order(db, order_id)
    if order is None or order.pharmacy_id != staff.pharmacy_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/price
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/price",
    response_model=StaffOrderResponse,
    summary="Price an order (claims it)",
)
async def price_order(
    order_id: uuid.UUID,
    body: PriceOrderRequest,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    item_prices = None
    if body.items:
        item_prices = {
            uuid.UUID(i.order_item_id): Decimal(str(i.unit_price))
            for i in body.items
        }

    try:
        order = await order_service.price_order(
            db,
            order_id=order_id,
            staff_id=staff.id,
            total_price=Decimal(str(body.total_price)),
            item_prices=item_prices,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/ready
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/ready",
    response_model=StaffOrderResponse,
    summary="Mark order ready for pickup",
)
async def mark_ready(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.mark_ready(db, order_id=order_id, staff_id=staff.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/complete
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/complete",
    response_model=StaffOrderResponse,
    summary="Complete order (customer picked up)",
)
async def mark_complete(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.mark_complete(db, order_id=order_id, staff_id=staff.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/reject
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/reject",
    response_model=StaffOrderResponse,
    summary="Reject an order with reason",
)
async def reject_order(
    order_id: uuid.UUID,
    body: RejectOrderRequest,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.reject_order(
            db, order_id=order_id, staff_id=staff.id, reason=body.reason
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# GET /staff/medicines
# ---------------------------------------------------------------------------


@router.get(
    "/medicines",
    response_model=MedicineListResponse,
    summary="List all medicines",
)
async def list_medicines(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> MedicineListResponse:
    medicines, total = await medicine_service.list_medicines(db, limit=limit, offset=offset)
    return MedicineListResponse(
        medicines=[
            MedicineResponse(
                id=str(m.id),
                name=m.name,
                name_ru=m.name_ru,
                name_uz=m.name_uz,
                description=m.description,
                category=m.category,
                requires_prescription=m.requires_prescription,
            )
            for m in medicines
        ],
        total=total,
    )


# ---------------------------------------------------------------------------
# POST /staff/medicines
# ---------------------------------------------------------------------------


@router.post(
    "/medicines",
    response_model=MedicineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a new medicine",
)
async def add_medicine(
    body: CreateMedicineRequest,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> MedicineResponse:
    med = await medicine_service.add_medicine(
        db,
        name=body.name,
        name_ru=body.name_ru,
        name_uz=body.name_uz,
        description=body.description,
        category=body.category,
        requires_prescription=body.requires_prescription,
    )
    return MedicineResponse(
        id=str(med.id),
        name=med.name,
        name_ru=med.name_ru,
        name_uz=med.name_uz,
        description=med.description,
        category=med.category,
        requires_prescription=med.requires_prescription,
    )


# ---------------------------------------------------------------------------
# PUT /staff/medicines/{medicine_id}/availability
# ---------------------------------------------------------------------------


@router.put(
    "/medicines/{medicine_id}/availability",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Toggle medicine availability at staff's pharmacy",
)
async def update_availability(
    medicine_id: uuid.UUID,
    body: UpdateAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> None:
    await medicine_service.update_availability(
        db,
        medicine_id=medicine_id,
        pharmacy_id=staff.pharmacy_id,
        is_available=body.is_available,
    )
