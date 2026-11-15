---
concept: 판단 단일 소유권 (Judgment Single Owner)
last_compiled: 2026-11-15
topics_connected: [api-contract, parts-engine, sp-node-api, spcb-bridge, gnuboard-integration, sp-vue-web, sp-develop-web, sp-market-web, infrastructure, partner-tracks, theme-sp-lite, smartsmt-integration]
status: active
---

# 판단 단일 소유권 (Judgment Single Owner)

## Pattern
한 종류의 판단(기술 매칭·선택 자격·업무 전이·어휘·기한·산식)은 **정확히 한 곳이 소유**하고, 나머지 계층은 그 결과를 소비만 한다. 2026-07 의 첫 형태는 "엔진이 원본"이었다 — AGENTS.md "BOM 역할 경계"가 sp-engine=BOM 추출·정규화·검색·호환성 **판단의 원본**, sp-node=계약·저장·업무 정책, sp-vue=표시 전용(재판정 금지), sp-engine↔sp-vue 직접 연결 금지로 못박았다.

2026-08~09 에 **세 번째 형태**가 굳었다: 업무 판정을 **계약(`@sp/api-contract`)이 순수 함수로 소유**한다. 서버 라우트·관리자 화면·협력사 포털·메일이 같은 import 하나를 호출하고, 파일 안에서 사전→라벨→판정이 한 덩어리로 산다. 계기는 실결함이었다 — EQ 반려와 요청취소가 같은 전이(`eq_requested→issued`)라 `note` 유무로만 갈리는데 그 규칙이 네댓 곳에 복제돼 있어, 한 곳만 고치자 08-16 에 요청취소가 반려로 읽혔다.

[server-single-truth](server-single-truth.md)가 "클라이언트를 불신"한다면 이 패턴은 **"중복 구현을 불신"**한다 — 같은 판단이 두 곳에 있으면 반드시 드리프트한다([manual-sync-drift](manual-sync-drift.md)의 코드판 예방). 다만 반대편 규율도 같이 선다: 트랙 사이 **어휘·사전은 오히려 공유하지 않는다**([share-render-mirror-domain](share-render-mirror-domain.md)).

