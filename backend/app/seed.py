"""
T032 / T087 - Seed script for pharmacies and sample medicines.

Usage:
    python -m app.seed
"""

import asyncio
import logging
from datetime import time

from sqlalchemy import select

from passlib.context import CryptContext
from sqlalchemy import select

from app.db.session import async_session
from app.models.medicine import Medicine, MedicineAvailability
from app.models.order import Order, OrderItem  # noqa: F401
from app.models.pharmacy import Pharmacy
from app.models.prescription import Prescription  # noqa: F401
from app.models.staff import PharmacyStaff
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PHARMACIES = [
    {
        "name": "ADIKA SHIFO-NUR MCHJ",
        "address": "Toshkent vil. Bekobod sh. 11-daxa 14A-uy",
        "phone": "+998 91 502-21-23",
        "latitude": 41.2995,
        "longitude": 69.2401,
        "opens_at": time(8, 0),
        "closes_at": time(22, 0),
        "is_active": True,
    },
     {
        "name": "TOJINISO ONA FARM MCHJ",
        "address": "Toshkent vil., Bekobod sh. Turon berk ko'chasi, 1-uy(do'kon)",
        "phone": "+998 90 001-87-77",
        "latitude": 41.2995,
        "longitude": 69.2401,
        "opens_at": time(8, 0),
        "closes_at": time(22, 0),
        "is_active": True,
    }
]

MEDICINES = [
    {"name": "Paracetamol 500mg", "name_ru": "Парацетамол 500мг", "name_uz": "Paratsetamol 500mg", "category": "Pain Relief", "requires_prescription": False},
    {"name": "Ibuprofen 400mg", "name_ru": "Ибупрофен 400мг", "name_uz": "Ibuprofen 400mg", "category": "Pain Relief", "requires_prescription": False},
    {"name": "Aspirin 100mg", "name_ru": "Аспирин 100мг", "name_uz": "Aspirin 100mg", "category": "Pain Relief", "requires_prescription": False},
    {"name": "Amoxicillin 500mg", "name_ru": "Амоксициллин 500мг", "name_uz": "Amoksisillin 500mg", "category": "Antibiotics", "requires_prescription": True},
    {"name": "Azithromycin 250mg", "name_ru": "Азитромицин 250мг", "name_uz": "Azitromitsin 250mg", "category": "Antibiotics", "requires_prescription": True},
    {"name": "Ciprofloxacin 500mg", "name_ru": "Ципрофлоксацин 500мг", "name_uz": "Siprofloksatsin 500mg", "category": "Antibiotics", "requires_prescription": True},
    {"name": "Cetirizine 10mg", "name_ru": "Цетиризин 10мг", "name_uz": "Setirizin 10mg", "category": "Allergy", "requires_prescription": False},
    {"name": "Loratadine 10mg", "name_ru": "Лоратадин 10мг", "name_uz": "Loratadin 10mg", "category": "Allergy", "requires_prescription": False},
    {"name": "Omeprazole 20mg", "name_ru": "Омепразол 20мг", "name_uz": "Omeprazol 20mg", "category": "Digestive", "requires_prescription": False},
    {"name": "Ranitidine 150mg", "name_ru": "Ранитидин 150мг", "name_uz": "Ranitidin 150mg", "category": "Digestive", "requires_prescription": False},
    {"name": "Metformin 500mg", "name_ru": "Метформин 500мг", "name_uz": "Metformin 500mg", "category": "Diabetes", "requires_prescription": True},
    {"name": "Atorvastatin 20mg", "name_ru": "Аторвастатин 20мг", "name_uz": "Atorvastatin 20mg", "category": "Cardiovascular", "requires_prescription": True},
    {"name": "Amlodipine 5mg", "name_ru": "Амлодипин 5мг", "name_uz": "Amlodipin 5mg", "category": "Cardiovascular", "requires_prescription": True},
    {"name": "Lisinopril 10mg", "name_ru": "Лизиноприл 10мг", "name_uz": "Lizinopril 10mg", "category": "Cardiovascular", "requires_prescription": True},
    {"name": "Salbutamol Inhaler", "name_ru": "Сальбутамол ингалятор", "name_uz": "Salbutamol ingalyator", "category": "Respiratory", "requires_prescription": True},
    {"name": "Dexamethasone 4mg", "name_ru": "Дексаметазон 4мг", "name_uz": "Deksametazon 4mg", "category": "Anti-inflammatory", "requires_prescription": True},
    {"name": "Vitamin C 500mg", "name_ru": "Витамин С 500мг", "name_uz": "Vitamin C 500mg", "category": "Vitamins", "requires_prescription": False},
    {"name": "Vitamin D3 1000IU", "name_ru": "Витамин Д3 1000МЕ", "name_uz": "Vitamin D3 1000IU", "category": "Vitamins", "requires_prescription": False},
    {"name": "Iron Supplement 325mg", "name_ru": "Железо 325мг", "name_uz": "Temir 325mg", "category": "Vitamins", "requires_prescription": False},
    {"name": "Activated Charcoal", "name_ru": "Активированный уголь", "name_uz": "Faollashtirilgan ko'mir", "category": "Digestive", "requires_prescription": False},
    {"name": "No-Spa (Drotaverine) 40mg", "name_ru": "Но-Шпа (Дротаверин) 40мг", "name_uz": "No-Shpa (Drotaverin) 40mg", "category": "Pain Relief", "requires_prescription": False},
    {"name": "Nurofen 200mg", "name_ru": "Нурофен 200мг", "name_uz": "Nurofen 200mg", "category": "Pain Relief", "requires_prescription": False},
    {"name": "Smecta", "name_ru": "Смекта", "name_uz": "Smekta", "category": "Digestive", "requires_prescription": False},
    {"name": "Mezim Forte", "name_ru": "Мезим Форте", "name_uz": "Mezim Forte", "category": "Digestive", "requires_prescription": False},
    {"name": "Furazolidone 50mg", "name_ru": "Фуразолидон 50мг", "name_uz": "Furazolidon 50mg", "category": "Antibiotics", "requires_prescription": True},
]


