---
concept: 렌더는 추출해 공유, 도메인 어휘는 격리 (Share Render, Mirror Domain)
last_compiled: 2026-11-15
topics_connected: [shared-packages, sp-market-web, sp-develop-web, api-contract, sp-node-api, partner-tracks, sp-vue-web, testing, smartsmt-integration]
status: active
---

# 렌더는 추출해 공유, 도메인 어휘는 격리 (Share Render, Mirror Domain)

## Pattern
같은 리포가 한쪽에서는 **"복사하지 말고 추출하라"**(2026-09-05 `@sp/ui` 신설의 문장이 그대로 "복사가 아니라 추출")고 하고, 다른 쪽에서는 **"값이 같아도 따로 두라"**(`pcb-claim.ts` 헤더: "BOM 사전은 불변 — PCB 계약은 여기 따로 선다")고 한다. 모순이 아니라 경계가 그어져 있는 것이다.

**추출해 공유하는 것 = 같은 픽셀·같은 계산**. 화면 부품, 파일 미리보기 판정, 에러 문구 골격, 순수 산식, AI 러너 배관. 복사하면 3앱이 각자 갈리고, 한쪽에서 고친 결함이 다른 쪽에 남는다.

**일부러 격리하는 것 = 같은 업무 어휘**. 상태 사전, 라벨, 가드 코드, 라우트 경로, 테이블. 값이 같아 보여도 각자 진화하므로, 공유하면 한 트랙의 요구가 다른 트랙의 상태 기계를 흔든다.

[judgment-single-owner](judgment-single-owner.md)와 짝이되 **방향이 반대**다 — 그쪽은 "같은 판단을 두 번 구현하지 말라", 이쪽은 "다른 도메인의 어휘를 한 벌로 합치지 말라". 두 규율이 만나는 자리가 계약 패키지다: 판정 함수는 한 곳, 트랙 사전은 파일별로 따로.

