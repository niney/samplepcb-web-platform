---
topic: parts-engine
last_compiled: 2026-07-20
sources_count: 6
status: active
---

# parts-engine

## Purpose [coverage: high — 5 sources]

`samplepcb-parts-engine/`(별칭 **sp-engine**)은 PCB 부품 **BOM 추출 + 공급사 검색**을 담당하는 Python 엔진이다. `samplepcb-web-platform` 단일 repo의 형제 서브폴더로, 폴리글랏 우산 구도를 완성한다: `samplepcb-web/`=PHP, `samplepcb-web-mono-app/`=Vue+Node, `samplepcb-parts-engine/`=**Python**. nginx `/engine` 프록시 + sp-node 게이트웨이로 플랫폼에 합류한다.

출처는 `sp-smartbom-eye/bom_probing_web` 실험용 웹앱 — 거기서 **두 엔진을 프로덕션으로 이식**한 것이다. 실험용 스캐폴딩(멀티에이전트 소유규칙, `/g` local_fusion·`/c` verify, editable 연구 의존)은 버렸다.

## Architecture [coverage: high — 5 sources]

**uv workspace** (루트는 aggregator, `[tool.uv] package = false` 비패키지). `requires-python >= 3.11`, 공유 `.venv` 하나(`uv sync`). 멤버는 `packages/*` + `app`:

| 워크스페이스 | 패키지명 (모듈) | 성격 |
|---|---|---|
| `packages/bom-extraction-engine/` | `bom-extraction-engine` (`bom_extraction_engine`) | 구 `smartbom_engine`(bom_probing_claude 규칙 파이프라인). 스프레드시트(xlsx/csv) → 헤더 탐지(fusion) → 열 역할 분류 → 행별 구조화 컴포넌트(출처·근거셀·confidence·정규화 수치). **100% 규칙 기반, LLM/네트워크 없음** |
| `packages/supplier-search-engine/` | `supplier-search-engine` (`supplier_search_engine`) | `search_probing_gpt` 이식본(**verbatim**). 공급사 API(Mouser/DigiKey/UniKeyIC) 검색 → 공통 모델 정규화 + 매칭. SQLite 캐시·쿼터(예산)·singleflight·레인 세마포어. 의존은 httpx+pydantic 뿐 |
| `app/` | `parts-engine-app` (`parts_engine_app`) | Phase 2 신규 — FastAPI 오케스트레이션(BOM 추출 + 공급사 검색 잡 API). `src/parts_engine_app/`에 `main.py`·`routes.py`·`jobs.py`·`refresh.py`·`config.py` 존재, `tests/test_app.py` 포함 |

- 의존성 대비: 추출 엔진은 pandas·openpyxl·python-calamine·xlrd·rapidfuzz·model2vec·scikit-learn·joblib 등 두터운 편, 검색 엔진은 httpx+pydantic 최소, app은 fastapi+uvicorn+python-multipart+python-dotenv.
- 테스트: 루트 pytest가 세 워크스페이스 `tests/`를 한꺼번에 수집(`asyncio_mode = "auto"`). 이식 시점 **171 passed**. 추출 쪽은 parity/rules/values/adapter, 검색 쪽은 cache_budget·planner_matcher·preflight·normalizers 등 9개 파일.
- 실행 스크립트 `run.sh` / `run.ps1` (uv 확인 + `.env` 부트스트랩 + `uv sync` + uvicorn, 포트 인자 지원).

## Talks To [coverage: medium — 3 sources]

- **sp-node(Fastify) 게이트웨이**: sp-node가 이 엔진을 HTTP로 호출하는 구도(진행 중). sp-node 측 설정 키는 `BOM_ENGINE_URL` — 엔진 포트를 바꾸면 이 값도 맞춰야 한다.
- **nginx `/engine` 프록시**: 같은 도메인 합류 경로 (README 명시).
- **외부 공급사 API** (supplier-search-engine만): Mouser(`api.mouser.com`, API key), DigiKey(`api.digikey.com`, OAuth2 client_credentials — client id/secret/account id/token URL), UniKeyIC(API key + base URL). 동시 호출 수는 `SEARCH_SUPPLIER_CONCURRENCY`(기본 4). BOM 추출은 네트워크·자격증명 모두 불필요.

## API Surface [coverage: medium — 2 sources]

