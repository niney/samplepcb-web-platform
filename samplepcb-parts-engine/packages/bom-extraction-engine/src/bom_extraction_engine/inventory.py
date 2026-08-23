# -*- coding: utf-8 -*-
"""협력사 재고표(inventory) 추출 프로필 — BOM 추출과 의미가 다른 별도 파이프라인.

BOM 추출기(rule_extractor)는 "보드 1장을 만들기 위한 소요"를 읽는다. 그래서
`_IGNORE_PAT` 이 price·단가·재고·stock 을 **명시적으로 폐기**하고, `_QTY_NEG` 가
"재고 수량"을 보드당 수량에서 강등하며, `non_bom_sheet_reason` 이 재고 시트를
fail-closed 로 기각한다. 협력사가 올리는 재고표는 정확히 그 반대의 표라
같은 파이프라인에 모드 분기를 넣는 대신 별도 모듈로 분리했다 — BOM 경로의
회귀 위험 0.

원칙
- **유실 금지**: 어떤 셀도 조용히 버리지 않는다. 품번은 원문(`part_number_raw`)을
  항상 남기고, 정리한 값과 정리 근거(flags)를 함께 반환한다. 역할을 못 정한 열도
  `raw_fields` 에 헤더 라벨 그대로 보존한다.
- **판단 최소**: 브랜드/수량이 품번 셀에 섞인 경우처럼 확실한 패턴만 분리하고,
  애매하면 원문을 유지한 채 검토 플래그를 남긴다.
- **교정 가능**: 사람이 미리보기에서 열 역할을 고치면 `role_overrides` 로 같은
  파일을 다시 돌린다(응용 계층이 셀을 재해석하지 않는다).
"""
from __future__ import annotations

import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from .bom_loader import get_sheet_names, load_sheet
from .serialize import clean_cell

logger = logging.getLogger(__name__)

INVENTORY_SCHEMA_VERSION = "1.0"
INVENTORY_PARSER_VERSION = "inventory-rules/1.0"

ProgressCallback = Callable[[str, int, str], None]

# 역할 사전 — 라벨 정규화 후 부분일치. 위에서부터 우선하며, 한 역할에 여러 열이
# 매치되면 먼저 나온 열을 쓰고 나머지는 `raw_fields` 로만 남는다.
ROLE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("part_number", re.compile(
        r"partsno|partno|partnumber|partsnumber|mpn|mfrpart|manufacturerpart"
        r"|itemno|itemcode|modelno|model|pn\b|p/n|품번|부품번호|제품번호|모델명"
        r"|파트넘버|품명코드")),
    ("manufacturer", re.compile(
        r"manufacturer|maker|mfr|mfg|brand|vendor|vender|제조사|제조업체|제조원"
        r"|메이커|브랜드")),
    ("stock_qty", re.compile(
        r"stock|qty|quantity|q'ty|qnty|available|onhand|inventory|재고|수량|보유"
        r"|잔량|재고량")),
    ("date_code", re.compile(r"datecode|date code|dcode|d/c|dc\b|생산연도|제조일|데이트")),
    ("lead_time", re.compile(r"leadtime|lead time|delivery|eta|납기|리드타임")),
    ("unit_price", re.compile(r"unitprice|price|cost|단가|가격|금액|판매가")),
    ("currency", re.compile(r"currency|통화|화폐")),
    ("moq", re.compile(r"moq|minorder|minimumorder|최소주문|최소수량")),
    ("packaging", re.compile(r"packaging|package|pkg|포장|패키지|외형|케이스")),
    ("description", re.compile(
        r"description|desc|spec|specification|detail|content|remark|note|비고"
        r"|설명|사양|규격|내역|참고")),
    ("no", re.compile(r"^(no|no\.|num|seq|index|순번|번호|연번)$")),
]

