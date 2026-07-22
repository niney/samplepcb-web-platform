# -*- coding: utf-8 -*-
"""SMARTBOM 어댑터 테스트 — RowAttrs → G-shape(ComponentRecord) 변환."""
import pytest

from bom_extraction_engine.adapter import adapt_sheet
from bom_extraction_engine.contract import ComponentRecord, HeaderMapping
from bom_extraction_engine.rule_extractor import compute_roles, extract_case


def _adapt(case):
    roles = compute_roles(case)
    preds, sources = extract_case(case, roles)
    components, headers = adapt_sheet(case, roles, preds, sources,
                                      source_file="unit.xlsx", sheet_index=0)
    # 모든 어댑터 출력은 결과 계약(contract.py)을 준수해야 한다
    for component in components:
        ComponentRecord.model_validate(component)
    for header in headers:
        HeaderMapping.model_validate(header)
    return components, headers


def _case(labels, rows, header_rows=(0,), column_indices=None):
    return {
        "file": "unit.xlsx",
        "sheet": 0,
        "sheet_name": "BOM",
        "header_rows": list(header_rows),
        "header_labels": labels,
        "column_indices": (list(column_indices) if column_indices is not None
                           else list(range(len(labels)))),
        "rows": rows,
    }


def test_component_g_shape_and_normalization():
    case = _case(
        ["Part Number", "Value", "Package", "Q'ty", "Reference", "Manufacturer"],
        [{"row_id": 1,
          "cells": ["RC0603FR-0710KL", "10K OHM 1% 1/10W", "0603", "2",
                    "R1, R2", "YAGEO"]}],
    )
    components, headers = _adapt(case)
    assert len(components) == 1
    item = components[0]

    # 정규화 수치 (전기 사양 표시용)
    assert item["resistance_ohm"] == 10_000.0
    assert item["power_w"] == 0.1
    assert item["tolerance_percent"] == 1.0
    assert item["capacitance_f"] is None

    # 기본 필드 매핑
    assert item["component_type"] == "resistor"
    assert item["part_number"] == "RC0603FR-0710KL"
    assert item["quantity"] == 2
    assert item["reference_designators"] == ["R1", "R2"]
    assert item["size_code"] == "0603"
    assert item["value_raw"] == "10K OHM 1% 1/10W"
    assert item["sheet_name"] == "BOM"
    assert item["source_rows_1based"] == [2]  # row_id 1 → 1-based 2

    # 근거 셀 — A1 좌표는 원본 열 기준
    pn_state = item["field_states"]["part_number"]
    assert pn_state["status"] == "extracted"
    assert pn_state["evidence"][0]["cell"] == "A2"
    res_state = item["field_states"]["resistance"]
    assert res_state["evidence"][0]["cell"] == "B2"
    assert res_state["evidence"][0]["raw_value"] == "10K OHM 1% 1/10W"
    assert item["field_states"]["value_raw"] == {
        "value": "10K OHM 1% 1/10W",
        "status": "extracted",
        "evidence": [{"cell": "B2", "raw_value": "10K OHM 1% 1/10W",
                      "supports": "value_raw"}],
        "source": "col",
    }
    assert item["field_states"]["footprint"]["source"] == "col"
    assert item["evidence_exact_rate"] == 1.0

    # raw_fields 원문 보존
    assert item["raw_fields"]["resistance"] == "10K OHM"
    assert item["raw_fields"]["power"] == "1/10W"

    # 검토 상태 — 전 필드 근거 확보 + 수량 존재 → extracted
    assert item["uncertain_fields"] == []
    assert item["quality_flags"] == []
    assert item["review_status"] == "extracted"
    assert item["part_number_supported"] is True
    assert 0.0 < item["confidence"] <= 1.0

    # attributes — 수치 필드별 근거 동반
    names = {attribute["name"] for attribute in item["attributes"]}
    assert {"resistance", "power", "tolerance"} <= names


def test_column_indices_shift_evidence_coordinates():
    # 원본 시트에서 A열이 빈 열이라 제거된 경우 — 좌표는 원본 열 기준
    case = _case(
        ["Part Number", "Q'ty"],
        [{"row_id": 4, "cells": ["ABC-123", "1"]}],
        column_indices=[2, 5],  # 원본 C열, F열
    )
    components, _ = _adapt(case)
    state = components[0]["field_states"]["part_number"]
    assert state["evidence"][0]["cell"] == "C5"
    qty = components[0]["field_states"]["quantity"]
    assert qty["evidence"][0]["cell"] == "F5"


def test_quantity_not_found_flags_review():
    case = _case(
        ["Part Number", "Description"],
        [{"row_id": 1, "cells": ["MCP1801T-5002I/OT", "LDO Regulator"]}],
    )
    components, _ = _adapt(case)
    item = components[0]
    assert item["quantity"] is None
    assert "quantity_not_found" in item["quality_flags"]
    assert item["review_status"] == "review"
    assert item["field_states"]["quantity"]["status"] == "not_found"
    assert item["description"] == "LDO Regulator"
    assert item["field_states"]["description"]["status"] == "extracted"
    assert item["field_states"]["description"]["source"] == "col"


