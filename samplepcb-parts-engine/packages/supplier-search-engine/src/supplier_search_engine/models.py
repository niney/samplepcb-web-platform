from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


OfferKeyVersion = Literal["supplier-offer-key-v1", "supplier-offer-key-v2"]


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
    EXCLUDED = "excluded"


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
    EXCLUDED = "excluded"


class SearchDisposition(StrEnum):
    SEARCH = "search"
    EXCLUDED = "excluded"


class ProcurementDisposition(StrEnum):
    ELIGIBLE = "eligible"
    EXCLUDED = "excluded"
    QUANTITY_CONFIRMATION_REQUIRED = "quantity_confirmation_required"


class QuantityResolution(StrEnum):
    VERIFIED = "verified"
    CONFLICT = "conflict"
    MISSING = "missing"


class ManufacturerEvidence(StrEnum):
    STRUCTURED = "structured"
    INFERRED = "inferred"
    MISSING = "missing"


class SelectionEligibility(StrEnum):
    AUTOMATIC = "automatic"
    MANUAL_REVIEW = "manual_review"
    BLOCKED = "blocked"


class SelectionRecommendation(StrEnum):
    PRESELECT = "preselect"
    CANDIDATE_ONLY = "candidate_only"
    EXCLUDE = "exclude"


class OfferRecommendation(StrEnum):
    AUTOMATIC = "automatic"
    MANUAL_REVIEW = "manual_review"
    NONE = "none"


class SelectionApplicationState(StrEnum):
    AUTOMATIC_SELECTED = "automatic_selected"
    PROVISIONAL_SELECTED = "provisional_selected"
    NOT_SELECTED = "not_selected"


class ProcurementUnavailabilityReason(StrEnum):
    OUT_OF_STOCK = "out_of_stock"
    INSUFFICIENT_STOCK = "insufficient_stock"
    STOCK_UNVERIFIED = "stock_unverified"
    PRICE_UNAVAILABLE = "price_unavailable"
    TECHNICAL_UNAVAILABLE = "technical_unavailable"
    SUPPLIER_UNAVAILABLE = "supplier_unavailable"
    NO_OFFER = "no_offer"
    INPUT_INCOMPLETE = "input_incomplete"
    OTHER = "other"


class MatchRelation(StrEnum):
    EXACT = "exact"
    VARIANT = "variant"
    SPEC_COMPATIBLE = "spec-compatible"
    UNRESOLVED = "unresolved"


class LifecycleState(StrEnum):
    ACTIVE = "active"
    CAUTION = "caution"
    UNKNOWN = "unknown"


