"""협력사 재고표(inventory) 프로필 — BOM 추출이 버리는 것을 살려야 한다.

BOM 경로는 price·재고·납기를 `_IGNORE_PAT` 으로 폐기하고 재고 수량을 보드당
수량으로 오해한다. 이 프로필의 계약은 그 반대이며, 무엇보다 **어떤 셀도 조용히
버리지 않는다**(실측 결함: BOM 추출기가 `DS1307Z+T&R` 를 플래그 없이 null 로 떨궜다).
"""
from __future__ import annotations

import csv
from pathlib import Path

from bom_extraction_engine import InventoryConfig, build_inventory_result


def _write_csv(tmp_path: Path, rows: list[list[str]], name: str = "stock.csv") -> Path:
    path = tmp_path / name
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(rows)
    return path


def _run(path: Path, config: InventoryConfig | None = None) -> dict:
    return build_inventory_result(
        input_path=path,
        original_filename=path.name,
        progress=lambda *_: None,
        config=config,
    )



def test_inventory_profile_keeps_commercial_columns(tmp_path: Path):
    path = _write_csv(tmp_path, [
        ["Parts No.", "date Code", "Brand", "QTY.", "price", "Lead Time"],
        ["STM32F030F4P6", "23+", "ST", "1,200", "$1.35", "Stock"],
    ])
    result = _run(path)

    assert result["engine"] == "inventory"
    row = result["rows"][0]
    assert row["part_number"] == "STM32F030F4P6"
    assert row["manufacturer"] == "ST"
    assert row["stock_qty"] == 1200          # 콤마 표기
    assert row["date_code"] == "23+"
    assert row["lead_time"] == "Stock"
    assert row["unit_price"] == 1.35
    assert row["currency"] == "USD"          # 통화 열이 없어도 기호에서 읽는다
    assert result["summary"]["with_stock"] == 1


def test_part_number_is_never_dropped_and_keeps_raw(tmp_path: Path):
    """BOM 추출기가 무플래그로 떨구던 `+T&R` 접미가 그대로 살아 있어야 한다."""
    path = _write_csv(tmp_path, [
        ["Parts No.", "QTY."],
        ["DS1307Z+T&R", "500"],
    ])
    row = _run(path)["rows"][0]

    assert row["part_number"] == "DS1307Z+T&R"
    assert row["part_number_raw"] == "DS1307Z+T&R"
    assert row["part_number_alternatives"] == []
    assert row["flags"] == []


def test_noisy_part_number_yields_alternatives_instead_of_a_guess(tmp_path: Path):
    """정본은 원문 — 잡음을 뗀 결과는 후보로만 남겨 조회가 둘 다 걸리게 한다."""
    path = _write_csv(tmp_path, [
        ["Parts No.", "Brand", "QTY."],
        ["ACS725LLCTR-20AB-T Allegro MicroSystems", "", "10"],
        ["PCA9575PW2, 118", "NXP", "10"],
        ["TBD62783AFNG,EL 4000ea", "Toshiba", "10"],
    ])
    rows = _run(path)["rows"]

    two_word_brand = rows[0]
    assert two_word_brand["part_number"] == "ACS725LLCTR-20AB-T Allegro MicroSystems"
    assert "ACS725LLCTR-20AB-T" in two_word_brand["part_number_alternatives"]
    # 두 낱말 브랜드를 통째로 회수한다(한 토큰만 떼면 제조사가 'MicroSystems' 가 된다).
    assert two_word_brand["manufacturer"] == "Allegro MicroSystems"

    comma_suffix = rows[1]
    assert comma_suffix["part_number"] == "PCA9575PW2, 118"
    assert "PCA9575PW2" in comma_suffix["part_number_alternatives"]
    assert comma_suffix["manufacturer"] == "NXP"   # 제조사 열이 있으면 힌트가 덮지 않는다

    qty_suffix = rows[2]
    assert "TBD62783AFNG,EL" in qty_suffix["part_number_alternatives"]
    assert "mpn_quantity_suffix_stripped" in qty_suffix["flags"]


def test_unmapped_columns_survive_in_raw_fields(tmp_path: Path):
    path = _write_csv(tmp_path, [
        ["Parts No.", "QTY.", "창고", "비고란"],
        ["LM358D", "5", "A-12", "샘플"],
    ])
    result = _run(path)
    row = result["rows"][0]

    assert row["raw_fields"]["창고"] == "A-12"
    assert row["raw_fields"]["Parts No."] == "LM358D"


def test_rows_without_part_number_are_kept_for_review(tmp_path: Path):
    path = _write_csv(tmp_path, [
        ["Parts No.", "QTY."],
        ["", "300"],
    ])
    row = _run(path)["rows"][0]

    assert row["flags"] == ["part_number_missing"]
    assert row["raw_fields"]["QTY."] == "300"


def test_role_overrides_re_run_without_reinterpreting_cells(tmp_path: Path):
    """사람이 미리보기에서 고친 열 역할은 엔진이 다시 적용한다."""
    path = _write_csv(tmp_path, [
        ["Parts No.", "보유", "QTY."],
        ["LM358D", "40", "7"],
    ])
    default_row = _run(path)["rows"][0]
    assert default_row["stock_qty"] == 40      # '보유' 가 먼저 잡힌다

    corrected = _run(path, InventoryConfig(
        role_overrides={0: {2: "ignore", 3: "stock_qty"}},
    ))
    assert corrected["rows"][0]["stock_qty"] == 7
    assert corrected["rows"][0]["raw_fields"]["보유"] == "40"


def test_header_row_override_and_headerless_content_inference(tmp_path: Path):
    """제목 줄이 앞에 있는 표도, 헤더가 아예 없는 표도 읽는다."""
    titled = _write_csv(tmp_path, [
        ["EUREKA STOCK LIST 2026", "", ""],
        ["Parts No.", "Brand", "QTY."],
        ["LM358D", "ST", "10"],
    ], name="titled.csv")
    assert _run(titled)["sheets"][0]["header_rows_1based"] == [2]

    headerless = _write_csv(tmp_path, [
        ["LM358D", "1000"],
        ["STM32F030F4P6", "2000"],
        ["ADUC7020BCPZ62I-R7", "3000"],
        ["74441-0010", "4000"],
    ], name="headerless.csv")
    result = _run(headerless)
    assert result["sheets"][0]["header_rows_1based"] == []
    assert result["summary"]["row_count"] == 4
    assert result["rows"][0]["part_number"] == "LM358D"
    assert result["rows"][0]["stock_qty"] == 1000


def test_sheet_without_part_number_column_is_reported_not_dropped(tmp_path: Path):
    path = _write_csv(tmp_path, [
        ["담당자", "연락처"],
        ["홍길동", "010-0000-0000"],
    ])
    sheet = _run(path)["sheets"][0]

    assert sheet["status"] == "not_inventory"
    assert sheet["unparsed_reason"] == "part_number_column_not_found"


def test_row_limit_truncates_with_a_warning(tmp_path: Path):
    path = _write_csv(tmp_path, [["Parts No.", "QTY."]]
                      + [[f"MPN-{i}", "10"] for i in range(10)])
    result = _run(path, InventoryConfig(row_limit=4))

    assert result["summary"]["row_count"] == 4
    assert any("행 상한" in warning for warning in result["sheets"][0]["warnings"])
