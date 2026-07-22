from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from .normalizer import (
    normalize_component_text,
    parse_capacitance_f,
    parse_current_a,
    parse_frequency_hz,
    parse_inductance_h,
    parse_power_w,
    parse_resistance_ohm,
    parse_size_code,
    parse_temperature_range_c,
    parse_tolerance_percent,
    parse_voltage_v,
)


_DASHES = str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-"})
_CORPORATE_SUFFIXES = re.compile(
    r"\b(?:incorporated|inc|corp(?:oration)?|co|company|ltd|limited|llc|plc|group|electronics?)\b",
    re.I,
)
_NAMED_PACKAGE = re.compile(
    r"\b(SOIC|SOP|SSOP|TSSOP|MSOP|QFN|DFN|SOT|SOD|TO|BGA|LQFP|TQFP)\b"
    r"[^A-Z0-9]{0,10}(\d{1,3})\b",
    re.I,
)
_METRIC_TO_IMPERIAL = {
    "0402": "01005",
    "0603": "0201",
    "1005": "0402",
    "1608": "0603",
    "2012": "0805",
    "3216": "1206",
    "3225": "1210",
    "3528": "1411",
    "4520": "1808",
    "4532": "1812",
    "5025": "2010",
    "5750": "2220",
    "6032": "2312",
    "6332": "2512",
    "7343": "2917",
}
_IMPERIAL_TO_METRIC = {imperial: metric for metric, imperial in _METRIC_TO_IMPERIAL.items()}
_IMPERIAL_PACKAGES = {
    "01005",
    "0201",
    "0402",
    "0603",
    "0805",
    "1206",
    "1210",
    "1411",
    "1808",
    "1812",
    "2010",
    "2220",
    "2312",
    "2512",
    "2917",
}
_DIELECTRIC = re.compile(
    r"(?<![A-Z0-9])(C0G|COG|NP0|C0H|U2J|CH|SL|X5R|X5S|X6S|X7R|X7S|X7T|X8R|Y5V|Z5U)(?![A-Z0-9])",
    re.I,
)
_PACKAGE_ALIASES = {
    "VQFN16": "QFN16",
    "16VFQFN": "QFN16",
    "SON8": "DFN8",
    "VSON8": "DFN8",
    "WSON8": "DFN8",
    "8VDFN": "DFN8",
    "8WDFN": "DFN8",
    "TQFP64": "TQFP64",
    "64TQFP": "TQFP64",
    "SOT235": "SOT235",
    "SOT753": "SOT235",
    "SC74ASOT753": "SOT235",
    "SC76SOD323": "SOD323",
    "SC90SOD323F": "SC90",
    "TO2363SC59SOT233": "SOT23",
}
_CRYSTAL_PACKAGE_TYPES = {
    "crystal",
    "oscillator",
    "resonator",
    "xtal",
    "크리스털",
    "크리스탈",
    "수정",
    "발진기",
    "공진기",
}
_CRYSTAL_DIMENSION_CODES = {
    (16, 12): "1612",
    (20, 16): "2016",
    (25, 20): "2520",
    (32, 25): "3225",
}
_CRYSTAL_DIMENSION = re.compile(
    r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*"
    r"(\d+(?:\.\d+)?)\s*(?:mm)?(?![\d.])",
    re.I,
)
_CRYSTAL_SIZE_CODE = re.compile(r"(?<!\d)(1612|2016|2520|3225)(?!\d)")
_GENERIC_CRYSTAL_SMD = re.compile(r"(?:\d+SMD|SMD\d+)(?:NOLEAD)?")
_INTERNAL_CAD_PASSIVE_SIZE = re.compile(
    r"^(?:CAP|RES|IND)[_-](?:C|R|L)?"
    r"(0402|0603|1005|1608|2012|3216|3225|3528|4520|4532|5025|"
    r"5750|6032|6332|7343)N?$",
    re.I,
)
_INTERNAL_CAD_PASSIVE_PACKAGE = re.compile(
    r"^(?:CAP|RES|IND)[_-][A-Z0-9_-]+$",
    re.I,
)
_PASSIVE_PACKAGE_TYPES = {
    "capacitor",
    "inductor",
    "resistor",
    "thermistor",
    "varistor",
}
_PASSIVE_IMPERIAL_SHORTHAND = {
    "402": "0402",
    "603": "0603",
    "805": "0805",
}


