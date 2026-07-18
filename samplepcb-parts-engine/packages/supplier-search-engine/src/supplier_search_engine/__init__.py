"""공급사 검색 엔진 — search_probing_gpt의 프로덕션 이식 (SMARTBOM 전용).

원본: search_probing_gpt @ 99ee721062954a692abaec9cc940025fbc2beaf6
(수동소자 스펙 기반 정밀화 동기화 완료) — 프로덕션 15모듈 verbatim 복사. 연구 전용(cli/benchmark/config_import/
bom_adapter)은 제외했고, bom_probing_gpt 의존은 contract.py(검색 계약
스키마)와 normalizer.py(수치 파서)를 vendoring해 제거했다 — 이 패키지는
httpx + pydantic 외 의존이 없다.

/g(BOM 분석 G)의 공급사 검색은 원본 search_probing_gpt(editable 의존)를
계속 쓰고, 이 패키지는 SMARTBOM 잡 전용이다. 캐시·쿼터 원장 SQLite는
/g와 같은 파일을 공유한다(실물 API 쿼터는 전역이므로).
"""

from .contract import SearchBatchInput, build_batch_from_result
from .models import MatchStatus, SearchMode, Supplier
from .planner import QueryPlanner
from .service import SearchService
from .settings import Settings

__all__ = [
    "MatchStatus",
    "QueryPlanner",
    "SearchBatchInput",
    "SearchMode",
    "SearchService",
    "Settings",
    "Supplier",
    "build_batch_from_result",
]
