# samplepcb-parts-engine (sp-engine)

PCB 부품 **BOM 추출 + 공급사 검색** Python 엔진. `samplepcb-web-platform` 단일 repo의
형제 서브폴더이며(폴리글랏 우산: `samplepcb-web/`=PHP, `samplepcb-web-mono-app/`=Vue+Node,
`samplepcb-parts-engine/`=Python), nginx `/engine` 프록시 + sp-node 게이트웨이로 합류한다.

## 출처

`sp-smartbom-eye/bom_probing_web`의 실험용 웹앱에서 **두 엔진을 프로덕션으로 이식**한 것.
실험용 스캐폴딩(멀티에이전트 소유규칙, `/g` local_fusion·`/c` verify, editable 연구 의존)은 버림.

- `packages/bom-extraction-engine/` — 구 `smartbom_engine` (bom_probing_claude 규칙 파이프라인).
  스프레드시트 → 헤더 탐지 → 열 역할 분류 → 행별 구조화 컴포넌트(출처·근거셀·confidence·정규화). 100% 규칙, 네트워크 없음.
- `packages/supplier-search-engine/` — `search_probing_gpt` 계보 동기화 이식본. 공급사 API(Mouser/Digikey/UniKeyIC)
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
# → http://127.0.0.1:8400/health, /capabilities, /jobs, /docs (Swagger)
```

`.env`(공급사 키)는 `main.py`가 `load_dotenv()`로 자동 로드한다. BOM 추출은 키 불요,
공급사 검색만 Mouser/DigiKey/UniKeyIC 키 필요.

포트 8400 기본값 주의: Windows 개발기에서 8100 대는 Hyper-V/WSL 예약 범위(8089–8188)에
걸릴 수 있어 8400 을 기본으로 쓴다. 예약 범위는 `netsh interface ipv4 show excludedportrange
protocol=tcp` 로 확인. 다른 포트를 쓰면 sp-node 의 `BOM_ENGINE_URL` 도 맞춰야 한다.

공급사 검색은 `.env`(=`.env.example` 복사)에 자격증명 필요. 추출 엔진은 자격증명 불필요.

`GET /capabilities`는 sp-node 관리자 화면용 읽기 전용 운영 계약이다. 작업별 실제 안전 상한
(`SUPPLIER_MAX_CALLS`), 공급사별 자격증명 설정 여부, 캐시 모드·항목 수·TTL만 반환하며 API 키와
캐시 파일 경로는 반환하지 않는다. 이 값은 관리자 업무 한도를 대체하지 않고, sp-node가 둘 중
작은 값을 실효 한도로 설명하고 잘못된 상향 설정을 차단하는 데 사용한다.

### 관계 기반 BOM 추출

헤더 이름이 잘못됐거나 `Value`처럼 의미가 뒤바뀐 열은 참조번호 개수와 수량의 반복 일치 관계로
복구한다. 이 관계는 별도의 부품값·패키지·종류 근거가 함께 있을 때만 사용해 일반 표의 오탐을
피한다. Protel의 `PCB DECAL`은 원시 footprint로 보존하고 검증 가능한 패키지만 검색 조건으로
승격한다. `C2012_0.47uF` 같은 복합 표기는 부품 종류·전기값·패키지로 분리한다. 추출 결과에는
DNP·DNI·미삽 행과 OPEN PCB 테스트패드를 감사 목적으로 남기되, 공급사 검색 입력에서는 제외한다.
`R23,24,25`처럼 접두어가 생략된 참조번호는 허용 목록 안에서만 복원하고, 품번 열의 수동소자
혼합 스펙은 전기값·허용오차·패키지로 분리해 identity 검색을 막는다. 부품 유형·참조번호·수량
근거가 충돌하면 자동 은폐하지 않고 검토 플래그로 보존한다. 시트 전체의 반복 패턴으로 제목·푸터·
다중 헤더와 짧은 품번을 판정하며, 수량 0은 DNP로 취급하고 `total:` 같은 합계 행은 부품에서 제외한다.

값·패키지·풋프린트·설명의 독립 원본이 충돌하면 `input_alternatives`에 셀·역할·정규값 계보를 모두
남긴다. 참조번호 개수와 선언 수량이 다르면 `quantity_resolution=conflict`와
`procurement_disposition=quantity_confirmation_required`로 기술 검색은 허용하되 자동 구매 추천은
막는다. Ferrite bead의 임피던스·측정 주파수·DCR, 인덕터 절대 공차, LED 색상, 커넥터 핀/열/피치,
부품 몸체 치수도 일반 저항값·백분율·패키지와 구분해 구조화한다.

추출 계약 1.2는 커넥터의 명시적 핀·배열·피치 문법과 일반 몸체 치수를 분리하고, `NC`·DNP 표기를
부품 식별값에서 제거하되 품번 접미나 부분 지시자 표기를 행 전체 제외 근거로 오인하지 않는다. 실제
BOM MPN은 CAD library reference보다 우선하며 서로 다른 유효값은 `part_number`·`library_reference`
원본 대안으로 남긴다. `kR`·`MR`·`mR`, 접두 패키지, 인덕터 중복 EIA 값과 LED 색상 약어도 부품
문맥 안에서만 정규화한다.

### 품번 미검색 시 스펙 재검색

품번이 있는 `identity`/`hybrid` 질의에서 신뢰할 수 있는 동일 품번 후보를 찾지 못하면,
엔진은 BOM에서 확정(`hard`)된 스펙으로 `parametric` 질의를 만들어 한 번 더 검색한다.
일반 무품번 검색은 hard spec 두 개가 필요하지만, 이 2차 검색은 저항값·커패시턴스·인덕턴스·
주파수처럼 부품 종류별 핵심 전기값이 확정되면 한 개로도 허용한다.

- 최초 품번 질의·공급사 응답은 `initial_query`·`initial_supplier_results`에 보존하고,
  최종 `query`·`supplier_results`에는 스펙 검색 결과를 둔다.
- 품번 없는 저항·커패시터·인덕터·크리스털 스펙 검색은 DigiKey·Mouser와 UniKeyIC를 사용한다.
  UniKeyIC는 전체 스펙 검색에서 검증 후보가 없을 때 핵심 스펙으로 한 번 더 검색한다.
- 검색 계약 1.2는 추출 엔진의 정규화 수치값과 원본 대안 계보를 검색 계획에 직접 전달한다. 충돌한
  값·패키지는 제한된 독립 분기로 검색하되 분기 근거를 합쳐 자동 검증하지 않고, 모든 충돌 분기 후보는
  검토 대상으로 유지한다. 공급사별 실제 검색어는
  DigiKey의 영문 단위 파서와 Mouser·UniKeyIC 특성에 맞게 생성하고 캐시 키에도 포함한다.
- 수동소자 패키지 약어와 전해콘덴서의 기구 치수를 문맥으로 구분하고, 다중 제조사 표기는 검색
  제한에서 제외한다. 다이오드는 순방향 전압보다 역방향·항복 전압을 우선한다.
- preflight는 조건부 2차 검색의 예상·최악 호출량까지 선반영해 잡 호출 한도를 과소 계산하지 않는다.
- FastAPI 집계는 최초·최종 검색의 API 호출·캐시·시간을 모두 합산하되, 배치에서 공유한 동일
  공급사 질의는 한 번만 계산한다.

동기화 기준: `sp-smartbom-eye` `af06f4d`(`BOM 전수 분석 기반 범용 추출 규칙 보강`, 직전
`ce758d6` 입력 충돌 계보와 범용 검색 분기 정책 완성 포함).
대상 프로젝트 고유 기능(이미지·UniKeyIC 패키징 정규화·선택 시트·영속 공급사 잡)은 유지했다.

### 기술 순위와 구매 적용 후보

공급사 검색 스키마 1.7과 `supplier-selection-application-v2`는 기술 판단과 실제 구매 적용을
분리한다. 엔진은 기존 `preselect`와 기술/검토 순위를 감사 근거로 보존한다. 기술 1순위 후보군에
현재 필요수량을 충족하는 재고·유효 가격 오퍼가 없으면, 차단되지 않은 다음 기술 후보군 중
구매 가능한 그룹을 `application_candidate_identity_key`와
`application_candidate_evidence_key`로 지정한다. 선택한 그룹 안에서는 MOQ·주문배수·재고·
실효 총액을 반영한 구매적합 1위 오퍼를 적용하며, 안전성·기술 근거가 동급인 차순위 그룹끼리는
실효 총액이 낮은 그룹을 우선한다.

`supplier-candidate-decision-v3`부터 제조사 품번이 정확히 일치하면 필수조건 불일치 내역과
세부 평가를 그대로 보존하면서 자동 선정한다. 불일치는 화면 검증 정보로 계속 노출하되 검토 확인을
요구하지 않는다. 포장 접미사 등 품번 변형과 파라메트릭 후보의 조건 불일치는 기존처럼 차단한다.
저장된 v1·v2 후보는 무호출 조달 재평가에서 계속 지원한다.

`technical_fallback_used=true`는 기술 1순위와 적용 후보가 다름을 뜻한다. 응용 계층은 이 결정을
재정렬하지 않고 키·수량·금액 불변식만 검증해 저장하며, 수량·환율 변경 시 엔진의 무호출 재평가
API로 같은 정책을 다시 적용한다.

후보를 적용하지 못하면 `supplier-procurement-unavailability-v1`의
`primary_unavailability_reason`으로 대표 구매 불가 사유를 함께 반환한다. 차단되지 않은 후보 오퍼가
모두 재고 0이면 `out_of_stock`, 재고가 양수지만 필요수량보다 작으면 `insufficient_stock`을 가격·기술
불가보다 우선한다. 재고를 확인할 수 없으면 `stock_unverified`, 재고 가능한 오퍼가 있으나 기술 조건으로
막히면 `technical_unavailable`이다. 필수조건 불일치가 함께 있더라도 모든 관련 오퍼의 재고가 부족하면
화면의 대표 상태는 재고 사유이며, 항목별 기술 불일치 근거는 후보 결정에 그대로 남는다.

후보 수는 공급사 응답 순서로 먼저 자르지 않는다. 모든 응답을 정규화·기술 판정한 뒤 공급사마다
상위 5개 `identity_key`+`technical_evidence_key` 그룹의 합집합만 조달 판단에 사용한다. 합집합에 든
동일 부품은 다른 공급사의 오퍼도 함께 보존하므로 가격 비교 근거가 사라지지 않는다. 원본 응답 건수는
`search_trace`에 남고, 입력 충돌 분기를 합친 뒤에도 같은 상한을 다시 적용한다.

검색 스키마 1.6의 신규 오퍼는 `supplier-offer-key-v2`를 사용한다. 공급사 SKU의 점·하이픈은
부품 값을 구분하는 식별 정보이므로 제거하지 않는다. 저장된 충돌 없는 v1 오퍼는 무호출 재평가에서
v1 키를 그대로 보존한다. 동일 키의 오퍼가 반복되면 구매 안전 관련 데이터가 완전히 같은 경우만
결정적으로 하나로 병합하고, 가격·재고·MOQ·제품·기술 근거가 다르면 fail-closed로 격리한다.
`N/A`·`null`·`unknown` 같은 공급사 placeholder 식별자는 유효한 오퍼 키로 취급하지 않는다.

검색 스키마 1.5부터 각 컴포넌트의 `search_trace`가 실제 공급사 검색어와 논리적 시도 순서를
`supplier-search-trace-v1` 계약으로 반환한다. 품번→키워드·품번→스펙·전체 스펙→핵심 스펙
전환 사유와 캐시/API 출처를 포함하되 URL·인증 헤더·자격증명·원본 요청 본문은 기록하지 않는다.

## 마이그레이션 원칙

**패리티 우선 → 리팩토링 나중.** 이식은 변경 계보 대조 + 테스트 그린으로 동작 동일성을 먼저 증명했고
(현재 416 passed, 1 skipped), 리팩토링은 그린을 유지하며 단계적으로. 엔진 로직은 "다시 쓰는 코드"가 아니라
"연구 계보에서 re-sync 하는 vendored 코드"로 취급 — 리팩토링 에너지는 신규 `app/` 계층에 집중한다.

## 계약 식별자 보존

결과의 `"engine": "smartbom"`, `parser_version="smartbom-rules/1.5"` 등 식별자는 프론트/저장 호환을 위해
당장 보존한다(패키지명만 bom-extraction-engine 으로 변경). 정리는 이후 별도 결정.
