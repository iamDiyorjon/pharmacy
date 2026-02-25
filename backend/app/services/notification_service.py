"""
T022 - Notification service.

Provides helpers for sending Telegram messages to:
  - Individual customers (by Telegram user ID).
  - Pharmacy staff (via a pharmacy group/channel chat ID stored on the Pharmacy
    model).

All functions are fire-and-forget style: errors are logged but never raised,
so a notification failure never breaks the calling business-logic path.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

if TYPE_CHECKING:
    from app.models.pharmacy import Pharmacy

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Customer notifications
# ---------------------------------------------------------------------------


async def notify_customer(
    bot: Bot,
    telegram_user_id: int,
    message: str,
    *,
    parse_mode: str = "HTML",
    disable_notification: bool = False,
) -> bool:
    """Send a Telegram message to a customer.

    Args:
        bot: The :class:`aiogram.Bot` instance.
        telegram_user_id: The customer's Telegram user ID.
        message: The text to send (supports HTML formatting by default).
        parse_mode: Telegram parse mode (``"HTML"`` or ``"Markdown"``).
        disable_notification: If ``True`` the message arrives silently.

    Returns:
        ``True`` if the message was sent successfully, ``False`` otherwise.
    """
    try:
        await bot.send_message(
            chat_id=telegram_user_id,
            text=message,
            parse_mode=parse_mode,
            disable_notification=disable_notification,
        )
        logger.debug("Notified customer telegram_user_id=%s", telegram_user_id)
        return True
    except TelegramAPIError as exc:
        logger.warning(
            "Failed to notify customer telegram_user_id=%s: %s",
            telegram_user_id,
            exc,
        )
        return False
    except Exception:
        logger.exception(
            "Unexpected error notifying customer telegram_user_id=%s",
            telegram_user_id,
        )
        return False


# ---------------------------------------------------------------------------
# Pharmacy notifications
# ---------------------------------------------------------------------------


async def notify_pharmacy(
    bot: Bot,
    pharmacy: "Pharmacy",
    message: str,
    *,
    parse_mode: str = "HTML",
    disable_notification: bool = False,
) -> bool:
    """Send a Telegram message to a pharmacy's staff chat.

    The pharmacy must have ``telegram_chat_id`` set; if it does not, the call
    is a no-op and a warning is logged.

    Args:
        bot: The :class:`aiogram.Bot` instance.
        pharmacy: The :class:`~app.models.pharmacy.Pharmacy` ORM object.
        message: The text to send.
        parse_mode: Telegram parse mode.
        disable_notification: If ``True`` the message arrives silently.

    Returns:
        ``True`` if the message was sent successfully, ``False`` otherwise.
    """
    if not pharmacy.telegram_chat_id:
        logger.warning(
            "Pharmacy '%s' (id=%s) has no telegram_chat_id configured; "
            "notification skipped.",
            pharmacy.name,
            pharmacy.id,
        )
        return False

    try:
        await bot.send_message(
            chat_id=pharmacy.telegram_chat_id,
            text=message,
            parse_mode=parse_mode,
            disable_notification=disable_notification,
        )
        logger.debug(
            "Notified pharmacy '%s' (chat_id=%s)",
            pharmacy.name,
            pharmacy.telegram_chat_id,
        )
        return True
    except TelegramAPIError as exc:
        logger.warning(
            "Failed to notify pharmacy '%s' (chat_id=%s): %s",
            pharmacy.name,
            pharmacy.telegram_chat_id,
            exc,
        )
        return False
    except Exception:
        logger.exception(
            "Unexpected error notifying pharmacy '%s' (chat_id=%s)",
            pharmacy.name,
            pharmacy.telegram_chat_id,
        )
        return False


# ---------------------------------------------------------------------------
# Bulk helpers
# ---------------------------------------------------------------------------


async def notify_all_pharmacy_staff(
    bot: Bot,
    pharmacy: "Pharmacy",
    message: str,
    *,
    parse_mode: str = "HTML",
) -> dict[int, bool]:
    """Send a direct message to every active staff member of a pharmacy.

    This is a fallback for pharmacies that do not have a group chat configured.
    Prefers :func:`notify_pharmacy` (group chat) when available.

    Args:
        bot: The :class:`aiogram.Bot` instance.
        pharmacy: Pharmacy whose staff list should be iterated
                  (must be loaded with ``selectinload(Pharmacy.staff)``).
        message: The text to send.
        parse_mode: Telegram parse mode.

    Returns:
        A mapping of ``{telegram_user_id: success_bool}`` for each staff member.
    """
    results: dict[int, bool] = {}
    for staff in pharmacy.staff:
        if not staff.is_active:
            continue
        success = await notify_customer(
            bot, staff.telegram_user_id, message, parse_mode=parse_mode
        )
        results[staff.telegram_user_id] = success
    return results
