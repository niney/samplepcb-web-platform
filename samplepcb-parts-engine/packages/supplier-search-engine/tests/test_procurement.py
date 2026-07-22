from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from supplier_search_engine.matcher import (
    CandidateMatcher,
    finalize_candidate_decisions,
)
from supplier_search_engine.models import (
    ComponentProcurementDecision,
    CurrencyRate,
    OfferRecommendation,
    PlannedQuery,
    ProcurementDisposition,
    ProcurementPolicyInput,
    ProcurementReevaluationBatchRequest,
    ProcurementReevaluationCandidateInput,
    ProcurementReevaluationRequest,
    Requirement,
    QuantityResolution,
    SearchMode,
    SelectionEligibility,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from supplier_search_engine.procurement import (
    ProcurementReevaluationError,
    apply_procurement_decisions,
    reevaluate_procurement,
    reevaluate_procurement_batch,
    stable_offer_key,
)
from supplier_search_engine.service import SearchService


def requirement(name: str, value: float, comparison: str = "eq") -> Requirement:
    return Requirement(
        name=name,
        raw_value=value,
        normalized_value=value,
        status="extracted",
        hard=True,
        comparison=comparison,
    )


def query(*, component_id: str = "procurement", quantity: int | None = 105, requirements=None) -> PlannedQuery:
    return PlannedQuery(
        component_id=component_id,
        mode=SearchMode.IDENTITY,
        part_number="ABC123456",
        manufacturer="Acme",
        part_type="resistor",
        quantity=quantity,
        requirements=requirements or {},
    )


def product(
    supplier: Supplier,
    *,
    mpn: str = "ABC123456",
    manufacturer: str | None = "Acme",
    specs=None,
    stock: int | None = 1_000,
    moq: int | None = 1,
    multiple: int | None = 1,
    prices: list[tuple[int, float, str]] | None = None,
    sku: str | None = None,
    product_id: str | None = None,
    url: str | None = None,
) -> SupplierProduct:
    return SupplierProduct(
        supplier=supplier,
        supplier_product_id=product_id or f"{supplier.value}-product",
        manufacturer_part_number=mpn,
        manufacturer=manufacturer,
        normalized_specs=specs or {},
        offers=[
            SupplierOffer(
                supplier=supplier,
                supplier_sku=sku or f"{supplier.value}-sku",
                packaging="Cut Tape",
                stock=stock,
                moq=moq,
                order_multiple=multiple,
                price_breaks=[
                    {"quantity": quantity, "unit_price": price, "currency": currency}
                    for quantity, price, currency in (
                        prices if prices is not None else [(1, 1.0, "KRW")]
                    )
                ],
                product_url=url,
            )
        ],
    )


def policy(
    *, allow_short=False, allow_unverified=False, rates=None
) -> ProcurementPolicyInput:
    return ProcurementPolicyInput(
        target_currency="KRW",
        currency_rates=rates or [],
        currency_rate_snapshot_id="fixture-2026-07-21",
        currency_rate_source="pytest",
        allow_stock_shortage=allow_short,
        allow_unverified_stock=allow_unverified,
    )


def technical_candidates(planned: PlannedQuery, products):
    matcher = CandidateMatcher()
    candidates = finalize_candidate_decisions(
        planned,
        [matcher.evaluate(planned, item) for item in products],
    )
    candidates = SearchService._add_corroboration(candidates)
    candidates = SearchService._assign_technical_review_ranks(planned, candidates)
    return SearchService._assign_selection_recommendations(candidates, planned)


def decide(planned: PlannedQuery, products, procurement_policy=None):
    candidates = technical_candidates(planned, products)
    return apply_procurement_decisions(
        planned,
        candidates,
        procurement_policy or policy(),
    )


def offer_decision(candidate):
    return candidate.product.offers[0].procurement_decision


def test_required_quantity_moq_multiple_price_break_and_exchange_rate():
    planned = query(quantity=105)
    candidates, component = decide(
        planned,
        [
            product(
                Supplier.DIGIKEY,
                stock=500,
                moq=200,
                multiple=50,
                prices=[(200, 1.0, "USD"), (1, 2.0, "USD"), (100, 1.5, "USD")],
            )
        ],
        policy(
            rates=[
                CurrencyRate(
                    source_currency="USD",
                    target_currency="KRW",
                    rate=Decimal("1300.25"),
                )
            ]
        ),
    )

    decision = offer_decision(candidates[0])
    assert decision.order_quantity == 200
    assert decision.applied_price_break_quantity == 200
    assert decision.source_unit_price == Decimal("1.0")
    assert decision.converted_unit_price == Decimal("1300.250")
    assert decision.line_total == Decimal("260050.000")
    assert decision.surplus_quantity == 95
    assert decision.stock_short is False
    assert decision.recommendation == OfferRecommendation.AUTOMATIC
    assert component.status == "automatic_recommended"
    assert component.selection_application_state == "automatic_selected"
    assert component.confirmation_required is False
    assert component.automatic_offer_key == decision.offer_key
    assert (
        component.application_candidate_identity_key
        == component.technical_preselection_identity_key
    )
    assert (
        component.application_candidate_evidence_key
        == component.technical_preselection_evidence_key
    )
    assert component.technical_fallback_used is False


def test_required_quantity_reselects_price_break_without_changing_technical_keys():
    supplier_product = product(
        Supplier.MOUSER,
        prices=[(1, 10.0, "KRW"), (100, 8.0, "KRW")],
    )
    low, _ = decide(query(quantity=50), [supplier_product])
    high, _ = decide(query(quantity=150), [supplier_product])

    low_decision = offer_decision(low[0])
    high_decision = offer_decision(high[0])
    assert low_decision.applied_price_break_quantity == 1
    assert low_decision.line_total == Decimal("500.0")
    assert high_decision.applied_price_break_quantity == 100
    assert high_decision.line_total == Decimal("1200.0")
    assert low[0].decision.identity_key == high[0].decision.identity_key
    assert (
        low[0].decision.technical_evidence_key
        == high[0].decision.technical_evidence_key
    )


def test_stock_shortage_and_excessive_order_are_engine_decisions():
    candidates, _ = decide(
        query(quantity=10),
        [
            product(
                Supplier.DIGIKEY,
                stock=5,
                moq=100,
                multiple=100,
                prices=[(1, 1, "KRW")],
            )
        ],
    )

    decision = offer_decision(candidates[0])
    assert decision.order_quantity == 100
    assert decision.stock_short is True
    assert decision.stock_short_quantity == 95
    assert decision.excessive_order is True
    assert decision.purchasable is False
    assert decision.recommendation == OfferRecommendation.NONE
    assert "stock_shortage_not_allowed" in decision.reason_codes


def test_price_and_currency_rate_missing_degrade_without_fake_recommendation():
    missing_price, price_component = decide(
        query(quantity=10),
        [product(Supplier.DIGIKEY, prices=[])],
    )
    missing_rate, rate_component = decide(
        query(quantity=10),
        [product(Supplier.UNIKEYIC, prices=[(1, 1, "USD")])],
    )

    price_decision = offer_decision(missing_price[0])
    rate_decision = offer_decision(missing_rate[0])
    assert price_decision.line_total is None
    assert "price_break_unavailable_for_quantity" in price_decision.reason_codes
    assert rate_decision.line_total is None
    assert "currency_rate_missing" in rate_decision.reason_codes
    assert price_component.automatic_offer_key is None
    assert price_component.review_offer_key is None
    assert rate_component.automatic_offer_key is None
    assert rate_component.review_offer_key is None


def test_invalid_prices_are_never_ranked_or_recommended_as_free():
    supplier_product = product(Supplier.DIGIKEY, prices=[])
    supplier_product.offers[0].invalid_price_break_count = 4

    candidates, component = decide(query(quantity=10), [supplier_product])
    decision = offer_decision(candidates[0])

    assert decision.line_total is None
    assert decision.price_rank is None
    assert decision.purchasable is False
    assert decision.recommendation == OfferRecommendation.NONE
    assert "invalid_price" in decision.reason_codes
    assert "price_unavailable" in decision.reason_codes
    assert component.status == "no_recommendation"
    assert component.selection_application_state == "not_selected"
    assert component.confirmation_required is False


def test_exact_conflict_candidate_does_not_override_safer_exact_evidence():
    planned = query(
        quantity=10,
        requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)},
    )
    candidates, component = decide(
        planned,
        [
            product(
                Supplier.DIGIKEY,
                specs={"resistance_ohm": 1_000.0},
                prices=[(1, 10, "KRW")],
            ),
            product(
                Supplier.MOUSER,
                specs={"resistance_ohm": 2_000.0},
                prices=[(1, 1, "KRW")],
            ),
        ],
    )
    safe = next(
        item for item in candidates if item.product.supplier == Supplier.DIGIKEY
    )
    conflicting = next(
        item for item in candidates if item.product.supplier == Supplier.MOUSER
    )

    assert safe.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert offer_decision(safe).recommendation == OfferRecommendation.AUTOMATIC
    assert conflicting.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert "identity_exact_requirement_conflict" in conflicting.decision.reason_codes
    assert offer_decision(conflicting).price_rank == 1
    assert offer_decision(conflicting).purchase_fit_rank == 1
    assert offer_decision(conflicting).recommendation == OfferRecommendation.NONE
    assert component.automatic_offer_key == offer_decision(safe).offer_key


