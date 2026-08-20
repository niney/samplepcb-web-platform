# -*- coding: utf-8 -*-
"""셀 값 정규화 — 모든 프로빙 방법이 공유하는 전처리."""
import math
import re
import unicodedata

import pandas as pd

_QUOTES = re.compile(r"[`'’‘\"]")
_PARENS = re.compile(r"[\(\[][^)\]]*[\)\]]")
_SEPS = re.compile(r"[._/\\\-]+")
_WS = re.compile(r"\s+")
_HANGUL_GAP = re.compile(r"(?<=[가-힣])\s+(?=[가-힣])")


def cell_to_str(value) -> str:
    """셀 값을 문자열로. NaN은 빈 문자열, 정수형 float은 정수 표기.

    대부분의 셀은 str/int/float이므로 pandas.isna()는 특수 타입
    (NaT, pd.NA 등)에만 호출한다 — 프로파일상 isna 비중이 컸음.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        if value.is_integer():
            return str(int(value))
        return str(value)
    if isinstance(value, int):
        return str(value)
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value)


def normalize_cell(value) -> str:
    """공통 정규화: NFKC(전각→반각), 소문자, 따옴표 제거, 공백 정리.

    데이터 패턴 검사용 — 슬래시 등 구분자는 보존한다 (예: '0402/1005').
    """
    s = cell_to_str(value)
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\n", " ").replace("\r", " ")
    s = _QUOTES.sub("", s)  # Q'ty / Q`ty -> Qty
    s = s.lower()
    s = _WS.sub(" ", s).strip()
    return s


def label_form(value) -> str:
    """헤더 라벨 매칭용 정규화: 괄호 주석 제거, 구분자를 공백으로.

    예: 'ITEM_NUMBER' -> 'item number', '필요수량(52대)' -> '필요수량',
        'Ref-Des.' -> 'ref des'
    """
    normalized = normalize_cell(value)
    if not normalized:
        return ""
    s = _PARENS.sub(" ", normalized)
    s = _SEPS.sub(" ", s)
    s = _WS.sub(" ", s).strip(" :.,;")
    if not s:
        # ``(Package)``처럼 셀 전체가 괄호형 하위 헤더인 경우에는 주석
        # 제거 결과가 비어 버린다. 문자 라벨일 때만 괄호 안 본문을 복구해
        # ``(1005)`` 같은 데이터 토큰을 헤더로 승격하지 않는다.
        fallback = normalized.strip("()[]{}")
        fallback = _SEPS.sub(" ", fallback)
        fallback = _WS.sub(" ", fallback).strip(" :.,;")
        if re.search(r"[a-z가-힣#]", fallback):
            s = fallback
    # 레거시 양식의 시각적 자간("도 면 번 호", "품 명")은 의미상 한
    # 단어다. 영문 단어 사이 공백은 그대로 유지한다.
    s = _HANGUL_GAP.sub("", s)
    return s
