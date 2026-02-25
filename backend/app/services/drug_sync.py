"""
Background drug sync scheduler.

Periodically imports drugs from the Excel file for the ADIKA SHIFO-NUR MCHJ pharmacy.
Configurable via DRUG_SYNC_INTERVAL_HOURS env var (default: 12).
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from sqlalchemy import select

from app.db.session import async_session
from app.models.pharmacy import Pharmacy
from app.services.drug_import import import_drugs_from_excel

logger = logging.getLogger(__name__)

SYNC_INTERVAL_HOURS = int(os.environ.get("DRUG_SYNC_INTERVAL_HOURS", "12"))
EXCEL_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "drugs" / "adika.xlsx"
PHARMACY_NAME = "ADIKA SHIFO-NUR MCHJ"


async def _get_pharmacy_id():
    """Look up the ADIKA SHIFO-NUR MCHJ pharmacy by name."""
    async with async_session() as session:
        result = await session.execute(
            select(Pharmacy.id).where(Pharmacy.name == PHARMACY_NAME)
        )
        row = result.scalar_one_or_none()
        return row


async def _run_sync() -> None:
    """Run a single sync pass."""
    if not EXCEL_PATH.exists():
        logger.warning("Excel file not found at %s — skipping sync", EXCEL_PATH)
        return

    pharmacy_id = await _get_pharmacy_id()
    if pharmacy_id is None:
        logger.warning("Pharmacy '%s' not found in database — skipping sync", PHARMACY_NAME)
        return

    logger.info("Starting drug sync from %s for pharmacy %s", EXCEL_PATH, pharmacy_id)
    stats = await import_drugs_from_excel(str(EXCEL_PATH), pharmacy_id)
    logger.info("Drug sync finished: %s", stats)


async def run_drug_sync() -> None:
    """Background loop that syncs drugs every SYNC_INTERVAL_HOURS hours."""
    interval_seconds = SYNC_INTERVAL_HOURS * 3600
    logger.info(
        "Drug sync scheduler started (interval=%dh, file=%s)",
        SYNC_INTERVAL_HOURS, EXCEL_PATH,
    )

    # Run once at startup
    try:
        await _run_sync()
    except Exception:
        logger.exception("Drug sync error on startup")

    # Then loop
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await _run_sync()
        except Exception:
            logger.exception("Drug sync error")
