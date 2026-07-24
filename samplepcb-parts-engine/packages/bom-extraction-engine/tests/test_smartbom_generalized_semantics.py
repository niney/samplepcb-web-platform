# -*- coding: utf-8 -*-
"""General semantic invariants distilled from mixed ECAD BOM exports.

The fixtures intentionally contain no source filename or source row lookup.
They protect reusable header, identity, specification, and sheet-integrity
rules rather than either workbook used to discover the gaps.
"""

from bom_extraction_engine.adapter import adapt_sheet
from bom_extraction_engine.contract import ComponentRecord, HeaderMapping
from bom_extraction_engine.rule_extractor import compute_roles, extract_case


def _analyze(labels, row_values):
    case = {
        "file": "generic.csv",
        "sheet": 0,
        "sheet_name": "BOM",
        "header_rows": [0],
        "header_labels": labels,
        "column_indices": list(range(len(labels))),
        "rows": [
            {"row_id": index, "cells": values}
            for index, values in enumerate(row_values, start=1)
        ],
    }
    roles = compute_roles(case)
    predictions, sources = extract_case(case, roles)
    components, headers = adapt_sheet(
        case,
        roles,
        predictions,
        sources,
        source_file="generic.csv",
        sheet_index=0,
    )
    for component in components:
        ComponentRecord.model_validate(component)
    for header in headers:
        HeaderMapping.model_validate(header)
    return components, headers


def _by_reference(components):
    return {
        reference: component
        for component in components
        for reference in component["reference_designators"]
    }


def test_explicit_value_and_identifier_namespaces_are_preserved():
    components, headers = _analyze(
        [
            "References",
            "Value",
            "Footprint",
            "Description",
            "Acme_Part_Number",
            "Manufacturer_Name",
            "Quantity",
        ],
        [
            [
                "R1",
                "51K",
                "R_0603_1608Metric",
                "Chip resistor",
                "EPX-RES-001",
                "Yageo",
                "1",
            ],
            [
                "J10",
                "CN22",
                "SHDR2x8/P254",
                "HDC-16PA-2.54DSA",
                "EPX-CON-016",
                "Hirose",
                "1",
            ],
            [
                "J12",
                "CN30",
                "HDR1x4/P396",
                "ACME396-04V",
                "EPX-CON-004",
                "Yeonho",
                "1",
            ],
        ],
    )
    mappings = {header["raw_header"]: header["semantic_field"] for header in headers}
    assert mappings["References"] == "reference"
    assert mappings["Value"] == "value"
    assert mappings["Acme_Part_Number"] == "supplier_part_number"

    by_reference = _by_reference(components)
    resistor = by_reference["R1"]
    assert resistor["part_number"] is None
    assert resistor["resistance_ohm"] == 51_000.0
    assert resistor["supplier_part_numbers"] == ["EPX-RES-001"]

    compact = by_reference["J10"]
    assert compact["part_number"] == "HDC-16PA-2.54DSA"
    assert compact["supplier_part_numbers"] == ["EPX-CON-016"]
    assert compact["pin_count"] == 16
    assert compact["row_count"] == 2
    assert compact["pitch_mm"] == 2.54

    suffix = by_reference["J12"]
    assert suffix["part_number"] == "ACME396-04V"
    assert suffix["pin_count"] == 4
    assert suffix["row_count"] == 1
    assert suffix["pitch_mm"] == 3.96
    assert suffix["voltage_v"] is None


def test_cross_column_conflicts_pcb_features_and_electrolytic_dimensions():
    components, headers = _analyze(
        ["Reference", "Value", "Footprint", "MPN", "Info"],
        [
            [
                "C107",
                "1uF/25V",
                "Library:R_0603_1608Metric",
                "CAP-0603-1UF25V",
                "Unpolarized capacitor (MLCC)",
            ],
            [
                "H1, H2, H3",
                "MountingHole_Pad",
                "MountingHole_3.2mm",
                "",
                "Mounting hole with connection",
            ],
            [
                "L201",
                "22uH/4A",
                "L_10.0x10.0mm",
                "IND-10X10-22UH",
                "22uH/3A carbonyl core",
            ],
            [
                "C1",
                "220uF/50V",
                "CP_Elec_10x10.5",
                "ECAP-220UF-50V",
                "Electrolytic capacitor",
            ],
        ],
    )
    mappings = {header["raw_header"]: header["semantic_field"] for header in headers}
    assert mappings["Info"] == "description"

    by_reference = _by_reference(components)
    category_conflict = by_reference["C107"]
    assert "category_footprint_conflict" in category_conflict["quality_flags"]

    pcb_feature = by_reference["H1"]
    assert pcb_feature["part_number"] is None
    assert pcb_feature["reference_count"] == 3
    assert pcb_feature["search_disposition"] == "excluded"
    assert "pcb_feature" in pcb_feature["quality_flags"]

    current_conflict = by_reference["L201"]
    assert current_conflict["current_a"] == 4.0
    assert "current_input_source_conflict" in current_conflict["quality_flags"]
    assert {
        alternative["normalized_value"]
        for alternative in current_conflict["input_alternatives"]["current"]
    } == {3.0, 4.0}

    electrolytic = by_reference["C1"]
    assert electrolytic["body_dimensions_mm"] == [10.0, 10.5]


def test_conflicting_duplicate_reference_fails_procurement_closed():
    components, _ = _analyze(
        ["References", "Value", "Footprint", "Quantity"],
        [
            ["R17, R23, R25", "51K", "R_0603_1608Metric", "3"],
            ["R23, R24", "0R", "R_0603_1608Metric", "2"],
        ],
    )

    for component in components:
        assert "reference_assignment_conflict" in component["quality_flags"]
        assert component["quantity_resolution"] == "conflict"
        assert (
            component["procurement_disposition"]
            == "quantity_confirmation_required"
        )
        assert "quantity_reference_conflict" in component["disposition_reason_codes"]
        assert component["review_status"] == "review"
