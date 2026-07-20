from __future__ import annotations

import re
from typing import Any, Callable

from .contract import SearchComponentInput, SearchField
from .normalizer import (
    parse_capacitance_f,
    parse_current_a,
    parse_frequency_hz,
    parse_inductance_h,
    parse_power_w,
    parse_resistance_ohm,
    parse_temperature_range_c,
    parse_tolerance_percent,
    parse_voltage_v,
)

from .models import PlannedQuery, Requirement, SearchMode
from .normalization import dielectric_notation, normalize_dielectric, normalize_package
from .supplier_query import supplier_core_keywords


_PLACEHOLDER_PART_NUMBER = re.compile(
    r"^(?:PCB[_\s-]*POINT|TEST[_\s-]*POINT|DNP|DNI|N/?A|NONE|NO[_\s-]*POPULATE)$",
    re.I,
)
_GENERIC_CONNECTOR_NOTATION = re.compile(r"^\d+\s*[X×]\s*\d+\s*P?$", re.I)
_PASSIVE_PACKAGE_PART_NUMBER = re.compile(
    r"^[CR]\s*=\s*"
    r"(01005|0201|0402|0603|0805|1005|1206|1210|1608|1808|1812|"
    r"2010|2012|2220|2312|2512|3216|3225|3528|4520|4532|5025|5750|6032|"
    r"6332|7343)$",
    re.I,
)
_CAD_PASSIVE_FOOTPRINT = re.compile(r"^[CR]\d{4}\(\d{4}\)[A-Z0-9_-]*$", re.I)
_PREFIXED_PART_NUMBER = re.compile(r"^([^=]{1,24})=(.+)$")
_NAMED_PACKAGE_VALUE = re.compile(
    r"^(?:P?G?SOT|TSOT|SOD|DO|T?FBGA|BGA|WSON|V?QFN|DFN|SOIC|SOP|"
    r"SSOP|TSSOP|MSOP|LQFP|TQFP|TO)[-_ ]?\d{1,3}[A-Z0-9]*(?:[^A-Z0-9].*)?$",
    re.I,
)
_PASSIVE_TYPES = {"resistor", "capacitor", "inductor"}
_PACKAGE_SIZE_VALUE = re.compile(
    r"^(?:01005|0201|0402|0603|0805|1005|1206|1210|1608|1808|1812|"
    r"2010|2012|2220|2312|2512|2917|3216|3225|3528|4520|4532|5025|5750|"
    r"6032|6332|7343)$",
    re.I,
)


def _package_from_pseudo_part_number(
    value: str | None,
    part_type: str | None = None,
) -> str | None:
    """Turn common BOM footprint notation into a package hint without an API call."""

    if not value:
        return None
    match = _PASSIVE_PACKAGE_PART_NUMBER.fullmatch(value.strip())
    if match:
        return match.group(1).upper()
    cad = _CAD_PASSIVE_FOOTPRINT.fullmatch(value.strip())
    if cad:
        metric = re.search(r"\((\d{4})\)", value)
        return metric.group(1) if metric else None
    prefixed = _PREFIXED_PART_NUMBER.fullmatch(value.strip())
    if prefixed:
        candidate = prefixed.group(2).strip()
        if _NAMED_PACKAGE_VALUE.fullmatch(candidate):
            return candidate
        if (
            part_type or ""
        ).casefold() in _PASSIVE_TYPES and _PACKAGE_SIZE_VALUE.fullmatch(candidate):
            return candidate.upper()
    return None


def _part_number_without_manufacturer_prefix(value: str | None) -> str | None:
    if not value:
        return value
    match = _PREFIXED_PART_NUMBER.fullmatch(value.strip())
    if not match:
        return value
    candidate = match.group(2).strip()
    # BOM comments frequently append a sourcing/assembly note to the MPN.
    return re.sub(r"\((?:NP|RVS|ALT|대체)\)$", "", candidate, flags=re.I).strip()


