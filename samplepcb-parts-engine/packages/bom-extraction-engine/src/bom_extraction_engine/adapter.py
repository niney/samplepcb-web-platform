# -*- coding: utf-8 -*-
"""RowAttrs → G-shape 어댑터 — 규칙 추출 결과를 웹 결과 스키마로.

준거는 frontend/src/types/index.ts의 ComponentRecord/HeaderMapping과
local_engine.build_local_result의 키셋이다. SummaryCards·ComponentTable·
EvidenceDrawer·헤더 매핑 그리드가 local_fusion 결과와 동일하게 렌더돼야 한다.

소유권 주의: bom_probing_gpt 코드는 복사하지 않는다 — 결과 스키마(공유
계약)만 보고 독립 구현했다.

의미론:
- field_states[f].status: 값 없음 → not_found / 값+셀 근거 → extracted /
  값은 있으나 행 안에서 근거 셀을 못 찾음 → review (+uncertain_fields)
- evidence: {cell: "C12"(원본 열 기준 A1 좌표), raw_value, supports}
- confidence: rule_extractor의 필드별 source(col/text/infer) 가중 평균
"""
import math
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from .rule_extractor import (
    classify_columns,
    desig_part_type,
    infer_part_type,
    package_from_source_cell,
    passive_size_from_source_cell,
    strip_dnp_annotation,
)
from .row_features import reference_designators, reference_list_count
from .schema import RowAttrs, VALUE_FIELDS
from .values import (parse_size_code, temperature_range, to_ampere, to_farad,
                     to_henry, to_hertz, to_ohm, to_percent, to_volt, to_watt)

# 필드 → (정규화 키, 변환기, 단위) — local_fusion 결과의 수치 계약 미러
NORMALIZERS = {
    "resistance": ("resistance_ohm", to_ohm, "Ω"),
    "capacitance": ("capacitance_f", to_farad, "F"),
    "inductance": ("inductance_h", to_henry, "H"),
    "power": ("power_w", to_watt, "W"),
    "tolerance": ("tolerance_percent", to_percent, "%"),
    "voltage": ("voltage_v", to_volt, "V"),
    "current": ("current_a", to_ampere, "A"),
    "frequency": ("frequency_hz", to_hertz, "Hz"),
}

# rule_extractor docstring의 신뢰 정책: col 고신뢰 / text 중신뢰 / infer 저신뢰
_SOURCE_CONFIDENCE = {"col": 0.95, "text": 0.8, "infer": 0.6}

# 근거 탐색 시 필드가 우선 찾아볼 열 역할 (그 외 필드는 자기 이름 역할)
_FIELD_ROLES: Dict[str, Tuple[str, ...]] = {
    "part_number": ("part_number", "_pn_internal", "_library_reference"),
    "package": ("package", "footprint"),
    "reference": ("designator",),
}

# 역할명 → 헤더 매핑 표시용 필드명
_ROLE_DISPLAY = {
    "designator": "reference",
    "_pn_internal": "part_number",
    "_library_reference": "part_number",
    "footprint": "footprint",
    "_unlabeled_text": "description",
    "_rescued_text": "description",
}

