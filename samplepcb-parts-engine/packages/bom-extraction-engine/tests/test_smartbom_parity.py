# -*- coding: utf-8 -*-
"""SMARTBOM 헤더 탐지 패리티 — 검증 정답지 대비 정답률 감시.

옵트인 slow 테스트: SMARTBOM_PARITY=1 환경변수로 실행하고,
excel_test 코퍼스가 없으면 skip한다.

  SMARTBOM_PARITY=1 uv run pytest tests/test_smartbom_parity.py -s

이력: 원래 이 파일에는 "원본 bom_probing_claude vs 이식본 rule_extractor
전 행·전 필드 100% 일치" 추출 패리티도 있었다(이식 무결성 검증,
71파일·4,503행 100% 일치로 통과). 커밋 99ee721부터 추출 개선이 연구
원본이 아니라 이식본(bom_extraction_engine)에 직접 반영되는 국면으로
전환되어 — 이식본이 개선의 본선 — "원본과 동일해야 한다"는 전제가
사라져 추출 패리티는 제거했다. 추출 회귀 방지는 test_smartbom_rules의
케이스 고정이 담당한다.

헤더 탐지 패리티는 유지한다 — header_probing_claude의 검증 정답지
(사람 확인 111건)는 여전히 유효한 성능 기준선이다.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
CORPUS_DIR = WORKSPACE_ROOT / "excel_test"
HEADER_GT = WORKSPACE_ROOT / "header_probing_claude" / "ground_truth_test.json"

pytestmark = [
    pytest.mark.skipif(os.getenv("SMARTBOM_PARITY") != "1",
                       reason="opt-in: SMARTBOM_PARITY=1"),
    pytest.mark.skipif(not CORPUS_DIR.is_dir(), reason="excel_test 코퍼스 없음"),
    pytest.mark.skipif(not HEADER_GT.is_file(), reason="헤더 정답지 없음"),
]


def test_header_detection_parity_report():
    from bom_extraction_engine.bom_loader import load_sheet
    from bom_extraction_engine.workbook import detect_header

    entries = json.loads(HEADER_GT.read_text(encoding="utf-8"))
    total = correct = 0
    misses: list[str] = []
    for entry in entries:
        rel = entry["file"]
        path = WORKSPACE_ROOT / rel
        if not path.is_file():
            continue
        try:
            df = load_sheet(str(path), entry["sheet"])
        except Exception:
            continue
        total += 1
        gt_rows = entry["header_rows"]
        res = detect_header(df)
        # GT가 빈 배열이면 '헤더 없는 시트' — 기권(found=False)이 정답이다
        if res.found:
            if gt_rows and res.header_row in gt_rows:
                correct += 1
            else:
                misses.append(f"{rel} sheet{entry['sheet']}: "
                              f"GT {gt_rows} vs {res.header_row}")
        else:
            if not gt_rows:
                correct += 1
            else:
                misses.append(f"{rel} sheet{entry['sheet']}: 미탐 (GT {gt_rows})")

    print(f"\n[헤더 패리티] GT {total}건 중 정답 {correct}건 "
          f"(정답률 {correct / max(total, 1):.1%})")
    for line in misses[:20]:
        print("  ", line)
    # 탐지기(m6_fusion 이식) 자체 성능 하한 — 회귀 시 크게 무너진다
    assert correct / max(total, 1) >= 0.8
