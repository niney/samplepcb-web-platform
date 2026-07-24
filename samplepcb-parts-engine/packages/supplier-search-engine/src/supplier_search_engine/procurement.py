from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from decimal import Decimal
from typing import Any

from .models import (
    CandidateMatch,
    ComponentProcurementDecision,
    OfferKeyVersion,
    OfferProcurementDecision,
    OfferRecommendation,
    PlannedQuery,
    ProcurementUnavailabilityReason,
    ProcurementPolicyInput,
    ProcurementReevaluationBatchItemResult,
    ProcurementReevaluationBatchRequest,
    ProcurementReevaluationBatchResult,
    ProcurementReevaluationRequest,
    ProcurementReevaluationResult,
    RequestedOfferEvaluation,
    SearchMode,
    SelectionApplicationState,
    SelectionEligibility,
    SelectionRecommendation,
    SupplierOffer,
    SupplierProduct,
)


CURRENT_OFFER_KEY_VERSION: OfferKeyVersion = "supplier-offer-key-v2"
_AUTOMATIC_SELECTION_EXCESS_REASON = "automatic_selection_excessive"
_PRICE_OPTIMIZED_REQUIREMENT_KEYS = frozenset(
    {"resistance_ohm", "capacitance_f"}
)
_MISSING_SUPPLIER_IDENTIFIERS = frozenset(
    {
        "-",
        "--",
        "n/a",
        "n.a.",
        "none",
        "not available",
        "null",
        "unknown",
    }
)


