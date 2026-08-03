---
topic: parts-engine
last_compiled: 2026-07-27
sources_count: 13
status: active
---

# parts-engine

## Purpose [coverage: high — 6 sources]

`samplepcb-parts-engine/`(별칭 **sp-engine**)은 PCB 부품 **BOM 추출 + 공급사 검색**을 담당하는 Python 엔진이다. `samplepcb-web-platform` 단일 repo의 형제 서브폴더로, 폴리글랏 우산 구도를 완성한다: `samplepcb-web/`=PHP, `samplepcb-web-mono-app/`=Vue+Node, `samplepcb-parts-engine/`=**Python**. 출처는 `sp-smartbom-eye/bom_probing_web` 실험용 웹앱 — 거기서 두 엔진을 프로덕션으로 이식했다.

**역할 경계(2026-07-21 AGENTS.md 신설 절)** — 계산 서비스가 아니라 **판단의 단일 원본**이다:

- sp-engine이 **BOM 추출·정규화·검색·호환성 판단의 원본**이며, 같은 판단을 sp-node·sp-vue에 중복 구현하지 않는다.
- sp-node는 sp-engine과 프런트 사이의 **계약·저장·업무 정책 경계**다. 가격·환율·재고·MOQ·주문배수·견적 상태·권한은 sp-node 책임이되, **엔진이 기술적으로 허용한 후보 안에서만** 구매 조건을 계산한다.
- **sp-engine ↔ sp-vue 직접 연결 금지.** sp-vue는 `selection_eligibility`·`reason_codes`·검증 수치·수명주기 상태를 *표시*할 뿐 재판정하지 않는다.
- 필요한 판단이 엔진에 없으면 응용 계층에서 추측하지 말고, 엔진 수정 필요성을 사용자에게 알린 뒤 **엔진부터 고친다**.

## Architecture [coverage: high — 7 sources]

**uv workspace** (루트는 aggregator, `[tool.uv] package = false`). `requires-python >= 3.11`, 공유 `.venv` 하나(`uv sync`). 멤버는 `packages/*` + `app`:

| 워크스페이스 | 모듈 | 성격 |
|---|---|---|
| `packages/bom-extraction-engine/` | `bom_extraction_engine` | 구 `smartbom_engine`. 스프레드시트(xlsx/xls/csv/탭구분 `.BOM`) → 헤더 탐지(`fusion`) → 열 역할 분류(`field_lexicon`·`row_features`) → 행별 구조화(`rule_extractor`·`adapter`). **100% 규칙 기반, LLM/네트워크 없음** |
| `packages/supplier-search-engine/` | `supplier_search_engine` | 공급사 API 검색 → 정규화 → **기술 판정·조달 판정**. `planner`(질의 계획) · `supplier_query` · `suppliers/{digikey,mouser,unikeyic}` · `normalizer`/`normalization` · `matcher`(후보 결정) · `physical` · `procurement`(적용 후보·구매 불가 사유) · `preflight`(호출량 예측) · `contract`(검색 조건 정책) · `cache`/`request_cache`/`budget`/`singleflight`/`routing`/`pricing`/`settings` |
| `app/` | `parts_engine_app` | FastAPI 오케스트레이션. `main`·`routes`·`jobs`(인메모리 잡)·`refresh`(단건 갱신/카탈로그 검색)·`capabilities`·`config` |

- 의존성 대비: 추출 엔진은 pandas·openpyxl·python-calamine·xlrd·rapidfuzz·model2vec·scikit-learn 등 두터운 편, 검색 엔진은 httpx+pydantic 최소, app은 fastapi+uvicorn.
- 테스트: 루트 pytest가 세 워크스페이스 `tests/`를 한꺼번에 수집(`asyncio_mode = "auto"`). 이식 시점 171 → **최근 커밋 기준 537 passed / 1 skipped**(`b8bfc0a5f`).
- 실행 스크립트 `run.sh` / `run.ps1`(uv 확인 + `.env` 부트스트랩 + `uv sync` + uvicorn, 포트 인자 지원).

## Talks To [coverage: high — 5 sources]

