# -*- coding: utf-8 -*-
"""데이터/라벨 패턴 검출 — BOM 데이터 행에 나타나는 값 패턴들."""
import re
from typing import Sequence

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

_REFERENCE_PREFIX = (
    r"LED|REG|CON|USB|ANT|NTC|TVS|XTAL|CN|FB|IC|JP|TP|SW|VR|RV|RT|RN|"
    r"BD|TC|EC|LD|ZD|TR|CR|JA|JB|TB|MT|R|C|L|D|Q|U|F|H|K|P|T|X|Y|BT|J"
)
_FULL_REFERENCE = re.compile(
    rf"(?P<prefix>{_REFERENCE_PREFIX})(?P<start>\$?\d{{1,6}})"
    rf"(?:\s*[-~]\s*(?:(?P<end_prefix>{_REFERENCE_PREFIX}))?"
    rf"(?P<end>\$?\d{{1,6}}))?",
    re.I,
)
_BARE_REFERENCE_SUFFIX = re.compile(
    r"(?P<start>\$?\d{1,6})"
    r"(?:\s*[-~]\s*(?P<end>\$?\d{1,6}))?",
)


def reference_designators(value: object) -> list[str] | None:
    """Return canonical designator tokens for a reference-only cell.

    Many production BOMs repeat the alphabetic prefix only once, for example
    ``R23,24,25`` or ``SW1,2``.  A suffix-only token is accepted only after a
    validated allow-listed prefix and an explicit comma/semicolon/slash
    separator.  This keeps short part numbers such as SS34 and BSS138 out of
    the reference path while making the result independent of spreadsheet
    shorthand.

    Ranges remain compact (``R1-R5``) to preserve the existing public result
    contract; only omitted prefixes are restored.
    """

    text = str(value or "").strip()
    if not text:
        return None
    segments = [segment.strip() for segment in re.split(r"[,;/]+", text)]
    if not segments or any(not segment for segment in segments[:-1]):
        return None

    designators: list[str] = []
    seen: set[str] = set()
    inherited_prefix: str | None = None
    for segment_index, segment in enumerate(segment for segment in segments if segment):
        # Space-separated lists already repeat their prefix (``R1 R2 R3``).
        # A range contains optional spaces around '-'/'~' and must stay whole.
        candidates = [segment]
        if not _FULL_REFERENCE.fullmatch(segment):
            candidates = [candidate for candidate in re.split(r"\s+", segment) if candidate]
        for candidate in candidates:
            full = _FULL_REFERENCE.fullmatch(candidate)
            if full:
                prefix = full.group("prefix").upper()
                start = full.group("start")
                end = full.group("end")
                if end is None:
                    canonical = f"{prefix}{start}"
                else:
                    end_prefix = (full.group("end_prefix") or prefix).upper()
                    if end_prefix != prefix:
                        return None
                    canonical = f"{prefix}{start}-{prefix}{end}"
                inherited_prefix = prefix
            else:
                # Bare suffixes are valid only in a later explicitly separated
                # segment, never as the first token or after plain whitespace.
                bare = _BARE_REFERENCE_SUFFIX.fullmatch(candidate)
                if bare is None or inherited_prefix is None or segment_index == 0:
                    return None
                start = bare.group("start")
                end = bare.group("end")
                canonical = f"{inherited_prefix}{start}"
                if end is not None:
                    canonical += f"-{inherited_prefix}{end}"
            key = canonical.casefold()
            if key not in seen:
                designators.append(canonical)
                seen.add(key)
    return designators or None


def reference_list_count(value: object) -> int | None:
    """셀 전체가 PCB 참조번호 목록일 때만 지시자 개수를 반환한다.

    허용 접두어와 셀 전체 검증을 함께 사용해 SS34, BSS138 같은 짧은
    품번을 참조번호로 오인하지 않는다.
    """
    designators = reference_designators(value)
    if not designators:
        return None
    count = 0
    for designator in designators:
        match = _FULL_REFERENCE.fullmatch(designator)
        if match is None:
            return None
        start = int(match.group("start").lstrip("$"))
        end_text = match.group("end")
        if end_text is None:
            count += 1
        else:
            end = int(end_text.lstrip("$"))
            if end < start or end - start > 1000:
                return None
            count += end - start + 1
    return count or None


def integer_quantity(value: object) -> int | None:
    text = str(value or "").strip().replace(",", "")
    match = re.fullmatch(r"([1-9]\d*)(?:\.0+)?", text)
    return int(match.group(1)) if match else None


def reference_quantity_pair(
        rows: Sequence[Sequence[object]], column_count: int,
        ) -> tuple[int, int, float] | None:
    """반복 행에서 참조번호 개수와 수량이 일치하는 열 쌍을 찾는다."""
    best = None
    for ref_col in range(column_count):
        ref_values = [reference_list_count(row[ref_col]) for row in rows
                      if ref_col < len(row) and str(row[ref_col] or "").strip()]
        ref_hits = [value for value in ref_values if value is not None]
        if len(ref_hits) < 3 or len(ref_hits) / max(len(ref_values), 1) < 0.75:
            continue
        for qty_col in range(column_count):
            if qty_col == ref_col:
                continue
            qty_values = [integer_quantity(row[qty_col]) for row in rows
                          if qty_col < len(row) and str(row[qty_col] or "").strip()]
            qty_hits = [value for value in qty_values if value is not None]
            if len(qty_hits) < 3 or len(qty_hits) / max(len(qty_values), 1) < 0.8:
                continue
            paired = []
            for row in rows:
                if ref_col >= len(row) or qty_col >= len(row):
                    continue
                ref_count = reference_list_count(row[ref_col])
                quantity = integer_quantity(row[qty_col])
                if ref_count is not None and quantity is not None:
                    paired.append((ref_count, quantity))
            agreement_count = sum(ref == qty for ref, qty in paired)
            agreement = agreement_count / max(len(paired), 1)
            if len(paired) < 3 or agreement < 0.8:
                continue
            score = (agreement, agreement_count,
                     len(ref_hits) / len(ref_values),
                     len(qty_hits) / len(qty_values), -ref_col, -qty_col)
            if best is None or score > best[0]:
                best = (score, (ref_col, qty_col, agreement))
    return best[1] if best else None


def looks_designator_list(s: str) -> bool:
    """'FB1, FB2, FB11' / 'c1-c12' / 'C15,C19,C22' 형태."""
    designators = reference_designators(s)
    if not designators:
        return False
    if len(designators) == 1:
        return bool(RE_DESIG_RANGE.match(designators[0]))
    return True


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
