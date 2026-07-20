from __future__ import annotations

import math
import re
from typing import Literal

from .models import SupplierProduct


MountStyle = Literal["smd", "through-hole"]


def detect_mount_style(value: object) -> MountStyle | None:
    text = str(value or "").casefold().replace("_", " ")
    if (
        re.search(r"(?:^|[^a-z])(smd|smt)(?:[^a-z]|$)", text)
        or re.search(r"surface[ -]?mount", text)
        or re.search(r"표면\s*실장", text)
        or re.search(r"칩\s*(?:전해|저항|커패시터|콘덴서)", text)
    ):
        return "smd"
    if (
        re.search(r"(?:^|[^a-z])tht(?:[^a-z]|$)", text)
        or re.search(r"through[ -]?hole", text)
        or re.search(r"스루\s*홀|삽입형|리드형", text)
    ):
        return "through-hole"
    # "Radial, Can - SMD" is caught by the SMD branch first.
    if re.search(r"방사형\s*,?\s*캔|radial\s*,?\s*can", text):
        return "through-hole"
    return None


def _first_positive_number(value: str, patterns: tuple[str, ...]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, value, re.I)
        if match is None:
            continue
        parsed = float(match.group(1))
        if math.isfinite(parsed) and parsed > 0:
            return parsed
    return None


def source_diameter_mm(value: object) -> float | None:
    return _first_positive_number(
        str(value or ""),
        (
            r"(?:ø|Ø|φ|Φ)\s*(\d+(?:\.\d+)?)",
            r"(\d+(?:\.\d+)?)\s*(?:파이|ø|Ø|φ|Φ)",
            r"(?:dia(?:meter)?|직경|지름)\D{0,8}(\d+(?:\.\d+)?)\s*mm",
            r"(\d+(?:\.\d+)?)\s*mm\D{0,8}(?:dia(?:meter)?|직경|지름)",
        ),
    )


def product_mount_style(product: SupplierProduct) -> MountStyle | None:
    mount_attributes = [
        value
        for key, value in product.attributes.items()
        if re.search(r"mount(?:ing)?\s*type|실장\s*유형|장착\s*유형", str(key), re.I)
        and isinstance(value, str)
    ]
    normalized_package = product.normalized_specs.get("package")
    texts = [
        *mount_attributes,
        normalized_package if isinstance(normalized_package, str) else "",
        product.package or "",
        product.description or "",
    ]
    return next(
        (style for text in texts if (style := detect_mount_style(text)) is not None),
        None,
    )


def product_diameter_mm(product: SupplierProduct) -> float | None:
    for key, value in product.normalized_specs.items():
        if not re.search(r"(?:^|_)(?:case_|body_)?diameter(?:_mm)?$", key, re.I):
            continue
        if (
            isinstance(value, (int, float))
            and math.isfinite(float(value))
            and value > 0
        ):
            return float(value)

    attribute_values = [
        value
        for key, value in product.attributes.items()
        if re.search(r"크기\s*/\s*치수|diameter|dimensions?|size", str(key), re.I)
        and isinstance(value, str)
    ]
    texts = [
        *attribute_values,
        product.package or "",
        product.description or "",
        product.manufacturer_part_number,
    ]
    explicit_patterns = (
        r"(?:dia(?:meter)?|직경|지름)\D{0,8}(\d+(?:\.\d+)?)\s*mm",
        r"(\d+(?:\.\d+)?)\s*mm\D{0,8}(?:dia(?:meter)?|직경|지름)",
        r"(?:ø|Ø|φ|Φ)\s*(\d+(?:\.\d+)?)\s*mm?",
    )
    for text in texts:
        value = _first_positive_number(text, explicit_patterns)
        if value is not None:
            return value
    dimensional_pattern = (
        r"(?:^|[^0-9])(\d{1,2}(?:\.\d+)?)\s*(?:mm\s*)?[x×]\s*"
        r"\d{1,3}(?:\.\d+)?(?:\s*mm|[^0-9]|$)"
    )
    for text in texts:
        value = _first_positive_number(text, (dimensional_pattern,))
        if value is not None:
            return value
    return None
