# -*- coding: utf-8 -*-
"""데이터/라벨 패턴 검출 — BOM 데이터 행에 나타나는 값 패턴들."""
import re

# 순수 숫자 (1, 37, 1.5, 50%, -3)
RE_NUMBER = re.compile(r"^[+-]?\d+(?:[.,]\d+)?\s*%?$")

# 단일 designator: C79, FB11, LED1, RC1608
RE_DESIGNATOR = re.compile(r"^[a-z]{1,4}\d{1,4}$")

# designator 범위: c1-c12, R1~R4
RE_DESIG_RANGE = re.compile(r"^[a-z]{1,4}\d{1,4}\s*[-~]\s*[a-z]{1,4}\d{1,4}$")

# 값+단위: 10uF, 100nF/16V, 330R 5%, 3k, 4.7uH, 120Ω
_UNITS = (
    r"uf|nf|pf|µf|mf|f|uh|nh|mh|h|"
    r"ohm|ω|kω|mω|r|k|m|meg|"
    r"v|kv|mv|a|ma|ua|w|mw|kw|"
    r"hz|khz|mhz|ghz|%|u|n|p"
)
RE_VALUE_UNIT = re.compile(r"^\d+(?:[.,]\d+)?\s*(?:" + _UNITS + r")(?:\b|$)")

# 패키지/풋프린트: 0603, 402, 0402/1005, CAP 0603/1608, QFN-32, SOT-23, SO-8
# 접두어가 있으면 1-4자리 숫자 허용(QFN-32), 없으면 3-4자리만(402, 0603)
RE_PACKAGE = re.compile(
    r"^(?:(?:cap|res|fer|ind|led|dio|hdr|conn|dip|smd|sma|sod|sot|soic|sop"
    r"|ssop|tssop|so|qfn|dfn|son|wson|xqfn|ufqfn|aqfn|qfp|lqfp|tqfp|bga|to)"
    r"[\s\-]*\d{1,4}|\d{3,4})(?:[/x_\-]\d{1,4})?$"
)

# 날짜: 2025-03-20, 2020.04.08
RE_DATE = re.compile(r"^\d{4}[-./]\d{1,2}[-./]\d{1,2}")

# 수식
RE_FORMULA = re.compile(r"^=")

MAX_LABEL_LEN = 45  # 이보다 길면 설명문(데이터)으로 간주


def looks_designator_list(s: str) -> bool:
    """'FB1, FB2, FB11' / 'c1-c12' / 'C15,C19,C22' 형태."""
    parts = [p for p in re.split(r"[,\s]+", s) if p]
    if not parts:
        return False
    hit = sum(
        1 for p in parts if RE_DESIGNATOR.match(p) or RE_DESIG_RANGE.match(p)
    )
    if len(parts) == 1:
        return bool(RE_DESIG_RANGE.match(parts[0]))
    return hit / len(parts) >= 0.6


def is_data_like(norm: str) -> bool:
    """정규화된 셀 값이 헤더 라벨이 아니라 데이터 값처럼 보이는가."""
    if not norm:
        return False
    if RE_NUMBER.match(norm):
        return True
    if RE_DATE.match(norm):
        return True
    if RE_FORMULA.match(norm):
        return True
    if RE_VALUE_UNIT.match(norm):
        return True
    if RE_PACKAGE.match(norm):
        return True
    if RE_DESIGNATOR.match(norm):
        return True
    if looks_designator_list(norm):
        return True
    if len(norm) > MAX_LABEL_LEN:
        return True
    return False


def is_label_like(norm: str) -> bool:
    """짧고 문자가 포함된, 데이터 패턴이 아닌 셀 — 헤더 라벨 후보."""
    if not norm or len(norm) > MAX_LABEL_LEN:
        return False
    if is_data_like(norm):
        return False
    return bool(re.search(r"[a-z가-힣#]", norm))
