# -*- coding: utf-8 -*-
"""단건 부품 수동 갱신과 사용자 카탈로그 검색 보강.

BOM 잡 없이 MPN(+제조사) 하나로 IDENTITY 검색 배치를 조립해 공급사 API 를
"강제 라이브"로 호출한다. 캐시는 읽기만 무시하고 쓰기는 실캐시에 기록 —
갱신 결과가 이후 BOM 검색의 캐시로도 쓰인다. 엔진 패키지는 무수정(앱 계층 seam).
"""
from typing import Any

from supplier_search_engine.cache import CacheLookup, SQLiteCache
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.normalization import package_from_text
from supplier_search_engine.normalizer import normalize_component_text
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings as SearchSettings

from .config import Config


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


def _single_part_batch(part_number: str, manufacturer: str | None):
    """MPN 1건 → G-shape 최소 결과를 조립해 기존 build_batch_from_result 재사용."""
    field_states: dict[str, Any] = {
        "part_number": {"value": part_number, "status": "extracted"},
    }
    if manufacturer:
        field_states["manufacturer"] = {"value": manufacturer, "status": "extracted"}
    result = {
        "schema_version": "1.0",
        "source_file": "manual-refresh",
        "summary": {"parser_version": "manual-refresh/1.0"},
        "components": [
            {
                "sheet_name": "manual",
                "sheet_index_0based": 0,
                "source_rows_1based": [1],
                "review_status": "extracted",
                "field_states": field_states,
            }
        ],
    }
    return build_batch_from_result(result)


def _catalog_search_batch(query: str):
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
    field_states["quantity"] = {"value": 1, "status": "extracted", "source": "infer"}
    component.update(
        {
            "sheet_name": "catalog-search",
            "sheet_index_0based": 0,
            "source_rows_1based": [1],
            "review_status": "extracted",
            "description": query,
            "value_raw": query,
            "quantity": 1,
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


async def search_catalog(
    config: Config,
    query: str,
    *,
    max_calls: int = 12,
) -> dict[str, Any]:
    """사용자 규격 검색 → 캐시 우선 공급사 보강 결과. 호출부가 동기 인제스트한다."""
    batch = _catalog_search_batch(query)
    settings = SearchSettings.from_env()
    settings.cache_path = config.supplier_cache_path
    settings.max_api_calls_per_job = max_calls
    cache = SQLiteCache(settings.cache_path)
    async with SearchService(settings, cache=cache) as service:
        result = await service.search_batch(batch)
    return {"search": result.model_dump(mode="json")}
