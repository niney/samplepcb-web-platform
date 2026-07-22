from __future__ import annotations

from itertools import permutations

import pytest
from pydantic import ValidationError

from supplier_search_engine.matcher import (
    CandidateMatcher,
    finalize_candidate_decisions,
    manufacturers_compatible,
)
from supplier_search_engine.models import (
    CandidateDecision,
    LifecycleState,
    ManufacturerEvidence,
    MatchRelation,
    PlannedQuery,
    Requirement,
    SearchMode,
    SelectionEligibility,
    SelectionRecommendation,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from supplier_search_engine.physical import (
    product_diameter_evidence,
    product_diameter_mm,
    product_mount_evidence,
    source_diameter_mm,
)
from supplier_search_engine.service import SearchService


def requirement(
    name: str,
    value: float | str,
    *,
    comparison: str = "eq",
) -> Requirement:
    return Requirement(
        name=name,
        raw_value=value,
        normalized_value=value,
        status="extracted",
        hard=True,
        comparison=comparison,
    )


def identity_query(
    *,
    manufacturer: str | None = "Acme",
    requirements: dict[str, Requirement] | None = None,
) -> PlannedQuery:
    return PlannedQuery(
        component_id="identity",
        mode=SearchMode.IDENTITY,
        part_number="ABC123456",
        manufacturer=manufacturer,
        part_type="resistor",
        requirements=requirements or {},
    )


def product(
    supplier: Supplier = Supplier.DIGIKEY,
    *,
    mpn: str = "ABC123456",
    manufacturer: str | None = "Acme",
    manufacturer_evidence: ManufacturerEvidence = ManufacturerEvidence.STRUCTURED,
    category: str = "Chip Resistors - Surface Mount",
    package: str | None = None,
    description: str | None = None,
    specs: dict[str, float | str | list[float | None] | None] | None = None,
    attributes: dict[str, object] | None = None,
    lifecycle_status: str | None = None,
    sku: str | None = None,
    supplier_product_id: str | None = None,
    product_url: str | None = None,
) -> SupplierProduct:
    return SupplierProduct(
        supplier=supplier,
        supplier_product_id=supplier_product_id,
        manufacturer_part_number=mpn,
        manufacturer=manufacturer,
        manufacturer_evidence=manufacturer_evidence,
        category=category,
        package=package,
        description=description,
        normalized_specs=specs or {},
        attributes=attributes or {},
        lifecycle_status=lifecycle_status,
        offers=[
            SupplierOffer(
                supplier=supplier,
                supplier_sku=sku,
                product_url=product_url,
            )
        ]
        if sku or product_url
        else [],
    )


def decide(query: PlannedQuery, *products: SupplierProduct):
    matcher = CandidateMatcher()
    return finalize_candidate_decisions(
        query,
        [matcher.evaluate(query, item) for item in products],
    )


def by_supplier(candidates, supplier: Supplier):
    return next(item for item in candidates if item.product.supplier == supplier)


def test_exact_mpn_and_canonical_manufacturer_are_automatic():
    query = identity_query(manufacturer="TI")
    candidate = decide(query, product(manufacturer="Texas Instruments"))[0]

    assert manufacturers_compatible("TI", "Texas Instruments") is True
    assert candidate.decision.match_relation == MatchRelation.EXACT
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert candidate.decision.auto_eligible is True
    assert candidate.decision.manual_selectable is True
    assert candidate.decision.reason_codes[0] == "identity_exact"


def test_exact_mpn_overrides_unregistered_manufacturer_name_for_selection():
    query = identity_query(manufacturer="Samsung")
    candidate = decide(query, product(manufacturer="Samsung Electro-Mechanics"))[0]

    assert manufacturers_compatible("Samsung", "Samsung Electro-Mechanics") is False
    assert candidate.decision.match_relation == MatchRelation.EXACT
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert candidate.decision.auto_eligible is True
    assert "manufacturer_confirmation_required" in candidate.decision.reason_codes


@pytest.mark.parametrize(
    ("manufacturer", "evidence"),
    [
        (None, ManufacturerEvidence.MISSING),
        ("Acme", ManufacturerEvidence.INFERRED),
    ],
)
def test_exact_mpn_overrides_missing_or_inferred_supplier_manufacturer(
    manufacturer: str | None,
    evidence: ManufacturerEvidence,
):
    candidate = decide(
        identity_query(),
        product(manufacturer=manufacturer, manufacturer_evidence=evidence),
    )[0]

    assert candidate.decision.match_relation == MatchRelation.EXACT
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert candidate.decision.auto_eligible is True
    assert candidate.decision.manual_selectable is True
    assert "manufacturer_confirmation_required" in candidate.decision.reason_codes


def test_exact_identity_keeps_missing_and_conflicting_details_automatic():
    query = identity_query(
        requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)}
    )
    missing_detail, real_conflict = decide(
        query,
        product(Supplier.DIGIKEY),
        product(Supplier.MOUSER, specs={"resistance_ohm": 2_000.0}),
    )

    assert missing_detail.decision.match_relation == MatchRelation.EXACT
    assert (
        missing_detail.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    )
    assert real_conflict.decision.match_relation == MatchRelation.EXACT
    assert real_conflict.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert real_conflict.decision.auto_eligible is True
    assert real_conflict.decision.manual_selectable is True
    assert real_conflict.decision.decision_policy_version == (
        "supplier-candidate-decision-v3"
    )
    assert "identity_exact_requirement_conflict" in real_conflict.decision.reason_codes
    assert "conflict:resistance_ohm_mismatch" in real_conflict.decision.reason_codes
    assert real_conflict.decision.requirement_assessments[0].state == "mismatch"


