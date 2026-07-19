from supplier_search_engine.contract import build_batch_from_result


def component(sheet_index: int, row: int) -> dict:
    return {
        "sheet_index_0based": sheet_index,
        "sheet_name": f"SHEET_{sheet_index}",
        "source_rows_1based": [row],
        "reference_designators": [],
        "raw_fields": {"part_number": f"PART-{sheet_index}-{row}"},
        "field_states": {},
    }


def test_selected_sheet_indexes_limit_supplier_batch() -> None:
    result = {
        "schema_version": "1.0",
        "source_file": "multi.xlsx",
        "components": [component(0, 2), component(0, 3), component(1, 2)],
    }

    batch = build_batch_from_result(result, sheet_indexes={1})

    assert len(batch.components) == 1
    assert batch.components[0].sheet_index_0based == 1
    assert batch.components[0].source_rows_1based == [2]


def test_missing_sheet_filter_preserves_admin_all_sheet_behavior() -> None:
    result = {
        "schema_version": "1.0",
        "source_file": "multi.xlsx",
        "components": [component(0, 2), component(1, 2)],
    }

    batch = build_batch_from_result(result)

    assert [item.sheet_index_0based for item in batch.components] == [0, 1]
