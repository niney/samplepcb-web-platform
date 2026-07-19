# 고객 스마트 BOM 견적 (BOM Quote)

> 정본 설계 문서 (2026-07-19). 레거시 vueline `spSmartBomV2`(고객 BOM 업로드 페이지)의
> **재설계 재구현** — 동일 이식이 아니라 레거시 결함을 교정한 새 구현이다.
> 관련: `docs/PARTS_SEARCH.md`(부품 카탈로그 — 매칭·오퍼의 원천), `AGENTS.md`.

## 한눈에

```
고객(/app/bom, 회원 전용)                sp-node(/api/bom)                sp-engine(:8400)
 업로드(xlsx/xls/csv/…) ───────────▶ POST /quotes(원본 파일서버 보존) ──▶ 파싱 잡
 진행 폴링 → build ◀──────────────── G-shape → 라인 + 카탈로그 매칭 ◀── sp_part*(DB)+sp-parts(ES)
 검토(수량·오퍼·포함) → 1s 자동저장 ─▶ PATCH(draft, replace-all)
 (버튼 없음 — 조용한 자동 보강) ◀──── build 직후 서버가 판단·검색 실행 ─▶ Mouser/DigiKey/UniKeyIC
   "가격·재고 확인 중…" 라벨만        └ 자동 인제스트 → 폴러가 견적 자동 재매칭
 견적요청(제목 입력) ───────────────▶ POST /request(서버 재계산·동결)
관리자(/app/admin/bom-quotes)        상태 전이·확정가·회신 메모·원본 다운로드
```

- **상태**: `draft → requested → reviewing → answered → closed` (+`canceled`). 전이는
  서버 검증(`lib/bom-quote.ts QUOTE_TRANSITIONS`), requested 이후 고객 수정 불가(409).
- **1차 종점 = 견적요청(RFQ)**. 결제 연계(거버식 카트 스냅샷→orderform)는 2차.
- **회원 전용**(비로그인 → 그누보드 로그인 왕복). 데이터 흐름은 sp-node 신규 소유 —
  xpse(sp_estimate_document) 브릿지 안 함(2026-07-19 사용자 결정).

## 데이터 모델 (Prisma, 공유 DB — 추가형 `migrate deploy`만)

- `sp_bom_quote`(SpBomQuote): mbId·title·status·fileName·contentHash(SHA-256)·
  engineJobId(엔진 인메모리 잡 — 재시작 시 소멸)·setQty/spareQty·
  **예상 스냅샷**(itemsTotal/shippingFee/managementFee/finalTotal/usdKrwRateUsed/uncostedCount)·
  customerMemo·adminMemo(내부)·answerNote(고객 노출)·confirmed*(관리자 확정)·requestedAt/answeredAt
- `sp_bom_quote_item`(SpBomQuoteItem): rowIdx·included·mpn·bomQty·**orderQty(박제 수량 = 단일 진실)**·
  matchStatus(auto|manual|none)·partId(sp_part 느슨한 참조, FK 없음)·
  **selectedOffer Json(오퍼 스냅샷 박제 — 가격구간 사다리 포함·pinned)**·lineTotalKrw·sourceRow(원본 근거)
- 원본 파일: 파일서버(serviceType `bom`) + `sp_file`(refType `sp_bom_quote`) —
  관리자 다운로드는 서버 경유 스트리밍(pathToken 클라 미노출).
- xpse 의 `sp_bom_document`/`sp_estimate_document` 는 **별도 DB**(이름 충돌 없음 확인) — 무관.

## 가격·수량 규칙 (@sp/utils bom-pricing — 서버·FE 동일 함수, 골든 테스트 14)

| 규칙 | 레거시 대비 |
|---|---|
| 가격구간: 주문수량 이상 구간 중 최대, 최소구간 미달 시 최소구간 단가 | 보존 |
| 수량 박제: `orderQty = max(BOM수량×(세트+예비), MOQ)` → **주문배수 올림** | 배수 보정 신규(레거시 죽은 필드) |
| 합계: `Σ(단가×orderQty, included 라인) + 운송료 + 관리비`, VAT 별도 | items=합계 기준 통일(레거시 불일치 결함 교정) |
| 오퍼 자동 선정 `pickDefaultOffer`: **실효 총비용**(오퍼별 MOQ·배수 반영 실효수량×적용단가, KRW 환산) 최저. 재고 충분→환산 가능 우선, 동률 시 재고↓→PKG(Cut>Digi>Bulk>Tape) | 신규 — 레거시는 단일 부품 pkg 선택뿐 |
| `pinned`(사용자 명시 선택): 수량 변경 시 그 오퍼 안에서 구간만 재계산, 자동 라인은 재선정 허용 | 레거시 "선택 pkg 내 탐색" 일반화 |
| 통화: 오퍼 원통화 보존, USD 는 sp_config 환율로 KRW 환산 예상(미설정 시 미환산=uncosted 경고) | 신규 |
| samplepcb 파생 오퍼는 견적 선정 후보 제외(자기 선택 순환 방지) | — |
| 납기: "확정 시 안내" 문구 | '2주' 하드코딩 제거 |