- 서버: `uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port 8400 --reload` (또는 `./run.sh` / `.\run.ps1 -Port ...`).
- 엔드포인트(README 확인분): `/health`, `/jobs`, `/docs`(Swagger). app pyproject 설명대로 "BOM 추출 + 공급사 검색 **잡 API**" — 게이트웨이의 HTTP async job 호출 대상.
- 결과 계약 식별자는 이식 전 것을 보존: `"engine": "smartbom"`, `parser_version="smartbom-rules/1.0"` (프론트/저장 호환 목적, 패키지명만 변경).

## Data [coverage: medium — 3 sources]

- **자격증명**: `.env`(`.env.example` 복사, `.gitignore` 등록)에 공급사 키 — 백엔드 전용, 브라우저 전달 금지. `main.py`가 `load_dotenv()`로 자동 로드.
- **캐시**: supplier-search-engine이 SQLite 캐시 + 쿼터(예산) 관리 (pyproject 헤더 명시). 루트에 `data/` 디렉터리 존재.
- DB(Prisma/그누보드)와는 직접 연결 없음 — 파일 업로드(python-multipart) 입력, JSON 구조화 출력 형태.

## Key Decisions [coverage: medium — 3 sources]

- **2026-07-18 — 패리티 우선, 리팩토링 나중**: 무변경 복사 + 테스트 그린(171 passed)으로 동작 동일성부터 증명. 엔진 로직은 "다시 쓰는 코드"가 아니라 **연구 계보에서 re-sync 하는 vendored 코드**로 취급 — 리팩토링 에너지는 신규 `app/` 계층에 집중.
- **2026-07-18 — supplier-search-engine은 verbatim 이식**: 연구 계보 재-sync 대상이므로 리팩토링은 seam(설정 주입)에 국한, 로직 보존.
- **2026-07-18 — 계약 식별자 보존**: `"engine":"smartbom"` 등은 당장 유지, 정리는 이후 별도 결정.
- **2026-07-18 — 기본 포트 8400**: Windows Hyper-V/WSL 예약 범위(8089–8188) 회피 (아래 Gotchas).
- **2026-07-18 — uv workspace + 비패키지 루트**: 루트는 aggregator일 뿐 배포 패키지가 아님(`package = false`), 세 멤버는 hatchling 빌드.

## Gotchas [coverage: medium — 2 sources]

- **포트 8100 → 8400 함정**: app pyproject 헤더 주석의 예시는 `--port 8100`이지만, Windows 개발기에서 8100번대는 Hyper-V/WSL 예약 범위(8089–8188)에 걸릴 수 있어 **기본 8400**을 쓴다. 예약 범위 확인: `netsh interface ipv4 show excludedportrange protocol=tcp`. 포트 변경 시 sp-node `BOM_ENGINE_URL` 동기화 필수.
- **README 내부 표기 혼재**: 구조 다이어그램에는 `app/ ← Phase 2 (예정)`으로 남아 있으나, 개발 섹션·디렉터리 실태(`main.py` 등 5개 모듈 + 테스트)는 FastAPI app이 이미 존재·실행 가능함을 보여준다. "예정" 표기는 갱신 지연으로 보인다.
- **공급사 키는 백엔드 전용**: `.env.example` 첫 줄 경고 — 브라우저로 전달 금지. 추출 엔진은 키 자체가 불필요하므로, 키 없이도 BOM 추출 경로는 동작한다.
- **연구 계보 re-sync 전제**: supplier-search-engine을 자유롭게 리팩토링하면 원본(sp-smartbom-eye)과의 재동기화가 깨진다 — 수정은 seam에만.

## Sources [coverage: high — 6 sources]

- [samplepcb-parts-engine/README.md](../../samplepcb-parts-engine/README.md) — 정본 (2026-07-18)
- [samplepcb-parts-engine/pyproject.toml](../../samplepcb-parts-engine/pyproject.toml) — uv workspace 루트
- [samplepcb-parts-engine/app/pyproject.toml](../../samplepcb-parts-engine/app/pyproject.toml) — parts-engine-app
- [samplepcb-parts-engine/packages/bom-extraction-engine/pyproject.toml](../../samplepcb-parts-engine/packages/bom-extraction-engine/pyproject.toml)
- [samplepcb-parts-engine/packages/supplier-search-engine/pyproject.toml](../../samplepcb-parts-engine/packages/supplier-search-engine/pyproject.toml)
- [samplepcb-parts-engine/.env.example](../../samplepcb-parts-engine/.env.example) — 공급사 자격증명 스키마
