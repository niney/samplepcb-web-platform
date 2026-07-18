from __future__ import annotations

import math
import re
from typing import Any

from .models import (
    CandidateMatch,
    MatchStatus,
    PackageComparison,
    PlannedQuery,
    SearchMode,
    SpecComparison,
    SupplierProduct,
)
from .normalization import (
    compact_mpn,
    dielectric_notation,
    distinct_package_notation,
    normalize_dielectric,
    normalize_manufacturer,
    normalize_mpn,
    normalize_package,
    package_display,
    packages_compatible,
)


_MANUFACTURER_ALIASES = {
    "ti": "texasinstruments",
    "texasinstruments": "texasinstruments",
    "stmicro": "stmicroelectronics",
    "stmicroelectronics": "stmicroelectronics",
    "onsemi": "onsemi",
    "onsemiconductor": "onsemi",
    "mps": "monolithicpowersystems",
    "monolithicpowersystems": "monolithicpowersystems",
    "maxim": "maximintegrated",
    "maximintegrated": "maximintegrated",
    "analogdevicesmaximintegrated": "maximintegrated",
    "yageo": "yageo",
}


def manufacturers_compatible(expected: str | None, actual: str | None) -> bool | None:
    if not expected or not actual:
        return None
    left = _MANUFACTURER_ALIASES.get(normalize_manufacturer(expected), normalize_manufacturer(expected))
    right = _MANUFACTURER_ALIASES.get(normalize_manufacturer(actual), normalize_manufacturer(actual))
    if not left or not right:
        return None
    return left == right or (min(len(left), len(right)) >= 6 and (left in right or right in left))


def _numeric_close(left: float, right: float) -> bool:
    scale = max(abs(left), abs(right))
    return math.isclose(left, right, rel_tol=1e-6, abs_tol=max(scale * 1e-9, 1e-18))


_PACKAGING_SUFFIXES = {"R", "T", "TR", "CT", "DKR", "REEL", "RL"}
_NUMERIC_PACKAGING_SUFFIXES = {"115", "125", "135", "215", "235"}

_DIELECTRIC_LOWER_C = {"X": -55, "Y": -30, "Z": 10}
_DIELECTRIC_UPPER_C = {"4": 65, "5": 85, "6": 105, "7": 125, "8": 150, "9": 200}
_DIELECTRIC_CAPACITANCE_CHANGE = {
    "R": "ΔC ±15%",
    "S": "ΔC ±22%",
    "T": "ΔC +22/−33%",
    "U": "ΔC +22/−56%",
    "V": "ΔC +22/−82%",
}
_DIELECTRIC_CHANGE_LIMIT = {"R": 15, "S": 22, "T": 33, "U": 56, "V": 82}


def _packaging_variant(left: str, right: str) -> bool:
    first = compact_mpn(left)
    second = compact_mpn(right)
    for base, extended in ((first, second), (second, first)):
        # TI commonly inserts X before /NOPB for the tape-and-reel orderable.
        if len(base) >= 8 and extended.endswith("XNOPB"):
            without_reel_marker = f"{extended[:-5]}NOPB"
            if base == without_reel_marker:
                return True
        if not extended.startswith(base):
            continue
        suffix = extended[len(base) :]
        if len(base) >= 8 and suffix in _PACKAGING_SUFFIXES:
            return True
        if len(base) >= 6 and suffix in _NUMERIC_PACKAGING_SUFFIXES:
            return True
    return False


def _temperature_number(value: float | int) -> str:
    number = f"{float(value):g}"
    if number.startswith("-"):
        return f"−{number[1:]}"
    return f"+{number}"


def _temperature_display(value: object) -> str | None:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    minimum, maximum = value
    if minimum is None and maximum is None:
        return None
    if minimum is None:
        return f"≤ {_temperature_number(maximum)} °C"
    if maximum is None:
        return f"≥ {_temperature_number(minimum)} °C"
    return f"{_temperature_number(minimum)} ~ {_temperature_number(maximum)} °C"


