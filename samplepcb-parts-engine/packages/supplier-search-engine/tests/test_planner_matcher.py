from __future__ import annotations

from supplier_search_engine.contract import VALUE_FIELDS
from supplier_search_engine.contract import SearchComponentInput, SearchField

from supplier_search_engine.matcher import (
    CandidateMatcher,
    finalize_candidate_decisions,
    infer_supplier_part_type,
    manufacturers_compatible,
)
from supplier_search_engine.models import (
    MatchStatus,
    SelectionEligibility,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from supplier_search_engine.planner import QueryPlanner


def component(**values) -> SearchComponentInput:
    fields = {
        name: SearchField(
            value=values.get(name),
            status="extracted" if values.get(name) is not None else "not_found",
        )
        for name in VALUE_FIELDS
    }
    return SearchComponentInput(
        component_id="component-1",
        source_file="bom.xlsx",
        sheet_name="BOM",
        sheet_index_0based=0,
        source_rows_1based=[2],
        description=values.get("description"),
        review_status="accepted",
        fields=fields,
    )


def test_planner_uses_only_extracted_values_as_hard_requirements():
    item = component(part_number="RC0603FR-0710KL", resistance="10kΩ", tolerance="1%")
    item.fields["tolerance"].status = "review"

    query = QueryPlanner().plan(item)

    assert query.mode.value == "identity"
    assert query.requirements["resistance_ohm"].hard is True
    assert query.requirements["tolerance_percent"].hard is False


def test_identity_query_can_build_spec_only_fallback_with_sufficient_evidence():
    planner = QueryPlanner()
    query = planner.plan(
        component(
            part_number="0603X03L_C",
            manufacturer="Murata",
            part_type="capacitor",
            capacitance="10uF",
            voltage="6.3V",
            package="0402",
        )
    )

    fallback = planner.parametric_fallback(query)

    assert query.mode.value == "identity"
    assert fallback is not None
    assert fallback.mode.value == "parametric"
    assert fallback.part_number is None
    assert fallback.manufacturer is None
    assert fallback.keywords == "10uF 0402"
    assert fallback.requirements == query.requirements


def test_identity_query_without_two_hard_specs_has_no_parametric_fallback():
    planner = QueryPlanner()
    query = planner.plan(component(part_number="ABC-123", package="0603"))

    assert planner.parametric_fallback(query) is None


def test_identity_query_can_fallback_with_one_type_specific_primary_value():
    planner = QueryPlanner()
    query = planner.plan(
        component(
            part_number="0603X03L_C",
            part_type="resistor",
            resistance="1K",
        )
    )

    fallback = planner.parametric_fallback(query)

    assert fallback is not None
    assert fallback.mode.value == "parametric"
    assert fallback.keywords == "1k"


def test_exact_mpn_with_hard_spec_conflict_is_input_conflict():
    query = QueryPlanner().plan(
        component(
            part_number="RC0603FR-0710KL", manufacturer="Yageo", resistance="10kΩ"
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RC0603FR-0710KL",
        manufacturer="Yageo",
        normalized_specs={"resistance_ohm": 1_000.0},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.INPUT_CONFLICT
    assert "resistance_ohm_mismatch" in match.conflicts
    assert match.decision.selection_eligibility == SelectionEligibility.BLOCKED
    assert match.decision.manual_selectable is False


def test_exact_mpn_with_only_manufacturer_mismatch_requires_manual_review():
    query = QueryPlanner().plan(
        component(
            part_number="RVT1J101M1010",
            manufacturer="HONOR(荣誉)",
            package="SMD",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RVT1J101M1010",
        manufacturer="HONORCAP",
        description="Aluminum Electrolytic Capacitor",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.INPUT_CONFLICT
    assert match.conflicts == ["manufacturer_mismatch"]
    assert set(match.missing_requirements) == {"mount_style", "package"}
    assert match.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    assert match.decision.auto_eligible is False
    assert match.decision.manual_selectable is True
    assert "manufacturer_confirmation_required" in match.decision.reason_codes


def test_exact_mpn_with_missing_supplier_manufacturer_requires_manual_review():
    query = QueryPlanner().plan(
        component(part_number="RVT1J101M1010", manufacturer="HONOR")
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RVT1J101M1010",
        manufacturer=None,
        description="Aluminum Electrolytic Capacitor",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.missing_requirements == ["manufacturer"]
    assert match.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    assert match.decision.auto_eligible is False
    assert match.decision.manual_selectable is True
    assert "manufacturer_confirmation_required" in match.decision.reason_codes


def test_exact_mpn_with_physical_conflict_is_blocked_by_engine():
    query = QueryPlanner().plan(
        component(
            part_number="CAP-100UF",
            manufacturer="Maker",
            description="SMD electrolytic Ø6.3mm",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="CAP-100UF",
        manufacturer="Maker",
        description="Radial, Can through-hole diameter 6.3 mm",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert query.requirements["mount_style"].normalized_value == "smd"
    assert query.requirements["diameter_mm"].normalized_value == 6.3
    assert "mount_style_mismatch" in match.conflicts
    assert match.decision.selection_eligibility == SelectionEligibility.BLOCKED


def test_supplier_group_physical_disagreement_blocks_every_member():
    query = QueryPlanner().plan(
        component(part_number="CAP-SAME", description="SMD electrolytic Ø6.3mm")
    )
    base = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="CAP-SAME",
        manufacturer="Maker",
        description="SMD electrolytic diameter 6.3 mm",
    )
    other = base.model_copy(
        update={
            "supplier": Supplier.MOUSER,
            "description": "Radial, Can through-hole diameter 6.3 mm",
        }
    )

    matches = finalize_candidate_decisions(
        query,
        [
            CandidateMatcher().evaluate(query, base),
            CandidateMatcher().evaluate(query, other),
        ],
    )

    assert len({match.decision.identity_key for match in matches}) == 1
    assert all("mount_style_source_conflict" in match.conflicts for match in matches)
    assert all(
        match.decision.selection_eligibility == SelectionEligibility.BLOCKED
        for match in matches
    )


def test_supplier_group_diameter_decision_checks_every_value_without_order_bias():
    query = QueryPlanner().plan(
        component(part_number="CAP-SAME", description="SMD electrolytic Ø6.3mm")
    )
    near = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="CAP-SAME",
        manufacturer="Maker",
        description="SMD electrolytic diameter 6.5 mm",
    )
    far = near.model_copy(
        update={
            "supplier": Supplier.MOUSER,
            "description": "SMD electrolytic diameter 6.7 mm",
        }
    )

    decisions_by_order = []
    for products in ([near, far], [far, near]):
        matches = finalize_candidate_decisions(
            query,
            [CandidateMatcher().evaluate(query, product) for product in products],
        )
        decisions_by_order.append(
            sorted(
                (
                    match.product.supplier.value,
                    match.decision.identity_key,
                    tuple(match.conflicts),
                    match.decision.selection_eligibility,
                )
                for match in matches
            )
        )

    assert decisions_by_order[0] == decisions_by_order[1]
    assert all(
        "diameter_mm_mismatch" in conflicts
        and eligibility == SelectionEligibility.BLOCKED
        for _, _, conflicts, eligibility in decisions_by_order[0]
    )


def test_unknown_manufacturer_grouping_is_deterministic_with_multiple_makers():
    query = QueryPlanner().plan(component(part_number="SHARED-MPN"))
    products = [
        SupplierProduct(
            supplier=Supplier.DIGIKEY,
            manufacturer_part_number="SHARED-MPN",
            manufacturer=None,
        ),
        SupplierProduct(
            supplier=Supplier.MOUSER,
            manufacturer_part_number="SHARED-MPN",
            manufacturer="Maker A",
        ),
        SupplierProduct(
            supplier=Supplier.UNIKEYIC,
            manufacturer_part_number="SHARED-MPN",
            manufacturer="Maker B",
        ),
    ]

    identity_maps = []
    for ordered_products in (products, [products[2], products[0], products[1]]):
        matches = finalize_candidate_decisions(
            query,
            [
                CandidateMatcher().evaluate(query, product)
                for product in ordered_products
            ],
        )
        identity_maps.append(
            {
                match.product.supplier.value: match.decision.identity_key
                for match in matches
            }
        )

    assert identity_maps[0] == identity_maps[1]
    assert len(set(identity_maps[0].values())) == 3


def test_unknown_manufacturer_identity_uses_stable_supplier_locator_not_url():
    query = QueryPlanner().plan(component(part_number="SHARED-MPN"))

    def identity_key(product: SupplierProduct) -> str:
        return finalize_candidate_decisions(
            query,
            [CandidateMatcher().evaluate(query, product)],
        )[0].decision.identity_key

    first = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        supplier_product_id="DK-PRODUCT-42",
        manufacturer_part_number="SHARED-MPN",
        manufacturer=None,
        offers=[
            SupplierOffer(
                supplier=Supplier.DIGIKEY,
                supplier_sku="OLD-SKU",
                product_url="https://example.com/old?campaign=a#offer",
            )
        ],
    )
    same_product = first.model_copy(
        update={
            "supplier_product_id": "dk-product-42",
            "offers": [
                SupplierOffer(
                    supplier=Supplier.DIGIKEY,
                    supplier_sku="NEW-SKU",
                    product_url="https://example.com/new?campaign=b",
                )
            ],
        },
        deep=True,
    )
    different_product = first.model_copy(
        update={"supplier_product_id": "DK-PRODUCT-43"},
        deep=True,
    )
    sku_fallback = first.model_copy(
        update={"supplier_product_id": None},
        deep=True,
    )
    same_sku_new_url = sku_fallback.model_copy(
        update={
            "offers": [
                SupplierOffer(
                    supplier=Supplier.DIGIKEY,
                    supplier_sku="old-sku",
                    product_url="https://another.example/product/renamed",
                )
            ]
        },
        deep=True,
    )

    assert identity_key(first) == identity_key(same_product)
    assert identity_key(first) != identity_key(different_product)
    assert identity_key(sku_fallback) == identity_key(same_sku_new_url)


def test_complete_parametric_resistor_is_automatic_only_with_strict_coverage():
    query = QueryPlanner().plan(
        component(
            part_type="resistor",
            resistance="10kΩ",
            power="0.1W",
            tolerance="1%",
            package="0603",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RES-10K",
        category="Chip Resistor - Surface Mount",
        normalized_specs={
            "resistance_ohm": 10_000.0,
            "power_w": 0.125,
            "tolerance_percent": 1.0,
            "package": "0603",
        },
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.decision.verification_complete is True
    assert match.decision.strict_category_coverage is True
    assert match.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_lifecycle_caution_is_engine_owned_without_blocking_exact_identity():
    query = QueryPlanner().plan(component(part_number="ACTIVE-OLD"))
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="ACTIVE-OLD",
        lifecycle_status="NRND - Not Recommended for New Designs",
    )

    decision = CandidateMatcher().evaluate(query, product).decision

    assert decision.lifecycle_state.value == "caution"
    assert decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert "lifecycle_caution" in decision.reason_codes


def test_supplier_part_type_inference_requires_one_unambiguous_category():
    capacitor = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="CL31A226MQHNNNE",
        category="커패시터",
        description="22 µF MLCC X5R",
    )
    led_driver = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="LED-DRIVER",
        category="LED Driver IC",
    )

    assert infer_supplier_part_type(capacitor) == "capacitor"
    assert infer_supplier_part_type(led_driver) is None


def test_parametric_match_checks_minimum_ratings_and_package():
    query = QueryPlanner().plan(
        component(part_type="resistor", resistance="10kΩ", power="0.1W", package="0603")
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="PART-10K",
        category="Thick Film Resistors",
        package="0603",
        normalized_specs={
            "resistance_ohm": 10_000.0,
            "power_w": 0.125,
            "package": "0603",
        },
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert match.conflicts == []
    assert match.package_comparison is not None
    assert match.package_comparison.state == "match"
    assert match.package_comparison.relation == "exact"
    assert match.package_comparison.expected_display == "0603 · 1608 metric"


def test_zero_ohm_jumper_does_not_require_percentage_tolerance():
    query = QueryPlanner().plan(
        component(
            part_type="resistor",
            resistance="0ohm",
            power="1/16W",
            tolerance="1%",
            package="0402",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="CRCW04020000Z0ED",
        category="Chip Resistor - Surface Mount",
        normalized_specs={"resistance_ohm": 0.0, "power_w": 0.0625, "package": "0402"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert "tolerance_percent" not in match.missing_requirements
    assert "tolerance_not_applicable_for_zero_ohm" in match.reasons


def test_ic_category_accepts_operational_amplifier_taxonomy():
    query = QueryPlanner().plan(
        component(part_number="LM358DR", part_type="ic", package="SOIC-8")
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="LM358DR",
        category="연산 증폭기 - Op 증폭기",
        description="Operational Amplifier",
        normalized_specs={"package": "SOIC8"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_EXACT
    assert match.conflicts == []


def test_exact_ferrite_bead_is_compatible_with_inductor_bom_category():
    query = QueryPlanner().plan(
        component(part_number="BLM18KG121TN1D", part_type="inductor", package="0603")
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="BLM18KG121TN1D",
        category="Ferrite Beads",
        description="3A 120ohm 0603 Ferrite Bead",
        normalized_specs={"package": "0603"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_EXACT
    assert match.conflicts == []


def test_known_packaging_suffix_and_package_alias_are_verified_as_variant():
    query = QueryPlanner().plan(
        component(
            part_number="TLV70225DBV",
            part_type="ic",
            voltage="2.5V",
            current="300mA",
            package="SOT23-5",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="TLV70225DBVR",
        category="LDO Voltage Regulators",
        package="SC-74A, SOT-753",
        normalized_specs={"voltage_v": 2.5, "current_a": 0.3, "package": "SC74ASOT753"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_VARIANT
    assert match.conflicts == []


def test_known_numeric_packaging_suffix_is_verified_as_variant():
    query = QueryPlanner().plan(component(part_number="BAS21J", part_type="diode"))
    product = SupplierProduct(
        supplier=Supplier.UNIKEYIC,
        manufacturer_part_number="BAS21J,115",
        manufacturer="Nexperia",
        category="Switching Diodes",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_VARIANT
    assert match.conflicts == []


def test_ti_reel_marker_before_nopb_is_verified_as_variant():
    query = QueryPlanner().plan(component(part_number="LM2664M6/NOPB", part_type="ic"))
    product = SupplierProduct(
        supplier=Supplier.UNIKEYIC,
        manufacturer_part_number="LM2664M6X/NOPB",
        manufacturer="Texas Instruments",
        category="Switching Voltage Regulators",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_VARIANT
    assert match.conflicts == []


def test_exact_mpn_keeps_real_frequency_conflict_after_category_aliases():
    query = QueryPlanner().plan(
        component(
            part_number="ECS-250-10-36-CKM-TR", part_type="crystal", frequency="32MHz"
        )
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="ECS-250-10-36-CKM-TR",
        category="결정",
        normalized_specs={"frequency_hz": 25_000_000.0},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.INPUT_CONFLICT
    assert match.conflicts == ["frequency_hz_mismatch"]


def test_parametric_query_uses_core_search_terms_but_verifies_full_capacitor_spec():
    query = QueryPlanner().plan(
        component(
            description="MLCC 0.1uF,10%,50V,C1005,X5R",
            part_type="capacitor",
            capacitance="0.1uF",
            tolerance="10%",
            voltage="50V",
            package="C1005",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="C1005X5R1H104K050BB",
        category="Ceramic Capacitors",
        package="0402 (1005 Metric)",
        normalized_specs={
            "capacitance_f": 0.1e-6,
            "tolerance_percent": 10.0,
            "voltage_v": 50.0,
            "package": "0402",
            "dielectric": "X5R",
        },
    )

    match = CandidateMatcher().evaluate(query, product)

    assert query.keywords == "0.1uF 0402 X5R capacitor"
    assert query.requirements["dielectric"].hard is True
    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert match.package_comparison is not None
    assert match.package_comparison.state == "match"
    assert match.package_comparison.relation == "alias"
    assert match.package_comparison.expected_display == "0402 · 1005 metric"
    assert match.package_comparison.expected_raw == "C1005"
    assert match.package_comparison.actual_display == "0402 · 1005 metric"
    assert match.package_comparison.actual_raw is None
    dielectric = match.spec_comparisons["dielectric"]
    assert dielectric.state == "match"
    assert dielectric.relation == "exact"
    assert dielectric.expected_display == "X5R"
    assert dielectric.expected_detail == "−55 ~ +85 °C · ΔC ±15%"


def test_package_comparison_keeps_distinct_supplier_alias_and_backend_mismatch():
    query = QueryPlanner().plan(
        component(part_type="capacitor", capacitance="0.1uF", package="0402")
    )
    alias_product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="CAP-ALIAS",
        category="Ceramic Capacitors",
        package="C1005",
        normalized_specs={"capacitance_f": 0.1e-6, "package": "0402"},
    )
    mismatch_product = alias_product.model_copy(
        update={
            "manufacturer_part_number": "CAP-WRONG",
            "package": "C1608",
            "normalized_specs": {"capacitance_f": 0.1e-6, "package": "0603"},
        }
    )

    alias = CandidateMatcher().evaluate(query, alias_product)
    mismatch = CandidateMatcher().evaluate(query, mismatch_product)

    assert alias.package_comparison is not None
    assert alias.package_comparison.state == "match"
    assert alias.package_comparison.relation == "alias"
    assert alias.package_comparison.actual_raw == "C1005"
    assert mismatch.package_comparison is not None
    assert mismatch.package_comparison.state == "mismatch"
    assert mismatch.package_comparison.relation == "mismatch"
    assert mismatch.package_comparison.actual_display == "0603 · 1608 metric"


def test_dielectric_mismatch_is_not_accepted_as_compatible():
    query = QueryPlanner().plan(
        component(
            description="0.1uF 50V C1005 X5R",
            part_type="capacitor",
            capacitance="0.1uF",
            voltage="50V",
            package="C1005",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="C1005X7R1H104K",
        category="Ceramic Capacitors",
        normalized_specs={
            "capacitance_f": 0.1e-6,
            "voltage_v": 50.0,
            "package": "0402",
            "dielectric": "X7R",
        },
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.AMBIGUOUS
    assert "dielectric_mismatch" in match.conflicts
    dielectric = match.spec_comparisons["dielectric"]
    assert dielectric.state == "mismatch"
    assert dielectric.relation == "conditional"
    assert dielectric.expected_detail == "−55 ~ +85 °C · ΔC ±15%"
    assert dielectric.actual_detail == "−55 ~ +125 °C · ΔC ±15%"


def test_dielectric_alias_is_backend_owned_and_keeps_original_bom_notation():
    query = QueryPlanner().plan(
        component(
            description="100pF 50V C1005 NP0",
            part_type="capacitor",
            capacitance="100pF",
            package="C1005",
        )
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="C1005C0G1H101J",
        category="Ceramic Capacitors",
        normalized_specs={
            "capacitance_f": 100e-12,
            "package": "0402",
            "dielectric": "C0G",
        },
        attributes={"Temperature Characteristic": "C0G"},
    )

    comparison = (
        CandidateMatcher().evaluate(query, product).spec_comparisons["dielectric"]
    )

    assert query.requirements["dielectric"].raw_value == "NP0"
    assert comparison.state == "match"
    assert comparison.relation == "alias"
    assert comparison.expected_display == "C0G"
    assert comparison.expected_raw == "NP0"
    assert comparison.actual_raw is None


def test_temperature_range_accepts_supplier_range_that_contains_bom_requirement():
    query = QueryPlanner().plan(
        component(part_type="capacitor", capacitance="0.1uF", temperature="-40 ~ 85°C")
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="CAP-WIDE-TEMP",
        category="Ceramic Capacitors",
        normalized_specs={
            "capacitance_f": 0.1e-6,
            "temperature_range_c": [-55.0, 125.0],
        },
    )

    match = CandidateMatcher().evaluate(query, product)
    comparison = match.spec_comparisons["temperature_range_c"]

    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert comparison.state == "match"
    assert comparison.relation == "contains"
    assert comparison.expected_display == "−40 ~ +85 °C"
    assert comparison.actual_display == "−55 ~ +125 °C"


def test_unparsed_temperature_is_not_a_hard_requirement():
    query = QueryPlanner().plan(
        component(part_type="capacitor", temperature="room temperature")
    )

    assert query.requirements["temperature_range_c"].normalized_value is None
    assert query.requirements["temperature_range_c"].hard is False


def test_small_capacitance_values_do_not_match_through_absolute_tolerance():
    query = QueryPlanner().plan(
        component(part_type="capacitor", capacitance="10pF", package="C1005")
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="C1005C0G1H101K",
        category="Ceramic Capacitors",
        normalized_specs={"capacitance_f": 100e-12, "package": "0402"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.AMBIGUOUS
    assert "capacitance_f_mismatch" in match.conflicts


def test_missing_hard_requirements_reduce_specification_confidence():
    query = QueryPlanner().plan(
        component(part_type="capacitor", capacitance="10pF", package="C1005")
    )
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="UNKNOWN-CAP",
        category="Ceramic Capacitors",
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.SPEC_PARTIAL
    assert match.specification_confidence == 1 / 3
    assert set(match.missing_requirements) == {"capacitance_f", "package"}


def test_description_without_identifier_or_hard_spec_is_insufficient():
    query = QueryPlanner().plan(
        component(description="Header, 2-Pin, Right Angle", part_type="connector")
    )

    assert query.mode.value == "insufficient"


def test_single_package_hint_is_not_enough_for_parametric_search():
    query = QueryPlanner().plan(
        component(description="Header, 3-Pin", part_type="connector", package="HDR1X3")
    )

    assert query.mode.value == "insufficient"


def test_placeholder_and_generic_connector_values_are_not_searched_as_mpns():
    for value in ("PCB_POINT", "TEST-POINT", "1x4P"):
        query = QueryPlanner().plan(component(part_number=value, part_type="connector"))

        assert query.part_number is None
        assert query.mode.value == "insufficient"


def test_passive_package_notation_is_reinterpreted_before_supplier_search():
    query = QueryPlanner().plan(
        component(
            part_number="C=1005",
            part_type="capacitor",
            capacitance="100nF",
            voltage="50V",
        )
    )

    assert query.part_number is None
    assert query.mode.value == "parametric"
    assert query.package == "1005"
    assert query.keywords == "100nF 0402 capacitor"
    assert query.requirements["package"].normalized_value == "0402"
    assert query.requirements["package"].hard is True


def test_passive_package_without_primary_spec_does_not_spend_supplier_calls():
    query = QueryPlanner().plan(component(part_number="R=1608", part_type="resistor"))

    assert query.part_number is None
    assert query.mode.value == "insufficient"
    assert query.package == "1608"
    assert query.requirements["package"].normalized_value == "0603"


def test_cad_passive_footprint_uses_parenthesized_imperial_size():
    query = QueryPlanner().plan(
        component(
            part_number="R2012(0805)BAAA",
            part_type="capacitor",
            capacitance="100nF",
            voltage="100V",
        )
    )

    assert query.part_number is None
    assert query.mode.value == "parametric"
    assert query.package == "0805"


def test_large_metric_capacitor_package_has_canonical_imperial_alias():
    query = QueryPlanner().plan(
        component(part_number="C=6032", part_type="capacitor", capacitance="100uF")
    )

    assert query.mode.value == "parametric"
    assert query.requirements["package"].normalized_value == "2312"


def test_capacitor_eia_code_and_tantal_case_are_normalized_for_spec_search():
    query = QueryPlanner().plan(
        component(part_type="capacitor", capacitance="105", package="3216A")
    )

    assert query.mode.value == "parametric"
    assert query.requirements["capacitance_f"].normalized_value == 1e-6
    assert query.requirements["package"].normalized_value == "1206"


def test_manufacturer_prefixed_mpn_searches_the_actual_identifier():
    query = QueryPlanner().plan(
        component(
            part_number="MOLEX=53261-0671",
            manufacturer="Molex",
            part_type="connector",
        )
    )

    assert query.mode.value == "identity"
    assert query.part_number == "53261-0671"
    assert query.manufacturer == "Molex"
    assert query.keywords == "53261-0671 Molex"


def test_prefixed_named_package_is_not_searched_as_an_mpn():
    query = QueryPlanner().plan(component(part_number="MPS=TSOT23-5", part_type="ic"))

    assert query.part_number is None
    assert query.package == "TSOT23-5"
    assert query.mode.value == "insufficient"


def test_supplier_manufacturer_aliases_do_not_create_false_input_conflicts():
    assert manufacturers_compatible("MPS", "Monolithic Power Systems (MPS)") is True
    assert (
        manufacturers_compatible("MAXIM", "Analog Devices / Maxim Integrated") is True
    )
    assert manufacturers_compatible("Samsung", "Samsung Electro-Mechanics") is False


def test_prefixed_and_pin_qualified_sot_packages_are_backend_compatible():
    query = QueryPlanner().plan(
        component(part_number="BSS215P", part_type="transistor", package="FET=PGSOT-23")
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="BSS215P",
        category="MOSFETs",
        package="SOT23",
        normalized_specs={"package": "SOT23"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.VERIFIED_EXACT
    assert match.package_comparison is not None
    assert match.package_comparison.state == "match"