def test_exact_mpn_requirement_conflict_is_automatically_selected():
    candidates, component = decide(
        query(
            quantity=10,
            requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)},
        ),
        [
            product(
                Supplier.MOUSER,
                specs={"resistance_ohm": 2_000.0},
                prices=[(1, 1, "KRW")],
            )
        ],
    )

    candidate = candidates[0]
    assert candidate.decision.match_relation.value == "exact"
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert candidate.decision.selection_recommendation.value == "preselect"
    assert candidate.decision.review_recommended is False
    assert "identity_exact_requirement_conflict" in candidate.decision.reason_codes
    assert offer_decision(candidate).recommendation == OfferRecommendation.AUTOMATIC
    assert component.status == "automatic_recommended"
    assert component.selection_application_state == "automatic_selected"
    assert component.confirmation_required is False
    assert component.automatic_offer_key == offer_decision(candidate).offer_key


def test_manual_review_purchase_rank_never_promotes_technical_eligibility():
    candidates, component = decide(
        query(quantity=10),
        [product(Supplier.MOUSER, mpn="ABC123456TR", manufacturer="Other")],
    )

    candidate = candidates[0]
    assert (
        candidate.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    )
    assert candidate.decision.auto_eligible is False
    assert candidate.decision.review_recommended is True
    assert offer_decision(candidate).purchase_fit_rank == 1
    assert offer_decision(candidate).recommendation == OfferRecommendation.MANUAL_REVIEW
    assert component.status == "review_recommended"
    assert component.selection_application_state == "provisional_selected"
    assert component.confirmation_required is True
    assert component.automatic_offer_key is None
    assert component.review_offer_key == offer_decision(candidate).offer_key
    assert "manual_review_required" in component.recommendation_reason_codes

    with pytest.raises(
        ValueError,
        match="selection application state must match",
    ):
        ComponentProcurementDecision.model_validate(
            {
                **component.model_dump(),
                "selection_application_state": "automatic_selected",
            }
        )


