"""Prescription service for upload and retrieval of prescription images."""

import uuid as uuid_mod
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prescription import Prescription
from app.services.storage_service import storage


ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
}


class PrescriptionService:
    """Service layer for prescription image uploads and downloads."""

    async def upload(
        self,
        db: AsyncSession,
        order_id: UUID,
        file_data: bytes,
        file_name: str,
        file_size: int,
        mime_type: str,
    ) -> Prescription:
        """Validate file type and size, upload to MinIO, create Prescription record.

        Validates:
        - mime_type must be image/jpeg or image/png
        - file_size must not exceed 10 MB

        Generates file_key as prescriptions/{order_id}/{uuid}.{ext}
        """
        # Validate mime type
        if mime_type not in ALLOWED_MIME_TYPES:
            raise ValueError(
                f"Invalid file type '{mime_type}'. "
                f"Only JPEG and PNG images are allowed."
            )

        # Validate file size
        if file_size > MAX_FILE_SIZE:
            raise ValueError(
                f"File size {file_size} bytes exceeds the maximum allowed size of "
                f"{MAX_FILE_SIZE} bytes (10 MB)."
            )

        # Generate storage key
        ext = MIME_TO_EXT[mime_type]
        unique_id = uuid_mod.uuid4()
        file_key = f"prescriptions/{order_id}/{unique_id}.{ext}"

        # Upload to MinIO via storage service
        await storage.upload_file(
            file_data=file_data,
            file_key=file_key,
            content_type=mime_type,
        )

        # Create database record
        prescription = Prescription(
            order_id=order_id,
            file_key=file_key,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
        )
        db.add(prescription)
        await db.commit()
        await db.refresh(prescription)
        return prescription

    async def get_download_url(
        self,
        db: AsyncSession,
        prescription_id: UUID,
    ) -> str:
        """Get a presigned download URL for a prescription image."""
        stmt = select(Prescription).where(Prescription.id == prescription_id)
        result = await db.execute(stmt)
        prescription = result.scalar_one_or_none()

        if prescription is None:
            raise ValueError("Prescription not found")

        url = await storage.get_presigned_url(file_key=prescription.file_key)
        return url

    async def get_file_data(
        self,
        db: AsyncSession,
        prescription_id: UUID,
    ) -> tuple[bytes, str, str]:
        """Download prescription file bytes from storage.

        Returns:
            Tuple of (file_data, mime_type, file_name).
        """
        stmt = select(Prescription).where(Prescription.id == prescription_id)
        result = await db.execute(stmt)
        prescription = result.scalar_one_or_none()

        if prescription is None:
            raise ValueError("Prescription not found")

        data = await storage.download_file(file_key=prescription.file_key)
        return data, prescription.mime_type, prescription.file_name


prescription_service = PrescriptionService()
