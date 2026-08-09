# 가격 엔진 — 레거시 패리티 운영 가이드

신규 TS 가격 엔진(`apps/api/src/pricing/engine.ts`)과 레거시 PHP 가격 API
(`samplepcb_php/gerber_api/samplepcb_pricing_api.php`)의 계산 일치를 유지하는 방법과,
2026-07-03 정리 작업에서 확정한 결정들을 기록한다.

## 가격이 어긋나는 첫 번째 용의자: 가격표 드리프트

레거시는 가격표를 **서버의 라이브 파일**(`gerber_api/pricing_data.json`)에서 매 요청마다
읽고, 관리자(`adm/price_adjust.php`)가 수시로 값을 조정한다. 엔진의 스냅샷
(`src/pricing/pricing-data.json`)이 낡으면 알고리즘이 같아도 가격이 통째로 어긋난다.
(2026-07 사례: baseline 61,000원 vs 라이브 66,000원 — `cutting` 표 누락, `setPrice`
마진 브래킷 상이 등)

### 표가 바뀌었을 때 절차

```bash
cd samplepcb-web-mono-app/apps/api
pnpm pricing:sync       # 라이브 표 → 스냅샷 (정규화 1건: 사어 diffDesign 표 삭제)
# engine.ts 의 PRICE_VERSION 을 bump (기존 sp_quote 무효화 기준)
pnpm pricing:capture    # 레거시 API 실측 재캡처 → __fixtures__/legacy-pricing-goldens.json
pnpm test               # legacy-parity.test.ts 47케이스 + 골든 재검증
```

패리티 테스트 첫 케이스가 "스냅샷 sha ≠ fixture sha"로 실패하면 위 절차 누락이다.

## differentDesign / diffDesign — 두 세계 지도와 통일 결정

레거시에는 같은 개념(파일 개수)에 이름이 두 개다:

| 레거시 세계 | 키 | 근거 |
| --- | --- | --- |
| 가격 계산 (프론트 body, `pcb_price.lib.php`, 가격표, 가격조정 UI) | `differentDesign` | `pcb_price.lib.php:199`, `price_adjust.php:138` |
| 주문 저장 (DB EAV `it_25` subj, 견적서 화면, 관리자 견적생성) | `diffDesign` | `cart_api_js.php:91`, `estimate_header.php:68` |

라이브 가격표 JSON에는 두 표가 공존한다: `differentDesign`(**유효** — lib가 읽음,
more1=25,000원/개)과 `diffDesign`(**사어** — 어디서도 안 읽는 과거 설계 잔재).

**결정(2026-07-03): 신규 플랫폼은 `differentDesign` 으로 통일한다.**
- spec 키(`api-contract` KNOWN_SPEC_KEYS), 엔진 spec/표 조회, 테스트 모두 `differentDesign`
- `diffDesign` 은 경계 별칭으로만 존재: 구주문(it_25) 마이그레이션 시
  `diffDesign → differentDesign` 매핑 (`extract-legacy-gerber-samples.ts`)
- 표 동기화 시 사어 `diffDesign` 표는 삭제 (`sync-pricing-data.ts` 의 유일한 정규화)
- 거버 프론트 어댑터(`samplepcb_gerber/apps/view/src/ResultPanel/toProjectPayload.ts`)의
  `differentDesign → diffDesign` 역행 매핑은 제거됨 — 이제 동일명 그대로 전송.
  통일 이전 저장 행(sp_order_spec.specJson 의 `diffDesign`)은 삭제 처리했고, 서버는
  구키를 흡수하지 않는다(통일성 우선 결정, 2026-07-03).
- ⚠ 증상으로 기억할 것: 클라이언트가 spec 에 `differentDesign` 을 안 보내면(오탈자·
  구키 포함) 엔진이 "파일 개수 부재 → 0원 → rfq" 로 처리해 **화면에 '견적 대기'가 뜨고
  주문하기가 견적관리로 빠진다**. 2026-07-03 거버 어댑터 구키 전송으로 실제 발생했던 증상.

## 레거시 body ↔ 신규 spec 별칭 (패리티 어댑터)

`legacy-parity.test.ts` 의 어댑터가 정본. 요약:

| 레거시 body | 신규 spec |
| --- | --- |
| `mixTrace` | `minTraceSpacing` |
| `goldfingers` | `goldFingers` |
| `edgerail` | `edgeRail` |
| `frame` | `framework` |
| `menu` / `category` | 최상위 `category` / `orderCategory` |

`impedance` 는 양쪽 동일명(가격표의 `impedence` 오탈자 키는 엔진 내부에서만 매핑).

## 이식 과정에서 확정한 레거시 실동작 (직관과 다른 것들)

- **eta**: 주말/공휴일 "카운트" 코드는 레거시 자체에서 주석 처리돼 있다. 실동작은
  `now + (제작일 + 배송 3일) 달력일`, 종료일이 토요일이면 +2일 / 일요일이면 +1일.
