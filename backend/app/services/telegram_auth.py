"""
T017 - Telegram Mini App initData HMAC-SHA256 validation.

Implements the official Telegram Web App data verification algorithm:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import urllib.parse
from typing import Any

logger = logging.getLogger(__name__)


def validate_init_data(init_data: str, bot_token: str) -> dict[str, Any] | None:
    """Validate Telegram Mini App initData and return parsed user payload.

    The algorithm:
    1. Parse the query string and extract the ``hash`` field.
    2. Build the data-check string by sorting the remaining key=value pairs
       alphabetically by key and joining them with ``\\n``.
    3. Derive a secret key: HMAC-SHA256(bot_token, key="WebAppData").
    4. Compute HMAC-SHA256(data_check_string, key=secret_key).
    5. Compare the hex digest with the extracted ``hash`` (constant-time).

    Args:
        init_data: Raw ``initData`` query string received from Telegram Web App.
        bot_token: The Telegram bot token used to derive the secret key.

    Returns:
        A dict containing all parsed initData fields (including a nested ``user``
        dict when present) if validation succeeds, or ``None`` if the signature
        is invalid or required fields are missing.
    """
    if not init_data or not bot_token:
        logger.warning("validate_init_data called with empty init_data or bot_token")
        return None

    try:
        params = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        logger.exception("Failed to parse init_data query string")
        return None

    received_hash = params.pop("hash", None)
    if not received_hash:
        logger.warning("initData missing 'hash' field")
        return None

    # Build the data-check string: sorted key=value pairs joined by \n
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )

    # Secret key = HMAC-SHA256(bot_token, b"WebAppData")
    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode(),
        digestmod=hashlib.sha256,
    ).digest()

    # Expected signature
    expected_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        logger.warning("initData signature mismatch")
        return None

    # Decode JSON-encoded nested fields (user, receiver, chat)
    result: dict[str, Any] = {}
    json_fields = {"user", "receiver", "chat"}
    for key, value in params.items():
        if key in json_fields:
            try:
                result[key] = json.loads(value)
            except json.JSONDecodeError:
                logger.warning("Could not JSON-decode initData field '%s'", key)
                result[key] = value
        else:
            result[key] = value

    # Also carry the hash back so callers can log it if needed
    result["hash"] = received_hash
    return result
