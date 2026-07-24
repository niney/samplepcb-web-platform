from __future__ import annotations

import math
import re
import unicodedata
from typing import Callable


_NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"


def _text(value: object) -> str:
    return unicodedata.normalize("NFKC", "" if value is None else str(value)).strip()


def _finite(value: float) -> float | None:
    return value if math.isfinite(value) else None


def parse_resistance_ohm(value: object) -> float | None:
    text = _text(value)
    if not text:
        return None
    explicit = re.search(rf"({_NUMBER})\s*([kKmM]?)\s*(?:Ω|ohms?\b)", text, re.IGNORECASE)
    if explicit:
        number = float(explicit.group(1))
        prefix = explicit.group(2)
        multiplier = 1e3 if prefix in {"k", "K"} else 1e6 if prefix == "M" else 1e-3 if prefix == "m" else 1.0
        return _finite(number * multiplier)
    decimal_r = re.search(rf"(?<![A-Za-z0-9.])({_NUMBER})\s*[Rr](?![A-Za-z0-9.])", text)
    if decimal_r:
        return _finite(float(decimal_r.group(1)))
    decimal_suffix = re.search(rf"(?<![A-Za-z0-9.])({_NUMBER})\s*([kKmM])(?![A-Za-z0-9.])", text)
    if decimal_suffix:
        number = float(decimal_suffix.group(1))
        prefix = decimal_suffix.group(2)
        multiplier = 1e3 if prefix in {"k", "K"} else 1e6 if prefix == "M" else 1e-3
        return _finite(number * multiplier)
    embedded = re.search(r"(?<![A-Za-z0-9.])(\d+)\s*([RrKkMm])(\d*)(?![A-Za-z0-9.])", text)
    if embedded:
        whole, marker, fraction = embedded.groups()
        if len(whole) > 3:
            return None
        number = float(f"{whole}.{fraction}" if fraction else whole)
        multiplier = 1.0 if marker in {"R", "r"} else 1e3 if marker in {"K", "k"} else 1e6 if marker == "M" else 1e-3
        return _finite(number * multiplier)
    return None


def parse_capacitance_f(value: object, *, allow_code: bool = False) -> float | None:
    text = _text(value)
    if not text:
        return None
    match = re.search(rf"({_NUMBER})\s*(p|n|u|µ|μ|m)?\s*F\b", text, re.IGNORECASE)
    if match:
        number = float(match.group(1))
        prefix = (match.group(2) or "").casefold()
        multiplier = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "": 1.0}[prefix]
        return _finite(number * multiplier)
    if allow_code:
        shorthand = re.search(
            rf"({_NUMBER})\s*(p|n|u|µ|μ|m)\b",
            text,
            re.IGNORECASE,
        )
        if shorthand:
            number = float(shorthand.group(1))
            prefix = shorthand.group(2).casefold()
            multiplier = {
                "p": 1e-12,
                "n": 1e-9,
                "u": 1e-6,
                "µ": 1e-6,
                "μ": 1e-6,
                "m": 1e-3,
            }[prefix]
            return _finite(number * multiplier)
        code = re.fullmatch(r"\s*(\d{3})\s*", text)
        if code:
            digits = code.group(1)
            return int(digits[:2]) * (10 ** int(digits[2])) * 1e-12
    return None


def parse_inductance_h(value: object) -> float | None:
    text = _text(value)
    match = re.search(rf"({_NUMBER})\s*(p|n|u|µ|μ|m)?\s*H\b", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    prefix = (match.group(2) or "").casefold()
    multiplier = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "": 1.0}[prefix]
    return _finite(number * multiplier)