def test_variant_identity_with_real_requirement_conflict_remains_blocked():
    candidate = decide(
        identity_query(
            requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)}
        ),
        product(mpn="ABC123456TR", specs={"resistance_ohm": 2_000.0}),
    )[0]

    assert candidate.decision.match_relation == MatchRelation.VARIANT
    assert candidate.decision.selection_eligibility == SelectionEligibility.BLOCKED
    assert candidate.decision.manual_selectable is False
    assert "identity_exact_requirement_conflict" not in candidate.decision.reason_codes


def test_verified_packaging_variant_is_automatic():
    candidate = decide(identity_query(), product(mpn="ABC123456TR"))[0]

    assert candidate.decision.match_relation == MatchRelation.VARIANT
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def resistor_parametric_query(*, include_tolerance: bool = True) -> PlannedQuery:
    requirements = {
        "part_type": requirement("part_type", "resistor", comparison="category"),
        "resistance_ohm": requirement("resistance_ohm", 1_000.0),
        "power_w": requirement("power_w", 0.1, comparison="gte"),
        "package": requirement("package", "0603"),
    }
    if include_tolerance:
        requirements["tolerance_percent"] = requirement(
            "tolerance_percent", 1.0, comparison="lte"
        )
    return PlannedQuery(
        component_id="parametric",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        requirements=requirements,
    )


def resistor_specs():
    return {
        "resistance_ohm": 1_000.0,
        "power_w": 0.125,
        "tolerance_percent": 1.0,
        "package": "0603",
    }


def test_parametric_candidate_needs_complete_category_policy_for_automatic():
    complete = decide(
        resistor_parametric_query(),
        product(package="0603", specs=resistor_specs()),
    )[0]
    incomplete = decide(
        resistor_parametric_query(include_tolerance=False),
        product(package="0603", specs=resistor_specs()),
    )[0]

    assert complete.decision.match_relation == MatchRelation.SPEC_COMPATIBLE
    assert complete.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert complete.decision.verification_complete is True
    assert complete.decision.strict_category_coverage is True
    assert incomplete.decision.match_relation == MatchRelation.UNRESOLVED
    assert (
        incomplete.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    )
    assert (
        "category_coverage_missing:tolerance_percent"
        in incomplete.decision.reason_codes
    )


