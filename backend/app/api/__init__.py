"""
API package - aggregates all routers into a single top-level router that is
mounted at /api/v1 in main.py.
"""

from fastapi import APIRouter

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.pharmacies import router as pharmacies_router
from app.api.medicines import router as medicines_router
from app.api.orders import router as orders_router
from app.api.staff import router as staff_router
from app.api.prescriptions import router as prescriptions_router
from app.api.payments import router as payments_router

router = APIRouter()

router.include_router(admin_router)
router.include_router(auth_router)
router.include_router(pharmacies_router)
router.include_router(medicines_router)
router.include_router(orders_router)
router.include_router(staff_router)
router.include_router(prescriptions_router)
router.include_router(payments_router)