class ProcurementReevaluationError(ValueError):
    """The stored technical contract is ambiguous or changed during reevaluation."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.context = context or {}

    def api_detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": str(self),
            "context": self.context,
        }


_GROUP_INVARIANT_FIELDS = (
    "decision_policy_version",
    "category_policy_version",
    "identity_key_version",
    "evidence_key_version",
    "selection_recommendation_policy_version",
    "selection_eligibility",
    "auto_eligible",
    "manual_selectable",
    "match_relation",
    "selection_recommendation",
    "review_recommended",
    "technical_review_rank",
    "verification_complete",
    "strict_category_coverage",
    "lifecycle_state",
)


def _json_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _validate_candidate_groups(
    candidates: list[CandidateMatch],
) -> tuple[str, str] | None:
    groups: dict[tuple[str, str], list[CandidateMatch]] = {}
    for candidate in candidates:
        key = (
            candidate.decision.identity_key,
            candidate.decision.technical_evidence_key,
        )
        groups.setdefault(key, []).append(candidate)

    for key in sorted(groups):
        group = groups[key]
        for field in _GROUP_INVARIANT_FIELDS:
            values = {
                _json_value(getattr(candidate.decision, field)) for candidate in group
            }
            if len(values) > 1:
                raise ProcurementReevaluationError(
                    "candidate_group_invariant_violation",
                    "candidates in one technical group disagree on a safety field",
                    context={
                        "identity_key": key[0],
                        "technical_evidence_key": key[1],
                        "field": field,
                        "values": sorted(values, key=lambda value: str(value)),
                    },
                )

    preselected_groups = sorted(
        key
        for key, group in groups.items()
        if group[0].decision.selection_recommendation
        == SelectionRecommendation.PRESELECT
    )
    if len(preselected_groups) > 1:
        raise ProcurementReevaluationError(
            "multiple_preselected_groups",
            "at most one identity and technical evidence group can be preselected",
            context={
                "preselected_groups": [
                    {"identity_key": key[0], "technical_evidence_key": key[1]}
                    for key in preselected_groups
                ]
            },
        )
    return preselected_groups[0] if preselected_groups else None


def _collect_offer_occurrences(
    candidates: list[CandidateMatch],
    offer_key_version: OfferKeyVersion,
) -> dict[str, list[tuple[int, int, CandidateMatch, SupplierOffer]]]:
    occurrences: dict[
        str, list[tuple[int, int, CandidateMatch, SupplierOffer]]
    ] = {}
    stored_key_mismatches: list[dict[str, Any]] = []
    for candidate_index, candidate in enumerate(candidates):
        for offer_index, offer in enumerate(candidate.product.offers):
            offer_key = stable_offer_key(
                candidate.product,
                offer,
                version=offer_key_version,
            )
            stored_offer_key = (
                offer.procurement_decision.offer_key
                if offer.procurement_decision is not None
                else None
            )
            if stored_offer_key is not None and stored_offer_key != offer_key:
                stored_key_mismatches.append(
                    {
                        "computed_offer_key": offer_key,
                        "stored_offer_key": stored_offer_key,
                        "supplier": offer.supplier.value,
                        "supplier_sku": offer.supplier_sku,
                    }
                )
            if offer_key is not None:
                occurrences.setdefault(offer_key, []).append(
                    (candidate_index, offer_index, candidate, offer)
                )
    if stored_key_mismatches:
        mismatch = min(
            stored_key_mismatches,
            key=lambda item: json.dumps(item, sort_keys=True),
        )
        raise ProcurementReevaluationError(
            "stored_offer_key_mismatch",
            "stored offer key does not match the stable supplier-owned offer identity",
            context=mismatch,
        )
    return occurrences


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )


def _duplicate_offer_payload(
    candidate: CandidateMatch,
    offer: SupplierOffer,
) -> dict[str, Any]:
    """Return safety-relevant data that must agree before duplicate collapse."""

    candidate_payload = candidate.model_dump(mode="json", exclude={"product"})
    product_payload = candidate.product.model_dump(
        mode="json",
        exclude={"offers", "datasheet_url", "image_url"},
    )
    offer_payload = offer.model_dump(
        mode="json",
        exclude={"fetched_at", "procurement_decision", "product_url"},
    )
    offer_payload["price_breaks"] = sorted(
        offer_payload.get("price_breaks", []),
        key=_canonical_json,
    )
    return {
        "candidate": candidate_payload,
        "product": product_payload,
        "offer": offer_payload,
    }


def _duplicate_offer_preference(
    occurrence: tuple[int, int, CandidateMatch, SupplierOffer],
) -> tuple[Any, ...]:
    """Choose one identical occurrence without depending on input order."""

    candidate_index, offer_index, candidate, offer = occurrence
    return (
        -offer.fetched_at.timestamp(),
        offer.product_url or "",
        candidate.product.datasheet_url or "",
        candidate.product.image_url or "",
        candidate_index,
        offer_index,
    )


def _canonicalize_duplicate_offers(
    candidates: list[CandidateMatch],
    offer_key_version: OfferKeyVersion,
) -> list[CandidateMatch]:
    """Collapse exact repeated offers while rejecting conflicting duplicate keys."""

    occurrences = _collect_offer_occurrences(candidates, offer_key_version)
    removed: set[tuple[int, int]] = set()
    for offer_key in sorted(occurrences):
        repeated = occurrences[offer_key]
        if len(repeated) < 2:
            continue
        payloads = [
            _duplicate_offer_payload(candidate, offer)
            for _, _, candidate, offer in repeated
        ]
        canonical_payloads = {_canonical_json(payload) for payload in payloads}
        if len(canonical_payloads) > 1:
            baseline = payloads[0]
            conflicting_sections = sorted(
                section
                for section in baseline
                if len({_canonical_json(payload[section]) for payload in payloads}) > 1
            )
            raise ProcurementReevaluationError(
                "duplicate_offer_key",
                "one stable offer key contains conflicting supplier or procurement data",
                context={
                    "offer_key": offer_key,
                    "occurrence_count": len(repeated),
                    "duplicate_policy": "fail_closed_conflict",
                    "conflicting_sections": conflicting_sections,
                },
            )
        canonical = min(repeated, key=_duplicate_offer_preference)
        removed.update(
            (candidate_index, offer_index)
            for candidate_index, offer_index, _candidate, _offer in repeated
            if (candidate_index, offer_index) != canonical[:2]
        )

    if not removed:
        return candidates

    canonical_candidates: list[CandidateMatch] = []
    for candidate_index, candidate in enumerate(candidates):
        offers = [
            offer
            for offer_index, offer in enumerate(candidate.product.offers)
            if (candidate_index, offer_index) not in removed
        ]
        if candidate.product.offers and not offers:
            continue
        canonical_candidates.append(
            candidate.model_copy(
                update={
                    "product": candidate.product.model_copy(
                        update={"offers": offers},
                        deep=True,
                    )
                },
                deep=True,
            )
        )
    return canonical_candidates


def _validate_unique_offer_keys(
    candidates: list[CandidateMatch],
    offer_key_version: OfferKeyVersion,
) -> None:
    occurrences = _collect_offer_occurrences(candidates, offer_key_version)
    duplicate_keys = sorted(
        key for key, repeated in occurrences.items() if len(repeated) > 1
    )
    if duplicate_keys:
        duplicate_key = duplicate_keys[0]
        raise ProcurementReevaluationError(
            "duplicate_offer_key",
            "stable offer keys must identify exactly one stored offer",
            context={
                "offer_key": duplicate_key,
                "occurrence_count": len(occurrences[duplicate_key]),
                "duplicate_policy": "fail_closed",
            },
        )


def _stable_token(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return re.sub(r"[^\w]+", "", normalized, flags=re.UNICODE).replace("_", "")


def _stable_supplier_identifier(value: str | None) -> str:
    """Normalize representation without erasing punctuation that identifies an SKU."""

    normalized = unicodedata.normalize("NFKC", value or "").strip()
    if normalized.casefold() in _MISSING_SUPPLIER_IDENTIFIERS:
        return ""
    return normalized


def stable_offer_key(
    product: SupplierProduct,
    offer: SupplierOffer,
    *,
    version: OfferKeyVersion = CURRENT_OFFER_KEY_VERSION,
) -> str | None:
    """Create a URL/price/stock/time-independent supplier-owned offer key."""

    normalize = (
        _stable_token
        if version == "supplier-offer-key-v1"
        else _stable_supplier_identifier
    )
    product_id = normalize(product.supplier_product_id)
    supplier_sku = normalize(offer.supplier_sku)
    if not product_id and not supplier_sku:
        return None
    payload = {
        "packaging": normalize(offer.packaging),
        "product_id": product_id,
        "supplier": offer.supplier.value,
        "supplier_sku": supplier_sku,
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]
    prefix = "ok1" if version == "supplier-offer-key-v1" else "ok2"
    return f"{prefix}:{digest}"


def _stored_offer_key_version(
    candidates: list[CandidateMatch],
) -> OfferKeyVersion | None:
    versions = {
        offer.procurement_decision.offer_key_version
        for candidate in candidates
        for offer in candidate.product.offers
        if offer.procurement_decision is not None
    }
    if len(versions) > 1:
        raise ProcurementReevaluationError(
            "mixed_offer_key_versions",
            "stored candidates use more than one offer key version",
            context={"offer_key_versions": sorted(versions)},
        )
    return next(iter(versions)) if versions else None


def _order_quantity(required: int, moq: int | None, multiple: int | None) -> int:
    minimum = max(required, moq or 1)
    step = multiple or 1
    return math.ceil(minimum / step) * step


def _price_break(
    offer: SupplierOffer,
    order_quantity: int,
) -> tuple[int, Decimal, str] | None:
    eligible: list[tuple[int, Decimal, str]] = []
    for price_break in offer.price_breaks:
        if price_break.quantity < 1 or price_break.quantity > order_quantity:
            continue
        price = Decimal(str(price_break.unit_price))
        if price <= 0:
            continue
        eligible.append(
            (price_break.quantity, price, price_break.currency.strip().upper())
        )
    if not eligible:
        return None
    highest_quantity = max(item[0] for item in eligible)
    return min(
        (item for item in eligible if item[0] == highest_quantity),
        key=lambda item: (item[1], item[2]),
    )

def _exchange_rate(
    source_currency: str,
    policy: ProcurementPolicyInput,
) -> Decimal | None:
    if source_currency == policy.target_currency:
        return Decimal("1")
    return next(
        (
            rate.rate
            for rate in policy.currency_rates
            if rate.source_currency == source_currency
            and rate.target_currency == policy.target_currency
        ),
        None,
    )


def _is_excessive(
    required: int,
    surplus: int,
    policy: ProcurementPolicyInput,
) -> bool:
    quantity_exceeded = (
        policy.excessive_surplus_quantity is not None
        and surplus > policy.excessive_surplus_quantity
    )
    ratio_exceeded = (
        policy.excessive_surplus_ratio is not None
        and Decimal(surplus) / Decimal(required) > policy.excessive_surplus_ratio
    )
    return quantity_exceeded or ratio_exceeded


def _exceeds_automatic_selection_limit(
    required: int,
    surplus: int,
    policy: ProcurementPolicyInput,
) -> bool:
    """Block only orders that exceed every configured surplus guard.

    ``excessive_order`` intentionally remains the broad diagnostic/ranking signal:
    a small cut-tape MOQ can exceed the ratio guard without being unreasonable.
    Automatic selection is suppressed only when both the absolute and relative
    surplus are large (or the sole configured guard is exceeded).
    """

    exceeded: list[bool] = []
    if policy.excessive_surplus_quantity is not None:
        exceeded.append(surplus > policy.excessive_surplus_quantity)
    if policy.excessive_surplus_ratio is not None:
        exceeded.append(
            Decimal(surplus) / Decimal(required) > policy.excessive_surplus_ratio
        )
    return bool(exceeded) and all(exceeded)


def _automatic_selection_allowed(decision: OfferProcurementDecision) -> bool:
    return _AUTOMATIC_SELECTION_EXCESS_REASON not in decision.reason_codes


def _offer_decision(
    query: PlannedQuery,
    candidate: CandidateMatch,
    offer: SupplierOffer,
    policy: ProcurementPolicyInput,
    offer_key_version: OfferKeyVersion,
) -> OfferProcurementDecision:
    reasons: list[str] = list(query.disposition_reason_codes)
    offer_key = stable_offer_key(
        candidate.product,
        offer,
        version=offer_key_version,
    )
    required = query.quantity
    order_quantity: int | None = None
    applied_quantity: int | None = None
    source_unit_price: Decimal | None = None
    source_currency: str | None = None
    rate: Decimal | None = None
    converted_unit_price: Decimal | None = None
    line_total: Decimal | None = None
    stock_short: bool | None = None
    stock_short_quantity: int | None = None
    surplus: int | None = None
    excessive: bool | None = None

    if offer_key is None:
        reasons.append("stable_offer_identity_unavailable")
    if offer.supplier != candidate.product.supplier:
        reasons.append("offer_supplier_mismatch")
    if offer.supplier not in policy.allowed_suppliers:
        reasons.append("supplier_not_allowed")
    if required is None:
        reasons.append("required_quantity_missing")
    else:
        if offer.moq is None:
            reasons.append("moq_defaulted_to_one")
        elif offer.moq < 1:
            reasons.append("invalid_moq")
        if offer.order_multiple is None:
            reasons.append("order_multiple_defaulted_to_one")
        elif offer.order_multiple < 1:
            reasons.append("invalid_order_multiple")
        if "invalid_moq" not in reasons and "invalid_order_multiple" not in reasons:
            order_quantity = _order_quantity(required, offer.moq, offer.order_multiple)
            surplus = order_quantity - required
            excessive = _is_excessive(required, surplus, policy)
            reasons.append(
                "excessive_order" if excessive else "order_quantity_calculated"
            )
            if _exceeds_automatic_selection_limit(required, surplus, policy):
                reasons.append(_AUTOMATIC_SELECTION_EXCESS_REASON)
            if offer.stock is None:
                reasons.append("stock_unverified")
                if policy.allow_unverified_stock:
                    reasons.append("unverified_stock_allowed")
                else:
                    reasons.append("stock_unverified_not_allowed")
            else:
                stock_short = offer.stock < order_quantity
                stock_short_quantity = max(order_quantity - offer.stock, 0)
                if stock_short:
                    reasons.append("stock_short")
                else:
                    reasons.append("stock_sufficient")
            selected_break = _price_break(offer, order_quantity)
            if offer.invalid_price_break_count:
                reasons.append("invalid_price")
            if selected_break is None:
                reasons.append("price_unavailable")
                reasons.append("price_break_unavailable_for_quantity")
            else:
                applied_quantity, source_unit_price, source_currency = selected_break
                rate = _exchange_rate(source_currency, policy)
                if rate is None:
                    reasons.append("currency_rate_missing")
                else:
                    converted_unit_price = source_unit_price * rate
                    line_total = converted_unit_price * Decimal(order_quantity)
                    reasons.append("price_calculated")

    technically_blocked = (
        candidate.decision.selection_eligibility == SelectionEligibility.BLOCKED
    )
    if technically_blocked:
        reasons.append("technical_candidate_blocked")
    procurement_eligible = query.procurement_disposition.value == "eligible"
    if not procurement_eligible:
        reasons.append(f"procurement_{query.procurement_disposition.value}")
    if stock_short and not policy.allow_stock_shortage:
        reasons.append("stock_shortage_not_allowed")

    supplier_allowed = offer.supplier in policy.allowed_suppliers
    calculation_ready = (
        required is not None
        and order_quantity is not None
        and line_total is not None
        and offer_key is not None
        and offer.supplier == candidate.product.supplier
    )
    purchasable = (
        calculation_ready
        and supplier_allowed
        and not technically_blocked
        and procurement_eligible
        and (
            stock_short is False
            or (stock_short is True and policy.allow_stock_shortage)
            or (stock_short is None and policy.allow_unverified_stock)
        )
    )
    if not supplier_allowed:
        status = "supplier_not_allowed"
    elif calculation_ready:
        status = "calculated"
    else:
        status = "unavailable"
    return OfferProcurementDecision(
        offer_key_version=offer_key_version,
        offer_key=offer_key,
        calculation_status=status,
        required_quantity=required,
        order_quantity=order_quantity,
        applied_price_break_quantity=applied_quantity,
        source_unit_price=source_unit_price,
        source_currency=source_currency,
        exchange_rate=rate,
        target_currency=policy.target_currency,
        converted_unit_price=converted_unit_price,
        line_total=line_total,
        stock_short=stock_short,
        stock_short_quantity=stock_short_quantity,
        surplus_quantity=surplus,
        excessive_order=excessive,
        purchasable=purchasable,
        reason_codes=list(dict.fromkeys(reasons)),
    )


def _dense_ranks(values: list[tuple[int, Any]]) -> dict[int, int]:
    ranks: dict[int, int] = {}
    previous: Any = object()
    rank = 0
    for index, value in sorted(values, key=lambda item: (item[1], item[0])):
        if value != previous:
            rank += 1
            previous = value
        ranks[index] = rank
    return ranks


def _application_group_sort_key(
    candidates: list[CandidateMatch],
    group_key: tuple[str, str],
    best_line_total: Decimal,
) -> tuple[Any, ...]:
    """Order fallback groups by technical safety, then effective total, never input order."""

    group = [
        candidate
        for candidate in candidates
        if (
            candidate.decision.identity_key,
            candidate.decision.technical_evidence_key,
        )
        == group_key
    ]
    if not group:
        raise ProcurementReevaluationError(
            "application_candidate_group_missing",
            "an application candidate group must reference stored technical evidence",
            context={
                "identity_key": group_key[0],
                "technical_evidence_key": group_key[1],
            },
        )
    candidate = min(
        group,
        key=lambda item: (
            _stable_token(item.product.manufacturer),
            _stable_token(item.product.manufacturer_part_number),
            item.product.supplier.value,
        ),
    )
    decision = candidate.decision
    eligibility_order = {
        SelectionEligibility.AUTOMATIC: 0,
        SelectionEligibility.MANUAL_REVIEW: 1,
        SelectionEligibility.BLOCKED: 2,
    }
    relation_order = {
        "exact": 0,
        "variant": 1,
        "spec-compatible": 2,
        "unresolved": 3,
    }
    lifecycle_order = {"active": 0, "unknown": 1, "caution": 2}
    required = decision.required_requirement_count
    verification_ratio = (
        decision.verified_requirement_count / required if required else 0.0
    )
    source_conflicts = sum(
        value.endswith("_source_conflict") for value in candidate.conflicts
    )
    actual_conflicts = sum(
        not value.endswith("_source_conflict") and value != "manufacturer_mismatch"
        for value in candidate.conflicts
    )
    return (
        eligibility_order[decision.selection_eligibility],
        decision.technical_review_rank or 0,
        relation_order[decision.match_relation.value],
        actual_conflicts,
        source_conflicts,
        len(candidate.missing_requirements),
        -verification_ratio,
        -decision.verified_requirement_count,
        lifecycle_order[decision.lifecycle_state.value],
        best_line_total,
        _stable_token(candidate.product.manufacturer),
        _stable_token(candidate.product.manufacturer_part_number),
        group_key,
    )


def _group_representative(
    candidates: list[CandidateMatch],
    group_key: tuple[str, str],
) -> CandidateMatch:
    group = [
        candidate
        for candidate in candidates
        if (
            candidate.decision.identity_key,
            candidate.decision.technical_evidence_key,
        )
        == group_key
    ]
    if not group:
        raise ProcurementReevaluationError(
            "application_candidate_group_missing",
            "an application candidate group must reference stored technical evidence",
            context={
                "identity_key": group_key[0],
                "technical_evidence_key": group_key[1],
            },
        )
    return min(
        group,
        key=lambda item: (
            _stable_token(item.product.manufacturer),
            _stable_token(item.product.manufacturer_part_number),
            item.product.supplier.value,
        ),
    )


def _technical_equivalence_band(candidate: CandidateMatch) -> tuple[Any, ...]:
    """Return the safety evidence that must stay equal before price can decide."""

    decision = candidate.decision
    assessments = tuple(
        sorted(
            (
                assessment.key,
                assessment.comparison,
                assessment.state,
                assessment.verified,
            )
            for assessment in decision.requirement_assessments
        )
    )
    return (
        decision.selection_eligibility.value,
        decision.match_relation.value,
        tuple(sorted(candidate.conflicts)),
        tuple(sorted(candidate.missing_requirements)),
        tuple(sorted(decision.reason_codes)),
        assessments,
        decision.verified_requirement_count,
        decision.required_requirement_count,
        decision.verification_complete,
        decision.strict_category_coverage,
        decision.lifecycle_state.value,
    )


def _price_optimization_enabled(candidate: CandidateMatch) -> bool:
    """Limit cross-part price selection to safe R/C or generic exact-MPN review."""

    decision = candidate.decision
    source_conflicts = {
        conflict
        for conflict in candidate.conflicts
        if conflict.endswith("_source_conflict")
    }
    if (
        decision.match_relation.value == "exact"
        and source_conflicts == {"manufacturer_source_conflict"}
    ):
        return True
    if decision.match_relation.value not in {"spec-compatible", "unresolved"}:
        return False
    return any(
        assessment.key in _PRICE_OPTIMIZED_REQUIREMENT_KEYS
        for assessment in decision.requirement_assessments
    )


def _validate_procurement_result(
    candidates: list[CandidateMatch],
    component: ComponentProcurementDecision,
) -> None:
    recommended_offers = [
        (candidate, offer.procurement_decision)
        for candidate in candidates
        for offer in candidate.product.offers
        if offer.procurement_decision is not None
        and offer.procurement_decision.recommendation != OfferRecommendation.NONE
    ]
    if component.status == "automatic_recommended":
        expected_key = component.automatic_offer_key
        expected_recommendation = OfferRecommendation.AUTOMATIC
        expected_eligibility = SelectionEligibility.AUTOMATIC
    elif component.status == "review_recommended":
        expected_key = component.review_offer_key
        expected_recommendation = OfferRecommendation.MANUAL_REVIEW
        expected_eligibility = SelectionEligibility.MANUAL_REVIEW
    else:
        expected_key = None
        expected_recommendation = OfferRecommendation.NONE
        expected_eligibility = None

    if expected_key is None:
        if recommended_offers:
            raise ProcurementReevaluationError(
                "orphan_offer_recommendation",
                "an offer recommendation exists without a component recommendation key",
                context={"recommended_offer_count": len(recommended_offers)},
            )
        return

    matching_offers = [
        (candidate, decision)
        for candidate, decision in recommended_offers
        if decision.offer_key == expected_key
    ]
    if len(recommended_offers) != 1 or len(matching_offers) != 1:
        raise ProcurementReevaluationError(
            "recommendation_key_not_unique",
            "the component recommendation key must identify exactly one recommended offer",
            context={
                "offer_key": expected_key,
                "recommended_offer_count": len(recommended_offers),
                "matching_offer_count": len(matching_offers),
            },
        )
    selected_candidate, selected_decision = matching_offers[0]
    if (
        selected_candidate.decision.selection_eligibility != expected_eligibility
        or selected_decision.recommendation != expected_recommendation
        or selected_candidate.decision.identity_key
        != component.application_candidate_identity_key
        or selected_candidate.decision.technical_evidence_key
        != component.application_candidate_evidence_key
    ):
        raise ProcurementReevaluationError(
            "recommendation_type_mismatch",
            "component and offer recommendation types must match the selected candidate eligibility",
            context={
                "offer_key": expected_key,
                "candidate_eligibility": selected_candidate.decision.selection_eligibility.value,
                "offer_recommendation": selected_decision.recommendation.value,
                "component_status": component.status,
            },
        )


def apply_procurement_decisions(
    query: PlannedQuery,
    candidates: list[CandidateMatch],
    policy: ProcurementPolicyInput,
    *,
    offer_key_version: OfferKeyVersion | None = None,
) -> tuple[list[CandidateMatch], ComponentProcurementDecision]:
    """Calculate offers without allowing purchasing data to mutate technical order."""

    stored_version = _stored_offer_key_version(candidates)
    if (
        offer_key_version is not None
        and stored_version is not None
        and offer_key_version != stored_version
    ):
        raise ProcurementReevaluationError(
            "offer_key_version_mismatch",
            "requested offer key version differs from stored candidates",
            context={
                "requested_offer_key_version": offer_key_version,
                "stored_offer_key_version": stored_version,
            },
        )
    effective_offer_key_version = (
        offer_key_version or stored_version or CURRENT_OFFER_KEY_VERSION
    )
    preselected_group = _validate_candidate_groups(candidates)
    if query.procurement_disposition.value != "eligible":
        preselected_group = None
    candidates = _canonicalize_duplicate_offers(
        candidates,
        effective_offer_key_version,
    )
    _validate_unique_offer_keys(candidates, effective_offer_key_version)
    entries: list[
        tuple[int, int, CandidateMatch, SupplierOffer, OfferProcurementDecision]
    ] = []
    for candidate_index, candidate in enumerate(candidates):
        for offer_index, offer in enumerate(candidate.product.offers):
            entries.append(
                (
                    candidate_index,
                    offer_index,
                    candidate,
                    offer,
                    _offer_decision(
                        query,
                        candidate,
                        offer,
                        policy,
                        effective_offer_key_version,
                    ),
                )
            )

    decisions: dict[tuple[int, int], OfferProcurementDecision] = {
        (candidate_index, offer_index): decision
        for candidate_index, offer_index, _candidate, _offer, decision in entries
    }
    groups: dict[tuple[str, str], list[int]] = {}
    for entry_index, (_ci, _oi, candidate, _offer, _decision) in enumerate(entries):
        key = (
            candidate.decision.identity_key,
            candidate.decision.technical_evidence_key,
        )
        groups.setdefault(key, []).append(entry_index)

    for entry_indexes in groups.values():
        price_values = [
            (entry_index, entries[entry_index][4].line_total)
            for entry_index in entry_indexes
            if entries[entry_index][4].line_total is not None
        ]
        price_ranks = _dense_ranks(price_values)
        fit_values: list[tuple[int, tuple[Any, ...]]] = []
        for entry_index in entry_indexes:
            _ci, _oi, candidate, offer, decision = entries[entry_index]
            if candidate.decision.selection_eligibility == SelectionEligibility.BLOCKED:
                continue
            fit_values.append(
                (
                    entry_index,
                    (
                        not decision.purchasable,
                        decision.stock_short is True,
                        not _automatic_selection_allowed(decision),
                        decision.excessive_order is True,
                        decision.stock_short is None,
                        decision.line_total is None,
                        (
                            decision.line_total
                            if decision.line_total is not None
                            else Decimal("Infinity")
                        ),
                        decision.order_quantity or 2**63,
                        offer.supplier.value,
                        decision.offer_key or "",
                    ),
                )
            )
        fit_ranks = _dense_ranks(fit_values)
        for entry_index in entry_indexes:
            ci, oi, _candidate, _offer, decision = entries[entry_index]
            decisions[(ci, oi)] = decision.model_copy(
                update={
                    "price_rank": price_ranks.get(entry_index),
                    "purchase_fit_rank": fit_ranks.get(entry_index),
                },
                deep=True,
            )

    recommended_entry: tuple[int, int] | None = None
    offer_recommendation = OfferRecommendation.NONE
    recommendation_reasons: list[str] = []
    technical_identity_key: str | None = None
    technical_evidence_key: str | None = None
    application_group: tuple[str, str] | None = None
    price_optimization_used = False
    if query.procurement_disposition.value != "eligible":
        recommendation_reasons.extend(
            [
                f"procurement_{query.procurement_disposition.value}",
                *query.disposition_reason_codes,
            ]
        )
    elif preselected_group is None:
        recommendation_reasons.append("technical_preselection_unavailable")
    else:
        technical_identity_key, technical_evidence_key = preselected_group
        recommendation_reasons.append("technical_preselection_preserved")

        def recommendable_entries(
            group_key: tuple[str, str],
        ) -> list[tuple[int, int, OfferProcurementDecision]]:
            identity_key, evidence_key = group_key
            return [
                (ci, oi, decision)
                for (ci, oi), decision in decisions.items()
                if candidates[ci].decision.identity_key == identity_key
                and candidates[ci].decision.technical_evidence_key == evidence_key
                and decision.purchasable
                and _automatic_selection_allowed(decision)
            ]

        eligible_entries = recommendable_entries(preselected_group)
        if eligible_entries:
            preselected_candidate = _group_representative(
                candidates,
                preselected_group,
            )
            if _price_optimization_enabled(preselected_candidate):
                technical_band = _technical_equivalence_band(
                    preselected_candidate
                )
                equivalent_groups = [
                    group_key
                    for group_key in groups
                    if recommendable_entries(group_key)
                    and _technical_equivalence_band(
                        _group_representative(candidates, group_key)
                    )
                    == technical_band
                ]
                application_group = min(
                    equivalent_groups,
                    key=lambda group_key: (
                        min(
                            decision.line_total
                            for _ci, _oi, decision in recommendable_entries(
                                group_key
                            )
                            if decision.line_total is not None
                        ),
                        min(
                            decision.order_quantity or 2**63
                            for _ci, _oi, decision in recommendable_entries(
                                group_key
                            )
                        ),
                        group_key,
                    ),
                )
                eligible_entries = recommendable_entries(application_group)
                price_optimization_used = application_group != preselected_group
                if price_optimization_used:
                    recommendation_reasons.append(
                        "equivalent_group_lower_effective_total_selected"
                    )
            else:
                application_group = preselected_group
        else:
            preselected_purchasable = [
                decision
                for (ci, _oi), decision in decisions.items()
                if candidates[ci].decision.identity_key == preselected_group[0]
                and candidates[ci].decision.technical_evidence_key == preselected_group[1]
                and decision.purchasable
            ]
            recommendation_reasons.append(
                "technical_preselection_excessive_order"
                if preselected_purchasable
                and all(
                    not _automatic_selection_allowed(decision)
                    for decision in preselected_purchasable
                )
                else "technical_preselection_unpurchasable"
            )
            fallback_groups = [
                group_key
                for group_key in groups
                if group_key != preselected_group
                and candidates[
                    entries[groups[group_key][0]][0]
                ].decision.selection_eligibility
                != SelectionEligibility.BLOCKED
                and recommendable_entries(group_key)
            ]
            if fallback_groups:
                application_group = min(
                    fallback_groups,
                    key=lambda group_key: _application_group_sort_key(
                        candidates,
                        group_key,
                        min(
                            decision.line_total
                            for _ci, _oi, decision in recommendable_entries(group_key)
                            if decision.line_total is not None
                        ),
                    ),
                )
                eligible_entries = recommendable_entries(application_group)
                recommendation_reasons.append(
                    "next_purchasable_technical_group_selected"
                )
            else:
                recommendation_reasons.append("no_purchasable_candidate_group")

        if application_group is not None:
            eligible_entries = [
                (ci, oi, decision)
                for ci, oi, decision in eligible_entries
                if decision.purchasable
                and _automatic_selection_allowed(decision)
            ]
            ci, oi, selected = min(
                eligible_entries,
                key=lambda item: (
                    item[2].purchase_fit_rank or 2**31,
                    item[2].price_rank or 2**31,
                    item[2].offer_key or "",
                ),
            )
            recommended_entry = (ci, oi)
            selected_candidate = candidates[ci]
            if (
                selected_candidate.decision.selection_eligibility
                == SelectionEligibility.AUTOMATIC
            ):
                offer_recommendation = OfferRecommendation.AUTOMATIC
            elif (
                selected_candidate.decision.selection_eligibility
                == SelectionEligibility.MANUAL_REVIEW
            ):
                offer_recommendation = OfferRecommendation.MANUAL_REVIEW
            else:
                raise ProcurementReevaluationError(
                    "blocked_candidate_selected",
                    "a blocked candidate cannot receive a procurement recommendation",
                    context={
                        "identity_key": selected_candidate.decision.identity_key,
                        "technical_evidence_key": selected_candidate.decision.technical_evidence_key,
                        "offer_key": selected.offer_key,
                    },
                )
            decisions[(ci, oi)] = selected.model_copy(
                update={"recommendation": offer_recommendation}, deep=True
            )
            recommendation_reasons.append(
                "best_effective_total_in_equivalent_group"
                if price_optimization_used
                else "best_purchase_fit_in_technical_group"
                if application_group == preselected_group
                else "best_purchase_fit_in_fallback_group"
            )
            if offer_recommendation == OfferRecommendation.MANUAL_REVIEW:
                recommendation_reasons.append("manual_review_required")
            else:
                recommendation_reasons.append("automatic_candidate")

    updated_candidates: list[CandidateMatch] = []
    for candidate_index, candidate in enumerate(candidates):
        offers = [
            offer.model_copy(
                update={
                    "procurement_decision": decisions[(candidate_index, offer_index)]
                },
                deep=True,
            )
            for offer_index, offer in enumerate(candidate.product.offers)
        ]
        updated_candidates.append(
            candidate.model_copy(
                update={
                    "product": candidate.product.model_copy(
                        update={"offers": offers}, deep=True
                    )
                },
                deep=True,
            )
        )

    selected_offer_key = (
        decisions[recommended_entry].offer_key
        if recommended_entry is not None
        else None
    )
    status = (
        "input_incomplete"
        if query.quantity is None or query.procurement_disposition.value != "eligible"
        else "automatic_recommended"
        if offer_recommendation == OfferRecommendation.AUTOMATIC
        else "review_recommended"
        if offer_recommendation == OfferRecommendation.MANUAL_REVIEW
        else "no_recommendation"
    )
    ranked_entries = [
        (candidate, offer, decisions[(candidate_index, offer_index)])
        for candidate_index, offer_index, candidate, offer, _decision in entries
    ]
    primary_unavailability_reason: ProcurementUnavailabilityReason | None = None
    if status == "input_incomplete":
        primary_unavailability_reason = ProcurementUnavailabilityReason.INPUT_INCOMPLETE
    elif status == "no_recommendation":
        nonblocked_entries = [
            entry
            for entry in ranked_entries
            if entry[0].decision.selection_eligibility != SelectionEligibility.BLOCKED
        ]
        relevant_entries = nonblocked_entries or ranked_entries
        if not relevant_entries:
            primary_unavailability_reason = ProcurementUnavailabilityReason.NO_OFFER
        elif all(decision.stock_short is True for _, _, decision in relevant_entries):
            primary_unavailability_reason = (
                ProcurementUnavailabilityReason.OUT_OF_STOCK
                if all(offer.stock == 0 for _, offer, _ in relevant_entries)
                else ProcurementUnavailabilityReason.INSUFFICIENT_STOCK
            )
        elif not any(
            decision.stock_short is False for _, _, decision in relevant_entries
        ) and any(decision.stock_short is None for _, _, decision in relevant_entries):
            primary_unavailability_reason = (
                ProcurementUnavailabilityReason.STOCK_UNVERIFIED
            )
        elif all(
            candidate.decision.selection_eligibility == SelectionEligibility.BLOCKED
            for candidate, _, _ in ranked_entries
        ):
            primary_unavailability_reason = (
                ProcurementUnavailabilityReason.TECHNICAL_UNAVAILABLE
            )
        elif all(
            offer.supplier not in policy.allowed_suppliers
            for _, offer, _ in relevant_entries
        ):
            primary_unavailability_reason = (
                ProcurementUnavailabilityReason.SUPPLIER_UNAVAILABLE
            )
        elif not any(
            decision.line_total is not None for _, _, decision in relevant_entries
        ):
            primary_unavailability_reason = (
                ProcurementUnavailabilityReason.PRICE_UNAVAILABLE
            )
        else:
            primary_unavailability_reason = ProcurementUnavailabilityReason.OTHER
    component_decision = ComponentProcurementDecision(
        status=status,
        selection_application_state=(
            SelectionApplicationState.AUTOMATIC_SELECTED
            if status == "automatic_recommended"
            else SelectionApplicationState.PROVISIONAL_SELECTED
            if status == "review_recommended"
            else SelectionApplicationState.NOT_SELECTED
        ),
        confirmation_required=status == "review_recommended",
        unavailability_reason_policy_version=(
            "supplier-procurement-unavailability-v1"
        ),
        primary_unavailability_reason=primary_unavailability_reason,
        procurement_disposition=query.procurement_disposition,
        required_quantity=query.quantity,
        target_currency=policy.target_currency,
        currency_rate_snapshot_id=policy.currency_rate_snapshot_id,
        currency_rate_as_of=policy.currency_rate_as_of,
        currency_rate_source=policy.currency_rate_source,
        technical_preselection_identity_key=technical_identity_key,
        technical_preselection_evidence_key=technical_evidence_key,
        application_candidate_identity_key=(
            application_group[0] if recommended_entry is not None else None
        ),
        application_candidate_evidence_key=(
            application_group[1] if recommended_entry is not None else None
        ),
        technical_fallback_used=(
            recommended_entry is not None
            and application_group != preselected_group
            and not price_optimization_used
        ),
        price_optimization_used=(
            recommended_entry is not None and price_optimization_used
        ),
        automatic_offer_key=(
            selected_offer_key
            if offer_recommendation == OfferRecommendation.AUTOMATIC
            else None
        ),
        review_offer_key=(
            selected_offer_key
            if offer_recommendation == OfferRecommendation.MANUAL_REVIEW
            else None
        ),
        recommendation_reason_codes=recommendation_reasons,
    )
    _validate_procurement_result(updated_candidates, component_decision)
    return updated_candidates, component_decision


def reevaluate_procurement(
    request: ProcurementReevaluationRequest,
) -> ProcurementReevaluationResult:
    """Recalculate purchasing fields without supplier, cache, or quota access."""

    stored_version = _stored_offer_key_version(request.candidates)
    _validate_candidate_groups(request.candidates)
    canonical_candidates = _canonicalize_duplicate_offers(
        request.candidates,
        stored_version or CURRENT_OFFER_KEY_VERSION,
    )
    technical_before = [
        candidate.decision.model_dump(mode="json") for candidate in canonical_candidates
    ]
    query = PlannedQuery(
        component_id=request.component_id,
        mode=SearchMode.INSUFFICIENT,
        quantity=request.required_quantity,
        procurement_disposition=request.procurement_disposition,
        quantity_resolution=request.quantity_resolution,
        disposition_reason_codes=request.disposition_reason_codes,
    )
    candidates, component_decision = apply_procurement_decisions(
        query,
        canonical_candidates,
        request.procurement_policy,
    )
    technical_after = [
        candidate.decision.model_dump(mode="json") for candidate in candidates
    ]
    if technical_after != technical_before:
        raise ProcurementReevaluationError(
            "technical_decision_mutated",
            "technical decisions changed during procurement reevaluation",
        )

    requested_key = request.requested_offer_key
    if requested_key is None:
        requested_offer = RequestedOfferEvaluation(
            status="not_requested",
            reason_codes=["requested_offer_not_provided"],
        )
    else:
        matches = [
            (candidate, offer.procurement_decision)
            for candidate in candidates
            for offer in candidate.product.offers
            if offer.procurement_decision is not None
            and offer.procurement_decision.offer_key == requested_key
        ]
        if len(matches) > 1:
            raise ProcurementReevaluationError(
                "requested_offer_key_ambiguous",
                "requested offer key is ambiguous",
                context={
                    "offer_key": requested_key,
                    "matching_offer_count": len(matches),
                },
            )
        if not matches:
            requested_offer = RequestedOfferEvaluation(
                requested_offer_key=requested_key,
                status="rejected",
                reason_codes=["requested_offer_not_found"],
            )
        else:
            candidate, offer_decision = matches[0]
            if candidate.decision.selection_eligibility == SelectionEligibility.BLOCKED:
                requested_offer = RequestedOfferEvaluation(
                    requested_offer_key=requested_key,
                    status="rejected",
                    reason_codes=["technical_candidate_blocked"],
                )
            elif not offer_decision.purchasable:
                requested_offer = RequestedOfferEvaluation(
                    requested_offer_key=requested_key,
                    status="rejected",
                    reason_codes=list(
                        dict.fromkeys(
                            [
                                "requested_offer_not_purchasable",
                                *offer_decision.reason_codes,
                            ]
                        )
                    ),
                )
            else:
                acceptance_mode = (
                    "automatic"
                    if candidate.decision.selection_eligibility
                    == SelectionEligibility.AUTOMATIC
                    else "manual_review"
                )
                requested_offer = RequestedOfferEvaluation(
                    requested_offer_key=requested_key,
                    status="accepted",
                    acceptance_mode=acceptance_mode,
                    reason_codes=[
                        "requested_offer_purchasable",
                        *(
                            ["manual_review_required"]
                            if acceptance_mode == "manual_review"
                            else ["automatic_candidate"]
                        ),
                    ],
                )

    return ProcurementReevaluationResult(
        component_id=request.component_id,
        candidates=candidates,
        procurement_decision=component_decision,
        requested_offer=requested_offer,
    )


def reevaluate_procurement_batch(
    request: ProcurementReevaluationBatchRequest,
) -> ProcurementReevaluationBatchResult:
    """컴포넌트별로 reevaluate_procurement 를 재사용하고 실패를 그 컴포넌트로만 격리한다.

    결정 알고리즘은 여기서 새로 만들지 않는다 — 배치 정책 + 컴포넌트별 입력을 기존
    ProcurementReevaluationRequest 로 재구성해 단건과 동일한 경로를 그대로 태운다.
    """

    results: list[ProcurementReevaluationBatchItemResult] = []
    for component in request.components:
        try:
            single = reevaluate_procurement(
                ProcurementReevaluationRequest(
                    component_id=component.component_id,
                    candidates=component.candidates,
                    required_quantity=component.required_quantity,
                    procurement_policy=request.procurement_policy,
                    requested_offer_key=component.requested_offer_key,
                    procurement_disposition=component.procurement_disposition,
                    quantity_resolution=component.quantity_resolution,
                    disposition_reason_codes=component.disposition_reason_codes,
                )
            )
        except ProcurementReevaluationError as error:
            results.append(
                ProcurementReevaluationBatchItemResult(
                    component_id=component.component_id,
                    status="error",
                    error_code=error.code,
                    error_message=str(error),
                )
            )
            continue
        except Exception as error:  # 한 컴포넌트의 예상 못한 실패가 배치 전체를 막지 않는다
            results.append(
                ProcurementReevaluationBatchItemResult(
                    component_id=component.component_id,
                    status="error",
                    error_code="unexpected_error",
                    error_message=f"{type(error).__name__}: {str(error)[:300]}",
                )
            )
            continue
        results.append(
            ProcurementReevaluationBatchItemResult(
                component_id=component.component_id,
                status="ok",
                candidates=single.candidates,
                procurement_decision=single.procurement_decision,
                requested_offer=single.requested_offer,
            )
        )
    return ProcurementReevaluationBatchResult(components=results)