async def seed_pharmacies() -> list[Pharmacy]:
    """Insert seed pharmacies if they don't already exist."""
    created = []
    async with async_session() as session:
        for data in PHARMACIES:
            result = await session.execute(
                select(Pharmacy).where(
                    Pharmacy.name == data["name"],
                    Pharmacy.address == data["address"],
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                logger.info("Pharmacy '%s' at '%s' already exists, skipping", data["name"], data["address"])
                created.append(existing)
                continue

            pharmacy = Pharmacy(**data)
            session.add(pharmacy)
            created.append(pharmacy)
            logger.info("Created pharmacy: %s", data["name"])

        await session.commit()
        for p in created:
            await session.refresh(p)

    logger.info("Pharmacies: %d processed", len(PHARMACIES))
    return created


async def seed_medicines(pharmacies: list[Pharmacy]) -> None:
    """Insert sample medicines and set availability at both pharmacies."""
    async with async_session() as session:
        for data in MEDICINES:
            result = await session.execute(
                select(Medicine).where(Medicine.name == data["name"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                logger.info("Medicine '%s' already exists, skipping", data["name"])
                continue

            med = Medicine(**data)
            session.add(med)
            await session.flush()

            # Make available at all pharmacies
            for pharmacy in pharmacies:
                avail = MedicineAvailability(
                    medicine_id=med.id,
                    pharmacy_id=pharmacy.id,
                    is_available=True,
                )
                session.add(avail)

            logger.info("Created medicine: %s", data["name"])

        await session.commit()

    logger.info("Medicines: %d processed", len(MEDICINES))


# Staff accounts: one per pharmacy + superadmin
STAFF_ACCOUNTS = [
    {
        "phone": "+998915022123",
        "password": "adika2026",
        "first_name": "ADIKA Admin",
        "pharmacy_name": "ADIKA SHIFO-NUR MCHJ",
        "role": "admin",
    },
    {
        "phone": "+998900018777",
        "password": "tojiniso2026",
        "first_name": "TOJINISO Admin",
        "pharmacy_name": "TOJINISO ONA FARM MCHJ",
        "role": "admin",
    },
    {
        "phone": "+998901234567",
        "password": "superadmin2026",
        "first_name": "Super Admin",
        "pharmacy_name": "ADIKA SHIFO-NUR MCHJ",  # superadmin linked to first pharmacy
        "role": "superadmin",
    },
]


async def seed_staff(pharmacies: list[Pharmacy]) -> None:
    """Create staff user accounts with phone+password for web login."""
    pharmacy_map = {p.name: p for p in pharmacies}

    async with async_session() as session:
        for account in STAFF_ACCOUNTS:
            # Check if user with this phone already exists
            result = await session.execute(
                select(User).where(User.phone == account["phone"])
            )
            user = result.scalar_one_or_none()

            if user is None:
                user = User(
                    first_name=account["first_name"],
                    phone=account["phone"],
                    password_hash=pwd_context.hash(account["password"]),
                    language_code="uz",
                )
                session.add(user)
                await session.flush()
                logger.info("Created user: %s (%s)", account["first_name"], account["phone"])
            else:
                logger.info("User '%s' already exists, skipping", account["phone"])

            # Link to PharmacyStaff
            result = await session.execute(
                select(PharmacyStaff).where(PharmacyStaff.user_id == user.id)
            )
            staff = result.scalar_one_or_none()

            if staff is None:
                pharmacy = pharmacy_map.get(account["pharmacy_name"])
                if pharmacy:
                    staff = PharmacyStaff(
                        pharmacy_id=pharmacy.id,
                        user_id=user.id,
                        name=account["first_name"],
                        role=account["role"],
                        is_active=True,
                    )
                    session.add(staff)
                    logger.info("Created staff: %s -> %s", account["first_name"], account["pharmacy_name"])
            else:
                logger.info("Staff for '%s' already exists, skipping", account["phone"])

        await session.commit()

    logger.info("Staff accounts: %d processed", len(STAFF_ACCOUNTS))


async def main() -> None:
    logger.info("Running seed script...")
    pharmacies = await seed_pharmacies()
    await seed_medicines(pharmacies)
    await seed_staff(pharmacies)
    logger.info("Seed complete!")


if __name__ == "__main__":
    asyncio.run(main())
