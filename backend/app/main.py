import asyncio
import logging
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi import FastAPI, Header, HTTPException, Request

from app.api import router as api_router
from app.api.middleware import setup_middleware
from app.bot.handlers import register_handlers
from app.config import settings
from app.services.scheduler import run_scheduler
from app.services.storage_service import storage

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    bot = Bot(token=settings.telegram_bot_token)
    dp = Dispatcher()
    register_handlers(dp)

    app.state.bot = bot
    app.state.dp = dp

    # Ensure MinIO bucket exists
    try:
        await storage.ensure_bucket()
        logger.info("MinIO bucket '%s' ready", settings.minio_bucket)
    except Exception:
        logger.warning("Could not ensure MinIO bucket — storage may not work")

    # Start background schedulers
    scheduler_task = asyncio.create_task(run_scheduler())

    # Bot updates: polling in debug, webhook in production
    polling_task = None
    if settings.debug:

        async def _poll():
            try:
                await bot.delete_webhook(drop_pending_updates=True)
                await dp.start_polling(bot)
            except asyncio.CancelledError:
                pass

        polling_task = asyncio.create_task(_poll())
    elif settings.telegram_webhook_url:
        await bot.set_webhook(
            url=settings.telegram_webhook_url,
            secret_token=settings.telegram_webhook_secret or None,
            drop_pending_updates=True,
        )
        logger.info("Telegram webhook set to %s", settings.telegram_webhook_url)
    else:
        logger.warning(
            "Bot has no update source: DEBUG is off and TELEGRAM_WEBHOOK_URL is empty"
        )

    yield

    # Shutdown
    scheduler_task.cancel()
    try:
        await scheduler_task
    except (asyncio.CancelledError, Exception):
        pass

    if polling_task:
        polling_task.cancel()
        try:
            await polling_task
        except Exception:
            pass
    await bot.session.close()


app = FastAPI(
    title="Pharmacy Pickup Platform API",
    version="1.0.0",
    lifespan=lifespan,
)

setup_middleware(app)
app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if settings.telegram_webhook_secret and (
        x_telegram_bot_api_secret_token != settings.telegram_webhook_secret
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    update = Update.model_validate(await request.json(), context={"bot": app.state.bot})
    await app.state.dp.feed_update(app.state.bot, update)
    return {"ok": True}