def test_unpurchasable_technical_preselection_falls_back_to_next_safe_group():
    planned = query(quantity=10)
    candidates, component = decide(
        planned,
        [
            product(Supplier.DIGIKEY, prices=[]),
            product(
                Supplier.MOUSER,
                mpn="ABC123456TR",
                prices=[(1, 0.1, "KRW")],
            ),
        ],
    )

    exact = next(
        item for item in candidates if item.product.supplier == Supplier.DIGIKEY
    )
    variant = next(
        item for item in candidates if item.product.supplier == Supplier.MOUSER
    )
    assert exact.decision.selection_recommendation.value == "preselect"
    assert variant.decision.selection_recommendation.value == "candidate_only"
    assert offer_decision(variant).purchasable is True
    assert offer_decision(variant).recommendation == OfferRecommendation.AUTOMATIC
    assert component.technical_preselection_identity_key == exact.decision.identity_key
    assert component.application_candidate_identity_key == variant.decision.identity_key
    assert (
        component.application_candidate_evidence_key
        == variant.decision.technical_evidence_key
    )
    assert component.technical_fallback_used is True
    assert component.automatic_offer_key == offer_decision(variant).offer_key
    assert component.review_offer_key is None
    assert "technical_preselection_unpurchasable" in (
        component.recommendation_reason_codes
    )
    assert "next_purchasable_technical_group_selected" in (
        component.recommendation_reason_codes
    )
    assert "best_purchase_fit_in_fallback_group" in (
        component.recommendation_reason_codes
    )


def test_manual_review_fallback_is_provisional_and_keeps_technical_rank():
    planned = query(quantity=3)
    candidates, component = decide(
        planned,
        [
            product(
                Supplier.DIGIKEY,
                mpn="ABC123456R",
                manufacturer="Other",
                stock=0,
                prices=[(1, 280.8, "KRW")],
            ),
            product(
                Supplier.MOUSER,
                mpn="ABC123456TR",
                manufacturer="Other",
                stock=10_000,
                prices=[(1, 265.2, "KRW")],
            ),
        ],
    )

    technical = next(
        candidate
        for candidate in candidates
        if candidate.product.supplier == Supplier.DIGIKEY
    )
    applied = next(
        candidate
        for candidate in candidates
        if candidate.product.supplier == Supplier.MOUSER
    )
    assert technical.decision.technical_review_rank == 1
    assert applied.decision.technical_review_rank == 2
    assert offer_decision(technical).purchasable is False
    assert offer_decision(technical).recommendation == OfferRecommendation.NONE
    assert offer_decision(applied).recommendation == OfferRecommendation.MANUAL_REVIEW
    assert component.status == "review_recommended"
    assert component.selection_application_state == "provisional_selected"
    assert component.confirmation_required is True
    assert (
        component.technical_preselection_identity_key == technical.decision.identity_key
    )
    assert component.application_candidate_identity_key == applied.decision.identity_key
    assert component.review_offer_key == offer_decision(applied).offer_key
    assert component.technical_fallback_used is True


