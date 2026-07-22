from pathlib import Path

import pandas as pd
import pytest

from bom_extraction_engine import embedding
from bom_extraction_engine.engine import SmartbomConfig, build_smartbom_result
from bom_extraction_engine.fusion import FusionProber
from bom_extraction_engine.rule_extractor import compute_roles
from bom_extraction_engine.row_features import (
    reference_designators,
    reference_list_count,
    reference_quantity_pair,
)
from bom_extraction_engine.workbook import build_case, non_bom_sheet_reason
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.planner import QueryPlanner


HEADERS = ["번호", "타입", "구매", "종류", "용량", "사이즈", "Value", "세트당 수량"]
ROWS = [
    [1, "자삽", "도급", "CAP", "47nF 50V", "0603_1608", "C1 C2", 2],
    [2, "자삽", "도급", "CAP", "10uF 50V", "1206_3216", "C3", 1],
    [3, "자삽", "사급", "MOSFET", "BSS138", "SOT-23", "Q1 Q2", 2],
    [4, "자삽", "사급", "IC", "MAX3232", "SOIC-16", "U1", 1],
    [5, "미삽", "도급", "RES", "DNP", "0603_1608", "R1 R2 R3", 3],
    [6, "자삽", "사급", "XTAL", "16MHz", "3225", "Y1", 1],
    [7, "자삽", "도급", "DIODE", "D_Schottky_ALT", "", "D1", 1],
    [8, "자삽", "도급", "", "SW_Push", "", "SW1", 1],
    [9, "수삽", "사급", "", "DB9_RS232_Connector", "", "J1", 1],
]


def test_reference_cardinality_is_strict_and_part_number_safe() -> None:
    assert reference_list_count("C15 C13 C17") == 3
    assert reference_list_count("R1-R5") == 5
    assert reference_list_count("U1, U2/U3") == 3
    assert reference_list_count("SS34") is None
    assert reference_list_count("BSS138") is None
    assert reference_list_count("G5V-1-DC24") is None


def test_reference_shorthand_restores_prefix_without_accepting_part_numbers() -> None:
    assert reference_designators("R23,24,25, 38") == [
        "R23",
        "R24",
        "R25",
        "R38",
    ]
    assert reference_designators("BD1,2") == ["BD1", "BD2"]
    assert reference_designators("SW1,2,3,4") == ["SW1", "SW2", "SW3", "SW4"]
    assert reference_list_count("C46,51,54,56,59") == 5
    assert reference_designators("SS34") is None
    assert reference_designators("BSS138") is None
    assert reference_designators("BAS21J,115") is None


def test_reference_quantity_pair_is_column_order_independent() -> None:
    assert reference_quantity_pair(ROWS, len(HEADERS)) == (6, 7, 1.0)
    order = [6, 3, 7, 4, 0, 2, 5, 1]
    permuted = [[row[index] for index in order] for row in ROWS]
    ref_col, qty_col, agreement = reference_quantity_pair(permuted, len(order))

    assert order[ref_col] == 6
    assert order[qty_col] == 7
    assert agreement == 1.0


def test_reference_quantity_pair_is_the_primary_extraction_role(tmp_path: Path) -> None:
    source = tmp_path / "multiple-quantities.csv"
    rows = [
        ["Reference", "Qty", "소요수량", "잔여수량", "Value", "Type"],
        ["R1 R2", 2, 10, 8, "10k", "RES"],
        ["C1", 1, 5, 4, "100nF", "CAP"],
        ["U1 U2 U3", 3, 15, 12, "MAX3232", "IC"],
        ["D1", 1, 5, 4, "SS34", "DIODE"],
    ]
    pd.DataFrame(rows).to_csv(source, index=False, header=False)

    case = build_case(source, 0, display_name=source.name, sheet_name="csv")
    roles = compute_roles(case)

    assert case["header_labels"][roles["quantity"][0]] == "Qty"
    result = build_smartbom_result(
        input_path=source,
        original_filename=source.name,
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )
    assert [component["quantity"] for component in result["components"]] == [
        2,
        1,
        3,
        1,
    ]
    assert all(
        "reference_quantity_mismatch" not in component["quality_flags"]
        for component in result["components"]
    )


