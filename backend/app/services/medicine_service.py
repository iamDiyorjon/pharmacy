"""Medicine service for search, availability, and CRUD operations."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.medicine import Medicine, MedicineAvailability
from app.models.pharmacy import Pharmacy

# ---------------------------------------------------------------------------
# Latin ↔ Cyrillic transliteration for drug name search
# ---------------------------------------------------------------------------

# Multi-char mappings must come first so "sh" is matched before "s"+"h"
_LAT_TO_CYR_MULTI = [
    ("shch", "щ"), ("sch", "щ"),
    ("sh", "ш"), ("ch", "ч"), ("ts", "ц"), ("zh", "ж"),
    ("ya", "я"), ("yu", "ю"), ("yo", "ё"),
]
_LAT_TO_CYR_SINGLE = {
    "a": "а", "b": "б", "v": "в", "g": "г", "d": "д", "e": "е",
    "z": "з", "i": "и", "y": "й", "k": "к", "l": "л", "m": "м",
    "n": "н", "o": "о", "p": "п", "r": "р", "s": "с", "t": "т",
    "u": "у", "f": "ф", "h": "х", "c": "к", "w": "в", "x": "кс",
}

_CYR_TO_LAT_MULTI = [
    ("щ", "shch"), ("ш", "sh"), ("ч", "ch"), ("ц", "ts"), ("ж", "zh"),
    ("я", "ya"), ("ю", "yu"), ("ё", "yo"),
]
_CYR_TO_LAT_SINGLE = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ъ": "", "ь": "", "э": "e", "ы": "y",
}

_HAS_CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")
_HAS_LATIN = re.compile(r"[a-zA-Z]")


def _transliterate(text: str, multi: list[tuple[str, str]], single: dict[str, str]) -> str:
    result: list[str] = []
    lower = text.lower()
    i = 0
    while i < len(lower):
        matched = False
        for src, dst in multi:
            if lower[i:].startswith(src):
                result.append(dst)
                i += len(src)
                matched = True
                break
        if not matched:
            ch = lower[i]
            result.append(single.get(ch, ch))
            i += 1
    return "".join(result)


def lat_to_cyr(text: str) -> str:
    return _transliterate(text, _LAT_TO_CYR_MULTI, _LAT_TO_CYR_SINGLE)


def cyr_to_lat(text: str) -> str:
    return _transliterate(text, _CYR_TO_LAT_MULTI, _CYR_TO_LAT_SINGLE)


def _build_search_filter(query: str):
    """Build an OR filter that searches both the original query and its
    transliterated variant across name, name_ru, name_uz columns."""
    patterns = [f"%{query}%"]

    if _HAS_LATIN.search(query) and not _HAS_CYRILLIC.search(query):
        patterns.append(f"%{lat_to_cyr(query)}%")
    elif _HAS_CYRILLIC.search(query) and not _HAS_LATIN.search(query):
        patterns.append(f"%{cyr_to_lat(query)}%")

    conditions = []
    for pat in patterns:
        conditions.extend([
            Medicine.name.ilike(pat),
            Medicine.name_ru.ilike(pat),
            Medicine.name_uz.ilike(pat),
        ])
    return or_(*conditions)


class MedicineService:
    """Service layer for medicine operations."""

    async def search(
        self,
        db: AsyncSession,
        query: str,
        pharmacy_id: UUID | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Medicine], int]:
        """Search medicines using ILIKE across name, name_ru, name_uz fields.

        Automatically transliterates Latin→Cyrillic and Cyrillic→Latin so
        users can type in either script and find matches in both.

        Returns a tuple of (medicines, total_count).
        """
        name_filter = _build_search_filter(query)

        # Count query
        count_stmt = select(func.count(Medicine.id)).where(name_filter)
        if pharmacy_id is not None:
            count_stmt = count_stmt.join(Medicine.availability).where(
                MedicineAvailability.pharmacy_id == pharmacy_id
            )
        total = (await db.execute(count_stmt)).scalar() or 0

        # Data query
        stmt = (
            select(Medicine)
            .where(name_filter)
            .options(
                selectinload(Medicine.availability).selectinload(
                    MedicineAvailability.pharmacy
                )
            )
            .limit(limit)
            .offset(offset)
        )
        if pharmacy_id is not None:
            stmt = stmt.join(Medicine.availability).where(
                MedicineAvailability.pharmacy_id == pharmacy_id
            )

        result = await db.execute(stmt)
        return list(result.scalars().unique().all()), total

    async def popular(
        self,
        db: AsyncSession,
        pharmacy_id: UUID | None = None,
        limit: int = 20,
    ) -> list[Medicine]:
        """Return top medicines ordered by stock quantity (highest first)."""
        stmt = (
            select(Medicine)
            .join(Medicine.availability)
            .where(MedicineAvailability.is_available.is_(True))
            .options(
                selectinload(Medicine.availability).selectinload(
                    MedicineAvailability.pharmacy
                )
            )
            .order_by(MedicineAvailability.quantity.desc().nulls_last())
            .limit(limit)
        )
        if pharmacy_id is not None:
            stmt = stmt.where(MedicineAvailability.pharmacy_id == pharmacy_id)

        result = await db.execute(stmt)
        return list(result.scalars().unique().all())

    async def get_availability(
        self,
        db: AsyncSession,
        medicine_id: UUID,
    ) -> list[MedicineAvailability]:
        """Get availability for a specific medicine across all pharmacies."""
        stmt = (
            select(MedicineAvailability)
            .where(MedicineAvailability.medicine_id == medicine_id)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def add_medicine(
        self,
        db: AsyncSession,
        name: str,
        name_ru: str,
        name_uz: str,
        description: str | None = None,
        category: str | None = None,
        requires_prescription: bool = False,
    ) -> Medicine:
        """Add a new medicine."""
        medicine = Medicine(
            name=name,
            name_ru=name_ru,
            name_uz=name_uz,
            description=description,
            category=category,
            requires_prescription=requires_prescription,
        )
        db.add(medicine)
        await db.commit()
        await db.refresh(medicine)
        return medicine

    async def update_availability(
        self,
        db: AsyncSession,
        medicine_id: UUID,
        pharmacy_id: UUID,
        is_available: bool,
    ) -> MedicineAvailability:
        """Toggle availability of a medicine at a specific pharmacy."""
        stmt = select(MedicineAvailability).where(
            and_(
                MedicineAvailability.medicine_id == medicine_id,
                MedicineAvailability.pharmacy_id == pharmacy_id,
            )
        )
        result = await db.execute(stmt)
        availability = result.scalar_one_or_none()

        if availability is None:
            availability = MedicineAvailability(
                medicine_id=medicine_id,
                pharmacy_id=pharmacy_id,
                is_available=is_available,
            )
            db.add(availability)
        else:
            availability.is_available = is_available

        await db.commit()
        await db.refresh(availability)
        return availability

    async def list_medicines(
        self,
        db: AsyncSession,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Medicine], int]:
        """List all medicines with availability. Returns (medicines, total)."""
        count_stmt = select(func.count(Medicine.id))
        total = (await db.execute(count_stmt)).scalar() or 0

        stmt = (
            select(Medicine)
            .options(selectinload(Medicine.availability))
            .order_by(Medicine.name)
            .limit(limit)
            .offset(offset)
        )
        result = await db.execute(stmt)
        return list(result.scalars().unique().all()), total


medicine_service = MedicineService()