_DESC_ROLES = ("description", "_unlabeled_text", "_rescued_text")
_INT_PREFIX = re.compile(r"[+-]?\d+")
_REF_SEP = re.compile(r"[,;/\s]+")
_WS = re.compile(r"\s+")
_ELECTROLYTIC_TYPE_CONTEXT = re.compile(
    r"(?:^|[^A-Z0-9])(?:E\s*/\s*C|ECAP|E(?:LE)?[-_ ]?CAP|ELECTROLYTIC)"
    r"(?:[^A-Z0-9]|$)",
    re.I,
)
_FERRITE_CONTEXT = re.compile(r"\b(?:ferrite|bead|f\.?\s*bead)\b|비드", re.I)
_ABSOLUTE_INDUCTANCE_TOLERANCE = re.compile(
    r"(?:±|\+/-)\s*(\d+(?:\.\d+)?)\s*([unpµμm]?)h\b",
    re.I,
)
_COLOR_ALIASES = {
    "red": "red",
    "green": "green",
    "orange": "orange",
    "amber": "amber",
    "yellow": "yellow",
    "blue": "blue",
    "white": "white",
    "warm white": "warm_white",
    "cool white": "cool_white",
    "적색": "red",
    "녹색": "green",
    "주황": "orange",
    "황색": "yellow",
    "청색": "blue",
    "백색": "white",
}
_LED_COLOR_ABBREVIATIONS = {
    "yel": "yellow",
    "grn": "green",
    "blu": "blue",
    "wht": "white",
    "amb": "amber",
}
_EXPLICIT_PIN_COUNT = re.compile(
    r"(?<![A-Za-z0-9.])([1-9]\d{0,2})\s*(?:[- ]?pins?|p)(?![A-Za-z0-9])",
    re.I,
)
_CONNECTOR_ARRAY = re.compile(
    r"(?<![\d.])([1-9]\d?)\s*[x×]\s*([1-9]\d?)(?![\d.]|\s*mm\b)",
    re.I,
)
_CONNECTOR_CONTEXT = re.compile(
    r"\b(?:header|hdr|connector|conn|socket|pin|row|pos(?:ition)?|way)\b",
    re.I,
)
_CONNECTOR_ARRAY_ONLY = re.compile(
    r"\s*[1-9]\d?\s*[x×]\s*[1-9]\d?\s*(?:TH|THT|SMD|SMT)?\s*$",
    re.I,
)
_PITCH_EXPLICIT = re.compile(
    r"\bpitch\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm\b|"
    r"\b(\d+(?:\.\d+)?)\s*mm\s*pitch\b|"
    r"\bp\s*=\s*(\d+(?:\.\d+)?)\s*mm\b",
    re.I,
)
_PITCH_BEFORE_PINS = re.compile(
    r"(?<![\d.])(\d+(?:\.\d+)?)\s*mm\s*(?:[,;/]?\s*[x×]\s*)?"
    r"[1-9]\d{0,2}\s*(?:p|pins?)\b",
    re.I,
)
_PITCH_AFTER_PINS = re.compile(
    r"[1-9]\d{0,2}\s*(?:p|pins?)\b[^\d]{0,12}"
    r"(\d+(?:\.\d+)?)\s*mm\b",
    re.I,
)
_BODY_DIMENSIONS = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*mm\b",
    re.I,
)

_GENERIC_PCB_FEATURE = re.compile(
    r"^(?:MOUNT(?:ING)?[_ -]?(?:HOLE|POINT)|PCB[_ -]?(?:POINT|PAD|HOLE)|"
    r"TP[_ -]?(?:PAD|HOLE)|PAD(?:[-_/ ].*)?|TEST[_ -]?POINT(?:[-_/ ].*)?|"
    r"F?PCB)$",
    re.I,
)
_PCB_FEATURE_TEXT = re.compile(
    r"\b(?:MOUNT(?:ING)?\s+HOLE|PCB[_ -]?(?:POINT|PAD|HOLE)|"
    r"TP[_ -]?(?:PAD|HOLE)|TEST\s+PAD)\b",
    re.I,
)
_PCB_FABRICATION = re.compile(
    r"\b(?:FR-?4|ENIG|HASL|\d+\s*layers?|\d+(?:\.\d+)?\s*oz|"
    r"copper\s+weight|board\s+thickness|pcb\s+fabrication)\b",
    re.I,
)


def _connector_geometry_values(text: str) -> List[Tuple[int, Optional[int]]]:
    """Extract connector topology without treating body dimensions as pins."""

    values: List[Tuple[int, Optional[int]]] = []
    for match in _EXPLICIT_PIN_COUNT.finditer(text):
        values.append((int(match.group(1)), None))
    allow_array = bool(
        _CONNECTOR_CONTEXT.search(text)
        or _CONNECTOR_ARRAY_ONLY.fullmatch(text)
        or re.search(r"\bHDR[-_ ]*[1-9]\d?\s*[x×]", text, re.I)
    )
    if allow_array:
        for match in _CONNECTOR_ARRAY.finditer(text):
            first, second = int(match.group(1)), int(match.group(2))
            values.append((first * second, min(first, second)))
    return list(dict.fromkeys(values))


def _connector_pitch_values(text: str) -> List[float]:
    values: List[float] = []
    for match in _PITCH_EXPLICIT.finditer(text):
        values.append(float(next(group for group in match.groups() if group)))
    for pattern in (_PITCH_BEFORE_PINS, _PITCH_AFTER_PINS):
        values.extend(float(match.group(1)) for match in pattern.finditer(text))
    return list(dict.fromkeys(values))


def _normalized_identity(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(value or "")).casefold()


def _color_values(cells: List[str], part_type: Optional[str]) -> List[str]:
    aliases = dict(_COLOR_ALIASES)
    if part_type == "led":
        aliases.update(_LED_COLOR_ABBREVIATIONS)
    observed = []
    for cell in cells:
        folded = unicodedata.normalize("NFKC", str(cell)).casefold()
        for token, canonical in sorted(
            aliases.items(), key=lambda item: len(item[0]), reverse=True
        ):
            if re.search(rf"(?<![a-z]){re.escape(token)}(?![a-z])", folded):
                if canonical not in observed:
                    observed.append(canonical)
    return observed