## Instances
- **2026-11-13~14 (판정의 주인이 리포 밖)** in [smartsmt-integration](../topics/smartsmt-integration.md) / [api-contract](../topics/api-contract.md) / [sp-vue-web](../topics/sp-vue-web.md): SmartSMT 견적은 금액·상태를 **바깥 서비스가 계산을 끝내** 보낸다. 그래서 sp-node 는 다시 계산하지 않고 받은 글자 그대로 보관·표시만 하고, 계약 [smartsmt.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/smartsmt.ts) 도 판정을 소유하지 않는다 — 필수 칸 몇 개만 검사하고 나머지는 `.passthrough()`, 코드 값은 `z.enum` 으로 막지 않는다. "계약이 업무 판정을 소유한다"가 우리가 만드는 값의 규칙이라면, 남이 만든 값은 **형태를 최소로만 붙잡고 원문을 보존한다**는 짝 규칙이다. 우리 쪽에 남은 판단은 둘이고 둘 다 임시다: ① "최신 견적" = **받은 순서**(SmartSMT 의 최신 판정 기준이 `made_at` 인지 미확인 — 확인되면 `saveSmartsmtQuote` 의 `latestQuoteId` 갱신 한 줄을 고칠 자리) ② 견적서 해석("최종 금액 = `quote.integrated.totals.total`, `quote.total` 은 SMT 작업비만, null = 미정 ≠ 0원")은 계약 함수가 아니라 서버 `summarizeSmartsmtEnvelope` 와 화면 `smt-envelope.ts` 가 **각자 읽는다** — 실제 견본이 아직 없어 해석이 바뀔 여지가 커 계약에 박지 않았다. 블록 사유가 "합계에 드는가"(`counted`)만 계약 사전 `SMARTSMT_BLOCK_REASONS` 한 곳이다
- **2026-11-13 (식별을 계약이 정한다)** in [api-contract](../topics/api-contract.md) / [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰 고객 답이 붙을 문항 번호를 계약 [market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) 의 순수 함수 둘이 정한다 — `devReviewQuestionId`(trim 한 문구의 FNV-1a 해시)·`withDevReviewQuestionIds`(있는 번호 유지·없으면 해시·겹치면 `-2`·`-3`). 서버와 고객 앱이 같은 함수를 부르고 **관리자 편집기는 받은 번호를 보존만** 한다(`cloneDevelopReview` 가 옮긴다). 번호 없는 옛 검토서도 읽는 쪽마다 같은 번호를 얻는다. 새 파일이 아니라 `market-dev-review.ts` 에 선 것은 `DevReviewOpenQuestion` 이 마켓·개발의뢰 공용 스키마라서다(마켓 저장분엔 없고 무시 — additive). 반대로 이벤트를 접어 '지금 답변'을 만드는 `foldDevelopQuestionAnswers` 는 이벤트를 읽는 쪽이 서버뿐이라 계약이 아니라 `apps/api/src/lib/develop-questions.ts` 에 있다 — 소비자가 하나면 계약으로 올리지 않는다
- **2026-10-30~11-06** in [api-contract](../topics/api-contract.md) / [sp-develop-web](../topics/sp-develop-web.md) / [sp-node-api](../topics/sp-node-api.md): 개발의뢰가 업무 판정을 계약 함수로 더 모았다 — 견적 산출 `computeDevelopQuoteBreakdown`(편집기·서버·인쇄·엑셀), 저장 분야 확정 `resolveDevelopServiceAreas`(위저드·등록·수정 — 서버가 답으로 분야를 정하고 숨은 답은 버린다), 제작 칸 정리 `normalizeDevelopProduction`, think 하한 목록 `DEVELOP_AREA_FOLLOWUP_THINK_LEVELS`(관리자 선택지·저장 검증·실행 보정이 한 목록을 본다), 시스템개발 범위 `developSystemExcludedAreas`(미커밋). AI 는 이 목록에 들지 못한다 — 판정에 쓰이는 질문은 AI 에 맡기지 않는다([ai-removable-layer](ai-removable-layer.md))
- **2026-10-11** in [api-contract](../topics/api-contract.md) / [partner-tracks](../topics/partner-tracks.md) / [sp-vue-web](../topics/sp-vue-web.md): **계약 순수 함수가 한날 넷** — `pcbMdQuoteAmount`·`roundPcbAmount`(서버 박제와 포털 미리보기가 따로 계산하면 1원·1센트가 갈린다 — 산식을 api 에서 계약으로 옮겼다) · `pcbShipConfirmPending`·`pcbShipmentSenderDone`(보드 건수와 완료 내역이 같은 함수) · `isPcbEqFileRecord`(파일을 지울 수 있는가) · `summarizePcbEqRounds`. 상태를 늘리지 않기로 한 값이 여기서 치러진다([record-not-state](record-not-state.md))
- **2026-10-11** in [sp-node-api](../topics/sp-node-api.md) / [partner-tracks](../topics/partner-tracks.md): PCB 견적 회신이 만들어지는 세 길(포털·매직링크·마스터딜러의 하위 선정)이 `notifyPcbRfqReplied` **하나**를 쓴다 — 셋째 길에만 통지가 없던 결함이 계기. 길이 늘 때 통지를 복사하면 하나는 빠진다
- **2026-10-10 (지금 어긋나 있는 곳)** in [sp-vue-web](../topics/sp-vue-web.md) / [partner-tracks](../topics/partner-tracks.md): 하위 협력사 메뉴 노출 — 서버 `canManageChildren` 과 [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) §5.1 은 "견적 트랙 중 하나라도"인데 `partner/menu.ts` 는 `requiresTrack: 'pcb'`. 판정이 두 곳에 있어 부품 조달만 하는 마스터딜러에게는 사이드바 메뉴가 안 뜬다(코드 읽기 기준). 10-09 `bomMdPoActionsFor`(서버 판정=화면 버튼)와 정확히 반대 꼴
- **2026-10-05** in [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md) / [sp-vue-web](../topics/sp-vue-web.md): 고객 견적의 삭제·취소 가능 상태를 계약 사전 하나(`BOM_QUOTE_CUSTOMER_DELETABLE_STATUSES`·`..._CANCELABLE_STATUSES`)로 — 화면 버튼과 서버 가드가 같은 값을 본다. 여정 25호가 "검토 중에는 화면엔 버튼이 있는데 서버가 거절"을 드러낸 뒤의 조치
- **2026-09-30** in [sp-node-api](../topics/sp-node-api.md) / [spcb-bridge](../topics/spcb-bridge.md) / [parts-engine](../topics/parts-engine.md): 결제 후 부품 확인(D43)의 결정 판정·저장은 `bom-confirm.ts` 한 곳(PHP 브리지·sp-vue 는 그리기만), "적용하면 품목이 바뀌는가·추가결제 확인이 필요한가"는 계약 `bomConfirmKindChangesItem`·`bomConfirmKindNeedsPayment`. 같은 날 엔진 쪽 — 후보 교체 사유는 **하나뿐**이라는 검증기 불변식을 엔진이 지키고 sp-node 는 사유 코드만 읽는다
- **2026-09-16** in [infrastructure](../topics/infrastructure.md) / [sp-node-api](../topics/sp-node-api.md): 운영 재이관 보존 정책의 정본이 파일 하나 `apps/api/src/scripts/migrate/lib/reset-data-policy.ts` — 보존/삭제/부분 보존(고정 결제 상품 7종)을 여기서만 판정하고, **분류되지 않은 테이블은 삭제하지 않고 중단**한다(fail-closed 의 운영판, [destructive-op-guardrails](destructive-op-guardrails.md))
- **2026-09-14** in [parts-engine](../topics/parts-engine.md): 수량 열이 없는 BOM 을 기본값 1 로 때우지 않고 엔진이 `quantityState='missing'` 으로 내려 화면이 재업로드·행별 입력을 안내. 기술 사양 개수 열(`outputs/channels/pins`…)을 수량으로 읽던 세 경로를 엔진 한 곳(`_TECHNICAL_COUNT_PAT`)에서 동시에 제외
- **2026-09-11** in [api-contract](../topics/api-contract.md) / [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 달성도·지연을 계약 순수 함수로 — `developTaskWeights`(기간 일수 가중)·`developProgressSummary`·`developOverdueTaskCount`. 단순 평균이 "착수회의 1일 = 펌웨어 18일"로 왜곡되던 것을 **입력 없이** 산식 하나로 막았다
- **2026-09-08** in [sp-market-web](../topics/sp-market-web.md) / [sp-develop-web](../topics/sp-develop-web.md): 분야 레지스트리를 `area-registry.ts` **팩토리 하나**로 분리해 `MARKET_REGISTRY`/`DEVELOP_REGISTRY` 를 파생 — 마켓 export 이름·시그니처·프롬프트·JSON 스키마는 바이트 동일. 라벨 정본도 계약 `DEVELOP_*_LABELS`(3앱 공유)이고 sp-vue i18n 이 복제하지 않는다
- **2026-09-04** in [api-contract](../topics/api-contract.md) / [shared-packages](../topics/shared-packages.md): `file-preview.ts` 의 `fileViewKind`·`needsServerPreview` 가 FE·서버 공유 — "무엇을 보여줄 수 있는가"의 판정과 응답 모양은 한 파일, 도메인별로 다른 것은 라우트·권한뿐. 갈리면 "보기 버튼은 있는데 열면 미지원"이 된다
- **2026-08-23** in [parts-engine](../topics/parts-engine.md): 협력사 보유 부품 후보도 **별도 폴백 티어를 만들지 않는다** — 외부 후보와 같은 matcher·같은 조달 정책을 쓰고, 기술 판정 동률일 때만 `_source_rank`(실공급사 0·로컬 카탈로그 1·협력사 2)로 뒤에 세운다. 2026-07-26 로컬 카탈로그(`catalog-evaluate-batch`, 외부 호출 0)에 이은 두 번째 적용
- **2026-08-17** in [api-contract](../topics/api-contract.md): 메탈마스크 트랙을 status 포크 없이 `resolvePcbPoTrack(category)` 로 가르고 어휘는 `pcbEqEventLabel(track)` 이 **트랙 정본** — 화면 하드코딩이 스텐실 대화를 'EQ 승인요청'으로 그리던 결함 교정. 포크했으면 워크큐·12단계·선적·MD·메일·e2e 31본이 두 벌이 됐다
- **2026-08-16** in [api-contract](../topics/api-contract.md) / [sp-node-api](../topics/sp-node-api.md): **`isPcbEqRejectionEvent` 하나로 반려 판정 단일화**. 반려·요청취소가 같은 전이라 `note` 유무로만 갈리는데 규칙이 다섯 곳에 복제된 것이 결함 **조건** 자체였다. 되돌리기는 note 를 남기지 않고, `PCB_EQ_REVERT_NOTE` 는 옛 이력 필터용으로만 남는다
- **2026-08-12** in [api-contract](../topics/api-contract.md): `pcbSellingPrice`/`pcbMarginPercent` 를 한 자리에 — VAT(`PCB_VAT_RATE 1.1`)를 빠뜨린 역산이 마진을 **10%p 부풀렸다**. 두 방향(정산·역산)을 같은 파일에 둬 한쪽만 고치는 일을 막는다
- **2026-08-11** in [api-contract](../topics/api-contract.md): 여정 재점검 교정 5건이 전부 계약 순수 함수로 착지 — `clampPcbProjectName`(191자, DB 에 맡기면 non-strict 는 조용히 자르고 strict 는 500 이라 **환경마다 갈린다**) · `isPcbDeliveryOverdue`(KST 자정 앵커, `iso.slice(0,10)` 은 하루 앞당긴다) · `orderPcbEqFiles`(`isLatest` 는 fileId 기준, `inquiry` 만 누적 예외) · `resolvePcbDirectShipCountry`(혼재는 보수적 null)
- **2026-08-07~25** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): 브리지 4종·extend 훅 6종의 헤더가 같은 문장을 반복 — **"판정·저장은 전부 sp-node, PHP 는 로그인·CSRF 만 본다. 두 곳에 복제하면 반드시 어긋난다."** 409 응답 문구까지 sp-node 것을 그대로 실어 되돌린다. 유일한 예외가 **"세기≠판정"** — 사이드바 배지 건수만 DB 를 직접 count 하고(모든 계정 페이지가 렌더하므로) 주석이 "판정이 아니라 세기다"라고 못박는다
- **2026-08-04** in [parts-engine](../topics/parts-engine.md): 화면이 "Any Vendor" 구분을 필요로 하자 sp-vue 가 매칭 점수·문구로 추측하게 두지 않고 **엔진에 `search_scope` 필드부터 만들었다**(검색 스키마 1.10, 4범위). "판단이 원본에 없으면 원본을 고친다"의 실제 사례

## What This Means
"이 판단을 여기(sp-node/sp-vue/PHP)서도 하면 되지 않나"가 나오면 위반 신호다. 필요한 판단이 없으면 응용 계층에서 추측·보완하지 말고 **소유 계층부터 고친다** — 당장 비용이 커 보여도 중복 판단의 드리프트 비용이 더 크다는 것이 이 코드베이스의 반복된 결론이다.

판단 공유가 허용되는 형태는 **셋뿐**이다:
1. **같은 함수를 공유** — `@sp/utils`(`spec-units`·`bom-pricing`·`kst-date`)를 FE/BE 가 함께 import 하고 골든 벡터가 명세 노릇을 한다([golden-as-spec](golden-as-spec.md)).
2. **계약 순수 함수** — `@sp/api-contract` 가 사전·라벨·판정을 한 파일에 담고 서버 라우트와 Vue 화면이 같은 import 로 부른다. 회귀 테스트는 패키지 밖(`apps/api/src/lib/*.test.ts`·`packages/utils/*.test.ts`)에 있으니 함수를 옮길 땐 그 자리도 같이 본다.
3. **버전 있는 계약 필드** — 엔진 `decision`(`supplier-candidate-decision-v3`)·`search_scope`·trace 처럼 판정 결과를 버전 붙은 필드로 전달. `decision` 이 없는 후보는 옛 자체 규칙으로 복구하지 않고 **차단**(fail-closed)한다.

어느 쪽이든 **재구현은 없다**. 엔진 장애 시에도 판단을 대행하지 않고 stale 축퇴(기존 선택 보존)로 흡수하며, 분류 못 한 것은 처리하지 않고 멈춘다. 반대로 이 패턴이 "전부 공유하라"는 뜻은 아니다 — 값이 같아 보여도 트랙·도메인 사전은 교차 import 하지 않는다(`pcb-claim` vs `bom-claims`, `DEVELOP_BUDGET_RANGES` vs `MARKET_BUDGET_RANGES`). 공유하는 것은 **판정**이고, 나누는 것은 **어휘**다.

11월 중순에 경계가 둘 그어졌다. ① **판정의 주인이 리포 밖이면 우리는 소유하지 않는다** — SmartSMT 견적은 다시 계산하지 않고 원문을 보관하며, 계약은 형태만 최소로 붙잡는다. 이것은 이 패턴의 예외가 아니라 연장이다: "단일 소유"의 소유자가 바깥에 있을 뿐이고, 우리가 재계산하면 그 순간 판정이 둘이 된다. 다만 우리 쪽에 남은 **해석**(어느 칸이 최종 금액인가)은 지금 서버·화면 두 곳이 따로 읽는다 — 실제 견본이 오기 전이라 일부러 계약에 박지 않은 것이고, 견본이 와서 해석이 굳으면 계약 함수 하나로 모을 자리다. ② **식별도 판정이다** — 고객 답이 어느 문항에 붙는지는 번호가 정하므로, 번호 만들기를 계약 함수 하나에 두고 편집기는 보존만 한다. 계약으로 올리는 기준도 드러났다: 소비자가 둘 이상(서버·고객 앱)이면 계약, 하나(이벤트를 접는 서버)면 그 쪽 `lib/`.

## Sources
- [api-contract](../topics/api-contract.md)
- [parts-engine](../topics/parts-engine.md)
- [sp-node-api](../topics/sp-node-api.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [sp-vue-web](../topics/sp-vue-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-market-web](../topics/sp-market-web.md)
- [infrastructure](../topics/infrastructure.md)
- [partner-tracks](../topics/partner-tracks.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [smartsmt-integration](../topics/smartsmt-integration.md)
- [docs/SMARTSMT_INTEGRATION.md](../../docs/SMARTSMT_INTEGRATION.md) — §2 금액 읽는 법 · §4.3 계약(느슨하게) · §6-4 최신 판정 기준(미확인)
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.2.13 문항 번호·고객 답변
- [packages/api-contract/src/schemas/market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) — `devReviewQuestionId`·`withDevReviewQuestionIds`
- [apps/api/src/lib/develop-questions.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-questions.ts) — `foldDevelopQuestionAnswers`(서버 전용)
