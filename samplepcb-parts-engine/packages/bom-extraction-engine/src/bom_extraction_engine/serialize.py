# -*- coding: utf-8 -*-
"""시트 조각 유틸 — 헤더 라벨 병합 / 데이터 행·열 필터.

원본 bom_probing_claude/serialize.py에서 LLM 프롬프트용 TSV 직렬화
(to_tsv)를 제거했다. row_id는 0-based 시트 절대 행번호다.
"""
import re
from typing import List

import pandas as pd

from .normalize import cell_to_str

_WS = re.compile(r"[\t\r\n]+")

MIN_NONEMPTY_CELLS = 2  # 이 미만이면 유령 행(No만 남은 빈 행 등)으로 간주


def clean_cell(value) -> str:
    """탭/개행을 공백으로 — TSV 안전."""
    return _WS.sub(" ", cell_to_str(value)).strip()


def merge_header_labels(df: pd.DataFrame, header_rows: List[int]) -> List[str]:
    """다중 헤더 행이면 열별 상하 라벨을 '/'로 결합."""
    labels = []
    for col in range(df.shape[1]):
        parts = []
        for r in header_rows:
            if r < df.shape[0]:
                s = clean_cell(df.iat[r, col])
                if s and s not in parts:
                    parts.append(s)
        labels.append("/".join(parts))
    return labels


def nonempty_data_rows(df: pd.DataFrame, header_rows: List[int],
                       min_cells: int = MIN_NONEMPTY_CELLS) -> List[int]:
    """헤더 아래에서 실질 데이터 행만 (비어있지 않은 셀 >= min_cells)."""
    start = max(header_rows) + 1
    rows = []
    for r in range(start, df.shape[0]):
        n = sum(1 for c in range(df.shape[1]) if clean_cell(df.iat[r, c]))
        if n >= min_cells:
            rows.append(r)
    return rows


def kept_columns(df: pd.DataFrame, header_labels: List[str],
                 row_ids: List[int]) -> List[int]:
    """헤더 라벨과 선택 행이 전부 빈 열은 제거."""
    cols = []
    for c in range(df.shape[1]):
        if header_labels[c]:
            cols.append(c)
            continue
        if any(clean_cell(df.iat[r, c]) for r in row_ids):
            cols.append(c)
    return cols


def row_cells(df: pd.DataFrame, row_id: int, cols: List[int]) -> List[str]:
    return [clean_cell(df.iat[row_id, c]) for c in cols]
