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
import re
from typing import Any, Dict, List, Optional, Tuple

from .rule_extractor import (
    classify_columns,
    desig_part_type,
    infer_part_type,
    package_from_footprint,
)
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
    "part_number": ("part_number", "_pn_internal"),
    "package": ("package", "footprint"),
    "reference": ("designator",),
}

# 역할명 → 헤더 매핑 표시용 필드명
_ROLE_DISPLAY = {
    "designator": "reference",
    "_pn_internal": "part_number",
    "footprint": "footprint",
    "_unlabeled_text": "description",
    "_rescued_text": "description",
}

_DESC_ROLES = ("description", "_unlabeled_text", "_rescued_text")
_INT_PREFIX = re.compile(r"[+-]?\d+")
_REF_SEP = re.compile(r"[,;/\s]+")
_WS = re.compile(r"\s+")


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
        target = _fold(value)
        folded = _fold(cell)
        if target and target in folded:
            return True
        tokens = {t for t in _REF_SEP.split(str(value).upper()) if t}
        cell_tokens = {t for t in _REF_SEP.split(cell.upper()) if t}
        return bool(tokens) and tokens <= cell_tokens
    if (
        field == "package"
        and "footprint" in cell_roles
        and package_from_footprint(cell, None) == value
    ):
        return True
    target = _fold(value)
    return bool(target) and target in _fold(cell)


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
        field_states.update({
            "description": description_state,
            "footprint": footprint_state,
            "value_raw": value_state,
        })
        for state in (description_state, footprint_state, value_state):
            evidence.extend(state["evidence"])

        quality_flags: List[str] = []
        dnp_markers = {
            "dnp", "dni", "dnf", "do not populate",
            "not fitted", "not mounted", "미삽",
        }
        if any(_fold(cell) in dnp_markers for cell in cells):
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
        if attrs.quantity is None:
            quality_flags.append("quantity_not_found")
        if uncertain:
            quality_flags.append("field_without_direct_evidence")
        confidences = [_SOURCE_CONFIDENCE[src[f]] for f in VALUE_FIELDS
                       if raw_fields[f] is not None
                       and src.get(f) in _SOURCE_CONFIDENCE]
        package = attrs.package
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
            "reference_designators": _reference_designators(reference),
            "package": package,
            "footprint": footprint,
            "value_raw": value_raw,
            "raw_fields": raw_fields,
            "field_states": field_states,
            "evidence": evidence,
            "uncertain_fields": uncertain,
            "quality_flags": quality_flags,
            "review_status": ("review" if uncertain or quality_flags
                              else "extracted"),
            **normalized,
            "size_code": parse_size_code(package or footprint),
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
