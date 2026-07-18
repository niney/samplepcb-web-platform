# -*- coding: utf-8 -*-
"""단위 등가 정규화 — GT와 예측 양쪽에 동일 적용해 표기 차이를 흡수한다.

0.125W == 1/8W == 125mW, 10K == 10kΩ == 10,000 등.
정규화가 불가능한 표기는 None을 반환하고, 호출부는 문자열 폴백 비교를 쓴다.
"""
import math
import re
import unicodedata
from typing import Optional, Tuple

from rapidfuzz import fuzz

_WS = re.compile(r"\s+")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")

_NUM = r"\d+(?:\.\d+)?"


def _base(s) -> str:
    """NFKC(전각→반각, Ω(U+2126)→Ω(U+03A9)), 소문자, 공백 정리."""
    s = unicodedata.normalize("NFKC", str(s))
    s = s.lower()
    s = s.replace("ω", "ohm").replace("µ", "u").replace("μ", "u")
    s = _THOUSANDS.sub("", s)
    s = _WS.sub(" ", s).strip()
    return s


def _compact(s) -> str:
    return _base(s).replace(" ", "")


def norm_resistance(s) -> Optional[float]:
    """저항값 → Ω. '10K OHM', '4R7'(=4.7), '1M'(=1e6, 저항 관례상 메가)."""
    t = _compact(s).replace("ohms", "ohm")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)r(\d+)?", t)  # 4R7=4.7, 66.5R=66.5
    if m:
        if "." in m.group(1) and not m.group(2):
            return float(m.group(1))
        return float(f"{m.group(1)}.{m.group(2) or 0}")
    m = re.fullmatch(r"(\d+)(k|m|meg|g)(\d+)", t)  # 4K7=4.7k
    if m:
        mult = {"k": 1e3, "m": 1e6, "meg": 1e6, "g": 1e9}[m.group(2)]
        return float(f"{m.group(1)}.{m.group(3)}") * mult
    m = re.fullmatch(rf"({_NUM})(k|m|meg|g)?(ohm)?", t)
    if not m:
        return None
    mult = {None: 1.0, "k": 1e3, "m": 1e6, "meg": 1e6, "g": 1e9}[m.group(2)]
    return float(m.group(1)) * mult


def norm_power(s) -> Optional[float]:
    """전력 → W. '1/16W'(분수), '125mW'."""
    t = _compact(s)
    m = re.fullmatch(r"(\d+)/(\d+)w(atts?)?", t)
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.fullmatch(rf"({_NUM})(m|k)?w(atts?)?", t)
    if not m:
        return None
    return float(m.group(1)) * {None: 1.0, "m": 1e-3, "k": 1e3}[m.group(2)]


