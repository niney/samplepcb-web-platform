# samplepcb-parts-engine (sp-engine)

PCB 부품 **BOM 추출 + 공급사 검색** Python 엔진. `samplepcb-web-platform` 단일 repo의
형제 서브폴더이며(폴리글랏 우산: `samplepcb-web/`=PHP, `samplepcb-web-mono-app/`=Vue+Node,
`samplepcb-parts-engine/`=Python), nginx `/engine` 프록시 + sp-node 게이트웨이로 합류한다.

## 출처

`sp-smartbom-eye/bom_probing_web`의 실험용 웹앱에서 **두 엔진을 프로덕션으로 이식**한 것.
실험용 스캐폴딩(멀티에이전트 소유규칙, `/g` local_fusion·`/c` verify, editable 연구 의존)은 버림.

- `packages/bom-extraction-engine/` — 구 `smartbom_engine` (bom_probing_claude 규칙 파이프라인).
  스프레드시트 → 헤더 탐지 → 열 역할 분류 → 행별 구조화 컴포넌트(출처·근거셀·confidence·정규화). 100% 규칙, 네트워크 없음.
- `packages/supplier-search-engine/` — `search_probing_gpt` 이식본(verbatim). 공급사 API(Mouser/Digikey/UniKeyIC)
  검색 → 공통 모델 정규화 + 매칭, SQLite 캐시·쿼터. httpx+pydantic 만 의존. **연구 계보 재-sync 대상 → 리팩토링은 seam에 국한.**

## 구조

```
samplepcb-parts-engine/          ← uv workspace 루트 (aggregator, 비패키지)
├── pyproject.toml
├── packages/
│   ├── bom-extraction-engine/   (module: bom_extraction_engine)
│   └── supplier-search-engine/  (module: supplier_search_engine)
└── app/                         ← Phase 2: FastAPI 오케스트레이션 (예정)
```

## 개발

```bash
uv sync            # 워크스페이스 전체 설치(공유 .venv)
uv run pytest      # 파리티 테스트 (bom·supplier·app)
uv run ruff check

# 엔진 서버 실행 — 스크립트 (uv 확인 + .env 부트스트랩 + uv sync + uvicorn)
./run.sh                      # macOS / Linux  (포트 인자: ./run.sh 8500)
.\run.ps1                     # Windows PowerShell  (.\run.ps1 -Port 8500)

# 또는 직접
uv run uvicorn parts_engine_app.main:app --host 127.0.0.1 --port 8400 --reload
# → http://127.0.0.1:8400/health, /jobs, /docs (Swagger)
```

`.env`(공급사 키)는 `main.py`가 `load_dotenv()`로 자동 로드한다. BOM 추출은 키 불요,
공급사 검색만 Mouser/DigiKey/UniKeyIC 키 필요.

포트 8400 기본값 주의: Windows 개발기에서 8100 대는 Hyper-V/WSL 예약 범위(8089–8188)에
걸릴 수 있어 8400 을 기본으로 쓴다. 예약 범위는 `netsh interface ipv4 show excludedportrange
protocol=tcp` 로 확인. 다른 포트를 쓰면 sp-node 의 `BOM_ENGINE_URL` 도 맞춰야 한다.

공급사 검색은 `.env`(=`.env.example` 복사)에 자격증명 필요. 추출 엔진은 자격증명 불필요.

## 마이그레이션 원칙

**패리티 우선 → 리팩토링 나중.** 이식은 무변경 복사 + 테스트 그린으로 동작 동일성을 먼저 증명했고
(현재 171 passed), 리팩토링은 그린을 유지하며 단계적으로. 엔진 로직은 "다시 쓰는 코드"가 아니라
"연구 계보에서 re-sync 하는 vendored 코드"로 취급 — 리팩토링 에너지는 신규 `app/` 계층에 집중한다.

## 계약 식별자 보존

결과의 `"engine": "smartbom"`, `parser_version="smartbom-rules/1.0"` 등 식별자는 프론트/저장 호환을 위해
당장 보존한다(패키지명만 bom-extraction-engine 으로 변경). 정리는 이후 별도 결정.
