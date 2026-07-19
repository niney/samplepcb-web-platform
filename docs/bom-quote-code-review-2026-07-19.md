# BOM 견적·부품 카탈로그 코드 리뷰 기록

- 검토 기준: `5404af4..851f64408`
- 검토일: 2026-07-19
- 대상: sp-engine, sp-node, sp-vue의 BOM 견적·부품 카탈로그·samplepcb 자체 오퍼
- 상태: 구현 변경 없이 검토 결과만 기록

## 결론

현재 구현은 업로드, 추출, 카탈로그 저장, 공급사 검색, 견적 요청, 관리자 회신까지의 1차 흐름을 갖췄다. 다만 공급사 검색 결과 반영, 견적 데이터 신뢰 경계, 동시 저장, MPN 없는 부품 처리, 회원 ID 길이는 후속 개발 전에 우선 보완해야 한다.

고객 SMART BOM을 sp-vue에 둘지 별도 고객 Vue 앱으로 분리할지, samplepcb 자체 오퍼를 어떤 범위와 상태로 생성할지는 구현 문제가 아니라 플랫폼 정책 결정이 필요하다.

## P1 — 후속 기능 확장 전 보완

### 1. 공급사 검색 완료와 견적 반영 완료가 동기화되지 않음

고객 화면은 엔진의 공급사 검색 상태가 `completed`가 되면 즉시 `catalog-match`를 호출한다. 카탈로그 인제스트는 sp-node의 별도 5초 폴러가 수행하므로 재매칭이 인제스트보다 먼저 실행될 수 있다.

또한 고객 화면은 `onlyUnmatched: true`로 재매칭한다. 이미 `partId`가 있는 라인은 신규 가격·재고가 저장되어도 건너뛰므로, 기존 자동 오퍼나 오퍼가 없던 카탈로그 부품은 검색 결과를 반영하지 못한다.

관련 위치:

- `apps/web/src/pages/bom/BomQuote.vue`: 공급사 상태 감시 및 `catalogMatch.mutateAsync`
- `apps/api/src/lib/bom-engine-jobs.ts`: `startIngestPoller`, `ingestJobResult`
- `apps/api/src/lib/bom-quote.ts`: `catalogMatchItems`

권장 방향:

1. 엔진 결과 조회
2. 카탈로그 인제스트 완료
3. non-pinned 라인 전체 재매칭
4. 견적 재계산 및 저장

위 작업을 sp-node의 단일 명령/API로 묶어 완료 시점을 명확히 한다.

### 2. 고객 입력이 오퍼 스냅샷과 주문수량의 진실원본이 됨

PATCH 계약은 공급사, SKU, 가격구간, 단가, 통화, MOQ, 주문배수, 재고를 포함한 `selectedOffer` 전체를 클라이언트에서 받는다. 서버는 카탈로그 오퍼와 대조하지 않고 제출된 가격구간으로 합계를 다시 계산한다.

`orderQty`도 최소 1만 적용하고 다음 조건을 다시 강제하지 않는다.

- BOM 수량 × 세트/예비 수량
- MOQ
- 주문배수

검토 중 `bomQty=100`, `orderQty=1`, `moq=1000`, `unitPrice=-100`인 입력이 Zod 검증을 통과했고 서버 계산 결과 `lineTotalKrw=-100`이 되는 것을 재현했다. `partId`도 임의 문자열을 허용해 `BigInt(partId)`에서 500 오류가 날 수 있다.

관련 위치:

- `packages/api-contract/src/schemas/bom-quote.ts`: `BomQuoteSelectedOffer`, `BomQuoteItemInput`
- `apps/api/src/lib/bom-quote.ts`: `recalcItems`, `replaceQuoteItems`
- `apps/api/src/routes/bom-quotes.ts`: 고객 PATCH

권장 방향:

- 고객은 `partId`, `offerId` 또는 서버가 발급한 선택 토큰만 제출한다.
- 서버가 DB 오퍼를 조회하여 견적 스냅샷을 생성한다.
- 서버에서 필요수량, MOQ, 주문배수를 다시 적용한다.
- 가격, 수량, 날짜, 식별자에 명시적 범위와 형식 검증을 추가한다.

### 3. 자동저장과 견적요청의 동시성으로 동결 상태가 깨질 수 있음

PATCH와 견적요청이 모두 `draft`를 읽은 뒤 동시에 진행되면 견적요청이 `requested`로 변경된 후 먼저 시작한 PATCH가 라인을 다시 교체할 수 있다. 라인 replace-all과 견적 헤더 합계 갱신도 하나의 트랜잭션이 아니다.