def test_non_bom_sheet_gate_uses_semantics_not_file_names() -> None:
    coordinate = pd.DataFrame(
        [
            [
                "Name",
                "Orientation",
                "Pins",
                "Value",
                "SMD",
                "Layer Name",
                "Layer Number",
                "Position X",
                "Position Y",
            ],
            ["R1", 90, 2, "10k", "SMD", "Top", 1, 10.2, 20.4],
            ["C1", 0, 2, "100nF", "SMD", "Top", 1, 11.2, 21.4],
        ]
    )
    inventory = pd.DataFrame(
        [
            ["Part number", "Year", "Package", "Stock", "Lead time"],
            ["RC0603FR-0710KL", 2025, "0603", 1000, "2 weeks"],
            ["GRM188R71H104KA93", 2024, "0603", 500, "4 weeks"],
        ]
    )
    quotation = pd.DataFrame(
        [
            ["번호", "품명", "규격", "단위", "수량", "자재비", "경비", "합계"],
            [1, "시스템 종합점검", "장비 점검 및 시운전", "M/D", 1, 100, 20, 120],
            [2, "소프트웨어", "연결 프로그램 개발", "식", 1, 200, 40, 240],
        ]
    )
    sparse_bom = pd.DataFrame(
        [
            ["No", "품명", "도면번호", "Q'TY"],
            [1, "MCU", "U1", 1],
            [2, "Chip Resistor 10k", "R1 R2", 2],
            [3, "Capacitor 100nF", "C1", 1],
        ]
    )

    assert non_bom_sheet_reason(coordinate, 0) == "coordinate_table"
    assert non_bom_sheet_reason(inventory, 0) == "inventory_table"
    assert non_bom_sheet_reason(quotation, 0) == "commercial_document"
    assert non_bom_sheet_reason(sparse_bom, 0) is None


def test_normalized_tolerance_cell_remains_direct_evidence(tmp_path: Path) -> None:
    source = tmp_path / "decimal-tolerance.csv"
    rows = [
        ["Reference", "Quantity", "Type", "Value", "Tolerance", "Package"],
        ["R1", 1, "RES", "10k", 0.05, "1608"],
        ["R2 R3", 2, "RES", "4.7k", 0.01, "1608"],
        ["R4", 1, "RES", "100R", 0.05, "1608"],
    ]
    pd.DataFrame(rows).to_csv(source, index=False, header=False)

    result = build_smartbom_result(
        input_path=source,
        original_filename=source.name,
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )

    assert [component["tolerance_percent"] for component in result["components"]] == [
        5.0,
        1.0,
        5.0,
    ]
    assert all(
        component["field_states"]["tolerance"]["status"] == "extracted"
        for component in result["components"]
    )
    assert all(
        "field_without_direct_evidence" not in component["quality_flags"]
        for component in result["components"]
    )


def test_fusion_recovers_misleading_header_without_embedding() -> None:
    result = FusionProber().detect(pd.DataFrame([HEADERS, *ROWS]))

    assert result.found is True
    assert result.header_row == 0
    assert result.column_map[6]["field"] == "reference"
    assert result.column_map[7]["field"] == "quantity"
    assert result.reason == "참조번호-수량 데이터 관계 복구"


def test_fusion_abstains_from_reference_like_non_component_table() -> None:
    embedding.configure("off")
    rows = [
        HEADERS,
        [1, "alpha", "open", "first", "plain", "small", "R1", 1],
        [2, "beta", "done", "second", "plain", "large", "R2 R3", 2],
        [3, "gamma", "open", "third", "plain", "medium", "R4", 1],
    ]

    result = FusionProber().detect(pd.DataFrame(rows))

    assert result.found is False


def test_total_footer_with_trailing_punctuation_is_excluded(tmp_path: Path) -> None:
    source = tmp_path / "footer.csv"
    rows = [
        ["Description", "Quantity", "Designator", "Specification", "Package"],
        ["Resistor", 1, "R1", "10K 1% 0603", "0603"],
        ["total:", 1, "", "", ""],
    ]
    pd.DataFrame(rows).to_csv(source, index=False, header=False)

    result = build_smartbom_result(
        input_path=source,
        original_filename=source.name,
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )

    assert result["summary"]["component_count"] == 1
    assert result["components"][0]["reference_designators"] == ["R1"]


