"""
T042-T045, T078-T079 - Order endpoints for customers.

POST /orders              — create order
GET  /orders              — list user orders
GET  /orders/{id}         — get order detail
POST /orders/{id}/confirm — confirm priced order
POST /orders/{id}/cancel  — cancel order
POST /orders/{id}/reorder — clone completed order
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.order import OrderStatus, PaymentMethod
from app.models.user import User
from app.services.order_service import OrderService
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["orders"])

order_service = OrderService()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class OrderItemRequest(BaseModel):
    medicine_id: str | None = None
    medicine_name: str
    quantity: int = Field(ge=1, default=1)


class CreateOrderRequest(BaseModel):
    pharmacy_id: str
    order_type: str = "medicine_search"
    items: list[OrderItemRequest] | None = None
    notes: str | None = None


class ConfirmOrderRequest(BaseModel):
    payment_method: str = "cash"


class OrderItemResponse(BaseModel):
    id: str
    medicine_name: str
    quantity: int
    unit_price: float | None

    model_config = {"from_attributes": True}


class OrderResponse(BaseModel):
    id: str
    order_number: str
    status: str
    order_type: str
    pharmacy_id: str
    pharmacy_name: str
    total_price: float | None
    currency: str
    notes: str | None
    rejection_reason: str | None
    payment_method: str | None
    payment_status: str | None
    created_at: str
    confirmed_at: str | None
    ready_at: str | None
    reply_image_url: str | None = None
    items: list[OrderItemResponse] = []

    model_config = {"from_attributes": True}


class OrderListResponse(BaseModel):
    orders: list[OrderResponse]
    total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _order_to_response(order) -> OrderResponse:
    reply_image_url = (
        f"/api/v1/orders/{order.id}/reply-image" if order.reply_image_key else None
    )
    return OrderResponse(
        id=str(order.id),
        order_number=order.order_number,
        status=order.status.value if hasattr(order.status, "value") else order.status,
        order_type=order.order_type.value if hasattr(order.order_type, "value") else order.order_type,
        pharmacy_id=str(order.pharmacy_id),
        pharmacy_name=order.pharmacy.name if order.pharmacy else "Unknown",
        total_price=float(order.total_price) if order.total_price else None,
        currency=order.currency,
        notes=order.notes,
        rejection_reason=order.rejection_reason,
        payment_method=order.payment_method.value if order.payment_method else None,
        payment_status=order.payment_status.value if order.payment_status else None,
        created_at=order.created_at.isoformat() if order.created_at else "",
        confirmed_at=order.confirmed_at.isoformat() if order.confirmed_at else None,
        ready_at=order.ready_at.isoformat() if order.ready_at else None,
        reply_image_url=reply_image_url,
        items=[
            OrderItemResponse(
                id=str(item.id),
                medicine_name=item.medicine_name,
                quantity=item.quantity,
                unit_price=float(item.unit_price) if item.unit_price else None,
            )
            for item in (order.items or [])
        ],
    )


# ---------------------------------------------------------------------------
# POST /orders
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new order",
)
async def create_order(
    body: CreateOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderResponse:
    items = None
    if body.items:
        items = [
            {
                "medicine_id": i.medicine_id,
                "medicine_name": i.medicine_name,
                "quantity": i.quantity,
            }
            for i in body.items
        ]

    try:
        order = await order_service.create_order(
            db,
            user_id=current_user.id,
            pharmacy_id=uuid.UUID(body.pharmacy_id),
            order_type=body.order_type,
            items=items,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _order_to_response(order)


# ---------------------------------------------------------------------------
# GET /orders
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=OrderListResponse,
    summary="List user orders",
)
async def list_orders(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderListResponse:
    os = None
    if status_filter:
        try:
            os = OrderStatus(status_filter)
        except ValueError:
            pass

    orders, total = await order_service.list_user_orders(
        db, user_id=current_user.id, status=os, limit=limit, offset=offset
    )

    return OrderListResponse(
        orders=[_order_to_response(o) for o in orders],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /orders/{order_id}
# ---------------------------------------------------------------------------


@router.get(
    "/{order_id}",
    response_model=OrderResponse,
    summary="Get order detail",
)
async def get_order(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderResponse:
    order = await order_service.get_order(db, order_id)
    if order is None or order.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return _order_to_response(order)


# ---------------------------------------------------------------------------
# POST /orders/{order_id}/confirm
# ---------------------------------------------------------------------------


@router.post(
    "/{order_id}/confirm",
    response_model=OrderResponse,
    summary="Confirm a priced order",
)
async def confirm_order(
    order_id: uuid.UUID,
    body: ConfirmOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderResponse:
    try:
        order = await order_service.confirm_order(
            db, order_id=order_id, user_id=current_user.id,
            payment_method=body.payment_method,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _order_to_response(order)


# ---------------------------------------------------------------------------
# POST /orders/{order_id}/cancel
# ---------------------------------------------------------------------------


@router.post(
    "/{order_id}/cancel",
    response_model=OrderResponse,
    summary="Cancel an order",
)
async def cancel_order(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderResponse:
    try:
        order = await order_service.cancel_order(
            db, order_id=order_id, user_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _order_to_response(order)


# ---------------------------------------------------------------------------
# POST /orders/{order_id}/reorder
# ---------------------------------------------------------------------------


@router.post(
    "/{order_id}/reorder",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reorder a completed order",
)
async def reorder(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderResponse:
    try:
        order = await order_service.reorder(
            db, order_id=order_id, user_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _order_to_response(order)


# ---------------------------------------------------------------------------
# GET /orders/{order_id}/reply-image
# ---------------------------------------------------------------------------


@router.get(
    "/{order_id}/reply-image",
    summary="Download the staff reply image for an order",
)
async def download_reply_image(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    order = await order_service.get_order(db, order_id)
    if order is None or order.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if not order.reply_image_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No reply image for this order",
        )

    try:
        file_data = await storage.download_file(order.reply_image_key)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reply image file not found",
        )

    # Determine content type from the key extension
    content_type = "image/png" if order.reply_image_key.endswith(".png") else "image/jpeg"
    file_name = order.reply_image_key.rsplit("/", 1)[-1]

    return Response(
        content=file_data,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{file_name}"'},
    )
