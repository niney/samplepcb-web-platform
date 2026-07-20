from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Any

from .models import (
    CandidateMatch,
    CandidateDecision,
    CandidateSelectionMode,
    LifecycleState,
    MatchStatus,
    PackageComparison,
    PlannedQuery,
    SearchMode,
    SelectionEligibility,
    SpecComparison,
    SupplierProduct,
)
from .physical import product_diameter_mm, product_mount_style
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
    "texasinstrumentsti": "texasinstruments",
    "stmicro": "stmicroelectronics",
    "stmicroelectronics": "stmicroelectronics",
    "onsemi": "onsemi",
    "onsemiconductor": "onsemi",
    "mps": "monolithicpowersystems",
    "monolithicpowersystems": "monolithicpowersystems",
    "monolithicpowersystemsmps": "monolithicpowersystems",
    "maxim": "maximintegrated",
    "maximintegrated": "maximintegrated",
    "analogdevicesmaximintegrated": "maximintegrated",
    "yageo": "yageo",
}

_STRICT_CATEGORY_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("electrolytic", "전해"), ("capacitance_f", "voltage_v", "package")),
    (
        ("resistor", "저항"),
        ("resistance_ohm", "power_w", "tolerance_percent", "package"),
    ),
    (
        ("capacitor", "커패시터", "콘덴서"),
        (
            "capacitance_f",
            "voltage_v",
            "tolerance_percent",
            "dielectric",
            "package",
        ),
    ),
    (
        ("inductor", "인덕터", "코일"),
        ("inductance_h", "current_a", "tolerance_percent", "package"),
    ),
    (
        ("crystal", "크리스털", "수정"),
        ("frequency_hz", "tolerance_percent", "package"),
    ),
)

_PHYSICAL_REQUIREMENTS = {"mount_style", "diameter_mm"}


def canonical_manufacturer(value: str | None) -> str:
    normalized = normalize_manufacturer(value)
    return _MANUFACTURER_ALIASES.get(normalized, normalized)


def manufacturers_compatible(expected: str | None, actual: str | None) -> bool | None:
    if not expected or not actual:
        return None
    left = canonical_manufacturer(expected)
    right = canonical_manufacturer(actual)
    if not left or not right:
        return None
    return left == right


def _stable_key(payload: object) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:32]


def _lifecycle_state(product: SupplierProduct) -> LifecycleState:
    if product.discontinued is True or product.end_of_life is True:
        return LifecycleState.CAUTION
    normalized = (product.lifecycle_status or "").casefold()
    if any(
        token in normalized
        for token in (
            "nrnd",
            "eol",
            "end of life",
            "obsolete",
            "discontinued",
            "기존 설계",
            "inactive",
            "비활성",
        )
    ):
        return LifecycleState.CAUTION
    if (
        re.search(r"(?:^|\W)active(?:\W|$)", normalized)
        or normalized == "활성"
        or "신규 설계" in normalized
        or "양산" in normalized
    ):
        return LifecycleState.ACTIVE
    return LifecycleState.UNKNOWN


def _requirement_counts(
    query: PlannedQuery,
    reasons: list[str],
) -> tuple[int, int, bool]:
    required = {
        name
        for name, requirement in query.requirements.items()
        if requirement.hard and requirement.normalized_value is not None
    }
    verified = {
        reason.removesuffix("_match")
        for reason in reasons
        if reason.endswith("_match")
        and reason != "manufacturer_match"
        and not reason.startswith("manufacturer_part_number_")
    }
    if "tolerance_not_applicable_for_zero_ohm" in reasons:
        verified.add("tolerance_percent")
    verified_required = required & verified
    return len(verified_required), len(required), required <= verified


def _strict_category_coverage(
    query: PlannedQuery,
    product: SupplierProduct,
    reasons: list[str],
) -> bool:
    category_text = f"{product.category or ''} {product.description or ''}".casefold()
    rule = next(
        (
            fields
            for tokens, fields in _STRICT_CATEGORY_RULES
            if any(token in category_text for token in tokens)
        ),
        None,
    )
    if rule is None:
        return False
    matched = {
        reason.removesuffix("_match") for reason in reasons if reason.endswith("_match")
    }
    if "tolerance_not_applicable_for_zero_ohm" in reasons:
        matched.add("tolerance_percent")
    if "mount_style" in matched:
        matched.add("package")
    # A category field must exist as an engine hard requirement as well as match.
    hard = {
        name
        for name, requirement in query.requirements.items()
        if requirement.hard and requirement.normalized_value is not None
    }
    return all(field in hard and field in matched for field in rule)


