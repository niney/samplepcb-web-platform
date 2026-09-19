---
topic: parts-engine
last_compiled: 2026-09-19
sources_count: 36
status: active
---

# parts-engine

## Purpose [coverage: high — 8 sources]

소스 범위는 2026-07-18(이식 커밋)부터 2026-09-18([BOM_QUOTE](../../docs/BOM_QUOTE.md) 최종 갱신)까지, 엔진 코드 자체의 마지막 변경은 2026-09-14다. **최근 합의(2026-08-19~09-14)**는 "엔진의 입구를 넓히되 판단은 여전히 엔진 안에서만"이다 — 두 번째 추출 프로필(`inventory`), 로컬 소스 주입(`local_products`), 강제 라이브(`force_live`), 조회 identity 덮어쓰기(`identity_overrides`)가 모두 **옵션·입력 통로**로만 추가됐고, 후보 판정·조달 판정 경로는 하나다. **이전 패턴(2026-07-18~07-27)**은 패리티 이식과 판단 계약 단일화였다. 2026-07-27 컴파일 이후 엔진 커밋 18건(파일 변경 횟수: 검색 src 35·추출 src 12·app src 9) 중 엔진만 고친 커밋은 2건(07-27 핀헤더 정밀화·08-21 다단 헤더)이고 나머지 16건은 sp-node·sp-vue와 한 커밋에 묶였다 — 엔진 변경은 거의 항상 소비자 계약 변경을 동반한다.

`samplepcb-parts-engine/`(별칭 **sp-engine**)은 PCB 부품 **BOM 추출 + 공급사 검색**을 담당하는 Python 엔진이다. `samplepcb-web-platform` 단일 repo의 형제 서브폴더로 폴리글랏 우산을 완성한다: `samplepcb-web/`=PHP, `samplepcb-web-mono-app/`=Vue+Node, `samplepcb-parts-engine/`=**Python**. 출처는 `sp-smartbom-eye/bom_probing_web` 실험용 웹앱이며, 2026-08-23부터는 협력사 재고표까지 읽는 **두 번째 입력 프로필**을 가진다([PARTNER_PARTS](../../docs/PARTNER_PARTS.md)).

**역할 경계(2026-07-21 [AGENTS.md](../../AGENTS.md) 신설 절, 2026-09-05 개정본에도 그대로)** — 계산 서비스가 아니라 **판단의 단일 원본**이다([judgment-single-owner](../concepts/judgment-single-owner.md)):

- sp-engine이 **BOM 추출·정규화·검색·호환성 판단의 원본**이며, 같은 판단을 sp-node·sp-vue에 중복 구현하지 않는다.
- sp-node는 sp-engine과 프런트 사이의 **계약·저장·업무 정책 경계**다. 가격·환율·재고·MOQ·주문배수·견적 상태·권한은 sp-node 책임이되, **엔진이 기술적으로 허용한 후보 안에서만** 구매 조건을 계산한다.
- **sp-engine ↔ sp-vue 직접 연결 금지.** sp-vue는 `selection_eligibility`·`reason_codes`·`search_scope`·수명주기 상태를 *표시*할 뿐 재판정하지 않는다.
- 필요한 판단이 엔진에 없으면 응용 계층에서 추측하지 말고, 엔진 수정 필요성을 사용자에게 알린 뒤 **엔진부터 고친다**. 2026-08-04 `search_scope`(Any Vendor 근거)·2026-09-14 수량 누락 상태가 이 규칙의 실제 사례다 — 화면이 필요로 한 구분을 엔진 필드로 먼저 만들었다.

## Architecture [coverage: high — 10 sources]

**uv workspace** (루트는 aggregator, `[tool.uv] package = false`). `requires-python >= 3.11`, 공유 `.venv` 하나(`uv sync`). 멤버는 `packages/*` + `app`:

| 워크스페이스 | 모듈 | 성격 |
|---|---|---|
| `packages/bom-extraction-engine/` | `bom_extraction_engine` | 구 `smartbom_engine`. 스프레드시트(xlsx/xlsm/xls/csv/tsv/`.BOM`) → 헤더 탐지(`fusion`·`workbook`) → 열 역할 분류(`field_lexicon`·`row_features`) → 행별 구조화(`rule_extractor`·`adapter`). **100% 규칙 기반, LLM/네트워크 없음**. 2026-08-23 신설 `inventory.py` = 협력사 재고표 프로필(별도 파이프라인), `bom_loader.py` = 두 프로필 공용 로더 |
| `packages/supplier-search-engine/` | `supplier_search_engine` | 공급사 API 검색 → 정규화 → **기술 판정·조달 판정**. `planner`·`supplier_query`·`suppliers/{digikey,mouser,unikeyic}`·`normalizer`/`normalization`·`matcher`·`physical`·`connector`(2026-07-27 핀헤더 계열)·`procurement`·`preflight`·`contract`·`service`(오케스트레이션·소스 순위·대체 폴백)·`cache`/`request_cache`/`budget`/`singleflight`/`routing`/`pricing`/`settings` |
| `app/` | `parts_engine_app` | FastAPI 오케스트레이션. `main`·`routes`·`jobs`(인메모리 잡 레지스트리 + ThreadPoolExecutor 4)·`refresh`(단건/배치 강제 라이브·카탈로그 보강)·`capabilities`·`config` |

