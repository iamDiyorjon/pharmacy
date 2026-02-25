"""
T023 - MinIO / S3 storage service.

Uses boto3 with the S3-compatible MinIO API.  All configuration is read from
:mod:`app.config`.

Public API
----------
upload_file(file_data, file_key, content_type)  -> None
get_presigned_url(file_key, expires_in=3600)    -> str
delete_file(file_key)                           -> None
ensure_bucket()                                 -> None

A module-level singleton ``storage`` is exported for convenient import::

    from app.services.storage_service import storage
    await storage.upload_file(data, "path/file.jpg", "image/jpeg")

All methods are synchronous boto3 calls wrapped in
:func:`asyncio.get_event_loop().run_in_executor` so they do not block the
FastAPI event loop.
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings

logger = logging.getLogger(__name__)


class StorageService:
    """Async-friendly wrapper around a boto3 S3 client targeting MinIO."""

    def __init__(self) -> None:
        scheme = "https" if settings.minio_use_ssl else "http"
        endpoint_url = f"{scheme}://{settings.minio_endpoint}"

        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(
                signature_version="s3v4",
                # Disable SSL cert verification in local dev when using HTTP
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
            region_name="us-east-1",  # MinIO ignores region but boto3 requires it
        )
        self._bucket = settings.minio_bucket

    # ------------------------------------------------------------------
    # Internal helper: run a blocking boto3 call in the default executor
    # ------------------------------------------------------------------

    async def _run(self, func, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(func, *args, **kwargs))

    # ------------------------------------------------------------------
    # Bucket management
    # ------------------------------------------------------------------

    async def ensure_bucket(self) -> None:
        """Create the configured bucket if it does not already exist.

        Safe to call multiple times (idempotent).

        Raises:
            ClientError: For unexpected S3 / MinIO errors other than
                ``BucketAlreadyOwnedByYou`` / ``BucketAlreadyExists``.
        """
        try:
            await self._run(self._client.head_bucket, Bucket=self._bucket)
            logger.debug("Bucket '%s' already exists.", self._bucket)
        except ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            if error_code in ("404", "NoSuchBucket"):
                try:
                    await self._run(
                        self._client.create_bucket, Bucket=self._bucket
                    )
                    logger.info("Created bucket '%s'.", self._bucket)
                except ClientError as create_exc:
                    code = create_exc.response["Error"]["Code"]
                    if code in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                        logger.debug("Bucket '%s' already owned.", self._bucket)
                    else:
                        logger.exception("Failed to create bucket '%s'.", self._bucket)
                        raise
            else:
                logger.exception(
                    "Unexpected error checking bucket '%s': %s", self._bucket, exc
                )
                raise

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def upload_file(
        self,
        file_data: bytes,
        file_key: str,
        content_type: str,
        *,
        extra_metadata: dict[str, str] | None = None,
    ) -> None:
        """Upload binary data to the configured bucket.

        Args:
            file_data: Raw bytes to upload.
            file_key: The S3 object key (e.g. ``"prescriptions/uuid.jpg"``).
            content_type: MIME type (e.g. ``"image/jpeg"``).
            extra_metadata: Optional dict of custom S3 object metadata.

        Raises:
            ClientError: If the upload fails.
        """
        put_kwargs: dict[str, Any] = {
            "Bucket": self._bucket,
            "Key": file_key,
            "Body": file_data,
            "ContentType": content_type,
        }
        if extra_metadata:
            put_kwargs["Metadata"] = extra_metadata

        try:
            await self._run(self._client.put_object, **put_kwargs)
            logger.info(
                "Uploaded file key='%s' content_type='%s' size=%d bytes",
                file_key,
                content_type,
                len(file_data),
            )
        except (ClientError, BotoCoreError):
            logger.exception("Failed to upload file key='%s'", file_key)
            raise

    # ------------------------------------------------------------------
    # Presigned URL
    # ------------------------------------------------------------------

    async def get_presigned_url(
        self, file_key: str, expires_in: int = 3600
    ) -> str:
        """Generate a presigned GET URL for a stored object.

        Args:
            file_key: The S3 object key.
            expires_in: URL validity in seconds (default 1 hour).

        Returns:
            A time-limited URL string.

        Raises:
            ClientError: If URL generation fails (e.g. object does not exist).
        """
        try:
            url: str = await self._run(
                self._client.generate_presigned_url,
                "get_object",
                Params={"Bucket": self._bucket, "Key": file_key},
                ExpiresIn=expires_in,
            )
            logger.debug(
                "Generated presigned URL for key='%s' expires_in=%ds", file_key, expires_in
            )
            return url
        except (ClientError, BotoCoreError):
            logger.exception("Failed to generate presigned URL for key='%s'", file_key)
            raise

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    async def download_file(self, file_key: str) -> bytes:
        """Download an object's bytes from the bucket.

        Args:
            file_key: The S3 object key.

        Returns:
            The raw bytes of the object.

        Raises:
            ClientError: If the download fails.
        """
        try:
            response = await self._run(
                self._client.get_object,
                Bucket=self._bucket,
                Key=file_key,
            )
            data: bytes = response["Body"].read()
            logger.debug("Downloaded file key='%s' size=%d bytes", file_key, len(data))
            return data
        except (ClientError, BotoCoreError):
            logger.exception("Failed to download file key='%s'", file_key)
            raise

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_file(self, file_key: str) -> None:
        """Delete an object from the bucket.

        This is idempotent: deleting a non-existent key does not raise.

        Args:
            file_key: The S3 object key to delete.

        Raises:
            ClientError: For unexpected errors (not 404).
        """
        try:
            await self._run(
                self._client.delete_object,
                Bucket=self._bucket,
                Key=file_key,
            )
            logger.info("Deleted file key='%s'", file_key)
        except (ClientError, BotoCoreError):
            logger.exception("Failed to delete file key='%s'", file_key)
            raise

    # ------------------------------------------------------------------
    # Existence check
    # ------------------------------------------------------------------

    async def file_exists(self, file_key: str) -> bool:
        """Check whether an object exists in the bucket.

        Args:
            file_key: The S3 object key.

        Returns:
            ``True`` if the object exists, ``False`` otherwise.
        """
        try:
            await self._run(
                self._client.head_object,
                Bucket=self._bucket,
                Key=file_key,
            )
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            logger.exception("Unexpected error checking existence of key='%s'", file_key)
            raise


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

storage = StorageService()
