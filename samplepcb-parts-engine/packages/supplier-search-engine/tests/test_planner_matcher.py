from __future__ import annotations

import pytest

from supplier_search_engine.contract import VALUE_FIELDS
from supplier_search_engine.contract import (
    SearchComponentInput,
    SearchField,
    SearchFieldAlternative,
    UserSearchRequirements,
)

from supplier_search_engine.matcher import (
    CandidateMatcher,
    finalize_candidate_decisions,
    infer_supplier_part_type,
    manufacturers_compatible,
)
from supplier_search_engine.models import (
    ManufacturerEvidence,
    MatchStatus,
    SelectionEligibility,
    Supplier,
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
        value_raw=values.get("value_raw"),
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


def test_user_resistor_requirements_force_parametric_search_and_make_power_conditional():
    item = component(
        part_number="LEGACY-MPN",
        part_type="resistor",
        manufacturer="Legacy Vendor",
        temperature="-40 ~ 85°C",
        resistance=None,
        package=None,
    )
    item.user_requirements = UserSearchRequirements(
        component_type="resistor",
        resistance="10kΩ",
        package="1608",
        tolerance="5%",
    )
    item.quality_flags = [
        "resistance_input_source_conflict",
        "package_input_source_conflict",
    ]

    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RC0603-10K-1",
        manufacturer="Other Vendor",
        manufacturer_evidence=ManufacturerEvidence.STRUCTURED,
        category="Chip Resistors",
        package="0603",
        normalized_specs={
            "resistance_ohm": 10_000.0,
            "tolerance_percent": 1.0,
            "package": "0603",
        },
    )
    match = finalize_candidate_decisions(
        query,
        [CandidateMatcher().evaluate(query, product)],
    )[0]

    assert query.mode.value == "parametric"
    assert query.part_number is None
    assert query.manufacturer is None
    assert query.keywords == "10kΩ 0603 resistor"
    assert query.input_source_conflicts == []
    assert query.requirements["resistance_ohm"].status == "user"
    assert "temperature_range_c" not in query.requirements
    assert "power_w" not in query.requirements
    assert match.decision.strict_category_coverage is True
    assert match.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_user_resistor_power_is_required_only_when_selected():
    item = component(part_type="resistor")
    item.user_requirements = UserSearchRequirements(
        component_type="resistor",
        resistance="10k",
        package="0603",
        tolerance="1%",
        power="0.1W",
    )

    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="RES-10K",
        category="Resistors",
        package="0603",
        normalized_specs={
            "resistance_ohm": 10_000.0,
            "tolerance_percent": 1.0,
            "package": "0603",
        },
    )
    match = CandidateMatcher().evaluate(query, product)

    assert query.requirements["power_w"].comparison == "gte"
    assert "power_w" in match.missing_requirements
    assert match.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW


def test_user_ceramic_capacitor_requirements_control_automatic_selection():
    complete = component(part_type="capacitor")
    complete.user_requirements = UserSearchRequirements(
        component_type="capacitor",
        capacitor_type="ceramic",
        capacitance="100nF",
        package="1005",
        tolerance="10%",
        voltage="25V",
        dielectric="X7R",
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="MLCC-100N",
        category="Ceramic Capacitors",
        package="0402",
        normalized_specs={
            "capacitance_f": 100e-9,
            "tolerance_percent": 10.0,
            "voltage_v": 50.0,
            "dielectric": "X7R",
            "package": "0402",
        },
    )

    complete_match = CandidateMatcher().evaluate(QueryPlanner().plan(complete), product)

    incomplete = complete.model_copy(deep=True)
    incomplete.user_requirements = complete.user_requirements.model_copy(
        update={"voltage": None, "dielectric": None},
    )
    incomplete_match = CandidateMatcher().evaluate(
        QueryPlanner().plan(incomplete),
        product,
    )

    assert complete_match.decision.selection_eligibility == SelectionEligibility.AUTOMATIC
    assert incomplete_match.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    assert {
        "category_coverage_missing:voltage_v",
        "category_coverage_missing:dielectric",
    } <= set(incomplete_match.decision.reason_codes)


