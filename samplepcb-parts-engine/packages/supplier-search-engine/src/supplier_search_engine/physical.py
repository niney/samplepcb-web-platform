from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

from .models import SupplierProduct


MountStyle = Literal["smd", "through-hole"]


@dataclass(frozen=True, order=True)
class MountStyleEvidence:
    value: MountStyle
    source: str


@dataclass(frozen=True, order=True)
class DiameterEvidence:
    value_mm: float
    source: str


_CYLINDRICAL_CONTEXT = re.compile(
    r"electrolytic|radial|cylindrical|(?:^|\W)can(?:\W|$)|"
    r"전해|방사형|원통|캔\s*(?:형|타입)",
    re.I,
)
_DIMENSION = re.compile(
    r"(?:^|[^0-9])(\d{1,2}(?:\.\d+)?)\s*(?:mm\s*)?[x×]\s*"
    r"\d{1,3}(?:\.\d+)?(?:\s*mm|[^0-9]|$)",
    re.I,
)
_EXPLICIT_DIAMETER_PATTERNS = (
    re.compile(r"(?:ø|Ø|φ|Φ)\s*(\d+(?:\.\d+)?)", re.I),
    re.compile(r"(\d+(?:\.\d+)?)\s*(?:파이|ø|Ø|φ|Φ)", re.I),
    re.compile(r"(?:dia(?:meter)?|직경|지름)\D{0,8}(\d+(?:\.\d+)?)\s*mm", re.I),
    re.compile(r"(\d+(?:\.\d+)?)\s*mm\D{0,8}(?:dia(?:meter)?|직경|지름)", re.I),
)
_MOUNT_ATTRIBUTE_KEY = re.compile(
    r"mount(?:ing)?[\s_/-]*(?:type|style)|실장\s*(?:유형|방식)|장착\s*(?:유형|방식)",
    re.I,
)
_DIAMETER_SPEC_KEY = re.compile(
    r"(?:^|_)(?:case_|body_)?diameter(?:_mm)?$",
    re.I,
)
_DIMENSION_ATTRIBUTE_KEY = re.compile(
    r"크기\s*/\s*치수|diameter|dimensions?|size",
    re.I,
)