# 헤더 행 점수에 쓰는 핵심 역할 — 이 중 둘 이상이 한 행에 있으면 헤더로 본다.
_ANCHOR_ROLES = {"part_number", "manufacturer", "stock_qty", "unit_price", "date_code"}

_HEADER_SCAN_ROWS = 40
_CONTENT_SCAN_ROWS = 200

_NBSP = re.compile(r"[   　]")
_WS_RUN = re.compile(r"\s+")
_REPLACEMENT = "�"
# 품번 셀 끝에 붙은 수량 표기 — "12000Pcs" / "5,000 EA" / "4000ea"
_QTY_SUFFIX = re.compile(r"^\d[\d,]*\s*(?:pcs|pc|ea|k|개)?$", re.I)
# 품번 셀 끝에 붙은 브랜드 토큰 — 숫자 없는 알파벳(+&./-) 짧은 낱말
_BRAND_SUFFIX = re.compile(r"^[A-Za-z][A-Za-z&./\-]{1,19}$")
_INT_CELL = re.compile(r"^\d[\d,]*$")
_PRICE_CELL = re.compile(r"^[^\d]{0,3}\d[\d,]*(?:\.\d+)?[^\d]{0,4}$")
# 내용 추정 전용 — 라벨 없는 열을 date code 로 승격하는 근거는 `21+`·`23/45` 처럼
# **명시적 표식이 있는 형태만** 인정한다. 맨 4자리(`2315`)는 수량과 구분되지 않아
# 제외한다(헤더 없는 재고표의 `1000`·`2000` 이 날짜로 잡히던 실측 결함).
_DATE_CODE_CELL = re.compile(r"^\d{2}\+$|^\d{4}\+$|^\d{2}/\d{2}$")
_MPN_CELL = re.compile(r"^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-_.,/+#()\[\]&:\s]{2,60}$")

_CURRENCY_SIGNS = {
    "$": "USD", "usd": "USD", "us$": "USD",
    "₩": "KRW", "krw": "KRW", "won": "KRW", "원": "KRW",
    "¥": "JPY", "jpy": "JPY", "rmb": "CNY", "cny": "CNY", "元": "CNY",
    "€": "EUR", "eur": "EUR",
}


@dataclass(frozen=True)
class InventoryConfig:
    """추출 설정.

    row_limit: 결과 행 총량 상한(전 시트 누적). None 이면 무제한.
    role_overrides: {sheet_index_0based: {column_1based: role}} — 사람이 미리보기에서
        고친 열 역할. `"ignore"` 로 열을 끌 수도 있다.
    header_row_overrides: {sheet_index_0based: header_row_1based} — 헤더 행 강제.
    """

    row_limit: int | None = 50_000
    role_overrides: dict[int, dict[int, str]] = field(default_factory=dict)
    header_row_overrides: dict[int, int] = field(default_factory=dict)


def _norm_label(value: Any) -> str:
    text = unicodedata.normalize("NFKC", clean_cell(value)).casefold()
    return re.sub(r"[^a-z0-9가-힣/'.]+", "", text)


def _clean_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value)) if value is not None else ""
    text = _NBSP.sub(" ", text)
    return _WS_RUN.sub(" ", text).strip()


def _cell_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return _clean_text(value)


def _to_grid(frame: pd.DataFrame) -> list[list[str]]:
    """시트를 **한 번에** 정리된 문자열 격자로 바꾼다.

    셀마다 `frame.iat[...]` 를 부르면 pandas 가 연산마다 `attrs` 를 deepcopy 해
    행 수에 비례하는 숨은 비용이 붙는다(실측: 12,000행 CSV 84초 → 격자 변환 후 0.6초).
    핫 루프에서 pandas 를 아예 빼는 편이 계약도 단순하다.
    """
    return [[_cell_text(value) for value in row] for row in frame.itertuples(index=False)]


def _cell(grid: list[list[str]], row: int, col: int) -> str:
    if row < 0 or row >= len(grid):
        return ""
    line = grid[row]
    return line[col] if 0 <= col < len(line) else ""