@pytest.mark.parametrize("capacitor_type", ["tantalum", "film"])
def test_non_ceramic_user_capacitor_does_not_require_dielectric(capacitor_type):
    item = component(part_type="capacitor")
    item.user_requirements = UserSearchRequirements(
        component_type="capacitor",
        capacitor_type=capacitor_type,
        capacitance="10uF",
        package="1206",
        tolerance="10%",
        voltage="25V",
    )
    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number=f"{capacitor_type}-10u",
        category=f"{capacitor_type} capacitors",
        package="1206",
        normalized_specs={
            "capacitance_f": 10e-6,
            "tolerance_percent": 10.0,
            "voltage_v": 35.0,
            "package": "1206",
        },
    )

    match = CandidateMatcher().evaluate(query, product)

    assert query.category_policy == capacitor_type
    assert "dielectric" not in {
        assessment.key for assessment in match.decision.requirement_assessments
    }
    assert match.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_user_electrolytic_mechanical_package_becomes_diameter_requirement():
    item = component(part_type="capacitor")
    item.user_requirements = UserSearchRequirements(
        component_type="capacitor",
        capacitor_type="electrolytic",
        capacitance="100uF",
        package="8x10.2mm",
        tolerance="20%",
        voltage="25V",
        mount_style="smd",
    )
    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="ECAP-100U-35V",
        category="Aluminum Electrolytic Capacitors",
        description="SMD aluminum electrolytic capacitor 8 x 10.2 mm",
        normalized_specs={
            "capacitance_f": 100e-6,
            "tolerance_percent": 20.0,
            "voltage_v": 35.0,
        },
    )

    match = finalize_candidate_decisions(
        query,
        [CandidateMatcher().evaluate(query, product)],
    )[0]

    assert "package" not in query.requirements
    assert query.requirements["diameter_mm"].normalized_value == 8.0
    assert match.decision.strict_category_coverage is True
    assert match.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_planner_freezes_category_policy_from_bom_evidence():
    ceramic = QueryPlanner().plan(
        component(part_type="capacitor", description="MLCC 10uF X5R")
    )
    electrolytic = QueryPlanner().plan(
        component(
            part_type="capacitor",
            description="Aluminum electrolytic capacitor",
        )
    )

    assert ceramic.category_policy == "capacitor"
    assert electrolytic.category_policy == "electrolytic"


def test_planner_uses_extractor_normalized_value_for_bare_passive_numbers():
    item = component(
        part_type="resistor",
        resistance="100",
        package="RES_C2012N",
    )
    item.fields["resistance"].normalized_value = 100.0

    query = QueryPlanner().plan(item)

    assert query.mode.value == "parametric"
    assert query.requirements["resistance_ohm"].normalized_value == 100.0
    assert query.requirements["package"].normalized_value == "0805"
    assert query.keywords == "100 0805 resistor"


def test_planner_branches_one_parametric_conflict_deterministically():
    item = component(part_type="resistor", resistance="100k", package="0201")
    item.quality_flags = ["resistance_input_source_conflict"]
    item.input_alternatives = {
        "resistance": [
            SearchFieldAlternative(
                raw_value="100k",
                normalized_value=100_000.0,
                source_cell="D2",
                source_role="value",
            ),
            SearchFieldAlternative(
                raw_value="1K",
                normalized_value=1_000.0,
                source_cell="E2",
                source_role="value",
            ),
        ]
    }

    plans = QueryPlanner().plan_variants(item)

    assert [plan.input_branch_id for plan in plans] == ["resistance:1", "resistance:2"]
    assert [plan.requirements["resistance_ohm"].normalized_value for plan in plans] == [
        1_000.0,
        100_000.0,
    ]
    assert all(plan.mode.value == "parametric" for plan in plans)
    assert all(
        plan.input_source_conflicts == ["resistance_input_source_conflict"]
        for plan in plans
    )