def _selection_mode(
    query: PlannedQuery,
    reasons: list[str],
) -> CandidateSelectionMode:
    if "manufacturer_part_number_exact" in reasons:
        return CandidateSelectionMode.EXACT
    if "manufacturer_part_number_format_variant" in reasons:
        return CandidateSelectionMode.VARIANT
    if query.mode == SearchMode.PARAMETRIC:
        return CandidateSelectionMode.SPEC_COMPATIBLE
    return CandidateSelectionMode.REVIEW


def _candidate_decision(
    query: PlannedQuery,
    product: SupplierProduct,
    status: MatchStatus,
    conflicts: list[str],
    missing: list[str],
    reasons: list[str],
    *,
    identity_key: str | None = None,
) -> CandidateDecision:
    mode = _selection_mode(query, reasons)
    verified, required, verification_complete = _requirement_counts(query, reasons)
    strict_coverage = _strict_category_coverage(query, product, reasons)
    lifecycle = _lifecycle_state(product)
    eligibility = SelectionEligibility.BLOCKED
    reason_codes: list[str] = []

    if mode == CandidateSelectionMode.EXACT:
        reason_codes.append("identity_exact")
    elif mode == CandidateSelectionMode.VARIANT:
        reason_codes.append("identity_variant")
    elif mode == CandidateSelectionMode.SPEC_COMPATIBLE:
        reason_codes.append("specification_compatible")

    conflict_set = set(conflicts)
    manufacturer_confirmation = (
        mode
        in {
            CandidateSelectionMode.EXACT,
            CandidateSelectionMode.VARIANT,
        }
        and not (conflict_set - {"manufacturer_mismatch"})
        and ("manufacturer_mismatch" in conflict_set or "manufacturer" in missing)
    )
    if manufacturer_confirmation:
        eligibility = SelectionEligibility.MANUAL_REVIEW
        reason_codes.append("manufacturer_confirmation_required")
    elif not conflicts and mode in {
        CandidateSelectionMode.EXACT,
        CandidateSelectionMode.VARIANT,
    }:
        eligibility = SelectionEligibility.AUTOMATIC
    elif (
        status == MatchStatus.SPEC_COMPATIBLE
        and mode == CandidateSelectionMode.SPEC_COMPATIBLE
        and not conflicts
        and not missing
        and verification_complete
        and strict_coverage
    ):
        eligibility = SelectionEligibility.AUTOMATIC

    if conflicts:
        reason_codes.extend(f"conflict:{value}" for value in sorted(conflict_set))
    if missing:
        reason_codes.extend(f"missing:{value}" for value in sorted(set(missing)))
    if not verification_complete:
        reason_codes.append("verification_incomplete")
    if mode == CandidateSelectionMode.SPEC_COMPATIBLE and not strict_coverage:
        reason_codes.append("strict_category_coverage_incomplete")
    if lifecycle == LifecycleState.CAUTION:
        reason_codes.append("lifecycle_caution")
    if eligibility == SelectionEligibility.BLOCKED:
        reason_codes.append("technical_selection_blocked")

    manufacturer_key = canonical_manufacturer(product.manufacturer) or "unknown"
    candidate_identity_key = identity_key or _stable_key(
        [compact_mpn(product.manufacturer_part_number), manufacturer_key]
    )
    technical_evidence_key = _stable_key(
        {
            "status": status,
            "selection_mode": mode,
            "selection_eligibility": eligibility,
            "conflicts": sorted(conflict_set),
            "missing": sorted(set(missing)),
            "reasons": sorted(set(reasons)),
            "verified": verified,
            "required": required,
            "verification_complete": verification_complete,
            "strict_category_coverage": strict_coverage,
            "lifecycle_state": lifecycle,
        }
    )
    return CandidateDecision(
        selection_eligibility=eligibility,
        selection_mode=mode,
        auto_eligible=eligibility == SelectionEligibility.AUTOMATIC,
        manual_selectable=eligibility != SelectionEligibility.BLOCKED,
        reason_codes=list(dict.fromkeys(reason_codes)),
        identity_key=candidate_identity_key,
        technical_evidence_key=technical_evidence_key,
        verified_requirement_count=verified,
        required_requirement_count=required,
        verification_complete=verification_complete,
        strict_category_coverage=strict_coverage,
        lifecycle_state=lifecycle,
    )


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
    return (
        f"{_temperature_number(minimum)} ~ {_temperature_number(maximum)} °C · {change}"
    )