def _role_for_label(label: str) -> str | None:
    if label == "":
        return None
    for role, pattern in ROLE_PATTERNS:
        if pattern.search(label):
            return role
    return None


def _width(grid: list[list[str]]) -> int:
    return max((len(line) for line in grid), default=0)


def _detect_header_row(grid: list[list[str]], scan_rows: int) -> int | None:
    """역할 앵커가 둘 이상 잡히는 첫 행을 헤더로 본다."""
    best: tuple[int, int] | None = None
    width = _width(grid)
    limit = min(scan_rows, len(grid))
    for row in range(limit):
        roles = {
            role
            for col in range(width)
            if (role := _role_for_label(_norm_label(_cell(grid, row, col)))) is not None
        }
        anchors = len(roles & _ANCHOR_ROLES)
        if anchors < 2:
            continue
        score = anchors * 10 + len(roles)
        if best is None or score > best[1]:
            best = (row, score)
    return None if best is None else best[0]


def _infer_role_by_content(grid: list[list[str]], col: int, start_row: int) -> str | None:
    """라벨이 없거나 못 알아본 열을 내용으로 추정한다(보수적)."""
    values = [
        text
        for row in range(start_row, min(start_row + _CONTENT_SCAN_ROWS, len(grid)))
        if (text := _cell(grid, row, col)) != ""
    ]
    if len(values) < 3:
        return None
    total = len(values)
    if sum(bool(_DATE_CODE_CELL.match(v)) for v in values) / total >= 0.8:
        return "date_code"
    if sum(bool(_INT_CELL.match(v)) for v in values) / total >= 0.9:
        return "stock_qty"
    if sum(bool(_MPN_CELL.match(v)) for v in values) / total >= 0.8:
        return "part_number"
    return None


def _resolve_roles(
    grid: list[list[str]],
    header_row: int | None,
    overrides: dict[int, str],
) -> tuple[dict[int, str], list[dict[str, Any]]]:
    """열 → 역할. 라벨 우선, 미정 열만 내용 추정, 사람 교정이 최종."""
    width = _width(grid)
    data_start = 0 if header_row is None else header_row + 1
    labels = {
        col: (_cell(grid, header_row, col) if header_row is not None else "")
        for col in range(width)
    }
    roles: dict[int, str] = {}
    taken: set[str] = set()

    for col in range(width):
        role = _role_for_label(_norm_label(labels[col]))
        if role is not None and role not in taken:
            roles[col] = role
            taken.add(role)
        elif role is not None:
            # 같은 역할이 둘 이상이면 첫 열만 승격하고 나머지는 원문 보존만 한다.
            roles[col] = "ignore"

    for col in range(width):
        if col in roles:
            continue
        inferred = _infer_role_by_content(grid, col, data_start)
        if inferred is not None and inferred not in taken:
            roles[col] = inferred
            taken.add(inferred)
        else:
            roles[col] = "ignore"

    for column_1based, role in overrides.items():
        col = int(column_1based) - 1
        if 0 <= col < width:
            roles[col] = role

    columns = [
        {
            "column_1based": col + 1,
            "raw_header": labels[col],
            "role": roles.get(col, "ignore"),
            "source": (
                "override" if (col + 1) in overrides
                else "label" if _role_for_label(_norm_label(labels[col])) is not None
                else "content" if roles.get(col, "ignore") != "ignore"
                else "none"
            ),
        }
        for col in range(width)
    ]
    return roles, columns