- **sp-node(Fastify) 게이트웨이** — 유일한 소비자. 설정 키 `BOM_ENGINE_URL`(엔진 포트 변경 시 동기화 필수). sp-node는 엔진 결정을 재정렬하지 않고 키·수량·금액 불변식만 검증해 저장하며, `decision`이 없는 후보는 자체 규칙으로 복구하지 않고 차단한다.
- **nginx `/engine` 프록시** — 같은 도메인 합류 경로.
- **외부 공급사 API**(supplier-search-engine만): Mouser(API key), DigiKey(OAuth2 client_credentials), UniKeyIC(API key + base URL). 동시 호출 수 `SEARCH_SUPPLIER_CONCURRENCY`(기본 4), 작업 시간 상한 `SEARCH_JOB_TIMEOUT_SECONDS`(기본 60초). BOM 추출은 네트워크·자격증명 모두 불필요.
- **로컬 카탈로그 identity**(외부 호출 아님): `CatalogSupplier` enum — `samplepcb`·`yeonho`·`walsin`·`yageo`·`samsung`·`murata`·`tdk`·`vishay`·`koa`. 주석대로 "never routed as external clients" — DB는 sp-node가 조회하고, 엔진은 그 히트를 **판정만** 한다.

## API Surface [coverage: high — 5 sources]

- 서버: `uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port 8400 --reload`(또는 `./run.sh` / `.\run.ps1 -Port ...`). Swagger `/docs`.

| 경로 | 용도 |
|---|---|
| `GET /health` | 헬스체크 |
| `GET /capabilities` | 관리자 화면용 **읽기 전용 운영 계약** — `max_calls_per_job`, 공급사별 자격증명 설정 여부, 캐시 모드·항목 수·TTL. API 키·캐시 파일 경로는 반환하지 않음 |
| `GET /supplier-search/requirements/capabilities` | 부품 유형별 필수·선택·조건부 필드를 엔진 단일 원본으로 공개 |
| `POST /supplier-search/requirements/validate` | DB 저장·공급사 호출 없이 검색 조건만 엔진 정책으로 검증 |
| `POST /supplier-search/catalog-evaluate-batch` | sp-node의 exact 로컬 카탈로그 히트에 엔진 matcher·후보 결정·조달 정책을 그대로 적용(외부 호출 0) |
| `POST /jobs` (202) · `GET /jobs/{id}` · `GET /jobs/{id}/result` | 파일 업로드 → BOM 추출 잡 |
| `POST /supplier-jobs` (201) | sp-node **영속 분석 스냅샷**을 공급사 검색 입력으로 등록(파일 재업로드 없이 재개) |
| `POST /jobs/{id}/supplier-search/preflight` | 예상·최악 호출량 사전 계산(조건부 2차 검색 포함) |
| `POST /jobs/{id}/supplier-search` (202) · `GET .../supplier-search` · `GET .../supplier-search/result` | 공급사 검색 잡 |
| `POST /supplier-search/procurement/reevaluate` · `/reevaluate-batch` | 저장된 기술 후보에 새 수량·환율만 재적용(**공급사 호출 없음**). 배치 상한 200, 행 하나의 실패가 배치를 막지 않음 |
| `POST /parts/refresh` · `POST /parts/search` | 부품 검색 화면의 [공급사 갱신](MPN 1건 강제 라이브, max_calls 25) · 로컬 색인 exact miss 보강(캐시 우선, max_calls 12) |

## Data [coverage: high — 5 sources]

- **자격증명**: `.env`(`.env.example` 복사, `.gitignore` 등록) — 백엔드 전용, 브라우저 전달 금지. `main.py`가 `load_dotenv()`로 자동 로드.
- **`SUPPLIER_MAX_CALLS=3000`**(신규): 공급사 검색 1회당 실제 외부 API 호출 **안전 상한**. sp-node 관리자 화면의 "검색 1회 최대 API 호출"도 이 값을 넘을 수 없고, 라우트 스키마가 `ge=1, le=3_000`으로 강제한다. 관리자 업무 한도를 대체하는 게 아니라, 둘 중 **작은 값**이 실효 한도다.
- **캐시**: SQLite(raw/keyword/stale TTL, `stale_if_error`). `cache_only`와 `reset_cache`는 동시 사용 불가.
- DB(Prisma/그누보드)와 직접 연결 없음 — 파일 업로드 또는 JSON 스냅샷 입력, JSON 구조화 출력.
- **계약 식별자**(소비자 계약이므로 임의 변경 금지): 추출 `parser_version="smartbom-rules/1.10"`·`"engine":"smartbom"`, 검색 `search_schema_version=1.7`·`SEARCH_CONTRACT_VERSION=1.2`, 판정 `supplier-candidate-decision-v3`·`candidate-category-policy-v2`·`supplier-selection-application-v3`·`supplier-procurement-decision-v1`·`supplier-procurement-unavailability-v1`·`supplier-offer-key-v2`·`bom-search-requirement-policy-v1`·`supplier-search-trace-v1`.

