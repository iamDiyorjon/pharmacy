"""
T025 - Authentication endpoints.

POST /auth/init
    Accepts raw Telegram initData, validates the HMAC signature, upserts
    the user record, and returns a signed JWT access token that the Mini App
    can use in subsequent API calls.

JWT claims
----------
sub   : str(telegram_user_id)
uid   : str(user.id)           — internal UUID
iat   : issued-at (auto)
exp   : expiry (auto)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.models.staff import PharmacyStaff
from app.models.user import User
from app.services.telegram_auth import validate_init_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days — typical for Mini Apps


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class InitRequest(BaseModel):
    """Body for POST /auth/init."""

    init_data: str = Field(
        ...,
        description="Raw Telegram initData query string from Telegram.WebApp.initData",
        examples=["query_id=AAF...&user=%7B%22id%22%3A...&hash=..."],
    )


class TokenLoginRequest(BaseModel):
    """Body for POST /auth/token-login."""

    token: str = Field(..., description="JWT access token from magic link")


class TokenResponse(BaseModel):
    """Response body for POST /auth/init."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Token lifetime in seconds")
    user_id: str = Field(description="Internal user UUID")
    telegram_user_id: int
    is_staff: bool = Field(default=False, description="Whether user is registered staff")


class UserProfile(BaseModel):
    """Minimal user profile embedded in the auth response (optional)."""

    id: str
    telegram_user_id: int
    first_name: str
    last_name: str | None
    language_code: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helper: JWT creation
# ---------------------------------------------------------------------------


def create_access_token(
    telegram_user_id: int,
    user_uuid: uuid.UUID,
) -> tuple[str, datetime]:
    """Create a signed JWT access token.

    Returns:
        A tuple of ``(encoded_jwt, expiry_datetime)``.
    """
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": str(telegram_user_id),
        "uid": str(user_uuid),
        "iat": now,
        "exp": expire,
    }
    token: str = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return token, expire


# ---------------------------------------------------------------------------
# POST /auth/init
# ---------------------------------------------------------------------------


@router.post(
    "/init",
    response_model=TokenResponse,
    summary="Exchange Telegram initData for a JWT access token",
    responses={
        status.HTTP_200_OK: {"description": "Authentication successful"},
        status.HTTP_401_UNAUTHORIZED: {"description": "Invalid or tampered initData"},
    },
)
async def auth_init(
    body: InitRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Validate Telegram Mini App ``initData`` and return a JWT access token.

    The Mini App should call this endpoint on startup, passing
    ``Telegram.WebApp.initData`` verbatim.  The returned ``access_token``
    should be stored (e.g. in React state or ``sessionStorage``) and sent in
    the ``Authorization: Bearer <token>`` header on subsequent requests.

    The endpoint is intentionally NOT protected by :func:`~app.api.deps.get_current_user`
    because it IS the authentication step.
    """
    parsed = validate_init_data(body.init_data, settings.telegram_bot_token)
    if parsed is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram initData: signature verification failed",
        )

    tg_user: dict = parsed.get("user", {})
    telegram_user_id: int | None = tg_user.get("id")
    if not telegram_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="initData does not contain user information",
        )

    first_name: str = tg_user.get("first_name") or "Unknown"
    last_name: str | None = tg_user.get("last_name")
    language_code: str = tg_user.get("language_code") or "uz"

    # Upsert user -----------------------------------------------------------
    stmt = select(User).where(User.telegram_user_id == telegram_user_id)
    result = await db.execute(stmt)
    user: User | None = result.scalar_one_or_none()

    if user is None:
        user = User(
            telegram_user_id=telegram_user_id,
            first_name=first_name,
            last_name=last_name,
            language_code=language_code,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info("auth_init: created new user telegram_user_id=%s", telegram_user_id)
    else:
        changed = False
        if user.first_name != first_name:
            user.first_name = first_name
            changed = True
        if user.last_name != last_name:
            user.last_name = last_name
            changed = True
        if user.language_code != language_code:
            user.language_code = language_code
            changed = True
        if changed:
            await db.commit()
            await db.refresh(user)
        logger.debug("auth_init: existing user telegram_user_id=%s", telegram_user_id)

    # Check staff status -----------------------------------------------------
    staff_result = await db.execute(
        select(PharmacyStaff).where(
            PharmacyStaff.telegram_user_id == telegram_user_id,
            PharmacyStaff.is_active.is_(True),
        )
    )
    is_staff = staff_result.scalar_one_or_none() is not None

    # Issue JWT -------------------------------------------------------------
    token, expire = create_access_token(user.telegram_user_id, user.id)
    lifetime_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=lifetime_seconds,
        user_id=str(user.id),
        telegram_user_id=user.telegram_user_id,
        is_staff=is_staff,
    )


# ---------------------------------------------------------------------------
# POST /auth/token-login
# ---------------------------------------------------------------------------


@router.post(
    "/token-login",
    response_model=TokenResponse,
    summary="Exchange a magic-link JWT for a fresh access token",
    responses={
        status.HTTP_200_OK: {"description": "Token valid, session created"},
        status.HTTP_401_UNAUTHORIZED: {"description": "Invalid or expired token"},
    },
)
async def token_login(
    body: TokenLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Validate a JWT (e.g. from a ``/staff`` magic link) and return a fresh
    access token with user/staff info.

    This endpoint is NOT protected by ``get_current_user`` because it IS the
    authentication step for browser-based staff access.
    """
    try:
        payload = jwt.decode(body.token, settings.secret_key, algorithms=[ALGORITHM])
        telegram_user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    # Look up user ---------------------------------------------------------
    stmt = select(User).where(User.telegram_user_id == telegram_user_id)
    result = await db.execute(stmt)
    user: User | None = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Check staff status ---------------------------------------------------
    staff_result = await db.execute(
        select(PharmacyStaff).where(
            PharmacyStaff.telegram_user_id == telegram_user_id,
            PharmacyStaff.is_active.is_(True),
        )
    )
    is_staff = staff_result.scalar_one_or_none() is not None

    # Issue fresh JWT ------------------------------------------------------
    token, expire = create_access_token(user.telegram_user_id, user.id)
    lifetime_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=lifetime_seconds,
        user_id=str(user.id),
        telegram_user_id=user.telegram_user_id,
        is_staff=is_staff,
    )
