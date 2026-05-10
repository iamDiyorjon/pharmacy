"""
Drug import service — reads an Excel file and upserts medicines + availability.

Columns are matched by header name (not by position), so the order of columns
in the Excel file does not matter. The header row is auto-detected by scanning
for known column names from `COLUMN_ALIASES`. Data rows are read starting from
the row immediately after the detected header.

Sheet name defaults to "TABE" but if it isn't found, the first sheet is used.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from pathlib import Path
from uuid import UUID

from openpyxl import load_workbook
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.models.medicine import Medicine, MedicineAvailability, normalize_medicine_name

logger = logging.getLogger(__name__)

SHEET_NAME = "TABE"
HEADER_SCAN_LIMIT = 20  # scan at most this many top rows for the header

# Each field maps to a list of acceptable header names (case/space-insensitive).
COLUMN_ALIASES: dict[str, list[str]] = {
    "name": ["наименование", "название", "препарат", "name", "drug name"],
    "manufacturer": ["производитель", "manufacturer", "изготовитель"],
    "expiry": ["срок годности", "срок", "expiry", "expiry date", "годен до"],
    "price": ["цена продажная", "цена", "price", "продажная цена", "стоимость"],
    "quantity": ["кол-во", "количество", "quantity", "qty", "остаток"],
}

REQUIRED_FIELDS = {"name", "price", "quantity"}


def _normalize_header(value) -> str:
    """Lowercase + collapse whitespace, for tolerant header matching."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def _build_alias_lookup() -> dict[str, str]:
    """Flatten COLUMN_ALIASES into {normalized_alias: field_name}."""
    return {
        _normalize_header(alias): field
        for field, aliases in COLUMN_ALIASES.items()
        for alias in aliases
    }


def _detect_header(ws) -> tuple[int, dict[str, int]]:
    """Find the header row and return (row_number, {field: column_index}).

    Scans the first `HEADER_SCAN_LIMIT` rows and picks the first row that
    contains all REQUIRED_FIELDS. Column index is 0-based (matches `row[i]`).
    """
    alias_lookup = _build_alias_lookup()

    for row_num, row in enumerate(
        ws.iter_rows(min_row=1, max_row=HEADER_SCAN_LIMIT), start=1
    ):
        mapping: dict[str, int] = {}
        for idx, cell in enumerate(row):
            field = alias_lookup.get(_normalize_header(cell.value))
            if field and field not in mapping:
                mapping[field] = idx
        if REQUIRED_FIELDS.issubset(mapping):
            return row_num, mapping

    raise ValueError(
        f"Could not detect header row. Required columns: {sorted(REQUIRED_FIELDS)}. "
        f"Known aliases: {COLUMN_ALIASES}"
    )


def _parse_expiry(value) -> date | None:
    """Parse expiry date from Excel cell value."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _parse_number(value, default=None):
    """Parse a numeric cell value."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def import_drugs_from_excel(file_path: str, pharmacy_id: UUID) -> dict:
    """Import drugs from an Excel file into the database.

    Returns a dict with stats: {new, updated, skipped, errors}.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {file_path}")

    wb = load_workbook(path, read_only=True, data_only=True)
    if SHEET_NAME in wb.sheetnames:
        ws = wb[SHEET_NAME]
    else:
        ws = wb[wb.sheetnames[0]]
        logger.warning(
            "Sheet '%s' not found, falling back to first sheet '%s'",
            SHEET_NAME,
            ws.title,
        )

    header_row, columns = _detect_header(ws)
    data_start_row = header_row + 1
    logger.info("Detected header at row %d, column mapping: %s", header_row, columns)

    name_col = columns["name"]
    manufacturer_col = columns.get("manufacturer")
    expiry_col = columns.get("expiry")
    price_col = columns["price"]
    quantity_col = columns["quantity"]

    def _cell(row, idx):
        return row[idx].value if idx is not None and idx < len(row) else None

    stats = {"new": 0, "updated": 0, "skipped": 0, "errors": 0}

    async with async_session() as session:
        for row_num, row in enumerate(
            ws.iter_rows(min_row=data_start_row), start=data_start_row
        ):
            try:
                name_ru = _cell(row, name_col)
                if not name_ru or not str(name_ru).strip():
                    stats["skipped"] += 1
                    continue

                name_ru = str(name_ru).strip()
                raw_manufacturer = _cell(row, manufacturer_col)
                manufacturer = (
                    str(raw_manufacturer).strip() if raw_manufacturer else None
                )
                expiry_date = _parse_expiry(_cell(row, expiry_col))
                price = _parse_number(_cell(row, price_col))
                quantity = _parse_number(_cell(row, quantity_col), default=0)

                # Upsert Medicine by normalized name (case/whitespace/punct insensitive)
                norm_name = normalize_medicine_name(name_ru)
                result = await session.execute(
                    select(Medicine).where(Medicine.normalized_name == norm_name)
                )
                medicine = result.scalar_one_or_none()

                if medicine is None:
                    medicine = Medicine(
                        name=name_ru,  # Use Russian name as primary name too
                        name_ru=name_ru,
                        normalized_name=norm_name,
                        manufacturer=manufacturer,
                    )
                    session.add(medicine)
                    await session.flush()
                    stats["new"] += 1
                else:
                    if manufacturer and medicine.manufacturer != manufacturer:
                        medicine.manufacturer = manufacturer
                    stats["updated"] += 1

                # Upsert MedicineAvailability
                result = await session.execute(
                    select(MedicineAvailability).where(
                        and_(
                            MedicineAvailability.medicine_id == medicine.id,
                            MedicineAvailability.pharmacy_id == pharmacy_id,
                        )
                    )
                )
                avail = result.scalar_one_or_none()

                if avail is None:
                    avail = MedicineAvailability(
                        medicine_id=medicine.id,
                        pharmacy_id=pharmacy_id,
                        is_available=quantity is not None and quantity > 0,
                        price=price,
                        quantity=quantity,
                        expiry_date=expiry_date,
                    )
                    session.add(avail)
                else:
                    avail.price = price
                    avail.quantity = quantity
                    avail.is_available = quantity is not None and quantity > 0
                    avail.expiry_date = expiry_date

            except Exception:
                logger.exception("Error processing row %d", row_num)
                stats["errors"] += 1
                continue

        await session.commit()

    wb.close()

    logger.info(
        "Import complete: %d new, %d updated, %d skipped, %d errors",
        stats["new"],
        stats["updated"],
        stats["skipped"],
        stats["errors"],
    )
    return stats
