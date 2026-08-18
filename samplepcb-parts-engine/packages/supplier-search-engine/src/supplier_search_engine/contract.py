# -*- coding: utf-8 -*-
"""검색 입력 계약 — bom_probing_gpt/search_contract.py의 스키마 vendoring
+ SMARTBOM G-shape 결과용 빌더.

vendoring 범위: 스키마 클래스(SearchEvidence/SearchField/SearchComponentInput/
SearchBatchInput)와 _component_id/_field 헬퍼, VALUE_FIELDS 상수(원본
bom_probing_gpt/runtime.py와 순서까지 동일 — bom_extraction_engine/schema.py와도
동일함이 확인됨). 시트 중첩 구조 전제인 search_batch_from_runtime과
analyze_for_search는 제외 — SMARTBOM 결과는 components가 flat이라
build_batch_from_result가 그 역할을 대신한다.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    ValidationInfo,
    model_validator,
)

from .models import (
    PlannedQuery,
    ProcurementDisposition,
    ProcurementPolicyInput,
    QuantityResolution,
    SearchMode,
    SearchRequirementGuidance,
    SearchDisposition,
)
from .normalizer import (
    parse_capacitance_f,
    parse_crystal_tolerance_percent,
    parse_current_a,
    parse_frequency_hz,
    parse_inductance_h,
    parse_power_w,
    parse_resistance_ohm,
    parse_tolerance_percent,
    parse_voltage_v,
)

SEARCH_CONTRACT_VERSION = "1.2"
FieldStatus = Literal["extracted", "review", "not_found"]
SEARCH_REQUIREMENT_POLICY_VERSION = "bom-search-requirement-policy-v1"
SearchRequirementComponentType = Literal[
    "resistor",
    "capacitor",
    "inductor",
    "diode",
    "transistor",
    "led",
    "crystal",
    "connector",
    "switch",
]

_SEARCH_REQUIREMENT_REQUIRED: dict[
    SearchRequirementComponentType, tuple[str, ...]
] = {
    "resistor": ("resistance", "package"),
    "capacitor": ("capacitor_type", "capacitance", "package"),
    "inductor": ("inductor_type", "package"),
    "diode": ("diode_type", "package"),
    "transistor": ("transistor_type", "polarity", "package"),
    "led": ("color", "package"),
    "crystal": ("crystal_type", "frequency", "package"),
    "connector": ("pin_count", "pitch"),
    "switch": ("switch_type", "package"),
}

_SEARCH_REQUIREMENT_CONDITIONAL: dict[
    SearchRequirementComponentType, tuple[dict[str, object], ...]
] = {
    "inductor": (
        {
            "when": {"field": "inductor_type", "equals": "standard"},
            "required": ("inductance",),
        },
        {
            "when": {"field": "inductor_type", "equals": "ferrite"},
            "required": ("impedance",),
        },
    ),
    "diode": (
        {
            "when": {"field": "diode_type", "in": ("zener", "tvs")},
            "required": ("voltage",),
        },
    ),
}

_SEARCH_REQUIREMENT_TYPE_FIELDS = {
    "capacitor_type",
    "inductor_type",
    "diode_type",
    "transistor_type",
    "polarity",
    "crystal_type",
    "switch_type",
    "resistance",
    "capacitance",
    "inductance",
    "impedance",
    "impedance_frequency",
    "frequency",
    "tolerance",
    "voltage",
    "current",
    "power",
    "dielectric",
    "color",
    "pin_count",
    "pitch",
    "row_count",
    "gender",
    "orientation",
    "contact_form",
}

_SEARCH_REQUIREMENT_ALLOWED: dict[SearchRequirementComponentType, set[str]] = {
    "resistor": {"resistance", "tolerance", "voltage", "power"},
    "capacitor": {
        "capacitor_type",
        "capacitance",
        "tolerance",
        "voltage",
        "dielectric",
    },
    "inductor": {
        "inductor_type",
        "inductance",
        "impedance",
        "impedance_frequency",
        "tolerance",
        "current",
    },
    "diode": {"diode_type", "voltage", "current", "power"},
    "transistor": {
        "transistor_type",
        "polarity",
        "voltage",
        "current",
        "power",
    },
    "led": {"color", "voltage", "current"},
    "crystal": {"crystal_type", "frequency", "tolerance"},
    "connector": {
        "pin_count",
        "pitch",
        "row_count",
        "gender",
        "orientation",
    },
    "switch": {
        "switch_type",
        "contact_form",
        "voltage",
        "current",
    },
}

_SEARCH_REQUIREMENT_VALUE_PARSERS = {
    "resistance": parse_resistance_ohm,
    "capacitance": lambda value: parse_capacitance_f(value, allow_code=True),
    "inductance": parse_inductance_h,
    "impedance": parse_resistance_ohm,
    "impedance_frequency": parse_frequency_hz,
    "frequency": parse_frequency_hz,
    "tolerance": parse_tolerance_percent,
    "voltage": parse_voltage_v,
    "current": parse_current_a,
    "power": parse_power_w,
}

# 검색 계약이 소비하는 추출 필드 — bom_probing_gpt.runtime.VALUE_FIELDS 미러
VALUE_FIELDS = (
    "part_number",
    "part_type",
    "resistance",
    "capacitance",
    "inductance",
    "power",
    "tolerance",
    "voltage",
    "current",
    "frequency",
    "temperature",
    "package",
    "manufacturer",
    "quantity",
)

_NORMALIZED_FIELD_NAMES = {
    "resistance": "resistance_ohm",
    "capacitance": "capacitance_f",
    "inductance": "inductance_h",
    "power": "power_w",
    "tolerance": "tolerance_percent",
    "voltage": "voltage_v",
    "current": "current_a",
    "frequency": "frequency_hz",
}


class SearchEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cell: str
    raw_value: str
    supports: str


class SearchField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Any = None
    normalized_value: Any = None
    status: FieldStatus = "not_found"
    evidence: list[SearchEvidence] = Field(default_factory=list)
    source: Literal["col", "text", "infer"] | None = None


class SearchFieldAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_value: str
    normalized_value: Any = None
    source_cell: str
    source_role: Literal[
        "value",
        "package",
        "footprint",
        "description",
        "part_number",
        "supplier_part_number",
        "internal_part_number",
        "library_reference",
    ]


class UserSearchRequirements(BaseModel):
    """사용자가 원본 BOM과 별도로 확정한 행 단위 검색조건.

    원본 추출값과 provenance를 덮어쓰지 않고 QueryPlanner가 마지막에 병합한다.
    TCR은 사용자 보완 범위에서 의도적으로 제외한다.
    """

    model_config = ConfigDict(extra="forbid")

    version: Literal[
        "bom-user-search-requirements-v1",
        "bom-user-search-requirements-v2",
    ] = "bom-user-search-requirements-v2"
    component_type: SearchRequirementComponentType
    capacitor_type: Literal["ceramic", "electrolytic", "tantalum", "film"] | None = None
    inductor_type: Literal["standard", "ferrite"] | None = None
    diode_type: Literal[
        "rectifier", "signal", "schottky", "zener", "tvs", "photodiode"
    ] | None = None
    transistor_type: Literal["bjt", "mosfet"] | None = None
    polarity: Literal["npn", "pnp", "n-channel", "p-channel"] | None = None
    crystal_type: Literal["crystal", "oscillator", "resonator"] | None = None
    switch_type: Literal[
        "tactile",
        "pushbutton",
        "slide",
        "toggle",
        "dip",
        "rotary",
        "reed",
        "other",
    ] | None = None
    resistance: str | None = Field(default=None, min_length=1, max_length=64)
    capacitance: str | None = Field(default=None, min_length=1, max_length=64)
    inductance: str | None = Field(default=None, min_length=1, max_length=64)
    impedance: str | None = Field(default=None, min_length=1, max_length=64)
    impedance_frequency: str | None = Field(default=None, min_length=1, max_length=64)
    frequency: str | None = Field(default=None, min_length=1, max_length=64)
    package: str | None = Field(default=None, min_length=1, max_length=64)
    tolerance: str | None = Field(default=None, min_length=1, max_length=64)
    voltage: str | None = Field(default=None, min_length=1, max_length=64)
    current: str | None = Field(default=None, min_length=1, max_length=64)
    power: str | None = Field(default=None, min_length=1, max_length=64)
    dielectric: str | None = Field(default=None, min_length=1, max_length=32)
    color: str | None = Field(default=None, min_length=1, max_length=32)
    pin_count: int | None = Field(default=None, ge=1, le=1000)
    pitch: str | None = Field(default=None, min_length=1, max_length=32)
    row_count: int | None = Field(default=None, ge=1, le=100)
    gender: Literal["male", "female", "genderless"] | None = None
    orientation: Literal["straight", "right-angle", "vertical"] | None = None
    contact_form: str | None = Field(default=None, min_length=1, max_length=64)
    mount_style: Literal["smd", "through-hole"] | None = None

    @model_validator(mode="after")
    def validate_component_requirements(
        self, info: ValidationInfo
    ) -> "UserSearchRequirements":
        if (info.context or {}).get("skip_requirement_policy") is True:
            return self
        issues = search_requirement_issues(self)
        if issues:
            raise ValueError(issues[0].message)
        return self


class SearchRequirementIssue(BaseModel):
    """검색 조건 정책 위반을 필드 단위로 돌려주는 안정 계약."""

    model_config = ConfigDict(extra="forbid")

    field: str
    code: Literal[
        "invalid_shape",
        "missing_required",
        "field_not_applicable",
        "invalid_value",
        "invalid_combination",
        "unsupported_version",
    ]
    message: str


class SearchRequirementValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_version: Literal["bom-search-requirement-policy-v1"] = (
        SEARCH_REQUIREMENT_POLICY_VERSION
    )
    valid: bool
    requirements: UserSearchRequirements | None = None
    errors: list[SearchRequirementIssue] = Field(default_factory=list)


def _requirement_mapping(
    requirements: UserSearchRequirements | Mapping[str, Any],
) -> dict[str, Any]:
    if isinstance(requirements, UserSearchRequirements):
        return requirements.model_dump(mode="python")
    return dict(requirements)


def required_search_requirement_fields(
    component_type: SearchRequirementComponentType,
    values: Mapping[str, Any],
) -> list[str]:
    """현재 subtype 선택까지 적용한 필수 필드 목록."""

    required = list(_SEARCH_REQUIREMENT_REQUIRED[component_type])
    for rule in _SEARCH_REQUIREMENT_CONDITIONAL.get(component_type, ()):
        when = rule["when"]
        assert isinstance(when, dict)
        field = str(when["field"])
        actual = values.get(field)
        matches = (
            actual == when["equals"]
            if "equals" in when
            else actual in when["in"]
        )
        if matches:
            required.extend(str(name) for name in rule["required"])
    return list(dict.fromkeys(required))


def search_requirement_issues(
    requirements: UserSearchRequirements | Mapping[str, Any],
) -> list[SearchRequirementIssue]:
    """sp-engine 단일 원본 정책으로 필수값·조합·값 형식을 판정한다."""

    values = _requirement_mapping(requirements)
    component_type = values.get("component_type")
    if component_type not in _SEARCH_REQUIREMENT_REQUIRED:
        return [
            SearchRequirementIssue(
                field="component_type",
                code="invalid_value",
                message="지원하지 않는 부품 유형입니다.",
            )
        ]
    typed_component = component_type
    issues: list[SearchRequirementIssue] = []
    if (
        values.get("version") == "bom-user-search-requirements-v1"
        and typed_component not in {"resistor", "capacitor"}
    ):
        issues.append(
            SearchRequirementIssue(
                field="version",
                code="unsupported_version",
                message="v1 only supports resistor and capacitor search",
            )
        )

    for field in required_search_requirement_fields(typed_component, values):
        if values.get(field) is None:
            issues.append(
                SearchRequirementIssue(
                    field=field,
                    code="missing_required",
                    message=f"{field} required for {typed_component} search",
                )
            )

    invalid_fields = sorted(
        field
        for field in _SEARCH_REQUIREMENT_TYPE_FIELDS
        - _SEARCH_REQUIREMENT_ALLOWED[typed_component]
        if values.get(field) is not None
    )
    issues.extend(
        SearchRequirementIssue(
            field=field,
            code="field_not_applicable",
            message=f"{field} 값은 {typed_component} 검색에 사용할 수 없습니다.",
        )
        for field in invalid_fields
    )

    if typed_component == "transistor":
        transistor_type = values.get("transistor_type")
        valid_polarities = (
            {"npn", "pnp"}
            if transistor_type == "bjt"
            else {"n-channel", "p-channel"}
        )
        if values.get("polarity") not in valid_polarities:
            issues.append(
                SearchRequirementIssue(
                    field="polarity",
                    code="invalid_combination",
                    message="소자 종류에 맞는 극성 또는 채널이 필요합니다.",
                )
            )

    if (
        typed_component == "capacitor"
        and values.get("capacitor_type") != "ceramic"
        and values.get("dielectric") is not None
    ):
        issues.append(
            SearchRequirementIssue(
                field="dielectric",
                code="invalid_combination",
                message="유전체는 세라믹 캐패시터에만 지정할 수 있습니다.",
            )
        )

    for field, parser in _SEARCH_REQUIREMENT_VALUE_PARSERS.items():
        value = values.get(field)
        if field == "tolerance" and typed_component == "crystal":
            parser = parse_crystal_tolerance_percent
        if value is not None and parser(value) is None:
            issues.append(
                SearchRequirementIssue(
                    field=field,
                    code="invalid_value",
                    message=f"{field} 값을 전기 단위와 함께 해석할 수 없습니다.",
                )
            )
    pitch = values.get("pitch")
    if pitch is not None:
        match = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*", str(pitch), re.I)
        if match is None or float(match.group(1).replace(",", ".")) <= 0:
            issues.append(
                SearchRequirementIssue(
                    field="pitch",
                    code="invalid_value",
                    message="pitch 값은 양수 mm 단위로 입력해야 합니다.",
                )
            )
    return issues


def validate_user_search_requirements(
    payload: Mapping[str, Any],
) -> SearchRequirementValidationResult:
    """Pydantic 전송 형식과 엔진 기술 정책을 분리해 모든 오류를 반환한다."""

    try:
        shaped = UserSearchRequirements.model_validate(
            payload,
            context={"skip_requirement_policy": True},
        )
    except ValidationError as error:
        issues = [
            SearchRequirementIssue(
                field=".".join(str(part) for part in item["loc"]) or "requirements",
                code="invalid_shape",
                message=str(item["msg"]),
            )
            for item in error.errors()
        ]
        return SearchRequirementValidationResult(valid=False, errors=issues)
    issues = search_requirement_issues(shaped)
    if issues:
        return SearchRequirementValidationResult(valid=False, errors=issues)
    validated = UserSearchRequirements.model_validate(shaped.model_dump(mode="python"))
    return SearchRequirementValidationResult(valid=True, requirements=validated)


def search_requirement_capabilities() -> dict[str, object]:
    """UI/어댑터가 기술 정책을 복제하지 않도록 제공하는 읽기 전용 계약."""

    return {
        "policy_version": SEARCH_REQUIREMENT_POLICY_VERSION,
        "component_types": {
            component_type: {
                "required_fields": list(required),
                "optional_fields": sorted(
                    _SEARCH_REQUIREMENT_ALLOWED[component_type]
                    - set(required)
                    | {"mount_style"}
                    | ({"package"} if "package" not in required else set())
                ),
                "conditional_required": [
                    {
                        "when": dict(rule["when"]),
                        "required": list(rule["required"]),
                    }
                    for rule in _SEARCH_REQUIREMENT_CONDITIONAL.get(
                        component_type, ()
                    )
                ],
            }
            for component_type, required in _SEARCH_REQUIREMENT_REQUIRED.items()
        },
    }


class PassiveRequirementDefaults(BaseModel):
    """견적 단위로 한 번 승인한 저항·MLCC 누락 조건의 보수적 기본값."""

    model_config = ConfigDict(extra="forbid")

    version: Literal["passive-requirement-defaults-v1"] = (
        "passive-requirement-defaults-v1"
    )
    resistor_tolerance: str = Field(min_length=1, max_length=64)
    capacitor_tolerance: str = Field(min_length=1, max_length=64)
    capacitor_voltage: str = Field(min_length=1, max_length=64)
    capacitor_dielectric_policy: Literal["capacitance-aware-conservative"] = (
        "capacitance-aware-conservative"
    )


class SearchComponentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str
    source_file: str
    sheet_name: str
    sheet_index_0based: int
    source_rows_1based: list[int]
    reference_designators: list[str] = Field(default_factory=list)
    description: str | None = None
    value_raw: str | None = None
    footprint: str | None = None
    review_status: str
    quality_flags: list[str] = Field(default_factory=list)
    input_alternatives: dict[str, list[SearchFieldAlternative]] = Field(
        default_factory=dict
    )
    search_disposition: SearchDisposition = SearchDisposition.SEARCH
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    disposition_reason_codes: list[str] = Field(default_factory=list)
    quantity_resolution: QuantityResolution = QuantityResolution.VERIFIED
    reference_count: int | None = Field(default=None, ge=0)
    impedance_ohm: float | None = None
    impedance_frequency_hz: float | None = None
    dc_resistance_max_ohm: float | None = None
    absolute_tolerance_h: float | None = None
    color: str | None = None
    pin_count: int | None = Field(default=None, ge=1)
    row_count: int | None = Field(default=None, ge=1)
    pitch_mm: float | None = Field(default=None, gt=0)
    body_dimensions_mm: list[float] | None = None
    required_quantity: int | None = Field(default=None, ge=1)
    user_requirements: UserSearchRequirements | None = None
    requirement_defaults: PassiveRequirementDefaults | None = None
    fields: dict[str, SearchField]


_GUIDANCE_CATEGORY_TYPES: dict[str, SearchRequirementComponentType] = {
    "resistor": "resistor",
    "capacitor": "capacitor",
    "electrolytic": "capacitor",
    "tantalum": "capacitor",
    "film": "capacitor",
    "inductor": "inductor",
    "ferrite": "inductor",
    "diode": "diode",
    "transistor": "transistor",
    "led": "led",
    "crystal": "crystal",
    "connector": "connector",
    "switch": "switch",
}


def _guidance_decimal(value: float) -> str:
    return f"{value:.12f}".rstrip("0").rstrip(".") or "0"


def _guidance_scaled_value(
    value: float,
    *,
    unit: str,
    scales: tuple[tuple[float, str], ...] = (),
) -> str:
    absolute = abs(value)
    for scale, prefix in (item for item in scales if item[0] >= 1):
        if absolute >= scale:
            return f"{_guidance_decimal(value / scale)}{prefix}{unit}"
    if absolute >= 1:
        return f"{_guidance_decimal(value)}{unit}"
    for scale, prefix in (item for item in scales if item[0] < 1):
        if absolute >= scale:
            return f"{_guidance_decimal(value / scale)}{prefix}{unit}"
    return f"{_guidance_decimal(value)}{unit}"


def _guidance_electrical_value(field_name: str, field: SearchField) -> Any:
    normalized = field.normalized_value
    if (
        isinstance(normalized, (int, float))
        and not isinstance(normalized, bool)
        and math.isfinite(float(normalized))
    ):
        value = float(normalized)
        parsed = _SEARCH_REQUIREMENT_VALUE_PARSERS[field_name](field.value)
        if parsed is None or not math.isclose(
            float(parsed),
            value,
            rel_tol=1e-9,
            abs_tol=1e-18,
        ):
            formatters = {
                "resistance": lambda number: _guidance_scaled_value(
                    number,
                    unit="Ω",
                    scales=((1e6, "M"), (1e3, "k"), (1e-3, "m")),
                ),
                "capacitance": lambda number: _guidance_scaled_value(
                    number,
                    unit="F",
                    scales=((1e-3, "m"), (1e-6, "u"), (1e-9, "n"), (1e-12, "p")),
                ),
                "inductance": lambda number: _guidance_scaled_value(
                    number,
                    unit="H",
                    scales=((1e-3, "m"), (1e-6, "u"), (1e-9, "n"), (1e-12, "p")),
                ),
                "frequency": lambda number: _guidance_scaled_value(
                    number,
                    unit="Hz",
                    scales=((1e9, "G"), (1e6, "M"), (1e3, "k")),
                ),
                "tolerance": lambda number: f"{_guidance_decimal(number)}%",
                "voltage": lambda number: f"{_guidance_decimal(number)}V",
                "current": lambda number: f"{_guidance_decimal(number)}A",
                "power": lambda number: f"{_guidance_decimal(number)}W",
            }
            return formatters[field_name](value)
    return field.value


def _guidance_component_type(
    component: SearchComponentInput,
    query: PlannedQuery,
) -> SearchRequirementComponentType | None:
    if component.user_requirements is not None:
        return component.user_requirements.component_type
    # ``film``은 capacitor taxonomy에도 쓰이지만, 계획이 이미 resistor로
    # 확정됐다면 명시 부품 유형이 상위 근거다. category_policy가 이를
    # capacitor로 뒤집으면 Thick Film 저항의 보완 폼이 잘못 표시된다.
    if query.part_type in _GUIDANCE_CATEGORY_TYPES:
        return _GUIDANCE_CATEGORY_TYPES[query.part_type]
    if query.category_policy in _GUIDANCE_CATEGORY_TYPES:
        return _GUIDANCE_CATEGORY_TYPES[query.category_policy]
    raw_type = component.fields.get("part_type")
    text = " ".join(
        str(value).casefold()
        for value in (
            raw_type.value if raw_type is not None else None,
            component.description,
            component.value_raw,
        )
        if value is not None
    )
    for component_type, pattern in (
        ("resistor", r"\bresistor\b|저항"),
        ("capacitor", r"\bcapaci(?:tor|tance)\b|커패시터|콘덴서"),
        ("inductor", r"\binductor\b|\bferrite\b|\bbead\b|인덕터|비드"),
        ("transistor", r"\btransistor\b|\bmosfet\b|\bfet\b|트랜지스터"),
        ("led", r"\bled\b|발광다이오드"),
        ("diode", r"\bdiode\b|다이오드"),
        ("crystal", r"\bcrystal\b|\boscillator\b|\bresonator\b|크리스털|발진기"),
        ("connector", r"\bconnector\b|\bheader\b|\bsocket\b|커넥터"),
        ("switch", r"\bswitch\b|스위치"),
    ):
        if re.search(pattern, text, re.I):
            return component_type
    return None


def _guidance_subtype_values(
    component_type: SearchRequirementComponentType,
    component: SearchComponentInput,
    query: PlannedQuery,
) -> dict[str, Any]:
    text = " ".join(
        str(value)
        for value in (
            component.fields["part_type"].value,
            component.description,
            component.value_raw,
        )
        if value is not None
    )
    if component_type == "capacitor":
        capacitor_type = {
            "capacitor": "ceramic",
            "electrolytic": "electrolytic",
            "tantalum": "tantalum",
            "film": "film",
        }.get(query.category_policy or "")
        return {"capacitor_type": capacitor_type} if capacitor_type else {}
    if component_type == "inductor":
        return {
            "inductor_type": (
                "ferrite" if query.category_policy == "ferrite" else "standard"
            )
        }
    if component_type == "diode":
        diode_type = next(
            (
                value
                for value, pattern in (
                    ("tvs", r"\btvs\b"),
                    ("zener", r"\bzener\b|제너"),
                    ("schottky", r"\bschottky\b|쇼트키"),
                    ("photodiode", r"\bphoto\s*diode\b|포토다이오드"),
                    ("signal", r"\bsignal\b"),
                    ("rectifier", r"\brectifier\b|정류"),
                )
                if re.search(pattern, text, re.I)
            ),
            None,
        )
        return {"diode_type": diode_type} if diode_type else {}
    if component_type == "transistor":
        transistor_type = (
            "mosfet"
            if re.search(r"\b(?:mosfet|fet)\b", text, re.I)
            else "bjt"
            if re.search(r"\b(?:bjt|transistor)\b|트랜지스터", text, re.I)
            else None
        )
        polarity = next(
            (
                value
                for value, pattern in (
                    ("p-channel", r"\bp[- ]?channel\b"),
                    ("n-channel", r"\bn[- ]?channel\b"),
                    ("pnp", r"\bpnp\b"),
                    ("npn", r"\bnpn\b"),
                )
                if re.search(pattern, text, re.I)
            ),
            None,
        )
        return {
            key: value
            for key, value in (
                ("transistor_type", transistor_type),
                ("polarity", polarity),
            )
            if value is not None
        }
    if component_type == "crystal":
        return {
            "crystal_type": (
                "oscillator"
                if re.search(r"\boscillator\b|발진기", text, re.I)
                else "resonator"
                if re.search(r"\bresonator\b|공진기", text, re.I)
                else "crystal"
            )
        }
    if component_type == "switch":
        switch_type = next(
            (
                value
                for value in (
                    "tactile",
                    "pushbutton",
                    "slide",
                    "toggle",
                    "dip",
                    "rotary",
                    "reed",
                )
                if re.search(rf"\b{value}\b", text, re.I)
            ),
            None,
        )
        return {"switch_type": switch_type} if switch_type else {}
    return {}


def search_requirement_guidance(
    component: SearchComponentInput,
    query: PlannedQuery,
) -> SearchRequirementGuidance:
    """추출·계획 결과에서 UI가 재판정 없이 소비할 검색 준비 상태를 만든다."""

    component_type = _guidance_component_type(component, query)
    if component.user_requirements is not None:
        values = component.user_requirements.model_dump(
            mode="python",
            exclude={"version", "component_type"},
            exclude_none=True,
        )
    else:
        values = {
            field: _guidance_electrical_value(field, component.fields[field])
            for field in (
                "resistance",
                "capacitance",
                "inductance",
                "frequency",
                "tolerance",
                "voltage",
                "current",
                "power",
            )
            if component.fields[field].value is not None
        }
        if component.fields["package"].value is not None:
            values["package"] = component.fields["package"].value
        if query.package is not None:
            values["package"] = query.package
        for field, value in (
            (
                "impedance",
                (
                    _guidance_scaled_value(
                        component.impedance_ohm,
                        unit="Ω",
                        scales=((1e6, "M"), (1e3, "k"), (1e-3, "m")),
                    )
                    if component.impedance_ohm is not None
                    else None
                ),
            ),
            (
                "impedance_frequency",
                (
                    _guidance_scaled_value(
                        component.impedance_frequency_hz,
                        unit="Hz",
                        scales=((1e9, "G"), (1e6, "M"), (1e3, "k")),
                    )
                    if component.impedance_frequency_hz is not None
                    else None
                ),
            ),
            ("color", component.color),
            ("pin_count", component.pin_count),
            ("row_count", component.row_count),
            (
                "pitch",
                (
                    f"{component.pitch_mm:g}mm"
                    if component.pitch_mm is not None
                    else None
                ),
            ),
        ):
            if value is not None:
                values[field] = value
        if component_type is not None:
            values.update(_guidance_subtype_values(component_type, component, query))

    if component_type is not None:
        applicable_fields = _SEARCH_REQUIREMENT_ALLOWED[component_type] | {
            "package",
            "mount_style",
        }
        values = {
            field: value
            for field, value in values.items()
            if field in applicable_fields
        }
    required = (
        required_search_requirement_fields(component_type, values)
        if component_type is not None
        else []
    )
    missing = [
        field
        for field in required
        if values.get(field) is None or values.get(field) == ""
    ]
    readiness = (
        "excluded"
        if query.mode == SearchMode.EXCLUDED
        else "needs_user_input"
        if query.mode == SearchMode.INSUFFICIENT
        else "searchable"
    )
    return SearchRequirementGuidance(
        component_type=component_type,
        readiness=readiness,
        required_fields=required,
        missing_fields=missing,
        values=values,
    )


class SearchBatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search_contract_version: str = SEARCH_CONTRACT_VERSION
    parser_schema_version: str
    parser_version: str
    training_fingerprint: str
    runtime_dependency_fingerprint: str | None = None
    source_file: str
    components: list[SearchComponentInput]
    procurement_policy: ProcurementPolicyInput = Field(
        default_factory=ProcurementPolicyInput
    )


def _component_id(source_file: str, sheet_index: int, rows: list[int]) -> str:
    raw = f"{source_file}\0{sheet_index}\0{','.join(map(str, rows))}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:24]


def _field(component: dict[str, Any], name: str) -> SearchField:
    """field_states 항목 → SearchField, including extraction provenance."""
    states = component.get("field_states") or {}
    state = states.get(name) or {}
    value = state.get("value", (component.get("raw_fields") or {}).get(name))
    status = state.get("status") or ("review" if value is not None else "not_found")
    if status not in {"extracted", "review", "not_found"}:
        status = "review" if value is not None else "not_found"
    evidence = [
        SearchEvidence.model_validate(item) for item in state.get("evidence") or []
    ]
    normalized_name = _NORMALIZED_FIELD_NAMES.get(name)
    normalized_value = component.get(normalized_name) if normalized_name else None
    return SearchField(
        value=value,
        normalized_value=normalized_value,
        status=status,
        evidence=evidence,
        source=(
            state.get("source")
            if state.get("source") in {"col", "text", "infer"}
            else None
        ),
    )


def _required_quantity(component: dict[str, Any]) -> int | None:
    value = _field(component, "quantity").value
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def build_batch_from_result(
    result: dict[str, Any],
    *,
    source_file: str | None = None,
    sheet_indexes: set[int] | None = None,
) -> SearchBatchInput:
    """SMARTBOM 공개 결과(G-shape AnalysisResult dict) → 검색 배치 계약.

    - components는 flat 리스트 — not_bom/error 시트의 행은 애초에 없어
      자연 제외된다. DNP/PCB feature/customer-supplied 행도 감사 계보를
      위해 보존하되 search_disposition=excluded로 공급사 호출을 막는다.
    - component_id는 /g와 동일 규칙(sha256[:24]) — 같은 시트·같은 행
      조합이면 동일 id가 나오는 것도 /g와 같은 기존 특성이다.
    - training_fingerprint는 규칙 엔진이라 학습 지문이 없어
      parser_version으로 합성한다(검색 엔진 내부에서 미사용 — 스키마
      필수 필드 충족 목적).
    """
    display = str(source_file or result.get("source_file") or "")
    components: list[SearchComponentInput] = []
    for component in result.get("components") or []:
        sheet_index = int(component["sheet_index_0based"])
        if sheet_indexes is not None and sheet_index not in sheet_indexes:
            continue
        rows = [int(row) for row in component.get("source_rows_1based") or []]
        quality_flags = list(component.get("quality_flags") or [])
        legacy_excluded = "do_not_populate" in quality_flags
        search_disposition = SearchDisposition(
            component.get("search_disposition")
            or ("excluded" if legacy_excluded else "search")
        )
        quantity_resolution = QuantityResolution(
            component.get("quantity_resolution")
            or ("missing" if component.get("quantity") is None else "verified")
        )
        procurement_disposition = ProcurementDisposition(
            component.get("procurement_disposition")
            or (
                "excluded"
                if search_disposition == SearchDisposition.EXCLUDED
                else "quantity_confirmation_required"
                if quantity_resolution != QuantityResolution.VERIFIED
                else "eligible"
            )
        )
        disposition_reason_codes = list(
            component.get("disposition_reason_codes")
            or (["do_not_populate"] if legacy_excluded else [])
        )
        required_quantity = (
            _required_quantity(component)
            if procurement_disposition == ProcurementDisposition.ELIGIBLE
            and quantity_resolution == QuantityResolution.VERIFIED
            else None
        )
        components.append(
            SearchComponentInput(
                component_id=_component_id(display, sheet_index, rows),
                source_file=display,
                sheet_name=str(component["sheet_name"]),
                sheet_index_0based=sheet_index,
                source_rows_1based=rows,
                reference_designators=list(
                    component.get("reference_designators") or []
                ),
                description=component.get("description"),
                value_raw=component.get("value_raw"),
                footprint=component.get("footprint"),
                review_status=str(component.get("review_status") or "review"),
                quality_flags=quality_flags,
                input_alternatives={
                    str(name): [
                        SearchFieldAlternative.model_validate(item)
                        for item in alternatives
                    ]
                    for name, alternatives in (
                        component.get("input_alternatives") or {}
                    ).items()
                },
                search_disposition=search_disposition,
                procurement_disposition=procurement_disposition,
                disposition_reason_codes=disposition_reason_codes,
                quantity_resolution=quantity_resolution,
                reference_count=component.get("reference_count"),
                impedance_ohm=component.get("impedance_ohm"),
                impedance_frequency_hz=component.get("impedance_frequency_hz"),
                dc_resistance_max_ohm=component.get("dc_resistance_max_ohm"),
                absolute_tolerance_h=component.get("absolute_tolerance_h"),
                color=component.get("color"),
                pin_count=component.get("pin_count"),
                row_count=component.get("row_count"),
                pitch_mm=component.get("pitch_mm"),
                body_dimensions_mm=component.get("body_dimensions_mm"),
                required_quantity=required_quantity,
                fields={name: _field(component, name) for name in VALUE_FIELDS},
            )
        )
    summary = result.get("summary") or {}
    parser_version = str(
        summary.get("parser_version")
        or result.get("parser_version")
        or "smartbom/unknown"
    )
    return SearchBatchInput(
        parser_schema_version=str(result.get("schema_version") or "1.0"),
        parser_version=parser_version,
        training_fingerprint=f"smartbom:{parser_version}",
        runtime_dependency_fingerprint=None,
        source_file=display,
        components=components,
    )