- **두 추출 프로필은 모드 플래그가 아니라 모듈 분리**: BOM 추출기는 단가·재고·stock 열을 `_IGNORE_PAT`로 명시 폐기하고 재고 시트를 fail-closed 기각하는데, 재고표는 정확히 그 반대의 표라 같은 파이프라인에 분기를 넣으면 회귀 위험만 커진다(`inventory.py` 머리말, 2026-08-23). `inventory-rules/1.0`은 무유실(`part_number_raw`·`raw_fields`·`flags`)·판단 최소·`role_overrides` 재실행이 원칙이다.
- **로컬 회귀 코퍼스(2026-08-21)**: `local-corpus/bom-extraction/`에 실제 고객 BOM을 SHA-256 단위로 보관한다(`workbooks/`·`manifest.local.json`·`reports/`는 Git 제외, [corpus README](../../samplepcb-parts-engine/local-corpus/bom-extraction/README.md)·[manifest.example.json](../../samplepcb-parts-engine/local-corpus/bom-extraction/manifest.example.json)만 추적). `scripts/verify-bom-extraction-corpus.py --check headers|extraction|all`이 시트 단위 정답(헤더 블록·anchor 허용 행·component 첫 행·금지 행·기대 열)을 검사하며, **정답은 엔진 결과를 보기 전에 원본 셀로 작성**한다(runner는 엔진 출력에서 기대값을 절대 유도하지 않는다). 08-21 실측 206파일·350시트·0이슈, 사람 확인 헤더 정답 111/111. 새 실파일 패턴은 개인정보를 뺀 합성 테스트로도 `tests/`에 고정한다.
- 의존성 대비: 추출 엔진은 pandas·openpyxl·python-calamine·xlrd·rapidfuzz·model2vec·scikit-learn 등 두터운 편, 검색 엔진은 httpx+pydantic 최소, app은 fastapi+uvicorn+python-multipart+python-dotenv.
- 테스트: 루트 pytest가 세 워크스페이스 `tests/`를 한꺼번에 수집(`asyncio_mode = "auto"`). 이식 시점 171 → 07-27 537 → **2026-09-19 수집 기준 640건 / 29파일**(08-24 커밋 메시지 627, 09-14 추출 패키지만 179). 검색 엔진 15본·추출 10본·app 4본.
- 실행 스크립트 `run.sh` / `run.ps1`(uv 확인 + `.env` 부트스트랩 + `uv sync` + uvicorn, 포트 인자 지원).

## Talks To [coverage: high — 9 sources]

- **sp-node(Fastify) 게이트웨이 — 유일한 소비자**([sp-node-api](sp-node-api.md)). `apps/api/src/lib/engine-client.ts`가 `BOM_ENGINE_URL`(기본 `http://127.0.0.1:8400`)·`BOM_ENGINE_TIMEOUT_MS`(기본 120,000)로 호출하며, 소비 지점은 14파일(bom-engine-jobs·bom-local-catalog·bom-quote·bom-search-requirements·bom-supplier-operations·partner-parts·bom-case-delete·admin-parts·bom·bom-quotes·admin-bom-rfqs + 스크립트 import-parts-catalog·refresh-catalog-prices). 엔진은 **무인증 사설 서비스**라 인증·일일 한도·계약 경계는 sp-node가 소유한다. sp-node는 엔진 결정을 재정렬하지 않고 키·수량·금액 불변식만 검증해 저장하며, `decision`이 없는 후보는 자체 규칙으로 복구하지 않고 차단한다.
- **nginx location 없음.** README 머리말의 "nginx `/engine` 프록시" 문구와 달리 로컬·운영 nginx 어디에도 `/engine`은 없다 — 운영 설정 주석대로 "sp-engine :8400 은 sp-api 가 내부 호출하므로 location 을 만들지 않는다"(dev 호스트는 `sp-engine-dev :8401`). 운영 기동은 `ops/systemd/sp-engine.service`(`uv run --no-sync uvicorn … --host 127.0.0.1 --port 8400`, 127.0.0.1 바인딩 필수)와 루트 `deploy.sh` 케이스 10(`uv sync --frozen` + `systemctl restart sp-engine` + `/health` 확인) — 상세는 [infrastructure](infrastructure.md).
- **외부 공급사 API**(supplier-search-engine만): Mouser(API key), DigiKey(OAuth2 client_credentials, 2026-08-02부터 **Substitutions API**를 재고 부족 시 조건부 1회 추가 호출), UniKeyIC(API key + base URL). 동시 호출 수 `SEARCH_SUPPLIER_CONCURRENCY`(기본 4), 작업 시간 상한 `SEARCH_JOB_TIMEOUT_SECONDS`(기본 60초). BOM 추출은 네트워크·자격증명 모두 불필요.
- **로컬 소스 identity**(외부 호출 아님): `CatalogSupplier` enum — `samplepcb`·`yeonho`·`walsin`·`yageo`·`samsung`·`murata`·`tdk`·`vishay`·`koa` + 2026-08 추가 `eleparts`·`icbanq`·**`partner`**. "never routed as external clients" — DB는 sp-node가 조회하고 엔진은 그 히트를 **판정만** 한다. `partner`는 sp-node가 검색 잡 옵션 `local_products`(키=정규 품번)로 주입하는 협력사 보유 부품([partner-tracks](partner-tracks.md))이며, **exact 품번 질의에만** 붙고 파라메트릭 질의에는 주입하지 않는다(스펙 호환 판정을 협력사 주장에 기대지 않는다).
- **엔진이 관여하지 않는 인접 기능(명시)**: DigiKey/Mouser API 카트 인계(D41)와 ECIA 2D 라벨 바코드 입고 스캔(D42)은 엔진 소스에 흔적이 없다(`cart|barcode|ecia` grep 0건) — 전부 sp-node 몫이다. 2026-09-17~18 단일 검색 "공급사 확인 후 최종 후보 누락 없이 표시"(커밋 `59a232e85`)도 sp-node·sp-vue·api-contract만 바꿨고 엔진 응답 계약은 그대로다.

