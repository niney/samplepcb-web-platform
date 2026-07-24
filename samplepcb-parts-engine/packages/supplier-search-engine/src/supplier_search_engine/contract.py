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
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import (
    ProcurementDisposition,
    ProcurementPolicyInput,
    QuantityResolution,
    SearchDisposition,
)

SEARCH_CONTRACT_VERSION = "1.2"
FieldStatus = Literal["extracted", "review", "not_found"]

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
    TCR은 v1 범위에서 의도적으로 제외한다.
    """

    model_config = ConfigDict(extra="forbid")

    version: Literal["bom-user-search-requirements-v1"] = (
        "bom-user-search-requirements-v1"
    )
    component_type: Literal["resistor", "capacitor"]
    capacitor_type: Literal["ceramic", "electrolytic", "tantalum", "film"] | None = None
    resistance: str | None = Field(default=None, min_length=1, max_length=64)
    capacitance: str | None = Field(default=None, min_length=1, max_length=64)
    package: str = Field(min_length=1, max_length=64)
    tolerance: str | None = Field(default=None, min_length=1, max_length=64)
    voltage: str | None = Field(default=None, min_length=1, max_length=64)
    power: str | None = Field(default=None, min_length=1, max_length=64)
    dielectric: str | None = Field(default=None, min_length=1, max_length=32)
    mount_style: Literal["smd", "through-hole"] | None = None

    @model_validator(mode="after")
    def validate_component_requirements(self) -> "UserSearchRequirements":
        if self.component_type == "resistor":
            if self.resistance is None:
                raise ValueError("resistance is required for resistor search")
            if self.capacitance is not None or self.capacitor_type is not None:
                raise ValueError("capacitor fields are not valid for resistor search")
            if self.voltage is not None or self.dielectric is not None:
                raise ValueError("capacitor ratings are not valid for resistor search")
        else:
            if self.capacitance is None:
                raise ValueError("capacitance is required for capacitor search")
            if self.capacitor_type is None:
                raise ValueError("capacitor_type is required for capacitor search")
            if self.resistance is not None or self.power is not None:
                raise ValueError("resistor fields are not valid for capacitor search")
            if self.capacitor_type != "ceramic" and self.dielectric is not None:
                raise ValueError("dielectric is only valid for ceramic capacitors")
        return self


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
