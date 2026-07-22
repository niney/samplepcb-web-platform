from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Any

from .models import (
    CandidateDecision,
    CandidateMatch,
    LifecycleState,
    ManufacturerEvidence,
    MatchRelation,
    MatchStatus,
    PackageComparison,
    PlannedQuery,
    RequirementAssessment,
    SearchMode,
    SelectionEligibility,
    SelectionRecommendation,
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
from .physical import product_diameter_evidence, product_mount_evidence


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

_CATEGORY_POLICY: dict[str, tuple[str, ...]] = {
    "electrolytic": ("capacitance_f", "voltage_v", "package", "mount_style"),
    "resistor": ("resistance_ohm", "power_w", "tolerance_percent", "package"),
    "capacitor": (
        "capacitance_f",
        "voltage_v",
        "tolerance_percent",
        "dielectric",
        "package",
    ),
    "inductor": ("inductance_h", "current_a", "tolerance_percent", "package"),
    "ferrite": (
        "impedance_ohm",
        "impedance_frequency_hz",
        "current_a",
        "package",
    ),
    "led": ("color", "package", "mount_style"),
    "connector": ("pin_count", "pitch_mm", "row_count", "mount_style"),
    "varistor": ("voltage_v", "diameter_mm", "mount_style"),
    "buzzer": ("voltage_v", "frequency_hz", "mount_style"),
    "crystal": ("frequency_hz", "tolerance_percent", "package"),
}
_PHYSICAL_REQUIREMENTS = {"mount_style", "diameter_mm"}
_SOURCE_CONFLICTS = {
    "manufacturer_source_conflict",
    "mount_style_source_conflict",
    "diameter_mm_source_conflict",
    "resistance_input_source_conflict",
    "capacitance_input_source_conflict",
    "inductance_input_source_conflict",
    "power_input_source_conflict",
    "tolerance_input_source_conflict",
    "voltage_input_source_conflict",
    "current_input_source_conflict",
    "frequency_input_source_conflict",
    "temperature_input_source_conflict",
    "package_input_source_conflict",
    "unit_category_conflict",
    "connector_geometry_source_conflict",
    "part_type_source_conflict",
}


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


def _stable_digest(payload: object) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:32]


def _verified_product_manufacturer(product: SupplierProduct) -> str:
    if product.manufacturer_evidence != ManufacturerEvidence.STRUCTURED:
        return ""
    return canonical_manufacturer(product.manufacturer)


def _identity_key(product: SupplierProduct) -> str:
    mpn = compact_mpn(product.manufacturer_part_number)
    manufacturer = _verified_product_manufacturer(product)
    if manufacturer:
        payload: object = [mpn, manufacturer]
    else:
        supplier_product_id = (product.supplier_product_id or "").strip().casefold()
        supplier_skus = sorted(
            {
                offer.supplier_sku.strip().casefold()
                for offer in product.offers
                if offer.supplier_sku and offer.supplier_sku.strip()
            }
        )
        if supplier_product_id:
            supplier_locator: object = ["supplier_product_id", supplier_product_id]
        elif supplier_skus:
            supplier_locator = ["supplier_skus", supplier_skus]
        else:
            supplier_locator = ["supplier_identity_unavailable"]
        payload = [mpn, "unknown", product.supplier.value, supplier_locator]
    return f"ik1:{_stable_digest(payload)}"


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


def _category_fields(query: PlannedQuery) -> tuple[str, ...] | None:
    policy = query.category_policy
    if policy is None:
        part_type = (query.part_type or "").casefold()
        policy = next(
            (
                name
                for name in _CATEGORY_POLICY
                if name in part_type
                or (name == "crystal" and "oscillator" in part_type)
            ),
            None,
        )
    fields = _CATEGORY_POLICY.get(policy) if policy else None
    if fields and "absolute_tolerance_h" in query.requirements:
        fields = tuple(
            "absolute_tolerance_h" if name == "tolerance_percent" else name
            for name in fields
        )
    return fields