def test_candidate_text_cannot_weaken_bom_category_policy():
    query = PlannedQuery(
        component_id="capacitor-policy",
        mode=SearchMode.PARAMETRIC,
        part_type="capacitor",
        category_policy="capacitor",
        requirements={
            "capacitance_f": requirement("capacitance_f", 100e-6),
            "voltage_v": requirement("voltage_v", 16.0, comparison="gte"),
            "package": requirement("package", "7343"),
            "mount_style": requirement("mount_style", "smd"),
        },
    )
    specs = {"capacitance_f": 100e-6, "voltage_v": 25.0, "package": "7343"}
    general = decide(
        query,
        product(
            category="Capacitors",
            description="SMD capacitor",
            package="7343",
            specs=specs,
        ),
    )[0]
    electrolytic_claim = decide(
        query,
        product(
            category="Aluminum Electrolytic Capacitors",
            description="SMD electrolytic capacitor",
            package="7343",
            specs=specs,
        ),
    )[0]

    for candidate in (general, electrolytic_claim):
        assert candidate.decision.match_relation == MatchRelation.UNRESOLVED
        assert (
            candidate.decision.selection_eligibility
            == SelectionEligibility.MANUAL_REVIEW
        )
        assert "category_coverage_missing:dielectric" in candidate.decision.reason_codes
        assert (
            "category_coverage_missing:tolerance_percent"
            in candidate.decision.reason_codes
        )
        assert candidate.decision.required_requirement_count == 6

    assert (
        general.decision.technical_evidence_key
        == electrolytic_claim.decision.technical_evidence_key
    )


def test_unknown_parametric_category_is_manual_review():
    query = PlannedQuery(
        component_id="unknown-category",
        mode=SearchMode.PARAMETRIC,
        part_type="diode",
        requirements={"voltage_v": requirement("voltage_v", 5.0, comparison="gte")},
    )
    candidate = decide(
        query,
        product(category="Diodes", specs={"voltage_v": 10.0}),
    )[0]

    assert candidate.decision.match_relation == MatchRelation.UNRESOLVED
    assert (
        candidate.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    )
    assert (
        "category_coverage_missing:unsupported_category"
        in candidate.decision.reason_codes
    )


def test_mount_source_conflict_is_candidate_specific():
    query = identity_query(
        requirements={"mount_style": requirement("mount_style", "smd")}
    )
    candidates = decide(
        query,
        product(Supplier.DIGIKEY, description="SMD surface mount resistor"),
        product(Supplier.MOUSER, description="THT through-hole resistor"),
    )
    matching = by_supplier(candidates, Supplier.DIGIKEY)
    mismatching = by_supplier(candidates, Supplier.MOUSER)

    assert matching.decision.match_relation == MatchRelation.EXACT
    assert matching.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    ranked = SearchService._assign_technical_review_ranks(query, candidates)
    assert by_supplier(ranked, Supplier.DIGIKEY).decision.technical_review_rank is None
    assert "mount_style_match" in matching.reasons
    assert "mount_style_source_conflict" in matching.conflicts
    assert (
        mismatching.decision.selection_eligibility
        == SelectionEligibility.AUTOMATIC
    )
    assert "identity_exact_requirement_conflict" in mismatching.decision.reason_codes
    assert "mount_style_mismatch" in mismatching.conflicts


def test_all_diameters_are_checked_and_input_order_is_deterministic():
    query = identity_query(
        requirements={"diameter_mm": requirement("diameter_mm", 8.0)}
    )
    products = [
        product(Supplier.DIGIKEY, description="Diameter 8.0 mm"),
        product(Supplier.MOUSER, description="Ø8.2 mm"),
        product(Supplier.UNIKEYIC, description="직경 9.0 mm"),
    ]

    signatures = []
    for ordered in (products, list(reversed(products))):
        candidates = decide(query, *ordered)
        signatures.append(
            {
                candidate.product.supplier: (
                    candidate.decision.selection_eligibility,
                    tuple(candidate.conflicts),
                    candidate.decision.identity_key,
                    candidate.decision.technical_evidence_key,
                )
                for candidate in candidates
            }
        )
    assert signatures[0] == signatures[1]
    assert signatures[0][Supplier.DIGIKEY][0] == SelectionEligibility.AUTOMATIC
    assert signatures[0][Supplier.MOUSER][0] == SelectionEligibility.AUTOMATIC
    assert signatures[0][Supplier.UNIKEYIC][0] == SelectionEligibility.AUTOMATIC


