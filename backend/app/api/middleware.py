"""
T085/T086 - Global error handling middleware and structured logging.
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, NoResultFound
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Add correlation ID to each request and log request/response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid.uuid4())[:8]
        start = time.monotonic()

        # Attach correlation ID to request state
        request.state.request_id = request_id

        logger.info(
            "[%s] %s %s",
            request_id,
            request.method,
            request.url.path,
        )

        response = await call_next(request)

        elapsed_ms = (time.monotonic() - start) * 1000
        logger.info(
            "[%s] %s %s → %d (%.1fms)",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )

        response.headers["X-Request-ID"] = request_id
        return response


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch unhandled exceptions and return structured JSON."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("[%s] Unhandled exception: %s", request_id, exc)

    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "request_id": request_id,
        },
    )


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """Handle database integrity errors (duplicate keys, FK violations)."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.warning("[%s] IntegrityError: %s", request_id, exc.orig)

    return JSONResponse(
        status_code=409,
        content={
            "detail": "Data conflict — the record may already exist",
            "request_id": request_id,
        },
    )


async def not_found_handler(request: Request, exc: NoResultFound) -> JSONResponse:
    """Handle SQLAlchemy NoResultFound."""
    return JSONResponse(
        status_code=404,
        content={"detail": "Resource not found"},
    )


def setup_middleware(app: FastAPI) -> None:
    """Register all middleware and exception handlers."""
    app.add_middleware(RequestLoggingMiddleware)
    app.add_exception_handler(Exception, global_exception_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(NoResultFound, not_found_handler)
