"""
T021 - Admin bot commands.

Only the user whose Telegram ID matches ``settings.admin_telegram_id`` can
execute these commands.

Supported commands
------------------
/addstaff <telegram_user_id> <pharmacy_id> <name>
    Creates a PharmacyStaff record linking the given Telegram user to a
    pharmacy.  ``name`` may contain spaces (anything after the second
    positional argument is treated as the staff member's full name).
"""

from __future__ import annotations

import logging
import uuid

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy import select

from app.api.auth import create_access_token
from app.config import settings
from app.db.session import async_session
from app.models.pharmacy import Pharmacy
from app.models.staff import PharmacyStaff
from app.models.user import User

logger = logging.getLogger(__name__)

admin_router = Router(name="admin")


# ---------------------------------------------------------------------------
# /staff  (available to all users — sends a magic link if user is staff)
# ---------------------------------------------------------------------------


@admin_router.message(Command("staff"))
async def cmd_staff(message: Message) -> None:
    """Generate a magic link for staff to access the dashboard in a browser."""
    if message.from_user is None:
        return

    telegram_user_id = message.from_user.id

    async with async_session() as session:
        # Check if the sender is active staff
        staff_result = await session.execute(
            select(PharmacyStaff).where(
                PharmacyStaff.telegram_user_id == telegram_user_id,
                PharmacyStaff.is_active.is_(True),
            )
        )
        staff: PharmacyStaff | None = staff_result.scalar_one_or_none()

        if staff is None:
            await message.answer("You are not registered as staff.")
            return

        # Look up the User record to get the internal UUID
        user_result = await session.execute(
            select(User).where(User.telegram_user_id == telegram_user_id)
        )
        user: User | None = user_result.scalar_one_or_none()

        if user is None:
            await message.answer("User account not found. Please open the Mini App first.")
            return

    # Generate JWT
    token, _expire = create_access_token(telegram_user_id, user.id)
    base_url = settings.telegram_webapp_url.rstrip("/")
    magic_link = f"{base_url}/staff?token={token}"

    await message.answer(
        f"Open this link in any browser to access the staff dashboard:\n\n"
        f"{magic_link}\n\n"
        "This link is valid for 7 days. Do not share it with others.",
        disable_web_page_preview=True,
    )


# ---------------------------------------------------------------------------
# Admin gate filter
# ---------------------------------------------------------------------------


def _is_admin(message: Message) -> bool:
    """Return True if the message sender is the configured admin."""
    return (
        message.from_user is not None
        and settings.admin_telegram_id != 0
        and message.from_user.id == settings.admin_telegram_id
    )


# ---------------------------------------------------------------------------
# /addstaff
# ---------------------------------------------------------------------------


