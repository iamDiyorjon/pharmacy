"""
T018 / T019 - FastAPI dependency injection.

Provides:
    - get_db          : yields an AsyncSession
    - get_current_user : validates TMA initData or JWT bearer token, upserts/looks-up User
    - get_current_staff: validates User is an active PharmacyStaff, returns PharmacyStaff
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.session import get_db
from app.models.pharmacy import Pharmacy  # noqa: F401  (imported for relationship loading)
from app.models.staff import PharmacyStaff
from app.models.user import User
from app.services.telegram_auth import validate_init_data

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom auth header parser — accepts both "tma" and "Bearer" schemes.
# FastAPI's built-in HTTPBearer rejects anything other than "bearer",
# so we parse the Authorization header ourselves.
# ---------------------------------------------------------------------------
async def _parse_auth_header(request: Request) -> HTTPAuthorizationCredentials | None:
    auth = request.headers.get("Authorization")
    if not auth or " " not in auth:
        return None
    scheme, _, credentials = auth.partition(" ")
    if not credentials:
        return None
    return HTTPAuthorizationCredentials(scheme=scheme, credentials=credentials)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_parse_auth_header)
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Authenticate via JWT bearer token or Telegram Mini App initData.

    Supported ``Authorization`` headers::

        Authorization: Bearer <JWT>          — staff magic-link flow
        Authorization: tma <initDataRaw>     — Telegram Mini App flow
        Authorization: Bearer <initDataRaw>  — legacy Mini App variant

    Raises:
        HTTPException 401: if the header is absent or validation fails.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    scheme = (credentials.scheme or "").lower()
    if scheme not in {"tma", "bearer"}:
        raise credentials_exception

    token_raw: str = credentials.credentials

    # --- JWT path (staff magic-link tokens or web auth) ---------------------
    if scheme == "bearer":
        try:
            payload = jwt.decode(
                token_raw,
                settings.secret_key,
                algorithms=["HS256"],
            )
        except (JWTError, KeyError, ValueError):
            # Not a valid JWT — fall through to Telegram initData validation
            pass
        else:
            # Try uid claim first (works for both web and Telegram JWTs)
            import uuid as _uuid
            uid = payload.get("uid")
            user: User | None = None
            if uid:
                try:
                    stmt = select(User).where(User.id == _uuid.UUID(uid))
                    result = await db.execute(stmt)
                    user = result.scalar_one_or_none()
                except ValueError:
                    pass
            # Fallback: lookup by telegram_user_id from sub
            if user is None:
                try:
                    telegram_user_id = int(payload["sub"])
                    stmt = select(User).where(User.telegram_user_id == telegram_user_id)
                    result = await db.execute(stmt)
                    user = result.scalar_one_or_none()
                except (KeyError, ValueError):
                    pass
            if user is None:
                raise credentials_exception
            return user

    # --- Telegram initData path (Mini App) ---------------------------------
    parsed = validate_init_data(token_raw, settings.telegram_bot_token)
    if parsed is None:
        raise credentials_exception

    tg_user: dict = parsed.get("user", {})
    telegram_user_id_tg: int | None = tg_user.get("id")
    if not telegram_user_id_tg:
        logger.warning("initData missing user.id field")
        raise credentials_exception

    # Upsert user ---------------------------------------------------------
    stmt = select(User).where(User.telegram_user_id == telegram_user_id_tg)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    first_name: str = tg_user.get("first_name") or "Unknown"
    last_name: str | None = tg_user.get("last_name")
    language_code: str = tg_user.get("language_code") or "uz"

    if user is None:
        user = User(
            telegram_user_id=telegram_user_id_tg,
            first_name=first_name,
            last_name=last_name,
            language_code=language_code,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info("Created new user telegram_user_id=%s", telegram_user_id_tg)
    else:
        # Keep profile data fresh from Telegram
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

    return user


async def get_current_staff(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> PharmacyStaff:
    """Verify that the authenticated user is an active PharmacyStaff member.

    Eagerly loads the related :class:`Pharmacy` so callers can access
    ``staff.pharmacy`` without triggering lazy-load errors.

    Raises:
        HTTPException 403: if the user is not registered as active staff.
    """
    stmt = (
        select(PharmacyStaff)
        .where(
            PharmacyStaff.telegram_user_id == current_user.telegram_user_id,
            PharmacyStaff.is_active.is_(True),
        )
        .options(selectinload(PharmacyStaff.pharmacy))
    )
    result = await db.execute(stmt)
    staff: PharmacyStaff | None = result.scalar_one_or_none()

    if staff is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not registered as pharmacy staff",
        )

    return staff