## API Surface [coverage: high — 6 sources]

- 서버: `uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port 8400 --reload`(또는 `./run.sh` / `.\run.ps1 -Port …`). Swagger `/docs`. 소비자 문서 [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md)의 `502 BOM_ENGINE_UNREACHABLE|BOM_ENGINE_ERROR`·`409 ENGINE_JOB_GONE`이 엔진 장애·잡 소실의 sp-node 측 표현이다.

| 경로 | 용도 |
|---|---|
| `GET /health` · `GET /capabilities` | 헬스체크 · 관리자 화면용 **읽기 전용 운영 계약**(`max_calls_per_job`, 공급사별 자격증명 설정 여부, 캐시 모드·항목 수·TTL. API 키·캐시 경로는 반환하지 않음) |
| `GET /supplier-search/requirements/capabilities` · `POST …/validate` | 부품 유형별 필수·선택·조건부 필드 공개 · DB 저장·공급사 호출 없이 검색 조건만 엔진 정책으로 검증 |
| `POST /supplier-search/catalog-evaluate-batch` | sp-node의 exact 로컬 카탈로그 히트에 엔진 matcher·후보 결정·조달 정책을 그대로 적용(외부 호출 0) |
| `POST /jobs` (202) | 파일 업로드 → 추출 잡. 2026-08-23부터 form 필드 `engine=smartbom\|inventory`와 `inventory_options`(JSON — `role_overrides{sheet:{col:role}}`·`header_row_overrides{sheet:1-based row}`, 역할 12종 화이트리스트) |
| `GET /jobs/{id}` · `GET /jobs/{id}/result` | 잡 상태 · 추출 결과 |
| `DELETE /jobs/{id}` (204) | 2026-08-01 신설 — SmartBOM Case 영구 삭제 전용 수명주기 계약. 완료·실패 잡의 인메모리 결과와 `uploads/` 임시 원본을 함께 삭제. 없는 잡 404(호출부가 멱등 성공 처리), 파싱·검색 실행 중은 취소 불가라 409 |
| `POST /supplier-jobs` (201) | sp-node **영속 분석 스냅샷**을 검색 입력으로 등록(파일 재업로드 없이 재개). body: `analysis`·`required_quantities`·`requirement_overrides`·`requirement_defaults` |
| `POST /jobs/{id}/supplier-search/preflight` | 예상·최악 호출량 사전 계산(조건부 2차 검색 포함) |
| `POST /jobs/{id}/supplier-search` (202) · `GET …` · `GET …/result` | 검색 잡. 옵션: `max_calls`(≤3,000)·`cache_only`·`reset_cache`·**`force_live`**(08-19, 셋 중 하나만)·`sheet_indexes`·`component_ids`(≤5,000)·**`identity_overrides`**(08-21, `component_ids`의 부분집합만)·`passive_defaults`·`procurement`·**`local_products`**(08-23) |
| `POST /supplier-search/procurement/reevaluate` · `/reevaluate-batch` | 저장된 기술 후보에 새 수량·환율만 재적용(**공급사 호출 없음**). 배치 상한 200(초과 422), 행 하나의 실패가 배치를 막지 않음 |
| `POST /parts/refresh` · **`POST /parts/refresh-batch`** · `POST /parts/search` | MPN 1건 강제 라이브(max_calls 기본 25, ≤100) · 카탈로그 사전 가격용 exact MPN 배치(≤100건, max_calls 기본 120 ≤3,000, 공급사 선택, timeout 10~300초 — 소비자는 `refresh-catalog-prices.ts` 스크립트뿐) · 로컬 색인 exact miss 보강(캐시 우선, max_calls 기본 12 ≤25). 셋 다 공급사·네트워크 오류를 502로 정규화 |

