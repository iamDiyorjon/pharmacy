import asyncio
import logging
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher
from fastapi import FastAPI

from app.api import router as api_router
from app.api.middleware import setup_middleware
from app.bot.handlers import register_handlers
from app.config import settings
from app.services.drug_sync import run_drug_sync
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
    drug_sync_task = asyncio.create_task(run_drug_sync())

    # Start bot polling in debug mode
    polling_task = None
    if settings.debug:
        async def _poll():
            try:
                await dp.start_polling(bot)
            except asyncio.CancelledError:
                pass

        polling_task = asyncio.create_task(_poll())

    yield

    # Shutdown
    scheduler_task.cancel()
    drug_sync_task.cancel()
    try:
        await scheduler_task
    except (asyncio.CancelledError, Exception):
        pass
    try:
        await drug_sync_task
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
