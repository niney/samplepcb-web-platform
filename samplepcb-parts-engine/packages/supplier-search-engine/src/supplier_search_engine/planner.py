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
from .physical import detect_mount_style, source_diameter_mm
from .supplier_query import supplier_core_keywords


_PLACEHOLDER_PART_NUMBER = re.compile(
    r"^(?:PCB[_\s-]*POINT|TEST[_\s-]*POINT|DNP|DNI|N/?A|NONE|NO[_\s-]*POPULATE)$",
    re.I,
)
_GENERIC_CONNECTOR_NOTATION = re.compile(
    r"^\d+\s*[X×]\s*\d+\s*P?"
    r"(?:\s*[-/]\s*\d+(?:\.\d+)?\s*MM"
    r"(?:\s*[-/]\s*(?:S\s*/\s*T|R\s*/\s*A))?)?$",
    re.I,
)
_REFERENCE_LIST_PART_NUMBER = re.compile(
    r"^(?:LED|REG|CON|USB|ANT|NTC|TVS|XTAL|CN|FB|IC|JP|TP|SW|VR|RV|"
    r"BD|TC|EC|LD|ZD|TR|JA|JB|MT|R|C|L|D|Q|U|F|K|P|T|X|Y|BT|J)"
    r"\$?\d{1,6}(?:\s*[,;/]\s*(?:[A-Z]{1,4})?\$?\d{1,6})+$",
    re.I,
)
_PASSIVE_SPEC_PART_NUMBER = re.compile(
    r"^(?=.*\d(?:\.\d+)?\s*(?:[uµμnp]F|[uµμnm]H|[KMR]?\s*(?:Ω|OHMS?)))"
    r"(?=.*(?:\d(?:\.\d+)?\s*k?V|\b\d{3,4}\b)).+$",
    re.I,
)
_PASSIVE_PACKAGE_PART_NUMBER = re.compile(
    r"^[CR]\s*=\s*"
    r"(01005|0201|0402|0603|0805|1005|1206|1210|1608|1808|1812|"
    r"2010|2012|2220|2312|2512|3216|3225|3528|4520|4532|5025|5750|6032|"
    r"6332|7343)$",
    re.I,
)
_CAD_PASSIVE_FOOTPRINT = re.compile(r"^[CR]\d{4}\(\d{4}\)[A-Z0-9_-]*$", re.I)
_INTERNAL_CAD_PASSIVE_FOOTPRINT = re.compile(
    r"^(?:CAP|RES|IND)[_-][A-Z0-9_-]+$",
    re.I,
)
_INTERNAL_CAD_PASSIVE_SIZE = re.compile(
    r"^(?:CAP|RES|IND)[_-](?:C|R|L)?"
    r"(0402|0603|1005|1608|2012|3216|3225|3528|4520|4532|5025|"
    r"5750|6032|6332|7343)N?$",
    re.I,
)
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