def _col_letter(idx0: int) -> str:
    """0-based 열 인덱스 → 엑셀 열 문자 (0→A, 26→AA)."""
    letters = ""
    n = idx0 + 1
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _fold(s: Any) -> str:
    return _WS.sub(" ", str(s)).strip().casefold()


def _reference_designators(reference: Optional[str]) -> List[str]:
    """"R1, R2-R4" → ["R1", "R2-R4"] — 범위 토큰은 전개하지 않고 유지."""
    if not reference:
        return []
    canonical = reference_designators(reference)
    if canonical:
        return canonical
    seen = []
    for token in _REF_SEP.split(str(reference).strip()):
        if token and token not in seen:
            seen.append(token)
    return seen


def _column_priority(roles: Dict[str, List[int]], field: str,
                     n_cols: int) -> List[int]:
    """필드별 근거 탐색 열 순서: 자기 역할 → value → 설명 계열 → 나머지."""
    ordered: List[int] = []
    for role in _FIELD_ROLES.get(field, (field,)):
        for i in roles.get(role, []):
            if i not in ordered:
                ordered.append(i)
    for role in ("value",) + _DESC_ROLES:
        for i in roles.get(role, []):
            if i not in ordered:
                ordered.append(i)
    ordered.extend(i for i in range(n_cols) if i not in ordered)
    return ordered


def _cell_supports(field: str, value: Any, cell: str,
                   cell_roles: set) -> bool:
    """셀이 추출값의 직접 근거인가."""
    if field == "part_type":
        if infer_part_type(cell) == value:
            return True
        return "designator" in cell_roles and desig_part_type(cell) == value
    if field == "quantity":
        s = cell.strip()
        if "quantity" in cell_roles:
            m = _INT_PREFIX.search(s)
            return bool(m) and int(m.group()) == value
        return s == str(value)
    if field == "reference":
        target_designators = reference_designators(value)
        cell_designators = reference_designators(cell)
        if target_designators and cell_designators:
            return {
                token.casefold() for token in target_designators
            } <= {token.casefold() for token in cell_designators}
        target = _fold(value)
        folded = _fold(cell)
        if target and target in folded:
            return True
        tokens = {t for t in _REF_SEP.split(str(value).upper()) if t}
        cell_tokens = {t for t in _REF_SEP.split(cell.upper()) if t}
        return bool(tokens) and tokens <= cell_tokens
    if (
        field == "package"
        and {"package", "footprint"} & cell_roles
        and package_from_source_cell(cell, None) == value
    ):
        return True
    if field in NORMALIZERS:
        _, normalizer, _ = NORMALIZERS[field]
        target_value = normalizer(value)
        cell_value: Any = cell
        if (
            field == "tolerance"
            and "tolerance" in cell_roles
            and re.fullmatch(r"0?\.\d+", cell.strip())
        ):
            # Excel percentage cells are loaded as decimal fractions while
            # the extractor intentionally exposes a percent value.
            cell_value = f"{float(cell) * 100:g}%"
        normalized_cell = normalizer(cell_value)
        if target_value is not None and normalized_cell is not None:
            return math.isclose(
                float(target_value),
                float(normalized_cell),
                rel_tol=1e-9,
                abs_tol=1e-15,
            )
    target = _fold(value)
    return bool(target) and target in _fold(cell)


def _numeric_source_conflicts(
    roles: Dict[str, List[int]], cells: List[str]
) -> List[str]:
    conflicts: List[str] = []
    value_indexes = roles.get("value", [])
    for field, (_, normalizer, _) in NORMALIZERS.items():
        values = []
        for index in value_indexes:
            if index >= len(cells) or not str(cells[index]).strip():
                continue
            normalized = normalizer(cells[index])
            if normalized is not None:
                values.append(float(normalized))
        if values and any(
            not math.isclose(values[0], value, rel_tol=1e-9, abs_tol=1e-15)
            for value in values[1:]
        ):
            conflicts.append(f"{field}_input_source_conflict")
    return conflicts