def test_all_unpurchasable_groups_remain_unselected():
    candidates, component = decide(
        query(quantity=3),
        [
            product(Supplier.DIGIKEY, stock=0),
            product(Supplier.MOUSER, mpn="ABC123456TR", stock=0),
        ],
    )

    assert all(
        offer_decision(candidate).recommendation == OfferRecommendation.NONE
        for candidate in candidates
    )
    assert component.status == "no_recommendation"
    assert component.selection_application_state == "not_selected"
    assert component.application_candidate_identity_key is None
    assert component.application_candidate_evidence_key is None
    assert component.technical_fallback_used is False
    assert "no_purchasable_candidate_group" in (component.recommendation_reason_codes)


def test_fallback_candidate_is_deterministic_across_candidate_input_order():
    planned = query(quantity=3)
    products = [
        product(Supplier.DIGIKEY, stock=0),
        product(Supplier.MOUSER, mpn="ABC123456TR", prices=[(1, 2, "KRW")]),
        product(Supplier.UNIKEYIC, mpn="ABC123456CT", prices=[(1, 1, "KRW")]),
    ]
    signatures = []
    for ordered in (products, list(reversed(products))):
        candidates, component = decide(planned, ordered)
        signatures.append(
            (
                component.technical_preselection_identity_key,
                component.application_candidate_identity_key,
                component.automatic_offer_key,
                [
                    (
                        candidate.decision.identity_key,
                        candidate.decision.technical_review_rank,
                    )
                    for candidate in sorted(
                        candidates,
                        key=lambda candidate: candidate.decision.identity_key,
                    )
                ],
            )
        )
    assert signatures[0] == signatures[1]
    selected_identity_key = next(
        candidate.decision.identity_key
        for candidate in decide(planned, products)[0]
        if candidate.product.supplier == Supplier.UNIKEYIC
    )
    assert signatures[0][1] == selected_identity_key


def test_same_evidence_group_chooses_purchase_fit_across_suppliers():
    candidates, component = decide(
        query(quantity=10),
        [
            product(Supplier.DIGIKEY, stock=1_000, prices=[(1, 2, "KRW")]),
            product(Supplier.MOUSER, stock=1_000, prices=[(1, 1, "KRW")]),
        ],
    )

    decisions = {item.product.supplier: offer_decision(item) for item in candidates}
    assert len({item.decision.identity_key for item in candidates}) == 1
    assert len({item.decision.technical_evidence_key for item in candidates}) == 1
    assert decisions[Supplier.MOUSER].price_rank == 1
    assert decisions[Supplier.MOUSER].purchase_fit_rank == 1
    assert decisions[Supplier.MOUSER].recommendation == OfferRecommendation.AUTOMATIC
    assert component.automatic_offer_key == decisions[Supplier.MOUSER].offer_key
    recommended = [
        (candidate, offer.procurement_decision)
        for candidate in candidates
        for offer in candidate.product.offers
        if offer.procurement_decision.recommendation != OfferRecommendation.NONE
    ]
    assert len(recommended) == 1
    assert recommended[0][0].decision.selection_eligibility == (
        SelectionEligibility.AUTOMATIC
    )
    assert (
        sum(
            offer.procurement_decision.offer_key == component.automatic_offer_key
            for candidate in candidates
            for offer in candidate.product.offers
        )
        == 1
    )


def test_multi_supplier_manual_group_only_returns_review_recommendation():
    candidates, component = decide(
        query(quantity=10),
        [
            product(
                Supplier.DIGIKEY,
                mpn="ABC123456TR",
                manufacturer="Other",
                prices=[(1, 2, "KRW")],
            ),
            product(
                Supplier.MOUSER,
                mpn="ABC123456TR",
                manufacturer="Other",
                prices=[(1, 1, "KRW")],
            ),
        ],
    )

    assert all(
        candidate.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
        for candidate in candidates
    )
    assert component.status == "review_recommended"
    assert component.automatic_offer_key is None
    assert component.review_offer_key is not None
    recommended = [
        (candidate, offer.procurement_decision)
        for candidate in candidates
        for offer in candidate.product.offers
        if offer.procurement_decision.recommendation != OfferRecommendation.NONE
    ]
    assert len(recommended) == 1
    selected_candidate, selected_offer = recommended[0]
    assert selected_candidate.decision.selection_eligibility == (
        SelectionEligibility.MANUAL_REVIEW
    )
    assert selected_offer.recommendation == OfferRecommendation.MANUAL_REVIEW
    assert selected_offer.offer_key == component.review_offer_key


