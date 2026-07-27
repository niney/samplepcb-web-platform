from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping
from typing import Any


_FFC_FPC = re.compile(
    r"\b(?:ffc|fpc)\b|flat\s+(?:flexible|flex)\s+(?:cable|connector)",
    re.I,
)
_TERMINAL_BLOCK = re.compile(
    r"\bterminal\s+blocks?\b|\beuroblocks?\b|pluggable\s+terminal|"
    r"터미널\s*(?:블록|단자)|단자대",
    re.I,
)
_D_SUB = re.compile(r"\bd[\s-]?sub(?:miniature)?\b", re.I)
_USB = re.compile(r"\busb(?:\s+type)?[\s-]?[abc]?\b", re.I)
_POWER = re.compile(
    r"\b(?:dc|ac)\s+power\s+(?:jack|connector)\b|"
    r"\bbarrel\s+(?:jack|connector)\b",
    re.I,
)
_CARD_EDGE = re.compile(r"\bcard[\s-]+edge\b", re.I)
_BOARD_TO_BOARD = re.compile(r"\bboard[\s-]+to[\s-]+board\b|\bmezzanine\b", re.I)
_SOCKET_HEADER = re.compile(
    r"\b(?:socket|female|receptacle)\s+(?:pin\s+)?headers?\b|"
    r"\bheaders?\s+(?:socket|female|receptacle)\b",
    re.I,
)
_PIN_HEADER = re.compile(
    r"\bpin[\s-]*headers?\b|"
    r"\bhdr\s+pin\b|"
    r"\bmale\s+(?:pin\s+)?headers?\b|"
    r"\bheaders?\s+strips?\b",
    re.I,
)
_HEADER_WITH_PIN_EVIDENCE = re.compile(r"\bheaders?\b", re.I)
_MALE_PIN = re.compile(r"\bmale\s+pins?\b|\b\d{1,3}\s*[- ]?pins?\b", re.I)
_HEADER_GEOMETRY = re.compile(
    r"\b\d{1,2}\s*[x×]\s*\d{1,3}\b|"
    r"\b\d{1,3}\s*(?:positions?|pos)\b|"
    r"\b(?:sr|dr)\b.*\b(?:th|tht|smd|smt|vt|vertical|horizontal)\b",
    re.I,
)

CONNECTOR_FAMILY_LABELS = {
    "pin_header": "Pin header",
    "socket_header": "Socket header",
    "ffc_fpc": "FFC/FPC",
    "terminal_block": "Terminal block",
    "d_sub": "D-Sub",
    "usb": "USB",
    "power": "Power connector",
    "card_edge": "Card edge",
    "board_to_board": "Board-to-board",
}


def connector_family_from_text(value: object) -> str | None:
    """Infer only connector families supported by explicit textual evidence."""

    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    for family, pattern in (
        ("ffc_fpc", _FFC_FPC),
        ("terminal_block", _TERMINAL_BLOCK),
        ("d_sub", _D_SUB),
        ("usb", _USB),
        ("power", _POWER),
        ("card_edge", _CARD_EDGE),
        ("socket_header", _SOCKET_HEADER),
    ):
        if pattern.search(text):
            return family
    if _PIN_HEADER.search(text) or (
        _HEADER_WITH_PIN_EVIDENCE.search(text)
        and (_MALE_PIN.search(text) or _HEADER_GEOMETRY.search(text))
    ):
        return "pin_header"
    if _BOARD_TO_BOARD.search(text):
        return "board_to_board"
    return None


def connector_family_from_attributes(
    attributes: Mapping[str, Any],
) -> str | None:
    """Prefer structured connector/contact attributes over description wording."""

    connector_type: list[str] = []
    contact_type: list[str] = []
    for name, value in attributes.items():
        key = re.sub(
            r"[^a-z0-9가-힣]+",
            "",
            unicodedata.normalize("NFKC", str(name)).casefold(),
        )
        text = unicodedata.normalize("NFKC", str(value or ""))
        if "connectortype" in key or "커넥터유형" in key:
            connector_type.append(text)
        if "contacttype" in key or "접점유형" in key:
            contact_type.append(text)

    type_text = " ".join(connector_type)
    contact_text = " ".join(contact_type)
    if re.search(r"\bheaders?\b", type_text, re.I):
        if re.search(r"\bmale\s+pins?\b", contact_text, re.I):
            return "pin_header"
        if re.search(r"\b(?:female|socket|receptacle)\b", contact_text, re.I):
            return "socket_header"

    combined = " ".join(f"{name} {value}" for name, value in attributes.items())
    return connector_family_from_text(combined)


def pin_header_search_keywords(
    *,
    pin_count: object,
    row_count: object,
    pitch_mm: object,
    mount_style: object = None,
) -> str:
    """Build the supplier-probed pin-header keyword shape.

    DigiKey and Mouser both treated ``2.54mm 1xN pin header`` more precisely
    than prose such as ``N pin 1 row 2.54mm pitch connector``. Row count stays
    encoded in the compact array token rather than being repeated as free text.
    """

    pins = _positive_int(pin_count)
    rows = _positive_int(row_count)
    pitch = _positive_float(pitch_mm)
    parts: list[str] = []
    if pitch is not None:
        parts.append(f"{pitch:g}mm")
    if pins is not None and rows is not None and pins % rows == 0:
        parts.append(f"{rows}x{pins // rows}")
    elif pins is not None:
        parts.extend((str(pins), "position"))
    parts.extend(("pin", "header"))
    if mount_style == "through-hole":
        parts.extend(("through", "hole"))
    elif mount_style == "smd":
        parts.extend(("surface", "mount"))
    return " ".join(parts)


def _positive_int(value: object) -> int | None:
    if not isinstance(value, (int, float)):
        return None
    parsed = int(value)
    return parsed if parsed > 0 and math.isclose(float(value), parsed) else None


def _positive_float(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) and parsed > 0 else None