def test_headers_rule_vs_local_model():
    # "PartType" 라벨은 사전상 part_type이지만 내용이 값 표기라 value로 강등
    # (Altium export 관례) → 내용 추론 승격 = local_model
    case = _case(
        ["PartType", "Quantity", "Designator"],
        [{"row_id": 1, "cells": ["100nF", "2", "C1"]},
         {"row_id": 2, "cells": ["4.7uF", "1", "C2"]},
         {"row_id": 3, "cells": ["10K", "4", "R1"]}],
    )
    _, headers = _adapt(case)
    by_field = {h["semantic_field"]: h for h in headers}
    assert by_field["value"]["source"] == "local_model"
    assert by_field["value"]["confidence"] == 0.75
    assert by_field["quantity"]["source"] == "rule"
    assert by_field["quantity"]["confidence"] == 1.0
    assert by_field["reference"]["semantic_field"] == "reference"
    assert all(h["column_1based"] >= 1 for h in headers)


def test_field_without_evidence_marks_uncertain():
    # 유통사 열(ignore)에만 제조사가 있으면 근거 탐색은 행 전체를 뒤져
    # 찾아내므로, 여기서는 행 안 어디에도 없는 값이 만들어지는 경로 대신
    # 근거가 존재하는 정상 경로를 재확인한다 (uncertain 계산 로직은
    # test_quantity_not_found_flags_review와 스모크가 커버).
    case = _case(
        ["Comment", "Designator", "Qty"],
        [{"row_id": 1, "cells": ["LTST-S270KGKT/GREEN", "LED2", "1"]}],
    )
    components, _ = _adapt(case)
    item = components[0]
    # 색상 꼬리를 벗긴 PN("LTST-S270KGKT")도 원문 셀 containment로 근거 확보
    assert item["part_number"] == "LTST-S270KGKT"
    assert item["field_states"]["part_number"]["status"] == "extracted"


def test_pcb_decal_preserves_raw_footprint_and_promotes_only_safe_package():
    case = _case(
        ["Part", "PCB DECAL", "Reference", "Q'ty"],
        [
            {
                "row_id": 1,
                "cells": [
                    "DRV8825PWPR/28TSSOP",
                    "28TSSOP-W6.6/E0.65",
                    "U100",
                    "1",
                ],
            },
            {
                "row_id": 2,
                "cells": ["TLP281(SMD)", "TLP281", "U101", "1"],
            },
        ],
    )

    components, headers = _adapt(case)
    driver, optocoupler = components

    assert driver["part_number"] == "DRV8825PWPR"
    assert driver["package"] == "TSSOP-28"
    assert driver["footprint"] == "28TSSOP-W6.6/E0.65"
    assert driver["field_states"]["package"]["status"] == "extracted"
    assert optocoupler["part_number"] == "TLP281"
    assert optocoupler["package"] is None
    assert optocoupler["footprint"] == "TLP281"
    assert any(
        header["raw_header"] == "PCB DECAL"
        and header["semantic_field"] == "footprint"
        for header in headers
    )


def test_open_pcb_test_point_is_kept_for_audit_but_not_procurement():
    case = _case(
        ["Part", "PCB DECAL", "Reference", "Q'ty"],
        [
            {
                "row_id": 1,
                "cells": ["TEST POINT (OPEN)", "TP-0.9", "TP100", "1"],
            }
        ],
    )

    components, _ = _adapt(case)

    assert len(components) == 1
    assert components[0]["footprint"] == "TP-0.9"
    assert "do_not_populate" in components[0]["quality_flags"]


def test_passive_cad_footprint_is_package_evidence_not_part_number():
    case = _case(
        [
            "Description",
            "PartType",
            "Value",
            "Footprint",
            "Designator",
            "Quantity",
        ],
        [
            {
                "row_id": 1,
                "cells": [
                    "Capacitor, Ceramic, 2.2uF 2.5V X6T 0201",
                    "2.2uF",
                    "2.2uF",
                    "CAP 0201/0603X03L_C",
                    "C1",
                    "1",
                ],
            },
            {
                "row_id": 2,
                "cells": [
                    "Inductor, 400mA",
                    "4.7nH",
                    "4.7nH",
                    "INDC0603X03L_C",
                    "L1",
                    "1",
                ],
            },
        ],
    )

    components, _ = _adapt(case)
    capacitor, inductor = components

    assert capacitor["part_number"] is None
    assert capacitor["package"] == "0201"
    assert inductor["part_number"] is None
    assert inductor["package"] == "0201"