def _conditional_dielectric_substitute(expected: object, actual: object) -> bool:
    expected_profile = _dielectric_profile(expected)
    actual_profile = _dielectric_profile(actual)
    if expected_profile is None or actual_profile is None:
        return False
    exp_minimum, exp_maximum, exp_change = expected_profile
    act_minimum, act_maximum, act_change = actual_profile
    return (
        act_minimum <= exp_minimum
        and act_maximum >= exp_maximum
        and act_change <= exp_change
    )


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


def _category_matches(
    part_type: str, category: str | None, description: str | None
) -> bool | None:
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


@dataclass
class _CandidateGroup:
    mpn_norm: str
    identity_key: str
    candidates: list[CandidateMatch]


def _group_physical_evidence(
    query: PlannedQuery,
    candidates: list[CandidateMatch],
) -> tuple[list[str], list[str], list[str]]:
    reasons: list[str] = []
    conflicts: list[str] = []
    missing: list[str] = []
    mount_requirement = query.requirements.get("mount_style")
    if mount_requirement is not None and mount_requirement.normalized_value is not None:
        mount_styles = {
            value
            for candidate in candidates
            if (value := product_mount_style(candidate.product)) is not None
        }
        if len(mount_styles) > 1:
            conflicts.append("mount_style_source_conflict")
        elif not mount_styles:
            missing.append("mount_style")
        elif next(iter(mount_styles)) == mount_requirement.normalized_value:
            reasons.append("mount_style_match")
        else:
            conflicts.append("mount_style_mismatch")

    diameter_requirement = query.requirements.get("diameter_mm")
    if (
        diameter_requirement is not None
        and diameter_requirement.normalized_value is not None
    ):
        diameters = [
            value
            for candidate in candidates
            if (value := product_diameter_mm(candidate.product)) is not None
        ]
        if diameters and not math.isclose(
            max(diameters), min(diameters), rel_tol=0.0, abs_tol=0.25
        ):
            conflicts.append("diameter_mm_source_conflict")
        elif not diameters:
            missing.append("diameter_mm")
        elif all(
            math.isclose(
                diameter,
                float(diameter_requirement.normalized_value),
                rel_tol=0.0,
                abs_tol=0.25,
            )
            for diameter in diameters
        ):
            reasons.append("diameter_mm_match")
        else:
            conflicts.append("diameter_mm_mismatch")
    return reasons, conflicts, missing


def _status_after_group_evidence(
    query: PlannedQuery,
    candidate: CandidateMatch,
    conflicts: list[str],
    missing: list[str],
) -> MatchStatus:
    hard_conflicts = [
        item
        for item in conflicts
        if item != "part_number_mismatch" or query.mode == SearchMode.IDENTITY
    ]
    if (
        query.mode == SearchMode.IDENTITY
        and candidate.identity_confidence >= 1.0
        and not hard_conflicts
    ):
        return MatchStatus.VERIFIED_EXACT
    if (
        query.mode == SearchMode.IDENTITY
        and candidate.identity_confidence >= 0.9
        and not hard_conflicts
    ):
        return MatchStatus.VERIFIED_VARIANT
    if (
        query.mode == SearchMode.IDENTITY
        and candidate.identity_confidence >= 0.9
        and any(
            item.endswith("_mismatch") and item != "part_number_mismatch"
            for item in conflicts
        )
    ):
        return MatchStatus.INPUT_CONFLICT
    if conflicts:
        return MatchStatus.AMBIGUOUS
    if missing:
        return MatchStatus.SPEC_PARTIAL
    if query.mode in {SearchMode.PARAMETRIC, SearchMode.HYBRID}:
        return MatchStatus.SPEC_COMPATIBLE
    return MatchStatus.SPEC_PARTIAL