def _requirement_assessment(
    query: PlannedQuery,
    product: SupplierProduct,
    reasons: list[str],
) -> tuple[set[str], set[str], set[str], bool, bool]:
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

    category_fields = _category_fields(query)
    category_missing: set[str] = set()
    if query.mode == SearchMode.PARAMETRIC:
        if category_fields is None:
            category_missing.add("unsupported_category")
        else:
            required.update(category_fields)
            category_missing.update(set(category_fields) - verified)
    verification_complete = required <= verified
    strict_category_coverage = bool(
        query.mode == SearchMode.PARAMETRIC
        and category_fields is not None
        and not category_missing
    )
    return (
        verified & required,
        required,
        category_missing,
        verification_complete,
        strict_category_coverage,
    )


def _compact_number(value: float) -> str:
    return f"{value:.6g}"


def _scaled_display(value: float, scales: tuple[tuple[float, str], ...]) -> str:
    absolute = abs(value)
    for factor, unit in scales:
        if absolute >= factor or factor == scales[-1][0]:
            return f"{_compact_number(value / factor)} {unit}"
    return _compact_number(value)


def _requirement_value_display(
    name: str,
    value: Any,
    component_type: str | None,
) -> str | None:
    if value is None:
        return None
    if name == "package":
        canonical = normalize_package(value, component_type)
        return package_display(canonical, component_type) or str(value)
    if name == "mount_style":
        labels = {"smd": "SMD", "through-hole": "THT"}
        return " / ".join(labels.get(item, item) for item in str(value).split(" / "))
    if isinstance(value, list):
        separator = " – " if name == "temperature_range_c" else " / "
        return separator.join(
            "…"
            if item is None
            else _requirement_value_display(name, item, component_type) or "…"
            for item in value
        )
    if not isinstance(value, (int, float)):
        return str(value)

    numeric = float(value)
    if name == "resistance_ohm":
        return _scaled_display(
            numeric, ((1_000_000.0, "MΩ"), (1_000.0, "kΩ"), (1.0, "Ω"))
        )
    if name == "capacitance_f":
        return _scaled_display(
            numeric, ((1.0, "F"), (1e-6, "µF"), (1e-9, "nF"), (1e-12, "pF"))
        )
    if name == "inductance_h":
        return _scaled_display(
            numeric, ((1.0, "H"), (1e-3, "mH"), (1e-6, "µH"), (1e-9, "nH"))
        )
    if name == "frequency_hz":
        return _scaled_display(
            numeric, ((1e9, "GHz"), (1e6, "MHz"), (1e3, "kHz"), (1.0, "Hz"))
        )
    if name == "current_a":
        return _scaled_display(numeric, ((1.0, "A"), (1e-3, "mA"), (1e-6, "µA")))
    if name == "power_w":
        return _scaled_display(numeric, ((1.0, "W"), (1e-3, "mW")))
    if name == "voltage_v":
        return f"{_compact_number(numeric)} V"
    if name == "tolerance_percent":
        return f"±{_compact_number(numeric)}%"
    if name == "diameter_mm":
        return f"Ø{_compact_number(numeric)} mm"
    if name == "temperature_range_c":
        return f"{_compact_number(numeric)} °C"
    return _compact_number(numeric)


def _requirement_actual_value(name: str, product: SupplierProduct) -> Any:
    if name == "package":
        return product.normalized_specs.get("package") or product.package
    if name == "part_type":
        return product.category or product.description
    if name == "mount_style":
        values = sorted(
            {evidence.value for evidence in product_mount_evidence(product)}
        )
        return " / ".join(values) if values else None
    if name == "diameter_mm":
        values = sorted(
            {evidence.value_mm for evidence in product_diameter_evidence(product)}
        )
        return values[0] if len(values) == 1 else values or None
    return product.normalized_specs.get(name)


