"""
T065 - Prescription upload and download endpoints.

POST /orders/{id}/prescription        — upload prescription image
GET  /orders/{id}/prescription/{pid}  — download prescription image (presigned URL redirect)
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.order_service import OrderService
from app.services.prescription_service import PrescriptionService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["prescriptions"])

prescription_service = PrescriptionService()
order_service = OrderService()


class PrescriptionResponse(BaseModel):
    id: str
    file_name: str
    file_size: int
    mime_type: str
    download_url: str | None = None


@router.post(
    "/orders/{order_id}/prescription",
    response_model=PrescriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a prescription image for an order",
)
async def upload_prescription(
    order_id: uuid.UUID,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PrescriptionResponse:
    # Verify order belongs to user
    order = await order_service.get_order(db, order_id)
    if order is None or order.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found",
        )

    # Read file content
    file_data = await file.read()
    file_name = file.filename or "prescription.jpg"
    mime_type = file.content_type or "image/jpeg"

    try:
        prescription = await prescription_service.upload(
            db,
            order_id=order_id,
            file_data=file_data,
            file_name=file_name,
            file_size=len(file_data),
            mime_type=mime_type,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return PrescriptionResponse(
        id=str(prescription.id),
        file_name=prescription.file_name,
        file_size=prescription.file_size,
        mime_type=prescription.mime_type,
    )


@router.get(
    "/orders/{order_id}/prescription/{prescription_id}",
    summary="Download a prescription image",
)
async def download_prescription(
    order_id: uuid.UUID,
    prescription_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Verify order exists
    order = await order_service.get_order(db, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found",
        )

    try:
        file_data, mime_type, file_name = await prescription_service.get_file_data(
            db, prescription_id
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prescription not found",
        )

    return Response(
        content=file_data,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{file_name}"'},
    )