프런트에서도 저장 요청 중 사용자가 다시 편집하면 이전 요청 완료 시 `dirty=false`로 변경하고 서버 응답으로 로컬 편집을 덮어쓸 수 있다. `saveNow()`가 저장 실패를 삼키므로 마지막 저장이 실패해도 견적요청이 계속 진행된다.

관련 위치:

- `apps/api/src/routes/bom-quotes.ts`: `persistComputed`, PATCH, `/request`
- `apps/web/src/pages/bom/BomQuote.vue`: `watch(detail)`, `saveNow`, `submitRequest`

권장 방향:

- 견적에 `version`을 추가한다.
- `id + status=draft + version` 조건부 갱신을 사용한다.
- 라인, 합계, 상태 변경을 하나의 트랜잭션으로 처리한다.
- 프런트 저장을 직렬화하고 저장 중 발생한 추가 변경을 별도 revision으로 유지한다.
- 마지막 저장 실패 시 견적요청을 중단한다.

### 4. MPN 없는 부품이 누락되고 0건 결과를 완료 상태로 표현할 수 없음

sp-engine은 MPN이 없어도 하드 스펙이 충분하면 `PARAMETRIC` 검색을 지원한다. 그러나 견적 빌더는 `part_number`가 비어 있는 컴포넌트를 모두 버린다.

프런트는 `items.length === 0`을 아직 빌드되지 않은 상태로 해석한다. 따라서 다음 경우 분석 완료 후에도 계속 분석 중 화면에 머무를 수 있다.

- 모든 부품에 MPN이 없는 BOM
- 유효 부품이 없는 BOM
- 파싱은 완료됐지만 견적 라인이 0건인 BOM

관련 위치:

- `samplepcb-parts-engine/packages/supplier-search-engine/src/supplier_search_engine/planner.py`: `PARAMETRIC` 모드
- `apps/api/src/lib/bom-quote.ts`: `buildItemsFromEngineResult`
- `apps/web/src/pages/bom/BomQuote.vue`: `needsBuild`

권장 방향:

- `buildStatus` 또는 `builtAt`을 견적에 별도로 저장한다.
- MPN 없는 컴포넌트도 미매칭 라인으로 보존한다.
- 값, 패키지, 설명, 원본 행을 이용해 수동 선택 및 파라메트릭 검색이 가능하게 한다.

### 5. BOM 견적의 회원 ID 길이가 플랫폼 규칙과 다름

플랫폼의 `mbId`는 이메일 ID를 수용하기 위해 191자를 사용하지만 `SpBomQuote.mbId`와 생성 마이그레이션은 60자다. 61자 이상 회원은 견적 생성에 실패하거나 DB 설정에 따라 잘릴 수 있다.

관련 위치:

- `apps/api/prisma/schema.prisma`: `SpBomQuote.mbId`
- `apps/api/prisma/migrations/20260719130000_add_sp_bom_quote/migration.sql`

권장 방향:

- 새 ALTER 마이그레이션으로 `VARCHAR(191)`에 맞춘다.
- 기존 적용 환경을 고려해 이미 배포된 생성 마이그레이션을 수정하지 않는다.

### 6. 고객 BOM 화면의 프로젝트 소유 정책이 AGENTS.md와 충돌

현재 `AGENTS.md`는 sp-vue를 관리자 전용으로 유지하고, SPA급 고객 서비스는 별도 Vue 앱으로 구현하도록 정한다. 현재 구현은 sp-vue 라우터 주석에서 이 전제를 변경하고 `/app/bom` 고객 라우트를 추가했다.

관련 위치:

- `AGENTS.md`: 프로젝트 호칭 및 sp-vue 역할
- `apps/web/src/router.ts`: 공개 BOM 라우트와 정책 변경 주석

현재 sp-vue production build의 단일 JS는 약 776KB이며, 고객 화면도 관리자 화면 코드를 함께 내려받는 구조다.

결정 선택지:

1. 현재 구조 승인: `AGENTS.md`와 플랫폼 문서를 공식 변경하고 라우트 lazy loading을 적용한다.
2. 기존 정책 유지: 고객 SMART BOM을 별도 소비자 Vue 앱으로 분리하고 관리자 기능만 sp-vue에 둔다.

## P2 — 데이터 품질과 관리자 워크플로 보완

### 7. 스펙 충돌이 있어도 samplepcb 자체 오퍼가 자동 생성됨

현재 구현은 공급사 스펙 충돌을 `specConflicts`로 기록하지만, 충돌 여부와 관계없이 samplepcb 자체 오퍼를 upsert한다. 엔진 후보의 `status`, `conflicts`, 추천 순위도 인제스트 계약에서 사용하지 않고 모든 후보 제품을 저장한다.

