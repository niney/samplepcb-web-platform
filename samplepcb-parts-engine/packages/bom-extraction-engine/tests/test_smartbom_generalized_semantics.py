# -*- coding: utf-8 -*-
"""General semantic invariants distilled from mixed ECAD BOM exports.

The fixtures intentionally contain no source filename or source row lookup.
They protect reusable header, identity, specification, and sheet-integrity
rules rather than either workbook used to discover the gaps.
"""

import pytest

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


def test_duplicate_korean_type_headers_recover_value_column_without_changing_standard_layout():
    components, headers = _analyze(
        ["Item", "ENCODE", "품목", "SIZE", "품명", "Reference", "Q'T"],
        [
            ["1", "", "REGULATOR", "SOT-223", "FR1117S-3.3", "U1", "1"],
            ["2", "", "DIODE", "SOD-123", "MMSD4148", "D1", "1"],
            ["3", "", "RESISTOR", "2012 SIZE", "523Ω 1%", "R1", "1"],
            ["4", "", "MLCC", "1608 SIZE", "100nF 50V K X7R", "C1", "1"],
        ],
    )
    mappings = {header["raw_header"]: header["semantic_field"] for header in headers}
    assert mappings["품목"] == "part_type"
    assert mappings["품명"] == "value"

    by_reference = _by_reference(components)
    assert by_reference["U1"]["part_number"] == "FR1117S-3.3"
    assert by_reference["D1"]["part_number"] == "MMSD4148"
    assert by_reference["R1"]["resistance_ohm"] == 523.0
    assert by_reference["R1"]["tolerance_percent"] == 1.0
    assert by_reference["C1"]["capacitance_f"] == pytest.approx(100e-9)
    assert by_reference["C1"]["voltage_v"] == 50.0

    standard_components, standard_headers = _analyze(
        ["품명", "SIZE", "규격", "Reference", "Q'T"],
        [
            ["RESISTOR", "1608 SIZE", "10kΩ 1%", "R1", "1"],
            ["MLCC", "1608 SIZE", "100nF 50V", "C1", "1"],
            ["DIODE", "SOD-123", "MMSD4148", "D1", "1"],
        ],
    )
    standard_mappings = {
        header["raw_header"]: header["semantic_field"]
        for header in standard_headers
    }
    assert standard_mappings["품명"] == "part_type"
    assert standard_mappings["규격"] == "value"
    assert len(standard_components) == 3


def test_explicit_ferrite_bead_overrides_only_bd_designator_conflict():
    components, _ = _analyze(
        ["품명", "SIZE", "규격", "Reference", "Q'T", "Vendors"],
        [
            ["Ferrite BEAD", "2012 SIZE", "BLM21PG221SN1D/21", "BD5", "1", "Murata"],
            ["BEAD", "3216 SIZE", "120 BLM31PG121SN1L", "BD1, BD2", "2", "Murata"],
            ["BEAD", "1608 SIZE", "1K BLM18HE102SN1", "BD9", "1", "Murata"],
            ["CAPACITOR", "1608 SIZE", "100nF", "D7", "1", "Murata"],
        ],
    )
    by_reference = _by_reference(components)

    for reference in ("BD5", "BD1", "BD2", "BD9"):
        bead = by_reference[reference]
        assert bead["component_type"] == "inductor"
        assert "part_type_source_conflict" not in bead["quality_flags"]
    assert by_reference["BD9"]["impedance_ohm"] == 1_000.0

    real_conflict = by_reference["D7"]
    assert real_conflict["component_type"] == "capacitor"
    assert "part_type_source_conflict" in real_conflict["quality_flags"]


def test_pcb_fabrication_and_nc_instruction_are_excluded_without_excluding_other_parts():
    components, _ = _analyze(
        ["Item", "품명", "SIZE", "규격", "Reference", "Q'T"],
        [
            ["1", "PCB", "", "PCB 두께: 1.6T PCB LAYER : 4층", "", "1"],
            ["2", "NC 처리", "R26, R29, C16", "", "", ""],
            ["3", "VARISTOR", "2012 SIZE", "20V", "VR1", "1"],
            ["4", "PCB", "", "", "", "1"],
        ],
    )

    pcb_rows = [
        component
        for component in components
        if "pcb_feature" in component["disposition_reason_codes"]
    ]
    assert len(pcb_rows) == 2
    assert all(component["search_disposition"] == "excluded" for component in pcb_rows)

    nc = next(
        component
        for component in components
        if "do_not_populate" in component["disposition_reason_codes"]
    )
    assert nc["search_disposition"] == "excluded"

    varistor = _by_reference(components)["VR1"]
    assert varistor["search_disposition"] == "search"