## Instances
- **2026-11-12~13** in [sp-develop-web](../topics/sp-develop-web.md) / [shared-packages](../topics/shared-packages.md) / [testing](../topics/testing.md): **종이와 화면이 같은 장** — 개발의뢰 의뢰 출력물(16:9 PDF)을 장 판으로 바꾼 이튿날, 내용 만들기·숨은 자리 높이 재기·배분·장 그리기를 `RequestPrint` 에서 [DeckBook](../../samplepcb-web-mono-app/apps/develop/src/components/deck/DeckBook.vue) 으로 옮겨 **장 계획 하나를 보이는 방식 셋**(`mode` = `print` 전부 쌓기 / `stage` 의뢰 상세 넘겨 보기 / `flow` 좁은 화면 세로 흐름)이 같이 쓴다 — 한쪽만 고쳐 어긋날 일이 없다. 넘기지 않는 탭(진행·문의·첨부·문서 목록)도 장과 같은 모양의 판(`DeckPanel`)이고, 견적 산출 내역 장은 견적서 1쪽과 같은 계약 행 `developQuoteSheetRows` 를 그린다. 배분 규칙은 순수 함수 [@sp/utils deck-pack](../../samplepcb-web-mono-app/packages/utils/src/deck-pack.ts)(`packDeckColumns`·`balanceDeckChunks`·`DECK_STRETCH 1.08`, 단위 13)로 앱 밖에 섰는데 — **FE/BE 공유가 아니라 develop 한 앱만 쓰는** utils 의 첫 모듈이다(테스트 러너가 있는 자리라서 들어왔다). ⚠ 반례 심화: 같은 교체로 고객 상세의 검토서 컴포넌트(`DevelopReview`·`ReviewDiagram`)가 지워지며 고객 앱은 `@sp/utils buildDevReviewView` 도 더는 쓰지 않는다(`deck-content.ts` 가 `MarketDevReview` 를 직접 읽는다) — 10-22 에 렌더러가 갈라진 뒤 남아 있던 **뷰 모델 공유까지 끊겼고**, `@sp/ui figureSrcdoc` 은 바깥 소비자가 0(패키지 안 `DevDiagramSection` 만)이 됐다. 관리자 미리보기와 고객 문서가 같은 모양이라는 보장은 견적서 시트·구성도 파서·산출 내역 행에만 남았다
- **2026-11-13~14** in [api-contract](../topics/api-contract.md) / [smartsmt-integration](../topics/smartsmt-integration.md): **바깥 도메인의 어휘는 더 멀리 격리한다** — SmartSMT 견적서 계약 [smartsmt.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/smartsmt.ts)(367줄)는 zod 외 import 가 없다. SMT 조달 구분 `TURNKEY|CUSTOMER|REUSE` 가 BOM `customer_supply` 와 뜻이 닮아도 따로 서고, 라벨 사전도 우리 관례(`as const` + `satisfies Record<enum>`)가 아니라 `Record<string, string>` + 폴백 `smartsmtLabel`(사전에 없으면 코드 그대로)이다 — 코드의 주인이 바깥이라 값을 막지 않는다. 반대로 공유한 것은 화면 키트뿐이다(리뉴얼 `next/components/common` 조각과 `promptDialog`)
- **2026-11-04~06** in [sp-develop-web](../topics/sp-develop-web.md) / [shared-packages](../topics/shared-packages.md) / [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): **종이 한 장을 한 번만 그린다** — 개발의뢰 견적서 1쪽(`@sp/ui` `DevelopQuoteSheet`, 피그마 「통합 견적서」)을 고객 인쇄 화면과 관리자 미리보기가 같이 쓰고, PDF 는 그 DOM 을 캡처하며(`downloadElementsPdf`), 서버 엑셀은 같은 계약 함수(`developQuoteSheetRows`·`computeDevelopQuoteBreakdown`)로 같은 표를 만든다. PCB `EstimateSheet`·BOM `BomEstimateSheet` 와는 합치지 않았다(서식이 다른 업무 문서 — 미러 쪽). 11-05 구성도 도면·글 분리 파서 `parseDiagramDoc` 도 `@sp/ui` 로 옮겨 마켓·개발의뢰가 같이 쓰되 마켓은 `split` 을 끈 채 쓴다. ⚠ 반례·비용: 고객 검토서(`DevelopReview`)와 관리자 미리보기(`DevReviewView`)는 **다른 렌더러로 갈라졌고**, `@sp/ui` 는 처음으로 `@sp/*` 밖 런타임 의존(`html2canvas-pro`·`jspdf`)을 가졌으며, 상업송장 PDF 캡처는 공용 헬퍼를 쓰지 않아 글자 간격 처방이 거기엔 없다
- **2026-10-11 (공유가 낳은 결합)** in [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): 포털 문구 파일(`partner/locales`)이 BOM·PCB **공용**이라 PCB 를 보고 정한 '선적' 어휘 통일이 BOM 포털 화면도 함께 바꿨다. 같은 날 선적 상태 사전이 두 트랙 공용이라 '선적 완료'를 상태로 넣지 못했다([record-not-state](record-not-state.md)). 공유한 것은 한쪽만 고칠 수 없다 — 이 개념의 비용 쪽 사례
- **2026-10-09** in [api-contract](../topics/api-contract.md) / [partner-tracks](../topics/partner-tracks.md): BOM 송금 원장은 PCB 와 **같은 모양·같은 규칙**이되 사전은 따로(`BOM_REMITTANCE_STATUSES`) — 08-06 "공용화 아님" 결정을 유지했다. 문항형 고객 확인도 같다: D43(부품 확인)과 D20(EQ 문항)이 요청 1건 = 문항 N × 선택지·낙관적 잠금·대리 회신(채널+메모)이라는 형식을 공유하지만 유형·선택지 사전은 격리돼 있다
- **2026-10-06~11** in [sp-vue-web](../topics/sp-vue-web.md): 관리자 리뉴얼 키트 — `next/components/common` 의 모듈 무관 조각(`PageHeader`·`QueueTabs`·`TableCard`·`SectionCard`·`Panel`…)은 공유하고 모듈 폴더는 업무 부품, **배지 색은 모듈마다 한 곳**. 손으로 지은 상자 123건을 `next-ui-audit` 가 키트로 되돌렸다. 화면 사이에서도 "같은 일은 같은 모양" — EQ 작업공간은 D43 작성 패널과 같은 넓은 오른쪽 패널이고, 선적 스텝퍼는 `lib/pcb-ship-steps.ts` 하나를 보내기 카드와 발주 상세가 같이 쓴다
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 문서·업무표가 마켓과 무관한 자체 사전(`DEVELOP_DOC_*`·업무 단계 6)으로 서고, 달성도 산식만 계약 순수 함수로 공유. 같은 "문서"라는 낱말이 두 트랙에서 다른 것을 가리킨다
- **2026-09-08** in [api-contract](../topics/api-contract.md) / [sp-market-web](../topics/sp-market-web.md): **팩토리는 공유, 내용물은 분리** — `area-registry.ts`의 `createAreaRegistry()` 하나에서 `MARKET_REGISTRY`/`DEVELOP_REGISTRY`가 갈라진다. 마켓 export 이름·시그니처·프롬프트·JSON 스키마는 **바이트 동일**(회귀 e2e-market 148/0이 그 가드)이고, 개발의뢰는 `mech` 분야·`kind:'text'` 서술 문항을 자기 쪽에만 더한다. `DEVELOP_BUDGET_RANGES`는 마켓 것과 **단위 자체가 달라** 교차 import 금지
- **2026-09-05** in [shared-packages](../topics/shared-packages.md) / [sp-market-web](../topics/sp-market-web.md): **`@sp/ui` 신설이 이 개념의 정의 사건** — 관리자가 고객과 같은 렌더러로 검토서를 미리 봐야 하는데 복사하면 3앱이 갈린다. 마켓에서 i18n 미사용·`@sp/*` 의존만인 7컴포넌트를 옮기고 `copper-*`→`brand-*`. 추출의 조건 넷이 패키지 헤더에 명문화됐다 — **i18n 미사용**(도메인 라벨은 계약 상수) · **시맨틱 토큰 이름만**(`brand-*`·`ink-*`·`--color-area-*`, 값은 각 앱 `@theme`이 정함 — 마켓은 카퍼 별칭, develop 은 일렉트릭 블루) · **API 경로 비하드코딩**(`filesPath` prop) · **레지스트리는 인자**(`DevReviewView :registry`)
- **2026-09-05** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-market-web](../topics/sp-market-web.md): 개발의뢰는 마켓 위저드를 **재사용하지 않는다** — 별도 앱·별도 테이블. `sp_market_project`에 `channel` 컬럼을 더하는 안을 기각한 이유가 어휘 격리의 가장 선명한 근거다: **공개 목록 쿼리에서 필터 하나가 빠지면 비공개 의뢰가 마켓에 샌다**. 공유한 것은 셋뿐 — `@sp/ui` 렌더러, 계약 레지스트리, 서버 AI 러너의 타깃 어댑터(`{kind:'market'}|{kind:'develop'}`, `features.schedule`은 develop 일 때만)
- **2026-09-04** in [api-contract](../topics/api-contract.md) / [shared-packages](../topics/shared-packages.md): `file-preview.ts` — "무엇을 보여줄 수 있는가"의 판정(`fileViewKind`·`needsServerPreview`)과 응답 모양은 **도메인 중립 한 파일**, 도메인마다 다른 것은 라우트·권한뿐. `apiErrorMessage`도 같은 결 — 401/404 폴백만 공통이고 **코드 사전은 앱이 주입**(마켓 `REVIEW_STALE`… vs 개발의뢰 23종)
- **2026-08~09** in [sp-node-api](../topics/sp-node-api.md) / [partner-tracks](../topics/partner-tracks.md): **PCB 트랙 코어는 BOM 코어와 함수를 공유하지 않는 미러**(`pcb-po`·`pcb-shipment`·`pcb-claim` ↔ `bom-*`, `bom-po.ts` 무접촉). 공유하는 것은 계약 코드 사전뿐(`BOM_SHIPMENT_*`·`SHIPMENT_TRANSPORTS` air|sea). 포털 라우트도 `/api/partner/rfqs` vs `/pcb-rfqs`로 갈리고, PHP 브리지의 `sp_bom_claim.extend.php`는 `sp_pcb_claim`과 "모양이 같지만 **함수를 나눈다**"
- **2026-08-27** in [sp-node-api](../topics/sp-node-api.md): 사내 서비스 BOM API 는 **라우트를 복제하지 않고** 같은 플러그인을 `/api/svc`에 서비스 액터로 재등록 — 배관(라우트·검증·소유 검사)은 공유, 액터만 갈아끼운다. 추출 가능한 것을 끝까지 추출한 반대편 극단
- **2026-07~08** in [shared-packages](../topics/shared-packages.md): `@sp/utils`의 FE/BE 동시 소비 — `spec-units`(색인·검색이 **같은 파서**, xpse 커스텀 토크나이저 기각) · `bom-pricing` 27파일 · `kst-date` 41파일 · `vat`. 순수 계산이므로 어느 쪽에서 불러도 같은 답이 나오고, 골든 벡터가 명세 노릇을 한다([golden-as-spec](golden-as-spec.md))

