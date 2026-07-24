# -*- coding: utf-8 -*-
"""SMARTBOM 결과 계약 — G-shape(AnalysisResult)의 명문화.

준거는 frontend/src/types/index.ts(ComponentRecord/HeaderMapping/
SheetSummary/AnalysisResult)와 local_engine의 키셋 관례다.

엔진 핫패스는 dict를 그대로 만들고 API도 raw JSON을 서빙한다(직렬화
오버헤드 회피). 이 모델은 ① 실행 가능한 스키마 문서, ② 테스트에서
엔진 출력을 model_validate로 검증하는 회귀망으로 쓴다 — 어댑터가
키를 빠뜨리거나 타입을 바꾸면 계약 테스트가 잡는다.
"""
from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict

RawValue = Union[str, int, None]


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cell: str          # 원본 열 기준 A1 좌표 (예: "C12")
    raw_value: str
    supports: str      # 이 셀이 근거하는 필드명


class FieldState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: RawValue = None
    status: Literal["extracted", "review", "not_found"]
    evidence: List[Evidence] = []
    source: Optional[Literal["col", "text", "infer"]] = None


class Attribute(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    raw_value: RawValue = None
    normalized_value: Union[float, str, None] = None
    unit: Optional[str] = None
    evidence: List[Evidence] = []


class FieldAlternative(BaseModel):
    """One independently observed value retained when source cells disagree."""

    model_config = ConfigDict(extra="forbid")

    raw_value: str
    normalized_value: Union[float, str, None] = None
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


class RowShapeEvidence(BaseModel):
    """가변 폭 행의 원본 구조와 결정적 복구 계보."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["recovered", "invalid"]
    source_width: int
    expected_width: int
    merged_column_1based: Optional[int] = None
    merged_fragment_count: Optional[int] = None
    source_cells: List[str]
    repaired_cells: Optional[List[str]] = None


class ComponentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file: str
    sheet_name: str
    sheet_index_0based: int
    source_rows_1based: List[int]
    component_type: Optional[str] = None
    part_number: Optional[str] = None
    supplier_part_numbers: List[str] = []
    internal_part_numbers: List[str] = []
    library_identifiers: List[str] = []
    manufacturer: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[int] = None
    reference_count: Optional[int] = None
    quantity_resolution: Literal["verified", "conflict", "missing"]
    search_disposition: Literal["search", "excluded"]
    procurement_disposition: Literal[
        "eligible", "excluded", "quantity_confirmation_required"
    ]
    disposition_reason_codes: List[str]
    reference_designators: List[str]
    package: Optional[str] = None
    footprint: Optional[str] = None
    value_raw: Optional[str] = None
    raw_fields: Dict[str, RawValue]
    input_alternatives: Dict[str, List[FieldAlternative]]
    field_states: Dict[str, FieldState]
    evidence: List[Evidence]
    uncertain_fields: List[str]
    quality_flags: List[str]
    review_status: Literal["extracted", "review"]
    resistance_ohm: Optional[float] = None
    capacitance_f: Optional[float] = None
    inductance_h: Optional[float] = None
    power_w: Optional[float] = None
    tolerance_percent: Optional[float] = None
    absolute_tolerance_h: Optional[float] = None
    impedance_ohm: Optional[float] = None
    impedance_frequency_hz: Optional[float] = None
    dc_resistance_max_ohm: Optional[float] = None
    color: Optional[str] = None
    pin_count: Optional[int] = None
    row_count: Optional[int] = None
    pitch_mm: Optional[float] = None
    body_dimensions_mm: Optional[List[float]] = None
    row_shape: Optional[RowShapeEvidence] = None
    voltage_v: Optional[float] = None
    current_a: Optional[float] = None
    frequency_hz: Optional[float] = None
    temperature_min_c: Optional[float] = None
    temperature_max_c: Optional[float] = None
    size_code: Optional[str] = None
    attributes: List[Attribute]
    evidence_exact_rate: Optional[float] = None
    part_number_supported: Optional[bool] = None
    confidence: Optional[float] = None  # 근거 확보 필드가 없으면 키 자체 생략


class HeaderMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file: str
    sheet_name: str
    header_rows_1based: List[int]
    column_1based: int
    raw_header: str
    semantic_field: str
    confidence: float
    source: Literal["rule", "local_model"]


class SheetSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sheet_index_0based: int
    sheet_name: str
    status: Literal["parsed", "not_bom", "error"]
    component_count: int
    column_count: int
    header_rows_1based: List[int]
    header_labels: List[str]
    warnings: List[str]
    unparsed_reason: Optional[str] = None


class FailureRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file: str
    sheet_name: str
    status: str
    reason: Optional[str] = None


class Summary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sheet_count: int
    parsed_sheet_count: int
    header_not_found_sheet_count: int
    component_count: int
    header_mapping_count: int
    review_component_count: int
    failure_count: int
    field_status_counts: Dict[str, int]
    sheet_status_counts: Dict[str, int]
    processing_ms: float
    parser_version: str
    header_embedding: str  # unloaded | local | hub | disabled | failed


class AnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str
    engine: Literal["smartbom"]
    model: Optional[str] = None
    prompt_version: Optional[str] = None
    parser_version: str
    source_file: str
    summary: Summary
    sheets: List[SheetSummary]
    components: List[ComponentRecord]
    headers: List[HeaderMapping]
    failures: List[FailureRecord]
