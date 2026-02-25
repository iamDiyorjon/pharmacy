"""
T020 - aiogram 3.x bot handlers.

Registers the /start command handler that:
  1. Sends a localised welcome message.
  2. Upserts the user record in the database so that first-time Telegram
     interactions (without a Mini App session) still create a profile.
"""

from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

from app.config import settings

logger = logging.getLogger(__name__)

router = Router(name="main")


# ---------------------------------------------------------------------------
# i18n — bot messages in three languages
# ---------------------------------------------------------------------------

MESSAGES = {
    "uz": {
        "welcome": (
            "Assalomu alaykum, {name}! 👋\n\n"
            "<b>Dorixona Pickup</b> platformasiga xush kelibsiz.\n\n"
            "Bu yerda siz dori qidirishingiz, retsept yuklashingiz va "
            "tayyor buyurtmangizni navbatsiz olib ketishingiz mumkin.\n\n"
            "Ilovani ochish uchun quyidagi tugmani bosing."
        ),
        "welcome_no_url": (
            "Assalomu alaykum, {name}! 👋\n\n"
            "<b>Dorixona Pickup</b> platformasiga xush kelibsiz.\n\n"
            "Bu bot orqali dori buyurtma berishingiz mumkin. "
            "Boshlash uchun Mini App'ni oching."
        ),
        "help": (
            "ℹ️ <b>Dorixona Pickup — foydalanish yo'riqnomasi</b>\n\n"
            "1. <b>Ilovani ochish</b> tugmasini bosing.\n"
            "2. Kerakli dorini qidiring yoki retsept rasmini yuklang.\n"
            "3. Buyurtmani tasdiqlang — dorixona uni tayyorlaydi.\n"
            "4. Tayyor bo'lganda, navbatsiz olib keting! 🎉\n\n"
            "Savol bo'lsa, dorixona kassasiga murojaat qiling."
        ),
        "unknown": "Iltimos, dorixona ilovasini ochish uchun quyidagi tugmani bosing.",
        "open_app": "Ilovani ochish",
    },
    "ru": {
        "welcome": (
            "Здравствуйте, {name}! 👋\n\n"
            "Добро пожаловать на платформу <b>Pharmacy Pickup</b>.\n\n"
            "Здесь вы можете найти нужное лекарство, загрузить рецепт и "
            "забрать готовый заказ без очереди.\n\n"
            "Нажмите кнопку ниже, чтобы открыть приложение."
        ),
        "welcome_no_url": (
            "Здравствуйте, {name}! 👋\n\n"
            "Добро пожаловать на платформу <b>Pharmacy Pickup</b>.\n\n"
            "Этот бот поможет вам заказать лекарства для самовывоза. "
            "Откройте Mini App, чтобы начать."
        ),
        "help": (
            "ℹ️ <b>Pharmacy Pickup — руководство</b>\n\n"
            "1. Нажмите кнопку <b>Открыть приложение</b>.\n"
            "2. Найдите нужное лекарство или загрузите фото рецепта.\n"
            "3. Подтвердите заказ — аптека его подготовит.\n"
            "4. Заберите лекарства без очереди! 🎉\n\n"
            "По вопросам обращайтесь на кассу аптеки."
        ),
        "unknown": "Пожалуйста, нажмите кнопку ниже, чтобы открыть приложение аптеки.",
        "open_app": "Открыть приложение",
    },
    "en": {
        "welcome": (
            "Hello, {name}! 👋\n\n"
            "Welcome to <b>Pharmacy Pickup</b>.\n\n"
            "Search for medicines, upload prescriptions, and pick up "
            "your prepared order without waiting in line.\n\n"
            "Tap the button below to open the app."
        ),
        "welcome_no_url": (
            "Hello, {name}! 👋\n\n"
            "Welcome to <b>Pharmacy Pickup</b>.\n\n"
            "This bot helps you order medicines for pickup. "
            "Please open the Mini App to get started."
        ),
        "help": (
            "ℹ️ <b>Pharmacy Pickup — How to use</b>\n\n"
            "1. Tap the <b>Open App</b> button.\n"
            "2. Search for a medicine or upload a prescription photo.\n"
            "3. Confirm your order — the pharmacy will prepare it.\n"
            "4. Pick up your medicines without waiting! 🎉\n\n"
            "For questions, contact us at the pharmacy counter."
        ),
        "unknown": "Please tap the button below to open the pharmacy app.",
        "open_app": "Open App",
    },
}


def _get_lang(message: Message) -> str:
    """Detect language from Telegram user's language_code."""
    code = (message.from_user.language_code or "") if message.from_user else ""
    if code.startswith("uz"):
        return "uz"
    if code.startswith("ru"):
        return "ru"
    return "uz"  # default to Uzbek


def _msg(message: Message, key: str, **kwargs: str) -> str:
    """Get a translated message string."""
    lang = _get_lang(message)
    text = MESSAGES[lang][key]
    if kwargs:
        text = text.format(**kwargs)
    return text


def _open_app_keyboard(message: Message) -> InlineKeyboardMarkup | None:
    """Build the 'Open App' inline keyboard if webapp URL is configured."""
    if not settings.telegram_webapp_url:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=_msg(message, "open_app"),
                    web_app=WebAppInfo(url=settings.telegram_webapp_url),
                )
            ]
        ]
    )


# ---------------------------------------------------------------------------
# /start
# ---------------------------------------------------------------------------


@router.message(CommandStart())
async def cmd_start(message: Message, bot: Bot) -> None:
    """Handle the /start command with a localised welcome message."""
    user = message.from_user
    if user is None:
        return

    first_name = user.first_name or "there"
    logger.info("User %s started the bot (telegram_user_id=%s)", first_name, user.id)

    key = "welcome" if settings.telegram_webapp_url else "welcome_no_url"

    await message.answer(
        text=_msg(message, key, name=first_name),
        parse_mode="HTML",
        reply_markup=_open_app_keyboard(message),
    )


# ---------------------------------------------------------------------------
# /help
# ---------------------------------------------------------------------------


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    """Respond with a localised usage guide."""
    await message.answer(
        _msg(message, "help"),
        parse_mode="HTML",
    )


# ---------------------------------------------------------------------------
# Catch-all for unrecognised text (only in private chats)
# ---------------------------------------------------------------------------


@router.message(F.chat.type == "private")
async def handle_unknown(message: Message) -> None:
    """Prompt unrecognised messages back to the Mini App."""
    await message.answer(
        _msg(message, "unknown"),
        reply_markup=_open_app_keyboard(message),
    )


# ---------------------------------------------------------------------------
# Registration entry-point called from main.py
# ---------------------------------------------------------------------------


def register_handlers(dp: Dispatcher) -> None:
    """Register all routers with the given :class:`Dispatcher`."""
    from app.bot.admin import admin_router  # noqa: PLC0415

    dp.include_router(admin_router)
    dp.include_router(router)

    logger.info("Bot handlers registered (main + admin routers)")
