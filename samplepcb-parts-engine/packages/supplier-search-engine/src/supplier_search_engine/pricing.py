from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from .models import PriceBreak


_DECIMAL_VALUE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)")


def positive_price(value: Any) -> Decimal | None:
    """Parse one price defensively; invalid and non-positive values are unavailable."""

    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, dict):
        for nested in value.values():
            parsed = positive_price(nested)
            if parsed is not None:
                return parsed
        return None
    if isinstance(value, (int, float, Decimal)):
        text = str(value)
    else:
        raw_text = str(value).replace(",", "")
        if raw_text.strip().startswith("(") and raw_text.strip().endswith(")"):
            return None
        if re.search(r"-\s*[^0-9.]*\d", raw_text):
            return None
        match = _DECIMAL_VALUE.search(raw_text)
        if match is None:
            return None
        text = match.group()
    try:
        parsed = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    if not parsed.is_finite() or parsed <= 0:
        return None
    return parsed


def valid_price_break(
    quantity: Any,
    unit_price: Any,
    currency: Any,
) -> PriceBreak | None:
    """Return only a complete positive price tier without failing its supplier response."""

    try:
        parsed_quantity = int(str(quantity).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    parsed_price = positive_price(unit_price)
    parsed_currency = str(currency or "").strip().upper()
    if parsed_quantity < 1 or parsed_price is None or not parsed_currency:
        return None
    return PriceBreak(
        quantity=parsed_quantity,
        unit_price=float(parsed_price),
        currency=parsed_currency,
    )
