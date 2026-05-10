"""Profile endpoints for the authenticated user.

PATCH /users/me/phone — update the saved contact phone.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


class UpdatePhoneRequest(BaseModel):
    phone: str = Field(..., pattern=r"^\+?\d{9,15}$")


class UpdatePhoneResponse(BaseModel):
    phone: str


@router.patch(
    "/me/phone",
    response_model=UpdatePhoneResponse,
    summary="Update the authenticated user's phone number",
    responses={
        status.HTTP_400_BAD_REQUEST: {"description": "Invalid phone format"},
        status.HTTP_409_CONFLICT: {
            "description": "Phone already used by another account"
        },
    },
)
async def update_my_phone(
    body: UpdatePhoneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UpdatePhoneResponse:
    new_phone = body.phone.strip().replace(" ", "")
    current_user.phone = new_phone
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone already in use by another account",
        )
    return UpdatePhoneResponse(phone=new_phone)