def _is_crystal_package_context(component_type: str | None) -> bool:
    component = unicodedata.normalize("NFKC", component_type or "").strip().casefold()
    return component in _CRYSTAL_PACKAGE_TYPES


def _is_passive_package_context(component_type: str | None) -> bool:
    component = unicodedata.normalize("NFKC", component_type or "").strip().casefold()
    return component in _PASSIVE_PACKAGE_TYPES


def _crystal_package_from_text(value: object) -> str | None:
    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    dimension = _CRYSTAL_DIMENSION.search(text)
    if dimension:
        first = round(float(dimension.group(1)) * 10)
        second = round(float(dimension.group(2)) * 10)
        package = _CRYSTAL_DIMENSION_CODES.get((first, second))
        if package:
            return package
    code = _CRYSTAL_SIZE_CODE.search(text)
    return code.group(1) if code else None


def normalize_mpn(value: object) -> str:
    text = unicodedata.normalize("NFKC", "" if value is None else str(value)).translate(_DASHES)
    return re.sub(r"\s+", "", text).upper()


def compact_mpn(value: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", normalize_mpn(value))


def normalize_manufacturer(value: object) -> str:
    text = unicodedata.normalize("NFKC", "" if value is None else str(value)).casefold()
    text = _CORPORATE_SUFFIXES.sub(" ", text)
    return re.sub(r"[^a-z0-9가-힣]+", "", text)


def normalize_package(value: object, component_type: str | None = None) -> str:
    text = unicodedata.normalize("NFKC", "" if value is None else str(value)).upper()
    prefixed = re.fullmatch(r"[^=]{1,24}=(.+)", text.strip())
    if prefixed:
        text = prefixed.group(1).strip()
    internal_size = _INTERNAL_CAD_PASSIVE_SIZE.fullmatch(text.strip())
    if internal_size:
        return _METRIC_TO_IMPERIAL[internal_size.group(1)]
    # Library footprint identifiers are not distributor package names. Keep
    # only a physically encoded passive size; ECAP/array/library suffixes must
    # remain unverified instead of becoming toxic search keywords.
    if _INTERNAL_CAD_PASSIVE_PACKAGE.fullmatch(text.strip()):
        return ""
    compact = re.sub(r"[^A-Z0-9]+", "", text)

    crystal_context = _is_crystal_package_context(component_type)
    if crystal_context:
        physical_package = _crystal_package_from_text(text)
        if physical_package:
            return physical_package
        # Pin count alone does not identify a crystal's physical body size.
        if _GENERIC_CRYSTAL_SMD.fullmatch(compact):
            return ""

    if _is_passive_package_context(component_type):
        # Legacy BOM/CAD libraries often omit the leading zero from imperial
        # chip sizes (402/603/805), prefix the code with C/R, or store the
        # metric body size as SMD2012/SMD1608. These forms are safe only in a
        # passive-component context; elsewhere the same digits may be a pin,
        # series, or mechanical identifier.
        shorthand = re.fullmatch(r"(?:[CR])?(402|603|805)", compact)
        if shorthand:
            return _PASSIVE_IMPERIAL_SHORTHAND[shorthand.group(1)]
        if compact in {"SMD", "SMT"}:
            return ""
        cad_metric = re.fullmatch(
            r"(?:CC|CR|CL|CT)(1005|1608|2012|3216|3225|3528|4520|"
            r"4532|5025|5750|6032|6332|7343)",
            compact,
        )
        if cad_metric:
            return _METRIC_TO_IMPERIAL[cad_metric.group(1)]
        smd_metric = re.fullmatch(
            r"SMD(1005|1608|2012|3216|3225|3528|4520|4532|5025|"
            r"5750|6032|6332|7343)",
            compact,
        )
        if smd_metric:
            return _METRIC_TO_IMPERIAL[smd_metric.group(1)]

    tfbga = (
        re.search(r"TFBGA[^0-9]{0,8}(\d{1,3}(?:\s*\+\s*\d{1,3})?)", text)
        or re.search(r"(\d{1,3}(?:\s*\+\s*\d{1,3})?)[^A-Z0-9]{0,8}TFBGA", text)
    )
    if tfbga:
        pin_count = re.sub(r"\D", "", tfbga.group(1))
        return f"TFBGA{pin_count}"
    if compact in {"PGSOT23", "GSOT23", "SOT233"}:
        return "SOT23"
    tsot = re.fullmatch(r"TSOT23([56])", compact)
    if tsot:
        return f"SOT23{tsot.group(1)}"

    # Supplier APIs freely mix imperial and metric chip sizes.  Prefer the
    # imperial code as the canonical representation while retaining named
    # packages (QFN-32, SOIC-8, ...) below.
    pair = re.search(
        r"(?<!\d)(01005|0201|0402|0603|0805|1206|1210|1411|1808|1812|2010|2220|2312|2512|2917)"
        r"\D{0,12}(0402|0603|1005|1608|2012|3216|3225|3528|4520|4532|5025|5750|6032|6332|7343)"
        r"(?:\s*(?:METRIC|미터법))?",
        text,
    )
    if pair:
        return pair.group(1)

    metric = re.search(
        r"(?:^|[^A-Z0-9])(?:C|R)?(1005|1608|2012|3216|3225|3528|4520|4532|5025|5750|6032|6332|7343)"
        r"(?:\s*(?:METRIC|미터법))?(?:$|[^A-Z0-9])",
        text,
    )
    if metric:
        return _METRIC_TO_IMPERIAL[metric.group(1)]

    tantal = re.fullmatch(r"(2012|3216|3528|6032|7343)[A-Z]", compact)
    if tantal:
        return _METRIC_TO_IMPERIAL[tantal.group(1)]

    size = parse_size_code(text)
    if size and size in _IMPERIAL_PACKAGES:
        return size
    if compact in _METRIC_TO_IMPERIAL:
        return _METRIC_TO_IMPERIAL[compact]
    if "_" in text:
        # CAD library identifiers commonly use underscores to join a symbol,
        # body hint, and library suffix. Accept an embedded standard named
        # package, but never expose the untouched library identifier as a
        # distributor package constraint.
        named = _NAMED_PACKAGE.search(text.replace("_", "-"))
        if named:
            return normalize_package(
                f"{named.group(1)}-{named.group(2)}",
                component_type,
            )
        return ""
    return _PACKAGE_ALIASES.get(compact, compact)


def packages_compatible(
    expected: object,
    actual: object,
    component_type: str | None = None,
) -> bool:
    left = normalize_package(expected, component_type)
    right = normalize_package(actual, component_type)
    if not left or not right:
        return False
    if left == right:
        return True
    # BOMs often contain only the body dimensions while distributors include
    # lead count and family, e.g. 10X10 vs 176-UFBGA-10X10.
    for short, long in ((left, right), (right, left)):
        if re.fullmatch(r"\d+(?:\.\d+)?X\d+(?:\.\d+)?", short) and short in long:
            return True
    return False


def package_display(value: object, component_type: str | None = None) -> str | None:
    """Return one canonical package label for API and UI consumers."""

    canonical = normalize_package(value, component_type)
    if not canonical:
        return None
    metric = _IMPERIAL_TO_METRIC.get(canonical)
    return f"{canonical} · {metric} metric" if metric else canonical


def distinct_package_notation(
    value: object,
    canonical_value: object,
    component_type: str | None = None,
) -> str | None:
    """Keep only supplier/BOM notation that adds information to the canonical label."""

    raw = unicodedata.normalize("NFKC", "" if value is None else str(value)).strip()
    canonical = normalize_package(canonical_value, component_type)
    if not raw or not canonical:
        return None
    compact_raw = re.sub(r"[^A-Z0-9]+", "", raw.upper())
    metric = _IMPERIAL_TO_METRIC.get(canonical)
    redundant = {canonical}
    if metric:
        redundant.update(
            {
                metric,
                f"{canonical}{metric}",
                f"{metric}{canonical}",
                f"{canonical}{metric}METRIC",
                f"{metric}{canonical}METRIC",
            }
        )
    return None if compact_raw in redundant else raw


def dielectric_notation(value: object) -> str | None:
    """Return the distributor/BOM dielectric token without canonical alias folding."""

    text = unicodedata.normalize("NFKC", "" if value is None else str(value)).upper()
    match = _DIELECTRIC.search(text)
    if not match:
        return None
    return match.group(1).upper()


def normalize_dielectric(value: object) -> str | None:
    token = dielectric_notation(value)
    if token is None:
        return None
    return "C0G" if token in {"COG", "NP0"} else token


def package_from_text(value: object, component_type: str | None = None) -> str | None:
    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    if _is_crystal_package_context(component_type):
        return _crystal_package_from_text(text)
    size = parse_size_code(text)
    if size:
        return size.upper()
    match = _NAMED_PACKAGE.search(text)
    if not match:
        return None
    return normalize_package(f"{match.group(1)}-{match.group(2)}", component_type)


def normalized_specs_from_text(text: str | None, component_type: str | None = None) -> dict[str, Any]:
    if not text:
        return {}
    inferred = normalize_component_text(text, component_type)
    result = {key: value for key, value in inferred.items() if value is not None}
    context = unicodedata.normalize("NFKC", component_type or "").casefold()
    full_context = f"{context} {unicodedata.normalize('NFKC', text).casefold()}"
    if re.search(r"\b(?:ferrite|bead|f\.?\s*bead)\b|비드", full_context):
        impedance = result.pop("resistance_ohm", None)
        if impedance is not None:
            result["impedance_ohm"] = impedance
        impedance_frequency = result.get("frequency_hz")
        if impedance_frequency is not None:
            result["impedance_frequency_hz"] = impedance_frequency
    minimum, maximum = parse_temperature_range_c(text)
    if minimum is not None or maximum is not None:
        result["temperature_range_c"] = [minimum, maximum]
    package = package_from_text(text, component_type)
    if package:
        result["package"] = package
    dielectric = normalize_dielectric(text)
    if dielectric:
        result["dielectric"] = dielectric
    color_match = re.search(
        r"\b(red|green|orange|amber|yellow|blue|white)\b|적색|녹색|주황|황색|청색|백색",
        text,
        re.I,
    )
    if color_match:
        color_token = color_match.group(0).casefold()
        result["color"] = {
            "적색": "red",
            "녹색": "green",
            "주황": "orange",
            "황색": "yellow",
            "청색": "blue",
            "백색": "white",
        }.get(color_token, color_token)
    pin_match = re.search(r"\b(\d{1,3})\s*[- ]?pins?\b", text, re.I)
    if pin_match:
        result["pin_count"] = int(pin_match.group(1))
    if re.search(r"\b(?:dual|double)\s*row\b", text, re.I):
        result["row_count"] = 2
    elif re.search(r"\bsingle\s*row\b", text, re.I):
        result["row_count"] = 1
    pitch_match = re.search(r"\b(\d+(?:\.\d+)?)\s*mm\s*pitch\b", text, re.I)
    if pitch_match:
        result["pitch_mm"] = float(pitch_match.group(1))
    dimensions = re.search(
        r"\b(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*mm\b",
        text,
        re.I,
    )
    if dimensions:
        for name, index in zip(
            ("body_length_mm", "body_width_mm", "body_height_mm"),
            (1, 2, 3),
            strict=True,
        ):
            result[name] = float(dimensions.group(index))
    return result


def normalized_specs_from_parameters(
    parameters: Iterable[tuple[str, Any]],
    component_type: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized: dict[str, Any] = {}
    raw: dict[str, Any] = {}
    priorities: dict[str, int] = {}

    component_context = unicodedata.normalize(
        "NFKC", component_type or ""
    ).strip().casefold()

    def priority(target: str, key: str) -> int:
        if target == "resistance_ohm":
            if any(token in key for token in ("impedance", "임피던스")):
                return 100
            if any(token in key for token in ("dcresistance", "dcr", "dc저항")):
                return 40
        if target == "voltage_v":
            if "diode" in component_context or "다이오드" in component_context:
                if any(token in key for token in ("forward", "순방향", "vf")):
                    return -1
                if any(
                    token in key
                    for token in (
                        "reverse",
                        "breakdown",
                        "standoff",
                        "역방향",
                        "항복",
                        "vr",
                    )
                ):
                    return 110
            if any(token in key for token in ("dropout", "드롭아웃", "tolerance", "허용오차")):
                return -1
            if any(token in key for token in ("output", "출력")):
                return 100
            if any(token in key for token in ("rated", "rating", "정격")):
                return 90
            if any(token in key for token in ("operating", "동작")):
                return 80
            if any(token in key for token in ("input", "입력")):
                return 70
        if target == "current_a":
            if any(
                token in key
                for token in (
                    "quiescent",
                    "supply",
                    "leakage",
                    "정동작",
                    "공급",
                    "누설",
                )
            ):
                return -1
            if any(token in key for token in ("output", "출력", "rated", "rating", "정격")):
                return 100
            if any(token in key for token in ("continuous", "연속")):
                return 90
        return 50

    for name, value in parameters:
        key = unicodedata.normalize("NFKC", str(name)).casefold()
        compact_key = re.sub(r"\s+", "", key)
        raw[str(name)] = value
        ferrite_context = bool(
            re.search(r"\b(?:ferrite|bead|f\.?\s*bead)\b|비드", component_context)
        )
        parsers = (
            (("impedance", "임피던스"), "impedance_ohm", parse_resistance_ohm),
            (
                ("dc resistance", "dcresistance", "dc 저항", "dc저항"),
                "dc_resistance_max_ohm" if ferrite_context else "resistance_ohm",
                parse_resistance_ohm,
            ),
            (("resistance", "저항"), "resistance_ohm", parse_resistance_ohm),
            (("capacitance", "정전용량", "용량"), "capacitance_f", parse_capacitance_f),
            (("inductance", "인덕턴스"), "inductance_h", parse_inductance_h),
            (("power", "watt", "전력"), "power_w", parse_power_w),
            (("tolerance", "허용오차"), "tolerance_percent", parse_tolerance_percent),
            (("voltage", "전압"), "voltage_v", parse_voltage_v),
            (("current", "전류"), "current_a", parse_current_a),
            (
                ("frequency", "주파수"),
                "impedance_frequency_hz" if ferrite_context else "frequency_hz",
                parse_frequency_hz,
            ),
        )
        matched = False
        for aliases, target, parser in parsers:
            if any(re.sub(r"\s+", "", alias) in compact_key for alias in aliases):
                parsed = parser(value)
                candidate_priority = priority(target, compact_key)
                if (
                    parsed is not None
                    and candidate_priority >= 0
                    and candidate_priority >= priorities.get(target, -1)
                ):
                    normalized[target] = parsed
                    priorities[target] = candidate_priority
                matched = True
                break
        if matched:
            continue
        if any(alias in compact_key for alias in ("temperature", "온도")):
            minimum, maximum = parse_temperature_range_c(value)
            if minimum is not None or maximum is not None:
                normalized["temperature_range_c"] = [minimum, maximum]
        if any(alias in compact_key for alias in ("package", "case", "size", "패키지", "크기")):
            package = normalize_package(value, component_type)
            if package:
                normalized["package"] = package
        if any(
            alias in compact_key
            for alias in ("dielectric", "temperaturecharacteristic", "유전체", "온도특성")
        ):
            dielectric = normalize_dielectric(value)
            if dielectric:
                normalized["dielectric"] = dielectric
        if any(alias in compact_key for alias in ("numberofpositions", "positions", "pincount", "핀수")):
            pin_match = re.search(r"\d{1,3}", str(value))
            if pin_match:
                normalized["pin_count"] = int(pin_match.group(0))
        if any(alias in compact_key for alias in ("pitch", "피치")):
            pitch_match = re.search(r"\d+(?:\.\d+)?", str(value))
            if pitch_match:
                normalized["pitch_mm"] = float(pitch_match.group(0))
        if any(alias in compact_key for alias in ("color", "색상", "색")):
            color_match = re.search(
                r"red|green|orange|amber|yellow|blue|white|적색|녹색|주황|황색|청색|백색",
                str(value),
                re.I,
            )
            if color_match:
                token = color_match.group(0).casefold()
                normalized["color"] = {
                    "적색": "red",
                    "녹색": "green",
                    "주황": "orange",
                    "황색": "yellow",
                    "청색": "blue",
                    "백색": "white",
                }.get(token, token)
    parameter_text = " ".join(
        f"{name} {value}" for name, value in raw.items()
    )
    parameter_ferrite = bool(
        normalized.get("impedance_ohm") is not None
        or re.search(
            r"\b(?:ferrite|bead|f\.?\s*bead|impedance)\b|비드|임피던스",
            f"{component_context} {parameter_text}",
            re.I,
        )
    )
    if parameter_ferrite:
        if "impedance_ohm" not in normalized:
            impedance = parse_resistance_ohm(parameter_text)
            if impedance is not None:
                normalized["impedance_ohm"] = impedance
        if "impedance_frequency_hz" not in normalized:
            frequency = parse_frequency_hz(parameter_text)
            if frequency is not None:
                normalized["impedance_frequency_hz"] = frequency
        dcr_values = [
            parse_resistance_ohm(value)
            for name, value in raw.items()
            if re.search(r"dc\s*resistance|dc\s*저항|\bdcr\b", name, re.I)
        ]
        dcr = next((value for value in dcr_values if value is not None), None)
        if dcr is not None:
            normalized["dc_resistance_max_ohm"] = dcr
            if normalized.get("resistance_ohm") == dcr:
                normalized.pop("resistance_ohm", None)
    return normalized, raw