@admin_router.message(Command("addstaff"))
async def cmd_add_staff(message: Message) -> None:
    """Create a PharmacyStaff record.

    Usage::

        /addstaff <telegram_user_id> <pharmacy_id> <full name>

    Examples::

        /addstaff 123456789 550e8400-e29b-41d4-a716-446655440000 Kamol Toshmatov
    """
    if not _is_admin(message):
        # Silently ignore non-admin users – do not reveal the command exists.
        logger.warning(
            "Non-admin user %s attempted /addstaff",
            message.from_user.id if message.from_user else "unknown",
        )
        return

    # Parse arguments -------------------------------------------------------
    text = (message.text or "").strip()
    parts = text.split(maxsplit=3)  # ["/addstaff", user_id, pharmacy_id, name...]
    if len(parts) < 4:
        await message.answer(
            "Usage: /addstaff <telegram_user_id> <pharmacy_id> <full name>\n\n"
            "Example:\n"
            "/addstaff 123456789 550e8400-e29b-41d4-a716-446655440000 Kamol Toshmatov"
        )
        return

    raw_user_id, raw_pharmacy_id, staff_name = parts[1], parts[2], parts[3].strip()

    # Validate telegram_user_id
    try:
        telegram_user_id = int(raw_user_id)
    except ValueError:
        await message.answer(
            f"Invalid telegram_user_id: '{raw_user_id}'. Must be an integer."
        )
        return

    # Validate pharmacy_id (UUID)
    try:
        pharmacy_id = uuid.UUID(raw_pharmacy_id)
    except ValueError:
        await message.answer(
            f"Invalid pharmacy_id: '{raw_pharmacy_id}'. Must be a valid UUID.\n"
            "You can get the pharmacy UUID from the database or /listpharmacies command."
        )
        return

    if not staff_name:
        await message.answer("Staff name cannot be empty.")
        return

    # Database operations ---------------------------------------------------
    async with async_session() as session:
        # Verify pharmacy exists
        pharmacy_result = await session.execute(
            select(Pharmacy).where(Pharmacy.id == pharmacy_id)
        )
        pharmacy: Pharmacy | None = pharmacy_result.scalar_one_or_none()
        if pharmacy is None:
            await message.answer(
                f"Pharmacy with ID {pharmacy_id} not found. "
                "Please check the UUID and try again."
            )
            return

        # Check for duplicate staff entry
        existing_result = await session.execute(
            select(PharmacyStaff).where(
                PharmacyStaff.telegram_user_id == telegram_user_id
            )
        )
        existing: PharmacyStaff | None = existing_result.scalar_one_or_none()
        if existing is not None:
            await message.answer(
                f"Telegram user {telegram_user_id} is already registered as staff "
                f"at pharmacy '{existing.pharmacy_id}'.\n"
                f"Current name: {existing.name}\n"
                f"Active: {'Yes' if existing.is_active else 'No'}"
            )
            return

        # Create staff record
        new_staff = PharmacyStaff(
            pharmacy_id=pharmacy_id,
            telegram_user_id=telegram_user_id,
            name=staff_name,
            role="pharmacist",
            is_active=True,
        )
        session.add(new_staff)
        await session.commit()
        await session.refresh(new_staff)

    logger.info(
        "Admin created staff: telegram_user_id=%s, pharmacy_id=%s, name=%s",
        telegram_user_id,
        pharmacy_id,
        staff_name,
    )

    await message.answer(
        f"Staff member added successfully!\n\n"
        f"Name: {staff_name}\n"
        f"Telegram ID: {telegram_user_id}\n"
        f"Pharmacy: {pharmacy.name}\n"
        f"Role: pharmacist\n"
        f"Status: Active"
    )


# ---------------------------------------------------------------------------
# /deactivatestaff
# ---------------------------------------------------------------------------


@admin_router.message(Command("deactivatestaff"))
async def cmd_deactivate_staff(message: Message) -> None:
    """Deactivate a staff member by Telegram user ID.

    Usage::

        /deactivatestaff <telegram_user_id>
    """
    if not _is_admin(message):
        return

    text = (message.text or "").strip()
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Usage: /deactivatestaff <telegram_user_id>")
        return

    try:
        telegram_user_id = int(parts[1])
    except ValueError:
        await message.answer(f"Invalid telegram_user_id: '{parts[1]}'. Must be an integer.")
        return

    async with async_session() as session:
        result = await session.execute(
            select(PharmacyStaff).where(
                PharmacyStaff.telegram_user_id == telegram_user_id
            )
        )
        staff: PharmacyStaff | None = result.scalar_one_or_none()

        if staff is None:
            await message.answer(f"No staff member found with Telegram ID {telegram_user_id}.")
            return

        if not staff.is_active:
            await message.answer(
                f"Staff member {staff.name} (ID: {telegram_user_id}) is already inactive."
            )
            return

        staff.is_active = False
        await session.commit()

    logger.info("Admin deactivated staff telegram_user_id=%s", telegram_user_id)
    await message.answer(
        f"Staff member {staff.name} (Telegram ID: {telegram_user_id}) has been deactivated."
    )


# ---------------------------------------------------------------------------
# /listpharmacies  (helper for admins to find UUIDs)
# ---------------------------------------------------------------------------


@admin_router.message(Command("listpharmacies"))
async def cmd_list_pharmacies(message: Message) -> None:
    """List all pharmacies with their UUIDs (admin only)."""
    if not _is_admin(message):
        return

    async with async_session() as session:
        result = await session.execute(
            select(Pharmacy).where(Pharmacy.is_active.is_(True)).order_by(Pharmacy.name)
        )
        pharmacies = result.scalars().all()

    if not pharmacies:
        await message.answer("No active pharmacies found.")
        return

    lines = ["<b>Active Pharmacies:</b>\n"]
    for p in pharmacies:
        lines.append(f"• <b>{p.name}</b>\n  ID: <code>{p.id}</code>\n  {p.address}")

    await message.answer("\n".join(lines), parse_mode="HTML")