def test_all_physical_values_within_candidate_are_order_independent():
    mount_query = identity_query(
        requirements={"mount_style": requirement("mount_style", "smd")}
    )
    mount_attributes = [
        ("Mounting Style Primary", "SMD"),
        ("Mounting Style Alternate", "Through Hole"),
    ]
    mount_candidates = [
        decide(
            mount_query,
            product(category="Resistors", attributes=dict(ordered)),
        )[0]
        for ordered in (mount_attributes, list(reversed(mount_attributes)))
    ]

    assert {
        evidence.value
        for evidence in product_mount_evidence(mount_candidates[0].product)
    } == {"smd", "through-hole"}
    assert all(
        candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
        for candidate in mount_candidates
    )
    assert all(
        "mount_style_source_conflict" in candidate.conflicts
        and "mount_style_mismatch" in candidate.conflicts
        for candidate in mount_candidates
    )
    assert (
        mount_candidates[0].decision.technical_evidence_key
        == mount_candidates[1].decision.technical_evidence_key
    )

    diameter_query = identity_query(
        requirements={"diameter_mm": requirement("diameter_mm", 8.0)}
    )
    diameter_attributes = [
        ("Diameter Primary", "8.0 mm"),
        ("Diameter Alternate", "9.0 mm"),
    ]
    diameter_candidates = [
        decide(
            diameter_query,
            product(category="Capacitors", attributes=dict(ordered)),
        )[0]
        for ordered in (diameter_attributes, list(reversed(diameter_attributes)))
    ]

    assert {
        evidence.value_mm
        for evidence in product_diameter_evidence(diameter_candidates[0].product)
    } == {8.0, 9.0}
    assert all(
        candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
        for candidate in diameter_candidates
    )
    assert all(
        "diameter_mm_source_conflict" in candidate.conflicts
        and "diameter_mm_mismatch" in candidate.conflicts
        for candidate in diameter_candidates
    )
    assert (
        diameter_candidates[0].decision.technical_evidence_key
        == diameter_candidates[1].decision.technical_evidence_key
    )


def test_normalized_mount_style_and_mounting_style_attribute_are_used():
    candidate = product(
        category="Resistors",
        specs={"mount_style": "SMD"},
        attributes={"Mounting Style": "Surface Mount"},
    )

    evidence = product_mount_evidence(candidate)

    assert {item.value for item in evidence} == {"smd"}
    assert {item.source for item in evidence} == {
        "attributes.Mounting Style",
        "normalized_specs.mount_style",
    }


def test_rectangular_crystal_dimensions_are_not_diameter():
    crystal = product(
        category="Crystals",
        package="4-SMD(1.6x1.2)",
        description="32MHz crystal 4-SMD 1.6 x 1.2 mm",
    )
    electrolytic = product(
        category="Aluminum Electrolytic Capacitors",
        description="Radial cylindrical can 8 x 10.2 mm",
    )

    assert source_diameter_mm("XTAL/1612 1.6 x 1.2 mm") is None
    assert product_diameter_mm(crystal) is None
    assert product_diameter_mm(electrolytic) == 8.0


def test_varistor_disc_size_is_contextual_diameter_not_generic_dimension():
    assert source_diameter_mm("VARISTOR 7mm DIP type") == 7.0
    assert source_diameter_mm("connector 7mm DIP type") is None


def test_unknown_manufacturers_have_supplier_stable_separate_identities():
    query = identity_query(manufacturer=None)
    products = [
        product(Supplier.DIGIKEY, manufacturer=None, sku="DK-1"),
        product(Supplier.MOUSER, manufacturer=None, sku="MS-1"),
    ]
    first = decide(query, *products)
    second = decide(query, *reversed(products))
    first_keys = {
        candidate.product.supplier: candidate.decision.identity_key
        for candidate in first
    }
    second_keys = {
        candidate.product.supplier: candidate.decision.identity_key
        for candidate in second
    }

    assert first_keys == second_keys
    assert len(set(first_keys.values())) == 2
    assert all(
        candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
        for candidate in first
    )