- **panel 과도기 값**: `getPanel` 은 `x` 분해가 정확히 2조각이 아니면 (0,0) — `"yes"`,
  `"2x0"` 같은 실제 UI 과도기 body는 수량 0(무게 0kg, 면적원가 0)으로 계산된다.
- **differentDesign 부재/0**: 가격 전체가 0원 → 주문버튼 숨김 → 견적요청 유도. 의도된 흐름.
- **METAL/ROGERS 프론트는 differentDesign 을 "no"/"yes" 로 보낸다** (개수 아님).
  advance 계열은 라이브 가격표에 메뉴가 없어 어차피 계산 불가(rfq)이므로 현재 실영향 없음.
- **advanceFR4/advanceRogers/flexibleRigid**: 라이브도 가격표에 메뉴가 없어 PHP Warning 후
  0원 응답. 신규 엔진의 rfq(null) 처리와 실질 동일. `advanceMetal`/`flexibleFPCB` 는
  엔트리에서 하드코딩 0원.
- **mass(양산)**: 레거시 listPrice=0, 신규 rfq(null) — 같은 의미의 다른 표현.

## 레거시 호환 가격 엔드포인트 — POST /api/pcb-pricing (2026-08-07)

거버 뷰어의 화면 실시간 가격을 레거시 PHP 대신 sp-node 가 서빙할 수 있게 한
**드롭인 호환** 라우트(`apps/api/src/routes/pcb-pricing.ts`). 목적은 스위칭 비교 —
거버 뷰어(테스트용)가 같은 body 를 레거시 ↔ 이 라우트에 번갈아 쏘고 값을 대조한다.

- 입력 = 레거시 body 그대로(어댑터 `src/pricing/legacy-body-adapter.ts` 가
  `legacy-parity.test.ts` 와 **공유** — 파리티 green 이 곧 라우트 입력 변환의 보증).
- 출력 = 레거시 public 응답 5필드 동형(`listPriceWithRate` "35,000원" 형식 포함).
- 무인증 공개(레거시와 동일)·계산 전용·저장 없음. 가격표는 라이브(live-pricing.ts).
- **applyGerberPriceMode(부가세 정규화) 미적용** — 그건 저장가(sp_quote)의 해석이고,
  이 응답의 기준은 레거시 화면가다(supply 모드 ×1.1 을 얹으면 비교가 무의미해진다).
- 레거시 엔트리 분기까지 재현: advanceMetal/flexibleFPCB 하드코딩 0원, 필수값
  누락 시 `{result:false, message:'required param'}`(CCResult 동형).
- 미이식 경계: metalMask **해외 스텐실**(body 에 `placeOfOrigin` 존재 →
  레거시 PcbMetalPriceLib)은 명시적 미지원 응답 — 국내가로 조용히 계산하지 않는다.
  현행 거버 UI 는 이 키를 보내지 않는다. advanceFR4 등 미지원 메뉴의 0원 응답에서
  무게·eta 부산물(레거시가 PHP Warning 내며 채우던 값)은 재현하지 않는다.
- 라우트 파리티 테스트: `apps/api/src/routes/pcb-pricing.test.ts` — 골든 46케이스를
  inject 재생, standard/metalMask/하드코딩 메뉴는 응답 완전 일치 단언.

거버 쪽 스위칭(samplepcb_gerber `apps/view`): `src/api/price-api-target.ts`
(localStorage `sp.priceApiTarget`, legacy|platform) + 가격 박스(ResultPanel/price.tsx)의
"가격 API: 레거시|플랫폼" 토글 버튼. 토글 시 같은 body 로 즉시 재조회
(options.tsx useAsync deps). platform 대상 URL 은 dev=`https://local-web.samplepcb.co.kr
/api/pcb-pricing`(same-site 직접 호출, 서버측 CORS — 담기 API 와 같은 패턴),
prod=상대경로 `/api/pcb-pricing`(같은 도메인, 운영 nginx 에 /api → sp-node 프록시 전제).
토글은 **제출 경로에도 연동**된다(submit.tsx `shouldUseProjectApi`): prod 에서
'플랫폼'이면 견적요청·주문 제출이 레거시 form.submit(cart_api) 대신 신규 담기 API
(`/api/pcb-projects` + `/spcb/api/me`, 상대경로)를 탄다 — dev 는 항상 신규 경로.

## 관련 파일

- 엔진/표/테스트: `apps/api/src/pricing/{engine.ts, pricing-data.json, engine.test.ts, legacy-parity.test.ts, __fixtures__/legacy-pricing-goldens.json}`
- 레거시 호환 라우트: `apps/api/src/routes/{pcb-pricing.ts, pcb-pricing.test.ts}` + `apps/api/src/pricing/legacy-body-adapter.ts`
- 스크립트: `apps/api/src/scripts/{sync-pricing-data.ts, capture-legacy-pricing-goldens.ts}`
- 레거시 body 케이스 근거: `docs/samplepcb-pricing-api-body-cases.md`
