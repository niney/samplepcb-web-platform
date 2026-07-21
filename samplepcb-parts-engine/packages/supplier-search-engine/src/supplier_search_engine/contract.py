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

from pydantic import BaseModel, ConfigDict, Field

from .models import ProcurementPolicyInput

SEARCH_CONTRACT_VERSION = "1.1"
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
    required_quantity: int | None = Field(default=None, ge=1)
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
    """field_states 항목 → SearchField. value/status/evidence 키만 취하므로
    smartbom이 덧붙이는 `source` 키는 자연히 걸러진다."""
    states = component.get("field_states") or {}
    state = states.get(name) or {}
    value = state.get("value", (component.get("raw_fields") or {}).get(name))
    status = state.get("status") or ("review" if value is not None else "not_found")
    if status not in {"extracted", "review", "not_found"}:
        status = "review" if value is not None else "not_found"
    evidence = [SearchEvidence.model_validate(item) for item in state.get("evidence") or []]
    normalized_name = _NORMALIZED_FIELD_NAMES.get(name)
    normalized_value = component.get(normalized_name) if normalized_name else None
    return SearchField(
        value=value,
        normalized_value=normalized_value,
        status=status,
        evidence=evidence,
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
      자연 제외된다. 컴포넌트 0건 배치도 유효하다(preflight 0 call).
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
        components.append(
            SearchComponentInput(
                component_id=_component_id(display, sheet_index, rows),
                source_file=display,
                sheet_name=str(component["sheet_name"]),
                sheet_index_0based=sheet_index,
                source_rows_1based=rows,
                reference_designators=list(component.get("reference_designators") or []),
                description=component.get("description"),
                value_raw=component.get("value_raw"),
                review_status=str(component.get("review_status") or "review"),
                quality_flags=list(component.get("quality_flags") or []),
                required_quantity=_required_quantity(component),
                fields={name: _field(component, name) for name in VALUE_FIELDS},
            )
        )
    summary = result.get("summary") or {}
    parser_version = str(
        summary.get("parser_version") or result.get("parser_version") or "smartbom/unknown")
    return SearchBatchInput(
        parser_schema_version=str(result.get("schema_version") or "1.0"),
        parser_version=parser_version,
        training_fingerprint=f"smartbom:{parser_version}",
        runtime_dependency_fingerprint=None,
        source_file=display,
        components=components,
    )