def _positive_number(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def detect_mount_styles(value: object) -> tuple[MountStyle, ...]:
    text = str(value or "").casefold().replace("_", " ")
    styles: set[MountStyle] = set()
    has_smd = bool(
        re.search(r"(?:^|[^a-z])(smd|smt)(?:[^a-z]|$)", text)
        or re.search(r"surface[ -]?mount", text)
        or re.search(r"표면\s*실장", text)
        or re.search(r"칩\s*(?:전해|저항|커패시터|콘덴서)", text)
    )
    has_through_hole = bool(
        re.search(r"(?:^|[^a-z])tht(?:[^a-z]|$)", text)
        or re.search(r"through[ -]?hole", text)
        or re.search(r"스루\s*홀|삽입형|리드형", text)
    )
    if has_smd:
        styles.add("smd")
    if has_through_hole:
        styles.add("through-hole")
    # "Radial, Can - SMD" describes an SMD can, not a THT part.
    if not has_smd and re.search(r"방사형\s*,?\s*캔|radial\s*,?\s*can", text):
        styles.add("through-hole")
    return tuple(sorted(styles))


def detect_mount_style(value: object) -> MountStyle | None:
    styles = detect_mount_styles(value)
    return styles[0] if len(styles) == 1 else None


def _explicit_diameters_mm(value: object) -> tuple[float, ...]:
    text = str(value or "")
    values = {
        parsed
        for pattern in _EXPLICIT_DIAMETER_PATTERNS
        for match in pattern.finditer(text)
        if (parsed := _positive_number(float(match.group(1)))) is not None
    }
    return tuple(sorted(values))


def source_diameters_mm(value: object) -> tuple[float, ...]:
    text = str(value or "")
    explicit = _explicit_diameters_mm(text)
    if explicit:
        return explicit
    if not _CYLINDRICAL_CONTEXT.search(text):
        return ()
    values = {
        parsed
        for match in _DIMENSION.finditer(text)
        if (parsed := _positive_number(float(match.group(1)))) is not None
    }
    return tuple(sorted(values))


def source_diameter_mm(value: object) -> float | None:
    values = source_diameters_mm(value)
    return values[0] if len(values) == 1 else None


def product_mount_evidence(product: SupplierProduct) -> tuple[MountStyleEvidence, ...]:
    sources: list[tuple[str, object]] = []
    sources.extend(
        (f"normalized_specs.{key}", value)
        for key, value in product.normalized_specs.items()
        if _MOUNT_ATTRIBUTE_KEY.search(str(key))
    )
    sources.extend(
        (f"attributes.{key}", value)
        for key, value in product.attributes.items()
        if _MOUNT_ATTRIBUTE_KEY.search(str(key))
    )
    sources.extend(
        (
            ("normalized_specs.package", product.normalized_specs.get("package")),
            ("package", product.package),
            ("description", product.description),
            ("category", product.category),
        )
    )
    return tuple(
        sorted(
            {
                MountStyleEvidence(style, source)
                for source, value in sources
                for style in detect_mount_styles(value)
            }
        )
    )


def product_mount_style(product: SupplierProduct) -> MountStyle | None:
    values = {item.value for item in product_mount_evidence(product)}
    return next(iter(values)) if len(values) == 1 else None

def _structured_diameter_values(value: object, source: str) -> set[DiameterEvidence]:
    raw_values = value if isinstance(value, list) else [value]
    evidence: set[DiameterEvidence] = set()
    for raw_value in raw_values:
        numeric = _positive_number(raw_value)
        if numeric is not None:
            evidence.add(DiameterEvidence(numeric, source))
            continue
        evidence.update(
            DiameterEvidence(parsed, source)
            for parsed in _explicit_diameters_mm(f"diameter {raw_value} mm")
        )
    return evidence


def product_diameter_evidence(product: SupplierProduct) -> tuple[DiameterEvidence, ...]:
    evidence: set[DiameterEvidence] = set()
    for key, value in product.normalized_specs.items():
        if _DIAMETER_SPEC_KEY.search(str(key)):
            evidence.update(
                _structured_diameter_values(value, f"normalized_specs.{key}")
            )

    attribute_values: list[tuple[str, str]] = []
    for key, value in product.attributes.items():
        if not _DIMENSION_ATTRIBUTE_KEY.search(str(key)):
            continue
        source = f"attributes.{key}"
        text = str(value or "")
        attribute_values.append((source, text))
        if re.search(r"diameter|직경|지름", str(key), re.I):
            evidence.update(_structured_diameter_values(value, source))
        evidence.update(
            DiameterEvidence(parsed, source)
            for parsed in _explicit_diameters_mm(f"{key}: {text}")
        )

    context = " ".join(
        str(value)
        for value in (
            product.category,
            product.description,
            product.package,
            *(value for _, value in attribute_values),
        )
        if value
    )
    text_sources = [
        *attribute_values,
        ("package", product.package or ""),
        ("description", product.description or ""),
    ]
    for source, text in text_sources:
        explicit = _explicit_diameters_mm(text)
        evidence.update(DiameterEvidence(parsed, source) for parsed in explicit)
        if not explicit and _CYLINDRICAL_CONTEXT.search(context):
            evidence.update(
                DiameterEvidence(parsed, source)
                for match in _DIMENSION.finditer(text)
                if (parsed := _positive_number(float(match.group(1)))) is not None
            )
    return tuple(sorted(evidence))


def product_diameter_mm(product: SupplierProduct) -> float | None:
    values = {item.value_mm for item in product_diameter_evidence(product)}
    return next(iter(values)) if len(values) == 1 else None
