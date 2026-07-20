from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Supplier(StrEnum):
    DIGIKEY = "digikey"
    MOUSER = "mouser"
    UNIKEYIC = "unikeyic"


class SearchMode(StrEnum):
    IDENTITY = "identity"
    HYBRID = "hybrid"
    PARAMETRIC = "parametric"
    INSUFFICIENT = "insufficient"


class MatchStatus(StrEnum):
    VERIFIED_EXACT = "verified_exact"
    VERIFIED_VARIANT = "verified_variant"
    SPEC_COMPATIBLE = "spec_compatible"
    SPEC_PARTIAL = "spec_partial"
    AMBIGUOUS = "ambiguous"
    INPUT_CONFLICT = "input_conflict"
    NOT_FOUND = "not_found"
    SUPPLIER_ERROR = "supplier_error"
    INSUFFICIENT_INPUT = "insufficient_input"


class SelectionEligibility(StrEnum):
    AUTOMATIC = "automatic"
    MANUAL_REVIEW = "manual_review"
    BLOCKED = "blocked"


class CandidateSelectionMode(StrEnum):
    EXACT = "exact"
    VARIANT = "variant"
    SPEC_COMPATIBLE = "spec-compatible"
    REVIEW = "review"


class LifecycleState(StrEnum):
    ACTIVE = "active"
    CAUTION = "caution"
    UNKNOWN = "unknown"


class Requirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    raw_value: Any
    normalized_value: float | str | list[float | None] | None = None
    status: Literal["extracted", "review", "not_found"]
    hard: bool
    comparison: Literal["eq", "gte", "lte", "contains", "category"] = "eq"


class PlannedQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str
    mode: SearchMode
    part_number: str | None = None
    manufacturer: str | None = None
    description: str | None = None
    part_type: str | None = None
    package: str | None = None
    quantity: int | None = None
    keywords: str = ""
    requirements: dict[str, Requirement] = Field(default_factory=dict)
    site: str = "KR"
    language: str = "ko"
    currency: str = "KRW"
    limit: int = 20

    def cache_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"component_id"}, exclude_none=True)