def test_planner_fails_closed_when_more_than_one_field_would_branch():
    item = component(part_type="resistor", resistance="100k", package="0201")
    item.quality_flags = [
        "resistance_input_source_conflict",
        "package_input_source_conflict",
    ]
    item.input_alternatives = {
        "resistance": [
            SearchFieldAlternative(
                raw_value="1K", normalized_value=1_000.0,
                source_cell="D2", source_role="value",
            ),
            SearchFieldAlternative(
                raw_value="100K", normalized_value=100_000.0,
                source_cell="E2", source_role="value",
            ),
        ],
        "package": [
            SearchFieldAlternative(
                raw_value="0402", normalized_value="0402",
                source_cell="F2", source_role="package",
            ),
            SearchFieldAlternative(
                raw_value="0603", normalized_value="0603",
                source_cell="G2", source_role="footprint",
            ),
        ],
    }

    plans = QueryPlanner().plan_variants(item)

    assert len(plans) == 1
    assert plans[0].mode.value == "insufficient"
    assert plans[0].branch_limit_exceeded is True
    assert "branch_limit_exceeded" in plans[0].disposition_reason_codes


def test_identity_query_is_never_branched_by_bom_alternatives():
    item = component(
        part_number="ABC-123",
        part_type="resistor",
        resistance="100k",
        package="0201",
    )
    item.quality_flags = ["resistance_input_source_conflict"]
    item.input_alternatives = {
        "resistance": [
            SearchFieldAlternative(
                raw_value="1K", normalized_value=1_000.0,
                source_cell="D2", source_role="value",
            ),
            SearchFieldAlternative(
                raw_value="100K", normalized_value=100_000.0,
                source_cell="E2", source_role="value",
            ),
        ]
    }

    plans = QueryPlanner().plan_variants(item)

    assert len(plans) == 1
    assert plans[0].mode.value == "identity"
    assert plans[0].part_number == "ABC-123"


def test_ferrite_impedance_is_not_compared_as_resistance():
    item = component(
        part_type="inductor",
        description="Ferrite bead 120 Ohm @ 100MHz",
        resistance="120 Ohm",
        frequency="100MHz",
        current="200mA",
        package="0201",
    )
    item.impedance_ohm = 120.0
    item.impedance_frequency_hz = 100_000_000.0
    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="BLM03",
        category="Ferrite Beads",
        description="Ferrite bead 120 Ohm at 100 MHz 200mA 0201",
        package="0201",
        normalized_specs={
            "impedance_ohm": 120.0,
            "impedance_frequency_hz": 100_000_000.0,
            "current_a": 0.2,
            "package": "0201",
        },
    )

    candidate = finalize_candidate_decisions(
        query, [CandidateMatcher().evaluate(query, product)]
    )[0]

    assert query.category_policy == "ferrite"
    assert "resistance_ohm" not in query.requirements
    assert candidate.status == MatchStatus.SPEC_COMPATIBLE
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


def test_absolute_inductance_tolerance_uses_supplier_percent_with_trace():
    item = component(
        part_type="inductor",
        inductance="2nH",
        current="600mA",
        package="0201",
    )
    item.absolute_tolerance_h = 0.1e-9
    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="L-2N0",
        category="Inductors",
        package="0201",
        normalized_specs={
            "inductance_h": 2e-9,
            "current_a": 0.6,
            "tolerance_percent": 5.0,
            "package": "0201",
        },
    )

    candidate = finalize_candidate_decisions(
        query, [CandidateMatcher().evaluate(query, product)]
    )[0]

    assert query.requirements["absolute_tolerance_h"].normalized_value == 0.1e-9
    assert "tolerance_percent" not in query.requirements
    assert "absolute_tolerance_h_derived_from_supplier_percent" in candidate.reasons
    assert "absolute_tolerance_h_match" in candidate.reasons
    assert candidate.decision.selection_eligibility == SelectionEligibility.AUTOMATIC