**서버 재계산 원칙**: 합계는 항상 서버가 스냅샷에서 재계산(클라 금액 불신). 스냅샷 단가는
카탈로그 매칭이 서버측에서 기록하며, 최종 확정가는 관리자 검토가 결정하는 RFQ 모델.

## 조용한 자동 보강 (2026-07-19 — 고객에게 "공급사 검색" 개념 비노출)

build 직후 서버(`routes/bom-quotes.ts autoEnrichQuote`)가 판단·실행하고 FE 는 상태 라벨만:
- **필요 조건**: included 미매칭 라인 존재 OR 오퍼 나이 > `freshnessHours`(기본 24h). 전부
  신선하면 0콜로 종료.
- **비용 게이트**: preflight 예상 호출이 한도 내면 라이브 검색(일일 카운트 1회), 한도
  초과(초대형 BOM)·일일 소진이면 `cache_only`(0콜). 엔진 불가면 조용히 생략(카탈로그 데이터 유지).
- **완료 반영**: 인제스트 폴러 콜백 `refreshQuoteFromCatalog` — 기존 라인은 오퍼 정체성
  (공급사+SKU) 보존한 스냅샷 최신화(pinned 포함, orderQty 보존·신규 MOQ/배수 재적용),
  미매칭 라인은 재매칭. FE 는 running 감지 시 "가격·재고 확인 중…" 표시, 완료 시
  onlyUnmatched 재매칭을 즉시 당기고(멱등) 갱신 토스트.
- 라인 오퍼에 "기준 N일 전" 나이 배지(데이터 정직성 — 방금 조회처럼 보이지 않게).
- 라이브 검증: 카탈로그 미보유 STM32F030F4P6 업로드 → build 미매칭 → 고객 개입 0으로
  자동 검색→적재→실 Mouser 오퍼(₩3,042) 매칭·합계 갱신 확인.

## 비용 정책 (sp_config `bom_quote` — 관리자 설정 승격)

`/app/admin` 설정 → BOM 견적 탭: 기본 운송료(30,000)·기본 관리비(25,000)·USD→KRW 환율
(비우면 미환산 표시)·검색 1회 최대 API 호출(300)·회원별 일일 검색 한도(20)·데이터 신선 임계(24h).
레거시·구 관리자 콘솔 모두 계산 로직 없이 상수/수동 입력이던 것을 설정으로 승격.
고객 화면 표기: **"예상 견적 — 확정 시 변동" + VAT 별도**. 확정가는 관리자 검토(confirmed*)가 정본.

## API

**회원 `/api/bom`** (`routes/bom.ts`·`bom-quotes.ts`, `authenticate`):
- `POST /quotes`(multipart) 업로드→견적+엔진 잡 · `GET /quotes`(내 목록) · `GET/PATCH /quotes/:id`
  (PATCH 는 draft 한정, items **replace-all** — 레거시 문서 자동저장 방식)
- `POST /quotes/:id/build`(파싱 결과→라인+전체 카탈로그 매칭, 라인 있으면 no-op) ·
  `/catalog-match`(onlyUnmatched 기본 — pinned 보존) · `/request`(재계산·동결) · `/cancel` · `DELETE`(draft)
- 잡 프록시: `GET /jobs/:id[/result]`, 공급사 검색 `POST /jobs/:id/supplier-search[/preflight]`
  — **소유 회원만**(타인·미기록 404 은닉), 일일 한도 초과 429 `SEARCH_DAILY_LIMIT`,
  max_calls 는 sp_config 로 클램프. 자동 인제스트(폴러+백업 훅)는 관리자 플로우와 동일.
- 카탈로그: `GET /parts-search`(교체·추가 모달, admin-parts 쿼리 빌더 재사용) · `GET /parts/:id`

**관리자 `/api/admin/bom-quotes`** (`routes/admin-bom-quotes.ts`, `requireAdmin`):
목록(기본 draft 제외)·상세·`PATCH`(상태 전이 검증+확정가+메모)·`GET /:id/file`(원본 스트리밍).