def _dielectric_profile(value: object) -> tuple[int, int, int] | None:
    canonical = normalize_dielectric(value)
    if not canonical:
        return None
    match = re.fullmatch(r"([XYZ])([4-9])([RSTUV])", canonical)
    if not match:
        return None
    return (
        _DIELECTRIC_LOWER_C[match.group(1)],
        _DIELECTRIC_UPPER_C[match.group(2)],
        _DIELECTRIC_CHANGE_LIMIT[match.group(3)],
    )


def _dielectric_detail(value: object) -> str | None:
    canonical = normalize_dielectric(value)
    if canonical == "C0G":
        return "−55 ~ +125 °C · 0 ±30 ppm/°C"
    profile = _dielectric_profile(canonical)
    if profile is None:
        return None
    minimum, maximum, _ = profile
    change = _DIELECTRIC_CAPACITANCE_CHANGE[canonical[-1]]
    return f"{_temperature_number(minimum)} ~ {_temperature_number(maximum)} °C · {change}"


def _conditional_dielectric_substitute(expected: object, actual: object) -> bool:
    expected_profile = _dielectric_profile(expected)
    actual_profile = _dielectric_profile(actual)
    if expected_profile is None or actual_profile is None:
        return False
    exp_minimum, exp_maximum, exp_change = expected_profile
    act_minimum, act_maximum, act_change = actual_profile
    return act_minimum <= exp_minimum and act_maximum >= exp_maximum and act_change <= exp_change


def _supplier_dielectric_notation(product: SupplierProduct) -> str | None:
    aliases = ("dielectric", "temperaturecharacteristic", "유전체", "온도특성")
    for name, value in product.attributes.items():
        compact_name = re.sub(r"\s+", "", str(name).casefold())
        if any(alias in compact_name for alias in aliases):
            notation = dielectric_notation(value)
            if notation:
                return notation
    return dielectric_notation(product.description) or dielectric_notation(
        product.normalized_specs.get("dielectric")
    )


def _category_matches(part_type: str, category: str | None, description: str | None) -> bool | None:
    haystack = f"{category or ''} {description or ''}".casefold()
    aliases = {
        "resistor": ("resistor", "저항"),
        "capacitor": ("capacitor", "condenser", "커패시터", "콘덴서"),
        "inductor": (
            "inductor",
            "choke",
            "ferrite",
            "filter",
            "bead",
            "인덕터",
            "초크",
            "필터",
            "페라이트",
            "공통 모드",
        ),
        "diode": ("diode", "다이오드"),
        "transistor": ("transistor", "mosfet", "트랜지스터"),
        "ic": (
            "integrated circuit",
            " ic ",
            "semiconductor",
            "amplifier",
            "op amp",
            "microcontroller",
            "processor",
            "memory",
            "logic",
            "regulator",
            "converter",
            "controller",
            "driver",
            "interface",
            "comparator",
            "module",
            "transceiver",
            "supervisor",
            "ldo",
            "모듈",
            "레귤레이터",
            "증폭기",
            "집적",
        ),
        "connector": ("connector", "header", "커넥터"),
        "led": ("led", "light emitting"),
        "crystal": (
            "crystal",
            "oscillator",
            "resonator",
            "크리스털",
            "수정",
            "발진기",
            "공진기",
            "결정",
        ),
    }
    tokens = aliases.get(part_type.casefold())
    if not tokens:
        return None
    return any(token in f" {haystack} " for token in tokens)


def infer_supplier_part_type(product: SupplierProduct) -> str | None:
    """Infer one unambiguous taxonomy value from supplier-owned category text."""

    supported = (
        "resistor",
        "capacitor",
        "inductor",
        "diode",
        "transistor",
        "ic",
        "connector",
        "led",
        "crystal",
    )
    matches = [
        part_type
        for part_type in supported
        if _category_matches(part_type, product.category, product.description) is True
    ]
    return matches[0] if len(matches) == 1 else None


