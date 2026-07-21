from __future__ import annotations

from collections.abc import Iterable

from .models import PlannedQuery, Requirement
from .normalization import normalize_package


_SPEC_ORDER = {
    "resistor": ("resistance_ohm", "power_w", "tolerance_percent", "package"),
    "capacitor": (
        "capacitance_f",
        "voltage_v",
        "tolerance_percent",
        "dielectric",
        "package",
    ),
    "inductor": ("inductance_h", "current_a", "tolerance_percent", "package"),
    "crystal": ("frequency_hz", "tolerance_percent", "package"),
}
_CORE_SPEC = {
    "resistor": "resistance_ohm",
    "capacitor": "capacitance_f",
    "inductor": "inductance_h",
    "crystal": "frequency_hz",
}


def _number(value: float) -> str:
    return f"{value:g}"


def _scaled(value: float, scales: Iterable[tuple[float, str]]) -> str:
    magnitude = abs(value)
    for factor, suffix in scales:
        if magnitude >= factor:
            return f"{_number(value / factor)}{suffix}"
    factor, suffix = tuple(scales)[-1]
    return f"{_number(value / factor)}{suffix}"


def _requirement_token(
    name: str,
    requirement: Requirement,
    component_type: str | None = None,
) -> str | None:
    value = requirement.normalized_value
    if name == "package":
        return normalize_package(value or requirement.raw_value, component_type) or None
    if name == "dielectric":
        return str(value or requirement.raw_value).strip().upper() or None
    if not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if name == "resistance_ohm":
        if numeric == 0:
            return "0 ohm"
        return _scaled(numeric, ((1e9, "G"), (1e6, "M"), (1e3, "k"), (1, " ohm")))
    if name == "capacitance_f":
        return _scaled(numeric, ((1, "F"), (1e-3, "mF"), (1e-6, "uF"), (1e-9, "nF"), (1e-12, "pF")))
    if name == "inductance_h":
        return _scaled(numeric, ((1, "H"), (1e-3, "mH"), (1e-6, "uH"), (1e-9, "nH"), (1e-12, "pH")))
    if name == "power_w":
        return f"{_number(numeric)}W"
    if name == "tolerance_percent":
        return f"{_number(numeric)}%"
    if name == "voltage_v":
        return f"{_number(numeric)}V"
    if name == "current_a":
        return _scaled(numeric, ((1, "A"), (1e-3, "mA"), (1e-6, "uA")))
    if name == "frequency_hz":
        return _scaled(numeric, ((1e9, "GHz"), (1e6, "MHz"), (1e3, "kHz"), (1, "Hz")))
    return None


def _tokens(query: PlannedQuery, names: Iterable[str]) -> list[str]:
    tokens: list[str] = []
    for name in names:
        requirement = query.requirements.get(name)
        if requirement is None or not requirement.hard:
            continue
        token = _requirement_token(name, requirement, query.part_type)
        if token:
            tokens.append(token)
    return list(dict.fromkeys(tokens))


def supplier_spec_keywords(query: PlannedQuery) -> str:
    """Build a precise first-pass query while local matching stays authoritative."""

    part_type = (query.part_type or "").casefold()
    names = _SPEC_ORDER.get(part_type, tuple(query.requirements))
    tokens = _tokens(query, names)
    return " ".join(tokens)[:250] or query.keywords

def supplier_core_keywords(query: PlannedQuery) -> str:
    """Return the broad second-rung query: primary electrical value + package."""

    part_type = (query.part_type or "").casefold()
    primary = _CORE_SPEC.get(part_type)
    names = tuple(name for name in (primary, "package") if name)
    tokens = _tokens(query, names)
    return " ".join(tokens)[:250] or query.keywords