def test_supplier_input_permutation_keeps_offer_keys_ranks_and_recommendation():
    products = [
        product(Supplier.DIGIKEY, prices=[(1, 2, "KRW")]),
        product(Supplier.MOUSER, prices=[(1, 1, "KRW")]),
    ]
    for supplier_product in products:
        supplier_product.offers.append(
            SupplierOffer(
                supplier=supplier_product.supplier,
                supplier_sku=f"{supplier_product.supplier.value}-reel",
                packaging="Reel",
                stock=1_000,
                moq=1,
                order_multiple=1,
                price_breaks=[
                    {
                        "quantity": 1,
                        "unit_price": (
                            3 if supplier_product.supplier == Supplier.DIGIKEY else 1.5
                        ),
                        "currency": "KRW",
                    }
                ],
            )
        )
    reversed_products = [
        supplier_product.model_copy(
            update={"offers": list(reversed(supplier_product.offers))},
            deep=True,
        )
        for supplier_product in reversed(products)
    ]
    signatures = []
    for ordered in (products, reversed_products):
        candidates, component = decide(query(quantity=10), ordered)
        signatures.append(
            (
                component.automatic_offer_key,
                {
                    offer.procurement_decision.offer_key: (
                        offer.procurement_decision.price_rank,
                        offer.procurement_decision.purchase_fit_rank,
                        offer.procurement_decision.recommendation,
                    )
                    for candidate in candidates
                    for offer in candidate.product.offers
                },
            )
        )
    assert signatures[0] == signatures[1]


def test_unknown_stock_is_distinct_from_zero_stock():
    unknown, _ = decide(
        query(quantity=10),
        [product(Supplier.DIGIKEY, stock=None)],
    )
    zero, _ = decide(
        query(quantity=10),
        [product(Supplier.DIGIKEY, stock=0)],
    )

    unknown_decision = offer_decision(unknown[0])
    zero_decision = offer_decision(zero[0])
    assert unknown_decision.stock_short is None
    assert unknown_decision.purchasable is False
    assert "stock_unverified" in unknown_decision.reason_codes
    assert "stock_unverified_not_allowed" in unknown_decision.reason_codes
    assert zero_decision.stock_short is True
    assert zero_decision.purchasable is False
    assert "stock_shortage_not_allowed" in zero_decision.reason_codes


def test_unverified_stock_can_be_allowed_without_becoming_verified():
    candidates, component = decide(
        query(quantity=10),
        [product(Supplier.DIGIKEY, stock=None)],
        policy(allow_unverified=True),
    )

    decision = offer_decision(candidates[0])
    assert decision.stock_short is None
    assert decision.purchasable is True
    assert decision.recommendation == OfferRecommendation.AUTOMATIC
    assert "stock_unverified" in decision.reason_codes
    assert "unverified_stock_allowed" in decision.reason_codes
    assert component.automatic_offer_key == decision.offer_key


def test_offer_key_ignores_url_price_stock_and_fetch_state():
    first_product = product(
        Supplier.DIGIKEY,
        stock=1,
        prices=[(1, 10, "KRW")],
        url="https://example.com/old",
    )
    second_product = product(
        Supplier.DIGIKEY,
        stock=999,
        prices=[(1, 1, "KRW")],
        url="https://example.com/new",
    )

    assert stable_offer_key(first_product, first_product.offers[0]) == stable_offer_key(
        second_product, second_product.offers[0]
    )


def test_offer_key_preserves_supplier_sku_punctuation_that_changes_identity():
    products = [
        product(
            Supplier.DIGIKEY,
            mpn=mpn,
            sku=sku,
        )
        for mpn, sku in (
            ("ERJ-3EKF1001V", "P1.00KHTR-ND"),
            ("ERJ-3EKF1002V", "P10.0KHTR-ND"),
            ("ERJ-3EKF1003V", "P100KHTR-ND"),
        )
    ]
    for supplier_product in products:
        # DigiKey keyword/parametric responses do not always contain ProductId.
        supplier_product.supplier_product_id = None

    keys = {
        stable_offer_key(supplier_product, supplier_product.offers[0])
        for supplier_product in products
    }

    assert len(keys) == 3
    assert all(key is not None and key.startswith("ok2:") for key in keys)
    candidates, _component = decide(query(quantity=1), products)
    assert len(
        {
            offer_decision(candidate).offer_key
            for candidate in candidates
        }
    ) == 3