@pytest.mark.parametrize(
    ("part_number", "part_type", "values", "expected_mode"),
    [
        (
            "R87,88,89,90,91",
            "resistor",
            {"resistance": "10Ω", "package": "1608"},
            "parametric",
        ),
        (
            "10uF/6.3V 1608",
            "capacitor",
            {"capacitance": "10uF", "voltage": "6.3V", "package": "1608"},
            "parametric",
        ),
        (
            "1X3/2.54MM-S/T",
            "connector",
            {"description": "DIP"},
            "insufficient",
        ),
        (
            "1X9-2.54MM-R/A",
            "connector",
            {"description": "DIP"},
            "insufficient",
        ),
    ],
)
def test_planner_rejects_reference_spec_and_generic_connector_identity(
    part_number,
    part_type,
    values,
    expected_mode,
):
    query = QueryPlanner().plan(
        component(part_number=part_number, part_type=part_type, **values)
    )

    assert query.part_number is None
    assert query.mode.value == expected_mode
    if part_type == "connector":
        assert query.requirements["mount_style"].normalized_value == "through-hole"


def test_identity_like_numeric_code_is_not_reclassified_by_safety_guards():
    query = QueryPlanner().plan(
        component(part_number="0603X03L_C", part_type="capacitor")
    )

    assert query.part_number == "0603X03L_C"
    assert query.mode.value == "identity"


@pytest.mark.parametrize(
    "source_conflict",
    ["package_input_source_conflict", "category_footprint_conflict"],
)
def test_exact_mpn_input_source_conflict_requires_manual_review(source_conflict):
    item = component(
        part_number="ABC-123",
        part_type="ic",
        package="SOIC-8",
    )
    item.quality_flags = [source_conflict]
    query = QueryPlanner().plan(item)
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="ABC-123",
        manufacturer="Acme",
        manufacturer_evidence=ManufacturerEvidence.STRUCTURED,
        category="Integrated Circuits",
        package="SOIC-8",
        normalized_specs={"package": "SOIC-8"},
    )

    evaluated = CandidateMatcher().evaluate(query, product)
    candidate = finalize_candidate_decisions(query, [evaluated])[0]

    assert query.part_number == "ABC-123"
    assert query.input_source_conflicts == [source_conflict]
    assert query.cache_payload() == query.model_copy(
        update={"input_source_conflicts": []}
    ).cache_payload()
    assert candidate.decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
    assert source_conflict in candidate.conflicts
    assert source_conflict in candidate.decision.reason_codes


def test_internal_electrolytic_footprint_sets_category_without_fake_package():
    item = component(
        part_type="capacitor",
        capacitance="100u",
        voltage="16V",
        package="CAP_ECAP_F55",
    )
    item.fields["capacitance"].normalized_value = 100e-6

    query = QueryPlanner().plan(item)

    assert query.mode.value == "parametric"
    assert query.category_policy == "electrolytic"
    assert query.requirements["package"].normalized_value is None
    assert query.requirements["package"].hard is False
    assert "CAPECAPF55" not in query.keywords


def test_ec_abbreviation_and_mechanical_size_use_electrolytic_search_policy():
    item = component(
        part_type="capacitor",
        capacitance="100uF",
        voltage="50V",
        package="10mm",
        value_raw="100uF/50V/EC/SMD/10mm",
    )
    item.fields["capacitance"].normalized_value = 100e-6

    query = QueryPlanner().plan(item)

    assert query.mode.value == "parametric"
    assert query.category_policy == "electrolytic"
    assert query.requirements["package"].normalized_value is None
    assert query.requirements["package"].hard is False
    assert query.requirements["mount_style"].normalized_value == "smd"
    assert query.keywords == "100uF capacitor"