class CandidateMatcher:
    def evaluate(self, query: PlannedQuery, product: SupplierProduct) -> CandidateMatch:
        conflicts: list[str] = []
        missing: list[str] = []
        reasons: list[str] = []
        identity_confidence = 0.0

        if query.part_number:
            if normalize_mpn(query.part_number) == normalize_mpn(product.manufacturer_part_number):
                identity_confidence = 1.0
                reasons.append("manufacturer_part_number_exact")
            elif compact_mpn(query.part_number) == compact_mpn(product.manufacturer_part_number):
                identity_confidence = 0.92
                reasons.append("manufacturer_part_number_format_variant")
            elif _packaging_variant(query.part_number, product.manufacturer_part_number):
                identity_confidence = 0.92
                reasons.append("manufacturer_part_number_format_variant")
            else:
                conflicts.append("part_number_mismatch")
        manufacturer_match = manufacturers_compatible(query.manufacturer, product.manufacturer)
        if manufacturer_match is True:
            identity_confidence = min(1.0, identity_confidence + 0.03)
            reasons.append("manufacturer_match")
        elif manufacturer_match is False:
            conflicts.append("manufacturer_mismatch")

        checked = 0
        matched = 0
        for name, requirement in query.requirements.items():
            expected = requirement.normalized_value
            if expected is None:
                continue
            if name == "tolerance_percent" and self._is_zero_ohm_query(query):
                reasons.append("tolerance_not_applicable_for_zero_ohm")
                continue
            actual: Any
            if name == "package":
                actual = product.normalized_specs.get("package") or product.package
            elif name == "dielectric":
                actual = product.normalized_specs.get("dielectric")
            elif name == "part_type":
                category_match = _category_matches(str(expected), product.category, product.description)
                if category_match is None:
                    if requirement.hard:
                        missing.append(name)
                    continue
                checked += 1
                if category_match:
                    matched += 1
                    reasons.append(f"{name}_match")
                elif requirement.hard:
                    conflicts.append(f"{name}_mismatch")
                continue
            else:
                actual = product.normalized_specs.get(name)
            if actual is None:
                if requirement.hard:
                    missing.append(name)
                continue
            checked += 1
            is_match = self._matches(requirement.comparison, expected, actual)
            if is_match:
                matched += 1
                reasons.append(f"{name}_match")
            elif requirement.hard:
                conflicts.append(f"{name}_mismatch")

        # Unknown hard requirements reduce confidence instead of letting a
        # single category match report 100% on an otherwise empty candidate.
        confidence_checks = checked + len(set(missing))
        spec_confidence = matched / confidence_checks if confidence_checks else 0.0
        hard_conflicts = [item for item in conflicts if item != "part_number_mismatch" or query.mode == SearchMode.IDENTITY]
        if query.mode == SearchMode.IDENTITY and identity_confidence >= 1.0 and not hard_conflicts:
            status = MatchStatus.VERIFIED_EXACT
        elif query.mode == SearchMode.IDENTITY and identity_confidence >= 0.9 and not hard_conflicts:
            status = MatchStatus.VERIFIED_VARIANT
        elif query.mode == SearchMode.IDENTITY and identity_confidence >= 0.9 and any(
            item.endswith("_mismatch") and item != "part_number_mismatch" for item in conflicts
        ):
            status = MatchStatus.INPUT_CONFLICT
        elif conflicts:
            status = MatchStatus.AMBIGUOUS
        elif missing:
            status = MatchStatus.SPEC_PARTIAL
        elif query.mode in {SearchMode.PARAMETRIC, SearchMode.HYBRID} and checked:
            status = MatchStatus.SPEC_COMPATIBLE
        else:
            status = MatchStatus.SPEC_PARTIAL
        return CandidateMatch(
            product=product,
            status=status,
            identity_confidence=identity_confidence,
            specification_confidence=spec_confidence,
            conflicts=sorted(set(conflicts)),
            missing_requirements=sorted(set(missing)),
            reasons=reasons,
            package_comparison=self._package_comparison(query, product, conflicts, missing, reasons),
            spec_comparisons=self._spec_comparisons(query, product),
        )

    @staticmethod
    def _is_zero_ohm_query(query: PlannedQuery) -> bool:
        resistance = query.requirements.get("resistance_ohm")
        return bool(
            resistance
            and isinstance(resistance.normalized_value, (int, float))
            and math.isclose(float(resistance.normalized_value), 0.0, abs_tol=1e-18)
        )

    def _spec_comparisons(
        self,
        query: PlannedQuery,
        product: SupplierProduct,
    ) -> dict[str, SpecComparison]:
        comparisons: dict[str, SpecComparison] = {}
        for name in ("dielectric", "temperature_range_c"):
            requirement = query.requirements.get(name)
            if requirement is None or requirement.normalized_value is None:
                continue
            expected = requirement.normalized_value
            actual = product.normalized_specs.get(name)

            expected_display: str | None
            actual_display: str | None
            expected_raw: str | None = None
            actual_raw: str | None = None
            expected_detail: str | None = None
            actual_detail: str | None = None
            if name == "dielectric":
                expected_display = normalize_dielectric(expected)
                actual_display = normalize_dielectric(actual)
                expected_notation = dielectric_notation(requirement.raw_value) or expected_display
                actual_notation = _supplier_dielectric_notation(product) or actual_display
                expected_raw = expected_notation if expected_notation != expected_display else None
                actual_raw = actual_notation if actual_notation != actual_display else None
                expected_detail = _dielectric_detail(expected)
                actual_detail = _dielectric_detail(actual)
            else:
                expected_display = _temperature_display(expected)
                actual_display = _temperature_display(actual)

            if actual is None:
                state = "missing"
                relation = "missing"
            elif self._matches(requirement.comparison, expected, actual):
                state = "match"
                if name == "dielectric":
                    relation = "exact" if expected_notation == actual_notation else "alias"
                else:
                    relation = "exact" if expected == actual else "contains"
            else:
                state = "mismatch"
                relation = (
                    "conditional"
                    if name == "dielectric" and _conditional_dielectric_substitute(expected, actual)
                    else "mismatch"
                )

            comparisons[name] = SpecComparison(
                state=state,
                relation=relation,
                expected_display=expected_display,
                expected_raw=expected_raw,
                expected_detail=expected_detail,
                actual_display=actual_display,
                actual_raw=actual_raw,
                actual_detail=actual_detail,
            )
        return comparisons

    @staticmethod
    def _package_comparison(
        query: PlannedQuery,
        product: SupplierProduct,
        conflicts: list[str],
        missing: list[str],
        reasons: list[str],
    ) -> PackageComparison | None:
        requirement = query.requirements.get("package")
        if requirement is None:
            return None

        expected_source = requirement.raw_value or requirement.normalized_value
        actual_source = product.normalized_specs.get("package") or product.package
        expected_canonical = normalize_package(expected_source)
        actual_canonical = normalize_package(actual_source)
        expected_raw = distinct_package_notation(expected_source, expected_canonical)
        actual_raw = distinct_package_notation(product.package, actual_canonical)

        if actual_source is None or "package" in missing:
            state = "missing"
            relation = "missing"
        elif "package_mismatch" in conflicts:
            state = "mismatch"
            relation = "mismatch"
        elif "package_match" in reasons:
            state = "match"
            expected_text = re.sub(r"[^A-Z0-9]+", "", str(expected_source).upper())
            actual_text = re.sub(r"[^A-Z0-9]+", "", str(product.package or actual_source).upper())
            if expected_canonical == actual_canonical:
                relation = (
                    "exact"
                    if expected_canonical in expected_text and actual_canonical in actual_text
                    else "alias"
                )
            else:
                relation = "compatible"
        else:
            state = "neutral"
            relation = "unverified"

        return PackageComparison(
            state=state,
            relation=relation,
            expected_display=package_display(expected_canonical),
            expected_raw=expected_raw,
            actual_display=package_display(actual_canonical),
            actual_raw=actual_raw,
        )

    @staticmethod
    def _matches(comparison: str, expected: Any, actual: Any) -> bool:
        if comparison == "eq":
            if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                return _numeric_close(float(expected), float(actual))
            if isinstance(expected, str):
                if normalize_dielectric(expected):
                    return normalize_dielectric(expected) == normalize_dielectric(actual)
                return packages_compatible(expected, actual)
            return expected == actual
        if comparison == "gte":
            return float(actual) >= float(expected)
        if comparison == "lte":
            return float(actual) <= float(expected)
        if comparison == "contains":
            expected_range = list(expected)
            actual_range = list(actual)
            exp_min, exp_max = expected_range
            act_min, act_max = actual_range
            return (exp_min is None or (act_min is not None and act_min <= exp_min)) and (
                exp_max is None or (act_max is not None and act_max >= exp_max)
            )
        return False
