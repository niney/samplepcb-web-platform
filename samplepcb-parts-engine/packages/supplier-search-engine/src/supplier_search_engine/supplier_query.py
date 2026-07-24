from __future__ import annotations

import re
from collections.abc import Iterable

from .models import PlannedQuery, Requirement, Supplier
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
    "electrolytic": (
        "capacitance_f",
        "voltage_v",
        "tolerance_percent",
        "diameter_mm",
        "package",
        "mount_style",
    ),
    "tantalum": ("capacitance_f", "voltage_v", "tolerance_percent", "package"),
    "film": ("capacitance_f", "voltage_v", "tolerance_percent", "package"),
    "inductor": ("inductance_h", "current_a", "tolerance_percent", "package"),
    "crystal": ("frequency_hz", "tolerance_percent", "package"),
    "ferrite": ("impedance_ohm", "impedance_frequency_hz", "current_a", "package"),
    "led": ("color", "package", "mount_style"),
    "connector": ("pin_count", "row_count", "pitch_mm", "mount_style"),
    "varistor": ("voltage_v", "diameter_mm", "mount_style"),
    "buzzer": ("voltage_v", "frequency_hz", "mount_style"),
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
    supplier: Supplier | None = None,
    *,
    ferrite_bead: bool = False,
) -> str | None:
    value = requirement.normalized_value
    if name == "package":
        return normalize_package(value or requirement.raw_value, component_type) or None
    if name == "dielectric":
        return str(value or requirement.raw_value).strip().upper() or None
    if name == "color":
        return str(value or requirement.raw_value).strip().casefold() or None
    if not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if name == "resistance_ohm":
        if numeric == 0:
            return "0 ohm"
        if ferrite_bead and supplier == Supplier.DIGIKEY:
            return f"{_number(numeric)} Ohms"
        if supplier is not None and abs(numeric) < 1_000:
            return f"{_number(numeric)}R"
        return _scaled(numeric, ((1e9, "G"), (1e6, "M"), (1e3, "k"), (1, " ohm")))
    if name in {"impedance_ohm", "dc_resistance_max_ohm"}:
        if ferrite_bead and supplier == Supplier.DIGIKEY:
            return f"{_number(numeric)} Ohms"
        return _scaled(numeric, ((1e9, "G"), (1e6, "M"), (1e3, "k"), (1, " ohm")))
    if name == "capacitance_f":
        if supplier == Supplier.DIGIKEY and 100e-9 <= abs(numeric) < 1e-6:
            return f"{_number(numeric / 1e-6)}uF"
        if supplier is not None and 1e-6 <= abs(numeric) <= 10e-3:
            return f"{_number(numeric / 1e-6)}uF"
        return _scaled(numeric, ((1, "F"), (1e-3, "mF"), (1e-6, "uF"), (1e-9, "nF"), (1e-12, "pF")))
    if name == "inductance_h":
        return _scaled(numeric, ((1, "H"), (1e-3, "mH"), (1e-6, "uH"), (1e-9, "nH"), (1e-12, "pH")))
    if name == "power_w":
        return f"{_number(numeric)}W"
    if name == "tolerance_percent":
        return f"{_number(numeric)}%"
    if name == "voltage_v":
        return f"{_number(numeric)}V"
    if name == "diameter_mm":
        return f"{_number(numeric)}mm"
    if name == "current_a":
        return _scaled(numeric, ((1, "A"), (1e-3, "mA"), (1e-6, "uA")))
    if name in {"frequency_hz", "impedance_frequency_hz"}:
        return _scaled(numeric, ((1e9, "GHz"), (1e6, "MHz"), (1e3, "kHz"), (1, "Hz")))
    if name == "pin_count":
        return f"{int(numeric)} pin"
    if name == "row_count":
        return "dual row" if int(numeric) == 2 else f"{int(numeric)} row"
    if name == "pitch_mm":
        return f"{_number(numeric)}mm pitch"
    return None


def is_ferrite_bead_query(query: PlannedQuery) -> bool:
    if (query.part_type or "").casefold() != "inductor":
        return False
    resistance = query.requirements.get("impedance_ohm") or query.requirements.get("resistance_ohm")
    text = " ".join(
        str(value)
        for value in (
            query.description,
            query.keywords,
            resistance.raw_value if resistance is not None else None,
        )
        if value
    )
    return bool(
        re.search(
            r"(?:\bbead\b|f\.?\s*bead|ferrite|비드|자기\s*비드)",
            text,
            re.I,
        )
    )


def _category_token(query: PlannedQuery, supplier: Supplier | None) -> str | None:
    if supplier is None:
        return None
    if is_ferrite_bead_query(query):
        return "ferrite bead"
    if query.category_policy == "electrolytic":
        return (
            "aluminum electrolytic capacitor"
            if supplier == Supplier.DIGIKEY
            else "electrolytic capacitor"
        )
    if query.category_policy == "tantalum":
        return "tantalum capacitor"
    if query.category_policy == "film":
        return "film capacitor"
    category = query.category_policy or (query.part_type or "").casefold()
    return {
        "resistor": "resistor",
        "capacitor": "capacitor",
        "inductor": "inductor",
        "crystal": "crystal",
        "led": "led",
        "connector": "connector",
        "varistor": "varistor",
        "buzzer": "buzzer",
    }.get(category)


def _tokens(
    query: PlannedQuery,
    names: Iterable[str],
    supplier: Supplier | None = None,
) -> list[str]:
    tokens: list[str] = []
    ferrite_bead = is_ferrite_bead_query(query)
    for name in names:
        requirement = query.requirements.get(name)
        if requirement is None or not requirement.hard:
            continue
        token = _requirement_token(
            name,
            requirement,
            query.part_type,
            supplier,
            ferrite_bead=ferrite_bead,
        )
        if token:
            tokens.append(token)
    category = _category_token(query, supplier)
    if category:
        tokens.append(category)
    return list(dict.fromkeys(tokens))


def supplier_spec_keywords(
    query: PlannedQuery,
    supplier: Supplier | None = None,
) -> str:
    """Build a precise first-pass query while local matching stays authoritative."""

    part_type = (query.part_type or "").casefold()
    names = (
        (
            "package",
            (
                "impedance_ohm"
                if "impedance_ohm" in query.requirements
                else "resistance_ohm"
            ),
            (
                "impedance_frequency_hz"
                if "impedance_frequency_hz" in query.requirements
                else "frequency_hz"
            ),
        )
        if is_ferrite_bead_query(query)
        else _SPEC_ORDER.get(
            query.category_policy or part_type,
            tuple(query.requirements),
        )
    )
    tokens = _tokens(query, names, supplier)
    return " ".join(tokens)[:250] or query.keywords

def supplier_core_keywords(
    query: PlannedQuery,
    supplier: Supplier | None = None,
) -> str:
    """Return the broad second-rung query: primary electrical value + package."""

    part_type = (query.part_type or "").casefold()
    if is_ferrite_bead_query(query):
        names = (
            "package",
            (
                "impedance_ohm"
                if "impedance_ohm" in query.requirements
                else "resistance_ohm"
            ),
        )
    else:
        primary = _CORE_SPEC.get(part_type)
        names = tuple(name for name in (primary, "package") if name)
    tokens = _tokens(query, names, supplier)
    return " ".join(tokens)[:250] or query.keywords
