"""
Authentication endpoints.

POST /auth/init          — Telegram Mini App initData → JWT
POST /auth/token-login   — Magic-link JWT → fresh JWT
POST /auth/web/register  — Phone + password registration → JWT
POST /auth/web/login     — Phone + password login → JWT

JWT claims
----------
sub   : str(telegram_user_id) or str(user.id) for web users
uid   : str(user.id)           — internal UUID
auth  : "tma" | "web"         — auth method
iat   : issued-at (auto)
exp   : expiry (auto)
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
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
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

PHONE_RE = re.compile(r"^\+?\d{9,15}$")


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


class WebRegisterRequest(BaseModel):
    """Body for POST /auth/web/register."""

    phone: str = Field(..., min_length=9, max_length=20)
    password: str = Field(..., min_length=4)
    first_name: str = Field(..., min_length=1, max_length=100)


class WebLoginRequest(BaseModel):
    """Body for POST /auth/web/login."""

    phone: str = Field(..., min_length=9, max_length=20)
    password: str = Field(..., min_length=4)


class TokenResponse(BaseModel):
    """Response body for auth endpoints."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Token lifetime in seconds")
    user_id: str = Field(description="Internal user UUID")
    telegram_user_id: int | None = None
    is_staff: bool = Field(default=False, description="Whether user is registered staff")
    first_name: str | None = None


class UserProfile(BaseModel):
    """Minimal user profile embedded in the auth response (optional)."""

    id: str
    telegram_user_id: int | None
    first_name: str
    last_name: str | None
    language_code: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helper: JWT creation
# ---------------------------------------------------------------------------


def create_access_token(
    user_uuid: uuid.UUID,
    telegram_user_id: int | None = None,
    auth_method: str = "tma",
) -> tuple[str, datetime]:
    """Create a signed JWT access token."""
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    sub = str(telegram_user_id) if telegram_user_id else str(user_uuid)

    payload = {
        "sub": sub,
        "uid": str(user_uuid),
        "auth": auth_method,
        "iat": now,
        "exp": expire,
    }
    token: str = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return token, expire


# ---------------------------------------------------------------------------
# Helper: check staff status
# ---------------------------------------------------------------------------


async def _check_staff(
    db: AsyncSession,
    telegram_user_id: int | None = None,
    user_id: uuid.UUID | None = None,
) -> bool:
    from sqlalchemy import or_

    conditions = []
    if telegram_user_id:
        conditions.append(PharmacyStaff.telegram_user_id == telegram_user_id)
    if user_id:
        conditions.append(PharmacyStaff.user_id == user_id)
    if not conditions:
        return False
    staff_result = await db.execute(
        select(PharmacyStaff).where(
            or_(*conditions),
            PharmacyStaff.is_active.is_(True),
        )
    )
    return staff_result.scalar_one_or_none() is not None


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

    is_staff = await _check_staff(db, telegram_user_id=telegram_user_id, user_id=user.id)

    token, expire = create_access_token(user.id, user.telegram_user_id, "tma")
    lifetime_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=lifetime_seconds,
        user_id=str(user.id),
        telegram_user_id=user.telegram_user_id,
        is_staff=is_staff,
        first_name=user.first_name,
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
    try:
        payload = jwt.decode(body.token, settings.secret_key, algorithms=[ALGORITHM])
        uid = payload.get("uid") or payload["sub"]
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    # Look up user by uid first, then by telegram_user_id for backward compat
    user: User | None = None
    try:
        stmt = select(User).where(User.id == uuid.UUID(uid))
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
    except ValueError:
        pass

    if user is None:
        # Backward compat: sub might be telegram_user_id
        try:
            tg_id = int(payload["sub"])
            stmt = select(User).where(User.telegram_user_id == tg_id)
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()
        except (KeyError, ValueError):
            pass

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    is_staff = await _check_staff(db, telegram_user_id=user.telegram_user_id, user_id=user.id)

    auth_method = payload.get("auth", "tma")
    token, expire = create_access_token(user.id, user.telegram_user_id, auth_method)
    lifetime_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=lifetime_seconds,
        user_id=str(user.id),
        telegram_user_id=user.telegram_user_id,
        is_staff=is_staff,
        first_name=user.first_name,
    )


# ---------------------------------------------------------------------------
# POST /auth/web/login
# ---------------------------------------------------------------------------


@router.post(
    "/web/login",
    response_model=TokenResponse,
    summary="Login with phone and password",
    responses={
        status.HTTP_200_OK: {"description": "Login successful"},
        status.HTTP_401_UNAUTHORIZED: {"description": "Invalid credentials"},
    },
)
async def web_login(
    body: WebLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    phone = body.phone.strip().replace(" ", "")

    stmt = select(User).where(User.phone == phone)
    result = await db.execute(stmt)
    user: User | None = result.scalar_one_or_none()

    if user is None or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone or password",
        )

    if not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone or password",
        )

    is_staff = await _check_staff(db, telegram_user_id=user.telegram_user_id, user_id=user.id)

    token, expire = create_access_token(user.id, user.telegram_user_id, "web")
    lifetime_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=lifetime_seconds,
        user_id=str(user.id),
        telegram_user_id=user.telegram_user_id,
        is_staff=is_staff,
        first_name=user.first_name,
    )
