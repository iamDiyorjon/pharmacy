"""Order endpoints for customers.

POST /orders              — create order
GET  /orders              — list user orders
GET  /orders/{id}         — get order detail
POST /orders/{id}/cancel  — cancel order (subject to ready-cancel quota)
POST /orders/{id}/reorder — clone completed order
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.order import OrderStatus
from app.models.user import User
from app.services.order_service import (
    CancelLimitExceededError,
    OrderService,
    order_service,
)
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["orders"])


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
    can_cancel: bool
    cancel_reason: str | None
    created_at: str
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


def _order_to_response(
    order,
    can_cancel: bool = False,
    cancel_reason: str | None = None,
) -> OrderResponse:
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
        can_cancel=can_cancel,
        cancel_reason=cancel_reason,
        created_at=order.created_at.isoformat() if order.created_at else "",
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


async def _build_response(
    db: AsyncSession,
    order,
    svc: OrderService,
) -> OrderResponse:
    can_cancel, reason = await svc.get_cancel_availability(db, order)
    return _order_to_response(order, can_cancel=can_cancel, cancel_reason=reason)


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

    return await _build_response(db, order, order_service)


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

    responses = [await _build_response(db, o, order_service) for o in orders]
    return OrderListResponse(orders=responses, total=total)


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
    return await _build_response(db, order, order_service)


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
    except CancelLimitExceededError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"reason": "ready_cancel_limit_exceeded", "message": str(e)},
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return await _build_response(db, order, order_service)


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

    return await _build_response(db, order, order_service)


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

    content_type = "image/png" if order.reply_image_key.endswith(".png") else "image/jpeg"
    file_name = order.reply_image_key.rsplit("/", 1)[-1]

    return Response(
        content=file_data,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{file_name}"'},
    )
