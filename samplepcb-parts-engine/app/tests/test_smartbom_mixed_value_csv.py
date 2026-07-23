import csv
from pathlib import Path

import pytest

from bom_extraction_engine.engine import SmartbomConfig, build_smartbom_result
from bom_extraction_engine.rule_extractor import classify_columns
from bom_extraction_engine.workbook import build_case
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.models import SearchMode
from supplier_search_engine.planner import QueryPlanner


def _run(source: Path) -> dict:
    return build_smartbom_result(
        input_path=source,
        original_filename=source.name,
        config=SmartbomConfig(m2v_path="off"),
        progress=lambda *_: None,
    )


@pytest.mark.parametrize(
    "label",
    ["Value/Part", "Part/Value", "Value / MPN", "규격/품번"],
)
def test_composite_value_identity_headers_use_cell_level_value_role(
    label: str,
) -> None:
    roles = classify_columns([label, "Footprint", "Qty", "Refs"])

    assert roles["value"] == [0]
    assert 0 not in roles.get("part_number", [])
    assert roles["quantity"] == [2]
    assert roles["designator"] == [3]


def test_explicit_part_number_header_remains_identity_role() -> None:
    roles = classify_columns(["Manufacturer Part Number", "Qty", "Reference"])

    assert roles["part_number"] == [0]
    assert 0 not in roles.get("value", [])


def test_mixed_column_separates_specs_mpn_and_material_without_false_identity(
    tmp_path: Path,
) -> None:
    source = tmp_path / "mixed-semantics.csv"
    source.write_text(
        "\n".join(
            [
                "Value/Part,Footprint,Qty,Refs",
                "100R/0.1%,R_0805_2012Metric,1,R1",
                "100n,C_0603_1608Metric,1,C1",
                "470p,C_0603_1608Metric,1,C3",
                "4.7u/Film,C_Rect_L7.0mm_W2.5mm_P5.00mm,1,C2",
                "22u,L_Custom_6x6mm,1,L1",
                "SS34,D_SMA,1,D1",
                "BLUE,LED_0603_1608Metric,1,D2",
            ]
        ),
        encoding="utf-8",
    )

    result = _run(source)
    by_value = {component["value_raw"]: component for component in result["components"]}

    resistor = by_value["100R/0.1%"]
    assert resistor["part_number"] is None
    assert resistor["resistance_ohm"] == 100.0
    assert resistor["tolerance_percent"] == 0.1

    ceramic = by_value["100n"]
    assert ceramic["part_number"] is None
    assert ceramic["capacitance_f"] == pytest.approx(100e-9)

    picofarad = by_value["470p"]
    assert picofarad["part_number"] is None
    assert picofarad["capacitance_f"] == pytest.approx(470e-12)

    film = by_value["4.7u/Film"]
    assert film["part_number"] is None
    assert film["capacitance_f"] == pytest.approx(4.7e-6)

    inductor = by_value["22u"]
    assert inductor["part_number"] is None
    assert inductor["inductance_h"] == pytest.approx(22e-6)

    diode = by_value["SS34"]
    assert diode["part_number"] == "SS34"

    led = by_value["BLUE"]
    assert led["component_type"] == "led"
    assert "part_type_source_conflict" not in led["quality_flags"]

    batch = build_batch_from_result(result)
    plans = {
        component.value_raw: QueryPlanner().plan(component)
        for component in batch.components
    }
    assert plans["100R/0.1%"].mode == SearchMode.PARAMETRIC
    assert plans["100n"].mode == SearchMode.PARAMETRIC
    assert plans["SS34"].part_number == "SS34"


def test_repeated_instance_labels_are_suppressed_independent_of_row_order(
    tmp_path: Path,
) -> None:
    header = "Part/Value,Footprint,Qty,Refs"
    rows = [
        "SIGNAL1,PinHeader_1x02_P2.54mm_Vertical,1,J1",
        "SIGNAL2,PinHeader_1x02_P2.54mm_Vertical,1,J2",
        "SIGNAL3,PinHeader_1x02_P2.54mm_Vertical,1,J3",
        "ZXM1234,SOIC-8,1,U1",
    ]
    observed = []
    for index, ordered_rows in enumerate((rows, list(reversed(rows)))):
        source = tmp_path / f"order-{index}.csv"
        source.write_text(
            "\n".join([header, *ordered_rows]),
            encoding="utf-8",
        )
        result = _run(source)
        by_value = {
            component["value_raw"]: component for component in result["components"]
        }
        observed.append(
            {
                value: (
                    component["part_number"],
                    component["pin_count"],
                    component["row_count"],
                    component["pitch_mm"],
                )
                for value, component in by_value.items()
            }
        )

    assert observed[0] == observed[1]
    for value in ("SIGNAL1", "SIGNAL2", "SIGNAL3"):
        assert observed[0][value] == (None, 2, 1, 2.54)
    assert observed[0]["ZXM1234"][0] == "ZXM1234"


