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
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    WebAppInfo,
)
from sqlalchemy import select

from app.config import settings
from app.db.session import async_session
from app.models.user import User

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
        "share_contact": "📱 Raqamni ulashish",
        "ask_contact": (
            "📞 Buyurtmalaringiz uchun telefon raqamingizni ulashing.\n\n"
            "Dorixona kerak bo'lganda shu raqamga qo'ng'iroq qiladi."
        ),
        "contact_saved": (
            "✅ Rahmat! Raqam saqlandi.\n\nEndi ilovani ochishingiz mumkin."
        ),
        "contact_mismatch": ("⚠️ Iltimos, faqat o'zingizning raqamingizni ulashing."),
        "contact_in_use": (
            "⚠️ Bu raqam boshqa hisobga biriktirilgan. Iltimos boshqa raqam kiriting yoki ushbu raqam egasiga murojaat qiling."
        ),
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
        "share_contact": "📱 Поделиться номером",
        "ask_contact": (
            "📞 Поделитесь номером телефона для ваших заказов.\n\n"
            "Аптека позвонит на этот номер при необходимости."
        ),
        "contact_saved": (
            "✅ Спасибо! Номер сохранён.\n\nТеперь можете открыть приложение."
        ),
        "contact_mismatch": ("⚠️ Пожалуйста, поделитесь только своим контактом."),
        "contact_in_use": (
            "⚠️ Этот номер уже привязан к другому аккаунту. Введите другой номер или свяжитесь с владельцем."
        ),
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
        "share_contact": "📱 Share contact",
        "ask_contact": (
            "📞 Please share your phone number for your orders.\n\n"
            "The pharmacy will call this number if needed."
        ),
        "contact_saved": ("✅ Thank you! Number saved.\n\nYou can now open the app."),
        "contact_mismatch": ("⚠️ Please share only your own contact."),
        "contact_in_use": (
            "⚠️ This number is already linked to another account. Please use a different one or contact its owner."
        ),
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


def _share_contact_keyboard(message: Message) -> ReplyKeyboardMarkup:
    """Reply keyboard with a single 'Share contact' button."""
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=_msg(message, "share_contact"), request_contact=True)]
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


async def _user_has_phone(telegram_user_id: int) -> bool:
    """Return True if the user already has a phone saved."""
    async with async_session() as session:
        result = await session.execute(
            select(User.phone).where(User.telegram_user_id == telegram_user_id)
        )
        phone = result.scalar_one_or_none()
        return bool(phone)


# ---------------------------------------------------------------------------
# /start
# ---------------------------------------------------------------------------


@router.message(CommandStart())
async def cmd_start(message: Message, bot: Bot) -> None:
    """Handle the /start command with a localised welcome message.

    If the user has not yet shared their phone, prompts them with a
    ``request_contact`` reply keyboard before showing the Open App button.
    """
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

    if not await _user_has_phone(user.id):
        await message.answer(
            _msg(message, "ask_contact"),
            reply_markup=_share_contact_keyboard(message),
        )


# ---------------------------------------------------------------------------
# Contact handler — saves shared phone to User.phone
# ---------------------------------------------------------------------------


@router.message(F.contact)
async def handle_contact(message: Message) -> None:
    """Persist the phone number from a shared contact to ``User.phone``."""
    contact = message.contact
    sender = message.from_user
    if contact is None or sender is None:
        return

    if contact.user_id and contact.user_id != sender.id:
        await message.answer(
            _msg(message, "contact_mismatch"),
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    raw_phone = contact.phone_number or ""
    phone = raw_phone if raw_phone.startswith("+") else f"+{raw_phone}"

    from sqlalchemy.exc import IntegrityError  # noqa: PLC0415

    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.telegram_user_id == sender.id)
        )
        user: User | None = result.scalar_one_or_none()

        if user is None:
            user = User(
                telegram_user_id=sender.id,
                telegram_username=sender.username,
                first_name=sender.first_name or "Unknown",
                last_name=sender.last_name,
                phone=phone,
                language_code=(sender.language_code or "uz")[:10],
            )
            session.add(user)
        else:
            user.phone = phone

        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await message.answer(
                _msg(message, "contact_in_use"),
                reply_markup=ReplyKeyboardRemove(),
            )
            return

    await message.answer(
        _msg(message, "contact_saved"),
        reply_markup=ReplyKeyboardRemove(),
    )
    if open_app := _open_app_keyboard(message):
        await message.answer(
            _msg(
                message,
                "welcome_no_url" if not settings.telegram_webapp_url else "open_app",
            ),
            reply_markup=open_app,
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