## 화면

- 고객: `/app/bom`(업로드+내 견적 이력), `/app/bom/:id`(워크벤치 — 좌 결과 테이블+우 주문
  패널, 레거시 기본 구조). sp-vue 에 **일반(회원) 라우트 그룹 신설** — "sp-vue=관리자 전용"
  전제 공식 변경(router.ts 주석). `meta.requiresMember` 가드 = 그누보드 로그인 왕복.
- 관리자: `/app/admin/bom-quotes` + 설정 탭. 디자인 고도화는 후속(1차는 기본 구조).

## 검증 기록 (2026-07-19)

- 골든: bom-pricing 14/14 · parts-facts 15/15 · spec-units 74/74 · 통합(PARTS_IT) 29/29
- turbo typecheck/lint/test 전 패키지 green
- **라이브 e2e**: CSV 업로드→파싱→build(카탈로그 자동 매칭, 실 KRW 단가)→공급사 검색
  (preflight 클램프 500→60 확인·202→완료·자동 인제스트)→전체 재매칭(세트 10 → 주문수량
  40/100 박제·가격구간 하락 25→9.4KRW 반영)→견적요청(동결·이후 PATCH 409)→관리자
  목록·회신(answered·확정 45,000·잘못된 전이 409)→고객 회신 확인→원본 다운로드 전부 통과.
  인증 경계: 비로그인 401·회원의 admin 403·타인 잡 404.

## 알려진 한계(1차 허용, 문서화)

> 2026-07-19 코드 리뷰에서 확인한 후속 보완 항목과 재현 근거는
> [`bom-quote-code-review-2026-07-19.md`](./bom-quote-code-review-2026-07-19.md)에 기록한다.

- 엔진 잡·잡 소유·일일 검색 카운터는 인메모리(단일 인스턴스) — 재시작 시 파싱 중 견적은
  "재업로드 안내"로 복구(빌드 완료된 견적은 DB 라 무관).
- PATCH 의 selectedOffer 스냅샷은 클라 제출값(조작 가능하나 RFQ 모델이라 이득 없음 —
  관리자 확정가가 정본). 결제 연계 시 서버 검증 강화 필요.
- 견적요청 접수 관리자 알림(메일)은 미구현 — `spcb/api/order-notify.php` 확장으로 후속.

## 2차+ 로드맵 (범위 밖 기록)

결제 연계(거버식 `g5_shop_cart` 스냅샷→orderform.php — 확정가 기반) · 관리자 풀 워크벤치
(협력사 RFQ·발주·선적 — sp-smartbom-web/xpse 의 재설계, 이 데이터 모델 위에서) ·
비회원 체험+IP rate limit · 운임 규칙 엔진 · Part Finder 컬렉션 · 환율 자동 갱신(수출입은행) ·
관리자 접수 알림 · 잡 스토어 영속화(다중 인스턴스).

## Parts Eyes 셸 — Figma 업로드 페이지 이식 (2026-07-19)

Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(node 87:9037)를 픽셀 충실도 중심으로 이식.
**다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환**, 구조·치수·중앙 콘텐츠는 시안 그대로.

- `layouts/BomLayout.vue`: 상단바(로고·샘플 토글·타이틀·프로필) + 좌측(BOM 분석/단일 검색
  /Recent file=내 견적 최신 4건 실데이터) + 중앙 흰 패널 + 우측 프로모 카드 2종. /bom 라우트
  전용 셸(DefaultLayout에서 분리).
- `pages/bom/BomHome.vue`: 토글 · 드래그&드롭 카드(그라데이션+글로우+로고+Select file,
  선택 즉시 업로드→분석 이동 — 시안에 시작 버튼 없음) · 헤드라인 · 공급사 필 3종
  (사용자 지시: UNIKEY·DigiKey·MOUSER만).
- 에셋: `assets/bom/`(Figma 익스포트 커밋 — 아이콘 SVG는 라이트용 재색상, 로고는 그라데이션
  베이크드 크롭(블렌드모드가 img 내 검은 backdrop과 합성되는 문제 회피), 공급사 필은 합성 렌더 2x).
- 업로드 한도 30MB→50MB(시안 카피 정합, 서버 동기).
- **시안 대비 미구현(표시만) 리스트**: 단일 검색(메뉴·토글) · 샘플 토글 · 사이드바/패널 접기 ·
  프로필 메뉴 · 프로모 카드 링크(튜토리얼/Gerber Eyes) — 표시 요소는 존재, 동작은 후속.
