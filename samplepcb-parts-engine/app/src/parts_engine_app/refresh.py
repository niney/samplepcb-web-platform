# -*- coding: utf-8 -*-
"""단건 부품 수동 갱신과 사용자 카탈로그 검색 보강.

BOM 잡 없이 MPN(+제조사) 하나로 IDENTITY 검색 배치를 조립해 공급사 API 를
"강제 라이브"로 호출한다. 캐시는 읽기만 무시하고 쓰기는 실캐시에 기록 —
갱신 결과가 이후 BOM 검색의 캐시로도 쓰인다. 일괄 갱신은 명시한 공급사만
선택할 수 있지만 일반 BOM 검색의 기본 공급사 계약은 바꾸지 않는다.
"""
import re
from typing import Any

from supplier_search_engine.cache import CacheLookup, SQLiteCache
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.models import (
    BatchSearchResult,
    MatchStatus,
    ProcurementPolicyInput,
    Supplier,
)
from supplier_search_engine.normalization import normalize_mpn, package_from_text
from supplier_search_engine.normalizer import normalize_component_text
from supplier_search_engine.procurement import apply_procurement_decisions
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings as SearchSettings

from .config import Config


_MPN_FALLBACK_TOKEN = re.compile(
    r"^(?=.{4,191}$)(?=.*[A-Z])(?=.*\d)[A-Z0-9][A-Z0-9._+/#()-]*$",
    re.IGNORECASE,
)
_PACKAGE_ONLY_TOKEN = re.compile(
    r"^(?:(?:T?SOT|SOD|DO|DIP|SOIC|SOP|SSOP|TSSOP|MSOP|LQFP|TQFP|"
    r"QFN|DFN|BGA|WSON)[-_]?\d{1,4}(?:[-_]\d{1,3})?|RJ\d+)$",
    re.IGNORECASE,
)
_SPEC_ATOM = re.compile(
    r"^(?:"
    r"\d+(?:\.\d+)?(?:(?:P|N|U|Μ|M)F?|F)|"
    r"\d+(?:\.\d+)?(?:V|W|A|HZ|KHZ|MHZ|GHZ|%)|"
    r"\d+(?:\.\d+)?(?:R|K|M)(?:OHM|Ω)?|"
    r"\d+(?:R|K|M)\d+"
    r")$",
    re.IGNORECASE,
)
_PASSIVE_PACKAGE_ATOM = re.compile(r"^(?:0[12468]\d{2}|1[28]\d{2})$")


class LiveReadCache(SQLiteCache):
    """읽기=항상 miss(강제 라이브), 쓰기=부모 그대로(실캐시 기록)."""

    def get(
        self,
        namespace: str,
        key: str,
        *,
        allow_stale: bool = False,
        now: float | None = None,
    ) -> CacheLookup:
        del namespace, key, allow_stale, now
        return CacheLookup("miss", None, None)


def _single_part_batch(
    part_number: str,
    manufacturer: str | None,
    *,
    needed: int | None = None,
    source_file: str = "manual-refresh",
):
    """MPN 1건 → G-shape 최소 결과를 조립해 기존 build_batch_from_result 재사용."""
    field_states: dict[str, Any] = {
        "part_number": {"value": part_number, "status": "extracted"},
    }
    if manufacturer:
        field_states["manufacturer"] = {"value": manufacturer, "status": "extracted"}
    component: dict[str, Any] = {
        "sheet_name": "manual" if source_file == "manual-refresh" else source_file,
        "sheet_index_0based": 0,
        "source_rows_1based": [1],
        "review_status": "extracted",
        "field_states": field_states,
    }
    if needed is not None:
        field_states["quantity"] = {
            "value": needed,
            "status": "extracted",
            "source": "request",
        }
        component.update(
            {
                "description": part_number,
                "value_raw": part_number,
                "quantity": needed,
            }
        )
    result = {
        "schema_version": "1.0",
        "source_file": source_file,
        "summary": {"parser_version": f"{source_file}/1.0"},
        "components": [component],
    }
    return build_batch_from_result(result)


