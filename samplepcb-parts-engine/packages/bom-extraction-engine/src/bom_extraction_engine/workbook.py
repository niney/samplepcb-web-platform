# -*- coding: utf-8 -*-
"""워크북 → 추출 케이스 — bom_probing_claude/bom_extract.py의 케이스 조립부 이식.

원본 대비 프로덕션화:
- 정답지(ground truth) 헤더 조회 제거 — fusion.FusionProber 단독 탐지
- SystemExit 대신 HeaderNotFound 예외 (호출부가 시트 status not_bom으로 변환)
- stderr PROGRESS 프로토콜 제거 — 진행은 호출부 콜백이 담당
- build_case가 column_indices(케이스 열 → 원본 df 열, 0-based)를 보존 —
  Evidence의 A1 셀 좌표 구성에 필요 (원본은 열 좌표를 버렸다)

반복 헤더/푸터/PCB 사양 행 제거 로직은 원본과 동일 — 정확도가 존재
이유이므로 규칙 본문은 바꾸지 않는다.
"""
import re
import threading
from pathlib import Path
from typing import List

from .bom_loader import get_sheet_names, load_sheet  # noqa: F401 (재수출)
from .fusion import FusionProber
from .probe_base import ProbeResult
from .serialize import (clean_cell, kept_columns, merge_header_labels,
                        nonempty_data_rows, row_cells)

_RE_FOOTER_WORD = re.compile(
    r"^(?:total|합\s*계|총\s*계|소\s*계|승인|결재|approved?|reviewed|checked"
    r"|notes?|작업\s*제외)$", re.I)
_RE_ALPHA = re.compile(r"[A-Za-z가-힣]")
_RE_ALNUM_TOKEN = re.compile(r"(?=.*[A-Za-z])(?=.*\d)")
_RE_EXCLUDED_MARK = re.compile(r"^작업\s*제외$")   # 행 전체 미실장 지시
_RE_PCB_SPEC = re.compile(
    r"^(?:pcb\s*사양|층\s*수|layers?|크기|board\s*size|재질|material"
    r"|두께.*|표면\s*처리|surface\s*finish|[숄솔]더\s*마스크|solder\s*mask"
    r"|마킹.*|실크|silk(?:screen)?|외형\s*가공)$", re.I)


class HeaderNotFound(Exception):
    """헤더 행 미탐 — 시트가 BOM 표가 아니거나 사전 밖 표현."""


# 탐지기 싱글턴 — fusion 내부 캐시(LRU)와 임베딩 모델을 프로세스에서 공유
_fusion_lock = threading.Lock()
_fusion_prober = None


def detect_header(df) -> ProbeResult:
    global _fusion_prober
    with _fusion_lock:
        if _fusion_prober is None:
            _fusion_prober = FusionProber()
        prober = _fusion_prober
    return prober.detect(df)


def _similar_header_rows(df, header_row: int) -> list:
    """헤더 행과 라벨이 상당수 일치하는 행 — 반복 헤더(다중 BOM 구간)."""
    hdr = [clean_cell(df.iat[header_row, c]) for c in range(df.shape[1])]
    n_lab = sum(1 for h in hdr if h)
    need = max(2, int(n_lab * 0.6))
    out = []
    for r in range(df.shape[0]):
        if r == header_row:
            continue
        same = sum(1 for c in range(df.shape[1])
                   if hdr[c] and clean_cell(df.iat[r, c]) == hdr[c])
        if same >= need:
            out.append(r)
    return out


def _is_footer_row(df, r: int) -> bool:
    """합계/승인/좌표 등 비부품 꼬리 행 — 부품 신호(영숫자 혼합 토큰)가
    없으면서 푸터 단어가 있거나 순수 숫자만 나열된 행."""
    vals = [clean_cell(df.iat[r, c]) for c in range(df.shape[1])]
    vals = [v for v in vals if v]
    if not vals:
        return True
    if any(_RE_EXCLUDED_MARK.fullmatch(v) for v in vals):
        return True   # 미실장 행 — 부분 제외 문구("R166 작업 제외")는 유지
    if _RE_PCB_SPEC.fullmatch(vals[0]):
        return True   # PCB 제작 사양(층수/크기/표면처리…) — 부품이 아니다
    has_partish = any(len(v) >= 4 and _RE_ALNUM_TOKEN.match(v) for v in vals)
    if has_partish:
        return False
    if any(_RE_FOOTER_WORD.fullmatch(v) for v in vals):
        return True
    if len(vals) >= 2 and not any(_RE_ALPHA.search(v) for v in vals):
        return True  # 좌표/합계성 순수 숫자 행
    return False


def build_case(path: Path, sheet_idx: int, display_name: str = "",
               sheet_name: str | None = None) -> dict:
    """엑셀 시트 → 추출 케이스 (rule_extractor.extract_case 입력).

    display_name: 결과에 쓸 파일명 — 웹 업로드처럼 실제 경로가
    "source.xlsx"일 때 원본 파일명을 유지한다.
    sheet_name: 호출부가 get_sheet_names()를 이미 수행했으면 전달해
    파일 재파싱을 피한다.
    """
    df = load_sheet(str(path), sheet_idx)
    rel = display_name or Path(path).name
    res = detect_header(df)
    if not res.found:
        raise HeaderNotFound(res.reason or "헤더 행을 찾지 못함")
    header_rows: List[int] = [res.header_row]
    # 반복 헤더(다중 BOM 구간) 지원 — 같은 라벨의 헤더가 여러 번 나오면
    # ① 가장 이른 구간부터 시작(탐지가 뒤 구간을 찍어도 앞 구간 회수),
    # ② 반복 헤더 행 자체는 데이터에서 제외하되 header_rows에는 기록.
    # 탐지 결과와 유사 행 스캔을 합친 뒤, anchor에 연속한 행들만 라벨
    # 병합 블록(다중 행 헤더)이고 나머지는 전부 반복 헤더다.
    all_hdr = sorted(set(header_rows)
                     | set(_similar_header_rows(df, header_rows[-1])))
    block = [all_hdr[0]]
    for r in all_hdr[1:]:
        if r != block[-1] + 1:
            break
        block.append(r)
    header_rows = all_hdr
    labels = merge_header_labels(df, block)
    data_rows = [r for r in nonempty_data_rows(df, block)
                 if r not in set(all_hdr) and not _is_footer_row(df, r)]
    cols = kept_columns(df, labels, data_rows)
    return {
        "file": rel,
        "sheet": sheet_idx,
        "sheet_name": (sheet_name if sheet_name is not None
                       else get_sheet_names(str(path))[sheet_idx]),
        "header_rows": header_rows,
        "header_labels": [labels[c] for c in cols],
        "column_indices": cols,
        "rows": [{"row_id": r, "cells": row_cells(df, r, cols)}
                 for r in data_rows],
        "detect_confidence": res.confidence,
    }