def norm_capacitance(s) -> Optional[float]:
    """용량 → F. '0.1uF'=='100nF', '4u7'(=4.7uF). 순수 EIA 코드('104')는 None
    → 문자열 폴백 (코드 환산은 v2)."""
    t = _compact(s)
    m = re.fullmatch(r"(\d+)(p|n|u|m)(\d+)f?", t)  # 4u7 표기
    if m:
        num = float(f"{m.group(1)}.{m.group(3)}")
        return num * {"p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
    # "15p"/"100n"처럼 F를 생략한 관용 표기도 용량 문맥에서는 등가
    m = re.fullmatch(rf"({_NUM})(p|n|u|m)?f(arads?)?", t) \
        or re.fullmatch(rf"({_NUM})(p|n|u)", t)
    if not m:
        return None
    mult = {None: 1.0, "p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
    return float(m.group(1)) * mult


def norm_voltage(s) -> Optional[float]:
    t = _compact(s)
    m = re.fullmatch(rf"({_NUM})(m|k)?v(ac|dc)?", t)
    if not m:
        return None
    return float(m.group(1)) * {None: 1.0, "m": 1e-3, "k": 1e3}[m.group(2)]


def norm_current(s) -> Optional[float]:
    t = _compact(s)
    m = re.fullmatch(rf"({_NUM})(m|u|n)?a(mps?)?", t)
    if not m:
        return None
    return float(m.group(1)) * {None: 1.0, "m": 1e-3, "u": 1e-6, "n": 1e-9}[m.group(2)]


def norm_frequency(s) -> Optional[float]:
    t = _compact(s)
    m = re.fullmatch(rf"({_NUM})(k|m|g)?hz", t)
    if not m:
        return None
    return float(m.group(1)) * {None: 1.0, "k": 1e3, "m": 1e6, "g": 1e9}[m.group(2)]


def norm_tolerance(s) -> Optional[float]:
    """정밀도 → %. '±1%'=='1%', '+/-5%'=='5%'."""
    t = _compact(s).replace("+/-", "").replace("+-", "").replace("±", "")
    m = re.fullmatch(rf"({_NUM})%?", t)
    return float(m.group(1)) if m else None


def norm_temperature(s) -> Optional[Tuple[float, ...]]:
    """온도 표기 → 숫자 튜플. '-40~+85℃' → (-40, 85)."""
    t = _base(s)
    nums = re.findall(r"[+-]?\d+(?:\.\d+)?", t)
    return tuple(float(n) for n in nums) if nums else None


def norm_package(s) -> str:
    """대문자화 + 공백/하이픈/언더스코어 제거: 'SOT-23' == 'SOT23'."""
    t = unicodedata.normalize("NFKC", str(s)).upper()
    return re.sub(r"[\s\-_]+", "", t)


# 칩 사이즈 코드의 메트릭→임페리얼 대응. 'C1005' == '1005' == '0402' ==
# '0402/1005'는 같은 물리 패키지의 표기 차이다 (0.125W==1/8W와 같은 범주).
# 무접두 4자리는 임페리얼 우선 해석, 메트릭 전용 토큰만 변환한다.
_METRIC_TO_IMPERIAL = {
    "1005": "0402", "1608": "0603", "2012": "0805", "2520": "1008",
    "3216": "1206", "3225": "1210", "1220": "0508", "4532": "1812",
    "5025": "2010", "6332": "2512",
}
_RE_SIZE_EXPR = re.compile(r"C?(\d{3,4})(?:[/_-]?C?(\d{3,4}))?")


def _pad_size(g):
    """앞자리 0 탈락 표기("603") → 표준 4자리("0603")."""
    return "0" + g if len(g) == 3 else g


def _pkg_size_canon(s):
    """사이즈 표기면 임페리얼 정준 코드 집합, 아니면 None(문자열 비교 폴백).
    KiCad형 임페리얼_메트릭 병기("0603_1608Metric", "2012_0805")와 'Metric'
    접미도 같은 물리 패키지의 표기 차이로 흡수한다. 'CAP 0402/1005'처럼
    접두어 낀 표기는 정준화하지 않는다 — "코드 부분만" 규율은 채점에서 유지."""
    t = unicodedata.normalize("NFKC", str(s)).upper().strip()
    t = re.sub(r"METRIC$", "", t).strip(" _-").replace(" ", "")
    m = _RE_SIZE_EXPR.fullmatch(t)
    if not m:
        return None
    return {_METRIC_TO_IMPERIAL.get(_pad_size(g), _pad_size(g))
            for g in m.groups() if g} or None


def package_equal(gt, pred) -> bool:
    a, b = _pkg_size_canon(gt), _pkg_size_canon(pred)
    if a is not None and b is not None:
        return bool(a & b)
    if norm_package(gt) == norm_package(pred):
        return True
    # '_' 2세그 병기("3x3_23011", "TSSOP-16_L5.0-…")는 한쪽 세그가 상대
    # 전체와 같으면 상세 접미 차이로 흡수 — GT 파일 간 관례가 갈리는
    # 표기(KSE는 병기 전체, NCRB는 코드만)의 채점 등가. 실장 방식
    # 세그(SMD/DIP)는 코드가 아니므로 제외.
    for x, y in ((gt, pred), (pred, gt)):
        ny = norm_package(y)
        if ny in ("SMD", "DIP", "TH", "THT"):
            continue
        for sep in ("_", " "):
            xs = [norm_package(s) for s in str(x).split(sep) if s]
            if len(xs) == 2 and ny in xs:
                # "3x3_23011"·"UQFN-10 RSE" — 코드+상세 접미 병기
                return True
    return False


def norm_part_number(s) -> str:
    """대소문자·공백 무시 (하이픈은 유지 — PN에서 유의미). 콤마/언더스코어는
    포장 옵션 구분자의 표기 변형이라 등가 취급 ("BAS21J,115" == "BAS21J_115")."""
    t = unicodedata.normalize("NFKC", str(s)).upper()
    return re.sub(r"[\s,_]+", "", t)


def _manufacturer_equal(a, b) -> bool:
    na, nb = _base(a), _base(b)
    if na == nb:
        return True
    return fuzz.token_set_ratio(na, nb) >= 90


_NUMERIC_NORMS = {
    "resistance": norm_resistance,
    "capacitance": norm_capacitance,
    "inductance": None,  # 아래에서 capacitance식 접두 처리
    "power": norm_power,
    "voltage": norm_voltage,
    "current": norm_current,
    "frequency": norm_frequency,
    "tolerance": norm_tolerance,
}


def norm_inductance(s) -> Optional[float]:
    t = _compact(s)
    m = re.fullmatch(r"(\d+)(p|n|u|m)(\d+)h?", t)  # 4u7 표기
    if m:
        num = float(f"{m.group(1)}.{m.group(3)}")
        return num * {"p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
    m = re.fullmatch(rf"({_NUM})(p|n|u|m)?h(enry)?", t)
    if not m:
        return None
    mult = {None: 1.0, "p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
    return float(m.group(1)) * mult


_NUMERIC_NORMS["inductance"] = norm_inductance


_REF_SEP = re.compile(r"[,;/\s]+")


def norm_reference(s) -> frozenset:
    """지시자 목록 → 토큰 집합. "FB2, FB4" == "FB2 FB4", 대소문자 무시,
    범위 표기("R5-R11", "r5~r11")는 전개하지 않고 '-' 정규화 단일 토큰으로."""
    t = unicodedata.normalize("NFKC", str(s)).upper().replace("~", "-")
    t = re.sub(r"\s*-\s*", "-", t)
    return frozenset(tok for tok in _REF_SEP.split(t) if tok)


def reference_equal(gt, pred) -> bool:
    return norm_reference(gt) == norm_reference(pred)


def values_equal(field: str, gt, pred) -> bool:
    """필드별 등가 판정. gt/pred 모두 non-null 전제."""
    if field == "reference":
        return reference_equal(gt, pred)
    if field == "quantity":
        try:
            return int(gt) == int(pred)
        except (TypeError, ValueError):
            return False
    if field == "part_type":
        return _base(gt) == _base(pred)
    if field == "part_number":
        return norm_part_number(gt) == norm_part_number(pred)
    if field == "package":
        return package_equal(gt, pred)
    if field == "manufacturer":
        return _manufacturer_equal(gt, pred)
    if field == "temperature":
        na, nb = norm_temperature(gt), norm_temperature(pred)
        if na is not None and nb is not None:
            return na == nb
        return _base(gt) == _base(pred)
    fn = _NUMERIC_NORMS.get(field)
    if fn is not None:
        na, nb = fn(gt), fn(pred)
        if na is not None and nb is not None:
            return math.isclose(na, nb, rel_tol=1e-6)
    return _base(gt) == _base(pred)
