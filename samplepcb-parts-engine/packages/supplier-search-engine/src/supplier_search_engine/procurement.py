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
    OfferProcurementDecision,
    OfferRecommendation,
    PlannedQuery,
    ProcurementPolicyInput,
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


def _validate_unique_offer_keys(candidates: list[CandidateMatch]) -> None:
    occurrences: dict[str, int] = {}
    stored_key_mismatches: list[dict[str, Any]] = []
    for candidate in candidates:
        for offer in candidate.product.offers:
            offer_key = stable_offer_key(candidate.product, offer)
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
                occurrences[offer_key] = occurrences.get(offer_key, 0) + 1
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
    duplicate_keys = sorted(
        key for key, occurrence_count in occurrences.items() if occurrence_count > 1
    )
    if duplicate_keys:
        duplicate_key = duplicate_keys[0]
        raise ProcurementReevaluationError(
            "duplicate_offer_key",
            "stable offer keys must identify exactly one stored offer",
            context={
                "offer_key": duplicate_key,
                "occurrence_count": occurrences[duplicate_key],
                "duplicate_policy": "fail_closed",
            },
        )


def _stable_token(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return re.sub(r"[^\w]+", "", normalized, flags=re.UNICODE).replace("_", "")


def stable_offer_key(product: SupplierProduct, offer: SupplierOffer) -> str | None:
    """Create a URL/price/stock/time-independent supplier-owned offer key."""

    product_id = _stable_token(product.supplier_product_id)
    supplier_sku = _stable_token(offer.supplier_sku)
    if not product_id and not supplier_sku:
        return None
    payload = {
        "packaging": _stable_token(offer.packaging),
        "product_id": product_id,
        "supplier": offer.supplier.value,
        "supplier_sku": supplier_sku,
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]
    return f"ok1:{digest}"


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


def _offer_decision(
    query: PlannedQuery,
    candidate: CandidateMatch,
    offer: SupplierOffer,
    policy: ProcurementPolicyInput,
) -> OfferProcurementDecision:
    reasons: list[str] = []
    offer_key = stable_offer_key(candidate.product, offer)
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
) -> tuple[list[CandidateMatch], ComponentProcurementDecision]:
    """Calculate offers without allowing purchasing data to mutate technical order."""

    preselected_group = _validate_candidate_groups(candidates)
    _validate_unique_offer_keys(candidates)
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
                    _offer_decision(query, candidate, offer, policy),
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
    recommended_identity_key: str | None = None
    recommended_evidence_key: str | None = None
    if preselected_group is None:
        recommendation_reasons.append("technical_preselection_unavailable")
    else:
        recommended_identity_key, recommended_evidence_key = preselected_group
        recommendation_reasons.append("technical_preselection_preserved")
        eligible_entries = [
            (ci, oi, decision)
            for (ci, oi), decision in decisions.items()
            if candidates[ci].decision.identity_key == recommended_identity_key
            and candidates[ci].decision.technical_evidence_key
            == recommended_evidence_key
            and decision.purchasable
        ]
        if eligible_entries:
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
            recommendation_reasons.append("best_purchase_fit_in_technical_group")
            if offer_recommendation == OfferRecommendation.MANUAL_REVIEW:
                recommendation_reasons.append("manual_review_required")
            else:
                recommendation_reasons.append("automatic_candidate")
        else:
            recommendation_reasons.append(
                "preselected_technical_group_has_no_purchasable_offer"
            )

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
        if query.quantity is None
        else "automatic_recommended"
        if offer_recommendation == OfferRecommendation.AUTOMATIC
        else "review_recommended"
        if offer_recommendation == OfferRecommendation.MANUAL_REVIEW
        else "no_recommendation"
    )
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
        required_quantity=query.quantity,
        target_currency=policy.target_currency,
        currency_rate_snapshot_id=policy.currency_rate_snapshot_id,
        currency_rate_as_of=policy.currency_rate_as_of,
        currency_rate_source=policy.currency_rate_source,
        technical_preselection_identity_key=recommended_identity_key,
        technical_preselection_evidence_key=recommended_evidence_key,
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

    technical_before = [
        candidate.decision.model_dump(mode="json") for candidate in request.candidates
    ]
    query = PlannedQuery(
        component_id=request.component_id,
        mode=SearchMode.INSUFFICIENT,
        quantity=request.required_quantity,
    )
    candidates, component_decision = apply_procurement_decisions(
        query,
        request.candidates,
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