class PriceBreak(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantity: int
    unit_price: float
    currency: str


class SupplierOffer(BaseModel):
    model_config = ConfigDict(extra="allow")

    supplier: Supplier
    supplier_sku: str | None = None
    packaging: str | None = None
    stock: int | None = None
    moq: int | None = None
    order_multiple: int | None = None
    price_breaks: list[PriceBreak] = Field(default_factory=list)
    lead_time: str | None = None
    product_url: str | None = None
    fetched_at: datetime = Field(default_factory=utc_now)


class SupplierProduct(BaseModel):
    model_config = ConfigDict(extra="allow")

    supplier: Supplier
    supplier_product_id: str | None = None
    manufacturer_part_number: str
    manufacturer: str | None = None
    description: str | None = None
    category: str | None = None
    package: str | None = None
    lifecycle_status: str | None = None
    discontinued: bool | None = None
    end_of_life: bool | None = None
    datasheet_url: str | None = None
    image_url: str | None = None
    normalized_specs: dict[str, float | str | list[float | None] | None] = Field(
        default_factory=dict
    )
    attributes: dict[str, Any] = Field(default_factory=dict)
    offers: list[SupplierOffer] = Field(default_factory=list)


class PackageComparison(BaseModel):
    """Backend-owned package equivalence and display decision."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["match", "mismatch", "missing", "neutral"]
    relation: Literal[
        "exact", "alias", "compatible", "mismatch", "missing", "unverified"
    ]
    expected_display: str | None = None
    expected_raw: str | None = None
    actual_display: str | None = None
    actual_raw: str | None = None


class SpecComparison(BaseModel):
    """Backend-owned semantic comparison for a normalized component specification."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["match", "mismatch", "missing", "neutral"]
    relation: Literal[
        "exact",
        "alias",
        "contains",
        "conditional",
        "mismatch",
        "missing",
        "unverified",
    ]
    expected_display: str | None = None
    expected_raw: str | None = None
    expected_detail: str | None = None
    actual_display: str | None = None
    actual_raw: str | None = None
    actual_detail: str | None = None


class RawSupplierResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier: Supplier
    ok: bool
    status_code: int | None = None
    payload: dict[str, Any] | None = None
    error_type: str | None = None
    error_message: str | None = None
    fetched_at: datetime = Field(default_factory=utc_now)
    latency_ms: float = 0.0


class SupplierSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier: Supplier
    products: list[SupplierProduct] = Field(default_factory=list)
    error_type: str | None = None
    error_message: str | None = None
    cache_state: Literal["miss", "fresh", "stale", "coalesced"] = "miss"
    cache_age_seconds: float | None = None
    source_latency_ms: float | None = None
    source_fetched_at: datetime | None = None
    operation_elapsed_ms: float = 0.0
    api_call_performed: bool = False
    api_calls: int = 0


class CandidateDecision(BaseModel):
    """Engine-owned technical eligibility and grouping decision."""

    model_config = ConfigDict(extra="forbid")

    policy_version: str = "supplier-candidate-decision-v1"
    selection_eligibility: SelectionEligibility = SelectionEligibility.BLOCKED
    selection_mode: CandidateSelectionMode = CandidateSelectionMode.REVIEW
    auto_eligible: bool = False
    manual_selectable: bool = False
    reason_codes: list[str] = Field(default_factory=lambda: ["decision_unavailable"])
    identity_key: str = ""
    technical_evidence_key: str = ""
    verified_requirement_count: int = Field(default=0, ge=0)
    required_requirement_count: int = Field(default=0, ge=0)
    verification_complete: bool = False
    strict_category_coverage: bool = False
    lifecycle_state: LifecycleState = LifecycleState.UNKNOWN


class CandidateMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product: SupplierProduct
    status: MatchStatus
    identity_confidence: float
    specification_confidence: float
    conflicts: list[str] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    corroborating_suppliers: list[Supplier] = Field(default_factory=list)
    package_comparison: PackageComparison | None = None
    spec_comparisons: dict[str, SpecComparison] = Field(default_factory=dict)
    decision: CandidateDecision = Field(default_factory=CandidateDecision)


class InputCorrection(BaseModel):
    """Non-destructive correction suggested by independent supplier evidence."""

    model_config = ConfigDict(extra="forbid")

    field: Literal["part_type"]
    bom_value: str
    suggested_value: str
    bom_error_probability: float = Field(ge=0.0, le=1.0)
    confidence_method: Literal["independent_supplier_consensus_v1"] = (
        "independent_supplier_consensus_v1"
    )
    evidence_suppliers: list[Supplier] = Field(default_factory=list)
    evidence_count: int = Field(ge=2)
    reasons: list[str] = Field(default_factory=list)
    auto_applied: bool = False


class ComponentSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str
    mode: SearchMode
    status: MatchStatus
    reference_designators: list[str] = Field(default_factory=list)
    source_rows_1based: list[int] = Field(default_factory=list)
    query: PlannedQuery | None = None
    initial_query: PlannedQuery | None = None
    identity_fallback: bool = False
    candidates: list[CandidateMatch] = Field(default_factory=list)
    input_corrections: list[InputCorrection] = Field(default_factory=list)
    supplier_results: list[SupplierSearchResult] = Field(default_factory=list)
    initial_supplier_results: list[SupplierSearchResult] = Field(default_factory=list)
    api_calls: int = 0
    elapsed_ms: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class BatchSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search_schema_version: str = "1.2"
    source_file: str
    components: list[ComponentSearchResult]
    unique_query_count: int
    api_calls: int
    cache_hits: int
    prefetched_requests: int = 0
    elapsed_ms: float = 0.0
    created_at: datetime = Field(default_factory=utc_now)


class SupplierPreflight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier: Supplier
    configured: bool
    request_key: str | None = None
    shared_component_count: int = 1
    batch_size: int = 1
    cache_state: Literal["miss", "fresh", "stale"] = "miss"
    cache_age_seconds: float | None = None
    will_call_api: bool = False
    estimated_api_calls: int = 0
    retry_worst_case_api_calls: int = 0
    usable_without_api: bool = False
    reason: str


class ComponentPreflight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str
    mode: SearchMode
    reference_designators: list[str] = Field(default_factory=list)
    source_rows_1based: list[int] = Field(default_factory=list)
    part_number: str | None = None
    manufacturer: str | None = None
    keywords: str = ""
    suppliers: list[SupplierPreflight] = Field(default_factory=list)
    fallback_mode: SearchMode | None = None
    fallback_keywords: str | None = None
    fallback_suppliers: list[SupplierPreflight] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SupplierBudgetProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier: Supplier
    daily_used: int
    daily_limit: int | None = None
    daily_remaining: int | None = None
    minute_used: int
    minute_limit: int | None = None
    minute_remaining: int | None = None
    estimated_calls: int
    retry_worst_case_calls: int
    estimated_within_limits: bool
    retry_worst_case_within_limits: bool


class BatchPreflight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preflight_schema_version: str = "1.0"
    source_file: str
    component_count: int
    unique_query_count: int
    unique_supplier_request_count: int
    estimated_api_calls: int
    retry_worst_case_api_calls: int
    job_call_limit: int
    estimated_within_job_limit: bool
    retry_worst_case_within_job_limit: bool
    cache_only: bool
    fresh_cache_requests: int
    stale_cache_requests: int
    uncallable_requests: int
    supplier_budgets: list[SupplierBudgetProjection] = Field(default_factory=list)
    components: list[ComponentPreflight] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