def _build_requirement_assessments(
    query: PlannedQuery,
    product: SupplierProduct,
    verified: set[str],
    required: set[str],
    category_missing: set[str],
    conflicts: set[str],
    missing: set[str],
    reasons: list[str],
) -> list[RequirementAssessment]:
    ordered_names = [name for name in query.requirements if name in required]
    ordered_names.extend(
        name for name in (_category_fields(query) or ()) if name not in ordered_names
    )
    ordered_names.extend(sorted(required - set(ordered_names)))
    assessments: list[RequirementAssessment] = []
    for name in ordered_names:
        requirement = query.requirements.get(name)
        expected = requirement.normalized_value if requirement is not None else None
        actual = _requirement_actual_value(name, product)
        if (
            name == "tolerance_percent"
            and "tolerance_not_applicable_for_zero_ohm" in reasons
        ):
            state = "not_applicable"
        elif name in verified:
            state = "match"
        elif f"{name}_mismatch" in conflicts:
            state = "mismatch"
        elif name in missing or name in category_missing:
            state = "missing"
        else:
            state = "unverified"
        assessments.append(
            RequirementAssessment(
                key=name,
                comparison=requirement.comparison if requirement is not None else "eq",
                state=state,
                verified=name in verified,
                expected_display=_requirement_value_display(
                    name, expected, query.part_type
                ),
                actual_display=_requirement_value_display(
                    name, actual, query.part_type
                ),
            )
        )
    return assessments