def test_explicit_mpn_sequence_is_not_suppressed_as_instance_labels(
    tmp_path: Path,
) -> None:
    source = tmp_path / "explicit-mpn.csv"
    source.write_text(
        "\n".join(
            [
                "MPN,Footprint,Qty,Reference",
                "ABC1,PinHeader_1x02_P2.54mm_Vertical,1,J1",
                "ABC2,PinHeader_1x02_P2.54mm_Vertical,1,J2",
                "ABC3,PinHeader_1x02_P2.54mm_Vertical,1,J3",
            ]
        ),
        encoding="utf-8",
    )

    result = _run(source)

    assert [component["part_number"] for component in result["components"]] == [
        "ABC1",
        "ABC2",
        "ABC3",
    ]


def test_unquoted_delimiter_in_joinable_footprint_is_recovered_with_review_trace(
    tmp_path: Path,
) -> None:
    source = tmp_path / "ragged.csv"
    source.write_text(
        "\n".join(
            [
                "Value/Part,Footprint,Qty,Refs",
                "PORT1,TerminalBlock_Family,Variant_1x02_P5.08mm_Horizontal,1,TB1",
                "PORT2,TerminalBlock_Family,Variant_1x02_P5.08mm_Horizontal,1,TB2",
                "PORT3,TerminalBlock_Family,Variant_1x02_P5.08mm_Horizontal,1,TB3",
                "ZXM1234,SOIC-8,1,U1",
            ]
        ),
        encoding="utf-8",
    )

    case = build_case(source, 0, display_name=source.name, sheet_name="csv")
    recovered_rows = [row for row in case["rows"] if row.get("row_shape")]
    assert len(case["header_labels"]) == 4
    assert len(recovered_rows) == 3
    assert all(row["row_shape"]["status"] == "recovered" for row in recovered_rows)

    result = _run(source)
    by_value = {component["value_raw"]: component for component in result["components"]}
    for index in range(1, 4):
        component = by_value[f"PORT{index}"]
        assert component["part_number"] is None
        assert component["quantity"] == 1
        assert component["reference_designators"] == [f"TB{index}"]
        assert component["footprint"] == (
            "TerminalBlock_Family,Variant_1x02_P5.08mm_Horizontal"
        )
        assert component["pin_count"] == 2
        assert component["row_count"] == 1
        assert component["pitch_mm"] == 5.08
        assert component["quality_flags"] == ["row_shape_recovered"]
        assert component["review_status"] == "review"
        assert component["row_shape"]["merged_column_1based"] == 2
        assert component["row_shape"]["merged_fragment_count"] == 2
        assert len(component["row_shape"]["source_cells"]) == 5
        assert component["row_shape"]["repaired_cells"][2:] == ["1", f"TB{index}"]


def test_ambiguous_ragged_row_is_not_silently_recovered(tmp_path: Path) -> None:
    source = tmp_path / "ambiguous-ragged.csv"
    source.write_text(
        "\n".join(
            [
                "Value/Part,Footprint,Qty,Refs",
                "10k,R_0603_1608Metric,1,R1",
                "100n,C_0603_1608Metric,1,C1",
                "SS34,D_SMA,1,D1",
                "BROKEN,Unknown_Footprint,extra,not-a-quantity,U2",
            ]
        ),
        encoding="utf-8",
    )

    case = build_case(source, 0, display_name=source.name, sheet_name="csv")
    broken_row = next(row for row in case["rows"] if row["row_id"] == 4)
    assert broken_row["row_shape"]["status"] == "invalid"

    result = _run(source)
    broken = next(
        component
        for component in result["components"]
        if component["source_rows_1based"] == [5]
    )
    assert "row_shape_invalid" in broken["quality_flags"]
    assert broken["review_status"] == "review"
    assert broken["row_shape"]["source_cells"][-2:] == ["not-a-quantity", "U2"]


def test_normally_quoted_delimiter_needs_no_recovery_flag(tmp_path: Path) -> None:
    source = tmp_path / "quoted.csv"
    with source.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerows(
            [
                ["Value/Part", "Footprint", "Qty", "Refs"],
                ["PORT", "TerminalBlock_Family,Variant_1x02", 1, "TB1"],
                ["SS34", "D_SMA", 1, "D1"],
                ["10k", "R_0603_1608Metric", 1, "R1"],
            ]
        )

    result = _run(source)
    port = next(
        component
        for component in result["components"]
        if component["value_raw"] == "PORT"
    )

    assert port["footprint"] == "TerminalBlock_Family,Variant_1x02"
    assert "row_shape_recovered" not in port["quality_flags"]
    assert "row_shape_invalid" not in port["quality_flags"]