## Key Decisions [coverage: high — 8 sources]

- **2026-07-26 — 부품 유형별 로컬 카탈로그 우선 조회**: `resistor`·`capacitor`·`connector`로 **엔진이 판정한** 행은 외부 공급사보다 자체 카탈로그를 먼저 본다(R/C=Walsin AVL 2,628건, connector=연호 1,606건). 기준은 **공급사명이 아니라 부품 유형**이라 다른 원장이 추가돼도 같은 경로를 탄다. `catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 반영하고 나머지만 외부 검색으로 보낸다.
- **2026-07-26 — 제조사 카탈로그 부품 = 문의 견적**: 카탈로그 원천 정보는 가격·재고·MOQ가 없다. 정확 MPN·제조사 + 자동선정 안전등급을 통과한 기술 1순위만 `catalog_selected`로 **identity만** 적용하고, offer 키·추천 구매 조건·가격·재고는 만들지 않은 채 `primary_unavailability_reason=catalog_inquiry`를 함께 반환한다. 가짜 재고·가격을 만들지 않는 것이 핵심.
- **2026-07-26 — 정확 MPN 우선 자동선정**: 추가 스펙 불일치·누락이 있어도 구매 가능하면 자동선정한다. 명시적으로 확정된 **부품 유형 충돌만** 차단하고 공급사 유형 근거 충돌은 경고로 보존.
- **2026-07-26 — 제조사 정보 충돌 판정 폐기**: `manufacturer_source_conflict` 생성·수동검토 강등·추천 예외를 계약에서 **삭제**했다. 제조사 미지정 exact MPN도 자동선정 대상. identity 분리는 유지.
- **2026-07-26 — 스펙 검색 후보 수 축소(perf)**: 스펙 검색은 DigiKey·Mouser 공급사별 10건, 정확 MPN 경로는 기존 20건 유지. 조회 크기를 못 정하는 UniKeyIC는 **먼저 자르지 않고** 전량 정규화·기술 판정 후 상위 10개 그룹만 조달 판단에 쓴다. 최종 보존은 공급사별 기술 3 + 가격 2 그룹의 합집합.
- **2026-07-25 — 호출 상한 3,000회**: 기본값과 안전 상한을 함께 3,000으로 올리되 **기존 저장값은 자동 변경하지 않아** 관리자가 명시적으로 상향하게 남겼다.
- **2026-07-25 — 검색 조건 판정을 엔진으로 일원화**: 부품 유형별 필수값·조건부 조합·전기 단위 해석을 `contract.py`의 버전 계약으로 통합하고 `requirements/capabilities`·`validate` 엔드포인트를 냈다. sp-node의 부품별 변환 switch와 기술 조합 검증은 **제거**했다. 대상 유형은 9종(저항·커패시터·인덕터·다이오드·TR/FET·LED·크리스탈·커넥터·스위치).
- **2026-07-25 — 부품 유형 추출을 증거 기반으로 일반화**: 첫 키워드 우선 판정을 설명·값·Class·패키지·풋프린트·RefDes **출처별 증거 점수 합의**로 재구성. DNP/NC 상태가 부품 정체를 지우지 않는다.
- **2026-07-21 — 후보 판단 단일 소유권**(`supplier-candidate-decision-v3`, `docs/prompts/sp-engine-candidate-decision.md`): 후보마다 완결된 `decision`(선택 자격·매칭 관계·`identity_key`·`technical_evidence_key`·검증 수치·`lifecycle_state`)을 반환해, sp-node·sp-vue가 엔진 문자열을 재해석해 호환성을 만들지 못하게 했다. 근거가 부족하면 안전하게 `blocked`로 축퇴.
- **2026-07-18 — 패리티 우선, 리팩토링 나중**: 무변경 복사 + 테스트 그린으로 동작 동일성부터 증명. 엔진 로직은 "다시 쓰는 코드"가 아니라 **연구 계보에서 re-sync 하는 vendored 코드** — 리팩토링 에너지는 `app/` 계층에 집중.
- **2026-07-18 — 기본 포트 8400**: Windows Hyper-V/WSL 예약 범위(8089–8188) 회피.

## Gotchas [coverage: medium — 4 sources]

- **README 버전 표기가 뒤처진다**: "현재 437 passed"(실제 537)·`parser_version="smartbom-rules/1.6"`(실제 `1.10`)·구조 다이어그램의 `app/ ← Phase 2 (예정)`(실제 완성·운영 중). 버전·개수는 코드 상수(`engine.py PARSER_VERSION`, `models.py`)를 정본으로 볼 것.
- **포트 8400 함정**: app pyproject 헤더 주석 예시는 `--port 8100`이지만 Windows에서 8100대는 예약 범위에 걸릴 수 있다. 확인은 `netsh interface ipv4 show excludedportrange protocol=tcp`. 변경 시 sp-node `BOM_ENGINE_URL` 동기화 필수.
- **`resultCount` 의미 혼동**: 화면의 "검색 과정" 건수는 **가공 전 공급사 원응답** 수이고, 후보 목록 수는 기술 검증·중복 제거·후처리 제한을 거친 **최종 후보** 수다. 두 숫자는 원래 다르다(특히 응답 상한이 없는 UniKeyIC).
- **연구 계보 re-sync 전제**: supplier-search-engine을 자유롭게 리팩토링하면 원본(`sp-smartbom-eye`)과의 재동기화가 깨진다 — 수정은 seam에만. 동기화 기준 커밋은 README 하단에 기록.
- **공급사 키는 백엔드 전용**: 추출 엔진은 키가 불필요하므로 키 없이도 BOM 추출 경로는 동작한다.
- **preflight는 차단 게이트가 아니다**: 예상 호출이 한도를 넘어도 검색은 시작하고, 실제 호출 시점의 **원자적 job budget**이 `max_calls`를 강제한다(`job_call_limit_exhausted`).

## Sources [coverage: high — 13 sources]

- [samplepcb-parts-engine/README.md](../../samplepcb-parts-engine/README.md) — 정본(추출/검색 계약·관계 기반 추출·기술 순위와 구매 적용 후보)
- [samplepcb-parts-engine/.env.example](../../samplepcb-parts-engine/.env.example) — 자격증명 + `SUPPLIER_MAX_CALLS`
- [samplepcb-parts-engine/pyproject.toml](../../samplepcb-parts-engine/pyproject.toml) — uv workspace 루트
- [app/src/parts_engine_app/routes.py](../../samplepcb-parts-engine/app/src/parts_engine_app/routes.py) — 엔드포인트 전체·요청 스키마 상한
- [app/src/parts_engine_app/capabilities.py](../../samplepcb-parts-engine/app/src/parts_engine_app/capabilities.py) — `/capabilities` 반환 계약
- [supplier_search_engine/models.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/models.py) — 정책 버전 리터럴·`CatalogSupplier`·상태 enum
- [supplier_search_engine/contract.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/contract.py) — 검색 조건 정책 계약
- [supplier_search_engine/settings.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/settings.py) — 동시성·타임아웃·캐시 TTL
- [bom_extraction_engine/engine.py](../../samplepcb-parts-engine/packages/bom-extraction-engine/src/bom_extraction_engine/engine.py) — `PARSER_VERSION`
- [AGENTS.md (루트)](../../AGENTS.md) — 호칭 표의 sp-engine + **BOM 역할 경계** 절
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — 유형별 로컬 카탈로그 우선 조회·fallback 4단계·역할 경계
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 견적 파이프라인에서의 엔진 위치·비용 게이트·provenance
- [docs/prompts/sp-engine-candidate-decision.md](../../docs/prompts/sp-engine-candidate-decision.md) — 후보 판단 단일화 계약·불변식·필수 테스트