class QueryPlanner:
    _SPEC_PARSERS: dict[str, tuple[str, Callable[[Any], Any], str]] = {
        "resistance": ("resistance_ohm", parse_resistance_ohm, "eq"),
        "capacitance": (
            "capacitance_f",
            lambda value: parse_capacitance_f(value, allow_code=True),
            "eq",
        ),
        "inductance": ("inductance_h", parse_inductance_h, "eq"),
        "power": ("power_w", parse_power_w, "gte"),
        "tolerance": ("tolerance_percent", parse_tolerance_percent, "lte"),
        "voltage": ("voltage_v", parse_voltage_v, "gte"),
        "current": ("current_a", parse_current_a, "gte"),
        "frequency": ("frequency_hz", parse_frequency_hz, "eq"),
    }

    def plan(self, component: SearchComponentInput) -> PlannedQuery:
        fields = component.fields
        pn = fields["part_number"]
        manufacturer = fields["manufacturer"]
        part_type = fields["part_type"]
        package = fields["package"]
        quantity = fields["quantity"]
        requirements: dict[str, Requirement] = {}

        for source_name, (
            target_name,
            parser,
            comparison,
        ) in self._SPEC_PARSERS.items():
            field = fields[source_name]
            if field.value is None:
                continue
            parsed = parser(field.value)
            requirements[target_name] = self._requirement(
                target_name, field, parsed, comparison
            )

        temperature = fields["temperature"]
        if temperature.value is not None:
            minimum, maximum = parse_temperature_range_c(temperature.value)
            normalized_temperature = (
                [minimum, maximum]
                if minimum is not None or maximum is not None
                else None
            )
            requirements["temperature_range_c"] = self._requirement(
                "temperature_range_c", temperature, normalized_temperature, "contains"
            )
        part_type_value = (
            str(part_type.value).strip() if part_type.value is not None else None
        )
        raw_part_number = str(pn.value).strip() if pn.value is not None else None
        pseudo_package = _package_from_pseudo_part_number(
            raw_part_number, part_type_value
        )
        if pseudo_package is None:
            raw_part_number = _part_number_without_manufacturer_prefix(raw_part_number)
        if package.value is not None:
            requirements["package"] = self._requirement(
                "package", package, normalize_package(package.value), "eq"
            )
        elif pseudo_package:
            requirements["package"] = Requirement(
                name="package",
                raw_value=pseudo_package,
                normalized_value=normalize_package(pseudo_package),
                status=pn.status,
                hard=pn.status == "extracted",
                comparison="eq",
            )
        if part_type.value is not None:
            requirements["part_type"] = self._requirement(
                "part_type", part_type, str(part_type.value).casefold(), "category"
            )

        part_number = (
            raw_part_number
            if raw_part_number
            and pseudo_package is None
            and not _PLACEHOLDER_PART_NUMBER.fullmatch(raw_part_number)
            and not _GENERIC_CONNECTOR_NOTATION.fullmatch(raw_part_number)
            else None
        )
        manufacturer_name = (
            str(manufacturer.value).strip() if manufacturer.value is not None else None
        )
        package_value = (
            str(package.value).strip() if package.value is not None else pseudo_package
        )
        description = component.description or component.value_raw
        dielectric_raw = dielectric_notation(description)
        dielectric = normalize_dielectric(description)
        if dielectric:
            requirements["dielectric"] = Requirement(
                name="dielectric",
                raw_value=dielectric_raw or dielectric,
                normalized_value=dielectric,
                status="extracted",
                hard=True,
                comparison="eq",
            )
        hard_specs = [
            item
            for item in requirements.values()
            if item.hard and item.name not in {"part_type"}
        ]

        if part_number and pn.status == "extracted":
            mode = SearchMode.IDENTITY
        elif part_number:
            mode = SearchMode.HYBRID
        elif len(hard_specs) >= 2:
            mode = SearchMode.PARAMETRIC
        else:
            mode = SearchMode.INSUFFICIENT

        keyword_parts: list[str] = []
        if part_number:
            keyword_parts.append(part_number)
            if manufacturer_name:
                keyword_parts.append(manufacturer_name)
        else:
            # Supplier keyword search is intentionally narrow: retrieve with
            # the most discriminating value and canonical package, then apply
            # every hard requirement locally.  Long free-text queries reduce
            # recall and make equivalent unit/package spellings brittle.
            primary_names = {
                "resistor": ("resistance",),
                "capacitor": ("capacitance",),
                "inductor": ("inductance",),
                "crystal": ("frequency",),
            }.get((part_type_value or "").casefold(), ())
            for field_name in (*primary_names, *self._SPEC_PARSERS):
                field = fields[field_name]
                if field.value is not None:
                    keyword_parts.append(str(field.value))
                    break
            if package_value:
                keyword_parts.append(normalize_package(package_value))
            if dielectric:
                keyword_parts.append(dielectric)
            if part_type_value:
                keyword_parts.append(part_type_value)
            if not keyword_parts and description:
                keyword_parts.append(description)

        qty = (
            int(quantity.value)
            if isinstance(quantity.value, (int, float)) and quantity.value > 0
            else None
        )
        return PlannedQuery(
            component_id=component.component_id,
            mode=mode,
            part_number=part_number,
            manufacturer=manufacturer_name,
            description=description,
            part_type=part_type_value,
            package=package_value,
            quantity=qty,
            keywords=" ".join(dict.fromkeys(part for part in keyword_parts if part))[
                :250
            ],
            requirements=requirements,
        )

    @staticmethod
    def parametric_fallback(query: PlannedQuery) -> PlannedQuery | None:
        """품번 검색이 해결되지 않았을 때 사용할 확정 스펙 기반 2차 질의를 만든다.

        일반적인 무품번 탐색은 hard spec 두 개가 필요하다. 다만 품번 검색까지
        실패한 뒤에는 1K 저항처럼 부품 종류별 핵심 전기값 하나도 대체품을 찾을
        근거로 허용한다.
        """

        if (
            query.mode not in {SearchMode.IDENTITY, SearchMode.HYBRID}
            or not query.part_number
        ):
            return None
        hard_specs = [
            requirement
            for requirement in query.requirements.values()
            if requirement.hard and requirement.name != "part_type"
        ]
        primary_name = {
            "resistor": "resistance_ohm",
            "capacitor": "capacitance_f",
            "inductor": "inductance_h",
            "crystal": "frequency_hz",
        }.get((query.part_type or "").casefold())
        primary = query.requirements.get(primary_name or "")
        has_primary_value = bool(primary and primary.hard)
        if len(hard_specs) < 2 and not has_primary_value:
            return None
        fallback = query.model_copy(
            update={
                "mode": SearchMode.PARAMETRIC,
                "part_number": None,
                # 해석할 수 없는 품번·제조사 조합이 대체품 탐색 범위를 좁히면 안 된다.
                "manufacturer": None,
            },
            deep=True,
        )
        return fallback.model_copy(
            update={"keywords": supplier_core_keywords(fallback)},
            deep=True,
        )

    @staticmethod
    def _requirement(
        name: str, field: SearchField, normalized: Any, comparison: str
    ) -> Requirement:
        return Requirement(
            name=name,
            raw_value=field.value,
            normalized_value=normalized,
            status=field.status,
            hard=field.status == "extracted" and normalized is not None,
            comparison=comparison,
        )