def test_protel_ec_footprint_becomes_mount_and_diameter_not_fake_package():
    item = component(
        part_type="capacitor",
        capacitance="100uF",
        voltage="25V",
        package="E/C-SMD/8X6.3/H63",
        value_raw="E/C_100uF/25V",
    )
    item.fields["capacitance"].normalized_value = 100e-6

    query = QueryPlanner().plan(item)

    assert query.mode.value == "parametric"
    assert query.category_policy == "electrolytic"
    assert query.requirements["package"].normalized_value is None
    assert query.requirements["package"].hard is False
    assert query.requirements["mount_style"].normalized_value == "smd"
    assert query.requirements["diameter_mm"].normalized_value == 8.0
    assert query.keywords == "100uF capacitor"


def test_electrolytic_diameter_by_length_is_not_a_package_code():
    item = component(
        part_type="capacitor",
        capacitance="47uF",
        voltage="25V",
        package="5x11",
        value_raw="47uF 25V EC radial 5x11",
    )
    item.fields["capacitance"].normalized_value = 47e-6

    query = QueryPlanner().plan(item)

    assert query.category_policy == "electrolytic"
    assert query.requirements["package"].normalized_value is None
    assert query.requirements["package"].hard is False
    assert query.requirements["diameter_mm"].normalized_value == 5.0
    assert query.requirements["diameter_mm"].hard is True


@pytest.mark.parametrize("manufacturer", ["PILKOR/ MULTI", "Susumu/Any", "Various"])
def test_multisource_manufacturer_marker_does_not_restrict_parametric_search(
    manufacturer,
):
    query = QueryPlanner().plan(
        component(
            manufacturer=manufacturer,
            part_type="resistor",
            resistance="10k",
            package="0603",
        )
    )

    assert query.mode.value == "parametric"
    assert query.manufacturer is None


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


def test_planner_extracts_mount_style_and_explicit_cylindrical_diameter():
    query = QueryPlanner().plan(
        component(
            part_number="CAP-123",
            part_type="capacitor",
            description="칩전해 표면실장 Ø8 mm",
        )
    )

    assert query.requirements["mount_style"].normalized_value == "smd"
    assert query.requirements["diameter_mm"].normalized_value == 8.0
    assert query.requirements["mount_style"].hard is True
    assert query.requirements["diameter_mm"].hard is True


def test_planner_does_not_treat_crystal_body_dimensions_as_diameter():
    query = QueryPlanner().plan(
        component(
            part_number="XTAL-123",
            part_type="crystal",
            package="1612",
            description="32MHz crystal 4-SMD 1.6 x 1.2 mm",
        )
    )

    assert "diameter_mm" not in query.requirements