def _catalog_search_batch(query: str, needed: int = 1):
    """자유 규격 검색어 1건을 기존 검색 계약으로 변환한다.

    공급사 쿼리 계획·정규화·후보 판단은 SearchService가 맡는다. 앱 계층은
    공개 검색어를 G-shape 입력으로 옮기는 seam만 제공해 판단 중복을 피한다.
    """
    lowered = query.casefold()
    initial = normalize_component_text(query, None)
    primary_types = [
        ("capacitor", initial.get("capacitance_f")),
        ("resistor", initial.get("resistance_ohm")),
        ("inductor", initial.get("inductance_h")),
    ]
    detected = [name for name, value in primary_types if value is not None]
    if len(detected) == 1:
        part_type = detected[0]
    elif "capacitor" in lowered or "콘덴서" in query or "캐패시터" in query:
        part_type = "capacitor"
    elif "resistor" in lowered or "저항" in query:
        part_type = "resistor"
    elif "inductor" in lowered or "인덕터" in query:
        part_type = "inductor"
    else:
        part_type = None

    normalized = normalize_component_text(query, part_type)
    package = package_from_text(query, part_type)
    normalized_fields = {
        "resistance": "resistance_ohm",
        "capacitance": "capacitance_f",
        "inductance": "inductance_h",
        "power": "power_w",
        "tolerance": "tolerance_percent",
        "voltage": "voltage_v",
        "current": "current_a",
        "frequency": "frequency_hz",
    }
    field_states: dict[str, Any] = {}
    component: dict[str, Any] = {}
    for field, normalized_name in normalized_fields.items():
        value = normalized.get(normalized_name)
        if value is None:
            continue
        field_states[field] = {
            "value": query,
            "status": "extracted",
            "source": "text",
        }
        component[normalized_name] = value
    if part_type is not None:
        field_states["part_type"] = {
            "value": part_type,
            "status": "extracted",
            "source": "infer",
        }
    if package:
        field_states["package"] = {
            "value": package,
            "status": "extracted",
            "source": "text",
        }
    # 정규화 가능한 규격이 전혀 없으면 전체 문자열을 MPN 검색으로 취급한다.
    if not field_states:
        field_states["part_number"] = {
            "value": query,
            "status": "extracted",
            "source": "text",
        }
    field_states["quantity"] = {
        "value": needed,
        "status": "extracted",
        "source": "request",
    }
    component.update(
        {
            "sheet_name": "catalog-search",
            "sheet_index_0based": 0,
            "source_rows_1based": [1],
            "review_status": "extracted",
            "description": query,
            "value_raw": query,
            "quantity": needed,
            "field_states": field_states,
        }
    )
    result = {
        "schema_version": "1.0",
        "source_file": "catalog-search",
        "summary": {"parser_version": "catalog-search/1.0"},
        "components": [component],
    }
    return build_batch_from_result(result)


def _catalog_mpn_fallback_term(query: str) -> str | None:
    """사양/패키지를 MPN으로 오인하지 않는 보수적인 단일 토큰 판정."""
    term = query.strip()
    if not _MPN_FALLBACK_TOKEN.fullmatch(term):
        return None
    if _PACKAGE_ONLY_TOKEN.fullmatch(term):
        return None
    atoms = re.split(r"[-/]", term)
    if atoms and all(
        _SPEC_ATOM.fullmatch(atom) or _PASSIVE_PACKAGE_ATOM.fullmatch(atom)
        for atom in atoms
    ):
        return None
    return term


def _should_try_catalog_mpn_fallback(
    query: str,
    result: BatchSearchResult,
) -> str | None:
    """후보 없는 정상 종료에만 정확 MPN 재검색을 허용한다."""
    if len(result.components) != 1:
        return None
    component = result.components[0]
    if component.candidates:
        return None
    if component.status not in {
        MatchStatus.INSUFFICIENT_INPUT,
        MatchStatus.NOT_FOUND,
    }:
        return None
    if component.query is not None and component.query.part_number:
        return None
    return _catalog_mpn_fallback_term(query)


def _combine_catalog_search_results(
    primary: BatchSearchResult,
    fallback: BatchSearchResult,
    exact_mpn: str,
) -> BatchSearchResult:
    """정확 MPN 후보만 남기고 두 번의 검색 비용·진단을 하나로 합친다."""
    primary_component = primary.components[0]
    fallback_component = fallback.components[0]
    normalized_mpn = normalize_mpn(exact_mpn)
    exact_candidates = [
        candidate
        for candidate in fallback_component.candidates
        if normalize_mpn(candidate.product.manufacturer_part_number) == normalized_mpn
    ]
    combined_metrics = {
        "unique_query_count": (
            primary.unique_query_count + fallback.unique_query_count
        ),
        "api_calls": primary.api_calls + fallback.api_calls,
        "cache_hits": primary.cache_hits + fallback.cache_hits,
        "prefetched_requests": (
            primary.prefetched_requests + fallback.prefetched_requests
        ),
        "elapsed_ms": primary.elapsed_ms + fallback.elapsed_ms,
    }
    if not exact_candidates or fallback_component.query is None:
        warnings = list(
            dict.fromkeys(
                [
                    *primary_component.warnings,
                    (
                        "원문을 정확 MPN으로 재검색했지만 동일 MPN 후보를 "
                        "확인하지 못했습니다."
                    ),
                ]
            )
        )
        component = primary_component.model_copy(
            update={
                "api_calls": primary_component.api_calls
                + fallback_component.api_calls,
                "elapsed_ms": primary_component.elapsed_ms
                + fallback_component.elapsed_ms,
                "warnings": warnings,
            },
            deep=True,
        )
        return primary.model_copy(
            update={"components": [component], **combined_metrics},
            deep=True,
        )

    exact_candidates, procurement_decision = apply_procurement_decisions(
        fallback_component.query,
        exact_candidates,
        fallback.procurement_policy,
    )
    warnings = list(
        dict.fromkeys(
            [
                *fallback_component.warnings,
                (
                    "기존 검색 결과가 없어 원문을 정확 MPN으로 다시 "
                    "확인했습니다."
                ),
            ]
        )
    )
    component = fallback_component.model_copy(
        update={
            "component_id": primary_component.component_id,
            "reference_designators": primary_component.reference_designators,
            "source_rows_1based": primary_component.source_rows_1based,
            "initial_query": primary_component.query,
            "initial_supplier_results": primary_component.supplier_results,
            "candidates": exact_candidates,
            "status": exact_candidates[0].status,
            "procurement_decision": procurement_decision,
            "api_calls": primary_component.api_calls + fallback_component.api_calls,
            "elapsed_ms": (
                primary_component.elapsed_ms + fallback_component.elapsed_ms
            ),
            "warnings": warnings,
        },
        deep=True,
    )
    return fallback.model_copy(
        update={
            "procurement_policy": primary.procurement_policy,
            "source_file": primary.source_file,
            "components": [component],
            **combined_metrics,
        },
        deep=True,
    )


