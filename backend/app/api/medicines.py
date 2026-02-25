"""
T041 - Medicine search endpoints.

GET /medicines/search  — search medicines with availability per pharmacy
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.medicine_service import MedicineService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/medicines", tags=["medicines"])

medicine_service = MedicineService()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class AvailabilityEntry(BaseModel):
    pharmacy_id: str
    pharmacy_name: str
    is_available: bool
    price: float | None = None
    quantity: float | None = None


class MedicineResponse(BaseModel):
    id: str
    name: str
    name_ru: str | None
    name_uz: str | None
    description: str | None
    category: str | None
    manufacturer: str | None = None
    requires_prescription: bool
    availability: list[AvailabilityEntry] = []

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    results: list[MedicineResponse]
    total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _medicine_to_response(med) -> MedicineResponse:
    avail_entries = []
    for a in (med.availability or []):
        pharmacy = a.pharmacy
        avail_entries.append(AvailabilityEntry(
            pharmacy_id=str(a.pharmacy_id),
            pharmacy_name=pharmacy.name if pharmacy else "Unknown",
            is_available=a.is_available,
            price=float(a.price) if a.price is not None else None,
            quantity=float(a.quantity) if a.quantity is not None else None,
        ))
    return MedicineResponse(
        id=str(med.id),
        name=med.name,
        name_ru=med.name_ru,
        name_uz=med.name_uz,
        description=med.description,
        category=med.category,
        manufacturer=med.manufacturer,
        requires_prescription=med.requires_prescription,
        availability=avail_entries,
    )


# ---------------------------------------------------------------------------
# GET /medicines/search
# ---------------------------------------------------------------------------


@router.get(
    "/search",
    response_model=SearchResponse,
    summary="Search medicines by name across all languages",
)
async def search_medicines(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    pharmacy_id: uuid.UUID | None = Query(None, description="Filter by pharmacy"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> SearchResponse:
    """Search medicines by name (English, Russian, Uzbek)."""
    medicines, total = await medicine_service.search(
        db, query=q, pharmacy_id=pharmacy_id, limit=limit, offset=offset
    )
    return SearchResponse(
        results=[_medicine_to_response(m) for m in medicines],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /medicines/popular
# ---------------------------------------------------------------------------


@router.get(
    "/popular",
    response_model=list[MedicineResponse],
    summary="Top medicines by stock quantity",
)
async def popular_medicines(
    pharmacy_id: uuid.UUID | None = Query(None, description="Filter by pharmacy"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[MedicineResponse]:
    """Return the most-stocked (popular) medicines."""
    medicines = await medicine_service.popular(
        db, pharmacy_id=pharmacy_id, limit=limit
    )
    return [_medicine_to_response(m) for m in medicines]