def test_unknown_manufacturer_identity_never_depends_on_product_url():
    query = identity_query(manufacturer=None)
    first = decide(
        query,
        product(
            Supplier.DIGIKEY,
            manufacturer=None,
            product_url="https://www.digikey.kr/product/a?locale=ko#offer",
        ),
    )[0]
    second = decide(
        query,
        product(
            Supplier.DIGIKEY,
            manufacturer=None,
            product_url="https://www.digikey.com/en/products/detail/renamed-a",
        ),
    )[0]

    assert first.decision.identity_key == second.decision.identity_key
    assert (
        first.decision.technical_evidence_key == second.decision.technical_evidence_key
    )


def test_supplier_product_id_is_primary_unknown_manufacturer_locator():
    query = identity_query(manufacturer=None)
    first = decide(
        query,
        product(
            Supplier.DIGIKEY,
            manufacturer=None,
            supplier_product_id="DK-PRODUCT-42",
            sku="OLD-SKU",
            product_url="https://example.com/old",
        ),
    )[0]
    same_product = decide(
        query,
        product(
            Supplier.DIGIKEY,
            manufacturer=None,
            supplier_product_id="dk-product-42",
            sku="NEW-SKU",
            product_url="https://example.com/new",
        ),
    )[0]
    different_product = decide(
        query,
        product(
            Supplier.DIGIKEY,
            manufacturer=None,
            supplier_product_id="DK-PRODUCT-43",
            sku="OLD-SKU",
        ),
    )[0]

    assert first.decision.identity_key == same_product.decision.identity_key
    assert first.decision.identity_key != different_product.decision.identity_key


def test_inferred_manufacturer_is_not_merged_into_structured_identity():
    candidates = decide(
        identity_query(manufacturer=None),
        product(Supplier.DIGIKEY, manufacturer="Acme"),
        product(
            Supplier.MOUSER,
            manufacturer="Acme",
            manufacturer_evidence=ManufacturerEvidence.INFERRED,
            sku="MS-INFERRED",
        ),
    )
    structured = by_supplier(candidates, Supplier.DIGIKEY)
    inferred = by_supplier(candidates, Supplier.MOUSER)

    assert structured.decision.identity_key != inferred.decision.identity_key
    assert structured.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert inferred.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_exact_mpn_is_automatic_across_multiple_supplier_manufacturers():
    no_bom_manufacturer = decide(
        identity_query(manufacturer=None),
        product(Supplier.DIGIKEY, manufacturer="Acme"),
        product(Supplier.MOUSER, manufacturer="Other Corp"),
    )
    assert all(
        candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
        for candidate in no_bom_manufacturer
    )
    assert all(
        "manufacturer_source_conflict" in candidate.conflicts
        for candidate in no_bom_manufacturer
    )

    with_bom_manufacturer = decide(
        identity_query(manufacturer="Acme"),
        product(Supplier.DIGIKEY, manufacturer="Acme"),
        product(Supplier.MOUSER, manufacturer="Other Corp"),
    )
    assert (
        by_supplier(
            with_bom_manufacturer, Supplier.DIGIKEY
        ).decision.selection_eligibility
        == SelectionEligibility.AUTOMATIC
    )
    assert (
        by_supplier(
            with_bom_manufacturer, Supplier.MOUSER
        ).decision.selection_eligibility
        == SelectionEligibility.AUTOMATIC
    )


def test_different_evidence_does_not_corroborate_or_inflate_safe_candidate():
    query = identity_query(
        requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)}
    )
    candidates = decide(
        query,
        product(Supplier.DIGIKEY, specs={"resistance_ohm": 1_000.0}),
        product(Supplier.MOUSER),
        product(Supplier.UNIKEYIC, specs={"resistance_ohm": 2_000.0}),
    )
    corroborated = SearchService._add_corroboration(candidates)
    ranked = sorted(corroborated, key=SearchService._candidate_sort_key)

    assert len({candidate.decision.identity_key for candidate in corroborated}) == 1
    assert (
        len({candidate.decision.technical_evidence_key for candidate in corroborated})
        == 3
    )
    assert all(
        len(candidate.corroborating_suppliers) == 1 for candidate in corroborated
    )
    assert ranked[0].decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert (
        ranked[-1].decision.selection_eligibility
        == SelectionEligibility.AUTOMATIC
    )