def _package_source_values(
    roles: Dict[str, List[int]], cells: List[str], part_type: Optional[str]
) -> List[Tuple[str, str, int, str]]:
    values: List[Tuple[str, str, int, str]] = []
    package_indexes = set(roles.get("package", [])) | set(
        roles.get("footprint", [])
    )
    value_indexes = set(roles.get("value", []))
    for index in dict.fromkeys(
        [
            *roles.get("package", []),
            *roles.get("footprint", []),
            *roles.get("value", []),
        ]
    ):
        if index >= len(cells):
            continue
        raw = str(cells[index]).strip()
        parsed = package_from_source_cell(raw, part_type)
        if (
            not parsed
            and index in package_indexes
            and re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]{2,20}", raw)
            and raw.upper() not in {"ANY", "NONE", "NULL", "TBD", "UNKNOWN"}
        ):
            # 공급사/설계도구 고유 패키지명은 사전에 없더라도 package 역할
            # 열의 명시적 코드다. 다른 셀의 표준 패키지와 비교 근거로 보존한다.
            parsed = raw
        if not parsed or parsed.upper() in {"SMD", "SMT", "DIP", "THT"}:
            continue
        if (
            index in value_indexes
            and index not in package_indexes
            and re.sub(r"[^A-Za-z0-9]", "", raw).upper()
            == re.sub(r"[^A-Za-z0-9]", "", parsed).upper()
        ):
            # 값 열의 단독 숫자/토큰("100", "1206")은 패키지 근거가
            # 아니다. "0.1uF (0603)"처럼 별도 문맥에 병기된 경우만 비교한다.
            continue
        size = parse_size_code(
            passive_size_from_source_cell(raw, part_type) or parsed
        )
        key = f"size:{size}" if size else re.sub(
            r"[^A-Za-z0-9]", "", parsed
        ).upper()
        if not key:
            continue
        source_role = (
            "package"
            if index in roles.get("package", [])
            else "footprint"
            if index in roles.get("footprint", [])
            else "value"
        )
        if not any(existing[0] == key for existing in values):
            values.append((key, parsed, index, source_role))
    return values


def _package_source_conflict(
    roles: Dict[str, List[int]], cells: List[str], part_type: Optional[str]
) -> bool:
    return len(_package_source_values(roles, cells, part_type)) > 1


