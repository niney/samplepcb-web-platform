"""실제 어댑터 출력과 Node strict 계약이 공유하는 드리프트 감지 fixture."""
from __future__ import annotations

import json
from pathlib import Path

from bom_extraction_engine.adapter import adapt_sheet
from bom_extraction_engine.rule_extractor import compute_roles, extract_case


FIXTURE = (Path(__file__).parents[3]
           / "contracts" / "fixtures" / "component-record.json")


def test_component_record_fixture_matches_actual_engine_output():
    case = {
        "file": "contract.csv",
        "sheet": 0,
        "sheet_name": "BOM",
        "header_rows": [0],
        "header_labels": ["Part Number", "Q'ty"],
        "column_indices": [0, 1],
        "rows": [{"row_id": 1, "cells": ["ABC-123", "2"]}],
    }
    roles = compute_roles(case)
    predictions, sources = extract_case(case, roles)
    components, _headers = adapt_sheet(
        case,
        roles,
        predictions,
        sources,
        source_file="contract.csv",
        sheet_index=0,
    )
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert components == [expected]