def test_offer_key_treats_supplier_placeholder_identifiers_as_missing():
    placeholder = product(
        Supplier.MOUSER,
        mpn="SMB",
        manufacturer="MicroCare",
        sku="N/A",
        product_id="N/A",
    )

    assert stable_offer_key(placeholder, placeholder.offers[0]) is None
    candidates, component = decide(query(quantity=10), [placeholder])
    decision = offer_decision(candidates[0])
    assert decision.offer_key is None
    assert decision.purchasable is False
    assert "stable_offer_identity_unavailable" in decision.reason_codes
    assert component.automatic_offer_key is None
    assert component.review_offer_key is None


def test_placeholder_offer_keys_do_not_block_valid_supplier_offer():
    planned = query(quantity=10)
    candidates, component = decide(
        planned,
        [
            product(Supplier.DIGIKEY),
            product(
                Supplier.MOUSER,
                mpn="SMB",
                manufacturer="Keystone Electronics",
                sku="N/A",
                product_id="N/A",
            ),
            product(
                Supplier.MOUSER,
                mpn="SMB",
                manufacturer="MicroCare",
                sku="N/A",
                product_id="N/A",
            ),
        ],
    )

    decisions = [
        offer_decision(candidate)
        for candidate in candidates
        if candidate.product.offers
    ]
    valid_keys = [decision.offer_key for decision in decisions if decision.offer_key]
    assert len(valid_keys) == 1
    assert component.automatic_offer_key == valid_keys[0]
    assert sum(decision.offer_key is None for decision in decisions) == 2


def test_reevaluation_preserves_unique_legacy_offer_key_version():
    planned = query(quantity=10)
    candidates = technical_candidates(planned, [product(Supplier.DIGIKEY)])
    stored, _component = apply_procurement_decisions(
        planned,
        candidates,
        policy(),
        offer_key_version="supplier-offer-key-v1",
    )
    stored_decision = offer_decision(stored[0])

    result = reevaluate_procurement(
        ProcurementReevaluationRequest(
            component_id="procurement",
            candidates=stored,
            required_quantity=20,
            procurement_policy=policy(),
            requested_offer_key=stored_decision.offer_key,
        )
    )

    reevaluated = offer_decision(result.candidates[0])
    assert stored_decision.offer_key_version == "supplier-offer-key-v1"
    assert reevaluated.offer_key_version == "supplier-offer-key-v1"
    assert reevaluated.offer_key == stored_decision.offer_key


def test_reevaluation_cannot_bypass_unresolved_bom_quantity():
    planned = query(quantity=10)
    candidates = technical_candidates(planned, [product(Supplier.DIGIKEY)])

    result = reevaluate_procurement(
        ProcurementReevaluationRequest(
            component_id="procurement",
            candidates=candidates,
            required_quantity=20,
            procurement_policy=policy(),
            procurement_disposition=ProcurementDisposition.QUANTITY_CONFIRMATION_REQUIRED,
            quantity_resolution=QuantityResolution.CONFLICT,
            disposition_reason_codes=["quantity_reference_conflict"],
        )
    )

    decision = offer_decision(result.candidates[0])
    assert decision.purchasable is False
    assert "procurement_quantity_confirmation_required" in decision.reason_codes
    assert result.procurement_decision.status == "input_incomplete"
    assert result.procurement_decision.procurement_disposition == (
        ProcurementDisposition.QUANTITY_CONFIRMATION_REQUIRED
    )
    assert result.procurement_decision.automatic_offer_key is None
    assert result.procurement_decision.review_offer_key is None


def test_missing_stable_offer_identity_is_not_recommended():
    supplier_product = product(Supplier.DIGIKEY, product_id="", sku="")
    supplier_product.supplier_product_id = None
    supplier_product.offers[0].supplier_sku = None
    candidates, component = decide(query(quantity=10), [supplier_product])

    decision = offer_decision(candidates[0])
    assert decision.offer_key is None
    assert decision.purchasable is False
    assert decision.recommendation == OfferRecommendation.NONE
    assert "stable_offer_identity_unavailable" in decision.reason_codes
    assert component.automatic_offer_key is None
    assert component.review_offer_key is None


def test_price_stock_and_moq_never_change_technical_rank_or_evidence_key():
    planned = query(quantity=10)
    cheap, _ = decide(
        planned,
        [product(Supplier.DIGIKEY, stock=0, moq=1, prices=[(1, 1, "KRW")])],
    )
    expensive, _ = decide(
        planned,
        [
            product(
                Supplier.DIGIKEY,
                stock=1_000_000,
                moq=10_000,
                prices=[(1, 999, "KRW")],
            )
        ],
    )

    assert cheap[0].decision.technical_review_rank is None
    assert expensive[0].decision.technical_review_rank is None
    assert cheap[0].decision.identity_key == expensive[0].decision.identity_key
    assert (
        cheap[0].decision.technical_evidence_key
        == expensive[0].decision.technical_evidence_key
    )