def test_smartbom_engine_extracts_profiled_bom_and_excludes_dnp_search(
    tmp_path: Path,
) -> None:
    source = tmp_path / "misleading.csv"
    lines = [",".join(map(str, HEADERS))]
    lines.extend(",".join(map(str, row)) for row in ROWS)
    source.write_text("\n".join(lines), encoding="utf-8-sig")

    result = build_smartbom_result(
        input_path=source,
        original_filename="misleading.csv",
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )

    assert result["summary"]["parsed_sheet_count"] == 1
    assert result["summary"]["component_count"] == 9
    assert result["summary"]["header_embedding"] != "local"
    by_row = {item["source_rows_1based"][0]: item for item in result["components"]}
    capacitor = by_row[2]
    assert capacitor["component_type"] == "capacitor"
    assert capacitor["raw_fields"]["capacitance"] == "47nF"
    assert capacitor["raw_fields"]["voltage"] == "50V"
    assert capacitor["package"] == "0603_1608"
    assert capacitor["reference_designators"] == ["C1", "C2"]
    assert capacitor["quantity"] == 2
    assert by_row[4]["part_number"] == "BSS138"
    assert by_row[5]["part_number"] == "MAX3232"
    assert by_row[7]["part_number"] is None
    assert by_row[7]["raw_fields"]["frequency"] == "16MHz"
    assert "do_not_populate" in by_row[6]["quality_flags"]
    assert by_row[8]["part_number"] is None
    assert by_row[9]["part_number"] is None
    assert by_row[10]["part_number"] is None

    headers = {item["raw_header"]: item for item in result["headers"]}
    assert headers["Value"]["semantic_field"] == "reference"
    assert headers["Value"]["source"] == "local_model"
    assert headers["용량"]["semantic_field"] == "value"

    search = build_batch_from_result(result)
    assert len(search.components) == 9
    dnp = next(component for component in search.components if component.source_rows_1based == [6])
    assert dnp.search_disposition.value == "excluded"
    assert dnp.procurement_disposition.value == "excluded"


def test_protel_motor_bom_patterns_build_safe_supplier_queries(tmp_path: Path) -> None:
    source = tmp_path / "motor.csv"
    rows = [
        ["NO.", "Part", "PCB DECAL", "Reference", "Q'ty"],
        [1, "C2012_0.47uF", "C2012", "C106", 1],
        [2, "DRV8825PWPR/28TSSOP", "28TSSOP-W6.6/E0.65", "U100", 1],
        [3, "E/C_100uF/25V", "E/C-SMD/8X6.3/H63", "C105", 1],
        [4, "GF063P-103 (10k)", "GF063P", "VR100", 1],
        [5, "HDR_2X2_2.54 (JUMPER)", "HDR_2X2_2.54", "J106", 1],
        [6, "R2012_10k", "R2012", "R101 R104", 2],
        [7, "TEST POINT (OPEN)", "TP-0.9", "TP100", 1],
        [8, "TLP281(SMD)", "TLP281", "U101", 1],
    ]
    pd.DataFrame(rows).to_csv(source, index=False, header=False)

    result = build_smartbom_result(
        input_path=source,
        original_filename="motor.csv",
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )

    assert result["summary"]["component_count"] == 8
    assert any(
        header["raw_header"] == "PCB DECAL"
        and header["semantic_field"] == "footprint"
        for header in result["headers"]
    )
    by_row = {item["source_rows_1based"][0]: item for item in result["components"]}
    assert by_row[2]["part_number"] is None
    assert by_row[2]["raw_fields"]["capacitance"] == "0.47uF"
    assert by_row[2]["package"] == "C2012"
    assert by_row[3]["part_number"] == "DRV8825PWPR"
    assert by_row[3]["package"] == "TSSOP-28"
    assert by_row[4]["part_number"] is None
    assert by_row[4]["raw_fields"]["capacitance"] == "100uF"
    assert by_row[5]["part_number"] == "GF063P-103"
    assert by_row[5]["raw_fields"]["resistance"] == "10k"
    assert by_row[6]["part_number"] is None
    assert by_row[6]["component_type"] == "connector"
    assert by_row[7]["part_number"] is None
    assert by_row[7]["raw_fields"]["resistance"] == "10k"
    assert "do_not_populate" in by_row[8]["quality_flags"]
    assert by_row[9]["part_number"] == "TLP281"

    batch = build_batch_from_result(result)
    test_point = next(
        component for component in batch.components if component.source_rows_1based == [8]
    )
    assert test_point.search_disposition.value == "excluded"
    assert test_point.procurement_disposition.value == "excluded"
    plans = {
        component.source_rows_1based[0]: QueryPlanner().plan(component)
        for component in batch.components
    }
    assert plans[2].mode.value == "parametric"
    assert plans[2].keywords == "0.47uF 0805 capacitor"
    assert plans[3].part_number == "DRV8825PWPR"
    assert plans[3].requirements["package"].normalized_value == "TSSOP28"
    assert plans[4].category_policy == "electrolytic"
    assert plans[4].requirements["mount_style"].normalized_value == "smd"
    assert plans[4].requirements["diameter_mm"].normalized_value == 8.0
    assert plans[5].part_number == "GF063P-103"
    assert plans[6].mode.value == "parametric"
    assert plans[6].keywords == "4 pin dual row connector"
    assert plans[6].requirements["pin_count"].normalized_value == 4.0
    assert plans[6].requirements["row_count"].normalized_value == 2.0
    assert plans[7].keywords == "10k 0805 resistor"
    assert plans[9].part_number == "TLP281"