async def refresh_part(
    config: Config,
    part_number: str,
    manufacturer: str | None,
    *,
    max_calls: int = 25,
) -> dict[str, Any]:
    """단건 강제 라이브 검색 → BatchSearchResult(dict). 호출부(sp-node)가 인제스트."""
    batch = _single_part_batch(part_number, manufacturer)
    settings = SearchSettings.from_env()
    settings.cache_path = config.supplier_cache_path
    settings.max_api_calls_per_job = max_calls
    cache = LiveReadCache(settings.cache_path)
    async with SearchService(settings, cache=cache) as service:
        result = await service.search_batch(batch)
    return {"search": result.model_dump(mode="json")}


async def refresh_parts(
    config: Config,
    parts: list[tuple[str, str, str | None]],
    *,
    max_calls: int,
    job_timeout_seconds: float,
    suppliers: tuple[Supplier, ...],
) -> dict[str, Any]:
    """여러 exact MPN을 한 SearchService로 강제 갱신한다.

    단건 `/parts/refresh`를 반복하면 DigiKey OAuth 토큰까지 품번마다 새로
    발급한다. 일회성 카탈로그 전수 작업은 한 배치에서 클라이언트·토큰과
    Mouser exact batch를 재사용하고, component_id로 결과를 원래 행에 돌려준다.
    """
    if not parts:
        raise ValueError("parts must not be empty")
    batches = [
        _single_part_batch(
            part_number,
            manufacturer,
            source_file="manual-refresh-batch",
        )
        for _, part_number, manufacturer in parts
    ]
    first = batches[0]
    components = [
        batch.components[0].model_copy(update={"component_id": component_id})
        for (component_id, _, _), batch in zip(parts, batches, strict=True)
    ]
    batch = first.model_copy(
        update={
            "source_file": "manual-refresh-batch",
            "components": components,
        }
    )
    settings = SearchSettings.from_env()
    settings.cache_path = config.supplier_cache_path
    settings.max_api_calls_per_job = max_calls
    settings.job_timeout_seconds = job_timeout_seconds
    # 전수 exact 갱신은 공급사별 burst보다 재현 가능한 완주가 우선이다.
    # 공급사끼리는 병렬로 동작하되 같은 공급사 요청은 보수적으로 직렬화한다.
    settings.digikey_concurrency = 1
    settings.digikey_identity_concurrency = 1
    settings.mouser_concurrency = 1
    settings.unikeyic_concurrency = 1
    cache = LiveReadCache(settings.cache_path)
    async with SearchService(
        settings,
        cache=cache,
        allowed_suppliers=set(suppliers),
    ) as service:
        result = await service.search_batch(batch)
    return {"search": result.model_dump(mode="json")}


async def search_catalog(
    config: Config,
    query: str,
    *,
    needed: int = 1,
    max_calls: int = 12,
    procurement_policy: ProcurementPolicyInput | None = None,
) -> dict[str, Any]:
    """사용자 규격 검색 → 캐시 우선 공급사 결과와 현재 수량·환율 조달 판정."""
    batch = _catalog_search_batch(query, needed)
    batch = batch.model_copy(
        update={
            "procurement_policy": procurement_policy or ProcurementPolicyInput(),
        },
        deep=True,
    )
    settings = SearchSettings.from_env()
    settings.cache_path = config.supplier_cache_path
    settings.max_api_calls_per_job = max_calls
    cache = SQLiteCache(settings.cache_path)
    async with SearchService(settings, cache=cache) as service:
        result = await service.search_batch(batch)
        fallback_term = _should_try_catalog_mpn_fallback(query, result)
        remaining_calls = max_calls - result.api_calls
        if fallback_term is not None and remaining_calls > 0:
            settings.max_api_calls_per_job = remaining_calls
            fallback_batch = _single_part_batch(
                fallback_term,
                None,
                needed=needed,
                source_file="catalog-search",
            )
            fallback_batch = fallback_batch.model_copy(
                update={"procurement_policy": batch.procurement_policy},
                deep=True,
            )
            fallback = await service.search_batch(fallback_batch)
            result = _combine_catalog_search_results(
                result,
                fallback,
                fallback_term,
            )
    return {
        "supplier_search_schema_version": result.search_schema_version,
        "procurement_decision_contract_status": "current",
        "search": result.model_dump(mode="json"),
    }