def parse_power_w(value: object) -> float | None:
    text = _text(value)
    fraction = re.search(r"(\d+)\s*/\s*(\d+)\s*W\b", text, re.IGNORECASE)
    if fraction and int(fraction.group(2)):
        return int(fraction.group(1)) / int(fraction.group(2))
    match = re.search(rf"({_NUMBER})\s*(m|k)?\s*W\b", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    prefix = (match.group(2) or "").casefold()
    return _finite(number * {"m": 1e-3, "k": 1e3, "": 1.0}[prefix])


def parse_tolerance_percent(value: object) -> float | None:
    text = _text(value)
    match = re.search(rf"(?:±|\+/-)?\s*({_NUMBER})\s*%", text)
    return _finite(abs(float(match.group(1)))) if match else None


def parse_voltage_v(value: object) -> float | None:
    text = _text(value)
    # 공급사 파라미터/설명은 단순 V 외에 VDC/VAC 표기를 흔히 쓴다.
    # 기존 ``V\b``는 VDC 의 V 뒤가 word 문자(D)라 경계가 성립하지 않아
    # 정격 전압이 누락됐고, 그 결과 정확 일치 후보가 "전압 미확인"으로 밀렸다.
    match = re.search(
        rf"({_NUMBER})\s*-?\s*(m|k)?\s*(?:V(?:DC|AC)?\b|volts?\b)",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    number = float(match.group(1))
    prefix = (match.group(2) or "").casefold()
    return _finite(number * {"m": 1e-3, "k": 1e3, "": 1.0}[prefix])


def parse_current_a(value: object) -> float | None:
    text = _text(value)
    match = re.search(rf"({_NUMBER})\s*-?\s*(u|µ|μ|m|k)?\s*A\b", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    prefix = (match.group(2) or "").casefold()
    multiplier = {"u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "": 1.0}[prefix]
    return _finite(number * multiplier)


def parse_frequency_hz(value: object) -> float | None:
    text = _text(value)
    match = re.search(rf"({_NUMBER})\s*-?\s*(k|m|g)?\s*Hz\b", text, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    prefix = (match.group(2) or "").casefold()
    return _finite(number * {"k": 1e3, "m": 1e6, "g": 1e9, "": 1.0}[prefix])


def parse_temperature_range_c(value: object) -> tuple[float | None, float | None]:
    text = _text(value)
    range_match = re.search(
        rf"({_NUMBER})\s*(?:°\s*C|deg\s*C)?\s*(?:~|～|\.{{2,}}|to|에서)\s*({_NUMBER})\s*(?:°\s*C|deg\s*C)\b",
        text,
        re.IGNORECASE,
    )
    if range_match:
        return float(range_match.group(1)), float(range_match.group(2))
    single = re.search(rf"({_NUMBER})\s*°\s*C\b", text, re.IGNORECASE)
    if single:
        number = float(single.group(1))
        return number, number
    return None, None


def parse_size_code(value: object) -> str | None:
    text = _text(value)
    match = re.search(r"(?<!\d)(0201|0402|0603|0805|1206|1210|1808|1812|2010|2512)(?!\d)", text)
    return match.group(1) if match else None


def parse_temperature_coefficient_ppm_c(value: object) -> float | None:
    text = _text(value)
    match = re.search(rf"({_NUMBER})\s*ppm\s*/?\s*°?C", text, re.IGNORECASE)
    return _finite(float(match.group(1))) if match else None


NORMALIZERS: dict[str, Callable[[object], float | None]] = {
    "resistance_ohm": parse_resistance_ohm,
    "capacitance_f": parse_capacitance_f,
    "inductance_h": parse_inductance_h,
    "power_w": parse_power_w,
    "tolerance_percent": parse_tolerance_percent,
    "voltage_v": parse_voltage_v,
    "current_a": parse_current_a,
    "frequency_hz": parse_frequency_hz,
    "temperature_coefficient_ppm_c": parse_temperature_coefficient_ppm_c,
}


def normalize_component_text(text: str, component_type: str | None) -> dict[str, float | str | None]:
    component = (component_type or "").casefold()
    result: dict[str, float | str | None] = {
        "resistance_ohm": parse_resistance_ohm(text) if component == "resistor" or re.search(r"Ω|ohm", text, re.I) else None,
        "capacitance_f": parse_capacitance_f(text, allow_code=component == "capacitor"),
        "inductance_h": parse_inductance_h(text),
        "power_w": parse_power_w(text),
        "tolerance_percent": parse_tolerance_percent(text),
        "voltage_v": parse_voltage_v(text),
        "current_a": parse_current_a(text),
        "frequency_hz": parse_frequency_hz(text),
        "temperature_coefficient_ppm_c": parse_temperature_coefficient_ppm_c(text),
        "size_code": parse_size_code(text),
    }
    minimum, maximum = parse_temperature_range_c(text)
    result["temperature_min_c"] = minimum
    result["temperature_max_c"] = maximum
    return result