def test_misleading_reference_and_part_name_headers_use_row_evidence(tmp_path: Path) -> None:
    source = tmp_path / "misleading-reference.xlsx"
    rows = [
        ["Reference", "Part Number", "Description", "Pcs/unit", "Part Name", "Manufacturer"],
        ["MCU", "STM32F070CBT6", "LQFP48", 1, "U1", "STM"],
        ["RESISTOR", "10Ω 1608 F", "SMD", 2, "R1,2", "ANY"],
        ["TRANSISTOR", "75Ω 1608 F", "SMD", 1, "R3", "ANY"],
        ["RESISTOR", "10uF/6.3V 1608", "SMD", 2, "C1,2", "ANY"],
        ["CERAMIC-CAP", "18pF/50V 1608", "SMD", 1, "C3", "ANY"],
        ["ELE-CAP", "33uF/100V", "SMD(10X10.3)", 1, "EC1", "ANY"],
        ["X-TAL", "DX-25(25MHz)", "SMD(3.2X2.5)", 1, "X1", "Caltron"],
        ["LED", "CHIP RED 2012", "SMD", 2, "LD1,2", "ANY"],
        ["RESISTOR", "1KΩ 1608 F", "SMD", 1, "R4,5", "ANY"],
    ]
    pd.DataFrame(rows).to_excel(source, index=False, header=False)

    result = build_smartbom_result(
        input_path=source,
        original_filename=source.name,
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )

    headers = {header["raw_header"]: header for header in result["headers"]}
    assert headers["Reference"]["semantic_field"] == "part_type"
    assert headers["Reference"]["source"] == "local_model"
    assert headers["Part Name"]["semantic_field"] == "reference"
    assert headers["Part Name"]["source"] == "local_model"

    by_row = {item["source_rows_1based"][0]: item for item in result["components"]}
    resistor = by_row[3]
    assert resistor["part_number"] is None
    assert resistor["component_type"] == "resistor"
    assert resistor["reference_designators"] == ["R1", "R2"]
    assert resistor["resistance_ohm"] == 10.0
    assert resistor["tolerance_percent"] == 1.0
    assert resistor["package"] == "1608"

    wrong_class = by_row[4]
    assert wrong_class["component_type"] == "resistor"
    assert "part_type_source_conflict" in wrong_class["quality_flags"]

    capacitor = by_row[5]
    assert capacitor["part_number"] is None
    assert capacitor["component_type"] == "capacitor"
    assert capacitor["capacitance_f"] == pytest.approx(10e-6)
    assert capacitor["voltage_v"] == 6.3
    assert "part_type_source_conflict" in capacitor["quality_flags"]

    assert by_row[9]["part_number"] is None
    assert by_row[9]["component_type"] == "led"
    assert by_row[9]["reference_designators"] == ["LD1", "LD2"]
    assert "reference_quantity_mismatch" in by_row[10]["quality_flags"]

    batch = build_batch_from_result(result)
    plans = {
        component.source_rows_1based[0]: QueryPlanner().plan(component)
        for component in batch.components
    }
    assert plans[3].mode.value == "parametric"
    assert plans[3].keywords == "10Ω 0603 resistor"
    assert plans[5].mode.value == "parametric"
    assert plans[5].keywords == "10uF 0603 capacitor"
    assert plans[7].category_policy == "electrolytic"
    assert plans[7].requirements["package"].hard is False
    assert plans[7].requirements["diameter_mm"].normalized_value == 10.0
    assert plans[8].part_number == "DX-25"
    assert plans[8].requirements["package"].normalized_value == "3225"
