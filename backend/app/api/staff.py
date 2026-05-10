"""Staff order management and medicine catalog endpoints.

GET  /staff/orders                 — list pharmacy orders
GET  /staff/orders/{id}            — get order detail
POST /staff/orders/{id}/update     — save items + total (no state change)
POST /staff/orders/{id}/confirm    — confirm and mark ready (notifies customer)
POST /staff/orders/{id}/complete   — complete (customer picked up)
POST /staff/orders/{id}/reject     — reject before confirming
POST /staff/orders/{id}/cancel     — cancel a CREATED or READY order
POST /staff/orders/{id}/reply-image — upload prescription reply image
GET  /staff/medicines              — list medicines
POST /staff/medicines              — add medicine
POST /staff/medicines/import-excel — import medicines from Excel
PUT  /staff/medicines/{id}/availability — toggle availability
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from aiogram import Bot
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_staff
from app.db.session import get_db
from app.models.order import OrderStatus
from app.models.staff import PharmacyStaff
from app.services.event_broker import publish_order_event
from app.services.medicine_service import MedicineService
from app.services.notification_service import notify_customer
from app.services.order_service import OrderService
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/staff", tags=["staff"])

order_service = OrderService()
medicine_service = MedicineService()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class UpdateOrderItemRequest(BaseModel):
    medicine_id: str | None = None
    medicine_name: str = Field(min_length=1, max_length=300)
    quantity: int = Field(ge=1, default=1)
    unit_price: float | None = None


class UpdateOrderRequest(BaseModel):
    items: list[UpdateOrderItemRequest]
    total_price: float | None = Field(default=None, ge=0)


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
    medicine_id: str | None = None
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
    staff_id: str | None
    user_first_name: str
    user_phone: str | None
    user_telegram_username: str | None = None
    user_telegram_id: int | None = None
    contact_phone: str | None = None
    created_at: str
    ready_at: str | None
    reply_image_url: str | None = None
    items: list[OrderItemResponse] = []
    prescriptions: list[PrescriptionResponse] = []
    model_config = {"from_attributes": True}


class StaffOrderListResponse(BaseModel):
    orders: list[StaffOrderResponse]
    total: int


class MedicineAvailabilityResponse(BaseModel):
    pharmacy_id: str
    pharmacy_name: str
    is_available: bool
    price: float | None = None
    quantity: float | None = None


class MedicineResponse(BaseModel):
    id: str
    name: str
    name_ru: str | None
    name_uz: str | None
    description: str | None
    category: str | None
    requires_prescription: bool
    availability: list[MedicineAvailabilityResponse] = []
    model_config = {"from_attributes": True}


class MedicineListResponse(BaseModel):
    medicines: list[MedicineResponse]
    total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_bot(request: Request) -> Bot:
    return request.app.state.bot


def _build_ready_message(order, lang: str) -> str:
    """Detailed customer notification: order is ready, with items + total."""
    price_str = (
        f"{float(order.total_price):,.0f} {order.currency}" if order.total_price else ""
    )

    available_items = []
    removed_items = []
    for item in order.items or []:
        if item.unit_price is not None and float(item.unit_price) > 0:
            line_total = float(item.unit_price) * item.quantity
            available_items.append((item.medicine_name, item.quantity, line_total))
        else:
            removed_items.append(item.medicine_name)

    items_text = ""
    for name, qty, total in available_items:
        items_text += f"  • {name} x{qty} — {total:,.0f}\n"

    removed_text = ""
    if removed_items:
        names = ", ".join(removed_items)
        removed_text = {
            "uz": f"\n❌ Mavjud emas: {names}",
            "ru": f"\n❌ Нет в наличии: {names}",
            "en": f"\n❌ Unavailable: {names}",
        }.get(lang, f"\n❌ {names}")

    templates = {
        "uz": (
            f"✅ Buyurtma #{order.order_number} tayyor!\n\n"
            f"{items_text}"
            f"{removed_text}\n"
            f"\n💰 Jami: {price_str}\n"
            f"Dorixonaga keling va olib keting."
        ),
        "ru": (
            f"✅ Заказ #{order.order_number} готов!\n\n"
            f"{items_text}"
            f"{removed_text}\n"
            f"\n💰 Итого: {price_str}\n"
            f"Подойдите в аптеку и заберите."
        ),
        "en": (
            f"✅ Order #{order.order_number} is ready!\n\n"
            f"{items_text}"
            f"{removed_text}\n"
            f"\n💰 Total: {price_str}\n"
            f"Come to the pharmacy to pick up."
        ),
    }
    return templates.get(lang, templates["uz"])


async def _notify_order_status(
    bot: Bot,
    order,
    status_key: str,
    extra: str = "",
) -> None:
    """Fire-and-forget Telegram notification to the customer."""
    try:
        if not order.user or not order.user.telegram_user_id:
            return
        lang = order.user.language_code or "uz"

        if status_key == "ready":
            await notify_customer(
                bot, order.user.telegram_user_id, _build_ready_message(order, lang)
            )
            return

        messages = {
            "completed": {
                "uz": f"🎉 Buyurtma #{order.order_number} yakunlandi. Rahmat!",
                "ru": f"🎉 Заказ #{order.order_number} завершён. Спасибо!",
                "en": f"🎉 Order #{order.order_number} completed. Thank you!",
            },
            "rejected": {
                "uz": f"❌ Buyurtma #{order.order_number} rad etildi.\nSabab: {extra}",
                "ru": f"❌ Заказ #{order.order_number} отклонён.\nПричина: {extra}",
                "en": f"❌ Order #{order.order_number} rejected.\nReason: {extra}",
            },
            "cancelled_by_staff": {
                "uz": (
                    f"⚠️ Buyurtma #{order.order_number} dorixona tomonidan "
                    f"bekor qilindi. Iltimos, dorixonaga murojaat qiling."
                ),
                "ru": (
                    f"⚠️ Заказ #{order.order_number} отменён аптекой. "
                    f"Пожалуйста, свяжитесь с аптекой."
                ),
                "en": (
                    f"⚠️ Order #{order.order_number} was cancelled by the pharmacy. "
                    f"Please contact them."
                ),
            },
        }
        status_msgs = messages.get(status_key)
        if not status_msgs:
            return
        text = status_msgs.get(lang, status_msgs["uz"])
        await notify_customer(bot, order.user.telegram_user_id, text)
    except Exception:
        logger.exception("Failed to send order status notification")


def _staff_order_response(order) -> StaffOrderResponse:
    reply_image_url = (
        f"/api/v1/orders/{order.id}/reply-image" if order.reply_image_key else None
    )
    return StaffOrderResponse(
        id=str(order.id),
        order_number=order.order_number,
        status=order.status.value if hasattr(order.status, "value") else order.status,
        order_type=order.order_type.value
        if hasattr(order.order_type, "value")
        else order.order_type,
        total_price=float(order.total_price) if order.total_price else None,
        currency=order.currency,
        notes=order.notes,
        rejection_reason=order.rejection_reason,
        staff_id=str(order.staff_id) if order.staff_id else None,
        user_first_name=order.user.first_name if order.user else "Unknown",
        user_phone=order.user.phone if order.user else None,
        user_telegram_username=order.user.telegram_username if order.user else None,
        user_telegram_id=order.user.telegram_user_id if order.user else None,
        contact_phone=order.contact_phone,
        created_at=order.created_at.isoformat() if order.created_at else "",
        ready_at=order.ready_at.isoformat() if order.ready_at else None,
        reply_image_url=reply_image_url,
        items=[
            OrderItemResponse(
                id=str(item.id),
                medicine_id=str(item.medicine_id) if item.medicine_id else None,
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/update
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/update",
    response_model=StaffOrderResponse,
    summary="Save items and total price (no state change)",
)
async def update_order(
    order_id: uuid.UUID,
    body: UpdateOrderRequest,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    items = [
        {
            "medicine_id": i.medicine_id,
            "medicine_name": i.medicine_name,
            "quantity": i.quantity,
            "unit_price": i.unit_price,
        }
        for i in body.items
    ]

    try:
        order = await order_service.update_order_items(
            db,
            order_id=order_id,
            staff_id=staff.id,
            items=items,
            total_price=Decimal(str(body.total_price))
            if body.total_price is not None
            else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    await publish_order_event(order, "order_updated")
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/confirm
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/confirm",
    response_model=StaffOrderResponse,
    summary="Confirm order and mark ready for pickup",
)
async def confirm_order(
    order_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.confirm_to_ready(
            db, order_id=order_id, staff_id=staff.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await _notify_order_status(_get_bot(request), order, "ready")
    await publish_order_event(order, "order_status_changed")
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.mark_complete(
            db, order_id=order_id, staff_id=staff.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await _notify_order_status(_get_bot(request), order, "completed")
    await publish_order_event(order, "order_status_changed")
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/reject
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/reject",
    response_model=StaffOrderResponse,
    summary="Reject an order before confirming, with reason",
)
async def reject_order(
    order_id: uuid.UUID,
    body: RejectOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.reject_order(
            db, order_id=order_id, staff_id=staff.id, reason=body.reason
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await _notify_order_status(_get_bot(request), order, "rejected", extra=body.reason)
    await publish_order_event(order, "order_status_changed")
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/cancel
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/cancel",
    response_model=StaffOrderResponse,
    summary="Cancel a CREATED or READY order (no quota for staff)",
)
async def staff_cancel(
    order_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    try:
        order = await order_service.staff_cancel_order(
            db, order_id=order_id, staff_id=staff.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await _notify_order_status(_get_bot(request), order, "cancelled_by_staff")
    await publish_order_event(order, "order_status_changed")
    return _staff_order_response(order)


# ---------------------------------------------------------------------------
# POST /staff/orders/{order_id}/reply-image
# ---------------------------------------------------------------------------

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post(
    "/orders/{order_id}/reply-image",
    response_model=StaffOrderResponse,
    summary="Upload a reply image (screenshot) for an order",
)
async def upload_reply_image(
    order_id: uuid.UUID,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    staff: PharmacyStaff = Depends(get_current_staff),
) -> StaffOrderResponse:
    order = await order_service.get_order(db, order_id)
    if order is None or order.pharmacy_id != staff.pharmacy_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )

    order_type = (
        order.order_type.value
        if hasattr(order.order_type, "value")
        else order.order_type
    )
    if order_type != "prescription":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reply image can only be uploaded for prescription orders",
        )

    order_status = (
        order.status.value if hasattr(order.status, "value") else order.status
    )
    if order_status != "created":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reply image can only be uploaded for created orders",
        )

    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{content_type}'. Only JPEG and PNG are allowed.",
        )

    file_data = await file.read()
    if len(file_data) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {MAX_IMAGE_SIZE // (1024 * 1024)} MB.",
        )

    ext = "jpg" if content_type == "image/jpeg" else "png"
    file_key = f"reply-images/{order_id}/{uuid.uuid4()}.{ext}"

    if order.reply_image_key:
        try:
            await storage.delete_file(order.reply_image_key)
        except Exception:
            logger.warning(
                "Failed to delete old reply image key='%s'", order.reply_image_key
            )

    await storage.upload_file(file_data, file_key, content_type)

    order.reply_image_key = file_key
    await db.commit()

    order = await order_service.get_order(db, order_id)
    await publish_order_event(order, "order_updated")
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
    medicines, total = await medicine_service.list_medicines(
        db, limit=limit, offset=offset
    )
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
                availability=[
                    MedicineAvailabilityResponse(
                        pharmacy_id=str(a.pharmacy_id),
                        pharmacy_name=a.pharmacy.name if a.pharmacy else "",
                        is_available=a.is_available,
                        price=float(a.price) if a.price else None,
                        quantity=a.quantity,
                    )
                    for a in (m.availability or [])
                ],
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
# POST /staff/medicines/import-excel
# ---------------------------------------------------------------------------


class ExcelImportResponse(BaseModel):
    new: int
    updated: int
    skipped: int
    errors: int


ALLOWED_EXCEL_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
}
MAX_EXCEL_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post(
    "/medicines/import-excel",
    response_model=ExcelImportResponse,
    summary="Import medicines from an Excel file",
)
async def import_medicines_excel(
    file: UploadFile,
    staff: PharmacyStaff = Depends(get_current_staff),
) -> ExcelImportResponse:
    import tempfile

    from app.services.drug_import import import_drugs_from_excel

    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .xlsx or .xls files are allowed.",
        )

    file_data = await file.read()
    if len(file_data) > MAX_EXCEL_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {MAX_EXCEL_SIZE // (1024 * 1024)} MB.",
        )

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        tmp.write(file_data)
        tmp.flush()
        try:
            stats = await import_drugs_from_excel(tmp.name, staff.pharmacy_id)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        except Exception:
            logger.exception("Excel import failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Import failed. Check file format.",
            )

    return ExcelImportResponse(**stats)


# ---------------------------------------------------------------------------
# PUT /staff/medicines/{medicine_id}/availability
# ---------------------------------------------------------------------------


@router.put(
    "/medicines/{medicine_id}/availability",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
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