## What This Means
새 코드를 앞에 두고 물을 것은 "중복인가"가 아니라 **"같은 픽셀/같은 계산인가, 같은 업무 어휘인가"**다.

- **같은 픽셀·계산이면 추출한다.** 다만 추출 가능한 형태로 만드는 값이 있다 — i18n 을 빼고, 색은 토큰 이름만 읽고, 경로·사전·레지스트리는 **인자로 받는다**. 이 네 조건을 못 맞추는 컴포넌트는 아직 공유 대상이 아니다.
- **같은 업무 어휘면 미러한다.** 파일을 나누고, 사전을 각자 세우고, 라우트를 갈라 둔다. 대가는 코드 중복이지만 얻는 것은 **한쪽 변경이 다른 쪽을 못 건드린다는 보장**이다. 미러가 정당한지는 "이 상태값의 의미가 두 트랙에서 정말 같은가"로 검사한다 — `resolved` 하나가 PCB 와 부품에서 다른 말이라 A/S 화면에 '전체' 탭조차 두지 않았다.
- **중간 지대는 팩토리·어댑터로 푼다.** `createAreaRegistry`·AI 러너 타깃 어댑터·`/api/svc` 재등록이 그 예다. 공통 뼈대를 함수로 뽑고 도메인은 인자로 넣으면, 기존 트랙의 산출물을 **바이트 동일**로 유지한 채 새 트랙을 얹을 수 있다. 그 동일성을 지키는 것은 기존 트랙의 회귀 하네스다.
- ⚠ 추출에는 **소비 조건**이 따라온다. `@sp/ui`를 쓰는 앱은 `style.css`에 `@source "../../../packages/ui/src"`와 토큰 이름 전부가 있어야 한다 — 없으면 에러 없이 스타일만 사라진다.

