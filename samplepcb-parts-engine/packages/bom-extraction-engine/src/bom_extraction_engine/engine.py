# -*- coding: utf-8 -*-
"""SMARTBOM 엔진 진입점 — bom_probing_claude 규칙 파이프라인의 인프로세스 이식.

verify_engine(서브프로세스+별도 venv)과 달리 local_engine처럼 백엔드
프로세스 안에서 직접 실행한다 — 프로세스 기동/직렬화 오버헤드가 없고,
추출이 100% 규칙 기반이라 LLM/네트워크 의존도 없다.

결과는 local_fusion과 동일한 G-shape(AnalysisResult) — 프론트의
SummaryCards/ComponentTable/EvidenceDrawer/헤더 매핑 그리드를 그대로 쓴다.
"""
import logging
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import embedding
from .adapter import adapt_sheet
from .rule_extractor import compute_roles, extract_case
from .schema import VALUE_FIELDS
from .workbook import HeaderNotFound, build_case, get_sheet_names

logger = logging.getLogger(__name__)

PARSER_VERSION = "smartbom-rules/1.7 (semantic roles and integrity rules)"
SCHEMA_VERSION = "1.4"

ProgressCallback = Callable[[str, int, str], None]


@dataclass(frozen=True)
class SmartbomConfig:
    """엔진 설정 — 호출부(bom_probing_web)와의 명시적 계약.

    m2v_path: 헤더 탐지 임베딩 모델. ""=HF id(로컬 캐시 우선),
              디렉터리 경로=오프라인 배포, "off"=임베딩 폴백 비활성.
    component_limit: 결과 컴포넌트 총량 상한. None이면 무제한.
    """

    m2v_path: str = ""
    component_limit: int | None = 5_000


def build_smartbom_result(
    *,
    input_path: Path,
    original_filename: str,
    progress: ProgressCallback,
    config: SmartbomConfig | None = None,
) -> dict[str, Any]:
    config = config or SmartbomConfig()
    started = time.perf_counter()
    state = {"percent": 15}

    def report(percent: int, message: str) -> None:
        state["percent"] = percent
        progress("analyzing", percent, message)

    # 임베딩 폴백 설정 주입 — 실제 모델 로딩(수 초 걸릴 수 있는 유일 구간)
    # 직전에만 진행 메시지를 노출한다.
    embedding.configure(
        config.m2v_path,
        on_load=lambda: progress("analyzing", state["percent"],
                                 "헤더 탐지 임베딩 모델 로딩 중"),
    )
    report(15, "SMARTBOM 규칙 엔진 준비 중")

    input_path = Path(input_path)
    sheet_names = get_sheet_names(str(input_path))
    total = max(len(sheet_names), 1)
    component_limit = config.component_limit

    sheets: list[dict[str, Any]] = []
    components: list[dict[str, Any]] = []
    headers: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    field_statuses: Counter[str] = Counter()

    for idx, sheet_name in enumerate(sheet_names):
        report(20 + round(65 * idx / total),
               f"시트 '{sheet_name}' 분석 중 ({idx + 1}/{len(sheet_names)})")
        try:
            case = build_case(input_path, idx,
                              display_name=original_filename,
                              sheet_name=sheet_name)
        except HeaderNotFound:
            warnings = []
            if embedding.status() in ("disabled", "failed"):
                warnings.append("임베딩 폴백 비활성 — 라벨 사전만으로 헤더 탐지")
            sheets.append(_sheet_entry(idx, sheet_name, "not_bom",
                                       unparsed_reason="header_not_found",
                                       warnings=warnings))
            failures.append(_failure(original_filename, sheet_name, "not_bom",
                                     "header_not_found"))
            continue
        except Exception as exc:  # 시트 하나의 실패가 작업을 죽이지 않는다
            logger.exception("SMARTBOM 시트 분석 실패: %s sheet %d (%s)",
                             original_filename, idx, sheet_name)
            reason = f"{type(exc).__name__}: {exc}"[:300]
            sheets.append(_sheet_entry(idx, sheet_name, "error",
                                       unparsed_reason=reason))
            failures.append(_failure(original_filename, sheet_name, "error",
                                     reason))
            continue

        roles = compute_roles(case)
        preds, sources = extract_case(case, roles)
        sheet_components, sheet_headers = adapt_sheet(
            case, roles, preds, sources,
            source_file=original_filename, sheet_index=idx)

        warnings: list[str] = []
        if component_limit is not None:
            keep = max(int(component_limit) - len(components), 0)
            if keep < len(sheet_components):
                warnings.append(
                    f"컴포넌트 상한({component_limit}) 초과 — "
                    f"{len(sheet_components) - keep}행 절단")
                sheet_components = sheet_components[:keep]

        components.extend(sheet_components)
        headers.extend(sheet_headers)
        for component in sheet_components:
            for field in VALUE_FIELDS:
                status = (component["field_states"].get(field) or {}).get(
                    "status") or "not_found"
                field_statuses[str(status)] += 1
        sheets.append(_sheet_entry(
            idx, sheet_name, "parsed",
            component_count=len(sheet_components),
            column_count=len(sheet_headers),
            header_rows_1based=[r + 1 for r in case["header_rows"]],
            header_labels=list(case["header_labels"]),
            warnings=warnings,
        ))

    report(85, "결과 요약 구성 중")
    status_counts = Counter(sheet["status"] for sheet in sheets)
    review_count = sum(component.get("review_status") == "review"
                       for component in components)
    processing_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "schema_version": SCHEMA_VERSION,
        "engine": "smartbom",
        "model": None,
        "prompt_version": None,
        "parser_version": PARSER_VERSION,
        "source_file": original_filename,
        "summary": {
            "sheet_count": len(sheets),
            "parsed_sheet_count": status_counts.get("parsed", 0),
            "header_not_found_sheet_count": status_counts.get("not_bom", 0),
            "component_count": len(components),
            "header_mapping_count": len(headers),
            "review_component_count": review_count,
            "failure_count": len(failures),
            "field_status_counts": dict(sorted(field_statuses.items())),
            "sheet_status_counts": dict(sorted(status_counts.items())),
            "processing_ms": processing_ms,
            "parser_version": PARSER_VERSION,
            "header_embedding": embedding.status(),
        },
        "sheets": sheets,
        "components": components,
        "headers": headers,
        "failures": failures,
    }


def _sheet_entry(index: int, name: str, status: str, *,
                 component_count: int = 0, column_count: int = 0,
                 header_rows_1based: list[int] | None = None,
                 header_labels: list[str] | None = None,
                 warnings: list[str] | None = None,
                 unparsed_reason: str | None = None) -> dict[str, Any]:
    return {
        "sheet_index_0based": index,
        "sheet_name": name,
        "status": status,
        "component_count": component_count,
        "column_count": column_count,
        "header_rows_1based": header_rows_1based or [],
        "header_labels": header_labels or [],
        "warnings": warnings or [],
        "unparsed_reason": unparsed_reason,
    }


def _failure(source_file: str, sheet_name: str, status: str,
             reason: str | None) -> dict[str, Any]:
    return {
        "source_file": source_file,
        "sheet_name": sheet_name,
        "status": status,
        "reason": reason,
    }