def test_manual_review_evidence_groups_receive_deterministic_technical_ranks():
    query = PlannedQuery(
        component_id="review-rank",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        category_policy="resistor",
        requirements={
            "resistance_ohm": requirement("resistance_ohm", 1_000.0),
            "power_w": requirement("power_w", 0.1),
            "tolerance_percent": requirement("tolerance_percent", 1.0),
        },
    )
    stronger_specs = {
        "resistance_ohm": 1_000.0,
        "power_w": 0.1,
        "tolerance_percent": 1.0,
    }
    products = [
        product(Supplier.MOUSER, mpn="STRONG", specs=stronger_specs),
        product(
            Supplier.DIGIKEY,
            mpn="WEAK",
            specs={"resistance_ohm": 1_000.0},
        ),
        product(Supplier.DIGIKEY, mpn="STRONG", specs=stronger_specs),
    ]

    signatures = []
    for ordered in permutations(products):
        candidates = decide(query, *ordered)
        candidates = SearchService._add_corroboration(candidates)
        candidates = SearchService._assign_technical_review_ranks(query, candidates)
        candidates = SearchService._assign_selection_recommendations(candidates)
        candidates.sort(key=SearchService._candidate_sort_key)
        signatures.append(
            [
                (
                    candidate.product.manufacturer_part_number,
                    candidate.product.supplier,
                    candidate.decision.technical_review_rank,
                    candidate.decision.selection_recommendation,
                    candidate.decision.review_recommended,
                )
                for candidate in candidates
            ]
        )

    assert all(signature == signatures[0] for signature in signatures)
    assert [item[2:] for item in signatures[0] if item[0] == "STRONG"] == [
        (1, SelectionRecommendation.PRESELECT, True),
        (1, SelectionRecommendation.PRESELECT, True),
    ]
    assert [item[2:] for item in signatures[0] if item[0] == "WEAK"] == [
        (None, SelectionRecommendation.CANDIDATE_ONLY, False)
    ]


def test_exact_conflict_candidate_is_automatic_but_safe_evidence_is_preselected():
    query = identity_query(
        requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)}
    )
    candidates = decide(
        query,
        product(Supplier.DIGIKEY, specs={"resistance_ohm": 1_000.0}),
        product(Supplier.MOUSER, specs={"resistance_ohm": 2_000.0}),
    )

    ranked = SearchService._assign_technical_review_ranks(query, candidates)
    ranked = SearchService._assign_selection_recommendations(ranked)

    safe, conflicting = ranked
    assert safe.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert safe.decision.technical_review_rank is None
    assert safe.decision.selection_recommendation == SelectionRecommendation.PRESELECT
    assert safe.decision.review_recommended is False
    assert conflicting.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert conflicting.decision.technical_review_rank is None
    assert (
        conflicting.decision.selection_recommendation
        == SelectionRecommendation.CANDIDATE_ONLY
    )
    assert conflicting.decision.review_recommended is False