11월의 견적서는 공유의 단위가 컴포넌트에서 **종이 한 장**으로 커진 경우다 — 화면·인쇄·PDF·엑셀 네 출력이 한 서식 정의(`DevelopQuoteSheet` + 계약 행 함수)를 보면 고객이 받은 문서와 관리자가 미리 본 문서가 어긋날 수 없다. 같은 달 검토서는 반대로 고객용과 관리자용 렌더러가 갈라져, "미리보기 = 고객 문서"를 보장하는 곳이 이제 견적서뿐이다. 공유의 대가도 커졌다 — 그 한 장의 고정 색·고정 폭은 `@sp/ui` 의 "시맨틱 토큰만" 규칙의 예외인데 그 예외는 아직 패키지 헤더에 적혀 있지 않다.

11월 중순에는 공유의 축이 **앱 사이에서 한 앱 안의 출력 사이로** 옮겨 갔다. `DeckBook` 은 종이(출력물)와 화면(의뢰 상세 넘겨 보기·세로 흐름)을 한 장 계획으로 묶었지만, 그 대가로 고객 앱은 관리자 쪽과 남아 있던 뷰 모델 공유를 버렸다 — "같은 픽셀"을 어디와 맞출지(종이와 화면 vs 고객과 관리자)를 골라야 했고 앞쪽을 골랐다. 공유 패키지(`@sp/utils`)에 한 앱 전용 모듈이 들어온 것도 같은 흐름이다: 들어온 이유가 "같이 쓰니까"가 아니라 "단위 테스트 자리가 거기 있어서"라, utils 를 고칠 때 "서버도 이걸 쓰나"를 import 로 확인해야 한다. 어휘 쪽 끝도 하나 생겼다 — 정본이 리포 밖에 있는 도메인(SmartSMT)은 사전을 따로 세우는 데서 그치지 않고 **값을 막지 않는 사전**으로 둔다.

## Sources
- [shared-packages](../topics/shared-packages.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [api-contract](../topics/api-contract.md)
- [sp-node-api](../topics/sp-node-api.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [testing](../topics/testing.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.10 장 계획·배분 · §7.2.11 "장 계획은 하나, 보이는 방식이 셋" · §7.2.12 견적서 장·나머지 판
- [apps/develop/src/components/deck/DeckBook.vue](../../samplepcb-web-mono-app/apps/develop/src/components/deck/DeckBook.vue) — 출력물·의뢰 상세 공용 장 계획
- [packages/utils/src/deck-pack.ts](../../samplepcb-web-mono-app/packages/utils/src/deck-pack.ts) — 장 배분 순수 함수(develop 전용)
- [packages/api-contract/src/schemas/smartsmt.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/smartsmt.ts) — 바깥 도메인 사전(값을 막지 않음)
- [packages/ui/src/components/DevelopQuoteSheet.vue](../../samplepcb-web-mono-app/packages/ui/src/components/DevelopQuoteSheet.vue) — 견적서 1쪽(고객 인쇄·관리자 미리보기·PDF 공용)
- [packages/ui/src/lib/pdf-capture.ts](../../samplepcb-web-mono-app/packages/ui/src/lib/pdf-capture.ts) — `downloadElementsPdf`