_CATEGORY_POLICY_TOKENS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("resistor", ("resistor", "저항")),
    ("inductor", ("inductor", "인덕터", "코일")),
    ("crystal", ("crystal", "oscillator", "크리스털", "수정", "발진기")),
    ("capacitor", ("capacitor", "커패시터", "콘덴서")),
)
_ELECTROLYTIC_TOKENS = ("electrolytic", "ecap", "전해")
_ELECTROLYTIC_ABBREVIATION = re.compile(
    r"(?:^|[^A-Z0-9])E\s*/\s*C(?:[^A-Z0-9]|$)|"
    r"(?:^|[^A-Z0-9])E(?:LE)?[ -]?CAP(?:[^A-Z0-9]|$)|"
    r"(?:^|[^A-Z0-9])EC(?:[^A-Z0-9]|$)",
    re.I,
)
_MECHANICAL_PACKAGE_DIMENSION = re.compile(
    r"^(?:\d+(?:\.\d+)?\s*mm|\d+(?:\.\d+)?\s*[x×]\s*"
    r"\d+(?:\.\d+)?(?:\s*mm)?)$",
    re.I,
)
_MULTISOURCE_MANUFACTURER = re.compile(
    r"(?:^|[/,;|\s])(?:ANY|MULTI(?:PLE)?|VARIOUS|GENERIC|무관|다수)(?:$|[/,;|\s])",
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
    internal = _INTERNAL_CAD_PASSIVE_SIZE.fullmatch(value.strip())
    if internal:
        return internal.group(1).upper()
    prefixed = _PREFIXED_PART_NUMBER.fullmatch(value.strip())
    if prefixed:
        candidate = prefixed.group(2).strip()
        if _NAMED_PACKAGE_VALUE.fullmatch(candidate):
            return candidate
        if (part_type or "").casefold() in _PASSIVE_TYPES and _PACKAGE_SIZE_VALUE.fullmatch(candidate):
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


def _canonical_category_policy(
    part_type: str | None,
    description: str | None,
    value_raw: str | None,
    package: str | None,
) -> str | None:
    """Choose the category policy from BOM-owned evidence only."""

    part_type_text = (part_type or "").casefold()
    bom_text = " ".join(
        value.casefold()
        for value in (part_type, description, value_raw, package)
        if value
    )
    electrolytic_hint = any(token in bom_text for token in _ELECTROLYTIC_TOKENS) or bool(
        _ELECTROLYTIC_ABBREVIATION.search(bom_text)
    )
    if electrolytic_hint and any(
        token in part_type_text
        for token in ("capacitor", "커패시터", "콘덴서", "electrolytic", "전해")
    ):
        return "electrolytic"
    return next(
        (
            policy
            for policy, tokens in _CATEGORY_POLICY_TOKENS
            if any(token in part_type_text for token in tokens)
        ),
        None,
    )


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

        for source_name, (target_name, parser, comparison) in self._SPEC_PARSERS.items():
            field = fields[source_name]
            if field.value is None:
                continue
            parsed = (
                field.normalized_value
                if field.normalized_value is not None
                else parser(field.value)
            )
            requirements[target_name] = self._requirement(target_name, field, parsed, comparison)

        temperature = fields["temperature"]
        if temperature.value is not None:
            minimum, maximum = parse_temperature_range_c(temperature.value)
            normalized_temperature = [minimum, maximum] if minimum is not None or maximum is not None else None
            requirements["temperature_range_c"] = self._requirement(
                "temperature_range_c", temperature, normalized_temperature, "contains"
            )
        part_type_value = str(part_type.value).strip() if part_type.value is not None else None
        raw_part_number = str(pn.value).strip() if pn.value is not None else None
        pseudo_package = _package_from_pseudo_part_number(raw_part_number, part_type_value)
        internal_cad_part_number = bool(
            raw_part_number
            and _INTERNAL_CAD_PASSIVE_FOOTPRINT.fullmatch(raw_part_number)
        )
        if pseudo_package is None:
            raw_part_number = _part_number_without_manufacturer_prefix(raw_part_number)
        package_value = (
            str(package.value).strip()
            if package.value is not None
            else pseudo_package
        )
        description = component.description or component.value_raw
        category_policy = _canonical_category_policy(
            part_type_value,
            component.description,
            component.value_raw,
            package_value,
        )
        if package.value is not None:
            normalized_package = normalize_package(
                package.value,
                part_type_value,
            ) or None
            if (
                category_policy == "electrolytic"
                and (
                    _MECHANICAL_PACKAGE_DIMENSION.fullmatch(
                        str(package.value).strip()
                    )
                    or source_diameter_mm(
                        f"electrolytic {str(package.value).strip()}"
                    )
                    is not None
                )
            ):
                normalized_package = None
            requirements["package"] = self._requirement(
                "package",
                package,
                normalized_package,
                "eq",
            )
        elif pseudo_package:
            requirements["package"] = Requirement(
                name="package",
                raw_value=pseudo_package,
                normalized_value=normalize_package(pseudo_package, part_type_value),
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
            and not internal_cad_part_number
            and not _PLACEHOLDER_PART_NUMBER.fullmatch(raw_part_number)
            and not _GENERIC_CONNECTOR_NOTATION.fullmatch(raw_part_number)
            and not _REFERENCE_LIST_PART_NUMBER.fullmatch(raw_part_number)
            and not _PASSIVE_SPEC_PART_NUMBER.fullmatch(raw_part_number)
            else None
        )
        manufacturer_name = (
            str(manufacturer.value).strip()
            if manufacturer.value is not None
            else None
        )
        if manufacturer_name and _MULTISOURCE_MANUFACTURER.search(manufacturer_name):
            manufacturer_name = None
        physical_source = " ".join(
            value
            for value in (
                "electrolytic" if category_policy == "electrolytic" else None,
                part_type_value,
                package_value,
                component.value_raw,
                component.description,
            )
            if value
        )
        mount_style = detect_mount_style(physical_source)
        if mount_style is not None:
            requirements["mount_style"] = Requirement(
                name="mount_style",
                raw_value=physical_source,
                normalized_value=mount_style,
                status="extracted",
                hard=True,
                comparison="eq",
            )
        diameter_mm = source_diameter_mm(physical_source)
        if diameter_mm is not None:
            requirements["diameter_mm"] = Requirement(
                name="diameter_mm",
                raw_value=physical_source,
                normalized_value=diameter_mm,
                status="extracted",
                hard=True,
                comparison="eq",
            )
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
        hard_specs = [item for item in requirements.values() if item.hard and item.name not in {"part_type"}]

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
            package_requirement = requirements.get("package")
            if package_requirement is not None and package_requirement.hard:
                normalized_package = package_requirement.normalized_value
                if isinstance(normalized_package, str) and normalized_package:
                    keyword_parts.append(normalized_package)
            if dielectric:
                keyword_parts.append(dielectric)
            if part_type_value:
                keyword_parts.append(part_type_value)
            if not keyword_parts and description:
                keyword_parts.append(description)

        qty = component.required_quantity
        if qty is None and isinstance(quantity.value, (int, float)) and quantity.value > 0:
            qty = int(quantity.value)
        return PlannedQuery(
            component_id=component.component_id,
            mode=mode,
            part_number=part_number,
            manufacturer=manufacturer_name,
            description=description,
            part_type=part_type_value,
            category_policy=category_policy,
            package=package_value,
            quantity=qty,
            keywords=" ".join(dict.fromkeys(part for part in keyword_parts if part))[:250],
            requirements=requirements,
        )
    @staticmethod
    def parametric_fallback(query: PlannedQuery) -> PlannedQuery | None:
        """Create a spec-only second-stage query for an unresolved MPN.

        Normal part-number-free discovery still requires two hard specs.  Once
        an MPN attempt has failed, one type-specific primary electrical value is
        also useful enough to search (for example, ``1K`` + ``resistor``).
        """

        if query.mode not in {SearchMode.IDENTITY, SearchMode.HYBRID} or not query.part_number:
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
                # An unresolvable MPN/manufacturer pair must not narrow the
                # replacement-part discovery query.
                "manufacturer": None,
            },
            deep=True,
        )
        return fallback.model_copy(
            update={"keywords": supplier_core_keywords(fallback)},
            deep=True,
        )

    @staticmethod
    def _requirement(name: str, field: SearchField, normalized: Any, comparison: str) -> Requirement:
        return Requirement(
            name=name,
            raw_value=field.value,
            normalized_value=normalized,
            status=field.status,
            hard=field.status == "extracted" and normalized is not None,
            comparison=comparison,
        )