## Data [coverage: high — 8 sources]

- **자격증명**: `.env`(`.env.example` 복사, `.gitignore` 등록) — 백엔드 전용, 브라우저 전달 금지. `main.py`가 `load_dotenv()`로 자동 로드.
- **앱 설정(`config.py`, 환경변수)**: `PARTS_ENGINE_DATA_DIR`(기본 `data/` — `uploads/` 임시 원본 + `supplier-search-cache.sqlite3`, 둘 다 gitignore)·`BOM_M2V_PATH`(""=HF 캐시·경로=오프라인·`off`)·`BOM_COMPONENT_LIMIT`(5,000)·**`INVENTORY_ROW_LIMIT`**(50,000 — 재고표는 만 단위가 정상이라 BOM 상한과 별개, 08-23)·`MAX_UPLOAD_BYTES`(60MB)·`SUPPLIER_MAX_CALLS`(3,000 — 공급사 검색 1회당 외부 호출 **안전 상한**, sp-node 관리자 한도와 둘 중 작은 값이 실효).
- **캐시**: SQLite(raw/keyword/stale TTL, `stale_if_error`). `cache_only`·`reset_cache`·`force_live`는 상호 배타. `force_live`는 현재 잡의 **읽기만** 우회하고 성공 응답은 캐시에 기록해 이후 BOM 검색이 재사용한다(`refresh.py` LiveReadCache와 같은 성향).
- **잡 스토어**: 인메모리 `dict` + 스레드풀([in-memory-async-jobs](../concepts/in-memory-async-jobs.md)) — TTL·자동 만료 없음, 비우는 경로는 `DELETE /jobs/{id}`와 프로세스 재시작뿐. 영속은 sp-node 원장(분석 append-only·gzip 아티팩트)이 맡는다.
- **계약 식별자**(소비자 계약이므로 임의 변경 금지, 2026-09-19 코드 현재값): 추출 `parser_version="smartbom-rules/1.12 (hierarchical headers and helper sheets)"`(2026-08: 1.10 → 1.12)·`SCHEMA_VERSION=1.4`·`"engine":"smartbom"`, 재고표 `inventory-rules/1.0`·`INVENTORY_SCHEMA_VERSION=1.0`, 검색 `search_schema_version=1.10`(2026-08: 1.7 → 1.10)·`SEARCH_CONTRACT_VERSION=1.2`, 판정 `supplier-candidate-decision-v3`·`candidate-category-policy-v2`·`candidate-identity-key-v1`·`candidate-evidence-key-v1`·`candidate-selection-recommendation-v1`·**`supplier-selection-application-v4`**(2026-07-29: v3 → v4)·`supplier-procurement-decision-v1`·`supplier-procurement-unavailability-v1`·`supplier-offer-key-v2`(저장 v1 계속 지원)·`supplier-procurement-reevaluation-v1`/`-batch-v1`·`bom-search-requirement-policy-v1`·`bom-user-search-requirements-v2`·`passive-requirement-defaults-v1`·`supplier-search-trace-v1`.
- **2026-08 신설 enum**: `SearchScope`(`part_number`·`manufacturer_spec`·`any_vendor_spec`·`not_searchable`, 컴포넌트 결과가 최종 질의에서 파생), `LifecycleCode`(`nrnd`·`eol`·`discontinued`·`obsolete` + `unknown`), `ReplacementSource`(`digikey_substitution`·`engine_stock_fallback`·`engine_procurement_fallback`·`engine_mpn_fallback`), trace 시도 종류 `stock_alternative`. `CatalogProductMetadata`에 `partner_id`·`partner_stock_qty`·`partner_date_code`·`partner_lead_time`·`partner_uploaded_at`(조직명은 담지 않음).
- DB(Prisma/그누보드)와 직접 연결 없음 — 파일 업로드 또는 JSON 스냅샷 입력, JSON 구조화 출력. `contracts/fixtures/component-record.json`은 sp-node와 공유하는 골든(2026-07-24).

## Key Decisions [coverage: high — 14 sources]