def test_review_rank_prefers_exact_bom_values_over_compatible_margin():
    query = PlannedQuery(
        component_id="capacitor-review-rank",
        mode=SearchMode.PARAMETRIC,
        part_type="capacitor",
        category_policy="capacitor",
        requirements={
            "capacitance_f": requirement("capacitance_f", 2.2e-6),
            "tolerance_percent": requirement(
                "tolerance_percent",
                20.0,
                comparison="lte",
            ),
            "voltage_v": requirement("voltage_v", 2.5, comparison="gte"),
            "part_type": requirement(
                "part_type",
                "capacitor",
                comparison="category",
            ),
        },
    )
    common_specs = {
        "capacitance_f": 2.2e-6,
        "tolerance_percent": 20.0,
    }
    candidates = decide(
        query,
        product(
            Supplier.DIGIKEY,
            mpn="HIGHER-VOLTAGE",
            category="capacitor",
            specs={**common_specs, "voltage_v": 6.3},
            lifecycle_status="Active",
        ),
        product(
            Supplier.MOUSER,
            mpn="EXACT-VOLTAGE",
            category="capacitor",
            specs={**common_specs, "voltage_v": 2.5},
        ),
    )
    candidates = SearchService._add_corroboration(candidates)
    candidates = SearchService._assign_technical_review_ranks(query, candidates)
    candidates = SearchService._assign_selection_recommendations(candidates)
    candidates.sort(key=SearchService._candidate_sort_key)

    assert [
        (
            candidate.product.manufacturer_part_number,
            candidate.decision.technical_review_rank,
            candidate.decision.selection_recommendation,
            candidate.decision.review_recommended,
        )
        for candidate in candidates
    ] == [
        (
            "EXACT-VOLTAGE",
            1,
            SelectionRecommendation.PRESELECT,
            True,
        ),
        (
            "HIGHER-VOLTAGE",
            2,
            SelectionRecommendation.CANDIDATE_ONLY,
            False,
        ),
    ]


def test_lifecycle_caution_does_not_block_exact_identity():
    candidate = decide(
        identity_query(),
        product(lifecycle_status="NRND - not recommended for new designs"),
    )[0]

    assert candidate.decision.lifecycle_state == LifecycleState.CAUTION
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert "lifecycle_caution" in candidate.decision.reason_codes


def test_identity_keys_and_final_sort_are_permutation_stable():
    query = identity_query()
    products = [
        product(Supplier.DIGIKEY, sku="DK"),
        product(Supplier.MOUSER, sku="MS"),
        product(Supplier.UNIKEYIC, sku="UK"),
    ]
    signatures = []
    for ordered in permutations(products):
        candidates = decide(query, *ordered)
        candidates = SearchService._add_corroboration(candidates)
        candidates.sort(key=SearchService._candidate_sort_key)
        signatures.append(
            [
                (
                    candidate.product.supplier,
                    candidate.decision.identity_key,
                    candidate.decision.technical_evidence_key,
                )
                for candidate in candidates
            ]
        )
    assert all(signature == signatures[0] for signature in signatures)


def test_candidate_decision_rejects_contradictory_selection_booleans():
    candidate = decide(identity_query(), product())[0]
    payload = candidate.decision.model_dump(mode="json")
    payload["auto_eligible"] = False

    with pytest.raises(ValidationError):
        CandidateDecision.model_validate(payload)


def test_candidate_decision_rejects_review_rank_for_non_manual_candidate():
    candidate = decide(identity_query(), product())[0]
    payload = candidate.decision.model_dump(mode="json")
    payload["technical_review_rank"] = 1

    with pytest.raises(ValidationError):
        CandidateDecision.model_validate(payload)


def test_candidate_decision_rejects_preselection_without_required_review():
    candidate = decide(
        identity_query(manufacturer="Other"),
        product(mpn="ABC123456TR", manufacturer="Acme"),
    )[0]
    payload = candidate.decision.model_dump(mode="json")
    payload["selection_recommendation"] = "preselect"

    with pytest.raises(ValidationError):
        CandidateDecision.model_validate(payload)


def test_legacy_blocked_decision_defaults_to_excluded_recommendation():
    candidate = decide(
        identity_query(
            requirements={"resistance_ohm": requirement("resistance_ohm", 1_000.0)}
        ),
        product(mpn="ABC123456TR", specs={"resistance_ohm": 2_000.0}),
    )[0]
    payload = candidate.decision.model_dump(mode="json")
    payload["decision_policy_version"] = "supplier-candidate-decision-v1"
    del payload["selection_recommendation"]
    del payload["review_recommended"]

    restored = CandidateDecision.model_validate(payload)

    assert restored.selection_recommendation == SelectionRecommendation.EXCLUDE
    assert restored.review_recommended is False