def test_exact_bom_requirement_beats_compatible_margin_despite_confidence():
    planned = query(
        requirements={"power_w": requirement("power_w", 0.1, comparison="gte")}
    )
    matcher = CandidateMatcher()
    exact, margin = finalize_candidate_decisions(
        planned,
        [
            matcher.evaluate(
                planned,
                product(Supplier.DIGIKEY, specs={"power_w": 0.1}),
            ),
            matcher.evaluate(
                planned,
                product(Supplier.MOUSER, specs={"power_w": 0.2}),
            ),
        ],
    )
    exact = exact.model_copy(
        update={"identity_confidence": 0.1, "specification_confidence": 0.1}
    )
    margin = margin.model_copy(
        update={"identity_confidence": 1.0, "specification_confidence": 1.0}
    )

    ranked = sorted(
        [margin, exact],
        key=lambda candidate: SearchService._candidate_sort_key(candidate, planned),
    )
    assert ranked[0].product.supplier == Supplier.DIGIKEY


def test_reevaluation_matches_fresh_calculation_and_preserves_technical_decisions():
    products = [
        product(
            Supplier.DIGIKEY,
            stock=500,
            moq=20,
            multiple=10,
            prices=[(1, 10, "KRW"), (100, 8, "KRW")],
        )
    ]
    stored, _ = decide(query(quantity=50), products)
    stored_technical = [item.decision.model_dump(mode="json") for item in stored]
    requested_key = offer_decision(stored[0]).offer_key
    procurement_policy = policy()

    reevaluated = reevaluate_procurement(
        ProcurementReevaluationRequest(
            component_id="procurement",
            candidates=stored,
            required_quantity=150,
            procurement_policy=procurement_policy,
            requested_offer_key=requested_key,
        )
    )
    fresh_candidates, fresh_component = decide(
        query(quantity=150), products, procurement_policy
    )

    assert reevaluated.candidates == fresh_candidates
    assert reevaluated.procurement_decision == fresh_component
    assert [
        item.decision.model_dump(mode="json") for item in reevaluated.candidates
    ] == stored_technical
    assert offer_decision(reevaluated.candidates[0]).order_quantity == 150
    assert offer_decision(reevaluated.candidates[0]).applied_price_break_quantity == 100
    assert reevaluated.requested_offer.status == "accepted"
    assert reevaluated.requested_offer.acceptance_mode == "automatic"


def test_reevaluation_accepts_manual_offer_only_as_manual_review():
    stored, _ = decide(
        query(quantity=10),
        [product(Supplier.MOUSER, mpn="ABC123456TR", manufacturer="Other")],
    )
    offer_key = offer_decision(stored[0]).offer_key

    result = reevaluate_procurement(
        ProcurementReevaluationRequest(
            component_id="procurement",
            candidates=stored,
            required_quantity=10,
            procurement_policy=policy(),
            requested_offer_key=offer_key,
        )
    )

    assert result.procurement_decision.status == "review_recommended"
    assert (
        result.procurement_decision.selection_application_state
        == "provisional_selected"
    )
    assert result.procurement_decision.confirmation_required is True
    assert result.procurement_decision.automatic_offer_key is None
    assert result.procurement_decision.review_offer_key == offer_key
    assert result.requested_offer.status == "accepted"
    assert result.requested_offer.acceptance_mode == "manual_review"
    assert "manual_review_required" in result.requested_offer.reason_codes


def test_reevaluation_collapses_identical_duplicate_offer_key():
    stored = technical_candidates(
        query(quantity=10),
        [product(Supplier.DIGIKEY), product(Supplier.DIGIKEY)],
    )

    result = reevaluate_procurement(
        ProcurementReevaluationRequest(
            component_id="procurement",
            candidates=stored,
            required_quantity=10,
            procurement_policy=policy(),
        )
    )

    assert len(result.candidates) == 1
    assert len(result.candidates[0].product.offers) == 1
    decision = offer_decision(result.candidates[0])
    assert result.procurement_decision.automatic_offer_key == decision.offer_key
    assert decision.recommendation == OfferRecommendation.AUTOMATIC


def test_duplicate_offer_collapse_is_independent_of_candidate_order():
    older = product(Supplier.DIGIKEY, url="https://example.com/old")
    newer = product(Supplier.DIGIKEY, url="https://example.com/new")
    newer.offers[0].fetched_at = older.offers[0].fetched_at + timedelta(seconds=1)
    stored = technical_candidates(query(quantity=10), [older, newer])
    shared_policy = policy()

    def reevaluate(candidates):
        return reevaluate_procurement(
            ProcurementReevaluationRequest(
                component_id="procurement",
                candidates=candidates,
                required_quantity=10,
                procurement_policy=shared_policy,
            )
        )

    forward = reevaluate(stored)
    reversed_result = reevaluate(list(reversed(stored)))

    assert forward.procurement_decision == reversed_result.procurement_decision
    assert forward.candidates[0].product.offers[0].product_url == (
        "https://example.com/new"
    )
    assert reversed_result.candidates[0].product.offers[0].product_url == (
        "https://example.com/new"
    )


