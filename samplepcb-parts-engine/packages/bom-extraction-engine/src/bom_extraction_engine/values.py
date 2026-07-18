# -*- coding: utf-8 -*-
"""원문 표기 → 표시용 정규화 수치 — normalize_values의 어댑터 진입점.

normalize_values.py는 원래 채점용 등가 판정기지만, 여기서는 G-shape
ComponentRecord의 resistance_ohm/capacitance_f/… 수치 필드를 만드는
정규화기로 재사용한다. 정규화 실패는 None — raw 값은 raw_fields와
field_states에 항상 보존되므로 억지로 채우지 않는다.
"""
from typing import Optional, Tuple

from .normalize_values import (_pkg_size_canon, norm_capacitance,
                               norm_current, norm_frequency, norm_inductance,
                               norm_power, norm_resistance, norm_temperature,
                               norm_tolerance, norm_voltage)

# EIA 허용오차 문자 코드 — norm_tolerance가 못 잡는 단문자 표기만 보충
_TOLERANCE_LETTERS = {
    "b": 0.1,
    "c": 0.25,
    "d": 0.5,
    "f": 1.0,
    "g": 2.0,
    "j": 5.0,
    "k": 10.0,
    "m": 20.0,
}

to_ohm = norm_resistance
to_farad = norm_capacitance
to_henry = norm_inductance
to_watt = norm_power
to_volt = norm_voltage
to_ampere = norm_current
to_hertz = norm_frequency


def to_percent(raw) -> Optional[float]:
    """허용오차 → %. '±5%'/'5%' 수치 우선, 'J' 같은 EIA 문자 코드 폴백."""
    value = norm_tolerance(raw)
    if value is not None:
        return value
    return _TOLERANCE_LETTERS.get(str(raw).strip().lower())


def parse_size_code(raw) -> Optional[str]:
    """패키지 표기 → 임페리얼 정준 코드 ('C1005'→'0402', '0603_1608Metric'
    →'0603'). 서로 다른 코드가 병기된 모호한 표기는 None."""
    if raw is None:
        return None
    canon = _pkg_size_canon(raw)
    if canon and len(canon) == 1:
        return next(iter(canon))
    return None


def temperature_range(raw) -> Tuple[Optional[float], Optional[float]]:
    """온도 표기 → (min_c, max_c). '-40~+85℃'→(-40, 85), 숫자 1개면
    상한 관례로 (None, 값)."""
    if raw is None:
        return None, None
    nums = norm_temperature(raw)
    if not nums:
        return None, None
    if len(nums) == 1:
        return None, nums[0]
    return min(nums), max(nums)