class CurrencyRate(BaseModel):
    """Explicit source-to-target exchange rate from an immutable snapshot."""

    model_config = ConfigDict(extra="forbid")

    source_currency: str
    target_currency: str
    rate: Decimal = Field(gt=0)

    @field_validator("source_currency", "target_currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("currency must be a three-letter alphabetic code")
        return normalized


class ProcurementPolicyInput(BaseModel):
    """Application-provided inputs for deterministic engine procurement decisions."""

    model_config = ConfigDict(extra="forbid")

    procurement_policy_version: Literal["supplier-procurement-decision-v1"] = (
        "supplier-procurement-decision-v1"
    )
    target_currency: str = "KRW"
    currency_rates: list[CurrencyRate] = Field(default_factory=list)
    currency_rate_snapshot_id: str = "same-currency-only"
    currency_rate_as_of: datetime = Field(default_factory=utc_now)
    currency_rate_source: str = "application"
    allowed_suppliers: list[Supplier] = Field(default_factory=lambda: list(Supplier))
    allow_stock_shortage: bool = False
    allow_unverified_stock: bool = False
    excessive_surplus_quantity: int | None = Field(default=100, ge=0)
    excessive_surplus_ratio: Decimal | None = Field(default=Decimal("0.5"), ge=0)

    @field_validator("target_currency")
    @classmethod
    def normalize_target_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("target_currency must be a three-letter alphabetic code")
        return normalized

    @model_validator(mode="after")
    def validate_snapshot(self) -> "ProcurementPolicyInput":
        if not self.currency_rate_snapshot_id.strip():
            raise ValueError("currency_rate_snapshot_id must not be blank")
        if not self.currency_rate_source.strip():
            raise ValueError("currency_rate_source must not be blank")
        if (
            self.currency_rate_as_of.tzinfo is None
            or self.currency_rate_as_of.utcoffset() is None
        ):
            raise ValueError("currency_rate_as_of must include a timezone")
        if len(set(self.allowed_suppliers)) != len(self.allowed_suppliers):
            raise ValueError("allowed_suppliers must be unique")
        pairs: set[tuple[str, str]] = set()
        for rate in self.currency_rates:
            pair = (rate.source_currency, rate.target_currency)
            if pair in pairs:
                raise ValueError("currency rate pairs must be unique")
            if rate.target_currency != self.target_currency:
                raise ValueError("every currency rate must target target_currency")
            if rate.source_currency == rate.target_currency and rate.rate != Decimal(
                "1"
            ):
                raise ValueError("same-currency exchange rates must equal one")
            pairs.add(pair)
        return self


class OfferProcurementDecision(BaseModel):
    """Engine-owned calculation and rank for one stable supplier offer."""

    model_config = ConfigDict(extra="forbid")

    procurement_policy_version: Literal["supplier-procurement-decision-v1"] = (
        "supplier-procurement-decision-v1"
    )
    offer_key_version: OfferKeyVersion = "supplier-offer-key-v2"
    rank_scope: Literal["identity_and_technical_evidence"] = (
        "identity_and_technical_evidence"
    )
    offer_key: str | None = None
    calculation_status: Literal["calculated", "unavailable", "supplier_not_allowed"]
    required_quantity: int | None = Field(default=None, ge=1)
    order_quantity: int | None = Field(default=None, ge=1)
    applied_price_break_quantity: int | None = Field(default=None, ge=1)
    source_unit_price: Decimal | None = Field(default=None, gt=0)
    source_currency: str | None = None
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    target_currency: str
    converted_unit_price: Decimal | None = Field(default=None, gt=0)
    line_total: Decimal | None = Field(default=None, gt=0)
    stock_short: bool | None = None
    stock_short_quantity: int | None = Field(default=None, ge=0)
    surplus_quantity: int | None = Field(default=None, ge=0)
    excessive_order: bool | None = None
    price_rank: int | None = Field(default=None, ge=1)
    purchase_fit_rank: int | None = Field(default=None, ge=1)
    purchasable: bool = False
    recommendation: OfferRecommendation = OfferRecommendation.NONE
    reason_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_recommendation(self) -> "OfferProcurementDecision":
        expected_prefix = (
            "ok1:"
            if self.offer_key_version == "supplier-offer-key-v1"
            else "ok2:"
        )
        if self.offer_key is not None and not self.offer_key.startswith(expected_prefix):
            raise ValueError("offer_key must match offer_key_version")
        if self.price_rank is not None and self.line_total is None:
            raise ValueError("price-ranked offers must have a line total")
        if self.purchasable and (
            self.calculation_status != "calculated"
            or self.offer_key is None
            or self.line_total is None
        ):
            raise ValueError("purchasable offers must have a stable calculated price")
        if self.recommendation != OfferRecommendation.NONE and (
            not self.purchasable or self.purchase_fit_rank != 1
        ):
            raise ValueError("recommended offers must be the top purchasable fit")
        return self


class ComponentProcurementDecision(BaseModel):
    """Recommendation boundary between technical selection and supplier offers."""

    model_config = ConfigDict(extra="forbid")

    procurement_policy_version: Literal["supplier-procurement-decision-v1"] = (
        "supplier-procurement-decision-v1"
    )
    selection_application_policy_version: Literal[
        "supplier-selection-application-v3"
    ] = "supplier-selection-application-v3"
    status: Literal[
        "automatic_recommended",
        "review_recommended",
        "no_recommendation",
        "input_incomplete",
    ]
    selection_application_state: SelectionApplicationState
    confirmation_required: bool
    unavailability_reason_policy_version: Literal[
        "supplier-procurement-unavailability-v1"
    ] | None = None
    primary_unavailability_reason: ProcurementUnavailabilityReason | None = None
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    required_quantity: int | None = Field(default=None, ge=1)
    target_currency: str
    currency_rate_snapshot_id: str
    currency_rate_as_of: datetime
    currency_rate_source: str
    technical_preselection_identity_key: str | None = None
    technical_preselection_evidence_key: str | None = None
    application_candidate_identity_key: str | None = None
    application_candidate_evidence_key: str | None = None
    technical_fallback_used: bool = False
    price_optimization_used: bool = False
    automatic_offer_key: str | None = None
    review_offer_key: str | None = None
    recommendation_reason_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_recommendation(self) -> "ComponentProcurementDecision":
        has_unavailability_contract = (
            self.unavailability_reason_policy_version is not None
        )
        if (
            not has_unavailability_contract
            and self.primary_unavailability_reason is not None
        ):
            raise ValueError(
                "primary unavailability reason requires its policy version"
            )
        if has_unavailability_contract:
            has_recommendation = self.status in {
                "automatic_recommended",
                "review_recommended",
            }
            if has_recommendation != (self.primary_unavailability_reason is None):
                raise ValueError(
                    "primary unavailability reason must exist only without a recommendation"
                )
        for value, prefix in (
            (self.technical_preselection_identity_key, "ik1:"),
            (self.technical_preselection_evidence_key, "ek1:"),
            (self.application_candidate_identity_key, "ik1:"),
            (self.application_candidate_evidence_key, "ek1:"),
        ):
            if value is not None and not value.startswith(prefix):
                raise ValueError("recommended keys must use their declared versions")
        for value in (self.automatic_offer_key, self.review_offer_key):
            if value is not None and not value.startswith(("ok1:", "ok2:")):
                raise ValueError("recommended offer keys must use a supported version")
        if (self.technical_preselection_identity_key is None) != (
            self.technical_preselection_evidence_key is None
        ):
            raise ValueError("technical preselection keys must be provided together")
        if (self.application_candidate_identity_key is None) != (
            self.application_candidate_evidence_key is None
        ):
            raise ValueError("application candidate keys must be provided together")
        if self.status == "automatic_recommended" and not all(
            (
                self.technical_preselection_identity_key,
                self.technical_preselection_evidence_key,
                self.application_candidate_identity_key,
                self.application_candidate_evidence_key,
                self.automatic_offer_key,
            )
        ):
            raise ValueError(
                "automatic recommendations must identify candidate and offer"
            )
        if self.status == "review_recommended" and not all(
            (
                self.technical_preselection_identity_key,
                self.technical_preselection_evidence_key,
                self.application_candidate_identity_key,
                self.application_candidate_evidence_key,
                self.review_offer_key,
            )
        ):
            raise ValueError("review recommendations must identify candidate and offer")
        if (
            self.status != "automatic_recommended"
            and self.automatic_offer_key is not None
        ):
            raise ValueError(
                "only automatic recommendations can expose automatic_offer_key"
            )
        if self.status != "review_recommended" and self.review_offer_key is not None:
            raise ValueError("only review recommendations can expose review_offer_key")
        application_key = (
            self.application_candidate_identity_key,
            self.application_candidate_evidence_key,
        )
        technical_key = (
            self.technical_preselection_identity_key,
            self.technical_preselection_evidence_key,
        )
        has_application = self.application_candidate_identity_key is not None
        if self.status in {"no_recommendation", "input_incomplete"}:
            if (
                has_application
                or self.technical_fallback_used
                or self.price_optimization_used
            ):
                raise ValueError(
                    "non-recommended components cannot expose an application candidate"
                )
        elif application_key == technical_key:
            if self.technical_fallback_used or self.price_optimization_used:
                raise ValueError(
                    "unchanged application candidates cannot be fallback or price optimized"
                )
        elif self.technical_fallback_used == self.price_optimization_used:
            raise ValueError(
                "changed application candidates require exactly one application reason"
            )
        expected_application = {
            "automatic_recommended": SelectionApplicationState.AUTOMATIC_SELECTED,
            "review_recommended": SelectionApplicationState.PROVISIONAL_SELECTED,
            "no_recommendation": SelectionApplicationState.NOT_SELECTED,
            "input_incomplete": SelectionApplicationState.NOT_SELECTED,
        }[self.status]
        if self.selection_application_state != expected_application:
            raise ValueError(
                "selection application state must match the engine recommendation"
            )
        if self.confirmation_required != (
            self.selection_application_state
            == SelectionApplicationState.PROVISIONAL_SELECTED
        ):
            raise ValueError(
                "only provisional selections can require user confirmation"
            )
        if self.procurement_disposition != ProcurementDisposition.ELIGIBLE and (
            self.status not in {"input_incomplete", "no_recommendation"}
            or self.automatic_offer_key is not None
            or self.review_offer_key is not None
        ):
            raise ValueError(
                "non-eligible procurement dispositions cannot recommend an offer"
            )
        return self


class Requirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    raw_value: Any
    normalized_value: float | str | list[float | None] | None = None
    status: Literal["extracted", "review", "not_found", "user"]
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
    category_policy: Literal[
        "resistor",
        "capacitor",
        "electrolytic",
        "tantalum",
        "film",
        "inductor",
        "ferrite",
        "led",
        "connector",
        "varistor",
        "buzzer",
        "crystal",
    ] | None = None
    package: str | None = None
    quantity: int | None = None
    keywords: str = ""
    requirements: dict[str, Requirement] = Field(default_factory=dict)
    input_source_conflicts: list[str] = Field(default_factory=list)
    search_disposition: SearchDisposition = SearchDisposition.SEARCH
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    disposition_reason_codes: list[str] = Field(default_factory=list)
    quantity_resolution: QuantityResolution = QuantityResolution.VERIFIED
    input_branch_id: str | None = None
    input_branch_field: str | None = None
    branch_limit_exceeded: bool = False
    site: str = "KR"
    language: str = "ko"
    currency: str = "KRW"
    limit: int = 20

    def cache_payload(self) -> dict[str, Any]:
        return self.model_dump(
            mode="json",
            exclude={
                "component_id",
                "input_source_conflicts",
                "search_disposition",
                "procurement_disposition",
                "disposition_reason_codes",
                "quantity_resolution",
                "input_branch_id",
                "input_branch_field",
                "branch_limit_exceeded",
            },
            exclude_none=True,
        )


class PriceBreak(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    quantity: int = Field(ge=1)
    unit_price: float = Field(gt=0)
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
    invalid_price_break_count: int = Field(default=0, ge=0)
    lead_time: str | None = None
    product_url: str | None = None
    fetched_at: datetime = Field(default_factory=utc_now)
    procurement_decision: OfferProcurementDecision | None = None

    @field_validator("price_breaks")
    @classmethod
    def canonicalize_price_breaks(cls, values: list[PriceBreak]) -> list[PriceBreak]:
        """공급사의 중복 수량 구간은 가장 낮은 단가 하나로 정규화한다."""
        by_quantity: dict[int, PriceBreak] = {}
        for value in values:
            current = by_quantity.get(value.quantity)
            if current is None or (value.unit_price, value.currency) < (
                current.unit_price,
                current.currency,
            ):
                by_quantity[value.quantity] = value
        return [by_quantity[quantity] for quantity in sorted(by_quantity)]


class SupplierProduct(BaseModel):
    model_config = ConfigDict(extra="allow")

    supplier: Supplier
    supplier_product_id: str | None = None
    manufacturer_part_number: str
    manufacturer: str | None = None
    manufacturer_evidence: ManufacturerEvidence = ManufacturerEvidence.STRUCTURED
    description: str | None = None
    category: str | None = None
    package: str | None = None
    lifecycle_status: str | None = None
    discontinued: bool | None = None
    end_of_life: bool | None = None
    datasheet_url: str | None = None
    image_url: str | None = None
    normalized_specs: dict[str, float | str | list[float | None] | None] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    offers: list[SupplierOffer] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_manufacturer_evidence(self) -> "SupplierProduct":
        if not self.manufacturer:
            self.manufacturer_evidence = ManufacturerEvidence.MISSING
        return self


SearchTraceOutcome = Literal[
    "results",
    "empty",
    "error",
    "skipped",
    "budget_exhausted",
]
SearchTraceSource = Literal[
    "live_api",
    "fresh_cache",
    "stale_cache",
    "coalesced",
    "prefetch_cache",
    "batch_reuse",
    "not_executed",
]

SEARCH_TRACE_QUERY_MAX_LENGTH = 500


def bounded_search_trace_query(value: str) -> str:
    """Bound display-only provenance without changing the actual supplier request."""
    return value[:SEARCH_TRACE_QUERY_MAX_LENGTH]


class SupplierRequestTrace(BaseModel):
    """Credential-free provenance for one logical supplier request.

    This lower-level form is safe to keep with the raw supplier cache.  It never
    contains URLs, headers, credentials, or an unfiltered request body.
    """

    model_config = ConfigDict(extra="forbid")

    strategy: str = Field(min_length=1, max_length=64)
    query: str = Field(max_length=SEARCH_TRACE_QUERY_MAX_LENGTH)
    outcome: Literal["results", "empty", "error"]
    result_count: int = Field(default=0, ge=0)
    http_attempt_count: int = Field(default=0, ge=0)
    elapsed_ms: float = Field(default=0.0, ge=0.0)
    fallback_reason: str | None = Field(default=None, max_length=64)
    error_type: str | None = Field(default=None, max_length=100)


class SupplierSearchTraceAttempt(BaseModel):
    """One supplier attempt after current-run cache/API provenance is applied."""

    model_config = ConfigDict(extra="forbid")

    supplier: Supplier
    strategy: str = Field(min_length=1, max_length=64)
    query: str = Field(max_length=SEARCH_TRACE_QUERY_MAX_LENGTH)
    source: SearchTraceSource
    outcome: SearchTraceOutcome
    result_count: int = Field(default=0, ge=0)
    api_calls: int = Field(default=0, ge=0)
    http_attempt_count: int = Field(default=0, ge=0)
    elapsed_ms: float = Field(default=0.0, ge=0.0)
    fallback_reason: str | None = Field(default=None, max_length=64)
    error_type: str | None = Field(default=None, max_length=100)


class ComponentSearchTraceAttempt(SupplierSearchTraceAttempt):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    stage: Literal["primary", "identity_fallback", "input_conflict_branch"]
    input_branch_id: str | None = None


class ComponentSearchTrace(BaseModel):
    """Ordered, display-safe search provenance owned by the engine."""

    model_config = ConfigDict(extra="forbid")

    version: Literal["supplier-search-trace-v1"] = "supplier-search-trace-v1"
    primary_query: str = Field(max_length=SEARCH_TRACE_QUERY_MAX_LENGTH)
    fallback_query: str | None = Field(
        default=None, max_length=SEARCH_TRACE_QUERY_MAX_LENGTH
    )
    fallback_used: bool = False
    attempts: list[ComponentSearchTraceAttempt] = Field(default_factory=list)


class PackageComparison(BaseModel):
    """Backend-owned package equivalence and display decision."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["match", "mismatch", "missing", "neutral"]
    relation: Literal["exact", "alias", "compatible", "mismatch", "missing", "unverified"]
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


class RequirementAssessment(BaseModel):
    """One required BOM condition and the engine-owned candidate verdict."""

    model_config = ConfigDict(extra="forbid")

    key: str
    comparison: Literal["eq", "gte", "lte", "contains", "category"]
    state: Literal["match", "mismatch", "missing", "not_applicable", "unverified"]
    verified: bool
    expected_display: str | None = None
    actual_display: str | None = None


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
    http_attempt_count: int = Field(default=0, ge=0)
    request_trace: list[SupplierRequestTrace] = Field(default_factory=list)


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
    search_attempts: list[SupplierSearchTraceAttempt] = Field(default_factory=list)


class CandidateDecision(BaseModel):
    """Engine-owned technical relationship, eligibility, and grouping contract."""

    model_config = ConfigDict(extra="forbid")

    decision_policy_version: Literal[
        "supplier-candidate-decision-v1",
        "supplier-candidate-decision-v2",
        "supplier-candidate-decision-v3",
    ] = "supplier-candidate-decision-v3"
    category_policy_version: Literal["candidate-category-policy-v1"] = (
        "candidate-category-policy-v1"
    )
    identity_key_version: Literal["candidate-identity-key-v1"] = (
        "candidate-identity-key-v1"
    )
    evidence_key_version: Literal["candidate-evidence-key-v1"] = (
        "candidate-evidence-key-v1"
    )
    selection_recommendation_policy_version: Literal[
        "candidate-selection-recommendation-v1"
    ] = "candidate-selection-recommendation-v1"
    match_relation: MatchRelation
    selection_eligibility: SelectionEligibility
    auto_eligible: bool
    manual_selectable: bool
    reason_codes: list[str]
    identity_key: str
    technical_evidence_key: str
    verified_requirement_count: int = Field(ge=0)
    required_requirement_count: int = Field(ge=0)
    requirement_assessments: list[RequirementAssessment] = Field(default_factory=list)
    verification_complete: bool
    strict_category_coverage: bool
    lifecycle_state: LifecycleState
    technical_review_rank: int | None = Field(default=None, ge=1)
    selection_recommendation: SelectionRecommendation = (
        SelectionRecommendation.CANDIDATE_ONLY
    )
    review_recommended: bool = False

    @model_validator(mode="before")
    @classmethod
    def default_legacy_selection_recommendation(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "selection_recommendation" in value:
            return value
        updated = dict(value)
        updated["selection_recommendation"] = (
            SelectionRecommendation.EXCLUDE
            if value.get("selection_eligibility") == SelectionEligibility.BLOCKED
            or value.get("selection_eligibility") == SelectionEligibility.BLOCKED.value
            else SelectionRecommendation.CANDIDATE_ONLY
        )
        return updated

    @model_validator(mode="after")
    def validate_selection_invariants(self) -> "CandidateDecision":
        expected = {
            SelectionEligibility.AUTOMATIC: (True, True),
            SelectionEligibility.MANUAL_REVIEW: (False, True),
            SelectionEligibility.BLOCKED: (False, False),
        }[self.selection_eligibility]
        if (self.auto_eligible, self.manual_selectable) != expected:
            raise ValueError("selection eligibility boolean invariant violated")
        if (
            self.selection_eligibility == SelectionEligibility.AUTOMATIC
            and self.match_relation == MatchRelation.UNRESOLVED
        ):
            raise ValueError("automatic candidates cannot have an unresolved relation")
        if (
            self.technical_review_rank is not None
            and self.selection_eligibility != SelectionEligibility.MANUAL_REVIEW
        ):
            raise ValueError(
                "technical_review_rank is only valid for manual review candidates"
            )
        if self.selection_eligibility == SelectionEligibility.BLOCKED:
            if self.selection_recommendation != SelectionRecommendation.EXCLUDE:
                raise ValueError("blocked candidates must be excluded from preselection")
        elif self.selection_recommendation == SelectionRecommendation.EXCLUDE:
            raise ValueError("selectable candidates cannot be excluded")
        if (
            self.selection_recommendation == SelectionRecommendation.PRESELECT
            and not self.manual_selectable
        ):
            raise ValueError("preselected candidates must be manually selectable")
        expected_review = (
            self.selection_recommendation == SelectionRecommendation.PRESELECT
            and self.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
        )
        if self.review_recommended != expected_review:
            raise ValueError("review recommendation invariant violated")
        if not self.identity_key.startswith("ik1:"):
            raise ValueError("identity_key must use candidate-identity-key-v1")
        if not self.technical_evidence_key.startswith("ek1:"):
            raise ValueError("technical_evidence_key must use candidate-evidence-key-v1")
        return self


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
    decision: CandidateDecision
    input_branch_id: str | None = None


_CURRENT_DECISION_FIELDS = frozenset(
    {
        "decision_policy_version",
        "category_policy_version",
        "identity_key_version",
        "evidence_key_version",
        "selection_recommendation_policy_version",
        "match_relation",
        "selection_eligibility",
        "auto_eligible",
        "manual_selectable",
        "reason_codes",
        "identity_key",
        "technical_evidence_key",
        "verified_requirement_count",
        "required_requirement_count",
        "verification_complete",
        "strict_category_coverage",
        "lifecycle_state",
        "technical_review_rank",
        "selection_recommendation",
        "review_recommended",
    }
)


class ProcurementReevaluationCandidateInput(BaseModel):
    """component_id + 후보 + 필요수량 + 요청 오퍼 계약 — 단건/배치 재평가가 공유한다."""

    model_config = ConfigDict(extra="forbid")

    component_id: str = Field(min_length=1)
    candidates: list[CandidateMatch] = Field(default_factory=list)
    required_quantity: int = Field(ge=1)
    requested_offer_key: str | None = None
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    quantity_resolution: QuantityResolution = QuantityResolution.VERIFIED
    disposition_reason_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_procurement_disposition(self) -> "ProcurementReevaluationCandidateInput":
        if (
            self.procurement_disposition == ProcurementDisposition.ELIGIBLE
            and self.quantity_resolution != QuantityResolution.VERIFIED
        ):
            raise ValueError(
                "eligible procurement requires a verified quantity resolution"
            )
        return self

    @model_validator(mode="before")
    @classmethod
    def reject_legacy_or_incomplete_decisions(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        candidates = value.get("candidates")
        if not isinstance(candidates, list):
            return value
        for index, candidate in enumerate(candidates):
            if not isinstance(candidate, dict):
                continue
            decision = candidate.get("decision")
            if not isinstance(decision, dict):
                raise ValueError(f"candidate {index} has no current technical decision")
            missing = sorted(_CURRENT_DECISION_FIELDS - decision.keys())
            if missing:
                raise ValueError(
                    f"candidate {index} technical decision is incomplete: {', '.join(missing)}"
                )
        return value

    @field_validator("component_id")
    @classmethod
    def normalize_component_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("component_id must not be blank")
        return normalized

    @field_validator("requested_offer_key")
    @classmethod
    def validate_requested_offer_key(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("ok1:", "ok2:")):
            raise ValueError("requested_offer_key must use a supported offer key version")
        return value


class ProcurementReevaluationRequest(ProcurementReevaluationCandidateInput):
    """Stored current decisions plus new purchasing inputs; never starts a search."""

    contract_version: Literal["supplier-procurement-reevaluation-v1"] = (
        "supplier-procurement-reevaluation-v1"
    )
    procurement_policy: ProcurementPolicyInput


class RequestedOfferEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_offer_key: str | None = None
    status: Literal["not_requested", "accepted", "rejected"]
    acceptance_mode: Literal["automatic", "manual_review", "none"] = "none"
    reason_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_acceptance(self) -> "RequestedOfferEvaluation":
        if self.status == "not_requested" and self.requested_offer_key is not None:
            raise ValueError("not_requested cannot identify an offer")
        if self.status == "rejected" and self.requested_offer_key is None:
            raise ValueError("rejected offers must identify the requested offer")
        if self.status == "accepted" and (
            self.requested_offer_key is None or self.acceptance_mode == "none"
        ):
            raise ValueError(
                "accepted offers require a key and explicit acceptance mode"
            )
        if self.status != "accepted" and self.acceptance_mode != "none":
            raise ValueError("only accepted offers can expose an acceptance mode")
        return self


class ProcurementReevaluationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["supplier-procurement-reevaluation-v1"] = (
        "supplier-procurement-reevaluation-v1"
    )
    component_id: str
    candidates: list[CandidateMatch]
    procurement_decision: ComponentProcurementDecision
    requested_offer: RequestedOfferEvaluation

    @model_validator(mode="after")
    def validate_recommendation_references(self) -> "ProcurementReevaluationResult":
        component = self.procurement_decision
        if component.status == "automatic_recommended":
            recommendation_key = component.automatic_offer_key
            expected_recommendation = OfferRecommendation.AUTOMATIC
            expected_eligibility = SelectionEligibility.AUTOMATIC
        elif component.status == "review_recommended":
            recommendation_key = component.review_offer_key
            expected_recommendation = OfferRecommendation.MANUAL_REVIEW
            expected_eligibility = SelectionEligibility.MANUAL_REVIEW
        else:
            recommendation_key = None
            expected_recommendation = OfferRecommendation.NONE
            expected_eligibility = None

        recommended = [
            (candidate, offer.procurement_decision)
            for candidate in self.candidates
            for offer in candidate.product.offers
            if offer.procurement_decision is not None
            and offer.procurement_decision.recommendation != OfferRecommendation.NONE
        ]
        if recommendation_key is None:
            if recommended:
                raise ValueError(
                    "offer recommendations require a component recommendation key"
                )
            return self
        matching = [
            (candidate, decision)
            for candidate, decision in recommended
            if decision.offer_key == recommendation_key
        ]
        if len(recommended) != 1 or len(matching) != 1:
            raise ValueError("recommendation key must identify exactly one offer")
        candidate, decision = matching[0]
        if (
            candidate.decision.selection_eligibility != expected_eligibility
            or decision.recommendation != expected_recommendation
            or candidate.decision.identity_key
            != component.application_candidate_identity_key
            or candidate.decision.technical_evidence_key
            != component.application_candidate_evidence_key
        ):
            raise ValueError(
                "recommendation type must match the selected candidate eligibility"
            )
        return self


class ProcurementReevaluationBatchRequest(BaseModel):
    """벌크 재평가 — 정책은 배치가 공유하고 컴포넌트별 후보·필요수량만 다르다(공급사 호출 없음).

    한 요청의 sp-node 청크 상한(50)보다 넉넉한 200을 엔진 쪽 배치 상한으로 둔다 — 상한 초과는
    FastAPI가 자동으로 422 로 거부한다(별도 핸들러 코드 불필요).
    """

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["supplier-procurement-reevaluation-batch-v1"] = (
        "supplier-procurement-reevaluation-batch-v1"
    )
    procurement_policy: ProcurementPolicyInput
    components: list[ProcurementReevaluationCandidateInput] = Field(
        min_length=1, max_length=200
    )

    @model_validator(mode="after")
    def validate_unique_components(self) -> "ProcurementReevaluationBatchRequest":
        component_ids = [component.component_id for component in self.components]
        if len(set(component_ids)) != len(component_ids):
            raise ValueError("batch component_id values must be unique")
        return self


class ProcurementReevaluationBatchItemResult(BaseModel):
    """배치 항목 결과 — 한 컴포넌트의 실패를 그 컴포넌트로만 격리해 표현한다."""

    model_config = ConfigDict(extra="forbid")

    component_id: str
    status: Literal["ok", "error"]
    error_code: str | None = None
    error_message: str | None = None
    candidates: list[CandidateMatch] | None = None
    procurement_decision: ComponentProcurementDecision | None = None
    requested_offer: RequestedOfferEvaluation | None = None

    @model_validator(mode="after")
    def validate_status_payload(self) -> "ProcurementReevaluationBatchItemResult":
        if self.status == "ok":
            if (
                self.candidates is None
                or self.procurement_decision is None
                or self.requested_offer is None
                or self.error_code is not None
                or self.error_message is not None
            ):
                raise ValueError("ok results must carry a full decision and no error")
        elif (
            self.error_code is None
            or self.candidates is not None
            or self.procurement_decision is not None
            or self.requested_offer is not None
        ):
            raise ValueError("error results must carry only an error code/message")
        return self


class ProcurementReevaluationBatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["supplier-procurement-reevaluation-batch-v1"] = (
        "supplier-procurement-reevaluation-batch-v1"
    )
    components: list[ProcurementReevaluationBatchItemResult]


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
    search_disposition: SearchDisposition = SearchDisposition.SEARCH
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    disposition_reason_codes: list[str] = Field(default_factory=list)
    quantity_resolution: QuantityResolution = QuantityResolution.VERIFIED
    reference_designators: list[str] = Field(default_factory=list)
    source_rows_1based: list[int] = Field(default_factory=list)
    query: PlannedQuery | None = None
    conflict_branch_queries: list[PlannedQuery] = Field(default_factory=list)
    initial_query: PlannedQuery | None = None
    identity_fallback: bool = False
    search_trace: ComponentSearchTrace | None = None
    candidates: list[CandidateMatch] = Field(default_factory=list)
    input_corrections: list[InputCorrection] = Field(default_factory=list)
    supplier_results: list[SupplierSearchResult] = Field(default_factory=list)
    initial_supplier_results: list[SupplierSearchResult] = Field(default_factory=list)
    procurement_decision: ComponentProcurementDecision | None = None
    api_calls: int = 0
    elapsed_ms: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class BatchSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    search_schema_version: str = "1.7"
    procurement_policy: ProcurementPolicyInput = Field(
        default_factory=ProcurementPolicyInput
    )
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
    input_branch_id: str | None = None


class ComponentPreflight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component_id: str
    mode: SearchMode
    search_disposition: SearchDisposition = SearchDisposition.SEARCH
    procurement_disposition: ProcurementDisposition = ProcurementDisposition.ELIGIBLE
    disposition_reason_codes: list[str] = Field(default_factory=list)
    quantity_resolution: QuantityResolution = QuantityResolution.VERIFIED
    reference_designators: list[str] = Field(default_factory=list)
    source_rows_1based: list[int] = Field(default_factory=list)
    part_number: str | None = None
    manufacturer: str | None = None
    keywords: str = ""
    suppliers: list[SupplierPreflight] = Field(default_factory=list)
    fallback_mode: SearchMode | None = None
    fallback_keywords: str | None = None
    fallback_suppliers: list[SupplierPreflight] = Field(default_factory=list)
    conflict_branch_queries: list[PlannedQuery] = Field(default_factory=list)
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

    preflight_schema_version: str = "1.1"
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