def _parse_int(text: str) -> int | None:
    match = re.search(r"\d[\d,]*", text)
    if match is None:
        return None
    try:
        return int(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _parse_price(text: str) -> tuple[float | None, str | None]:
    lowered = text.casefold()
    currency = next(
        (code for sign, code in _CURRENCY_SIGNS.items() if sign in lowered), None
    )
    match = re.search(r"\d[\d,]*(?:\.\d+)?", text)
    if match is None:
        return None, currency
    try:
        return float(match.group(0).replace(",", "")), currency
    except ValueError:
        return None, currency


def _clean_part_number(raw: str) -> tuple[str, list[str], list[str], str | None]:
    """품번 셀 정리 — **하나를 고르지 않고 후보를 모두 남긴다**.

    브랜드·수량·포장 접미가 섞인 셀에서 "진짜 품번"을 단정하면 반드시 틀린다
    (실측: `ACS725LLCTR-20AB-T Allegro MicroSystems` 는 두 낱말 브랜드,
    `PCA9575PW2, 118` 의 `118` 은 수량이 아니라 NXP 포장 코드). 그래서 정본은
    **정리한 원문 그대로**이고, 잡음을 떼어 본 결과는 `alternatives` 로 함께
    반환한다 — 조회 계층이 전부 색인하면 어느 쪽으로 적혀 있어도 걸린다.

    반환: (정본 품번, 플래그, 대체 후보, 브랜드 힌트)
    """
    flags: list[str] = []
    text = _clean_text(raw)
    if text == "":
        return "", flags, [], None
    if _REPLACEMENT in text:
        flags.append("mpn_replacement_char")
        text = _WS_RUN.sub(" ", text.replace(_REPLACEMENT, " ")).strip()

    canonical = text.strip().strip(",;")
    alternatives: list[str] = []
    brand_tokens: list[str] = []

    tokens = canonical.split(" ")
    if len(tokens) > 1 and _QTY_SUFFIX.match(tokens[-1]):
        tokens = tokens[:-1]
        flags.append("mpn_quantity_suffix_stripped")
        alternatives.append(" ".join(tokens).strip().strip(",;"))

    # 두 낱말 브랜드("Allegro MicroSystems")까지 떼어 본다. 머리쪽이 여전히
    # 숫자를 품은 품번꼴일 때만 진행한다.
    for _ in range(2):
        if len(tokens) < 2 or not _BRAND_SUFFIX.match(tokens[-1]):
            break
        head = " ".join(tokens[:-1]).strip().strip(",;")
        if len(head) < 3 or not any(ch.isdigit() for ch in head):
            break
        brand_tokens.insert(0, tokens[-1])
        tokens = tokens[:-1]
        alternatives.append(head)
    if brand_tokens:
        flags.append("mpn_brand_suffix_stripped")

    # 콤마 뒤 짧은 포장 코드(NXP `,118`)도 후보로만 남긴다 — 어느 쪽이 진짜인지
    # 여기서 정하지 않는다.
    if "," in canonical:
        head, _, tail = canonical.rpartition(",")
        tail = tail.strip()
        head = head.strip()
        if head != "" and 1 <= len(tail) <= 4 and tail.isalnum():
            alternatives.append(head)
            flags.append("mpn_comma_suffix_alternative")

    if " " in canonical:
        flags.append("mpn_needs_review")

    seen = {canonical.casefold()}
    unique: list[str] = []
    for candidate in alternatives:
        key = candidate.casefold()
        if candidate == "" or key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    brand_hint = " ".join(brand_tokens) if brand_tokens else None
    return canonical, flags, unique, brand_hint


def _extract_sheet(
    frame: pd.DataFrame,
    sheet_index: int,
    sheet_name: str,
    config: InventoryConfig,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    grid = _to_grid(frame)
    width = _width(grid)
    override_header = config.header_row_overrides.get(sheet_index)
    header_row = (
        int(override_header) - 1
        if override_header is not None
        else _detect_header_row(grid, _HEADER_SCAN_ROWS)
    )
    roles, columns = _resolve_roles(
        grid, header_row, config.role_overrides.get(sheet_index, {})
    )
    by_role = {role: col for col, role in roles.items() if role != "ignore"}

    if "part_number" not in by_role:
        return [], {
            "sheet_index_0based": sheet_index,
            "sheet_name": sheet_name,
            "status": "not_inventory",
            "row_count": 0,
            "header_rows_1based": [] if header_row is None else [header_row + 1],
            "header_labels": [c["raw_header"] for c in columns],
            "columns": columns,
            "warnings": [],
            "unparsed_reason": "part_number_column_not_found",
        }

    data_start = 0 if header_row is None else header_row + 1
    rows: list[dict[str, Any]] = []
    for row in range(data_start, len(grid)):
        cells = {col: _cell(grid, row, col) for col in range(width)}
        if all(text == "" for text in cells.values()):
            continue
        raw_pn = cells.get(by_role["part_number"], "")
        raw_fields = {
            (columns[col]["raw_header"] or f"col{col + 1}"): text
            for col, text in cells.items()
            if text != ""
        }
        if raw_pn == "":
            # 품번이 없는 행도 버리지 않는다 — 검토 대상으로 남긴다.
            rows.append({
                "row_id": f"s{sheet_index}r{row + 1}",
                "sheet_index_0based": sheet_index,
                "sheet_name": sheet_name,
                "source_row_1based": row + 1,
                "part_number": "",
                "part_number_raw": "",
                "part_number_alternatives": [],
                "manufacturer": None,
                "manufacturer_raw": None,
                "description": None,
                "package": None,
                "stock_qty": None,
                "date_code": None,
                "lead_time": None,
                "unit_price": None,
                "currency": None,
                "moq": None,
                "packaging": None,
                "raw_fields": raw_fields,
                "flags": ["part_number_missing"],
            })
            continue

        part_number, flags, alternatives, brand_hint = _clean_part_number(raw_pn)
        manufacturer_raw = cells.get(by_role.get("manufacturer", -1), "") or ""
        manufacturer = _clean_text(manufacturer_raw) or None
        if manufacturer is None and brand_hint is not None:
            manufacturer = brand_hint
            flags.append("manufacturer_from_part_number")

        stock_text = cells.get(by_role.get("stock_qty", -1), "") or ""
        price_text = cells.get(by_role.get("unit_price", -1), "") or ""
        unit_price, price_currency = _parse_price(price_text)
        currency_text = cells.get(by_role.get("currency", -1), "") or ""
        currency = (
            _clean_text(currency_text).upper() or None
        ) if currency_text else price_currency

        rows.append({
            "row_id": f"s{sheet_index}r{row + 1}",
            "sheet_index_0based": sheet_index,
            "sheet_name": sheet_name,
            "source_row_1based": row + 1,
            "part_number": part_number,
            "part_number_raw": _clean_text(raw_pn),
            "part_number_alternatives": alternatives,
            "manufacturer": manufacturer,
            "manufacturer_raw": _clean_text(manufacturer_raw) or None,
            "description": cells.get(by_role.get("description", -1), "") or None,
            "package": cells.get(by_role.get("packaging", -1), "") or None,
            "stock_qty": _parse_int(stock_text),
            "date_code": cells.get(by_role.get("date_code", -1), "") or None,
            "lead_time": cells.get(by_role.get("lead_time", -1), "") or None,
            "unit_price": unit_price,
            "currency": currency,
            "moq": _parse_int(cells.get(by_role.get("moq", -1), "") or ""),
            "packaging": cells.get(by_role.get("packaging", -1), "") or None,
            "raw_fields": raw_fields,
            "flags": flags,
        })

    summary = {
        "sheet_index_0based": sheet_index,
        "sheet_name": sheet_name,
        "status": "parsed",
        "row_count": len(rows),
        "header_rows_1based": [] if header_row is None else [header_row + 1],
        "header_labels": [c["raw_header"] for c in columns],
        "columns": columns,
        "warnings": [] if header_row is not None else ["헤더 행을 찾지 못해 내용으로 열을 추정했습니다"],
        "unparsed_reason": None,
    }
    return rows, summary


def build_inventory_result(
    *,
    input_path: Path | str,
    original_filename: str,
    progress: ProgressCallback,
    config: InventoryConfig | None = None,
) -> dict[str, Any]:
    """협력사 재고표 → 행 목록. BOM 결과와 봉투 모양은 같고 의미만 다르다."""
    config = config or InventoryConfig()
    started = time.perf_counter()

    def report(percent: int, message: str) -> None:
        progress("analyzing", percent, message)

    report(15, "재고표 분석 준비 중")
    path = Path(input_path)
    sheet_names = get_sheet_names(str(path))
    total = max(len(sheet_names), 1)

    sheets: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for idx, sheet_name in enumerate(sheet_names):
        report(20 + round(65 * idx / total),
               f"시트 '{sheet_name}' 분석 중 ({idx + 1}/{len(sheet_names)})")
        try:
            frame = load_sheet(str(path), idx)
        except Exception as exc:  # 시트 하나의 실패가 작업을 죽이지 않는다
            logger.exception("재고표 시트 로드 실패: %s sheet %d", original_filename, idx)
            reason = f"{type(exc).__name__}: {exc}"[:300]
            sheets.append({
                "sheet_index_0based": idx, "sheet_name": sheet_name,
                "status": "error", "row_count": 0, "header_rows_1based": [],
                "header_labels": [], "columns": [], "warnings": [],
                "unparsed_reason": reason,
            })
            failures.append({"sheet_name": sheet_name, "status": "error", "reason": reason})
            continue
        if frame.empty:
            sheets.append({
                "sheet_index_0based": idx, "sheet_name": sheet_name,
                "status": "not_inventory", "row_count": 0, "header_rows_1based": [],
                "header_labels": [], "columns": [], "warnings": [],
                "unparsed_reason": "empty_sheet",
            })
            continue

        sheet_rows, summary = _extract_sheet(frame, idx, sheet_name, config)
        if config.row_limit is not None:
            keep = max(int(config.row_limit) - len(rows), 0)
            if keep < len(sheet_rows):
                summary["warnings"].append(
                    f"행 상한({config.row_limit}) 초과 — {len(sheet_rows) - keep}행 절단")
                sheet_rows = sheet_rows[:keep]
                summary["row_count"] = keep
        rows.extend(sheet_rows)
        sheets.append(summary)

    report(90, "결과 요약 구성 중")
    flag_counts: dict[str, int] = {}
    flagged_rows = 0
    for row in rows:
        if row["flags"]:
            flagged_rows += 1
        for flag in row["flags"]:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1
    distinct_pn = {row["part_number"].casefold() for row in rows if row["part_number"]}

    return {
        "schema_version": INVENTORY_SCHEMA_VERSION,
        "engine": "inventory",
        "parser_version": INVENTORY_PARSER_VERSION,
        "source_file": original_filename,
        "summary": {
            "sheet_count": len(sheet_names),
            "parsed_sheet_count": sum(s["status"] == "parsed" for s in sheets),
            "row_count": len(rows),
            "distinct_part_number_count": len(distinct_pn),
            "with_part_number": sum(1 for r in rows if r["part_number"]),
            "with_manufacturer": sum(1 for r in rows if r["manufacturer"]),
            "with_stock": sum(1 for r in rows if r["stock_qty"] is not None),
            "with_price": sum(1 for r in rows if r["unit_price"] is not None),
            # 플래그 **발생 수**와 **행 수**는 다르다 — 한 행이 여러 플래그를 달 수 있어
            # 합계를 "확인할 행 수"로 읽으면 과장된다(화면이 그렇게 읽던 결함).
            "flag_counts": flag_counts,
            "flagged_row_count": flagged_rows,
            "processing_ms": round((time.perf_counter() - started) * 1000, 1),
        },
        "sheets": sheets,
        "rows": rows,
        "failures": failures,
    }
