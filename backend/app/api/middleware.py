"""
T085/T086 - Global error handling middleware and structured logging.

Uses a pure ASGI middleware instead of BaseHTTPMiddleware to avoid
breaking SQLAlchemy's async greenlet context.
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, NoResultFound
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware:
    """Pure ASGI middleware — adds correlation ID and logs request/response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())[:8]
        start = time.monotonic()

        # Store request_id in scope state so exception handlers can read it
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        request = Request(scope)
        logger.info("[%s] %s %s", request_id, request.method, request.url.path)

        status_code: int | None = None

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)

        elapsed_ms = (time.monotonic() - start) * 1000
        logger.info(
            "[%s] %s %s → %s (%.1fms)",
            request_id,
            request.method,
            request.url.path,
            status_code or "?",
            elapsed_ms,
        )


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