def finalize_candidate_decisions(
    query: PlannedQuery,
    candidates: list[CandidateMatch],
) -> list[CandidateMatch]:
    """Assign engine-owned identity groups and group-level physical decisions."""

    candidates_by_mpn: dict[str, list[CandidateMatch]] = {}
    for candidate in candidates:
        mpn_norm = compact_mpn(candidate.product.manufacturer_part_number)
        candidates_by_mpn.setdefault(mpn_norm, []).append(candidate)

    groups: list[_CandidateGroup] = []
    for mpn_norm in sorted(candidates_by_mpn):
        manufacturer_groups: dict[str, list[CandidateMatch]] = {}
        unknown_candidates: list[CandidateMatch] = []
        for candidate in candidates_by_mpn[mpn_norm]:
            manufacturer_norm = (
                canonical_manufacturer(candidate.product.manufacturer) or "unknown"
            )
            if manufacturer_norm == "unknown":
                unknown_candidates.append(candidate)
            else:
                manufacturer_groups.setdefault(manufacturer_norm, []).append(candidate)

        groups.extend(
            _CandidateGroup(
                mpn_norm,
                _stable_key([mpn_norm, manufacturer_norm]),
                group_candidates,
            )
            for manufacturer_norm, group_candidates in sorted(
                manufacturer_groups.items()
            )
        )
        # 제조사 미상 행은 같은 MPN의 알려진 제조사나 다른 공급사에 추측으로
        # 붙이지 않는다. 공급사·SKU가 같은 중복 결과만 안정적으로 한 그룹에 둔다.
        unknown_groups: dict[str, list[CandidateMatch]] = {}
        for candidate in unknown_candidates:
            supplier_skus = sorted(
                {
                    offer.supplier_sku.strip()
                    for offer in candidate.product.offers
                    if offer.supplier_sku and offer.supplier_sku.strip()
                }
            )
            discriminator = _stable_key(
                [mpn_norm, "unknown", candidate.product.supplier, supplier_skus]
            )
            unknown_groups.setdefault(discriminator, []).append(candidate)
        groups.extend(
            _CandidateGroup(mpn_norm, identity_key, group_candidates)
            for identity_key, group_candidates in sorted(unknown_groups.items())
        )

    completed: list[CandidateMatch] = []
    for group in groups:
        physical_reasons, physical_conflicts, physical_missing = (
            _group_physical_evidence(query, group.candidates)
        )
        for candidate in group.candidates:
            reasons = [
                value
                for value in candidate.reasons
                if value not in {"mount_style_match", "diameter_mm_match"}
            ]
            conflicts = [
                value
                for value in candidate.conflicts
                if not (
                    value.startswith("mount_style_") or value.startswith("diameter_mm_")
                )
            ]
            missing = [
                value
                for value in candidate.missing_requirements
                if value not in _PHYSICAL_REQUIREMENTS
            ]
            reasons = list(dict.fromkeys([*reasons, *physical_reasons]))
            conflicts = sorted(set([*conflicts, *physical_conflicts]))
            missing = sorted(set([*missing, *physical_missing]))
            status = _status_after_group_evidence(query, candidate, conflicts, missing)
            completed.append(
                candidate.model_copy(
                    update={
                        "status": status,
                        "reasons": reasons,
                        "conflicts": conflicts,
                        "missing_requirements": missing,
                        "decision": _candidate_decision(
                            query,
                            candidate.product,
                            status,
                            conflicts,
                            missing,
                            reasons,
                            identity_key=group.identity_key,
                        ),
                    },
                    deep=True,
                )
            )
    return completed