class _SheetAdapter:
    """케이스 하나(시트)의 어댑터 상태 — 열 우선순위/좌표 캐시."""

    def __init__(self, case: dict, roles: Dict[str, List[int]], *,
                 source_file: str, sheet_index: int):
        self.case = case
        self.roles = roles
        self.source_file = source_file
        self.sheet_index = sheet_index
        self.sheet_name = case["sheet_name"]
        n_cols = len(case["header_labels"])
        self.col_letters = [_col_letter(c) for c in case["column_indices"]]
        self.col_roles: Dict[int, set] = {i: set() for i in range(n_cols)}
        for role, idxs in roles.items():
            for i in idxs:
                if i < n_cols:
                    self.col_roles[i].add(role)
        self.priority = {
            field: _column_priority(roles, field, n_cols)
            for field in VALUE_FIELDS + ["reference"]
        }

    def _find_evidence(self, field: str, value: Any, cells: List[str],
                       row_1based: int) -> Optional[dict]:
        for i in self.priority[field]:
            cell = str(cells[i]).strip() if i < len(cells) else ""
            if not cell:
                continue
            if _cell_supports(field, value, cell, self.col_roles[i]):
                return {"cell": f"{self.col_letters[i]}{row_1based}",
                        "raw_value": cell, "supports": field}
        return None

    def _role_field_state(self, field: str, role_names: Tuple[str, ...],
                          cells: List[str], row_1based: int) -> Tuple[Optional[str], dict]:
        """열 역할에서 직접 읽은 공개 필드의 값·근거·source를 함께 만든다."""
        for role in role_names:
            for i in self.roles.get(role, []):
                if i >= len(cells):
                    continue
                raw = str(cells[i]).strip()
                if not raw:
                    continue
                evidence = {
                    "cell": f"{self.col_letters[i]}{row_1based}",
                    "raw_value": raw,
                    "supports": field,
                }
                return raw, {
                    "value": raw,
                    "status": "extracted",
                    "evidence": [evidence],
                    "source": "col",
                }
        return None, {"value": None, "status": "not_found", "evidence": []}

    def _input_alternatives(
        self,
        cells: List[str],
        row_1based: int,
        part_type: Optional[str],
    ) -> Dict[str, List[dict]]:
        alternatives: Dict[str, List[dict]] = {}
        for field, (_target, normalizer, _unit) in NORMALIZERS.items():
            observed: Dict[float, dict] = {}
            for index in self.roles.get("value", []):
                if index >= len(cells):
                    continue
                raw = str(cells[index]).strip()
                normalized = normalizer(raw) if raw else None
                if normalized is None:
                    continue
                key = float(normalized)
                observed.setdefault(
                    key,
                    {
                        "raw_value": raw,
                        "normalized_value": key,
                        "source_cell": f"{self.col_letters[index]}{row_1based}",
                        "source_role": "value",
                    },
                )
            if len(observed) > 1:
                alternatives[field] = [observed[key] for key in sorted(observed)]

        package_values = _package_source_values(self.roles, cells, part_type)
        if len(package_values) > 1:
            alternatives["package"] = [
                {
                    "raw_value": str(cells[index]).strip(),
                    "normalized_value": parsed,
                    "source_cell": f"{self.col_letters[index]}{row_1based}",
                    "source_role": source_role,
                }
                for _key, parsed, index, source_role in sorted(
                    package_values, key=lambda item: (item[0], item[2])
                )
            ]
        return alternatives

    def _part_number_alternatives(
        self,
        cells: List[str],
        row_1based: int,
        selected_part_number: Optional[str],
    ) -> List[dict]:
        observed: Dict[str, dict] = {}
        selected_key = _normalized_identity(selected_part_number)
        ordered_roles = (
            "part_number",
            "value",
            "description",
            "_library_reference",
        )
        for role in ordered_roles:
            for index in self.roles.get(role, []):
                if index >= len(cells):
                    continue
                raw = str(cells[index]).strip()
                raw_key = _normalized_identity(raw)
                if not raw_key:
                    continue
                is_library = role == "_library_reference"
                if not is_library and selected_key not in raw_key:
                    continue
                normalized = raw_key if is_library else selected_key
                observed.setdefault(
                    normalized,
                    {
                        "raw_value": raw,
                        "normalized_value": normalized.upper(),
                        "source_cell": f"{self.col_letters[index]}{row_1based}",
                        "source_role": (
                            "library_reference"
                            if is_library
                            else "part_number"
                            if role == "part_number"
                            else role
                        ),
                    },
                )
        return [observed[key] for key in sorted(observed)]

    def _connector_geometry_alternatives(
        self,
        cells: List[str],
        row_1based: int,
        part_type: Optional[str],
    ) -> List[dict]:
        if part_type != "connector":
            return []
        observed: Dict[int, dict] = {}
        for index, cell_value in enumerate(cells):
            raw = str(cell_value).strip()
            if not raw:
                continue
            values = [pins for pins, _rows in _connector_geometry_values(raw)]
            source_role = (
                "value"
                if "value" in self.col_roles[index]
                else "package"
                if "package" in self.col_roles[index]
                else "footprint"
                if "footprint" in self.col_roles[index]
                else "description"
            )
            for value in values:
                observed.setdefault(
                    value,
                    {
                        "raw_value": raw,
                        "normalized_value": value,
                        "source_cell": f"{self.col_letters[index]}{row_1based}",
                        "source_role": source_role,
                    },
                )
        return [observed[value] for value in sorted(observed)] if len(observed) > 1 else []

    def component(self, attrs: RowAttrs, src: Dict[str, str],
                  cells: List[str]) -> Dict[str, Any]:
        row_1based = attrs.row_id + 1
        raw_fields = {f: getattr(attrs, f) for f in VALUE_FIELDS}
        field_states: Dict[str, dict] = {}
        evidence: List[dict] = []
        uncertain: List[str] = []
        for field in VALUE_FIELDS:
            value = raw_fields[field]
            if value is None:
                field_states[field] = {"value": None, "status": "not_found",
                                       "evidence": []}
                continue
            found = self._find_evidence(field, value, cells, row_1based)
            if found:
                field_states[field] = {"value": value, "status": "extracted",
                                       "evidence": [found]}
                evidence.append(found)
            else:
                field_states[field] = {"value": value, "status": "review",
                                       "evidence": []}
                uncertain.append(field)
            if src.get(field):
                field_states[field]["source"] = src[field]

        input_conflicts = _numeric_source_conflicts(self.roles, cells)
        if _package_source_conflict(self.roles, cells, attrs.part_type):
            input_conflicts.append("package_input_source_conflict")
        if attrs.part_number is not None and src.get("_part_number_conflict"):
            input_conflicts.append("part_number_input_source_conflict")
        for conflict in input_conflicts:
            field = conflict.removesuffix("_input_source_conflict")
            if field in field_states and field_states[field]["value"] is not None:
                field_states[field]["status"] = "review"
                if field not in uncertain:
                    uncertain.append(field)

        reference = attrs.reference
        if reference:
            ref_found = self._find_evidence("reference", reference, cells,
                                            row_1based)
            if ref_found:
                evidence.append(ref_found)

        normalized: Dict[str, Any] = {}
        attributes: List[dict] = []
        for field, (target, parser, unit) in NORMALIZERS.items():
            raw_value = raw_fields[field]
            value = parser(raw_value) if raw_value is not None else None
            normalized[target] = value
            if raw_value is not None:
                attributes.append({
                    "name": field,
                    "raw_value": raw_value,
                    "normalized_value": value,
                    "unit": unit,
                    "evidence": field_states[field]["evidence"],
                })
        temperature = raw_fields["temperature"]
        minimum, maximum = temperature_range(temperature)
        normalized["temperature_min_c"] = minimum
        normalized["temperature_max_c"] = maximum
        if temperature is not None:
            attributes.append({
                "name": "temperature",
                "raw_value": temperature,
                "normalized_value": (f"{minimum}~{maximum}"
                                     if minimum is not None
                                     and maximum is not None else None),
                "unit": "°C",
                "evidence": field_states["temperature"]["evidence"],
            })

        description, description_state = self._role_field_state(
            "description", _DESC_ROLES, cells, row_1based)
        footprint, footprint_state = self._role_field_state(
            "footprint", ("footprint", "package"), cells, row_1based)
        value_raw, value_state = self._role_field_state(
            "value_raw", ("value",), cells, row_1based)
        if value_raw is None:
            for field in ("resistance", "capacitance", "inductance", "frequency"):
                field_evidence = field_states[field]["evidence"]
                if not field_evidence:
                    continue
                value_raw = field_evidence[0]["raw_value"]
                value_evidence = {
                    **field_evidence[0],
                    "supports": "value_raw",
                }
                value_state = {
                    "value": value_raw,
                    "status": "extracted",
                    "evidence": [value_evidence],
                    "source": "col",
                }
                break
        type_context, type_context_state = self._role_field_state(
            "description", ("part_type",), cells, row_1based)
        if type_context and _ELECTROLYTIC_TYPE_CONTEXT.search(type_context):
            description = " | ".join(
                dict.fromkeys(item for item in (type_context, description) if item)
            )
            description_state = {
                "value": description,
                "status": "extracted",
                "evidence": [
                    *type_context_state["evidence"],
                    *description_state["evidence"],
                ],
                "source": "col",
            }
        field_states.update({
            "description": description_state,
            "footprint": footprint_state,
            "value_raw": value_state,
        })
        for state in (description_state, footprint_state, value_state):
            evidence.extend(state["evidence"])

        semantic_text = unicodedata.normalize("NFKC", " ".join(
            str(value)
            for value in (attrs.part_type, description, value_raw, *cells)
            if value is not None and str(value).strip()
        ))
        if _FERRITE_CONTEXT.search(semantic_text):
            impedance = normalized.pop("resistance_ohm", None)
            if impedance is not None:
                normalized["impedance_ohm"] = impedance
                for attribute in attributes:
                    if attribute["name"] == "resistance":
                        attribute["name"] = "impedance"
                        attribute["unit"] = "Ω"
            frequency = normalized.get("frequency_hz")
            if frequency is not None:
                normalized["impedance_frequency_hz"] = frequency
        absolute_tolerance = _ABSOLUTE_INDUCTANCE_TOLERANCE.search(semantic_text)
        if absolute_tolerance:
            tolerance_h = to_henry(
                f"{absolute_tolerance.group(1)}{absolute_tolerance.group(2)}H"
            )
            if tolerance_h is not None:
                normalized["absolute_tolerance_h"] = tolerance_h
                attributes.append(
                    {
                        "name": "absolute_tolerance",
                        "raw_value": absolute_tolerance.group(0),
                        "normalized_value": tolerance_h,
                        "unit": "H",
                        "evidence": [],
                    }
                )
        quality_flags: List[str] = []
        designator_indexes = set(self.roles.get("designator", []))
        if any(
            index not in designator_indexes
            and strip_dnp_annotation(str(cell))[1]
            for index, cell in enumerate(cells)
        ):
            quality_flags.append("do_not_populate")
        if attrs.quantity == 0 and "do_not_populate" not in quality_flags:
            quality_flags.append("do_not_populate")
        if (
            value_raw
            and re.fullmatch(r"TEST\s*POINT\s*\(\s*OPEN\s*\)", value_raw, re.I)
            and attrs.reference
            and re.search(r"(?:^|[,;/\s])TP\d+", attrs.reference, re.I)
            and footprint
            and re.match(r"^TP[-_/]", footprint, re.I)
            and "do_not_populate" not in quality_flags
        ):
            # Bare PCB test pad: keep it in the analysis result for audit, but
            # do not spend supplier calls on it. Physical purchasable test
            # points without the OPEN + TP-footprint evidence remain searchable.
            quality_flags.append("do_not_populate")
        all_text = " ".join(str(cell) for cell in cells if str(cell).strip())
        colors = _color_values(cells, attrs.part_type)
        color = sorted(colors)[0] if colors else None
        if len(colors) > 1:
            input_conflicts.append("color_input_source_conflict")

        pin_values: set[int] = set()
        row_values: set[int] = set()
        pitch_values: set[float] = set()
        if attrs.part_type == "connector":
            for cell in cells:
                text = str(cell).strip()
                for pins, rows in _connector_geometry_values(text):
                    pin_values.add(pins)
                    if rows is not None:
                        row_values.add(rows)
                pitch_values.update(_connector_pitch_values(text))
                if re.search(r"\b(?:dual|double)\s*row\b|2\s*열|2열", text, re.I):
                    row_values.add(2)
                if re.search(r"\bsingle\s*row\b|1\s*열|1열", text, re.I):
                    row_values.add(1)
        pin_count = min(pin_values) if pin_values else None
        row_count = min(row_values) if row_values else None
        pitch_mm = min(pitch_values) if pitch_values else None
        if len(pin_values) > 1 or len(row_values) > 1:
            input_conflicts.append("connector_geometry_source_conflict")
        if len(pitch_values) > 1:
            input_conflicts.append("pitch_input_source_conflict")
        dimensions_match = _BODY_DIMENSIONS.search(all_text)
        body_dimensions_mm = (
            [float(dimensions_match.group(index)) for index in (1, 2, 3)]
            if dimensions_match
            else None
        )
        customer_supplied = bool(
            re.search(
                r"(?:客供|사급|지급품|고객\s*지급|"
                r"customer\s*(?:supplied|provided|furnished)|consigned)",
                all_text,
                re.I,
            )
        )
        generic_identity = bool(
            attrs.part_number and _GENERIC_PCB_FEATURE.fullmatch(attrs.part_number)
        )
        has_genuine_identity = bool(
            attrs.manufacturer
            or (attrs.part_number and not generic_identity)
        )
        feature_expression = " ".join(
            item for item in (value_raw, footprint, description) if item
        )
        pcb_feature = bool(
            not has_genuine_identity
            and (
                any(
                    _GENERIC_PCB_FEATURE.fullmatch(item.strip())
                    for item in (value_raw, footprint, description)
                    if item
                )
                or bool(_PCB_FEATURE_TEXT.search(feature_expression))
                or bool(
                    re.search(r"\bF?PCB\b", feature_expression, re.I)
                    and _PCB_FABRICATION.search(feature_expression)
                )
            )
        )
        if customer_supplied:
            quality_flags.append("customer_supplied")
        if pcb_feature:
            quality_flags.append("pcb_feature")
        if attrs.quantity is None:
            quality_flags.append("quantity_not_found")
        if src.get("_part_type_conflict"):
            quality_flags.append("part_type_source_conflict")
        if (
            attrs.part_type == "inductor"
            and normalized.get("capacitance_f") is not None
            and normalized.get("inductance_h") is None
        ) or (
            attrs.part_type == "capacitor"
            and normalized.get("inductance_h") is not None
            and normalized.get("capacitance_f") is None
        ):
            quality_flags.append("unit_category_conflict")
        quality_flags.extend(
            conflict for conflict in input_conflicts if conflict not in quality_flags
        )
        reference_count = reference_list_count(reference)
        quantity_conflict = bool(
            reference_count is not None
            and attrs.quantity is not None
            and reference_count != attrs.quantity
        )
        if quantity_conflict:
            quality_flags.append("reference_quantity_mismatch")
        if uncertain:
            quality_flags.append("field_without_direct_evidence")
        confidences = [_SOURCE_CONFIDENCE[src[f]] for f in VALUE_FIELDS
                       if raw_fields[f] is not None
                       and src.get(f) in _SOURCE_CONFIDENCE]
        package = attrs.package
        quantity_resolution = (
            "missing"
            if attrs.quantity is None
            else "conflict"
            if quantity_conflict
            else "verified"
        )
        disposition_reason_codes: List[str] = []
        if "do_not_populate" in quality_flags:
            disposition_reason_codes.append("do_not_populate")
        if pcb_feature:
            disposition_reason_codes.append("pcb_feature")
        if customer_supplied:
            disposition_reason_codes.append("customer_supplied")
        if quantity_resolution == "conflict":
            disposition_reason_codes.append("quantity_reference_conflict")
        elif quantity_resolution == "missing":
            disposition_reason_codes.append("quantity_missing")
        excluded = any(
            reason in {"do_not_populate", "pcb_feature", "customer_supplied"}
            for reason in disposition_reason_codes
        )
        procurement_disposition = (
            "excluded"
            if excluded
            else "quantity_confirmation_required"
            if quantity_resolution != "verified"
            else "eligible"
        )
        input_alternatives = self._input_alternatives(
            cells, row_1based, attrs.part_type
        )
        if attrs.part_number is not None and src.get("_part_number_conflict"):
            part_number_alternatives = self._part_number_alternatives(
                cells, row_1based, attrs.part_number
            )
            if len(part_number_alternatives) > 1:
                input_alternatives["part_number"] = part_number_alternatives
        if len(colors) > 1:
            color_alternatives = []
            for observed_color in sorted(colors):
                for index, cell in enumerate(cells):
                    if observed_color not in _color_values([str(cell)], attrs.part_type):
                        continue
                    color_alternatives.append(
                        {
                            "raw_value": str(cell).strip(),
                            "normalized_value": observed_color,
                            "source_cell": f"{self.col_letters[index]}{row_1based}",
                            "source_role": (
                                "value"
                                if "value" in self.col_roles[index]
                                else "description"
                            ),
                        }
                    )
                    break
            input_alternatives["color"] = color_alternatives
        connector_alternatives = self._connector_geometry_alternatives(
            cells, row_1based, attrs.part_type
        )
        if connector_alternatives:
            input_alternatives["pin_count"] = connector_alternatives
        record: Dict[str, Any] = {
            "source_file": self.source_file,
            "sheet_name": self.sheet_name,
            "sheet_index_0based": self.sheet_index,
            "source_rows_1based": [row_1based],
            "component_type": attrs.part_type,
            "part_number": attrs.part_number,
            "manufacturer": attrs.manufacturer,
            "description": description,
            "quantity": attrs.quantity,
            "reference_count": reference_count,
            "quantity_resolution": quantity_resolution,
            "search_disposition": "excluded" if excluded else "search",
            "procurement_disposition": procurement_disposition,
            "disposition_reason_codes": disposition_reason_codes,
            "reference_designators": _reference_designators(reference),
            "package": package,
            "footprint": footprint,
            "value_raw": value_raw,
            "color": color,
            "pin_count": pin_count,
            "row_count": row_count,
            "pitch_mm": pitch_mm,
            "body_dimensions_mm": body_dimensions_mm,
            "raw_fields": raw_fields,
            "input_alternatives": input_alternatives,
            "field_states": field_states,
            "evidence": evidence,
            "uncertain_fields": uncertain,
            "quality_flags": quality_flags,
            "review_status": ("review" if uncertain or quality_flags
                              else "extracted"),
            **normalized,
            "size_code": parse_size_code(
                (
                    passive_size_from_source_cell(package, attrs.part_type)
                    or package_from_source_cell(package, attrs.part_type)
                    or package
                    if package
                    else footprint
                )
            ),
            "attributes": attributes,
            "evidence_exact_rate": self._evidence_exact_rate(field_states),
            "part_number_supported": (
                field_states["part_number"]["status"] == "extracted"
                if attrs.part_number is not None else None),
        }
        if confidences:
            record["confidence"] = round(sum(confidences) / len(confidences), 3)
        return record

    @staticmethod
    def _evidence_exact_rate(field_states: Dict[str, dict]) -> Optional[float]:
        present = [state for state in field_states.values()
                   if state["status"] != "not_found"]
        if not present:
            return None
        exact = sum(1 for state in present if state["status"] == "extracted"
                    and state["evidence"])
        return round(exact / len(present), 3)

    def headers(self) -> List[dict]:
        """헤더 매핑 그리드용 — 라벨 분류=rule/1.0, 내용 추론 승격=local_model/0.75."""
        label_roles = classify_columns(self.case["header_labels"])
        label_col_role: Dict[int, str] = {}
        for role, idxs in label_roles.items():
            for i in idxs:
                label_col_role.setdefault(i, role)
        header_rows_1based = [r + 1 for r in self.case["header_rows"]]
        out: List[dict] = []
        for i, raw in enumerate(self.case["header_labels"]):
            if not str(raw).strip():
                continue
            role = next((r for r in self.col_roles[i] if r != "ignore"), None)
            if role is None:
                continue
            by_label = label_col_role.get(i) == role
            out.append({
                "source_file": self.source_file,
                "sheet_name": self.sheet_name,
                "header_rows_1based": header_rows_1based,
                "column_1based": self.case["column_indices"][i] + 1,
                "raw_header": str(raw),
                "semantic_field": _ROLE_DISPLAY.get(role, role),
                "confidence": 1.0 if by_label else 0.75,
                "source": "rule" if by_label else "local_model",
            })
        return out


def adapt_sheet(case: dict, roles: Dict[str, List[int]],
                preds: Dict[int, RowAttrs], sources: Dict[int, Dict[str, str]],
                *, source_file: str,
                sheet_index: int) -> Tuple[List[dict], List[dict]]:
    """케이스 + 추출 결과 → (components, headers)."""
    sheet = _SheetAdapter(case, roles, source_file=source_file,
                          sheet_index=sheet_index)
    components = []
    for row in case["rows"]:
        row_id = row["row_id"]
        attrs = preds.get(row_id)
        if attrs is None:
            continue
        components.append(sheet.component(attrs, sources.get(row_id, {}),
                                          row["cells"]))
    return components, sheet.headers()
