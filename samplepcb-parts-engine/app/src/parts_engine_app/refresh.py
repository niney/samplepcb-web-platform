# -*- coding: utf-8 -*-
"""단건 부품 수동 갱신 — 부품 검색 화면의 [공급사 갱신] 버튼 전용.

BOM 잡 없이 MPN(+제조사) 하나로 IDENTITY 검색 배치를 조립해 공급사 API 를
"강제 라이브"로 호출한다. 캐시는 읽기만 무시하고 쓰기는 실캐시에 기록 —
갱신 결과가 이후 BOM 검색의 캐시로도 쓰인다. 엔진 패키지는 무수정(앱 계층 seam).
"""
from typing import Any

from supplier_search_engine.cache import CacheLookup, SQLiteCache
from supplier_search_engine.contract import build_batch_from_result
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