def _match_relation(
    query: PlannedQuery,
    product: SupplierProduct,
    conflicts: list[str],
    missing: list[str],
    reasons: list[str],
) -> MatchRelation:
    if "manufacturer_part_number_exact" in reasons:
        return MatchRelation.EXACT
    if "manufacturer_part_number_format_variant" in reasons:
        return MatchRelation.VARIANT
    if query.mode != SearchMode.PARAMETRIC:
        return MatchRelation.UNRESOLVED
    actual_conflicts = set(conflicts) - _SOURCE_CONFLICTS
    _, _, _, complete, strict = _requirement_assessment(query, product, reasons)
    if not actual_conflicts and not missing and complete and strict:
        return MatchRelation.SPEC_COMPATIBLE
    return MatchRelation.UNRESOLVED


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
    relation = _match_relation(query, product, conflicts, missing, reasons)
    verified, required, category_missing, complete, strict = _requirement_assessment(
        query, product, reasons
    )
    lifecycle = _lifecycle_state(product)
    conflict_set = set(conflicts)
    requirement_assessments = _build_requirement_assessments(
        query,
        product,
        verified,
        required,
        category_missing,
        conflict_set,
        set(missing),
        reasons,
    )
    source_conflicts = conflict_set & _SOURCE_CONFLICTS
    actual_conflicts = conflict_set - _SOURCE_CONFLICTS - {"manufacturer_mismatch"}
    identity_relation = relation in {MatchRelation.EXACT, MatchRelation.VARIANT}
    manufacturer_confirmation = identity_relation and (
        "manufacturer_mismatch" in conflict_set
        or "manufacturer" in missing
        or product.manufacturer_evidence != ManufacturerEvidence.STRUCTURED
        or (not query.manufacturer and not product.manufacturer)
    )

    exact_requirement_conflict = bool(actual_conflicts) and relation == MatchRelation.EXACT

    if relation == MatchRelation.EXACT:
        eligibility = SelectionEligibility.AUTOMATIC
    elif actual_conflicts:
        eligibility = SelectionEligibility.BLOCKED
    elif source_conflicts or manufacturer_confirmation:
        eligibility = SelectionEligibility.MANUAL_REVIEW
    elif identity_relation:
        eligibility = SelectionEligibility.AUTOMATIC
    elif (
        relation == MatchRelation.SPEC_COMPATIBLE
        and query.mode == SearchMode.PARAMETRIC
        and query.category_policy in {"led", "connector"}
    ):
        eligibility = SelectionEligibility.MANUAL_REVIEW
    elif relation == MatchRelation.SPEC_COMPATIBLE:
        eligibility = SelectionEligibility.AUTOMATIC
    else:
        eligibility = SelectionEligibility.MANUAL_REVIEW

    reason_codes: list[str] = []
    if relation == MatchRelation.EXACT:
        reason_codes.append("identity_exact")
    elif relation == MatchRelation.VARIANT:
        reason_codes.append("identity_variant")
    elif relation == MatchRelation.SPEC_COMPATIBLE:
        reason_codes.append("specification_compatible")
    else:
        reason_codes.append("relationship_unresolved")
    if manufacturer_confirmation:
        reason_codes.append("manufacturer_confirmation_required")
    if exact_requirement_conflict:
        reason_codes.append("identity_exact_requirement_conflict")
    if product.manufacturer_evidence == ManufacturerEvidence.INFERRED:
        reason_codes.append("manufacturer_inferred")
    for value in sorted(source_conflicts):
        reason_codes.append(value)
    reason_codes.extend(f"conflict:{value}" for value in sorted(conflict_set - source_conflicts))
    reason_codes.extend(f"missing:{value}" for value in sorted(set(missing)))
    reason_codes.extend(
        f"category_coverage_missing:{value}" for value in sorted(category_missing)
    )
    if not complete:
        reason_codes.append("verification_incomplete")
    if query.mode == SearchMode.PARAMETRIC and not strict:
        reason_codes.append("strict_category_coverage_incomplete")
    if (
        query.mode == SearchMode.PARAMETRIC
        and query.category_policy in {"led", "connector"}
    ):
        reason_codes.append("category_manual_selection_only")
    if lifecycle == LifecycleState.CAUTION:
        reason_codes.append("lifecycle_caution")
    if eligibility == SelectionEligibility.MANUAL_REVIEW:
        reason_codes.append("manual_review_required")
    elif eligibility == SelectionEligibility.BLOCKED:
        reason_codes.append("technical_selection_blocked")

    candidate_identity_key = identity_key or _identity_key(product)
    evidence_payload = {
        "decision_policy_version": "supplier-candidate-decision-v3",
        "category_policy_version": "candidate-category-policy-v1",
        "evidence_key_version": "candidate-evidence-key-v1",
        "status": status.value,
        "match_relation": relation.value,
        "selection_eligibility": eligibility.value,
        "conflicts": sorted(conflict_set),
        "missing": sorted(set(missing)),
        "verified_fields": sorted(verified),
        "required_fields": sorted(required),
        "category_missing": sorted(category_missing),
        "verification_complete": complete,
        "strict_category_coverage": strict,
        "lifecycle_state": lifecycle.value,
        "manufacturer_evidence": product.manufacturer_evidence.value,
        "reason_codes": sorted(set(reason_codes)),
    }
    if query.input_branch_id is not None:
        evidence_payload["input_branch"] = {
            "id": query.input_branch_id,
            "field": query.input_branch_field,
            "requirements": {
                name: requirement.normalized_value
                for name, requirement in sorted(query.requirements.items())
                if requirement.hard
            },
        }
    return CandidateDecision(
        match_relation=relation,
        selection_eligibility=eligibility,
        auto_eligible=eligibility == SelectionEligibility.AUTOMATIC,
        manual_selectable=eligibility != SelectionEligibility.BLOCKED,
        selection_recommendation=(
            SelectionRecommendation.EXCLUDE
            if eligibility == SelectionEligibility.BLOCKED
            else SelectionRecommendation.CANDIDATE_ONLY
        ),
        reason_codes=list(dict.fromkeys(reason_codes)),
        identity_key=candidate_identity_key,
        technical_evidence_key=f"ek1:{_stable_digest(evidence_payload)}",
        verified_requirement_count=len(verified),
        required_requirement_count=len(required),
        requirement_assessments=requirement_assessments,
        verification_complete=complete,
        strict_category_coverage=strict,
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


@dataclass
class _CandidateGroup:
    identity_key: str
    candidates: list[CandidateMatch]


def _physical_group_updates(
    query: PlannedQuery,
    candidates: list[CandidateMatch],
) -> list[tuple[list[str], list[str], list[str]]]:
    updates: list[tuple[list[str], list[str], list[str]]] = [
        ([], [], []) for _ in candidates
    ]
    mount_values = [
        {evidence.value for evidence in product_mount_evidence(candidate.product)}
        for candidate in candidates
    ]
    mount_known = set().union(*mount_values)
    mount_source_conflict = len(mount_known) > 1
    mount_requirement = query.requirements.get("mount_style")
    for index, value in enumerate(mount_values):
        reasons, conflicts, missing = updates[index]
        if mount_source_conflict:
            conflicts.append("mount_style_source_conflict")
        if mount_requirement is None or mount_requirement.normalized_value is None:
            continue
        if not value:
            missing.append("mount_style")
        elif value == {mount_requirement.normalized_value}:
            reasons.append("mount_style_match")
        else:
            conflicts.append("mount_style_mismatch")

    diameter_values = [
        {evidence.value_mm for evidence in product_diameter_evidence(candidate.product)}
        for candidate in candidates
    ]
    known_diameters = sorted(set().union(*diameter_values))
    diameter_source_conflict = bool(known_diameters) and not math.isclose(
        max(known_diameters),
        min(known_diameters),
        rel_tol=0.0,
        abs_tol=0.25,
    )
    diameter_requirement = query.requirements.get("diameter_mm")
    for index, value in enumerate(diameter_values):
        reasons, conflicts, missing = updates[index]
        if diameter_source_conflict:
            conflicts.append("diameter_mm_source_conflict")
        if diameter_requirement is None or diameter_requirement.normalized_value is None:
            continue
        if not value:
            missing.append("diameter_mm")
        elif all(
            math.isclose(
                candidate_value,
                float(diameter_requirement.normalized_value),
                rel_tol=0.0,
                abs_tol=0.25,
            )
            for candidate_value in value
        ):
            reasons.append("diameter_mm_match")
        else:
            conflicts.append("diameter_mm_mismatch")
    return updates


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
    """Finalize per-candidate decisions after deterministic identity grouping."""

    candidates_by_mpn: dict[str, list[CandidateMatch]] = {}
    for candidate in candidates:
        mpn = compact_mpn(candidate.product.manufacturer_part_number)
        candidates_by_mpn.setdefault(mpn, []).append(candidate)

    groups: list[_CandidateGroup] = []
    manufacturer_source_conflicts: set[str] = set()
    for mpn in sorted(candidates_by_mpn):
        mpn_candidates = candidates_by_mpn[mpn]
        known_manufacturers = {
            _verified_product_manufacturer(candidate.product)
            for candidate in mpn_candidates
            if _verified_product_manufacturer(candidate.product)
        }
        if not query.manufacturer and len(known_manufacturers) > 1:
            manufacturer_source_conflicts.add(mpn)

        known_groups: dict[str, list[CandidateMatch]] = {}
        unknown_groups: dict[str, list[CandidateMatch]] = {}
        for candidate in mpn_candidates:
            manufacturer = _verified_product_manufacturer(candidate.product)
            if manufacturer:
                known_groups.setdefault(manufacturer, []).append(candidate)
            else:
                key = _identity_key(candidate.product)
                unknown_groups.setdefault(key, []).append(candidate)
        groups.extend(
            _CandidateGroup(
                identity_key=f"ik1:{_stable_digest([mpn, manufacturer])}",
                candidates=group_candidates,
            )
            for manufacturer, group_candidates in sorted(known_groups.items())
        )
        groups.extend(
            _CandidateGroup(identity_key=key, candidates=group_candidates)
            for key, group_candidates in sorted(unknown_groups.items())
        )

    completed: list[CandidateMatch] = []
    for group in groups:
        physical_updates = _physical_group_updates(query, group.candidates)
        for candidate, physical in zip(group.candidates, physical_updates, strict=True):
            physical_reasons, physical_conflicts, physical_missing = physical
            reasons = [
                value
                for value in candidate.reasons
                if value not in {"mount_style_match", "diameter_mm_match"}
            ]
            conflicts = [
                value
                for value in candidate.conflicts
                if not (
                    value.startswith("mount_style_")
                    or value.startswith("diameter_mm_")
                    or value == "manufacturer_source_conflict"
                )
            ]
            missing = [
                value
                for value in candidate.missing_requirements
                if value not in _PHYSICAL_REQUIREMENTS
            ]
            mpn = compact_mpn(candidate.product.manufacturer_part_number)
            if mpn in manufacturer_source_conflicts:
                physical_conflicts.append("manufacturer_source_conflict")
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
        conflicts: list[str] = list(query.input_source_conflicts)
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
            if product.manufacturer_evidence == ManufacturerEvidence.STRUCTURED:
                identity_confidence = min(1.0, identity_confidence + 0.03)
                reasons.append("manufacturer_match")
            else:
                missing.append("manufacturer")
                reasons.append("manufacturer_inferred")
        elif manufacturer_match is False:
            conflicts.append("manufacturer_mismatch")
        elif query.manufacturer:
            missing.append("manufacturer")

        checked = 0
        matched = 0
        for name, requirement in query.requirements.items():
            expected = requirement.normalized_value
            if expected is None:
                continue
            if name in _PHYSICAL_REQUIREMENTS:
                continue
            if name == "tolerance_percent" and self._is_zero_ohm_query(query):
                reasons.append("tolerance_not_applicable_for_zero_ohm")
                continue
            actual: Any
            if name == "package":
                package_source = (
                    product.normalized_specs.get("package") or product.package
                )
                actual = normalize_package(package_source, query.part_type) or None
            elif name == "dielectric":
                actual = product.normalized_specs.get("dielectric")
            elif name == "color":
                actual = product.normalized_specs.get("color")
                if actual is not None:
                    checked += 1
                    if str(actual).strip().casefold() == str(expected).strip().casefold():
                        matched += 1
                        reasons.append("color_match")
                    elif requirement.hard:
                        conflicts.append("color_mismatch")
                    continue
            elif name == "absolute_tolerance_h":
                actual = product.normalized_specs.get(name)
                if actual is None:
                    tolerance_percent = product.normalized_specs.get(
                        "tolerance_percent"
                    )
                    nominal = query.requirements.get("inductance_h")
                    if (
                        isinstance(tolerance_percent, (int, float))
                        and nominal is not None
                        and isinstance(nominal.normalized_value, (int, float))
                        and float(nominal.normalized_value) != 0
                    ):
                        actual = abs(
                            float(nominal.normalized_value)
                            * float(tolerance_percent)
                            / 100.0
                        )
                        reasons.append(
                            "absolute_tolerance_h_derived_from_supplier_percent"
                        )
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
            is_match = self._matches(
                requirement.comparison,
                expected,
                actual,
                query.part_type,
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
        package_comparison = self._package_comparison(
            query, product, conflicts, missing, reasons
        )
        spec_comparisons = self._spec_comparisons(query, product)
        return CandidateMatch(
            product=product,
            status=status,
            identity_confidence=identity_confidence,
            specification_confidence=spec_confidence,
            conflicts=sorted(set(conflicts)),
            missing_requirements=sorted(set(missing)),
            reasons=reasons,
            package_comparison=package_comparison,
            spec_comparisons=spec_comparisons,
            decision=_candidate_decision(
                query,
                product,
                status,
                sorted(set(conflicts)),
                sorted(set(missing)),
                reasons,
            ),
            input_branch_id=query.input_branch_id,
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
        expected_canonical = normalize_package(expected_source, query.part_type)
        actual_canonical = normalize_package(actual_source, query.part_type)
        expected_raw = distinct_package_notation(
            expected_source,
            expected_canonical,
            query.part_type,
        )
        actual_raw = distinct_package_notation(
            product.package,
            actual_canonical,
            query.part_type,
        )
        if actual_raw is None and product.package and not actual_canonical:
            actual_raw = product.package

        if not actual_canonical or "package" in missing:
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
            expected_display=package_display(expected_canonical, query.part_type),
            expected_raw=expected_raw,
            actual_display=package_display(actual_canonical, query.part_type),
            actual_raw=actual_raw,
        )

    @staticmethod
    def _matches(
        comparison: str,
        expected: Any,
        actual: Any,
        component_type: str | None = None,
    ) -> bool:
        if comparison == "eq":
            if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                return _numeric_close(float(expected), float(actual))
            if isinstance(expected, str):
                if normalize_dielectric(expected):
                    return normalize_dielectric(expected) == normalize_dielectric(actual)
                return packages_compatible(expected, actual, component_type)
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