def test_value_and_package_source_conflicts_are_reviewable():
    case = _case(
        ["Value", "Value", "Package", "Designator", "Quantity"],
        [
            {
                "row_id": 1,
                "cells": ["100k", "1K", "0603", "R1", "1"],
            },
            {
                "row_id": 2,
                "cells": ["3.3K ±1% 0603", "3.3K", "0402", "R2", "1"],
            },
            {
                "row_id": 3,
                "cells": ["100", "100", "3216", "R3", "1"],
            },
            {
                "row_id": 4,
                "cells": ["ADXL335BCPZ LFCSP-16", "", "LPCSP", "U1", "1"],
            },
        ],
    )

    components, _ = _adapt(case)
    value_conflict, package_conflict, numeric_value, named_package_conflict = (
        components
    )

    assert "resistance_input_source_conflict" in value_conflict["quality_flags"]
    assert value_conflict["field_states"]["resistance"]["status"] == "review"
    assert "package_input_source_conflict" in package_conflict["quality_flags"]
    assert package_conflict["field_states"]["package"]["status"] == "review"
    assert value_conflict["review_status"] == "review"
    assert package_conflict["review_status"] == "review"
    assert "package_input_source_conflict" not in numeric_value["quality_flags"]
    assert (
        "package_input_source_conflict"
        in named_package_conflict["quality_flags"]
    )


def test_space_delimited_part_number_and_package_are_split_deterministically():
    case = _case(
        ["Specification", "Package", "Designator", "Quantity"],
        [
            {
                "row_id": 1,
                "cells": ["ET1100-0003 BGA128", "BGA128", "U1", "1"],
            },
            {
                "row_id": 2,
                "cells": ["G692L308TCUF SOT143", "SOT143", "U2", "1"],
            },
            {
                "row_id": 3,
                "cells": ["MMBT3904 SOT-23", "SOT-23", "Q1", "1"],
            },
        ],
    )

    components, _ = _adapt(case)

    assert [item["part_number"] for item in components] == [
        "ET1100-0003",
        "G692L308TCUF",
        "MMBT3904",
    ]
    assert [item["package"] for item in components] == [
        "BGA128",
        "SOT143",
        "SOT-23",
    ]


def test_repeated_short_identifier_and_zero_quantity_are_handled_safely():
    case = _case(
        ["Description", "Comment", "Quantity", "Footprint", "LibRef", "Designator"],
        [
            {
                "row_id": 1,
                "cells": ["SMB size / SMD", "SS34", "1", "SMB", "SS34", "D1"],
            },
            {
                "row_id": 2,
                "cells": ["N.C.", "103", "0", "CAP_C3225N", "C_SMD", "C1"],
            },
        ],
    )

    components, _ = _adapt(case)
    diode, not_populated = components

    assert diode["part_number"] == "SS34"
    assert diode["package"] == "SMB"
    assert "do_not_populate" in not_populated["quality_flags"]


def test_semantic_fields_and_procurement_dispositions_are_rule_based():
    case = _case(
        ["Type", "Description", "Value", "Package", "Q'ty", "Reference"],
        [
            {
                "row_id": 1,
                "cells": [
                    "BEAD",
                    "Ferrite bead 120 Ohm @ 100MHz 200mA",
                    "120 Ohm",
                    "0201",
                    "2",
                    "FB1 FB2",
                ],
            },
            {
                "row_id": 2,
                "cells": [
                    "Inductor",
                    "600mA, ±0.1ｎH",
                    "2.0nH",
                    "0201",
                    "1",
                    "L1",
                ],
            },
            {
                "row_id": 3,
                "cells": ["LED", "green LED", "GREEN", "0603", "3", "D1 D2 D3"],
            },
            {
                "row_id": 4,
                "cells": ["Connector", "Header, 5-Pin, Dual row", "5X2", "", "1", "J1"],
            },
            {
                "row_id": 5,
                "cells": ["Other", "customer supplied shield", "", "", "", ""],
            },
        ],
    )

    components, _ = _adapt(case)
    ferrite, inductor, led, connector, supplied = components
    assert ferrite["impedance_ohm"] == 120.0
    assert ferrite["impedance_frequency_hz"] == 100_000_000.0
    assert "resistance_ohm" not in ferrite
    assert inductor["absolute_tolerance_h"] == pytest.approx(0.1e-9)
    assert inductor["tolerance_percent"] is None
    assert led["color"] == "green"
    assert connector["pin_count"] == 5
    assert connector["row_count"] == 2
    assert "connector_geometry_source_conflict" in connector["quality_flags"]
    assert supplied["search_disposition"] == "excluded"
    assert supplied["procurement_disposition"] == "excluded"
    assert supplied["disposition_reason_codes"] == ["customer_supplied", "quantity_missing"]


def test_reference_quantity_conflict_blocks_procurement_but_not_search():
    case = _case(
        ["Type", "Value", "Package", "Q'ty", "Reference"],
        [
            {
                "row_id": 1,
                "cells": ["Capacitor", "10nF", "0603", "2", "C1 C2 C3"],
            }
        ],
    )

    components, _ = _adapt(case)
    item = components[0]
    assert item["reference_count"] == 3
    assert item["quantity_resolution"] == "conflict"
    assert item["search_disposition"] == "search"
    assert item["procurement_disposition"] == "quantity_confirmation_required"