def test_reevaluation_fails_closed_for_conflicting_duplicate_offer_key():
    stored = technical_candidates(
        query(quantity=10),
        [product(Supplier.DIGIKEY), product(Supplier.DIGIKEY, stock=1)],
    )

    with pytest.raises(
        ProcurementReevaluationError,
        match="conflicting supplier or procurement data",
    ) as error:
        reevaluate_procurement(
            ProcurementReevaluationRequest(
                component_id="procurement",
                candidates=stored,
                required_quantity=10,
                procurement_policy=policy(),
            )
        )
    assert error.value.code == "duplicate_offer_key"
    assert error.value.context["duplicate_policy"] == "fail_closed_conflict"
    assert error.value.context["conflicting_sections"] == ["offer"]


def test_reevaluate_procurement_batch_matches_individual_reevaluation_per_component():
    """배치는 공유 정책 + 컴포넌트별 입력을 단건과 같은 경로로 태워 같은 결과를 낸다."""
    per_component_products = {
        "component-a": [
            product(
                Supplier.DIGIKEY,
                mpn="BATCH-A",
                stock=500,
                moq=20,
                multiple=10,
                prices=[(1, 10, "KRW"), (100, 8, "KRW")],
            )
        ],
        "component-b": [product(Supplier.MOUSER, mpn="BATCH-B", moq=1, multiple=1)],
    }
    shared_policy = policy()
    stored = {
        component_id: decide(query(component_id=component_id, quantity=50), items)[0]
        for component_id, items in per_component_products.items()
    }

    batch_result = reevaluate_procurement_batch(
        ProcurementReevaluationBatchRequest(
            procurement_policy=shared_policy,
            components=[
                ProcurementReevaluationCandidateInput(
                    component_id=component_id,
                    candidates=candidates,
                    required_quantity=150,
                )
                for component_id, candidates in stored.items()
            ],
        )
    )

    assert [item.status for item in batch_result.components] == ["ok", "ok"]
    by_id = {item.component_id: item for item in batch_result.components}
    for component_id, candidates in stored.items():
        individual = reevaluate_procurement(
            ProcurementReevaluationRequest(
                component_id=component_id,
                candidates=candidates,
                required_quantity=150,
                procurement_policy=shared_policy,
            )
        )
        assert by_id[component_id].candidates == individual.candidates
        assert by_id[component_id].procurement_decision == individual.procurement_decision
        assert by_id[component_id].requested_offer == individual.requested_offer


def test_reevaluate_procurement_batch_isolates_one_component_failure():
    """한 컴포넌트의 실패(중복 오퍼 키)가 배치의 나머지 컴포넌트를 막지 않는다."""
    healthy, _ = decide(
        query(component_id="component-ok", quantity=10),
        [product(Supplier.DIGIKEY, mpn="BATCH-OK")],
    )
    broken = technical_candidates(
        query(component_id="component-broken", quantity=10),
        [product(Supplier.DIGIKEY, mpn="BATCH-BROKEN"), product(Supplier.DIGIKEY, mpn="BATCH-BROKEN")],
    )
    broken[1].product.offers[0].stock = 1

    batch_result = reevaluate_procurement_batch(
        ProcurementReevaluationBatchRequest(
            procurement_policy=policy(),
            components=[
                ProcurementReevaluationCandidateInput(
                    component_id="component-ok", candidates=healthy, required_quantity=10,
                ),
                ProcurementReevaluationCandidateInput(
                    component_id="component-broken", candidates=broken, required_quantity=10,
                ),
            ],
        )
    )

    by_id = {item.component_id: item for item in batch_result.components}
    assert by_id["component-ok"].status == "ok"
    assert by_id["component-ok"].procurement_decision is not None
    assert by_id["component-broken"].status == "error"
    assert by_id["component-broken"].error_code == "duplicate_offer_key"
    assert by_id["component-broken"].candidates is None
    assert by_id["component-broken"].procurement_decision is None


def test_reevaluate_procurement_batch_rejects_duplicate_component_ids():
    healthy, _ = decide(query(component_id="dup", quantity=10), [product(Supplier.DIGIKEY)])
    with pytest.raises(ValueError, match="unique"):
        ProcurementReevaluationBatchRequest(
            procurement_policy=policy(),
            components=[
                ProcurementReevaluationCandidateInput(component_id="dup", candidates=healthy, required_quantity=10),
                ProcurementReevaluationCandidateInput(component_id="dup", candidates=healthy, required_quantity=10),
            ],
        )