- **2026-09-14 — 기술 사양 개수 열은 구매 수량이 아니다**: `outputs/inputs/channels/circuits/gates/pins/positions/contacts`(+한글 출력·입력·채널·회로·핀·접점 수) 헤더를 `_TECHNICAL_COUNT_PAT`로 수량 분류·참조번호 상관 추론·숫자 내용 추론 **세 곳 모두에서 제외**. 수량 열이 없는 BOM은 기본값 1 대신 `quantityState=missing`으로 내려 sp-vue가 재업로드/행별 직접 입력을 안내한다. 기존 견적 스냅샷은 일괄 수정하지 않고 새 업로드부터 적용.
- **2026-08-24 — 합성 코퍼스는 회귀 방지용이지 발견용이 아니다**: 재고표 병리(헤더 5행 아래·품번의 날짜 변환·앞자리 0 손실·소계 행·중간 머리글·병합 셀·전각·숨긴 열)를 3본에 **섞어** 담았다(실제 파일이 그렇게 오고 겹칠 때가 사고 지점). 그래도 결함 둘을 즉시 잡았다 — `1k`가 1로 읽힘(`_parse_int` k 접미 ×1,000), 소계·재출현 머리글이 검토 표시 없이 부품으로 앉음(영숫자 없는 값은 `mpn_needs_review`, 버리지 않는다).
- **2026-08-23 — 협력사 보유 부품 = 같은 자리·뒤순위 후보(D43)**: 별도 폴백 티어를 만들지 않는다. ① 외부 후보와 **같은 matcher·조달 정책** ② 기술 판정 동률이면 `_source_rank`(실공급사 0·로컬 카탈로그 1·협력사 2 — 알파벳순이면 `partner`가 `unikeyic`을 앞지른다) ③ 외부 호출·캐시·trace 미오염(`api_calls` 0 유지). offers가 없어 자동 선정은 불가, 값은 RFQ 회신이 정본. 같은 날 실검색으로 잡은 결함 둘: 엔진 회신 `catalog_metadata`는 **snake_case**(`partner_id`, 보낼 땐 alias `partnerId`)·대체 폴백 재검색과 병합 재평가에도 `local_products`를 다시 넘겨야 한다(안 넘기면 협력사가 유일한 근거인 희귀 품번에서 정확히 사라진다).
- **2026-08-23 — `inventory` 추출 프로필은 별도 모듈**(위 Architecture). 로더 교정 둘은 BOM 경로에도 이득: 시트 XML 50MB 초과 xlsx는 calamine 우회(openpyxl 17분·1.7GB 미완 → 1.8초), pandas `attrs` deepcopy 함정(`bom_loader._SharedRowWidths`, 12,000행 CSV 84초 → 0.1초).
- **2026-08-21 — 다단 헤더 탐지 + 실파일 코퍼스 게이트**: 단일 기준 행만으로 헤더를 확정하던 것을 인접 보완 헤더 최대 3행·괄호형·공급사 그룹·반복 anchor를 데이터 타입 증거와 보수적 게이트로 판정하도록 바꿨다. 중복검사 매트릭스·Naming Rule 보조표는 비-BOM으로 기권. parser 1.12.
- **2026-08-21 — identity override로 선정 부품 시세 조회**: 회신 비교가 `selectionMode=exact`만 보던 것을 고쳐, 엔진이 안전 선정한 spec-compatible 부품도 sp-node가 확정한 제조사·MPN으로 3사 exact 강제 조회한다. **분석 원본은 불변**, 실행 배치에만 override를 적용하고 결과는 같은 `identityKey`의 구매 조건만 병합해 원본 기술 판정을 보존한다.
- **2026-08-21 — 강한 기판 제작 행은 정체성이 있어도 `pcb_feature`**: `PCB/FPCB` + 층수(`4L`·`6 layers`) 증거가 함께 있으면 `RING_REV01` 같은 보드 리비전 값이 품번 열에 있어도 전자부품으로 승격하지 않는다(실제 RING BOM 11행 오인이 계기).
- **2026-08-19 — `force_live` 모드**: 회신 비교 화면의 3사 최신 시세 확인용. 전역 캐시를 지우지 않고 현재 잡의 읽기만 우회하며 성공 응답은 캐시·후보 원장에 보존. `cache_only`·`reset_cache`와 셋 중 하나만.
- **2026-08-19 — 혼합 조달 실패도 스펙 대체(`engine_procurement_fallback`)**: 2026-08: "재고 부족 단일 사유에서만 대체 검색" → "가격 없음·혼합 재고 실패·환율 누락·과다 MOQ/주문배수까지". 이 경로는 DigiKey Substitutions를 건너뛰고 같은 파라메트릭 검색을 실행하며 `catalog_inquiry`·입력 불완전·기술 차단·허용 공급사 없음은 계속 제외. 저항 사용자 조건에 정격전압 추가(구형 저장 조건은 원본 BOM 전압 복원).
- **2026-08-04 — `search_scope` provenance(검색 스키마 1.10)**: 실제 최종 질의를 네 범위로 명시해 sp-vue가 매칭 점수·문구로 "Any Vendor"를 추측하지 못하게 했다. 품절 원품번 + 스펙 대체가 합쳐진 경우 주 질의는 `part_number`를 유지하고 선정 후보의 `ReplacementSource`로 구분. 직렬화·캐시 복원에서도 같은 범위 유지.
- **2026-08-04 — 재고 부족 대체 후보 3단**: 정확/변형 품번의 전 공급사가 `out_of_stock|insufficient_stock`이면 DigiKey Substitutions 조건부 1회 → 검증 가능한 핵심 스펙이 있으면 파라메트릭 `engine_stock_fallback` → 스펙이 부족하면 구분자 앞 MPN 계열 토큰으로 `engine_mpn_fallback`(같은 계열·같은 제조사만, trace `stock_alternative`). 모두 `confirmation_required=true`의 `provisional_selected`까지만 — 확정 자동 교체는 없다. 다른 공급사가 필요수량을 충족하거나 `stock_unverified`면 실행하지 않는다.
- **2026-08-04 — 용어 통일**: 오퍼 → **구매 조건**, 제조사 카탈로그 레코드 → 원천 정보, SamplePCB 파생 → 문의 견적 채널. 코드 식별자(`offerKey`·`selectedOffer`·`SpPartOffer`)는 유지.
- **2026-08-02 — 공급사 대체품·단종 수명주기 연결**: DigiKey·Mouser 정규화에서 `lifecycle_status`·`discontinued`를 뽑아 `LifecycleCode`로 판정에 싣고, matcher가 후보 결정에 반영.
- **2026-08-01 — 잡 삭제 계약(`DELETE /jobs/{id}`)**: Case 영구 삭제(§6.14)의 엔진 측. 실행 중 스레드는 취소할 수 없으니 409로 거부하고, supplier 시작과의 경합은 같은 상태 락에서 `deleted`를 박제해 고아 작업 생성을 막는다.
- **2026-07-29 — `procurement_mode=sample|mass`와 Reel 우선(`supplier-selection-application-v4`)**: `sample`은 실효 총액 순위 유지, `mass`는 같은 기술 안전 밴드·재고·과다주문 게이트 안에서 명확한 제조사 Reel → Digi-Reel/MouseReel 재포장 → 일반 포장. 혼합 포장 문자열은 Reel로 단정하지 않고 안전한 Reel이 없으면 `mass_production_reel_unavailable` 근거로 축퇴. 기술 사전 선정은 불변.
- **2026-07-27 — 저장된 부품 우선 검색(R/C 실험, [BOM_INGESTED_RC_EXPERIMENT](../../docs/BOM_INGESTED_RC_EXPERIMENT.md))**: MPN 없는 저항·커패시터는 ES에 저장된 공급사 부품을 먼저 보되, 최종 판정은 엔진의 `resistor_minimum`·`capacitor_minimum` 정책 재검증이 `automatic_selected`일 때만 `catalog_selected`. 저장 시점 가격·재고는 판정에 쓰지 않는다. 관리자 토글 `sp_config.bom_quote.storedPartPrioritySearchEnabled`는 실행 시작 시 옵션으로 스냅샷([snapshot-freeze](../concepts/snapshot-freeze.md)).
- **2026-07-27 — 수량 미입력 부품 선(先)선정 후 확인**(`quantity_confirmation_required`로 기술 검색 허용·자동 구매 추천 차단) · **핀헤더 검색 커넥터 계열 정밀화**(`connector.py` 신설, 핀·열·피치 문법).
- **2026-07-26 — 부품 유형별 로컬 카탈로그 우선 조회**: `resistor`·`capacitor`·`connector`로 **엔진이 판정한** 행은 외부보다 자체 카탈로그(R/C=Walsin 2,628건, connector=연호 1,606건)를 먼저 본다. 기준은 공급사명이 아니라 부품 유형. `catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 반영 — 상세 [PARTS_SEARCH](../../docs/PARTS_SEARCH.md).
- **2026-07-26 — 제조사 카탈로그 부품 = 문의 견적**: 가격·재고·MOQ가 없는 원천 정보는 `catalog_selected`로 **identity만** 적용하고 `primary_unavailability_reason=catalog_inquiry`를 함께 반환. 가짜 재고·가격을 만들지 않는다.
- **2026-07-26 — 정확 MPN 우선 자동선정 · 제조사 정보 충돌 판정 폐기 · 스펙 검색 후보 수 축소**: 확정된 부품 유형 충돌만 차단, `manufacturer_source_conflict` 삭제, 스펙 검색은 DigiKey·Mouser 공급사별 10건(UniKeyIC는 전량 판정 후 상위 10그룹), 최종 보존은 공급사별 기술 3 + 가격 2 그룹 합집합.
- **2026-07-25 — 호출 상한 3,000회 · 검색 조건 판정 엔진 일원화(`contract.py`, 9유형) · 부품 유형 추출을 출처별 증거 점수 합의로 일반화.**
- **2026-07-21 — 후보 판단 단일 소유권**(`supplier-candidate-decision-v3`, [sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md)): 후보마다 완결된 `decision`을 반환, 근거 부족은 `blocked`로 축퇴.
- **2026-07-18 — 패리티 우선·리팩토링 나중**(연구 계보 re-sync 대상 vendored 코드, 리팩토링은 `app/`에 집중) · **기본 포트 8400**(Windows Hyper-V/WSL 예약 범위 8089–8188 회피).

## Gotchas [coverage: high — 9 sources]

- **README 머리·구조 절이 뒤처진다**(본문은 2026-08-19까지 갱신됨): "현재 437 passed"(실제 수집 640)·`parser_version="smartbom-rules/1.6"`(실제 `1.12`)·`app/ ← Phase 2 (예정)`(운영 중)·"nginx `/engine` 프록시"(location 없음). 버전·개수는 코드 상수(`engine.py PARSER_VERSION`, `models.py`, `inventory.py`)를 정본으로 볼 것([manual-sync-drift](../concepts/manual-sync-drift.md)).
- **운영 배포 문서가 갈려 있다**: [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md)(2026-09-16 갱신)에는 엔진 절이 **없다** — 구성 표가 nginx·php-fpm·sp-api·mariadb 넷뿐이다. 엔진 운영 정본은 `ops/systemd/sp-engine.service` 머리말(uv 설치 → `uv sync` → `.env` → 유닛 등록 → `/health`) + `deploy.sh` 케이스 10 + `ops/README.md`. 유닛은 `--no-sync`라 배포 스크립트가 sync를 먼저 해야 하고, `TimeoutStopSec=30`은 공급사 타임아웃 대비다.
- **포트 함정**: app pyproject 주석 예시는 `--port 8100`이지만 Windows에서 8100대는 예약 범위에 걸릴 수 있다(`netsh interface ipv4 show excludedportrange protocol=tcp`). 운영은 8400, dev 호스트는 8401. 변경 시 sp-node `BOM_ENGINE_URL` 동기화 필수.
- **엔진 왕복 필드명 비대칭**: pydantic alias로 받는 필드(`partnerId`)는 **필드명(`partner_id`)으로 직렬화**된다. "보낸 이름으로 읽으면 된다"는 가정이 깨져 `matchEvidence.partnerStock`이 조용히 null이 됐다(2026-08-23 실측).
- **로컬 소스는 `supplier_results` 밖에 산다**: 외부 호출·캐시·trace를 오염시키지 않으려는 설계 때문에, 후보를 다시 계산하는 경로(대체 폴백 재검색·병합 재평가)마다 `local_products`를 명시적으로 다시 넘겨야 한다. 안 넘기면 판정 결과가 아니라 후보 자체가 사라진다.
- **pandas `attrs`에 큰 리스트를 넣지 말 것**: 거의 모든 연산이 `__finalize__`로 `attrs`를 deepcopy해 `df.iat` 한 번이 행 수 길이 리스트 복사가 된다(12,000행 CSV 84초). 공유 불변 값이면 `__deepcopy__`가 self를 반환하는 래퍼(`_SharedRowWidths`)로.
- **`resultCount` 의미 혼동**: 화면의 "검색 과정" 건수는 **가공 전 공급사 원응답** 수, 후보 목록 수는 기술 검증·중복 제거·shortlist를 거친 **최종 후보** 수다. 특히 응답 상한이 없는 UniKeyIC.
- **연구 계보 re-sync 전제**: 동기화 기준은 여전히 `sp-smartbom-eye 62d3bab`(README 하단)인데 07-27 이후 검색 엔진 src만 35회 바뀌었다 — 역동기화 갭이 커졌고 seam 밖 수정도 늘었다(service.py 대체 폴백·소스 순위). 재동기화 시 diff 기준을 다시 잡아야 한다.
- **preflight는 차단 게이트가 아니다**: 예상 호출이 한도를 넘어도 검색은 시작하고, 실제 호출 시점의 **원자적 job budget**이 `max_calls`를 강제한다(`job_call_limit_exhausted`).
- **인메모리 잡은 만료되지 않는다**: TTL이 없어 `DELETE /jobs/{id}` 또는 재시작만이 지운다. 반대로 재시작 뒤 결과 GET은 sp-node `ENGINE_JOB_GONE`(재업로드 또는 영속 스냅샷에서 `/supplier-jobs` 재개)로 표면화된다.
- **엔진 결과 원문을 통째로 DB 열에 넣지 말 것**: 재고표 12,175행(6.36MB) `previewJson`이 MySQL 패킷 벽에 부딪혀 `BOM_ENGINE_ERROR`로 위장됐다(2026-08-23). 표본 200행 + 보관 원본 재실행(추출은 결정론적이라 결과가 같다)이 처방이다 — sp-node 측 규칙이지만 엔진 출력 크기를 설계할 때 같이 볼 것.
- **공급사 키는 백엔드 전용**: 추출 엔진은 키가 불필요하므로 키 없이도 BOM 추출 경로는 동작한다.

## Sources [coverage: high — 36 sources]

- [samplepcb-parts-engine/README.md](../../samplepcb-parts-engine/README.md) — 정본(추출/검색 계약·관계 기반 추출·대체 검색·기술 순위와 구매 적용 후보, 2026-08-19)
- [samplepcb-parts-engine/.env.example](../../samplepcb-parts-engine/.env.example) — 자격증명 + `SUPPLIER_MAX_CALLS`
- [local-corpus/bom-extraction/README.md](../../samplepcb-parts-engine/local-corpus/bom-extraction/README.md) — 로컬 회귀 코퍼스 저장·검증·정답 작성 원칙(2026-08-21)
- [local-corpus/bom-extraction/manifest.example.json](../../samplepcb-parts-engine/local-corpus/bom-extraction/manifest.example.json) — manifest v2 스키마
- [samplepcb-parts-engine/pyproject.toml](../../samplepcb-parts-engine/pyproject.toml) — uv workspace 루트·pytest 수집
- [app/pyproject.toml](../../samplepcb-parts-engine/app/pyproject.toml) · [bom-extraction-engine/pyproject.toml](../../samplepcb-parts-engine/packages/bom-extraction-engine/pyproject.toml) · [supplier-search-engine/pyproject.toml](../../samplepcb-parts-engine/packages/supplier-search-engine/pyproject.toml) — 의존성·성격 주석
- [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — 유형별 로컬 카탈로그 우선 조회·fallback 4단계·역할 경계
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 견적 파이프라인에서의 엔진 위치·조달 투영 v13·대체 검색·단일 검색 최종 목록(2026-09-18)
- [docs/BOM_INGESTED_RC_EXPERIMENT.md](../../docs/BOM_INGESTED_RC_EXPERIMENT.md) — 저장 부품 R/C 우선 검색 실험
- [docs/PARTNER_PARTS.md](../../docs/PARTNER_PARTS.md) — `inventory` 프로필·`local_products` 주입·로더 교정 실측
- [docs/BOM_SERVICE_API.md](../../docs/BOM_SERVICE_API.md) — 사내 서비스 API의 엔진 오류 코드
- [docs/prompts/sp-engine-candidate-decision.md](../../docs/prompts/sp-engine-candidate-decision.md) — 후보 판단 단일화 계약
- [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — 운영 런북(엔진 절 부재 확인용)
- [AGENTS.md (루트)](../../AGENTS.md) — 호칭 표의 sp-engine + **BOM 역할 경계** 절
- [ops/README.md](../../ops/README.md) · [ops/systemd/sp-engine.service](../../ops/systemd/sp-engine.service) · [deploy.sh](../../deploy.sh) — 운영 유닛·케이스 10
- [app/src/parts_engine_app/routes.py](../../samplepcb-parts-engine/app/src/parts_engine_app/routes.py) — 엔드포인트·옵션 스키마·상한
- [app/src/parts_engine_app/jobs.py](../../samplepcb-parts-engine/app/src/parts_engine_app/jobs.py) — 인메모리 잡·삭제·두 프로필
- [app/src/parts_engine_app/config.py](../../samplepcb-parts-engine/app/src/parts_engine_app/config.py) · [refresh.py](../../samplepcb-parts-engine/app/src/parts_engine_app/refresh.py) · [capabilities.py](../../samplepcb-parts-engine/app/src/parts_engine_app/capabilities.py)
- [supplier_search_engine/models.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/models.py) — 정책 버전 리터럴·`CatalogSupplier`·`SearchScope`·`LifecycleCode`·`ReplacementSource`
- [supplier_search_engine/contract.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/contract.py) · [service.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/service.py) · [settings.py](../../samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/settings.py)
- [bom_extraction_engine/engine.py](../../samplepcb-parts-engine/packages/bom-extraction-engine/src/bom_extraction_engine/engine.py) · [inventory.py](../../samplepcb-parts-engine/packages/bom-extraction-engine/src/bom_extraction_engine/inventory.py) — `PARSER_VERSION`·재고표 프로필 원칙
- [scripts/verify-bom-extraction-corpus.py](../../samplepcb-parts-engine/scripts/verify-bom-extraction-corpus.py) — 코퍼스 runner
- [tests/test_partner_local_products.py](../../samplepcb-parts-engine/packages/supplier-search-engine/tests/test_partner_local_products.py) · [tests/test_inventory_synthetic_corpus.py](../../samplepcb-parts-engine/packages/bom-extraction-engine/tests/test_inventory_synthetic_corpus.py) — 설계 결정을 담은 테스트 머리말
- [apps/api/src/lib/engine-client.ts](../../samplepcb-web-mono-app/apps/api/src/lib/engine-client.ts) · [apps/api/.env.example](../../samplepcb-web-mono-app/apps/api/.env.example) — 소비자 측 접속 설정
- git log `samplepcb-parts-engine` 2026-07-27~09-14 — 커밋 18건 본문(결정 근거·실측 수치)