class CandidateMatcher:
    def evaluate(self, query: PlannedQuery, product: SupplierProduct) -> CandidateMatch:
        conflicts: list[str] = []
        missing: list[str] = []
        reasons: list[str] = []
        identity_confidence = 0.0

        if query.part_number:
            if normalize_mpn(query.part_number) == normalize_mpn(
                product.manufacturer_part_number
            ):
                identity_confidence = 1.0
                reasons.append("manufacturer_part_number_exact")
            elif compact_mpn(query.part_number) == compact_mpn(
                product.manufacturer_part_number
            ):
                identity_confidence = 0.92
                reasons.append("manufacturer_part_number_format_variant")
            elif _packaging_variant(
                query.part_number, product.manufacturer_part_number
            ):
                identity_confidence = 0.92
                reasons.append("manufacturer_part_number_format_variant")
            else:
                conflicts.append("part_number_mismatch")
        manufacturer_match = manufacturers_compatible(
            query.manufacturer, product.manufacturer
        )
        if manufacturer_match is True:
            identity_confidence = min(1.0, identity_confidence + 0.03)
            reasons.append("manufacturer_match")
        elif manufacturer_match is False:
            conflicts.append("manufacturer_mismatch")
        elif canonical_manufacturer(query.manufacturer) and not canonical_manufacturer(
            product.manufacturer
        ):
            missing.append("manufacturer")

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
            elif name == "mount_style":
                actual = product_mount_style(product)
            elif name == "diameter_mm":
                actual = product_diameter_mm(product)
            elif name == "part_type":
                category_match = _category_matches(
                    str(expected), product.category, product.description
                )
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
            is_match = (
                math.isclose(
                    float(expected),
                    float(actual),
                    rel_tol=0.0,
                    abs_tol=0.25,
                )
                if name == "diameter_mm"
                else self._matches(requirement.comparison, expected, actual)
            )
            if is_match:
                matched += 1
                reasons.append(f"{name}_match")
            elif requirement.hard:
                conflicts.append(f"{name}_mismatch")

        # Unknown hard requirements reduce confidence instead of letting a
        # single category match report 100% on an otherwise empty candidate.
        confidence_checks = checked + len(set(missing))
        spec_confidence = matched / confidence_checks if confidence_checks else 0.0
        hard_conflicts = [
            item
            for item in conflicts
            if item != "part_number_mismatch" or query.mode == SearchMode.IDENTITY
        ]
        if (
            query.mode == SearchMode.IDENTITY
            and identity_confidence >= 1.0
            and not hard_conflicts
        ):
            status = MatchStatus.VERIFIED_EXACT
        elif (
            query.mode == SearchMode.IDENTITY
            and identity_confidence >= 0.9
            and not hard_conflicts
        ):
            status = MatchStatus.VERIFIED_VARIANT
        elif (
            query.mode == SearchMode.IDENTITY
            and identity_confidence >= 0.9
            and any(
                item.endswith("_mismatch") and item != "part_number_mismatch"
                for item in conflicts
            )
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
        package_comparison = self._package_comparison(
            query, product, conflicts, missing, reasons
        )
        decision = _candidate_decision(
            query,
            product,
            status,
            sorted(set(conflicts)),
            sorted(set(missing)),
            reasons,
        )
        return CandidateMatch(
            product=product,
            status=status,
            identity_confidence=identity_confidence,
            specification_confidence=spec_confidence,
            conflicts=sorted(set(conflicts)),
            missing_requirements=sorted(set(missing)),
            reasons=reasons,
            package_comparison=package_comparison,
            spec_comparisons=self._spec_comparisons(query, product),
            decision=decision,
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
                expected_notation = (
                    dielectric_notation(requirement.raw_value) or expected_display
                )
                actual_notation = (
                    _supplier_dielectric_notation(product) or actual_display
                )
                expected_raw = (
                    expected_notation if expected_notation != expected_display else None
                )
                actual_raw = (
                    actual_notation if actual_notation != actual_display else None
                )
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
                    relation = (
                        "exact" if expected_notation == actual_notation else "alias"
                    )
                else:
                    relation = "exact" if expected == actual else "contains"
            else:
                state = "mismatch"
                relation = (
                    "conditional"
                    if name == "dielectric"
                    and _conditional_dielectric_substitute(expected, actual)
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
            actual_text = re.sub(
                r"[^A-Z0-9]+", "", str(product.package or actual_source).upper()
            )
            if expected_canonical == actual_canonical:
                relation = (
                    "exact"
                    if expected_canonical in expected_text
                    and actual_canonical in actual_text
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
                    return normalize_dielectric(expected) == normalize_dielectric(
                        actual
                    )
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
            return (
                exp_min is None or (act_min is not None and act_min <= exp_min)
            ) and (exp_max is None or (act_max is not None and act_max >= exp_max))
        return False