따라서 `input_conflict`, `ambiguous` 후보 또는 핵심 스펙이 충돌한 부품도 자체 오퍼를 가질 수 있다.

관련 위치:

- `apps/api/src/lib/parts-ingest.ts`: `EngineEnvelope`, `applyPartFacts`, `ingestSupplierSearchResult`
- `apps/api/src/lib/parts-facts.ts`: `deriveSamplepcbOffer`

권장 방향:

- 자체 오퍼에 `draft`, `review_required`, `active`, `disabled`와 같은 상태를 둔다.
- 패키지, 전압, 허용오차, 정격 등 핵심 스펙 충돌 시 `review_required`로 저장한다.
- 원천 공급사와 정책 버전뿐 아니라 추천 근거와 검토 이력을 보존한다.
- 자체 판매가와 외부 조달가를 같은 오퍼로 취급할지 별도 모델로 분리할지 결정한다.

정책 확인이 필요한 부분:

- 컴포넌트별 자동 추천 후보 1건만 samplepcb로 저장할지
- 카탈로그에 들어온 모든 정규 부품마다 samplepcb 파생 오퍼를 생성할지

### 8. 스펙 오차 그룹이 입력 순서에 따라 달라짐

수치 스펙은 현재 그룹의 대표값과 새 값이 상대 오차 이내인지 비교하여 그룹화한다. 상대 오차 비교는 전이적이지 않으므로 공급사 입력 순서에 따라 그룹 수와 `specConflicts`가 달라질 수 있다.

재현 값:

- DigiKey: 100
- Mouser: 100.4
- UniKeyIC: 100.8
- 상대 오차: 0.5%

입력 순서에 따라 동일 데이터가 `충돌 있음` 또는 `충돌 없음`으로 계산됐다. DB의 오퍼 조회에는 명시적 정렬도 없다.

관련 위치:

- `apps/api/src/lib/parts-facts.ts`: `sameValue`, `pickRepresentative`, `resolvePartFacts`

권장 방향:

- 입력을 결정적으로 정렬한 뒤 명시적인 클러스터링 규칙을 적용한다.
- 모든 입력 순열에서 결과가 같은지 property/permutation 테스트를 추가한다.

### 9. 관리자가 확정금액 없이 회신 완료할 수 있음

관리자 API는 상태 전이만 검사한다. `confirmedTotal`, 확정 운송료, 확정 관리비, 고객 답변이 모두 null이어도 `answered`로 전환할 수 있다. 고객 화면에는 회신 완료로 표시되지만 실제 회신 내용은 없을 수 있다.

관련 위치:

- `apps/api/src/routes/admin-bom-quotes.ts`: 관리자 PATCH
- `apps/web/src/pages/admin/AdminBomQuotes.vue`: 회신 완료 동작

권장 방향:

- `answered` 전이 시 최소 `confirmedTotal`을 필수로 검증한다.
- 확정 합계를 서버 계산값으로 둘지 관리자의 명시적 오버라이드로 둘지 구분한다.
- 오버라이드 시 사유와 변경 이력을 저장한다.

## 테스트 및 품질 게이트 결과

검토 당시 현재 HEAD `851f64408`에서 실행했다.

| 검사 | 결과 |
|---|---|
| `pnpm -r test` | 357 통과, DB/ES 통합 29 제외 |
| `pnpm -r typecheck` | 통과 |
| `pnpm --filter web build` | 통과, 단일 JS chunk 약 776KB 경고 |
| 변경 TS/Vue ESLint | 오류 0, 템플릿 줄바꿈 경고 4 |
| `uv run pytest` | 177 통과, 1 제외 |
| `uv run ruff check .` | 기존 테스트 파일의 미사용 변수 1건으로 실패 |

현재 자동화 테스트에서 빠진 중요 영역:

- BOM 견적 API 생성·PATCH·요청·관리자 회신
- PATCH와 견적요청의 동시 실행
- 자동저장 중 추가 편집과 저장 실패
- 공급사 검색 완료·인제스트·재매칭 순서
- MPN 없는 BOM 및 0건 빌드
- samplepcb 자체 오퍼의 충돌 상태 게이트
- 스펙 병합 입력 순열 불변성

## 권장 처리 순서

1. 공급사 검색 결과의 인제스트·재매칭을 단일 서버 흐름으로 통합
2. 오퍼 및 주문수량의 서버 검증
3. 견적 version·트랜잭션·자동저장 직렬화
4. MPN 없는 라인과 명시적 빌드 상태 지원
5. `mbId` 191자 마이그레이션
6. 고객 BOM 앱 위치 정책 결정
7. samplepcb 자체 오퍼 상태와 충돌 게이트 결정
8. 관리자 회신 완료 조건 및 테스트 보강
