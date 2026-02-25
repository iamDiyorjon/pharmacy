"""
T072-T073 - Payment endpoints.

POST /orders/{id}/pay      — initiate payment (returns provider URL)
POST /webhooks/click       — Click payment callback
POST /webhooks/payme       — Payme payment callback
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.order import Order, PaymentMethod, PaymentStatus
from app.models.user import User
from app.services.order_service import OrderService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])

order_service = OrderService()


class PaymentInitResponse(BaseModel):
    payment_url: str
    payment_method: str


class WebhookResponse(BaseModel):
    status: str
    message: str


# ---------------------------------------------------------------------------
# POST /orders/{order_id}/pay
# ---------------------------------------------------------------------------


@router.post(
    "/orders/{order_id}/pay",
    response_model=PaymentInitResponse,
    summary="Initiate payment for a confirmed order",
)
async def initiate_payment(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaymentInitResponse:
    order = await order_service.get_order(db, order_id)
    if order is None or order.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.payment_method is None or order.payment_method == PaymentMethod.CASH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order payment method is cash or not set",
        )

    # Placeholder payment URL generation
    # In production, integrate with Click/Payme SDK
    payment_url = f"https://payment.example.com/{order.payment_method.value}/{order_id}"

    return PaymentInitResponse(
        payment_url=payment_url,
        payment_method=order.payment_method.value,
    )


# ---------------------------------------------------------------------------
# POST /webhooks/click
# ---------------------------------------------------------------------------


@router.post(
    "/webhooks/click",
    response_model=WebhookResponse,
    summary="Click payment webhook callback",
)
async def click_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WebhookResponse:
    # Placeholder webhook handler
    # In production: verify Click signature, extract order_id, update payment_status
    body = await request.json()
    logger.info("Click webhook received: %s", body)

    order_id_str = body.get("merchant_trans_id")
    if order_id_str:
        try:
            order_id = uuid.UUID(order_id_str)
            order = await order_service.get_order(db, order_id)
            if order and order.payment_method == PaymentMethod.CLICK:
                order.payment_status = PaymentStatus.PAID
                await db.commit()
                logger.info("Click payment confirmed for order %s", order_id)
        except (ValueError, Exception) as e:
            logger.warning("Click webhook processing error: %s", e)

    return WebhookResponse(status="ok", message="Webhook processed")


# ---------------------------------------------------------------------------
# POST /webhooks/payme
# ---------------------------------------------------------------------------


@router.post(
    "/webhooks/payme",
    response_model=WebhookResponse,
    summary="Payme payment webhook callback",
)
async def payme_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WebhookResponse:
    # Placeholder webhook handler
    # In production: verify Payme signature, extract order_id, update payment_status
    body = await request.json()
    logger.info("Payme webhook received: %s", body)

    return WebhookResponse(status="ok", message="Webhook processed")