def test_exact_mpn_with_hard_spec_conflict_is_input_conflict():
    query = QueryPlanner().plan(
        component(part_number="RC0603FR-0710KL", manufacturer="Yageo", resistance="10kΩ")
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
    resistance = next(
        item
        for item in match.decision.requirement_assessments
        if item.key == "resistance_ohm"
    )
    assert resistance.state == "mismatch"
    assert resistance.verified is False
    assert resistance.expected_display == "10 kΩ"
    assert resistance.actual_display == "1 kΩ"


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
    query = QueryPlanner().plan(component(part_type="resistor", resistance="10kΩ", power="0.1W", package="0603"))
    product = SupplierProduct(
        supplier=Supplier.MOUSER,
        manufacturer_part_number="PART-10K",
        category="Thick Film Resistors",
        package="0603",
        normalized_specs={"resistance_ohm": 10_000.0, "power_w": 0.125, "package": "0603"},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert match.conflicts == []
    assert match.package_comparison is not None
    assert match.package_comparison.state == "match"
    assert match.package_comparison.relation == "exact"
    assert match.package_comparison.expected_display == "0603 · 1608 metric"
    assessments = {item.key: item for item in match.decision.requirement_assessments}
    assert assessments["resistance_ohm"].expected_display == "10 kΩ"
    assert assessments["resistance_ohm"].actual_display == "10 kΩ"
    assert assessments["power_w"].comparison == "gte"
    assert assessments["power_w"].expected_display == "100 mW"
    assert assessments["power_w"].actual_display == "125 mW"
    assert assessments["power_w"].state == "match"
    assert assessments["tolerance_percent"].state == "missing"
    assert len(assessments) == match.decision.required_requirement_count
    assert (
        sum(item.verified for item in assessments.values())
        == match.decision.verified_requirement_count
    )


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
    tolerance = next(
        item
        for item in match.decision.requirement_assessments
        if item.key == "tolerance_percent"
    )
    assert tolerance.state == "not_applicable"
    assert tolerance.verified is True


def test_ic_category_accepts_operational_amplifier_taxonomy():
    query = QueryPlanner().plan(component(part_number="LM358DR", part_type="ic", package="SOIC-8"))
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
        component(part_number="ECS-250-10-36-CKM-TR", part_type="crystal", frequency="32MHz")
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


def test_crystal_3225_package_is_not_converted_to_passive_1210():
    query = QueryPlanner().plan(
        component(part_type="crystal", frequency="32MHz", package="3225")
    )

    assert query.requirements["package"].normalized_value == "3225"
    assert query.keywords == "32MHz 3225 crystal"


@pytest.mark.parametrize(
    ("actual_package", "expected_status", "expected_state"),
    [
        ("1.6x1.2 mm", MatchStatus.SPEC_COMPATIBLE, "match"),
        ("1612", MatchStatus.SPEC_COMPATIBLE, "match"),
        ("2.0x1.6 mm", MatchStatus.AMBIGUOUS, "mismatch"),
        ("4-SMD", MatchStatus.SPEC_PARTIAL, "missing"),
    ],
)
def test_crystal_package_comparison_uses_physical_size_not_smd_pin_count(
    actual_package,
    expected_status,
    expected_state,
):
    query = QueryPlanner().plan(
        component(part_type="crystal", frequency="32MHz", package="1612")
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="XTAL-32MHZ",
        category="Crystals",
        package=actual_package,
        normalized_specs={"frequency_hz": 32_000_000.0},
    )

    match = CandidateMatcher().evaluate(query, product)

    assert match.status == expected_status
    assert match.package_comparison is not None
    assert match.package_comparison.state == expected_state
    if expected_state == "missing":
        assert "package" in match.missing_requirements
        assert "package_mismatch" not in match.conflicts
        assert match.package_comparison.actual_raw == "4-SMD"


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
        update={"manufacturer_part_number": "CAP-WRONG", "package": "C1608", "normalized_specs": {"capacitance_f": 0.1e-6, "package": "0603"}}
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
        normalized_specs={"capacitance_f": 100e-12, "package": "0402", "dielectric": "C0G"},
        attributes={"Temperature Characteristic": "C0G"},
    )

    comparison = CandidateMatcher().evaluate(query, product).spec_comparisons["dielectric"]

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
        normalized_specs={"capacitance_f": 0.1e-6, "temperature_range_c": [-55.0, 125.0]},
    )

    match = CandidateMatcher().evaluate(query, product)
    comparison = match.spec_comparisons["temperature_range_c"]

    assert match.status == MatchStatus.SPEC_COMPATIBLE
    assert comparison.state == "match"
    assert comparison.relation == "contains"
    assert comparison.expected_display == "−40 ~ +85 °C"
    assert comparison.actual_display == "−55 ~ +125 °C"


def test_unparsed_temperature_is_not_a_hard_requirement():
    query = QueryPlanner().plan(component(part_type="capacitor", temperature="room temperature"))

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
    assert manufacturers_compatible("MAXIM", "Analog Devices / Maxim Integrated") is True


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
