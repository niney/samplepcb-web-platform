---
topic: api-contract
last_compiled: 2026-09-19
sources_count: 71
status: active
---

# api-contract

## Purpose [coverage: high — 6 sources]

`@sp/api-contract`(위치: `samplepcb-web-mono-app/packages/api-contract`)는 **Zod 스키마 + 추론 타입 + 라우트 상수 + 코드 사전(한글 라벨) + 순수 판정 함수**를 담은 FE/BE 공통 계약 패키지다. 소스 시점은 코드 2026-06-30(첫 파일)~2026-09-18(`parts.ts` 최근 커밋), 문서 2026-07-10(SEO)~2026-09-16(SMARTBOM). 직전 컴파일(2026-07-27) 시점의 합의는 "스키마·라벨의 단일 진실원본"이었고, 그 뒤 160커밋(07-27~09-18)으로 파일 18→44개·`apiRoutes` 27→67종·약 16,000줄·export 2,300여 개로 자랐다.

**최근 합의(08~09월)는 한 단계 더 나아가 "판정을 계약이 순수 함수로 소유한다"**([judgment-single-owner](../concepts/judgment-single-owner.md)의 계약 인스턴스)는 것이다 — EQ 반려 판정·이벤트 어휘·납기 경과·프로젝트명 절단·주문 진행 병합·발주 마진 역산 같은 규칙을 서버·관리자 화면·포털·메일이 **같은 함수 하나**로 답하게 하고, 화면마다 복제된 규칙이 어긋나던 결함(2026-08-16 EQ 요청취소가 반려로 읽힘)을 구조로 막는다. AGENTS.md 규칙 "API 요청/응답 스키마는 반드시 `@sp/api-contract`(Zod)에 정의하고 FE/BE 양쪽이 import"는 그대로이며, 재능마켓·개발의뢰 코드 사전, NDA 원문, 분야 레지스트리, sp-engine(Python) pydantic 출력의 TS 미러도 여전히 여기가 정본이다.

## Architecture [coverage: high — 12 sources]

- **빌드 없는 src 직접 노출**(불변): `package.json`의 `main`/`types`/`exports` 전부 `./src/index.ts`. 런타임 의존은 `zod ^3.24`뿐, devDeps `@sp/config`·`typescript ^6.0.3`·`eslint ^10`. 스크립트는 `typecheck`·`lint`만 — **패키지 안에 테스트가 없다**(순수 함수 회귀는 `apps/api/src/lib/*.test.ts`·`packages/utils/*.test.ts`에 산다, Gotchas 참조).
- `src/index.ts`는 41줄 배럴로 41개 스키마 파일 + `routes.ts`를 순서대로 re-export — 순서가 곧 도메인 계층이다:
  1. 기반: `common`(`ApiError`·`BizError`·`DateOnly`) · `auth`(`Me`·`MeContact`·`JwtClaims`)
  2. 거버·관리자 코어: `pcb-project` · `admin` · `members` · `orders` · `settings` · `slides` · `seo`
  3. BOM 엔진·카탈로그·고객 견적: `bom`(엔진 미러, 07-25 이후 불변) · `parts` · `bom-quote`(1,728줄, 최대)
  4. **BOM 파트너 트랙**(07-29~): `bom-rfq` · `bom-po`(1,060줄, 선적·패키지 포함) · `bom-receiving` · `digikey`
  5. **PCB 파트너 트랙**(08-04~): `pcb-rfq` · `pcb-po`(1,404줄) · `pcb-orders` · `pcb-cases` · `pcb-remittance` · `pcb-eq-review` · `order-progress` · `pcb-as-case` · `pcb-claim`
  6. 주문 축·클레임·조직: `bom-orders` · `bom-claims` · `partner` · `partner-parts`
  7. 재능마켓·AI: `market`(1,222줄) · `ai` · `market-dev-review` · `market-dev-diagram` · `market-areas`
  8. **개발의뢰**(09-05~): `develop-areas` · `develop-followup` · `develop`(1,135줄) · `develop-docs`(837줄)
  9. 횡단: `admin-mail`(빠른 메일+발송 이력) · `file-preview`(도메인 중립 미리보기) · `routes`
- **파일 내부 3층 관례**: ① 코드 사전 `X_STATUSES as const` → `z.enum` → `X_LABELS ... satisfies Record<…, string>` ② Zod 바디·뷰·응답(`{ result: true, data }` 봉투, `...Type` 추론 타입) ③ 순수 함수(판정·라벨·산식). 사전 → 라벨 → 판정이 한 파일 안에 있어 "라벨만 고치고 판정은 안 고치는" 사고를 줄인다.
- **import 그래프**: `area-registry.ts`·`develop-followup.ts`는 스스로 "leaf — zod 외 import 없음"을 선언. `pcb-po` → `pcb-eq-review`·`pcb-rfq`·`bom-po`(선적 사전 공유)·`common`; `order-progress` → `pcb-eq-review`(`PCB_PROGRESS_STAGES`); `develop` → `market`·`market-areas`·`develop-areas`·`market-dev-review`·`market-dev-diagram`·`develop-followup`·`develop-docs`; `ai` → 검토서·구성도·후속질문·문서메일 4파일. 트랙 사이 사전은 **값이 같아도 공유하지 않는다**(`pcb-claim.ts` 헤더: "BOM 사전은 불변 — PCB 계약은 여기 따로 선다").
- 데이터 흐름(불변): **DB(Prisma)·sp-engine(pydantic) → API(Fastify, `fastify-type-provider-zod`) → 계약 → Vue(@tanstack/vue-query)**. 판정 함수는 이 흐름의 **양끝(서버 라우트·Vue 화면)에서 같은 import**로 호출된다.

## Talks To [coverage: high — 10 sources]

- **sp-node (`apps/api`, 165파일 import)**: 모든 라우트가 Zod type-provider 로 요청 검증·응답 타입에 사용. 판정 함수 소비처 예: `lib/pcb-po.ts`·`lib/pcb-customer-progress.ts`·`routes/pcb-projects.ts`(`clampPcbProjectName`). 상세는 [sp-node-api](sp-node-api.md).
- **sp-vue (`apps/web`, 213파일)**: 관리자 `/app/admin/*`(PCB Case·발주·워크큐·스마트BOM·메일 로그·개발의뢰)·회원 `/app/bom`·**협력사 포털 `/app/partner/**`**(BOM/PCB 모듈+공통 영역, 3개 국어 — 계약 라벨은 번역 대상이 아니라 포털이 자체 `partner/locales` 원문 키를 쓴다, [partner-i18n](../../docs/partner-i18n.md)). `PcbEqTimeline.vue`·`AdminPcbCase.vue`·`AdminPcbPos.vue`·`PartnerPcbPoDetail.vue`가 `pcbEqEventLabel`·`orderPcbEqFiles`·`isPcbDeliveryOverdue`를 직접 호출. [sp-vue-web](sp-vue-web.md) · [partner-tracks](partner-tracks.md).
- **sp-market (`apps/market`, 31파일, [sp-market-web](sp-market-web.md))** — 의뢰 위저드 v3(분야 레지스트리·공통 조건 6·검토서·정밀 구성도) · **sp-develop (`apps/develop`, 28파일, `/develop/`, 09-05 신설)** — 개발의뢰 위저드 v2·후속 질문·문서·업무표, [sp-develop-web](sp-develop-web.md).
- **`@sp/shared`**(3, [shared-packages](shared-packages.md)) `api-client.ts`가 `BizError` 두 형태를 정규화 · **`@sp/ui`**(5) `DevReviewView`·`DevDiagramSection`·`FilePreviewModal`·`QuestionField`·`lib/file-preview.ts` · **`@sp/utils`**(10) `bom-quote-presentation`·`dev-review-diff`·`dev-review-view` + 레지스트리·문서·견적 산식 테스트, `kst-date.ts`(납기 판정의 KST 전제 근거).
- **sp-php 미러(코드가 아니라 사람이 맞추는 동기)**: `ORDER_STATUS_CUSTOMER_LABELS`는 `extend/sp_order_status.extend.php sp_order_status_customer()`의 **사본**(PHP가 정본 — Node가 죽어도 주문내역을 그려야 해서); 배송방법은 `od_delivery_company`에 한글 라벨을 병용 기록해 `/adm`·`order-notify.php`·고객 주문조회가 0줄 수정으로 호환; EQ 고객 확인 뷰의 `ctId`가 sp-php 주문내역 행 조인 키.
- **sp-engine**([parts-engine](parts-engine.md)): `bom.ts`는 여전히 pydantic 미러(형태만 고정). `partner-parts.ts` 열 역할 12종은 엔진 inventory 프로필 `_INVENTORY_ROLES`와 같은 어휘. 후보 판정 계약(`selection_eligibility`·`match_relation`)은 [sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md) 프롬프트가 엔진 쪽 정본.
- **외부 API 형태 고정**: DigiKey 3-legged OAuth 상태·바코드 조회(`digikey.ts`) · Mouser 고정 CartKey 재충전·대조(`bom-po.ts` `BomPoExternalRef`) · ECIA 2D 라벨 파싱 필드(`bom-receiving.ts`) · 무계정 협력사 매직링크 회신(`pcbRfqReply` 라우트). AI 잡은 `sp_ai_job`(DB) 폴링 — [in-memory-async-jobs](../concepts/in-memory-async-jobs.md)와 달리 재시작에 견딘다.

## API Surface [coverage: high — 41 sources]

**common / auth**
- `ApiError` · `BizError = { result:false, error } | ApiError`(08-23) · `DateOnly`(정규식 + 2월 30일 거부) · `ApiMemberError` · `HealthResponse`.
- `Me` · `MeContact`(09-10, JWT엔 안 넣고 `/api/me/contact`로만 조회, 형식 오류는 의뢰 제출 시 검증) · `JwtClaims`(`iat`/`exp` 필수, `cartId` optional).

**BOM 파트너 트랙**
- `partner.ts`: `PartnerAccessResponse.tracks{bom,pcb,parts}`(parts는 모듈이 아니라 공통 영역) · `PARTNER_TYPES` partner|supplier|house · `PARTNER_STATUSES` pending|approved|suspended(rejected 없음 — 등록 원천이 관리자/이관) · `PARTNER_CAPABILITIES` bom_rfq|pcb_rfq|part_sale · 멤버 역할·MD 소속 관리.
- `bom-rfq.ts`: 상태 requested|quoted|closed · `BomRfqItemReplyInput`(replyQty ≥ MOQ refine, 합계는 서버 `effectiveRfqReplyQty` 재계산 §6.38, PUT = 문서 단위 replace-all) · `ADMIN_BOM_LIVE_SUPPLIERS`(회신 비교에서 공급사 최신 시세 동시 선정).
- `bom-po.ts`: 발주 issued|confirmed|closed(박제 문서) · 부족 사유 5종·대체발주 `BomPoShortageRecoveryView`(D31) · `BomPoExternalRef`+`bomPoExternalCheckStale`(10분 신선도) · 선적 국제 6/국내 3상태 · `BOM_SHIPMENT_ACTORS` · `bomShipmentNext/Prev/ActorOf/StatusLabel/DocumentsLocked` · **운송수단 `SHIPMENT_TRANSPORTS` air|sea(BOM·PCB 공용) + `shipmentTransportOf`/`shipmentTransportDocType` AWB↔B/L** · 부품 패키지 상태·이벤트·액션 · 선적 첨부 3종.
- `bom-receiving.ts`: `BomReceivingParsedBarcode(format:'ecia2d')`·필드 12종(30P/1P/Q/K/1K/10K/11K/4K/1T/9D/4L/1V) · 후보 매칭 supplierSku|mpn · 스캔 원장 void · 전량 스캔 시 선적 없이 입고 완료(D42 2단계).
- `digikey.ts`: 연결 상태(`configured/connected/redirectUri/…`) · OAuth 시작 URL · 바코드 조회 2d|1d.
- `bom-orders.ts`(전부 파생, 주문:Case 1:N) · `bom-claims.ts`(D37 — 4상태·5유형·4처리·자격 사유).

**PCB 파트너 트랙**
- `pcb-rfq.ts`: 상태 requested|quoted|selected|unselected · 통화 `KRW|USD|CNY`(링크당 한 통화, 환율은 변환점에서만 박제) · `PcbRfqReplyBody`(납기 필수, 입력≠결제통화만 sub_* 원본) · MD 하위 선정 바디 · `PCB_VAT_RATE 1.1` + **`pcbSellingPrice`/`pcbMarginPercent`** · 워크큐 탭 5(협력사 축 4 + 고객 축 `awaiting_price`, 08-12).
- `pcb-po.ts`: `PCB_PO_STATUSES` issued→eq_requested→eq_done→producing→produced · `PCB_PO_TRACKS` eq|stencil(`resolvePcbPoTrack(category)`) · `PCB_PO_FULFILLMENT_MODES` self|delegated(건별 박제) · 결제조건 NET7/사용자 지정일·송금 예정일 · EQ 파일 5종 eq|working|reply|coord|inquiry(+고객 열람은 `coord`만) · `canEditPcbEqFile` · `pcbStencilSubmitBlockers`(좌표파일 필수, 문의는 선택).
- `pcb-po.ts` 판정 함수: **`orderPcbEqFiles`**(isLatest=fileId 기준·inquiry 누적 예외·afterReject) · **`isPcbEqRejectionEvent`·`lastPcbEqRejection(At)`·`pcbEqEventLabel(track)`·`lastPcbStencilInquiry`** · `pcbEqForward/Revert/RejectActionLabel` · **`isPcbDeliveryOverdue`·`resolvePcbDirectShipCountry`**.
- `pcb-po.ts` 선적·뷰: 발송 참조번호(Case ID) 갈래·박스 모델·QR 라벨·검사 성적서 첨부 · `AdminPcbPoView.partnerHasPortal`(대행 필요 배지 — 발주 이후 한정, RFQ는 매직링크라 자력 가능) · 워크큐 탭(`ADMIN_PCB_PO_TABS`·`ADMIN_PCB_SHIPMENT_TABS`).
- `pcb-orders.ts`: od 탭 5 + 고객 배송 큐 2(`to_ship`/`shipping`, 판정은 od 문자열이 아니라 입고확인 receivedAt) · SQL 페이지네이션 전제(이관 2만 건) · 취소 차단 사유.
- `pcb-cases.ts`: 탭 7 = 구간 5 + 대기 큐 `todo_rfq`/`todo_po` · **`PCB_STEPS` 12단계 파생 타임라인**.
- `pcb-remittance.ts`: 1:N 원장 · 상태 unpaid|partial|paid|over · 통화=발주 통화 고정 · 실제 환율 별도 박제 · 증빙 파일 · 협력사 수금 현황 뷰(`isFreeAs` 무상 A/S 제외).
- `pcb-eq-review.ts`: 고객 확인 requested|approved|rejected|canceled · 관리자/고객/`mine?scope=open|all` 뷰(결정 UI 없음 — 주문 상세 딥링크) · `PcbPoEqReviewSummary`(발주 행 요약) · `PCB_PROGRESS_STAGES` 7칸.
- `pcb-as-case.ts`(5상태 draft→…→proceeded, `defaultPcbAsCharge`, 회차는 proceed 시 채번) · `pcb-claim.ts`(4상태·5유형·희망처리 3·귀책·처리·자격 사유·이벤트).

**주문 진행·주문·관리자**
- `order-progress.ts`: `BOM_PROGRESS_STAGES` 6 + PCB 7 → `OrderProgressStage` · `CustomerOrderProgressItem`(라벨은 서버 완성, `partial` 플래그, 협력사명 비노출) · batch ≤50 odIds · `ORDER_STATUS_CUSTOMER_LABELS`·`ORDER_STATUS_PROGRESS_APPLIES`·**`mergedOrderCustomerLabel`**.
- `orders.ts`: **`DeliveryMethod`** parcel|quick_cod|quick_prepaid(예약)|pickup|direct · `SELECTABLE_DELIVERY_METHODS` 4 · `isParcelDeliveryMethod(''|'parcel')` · `deliveryCompanyForMethod`(비택배는 표준 라벨 강제) · 택배만 송장 필수 refine · 상태 전이 processed/skipped · 환불 기록 창구(`od_refund_price`).
- `admin.ts`: `AdminSpecReviseBody`(전 필드 허용, 블로커 `PO_ISSUED`·`REQUOTE_RFQ_IN_CART`) · 삭제 차단 사유·경고 문구 사전 · `AdminQuotePcbRfqSummary` enrich · preorder 탭 회수(08-05).
- `admin-mail.ts`: 빠른 메일 템플릿·컨텍스트·첨부 상한 + **`MailLogChannel` email|alimtalk|sms · `MailLogStatus` sent|failed|skipped** 목록(`hasBody`만)/단건/재발송.

**협력사 보유 부품(`partner-parts.ts`)**
- 열 역할 12·업로드 상태·모드 사전 · 정규화 플래그 라벨 + `partnerPartVisibleFlags`(manually_edited는 배지가 말하므로 칩 생략) · `PartnerPartConfig.staleAfterDays`(만료 아닌 표시 기준) · 카탈로그 투영·단일검색 Distributor 보유 협력사명 공개(08-27).

**재능마켓·개발의뢰·AI**
- `area-registry.ts`: `createAreaRegistry(config)` 팩토리(질문 `kind` choice|text, `withUnknown`, `isMarketAnswered`, 첨부 슬롯 필드명 `marketAttachmentField`).
- `market-areas.ts`: `MARKET_AREAS`·`MARKET_COMMON_CONDITIONS`(2스텝 필수 6)·`MARKET_FULL_AREA_QUESTION_CAP`·`MARKET_REGISTRY` — 분야 코드는 **문자열+레지스트리 검증**, z.enum 아님.
- `market-dev-review.ts`: `DEV_REVIEW_VERSION 4`(구성도 분리) · 근거 붙은 사실만(`DevReviewFact.evidence`) · 일정 `devReviewScheduleTotals/Fit`·희망 시점 코드 · `buildDevReviewLlmJsonSchema`.
- `market-dev-diagram.ts`: 상태 queued|running|done|error|skipped · 살균 감사 `MarketDevDiagramAudit`(strippedNodes·ungroundedTokens) · sandbox iframe 렌더 전제.
- `market.ts`: 기존 사전 + **의뢰 수정 이력**(`MARKET_REVISION_FIELDS` 9, `isMajorMarketRevision` 5필드, 마감 24h 이내면 48h 연장) · 첨부 화면 열람.
- `develop.ts`: 의뢰 방식 system|individual · 예산 6구간(마켓과 별개) · 진행 상태·견적 종류·VAT 모드·마일스톤 트리거·이벤트·관리자 탭·신호 사전 · `resolveDevelopServiceAreas` · **`parseDevelopQuoteLines`(`3,600,000원`·`320만원` 파서)·`computeDevelopQuoteAmounts`(included 역산)·`splitDevelopMilestoneAmounts`(반올림 차액 마지막 흡수)** · 검토서 버전 원장.
- `develop-areas.ts`: 개별 4분야·시스템개발 6분야 · `DEVELOP_SYSTEM_QUESTIONS`(서술 3 + 디자인·기구 범위 2) · 기구설계(mech) 신규(MCAD 툴 6).
- `develop-followup.ts`: v1 · 질문 ≤8·선택지 ≤6 · `unknown` 탈출구 · 서버가 잡에서 문항을 다시 읽는다.
- `develop-docs.ts`: 문서 5종 `KO|REV|CR|DC|PR`(+레거시 8종 파싱) · 결정 블록·필드 스펙·읽기 전용 키 · 업무표 단계·상태 · **`developTaskWeights`(기간 일수 가중)·`developProgressSummary`·`developOverdueTaskCount`** · 메일 초안 빌더 `buildDevelopDocMailDraft`.
- `ai.ts`: `AI_USECASES` 6 = market.dev-review|dev-diagram · develop.dev-review|dev-diagram|followup|doc-mail · `AI_THINK_LEVELS`(+max, 타임아웃 2배) · `AiRunResponse{jobId, diagramJobId, diagramSkipReason, cached}` · `AiJobStage` 5 · apiKey 원문 무노출.

**file-preview.ts** — `FILE_VIEW_KINDS` image|pdf|text|sheet|doc|archive|none · `fileViewKind`·`needsServerPreview`·`resolveFileMime`·`parseDelimited`·`delimiterFor` · 상한 상수 6종. SVG는 `<img>`로만(iframe은 origin 상속으로 토큰 유출), html은 소스만.

**routes** — `apiRoutes` **67종**: 기존 27 + `meContact`·`pcbPricing` · BOM 발주/선적/입고/DigiKey/패키지/클레임/주문 · `partner{Access,Rfqs,Pos,Shipments,Parts,PcbRfqs,PcbPos,PcbRemittances,PcbShipments}` · `adminPcb{Rfqs,ExchangeRate,Pos,Shipments,Packages,Orders,Cases,Remittances,EqReviews,Claims}` · `pcbRfqReply`(매직링크) · `pcbEqReviews`·`pcbClaims`(고객) · `develop{Requests,MyRequests}` + `adminDevelop{Requests,Quotes,Milestones,Documents,Files,Settings}`. BOM 포털은 `/api/partner/rfqs`, PCB 포털은 `/api/partner/pcb-rfqs`로 경로가 갈린다.

## Data [coverage: high — 8 sources]

- **DB에는 영문 코드, 라벨은 계약 사전**(SMARTBOM D10 · PCB D4): 한글 리터럴 저장 금지 — 레거시 '상태 3종 혼동'·한글 오염의 뿌리. quote.status(굵은 단계)와 RFQ/PO/선적 status는 **별개 계층**이며 같은 문자열을 겹쳐 쓰지 않는다.
- **박제 문서·통화 규율**([snapshot-freeze](../concepts/snapshot-freeze.md)): 발주서는 생성 시점 스냅샷·불변, 부족분은 별도 감사 원장(D31). 송금 통화는 발주 통화로 서버가 고정하고 KRW 환산은 **실제 적용 환율**로 따로 박제. RFQ 회신은 입력통화 원본을 sub_* 에 남기고 결제통화 정본을 박제. BOM 견적의 `orderQty`·`selectedOffer` 스냅샷 원칙과 `exchangeRateSnapshot` RFQ 후 동결은 유지.
- **저장 상태가 아니라 파생인 것**([lazy-derived-state](../concepts/lazy-derived-state.md)): `PCB_STEPS` 12단계·`order-progress` 칸·`bom-orders.ts` 전부·워크큐 대기 큐(`todo_rfq`/`todo_po`)·`partnerHasPortal`·`overdue`·`isLatest`/`afterReject` — 서버가 원장(RFQ·PO·선적·od·sp_file)에서 계산해 내려주고 FE는 라벨만 붙인다. PATCH로 왕복시키지 않는다.
- **라벨은 서버가 완성**: `CustomerOrderProgressItem.label/shortLabel`은 PHP·화면이 그대로 출력(협력사명·발주가·협력사 수는 싣지 않는다 — 공급망 비노출 관례, 여정 43호). EQ 고객 확인 뷰도 발주서·협력사·회차를 노출하지 않는다.
- **레지스트리 검증 문자열**: 마켓·개발의뢰 분야 코드는 `z.enum`이 아니라 문자열 + 레지스트리 검증 — 분야를 빼도 옛 저장분 파싱이 깨지지 않고 라벨만 "(종료)". 답변은 평면 배열 하나, 분야는 `${area}.${name}` 코드 접두로 안다.
- **파일 원장**: 전 도메인이 `sp_file`(refType별 — `sp_pcb_po_eq`·`sp_bom_shipment`·`sp_pcb_remittance`…)을 쓰고 계약은 `{fileId,name,size(,fileType,uploadedBy,uploadedAt)}` 뷰로 통일. EQ 첨부는 **누적 보존**(덮어쓰기 불가역), 선적 첨부는 종류별 1건 교체 — 규칙이 다르다.
- 응답 봉투 `{ result: true, data }`·업무 오류 `BizError` 두 형태 · 마켓/개발의뢰는 코드만 저장(Json 배열), 라벨은 계약 상수. 계약 패키지는 여전히 DB를 모른다(Prisma는 sp-node 소유).

## Key Decisions [coverage: high — 20 sources]

- **2026-09-18 — 공급사 확인 후 최종 후보 유지(`parts.ts`)**: `BomPartHit`에 선택 필드 `searchMatch`·`engine.incompleteSuppliers` 추가. `waitForCatalog=true` 완료 응답의 구매 조건 있는 후보 id는 실제 카탈로그 ID.
- **2026-09-11 — 개발의뢰 문서 8종→5종·기간 가중 달성도(`develop-docs.ts`)**: 착수회의록+계약서 → 「계약·개발착수 확인」(계약부는 수락 견적 스냅샷 읽기 전용), 검토 3종 → 「단계별 검토·승인」 1종, 수행계획 → 의뢰 컬럼 3개. 단순 평균의 왜곡(착수회의 1일 = 펌웨어 18일)을 `developTaskWeights`가 입력 없이 막는다.
- **2026-09-08 — 분야 레지스트리 팩토리 분리(`area-registry.ts`)**: 마켓 `MARKET_REGISTRY`와 개발의뢰 `DEVELOP_REGISTRY`가 같은 모양·다른 분야. 개발의뢰 메뉴 = 시스템개발(6분야 전부 저장, 서술 3문항) vs 개별 견적(4분야). `develop.followup` AI 후속 질문(문항은 서버가 잡에서 다시 읽는다) · `AI_THINK_LEVELS`에 max.
- **2026-09-05 — 개발의뢰 계약 신설(`develop.ts`)**: 마켓과 **테이블·상태 어휘 분리**(전문가·입찰 없음, 관리자가 AI 를 돌리고 항목별 견적), 검토서·구성도 JSON은 마켓 스키마 재사용. 견적 라인 파서·VAT 3모드·마일스톤 분배가 순수 함수.
- **2026-09-04 — 도메인 중립 첨부 미리보기(`file-preview.ts`)**: "무엇을 보여줄 수 있는가"의 판정과 응답 모양은 한 파일, 도메인별로 다른 것은 라우트·권한뿐. 같은 날 검토서 v4(구성도를 `market-dev-diagram.ts`로 분리, 비동기)·의뢰 수정 이력(중대 5필드만 입찰자 경고·마감 자동 연장)·레지스트리 v3(공통 조건 6 필수).
- **2026-08-28/29 — AI 유스케이스 재작성(`ai.ts`)**: 4산출물(구성도·명세·ROC·포스팅)+rnd 실험 폐기 → **AI 사전 검토서 1종**. 프롬프트는 코드 정본(버전 태그)이라 관리자 설정에서 사라짐. `docs/AI_DIAGRAM.md`는 경위 기록으로만 남는다.
- **2026-08-25 — 주문 진행을 트랙 공용 파생으로(`order-progress.ts`)**: PCB(P4.13/P4.14)가 깔아 둔 "협력 트랙 파생 → 목록·줄·카드 병합" 배관을 BOM까지 넓힘(고객은 입금→입고 다섯 단계를 전부 '입금완료'로 봤다는 §6.35 실측). `ORDER_STATUS_CUSTOMER_LABELS`는 PHP 정본의 사본으로 두고 **양쪽 동시 수정** 규칙 명시. 고객 견적 상태 라벨 3벌 → `BOM_QUOTE_CUSTOMER_STATUS_LABELS` 1벌.
- **2026-08-23 — `BizError` 두 형태 union(`common.ts`)**: 봉투형과 sensible 표준형을 한쪽만 선언하면 409/502가 **500으로 뒤바뀌던** 실측 결함 교정. 같은 날 협력사 보유 부품 원장(`partner-parts.ts`, 만료·RFQ 제한 없음 — 나이를 보이고 뒤처리 도구) · `tracks.parts` 공통 영역.
- **2026-08-22 — 외부 공급사 접점 계약화**: Mouser 고정 CartKey 재충전·live 대조(D41, `BomPoExternalRef`) · ECIA 2D 라벨 로컬 파싱 + 입고 스캔 원장(D42, DigiKey Barcoding은 3-legged 전용이라 `digikey.ts` OAuth 연결).
- **2026-08-17 — 배송방법 5값 + 한글 라벨 병용(`orders.ts`)**: 코어에 없는 개념을 신설 컬럼 `od_delivery_method` + `od_delivery_company` 표준 라벨 병용으로 넣어 PHP 0줄 호환([core-nonmodification](../concepts/core-nonmodification.md)). 같은 날 스텐실 문의 선택화·`inquiry` 누적 예외·`pcbEqEventLabel`을 **트랙 정본**으로(화면 하드코딩이 스텐실 대화를 'EQ 승인요청'으로 그리던 결함).
- **2026-08-16 — EQ 반려 판정 단일화 `isPcbEqRejectionEvent`**: 반려와 요청취소는 같은 전이(eq_requested→issued)라 **note 유무로만** 갈린다. 규칙을 네 곳에 복제해 뒀던 것이 결함 조건(고칠 때 한 곳만 고쳐짐) → 판정은 이 함수 하나, 되돌리기는 note를 안 남기고 `PCB_EQ_REVERT_NOTE`는 옛 이력 필터용으로만. 같은 날 `PCB_PO_TRACKS` eq|stencil — **status 5단계를 포크하지 않고** 라벨·게이트만 가름(포크하면 워크큐·12단계·선적·MD·메일·e2e 31본이 두 벌) · `SHIPMENT_TRANSPORTS` air|sea BOM·PCB 공용(AWB↔B/L은 carrier 문자열로 역추론 불가).
- **2026-08-15/18 — PCB 클레임(P5)·이행 방식**: `pcb-claim.ts`는 BOM 클레임의 미러이되 **사전은 트랙별 격리**. `PCB_PO_FULFILLMENT_MODES` self|delegated는 조직 역할이 아니라 **발주 건별 박제**(같은 MD가 건마다 다르게).
- **2026-08-11 — 여정 재점검 교정 5건이 계약 순수 함수로**: `clampPcbProjectName`(191자, strict 여부로 환경마다 갈리는 DB 대신 우리가 자르고 말줄임표) · `orderPcbEqFiles`(최신=fileId, writeDate는 같은 초에 갈리지 않음; 반려 뒤 새 파일 없음 경고 `afterReject`) · `isPcbDeliveryOverdue`(produced부터는 지연 아님·납기 null은 지연 아님·날짜만 비교) · `resolvePcbDirectShipCountry`(입고 신호를 만든 발주 기준, 혼재는 보수적 null) · 환불 기록 창구(`od_refund_price` 코어 필드 공유).
- **2026-08-07 — 관리자 사양 수정·메일 원장·EQ 고객 확인**: `AdminSpecReviseBody`는 전 필드 허용(막는 대신 대가를 보여줌, D14와 같은 결)·블로커 2종. `sp_mail_log` 전 채널 원장 계약(`admin-mail.ts`). `pcb-eq-review.ts`: 고객은 발주서를 모른다 — 고객 승인은 관리자 eq_done 전이의 근거일 뿐.
- **2026-08-06 — 송금 원장(`pcb-remittance.ts`)**: 상태 한 칸이 아니라 1:N 원장(부분·분할 송금 실재), 통화는 발주 통화 고정.
- **2026-08-04 — PCB 파트너 트랙 계약 신설(`pcb-rfq.ts`·`pcb-po.ts`)**: 부품행 없는 단일가 문서, 앵커 `sp_order_spec`, 통화 3종·MD 2단 1차 포함, D4 영문 코드+라벨. 발주 status가 EQ·생산 5단계 머신을 겸함(레거시 승계). 08-12: `pcbSellingPrice`/`pcbMarginPercent` — VAT 빠뜨린 역산이 마진을 10%p 부풀리므로 두 방향을 한 자리에.
- **2026-07-29~30 — BOM 파트너 트랙 계약(`partner.ts`·`bom-rfq.ts`·`bom-po.ts`·`bom-orders.ts`)**: 조직/계정/자동화 3축, D10 한글 리터럴 금지, RFQ는 quote.status와 별개 하위 계층, 선적 핑퐁 `BOM_SHIPMENT_ACTORS`는 서버 인가(레거시는 프론트만 검증). 08-02 국내도착 주체 협력사→관리자 정정.
- **이전(2026-07-27 컴파일분, 유지)**: 07-26 자체 카탈로그 트레이스 v2(`apiCalls: z.literal(0)`)·`offerKind` 구분 · 07-25 파괴적 삭제 리터럴 `RESET_WITH_QUOTES`·무필터 삭제 refine 거부 · 07-2x 기술 판정은 sp-engine 단일 소유(Node·FE 재판정 금지) · 07-12/16 AI 결정적 부분 계약 소유·`.catch` 흡수 · 07-10 SEO 오버라이드 전용 · 07-05 거버 가격 모드 2값 · 07-03 spec 39종+catchall·`differentDesign` 통일 · 가격은 항상 서버 계산·JWT는 검증만.

## Gotchas [coverage: high — 12 sources]

- **판정을 복제하지 말 것 — 계약 함수 하나를 거쳐라**: `isPcbEqRejectionEvent`를 우회해 `note` 유무나 `byRole`로 반려를 판정하면 요청취소·관리자 대행(byRole=ADMIN)에서 틀린다. `pcbEqEventLabel`·`pcbEqRejectActionLabel`을 화면에 하드코딩하면 스텐실 트랙 어휘가 깨진다. 같은 결로 `pcbMarginPercent`(VAT 역산)·`mergedOrderCustomerLabel`·`developOverdueTaskCount`도 직접 계산 금지.
- **`isPcbDeliveryOverdue`의 두 인자는 KST `YYYY-MM-DD`**(`@sp/utils` `kstDateOnly`·`kstToday`). 납기는 KST 자정 앵커로 저장되므로 ISO 문자열을 잘라 쓰면 하루 앞당겨진다(2026-08-20 납기가 08-19로 보인 회귀).
- **`shipmentTransportOf`는 표시 폴백 전용** — 응답 직렬화에 쓰면 "고른 적 없음"이 "항공"으로 굳어 라디오가 켜진 채 뜬다. 트랙별 `asXxxTransport`가 null을 지킨다.
- **`orderPcbEqFiles`의 `inquiry`는 누적** — 종류별 최신 1건 규칙을 그대로 쓰면 문의 사진 두 장이 접혀 관리자가 못 본다. `isLatest`는 종류별이라 eq·working·reply·coord를 한 칸에 섞으면 관리자 회신이 협력사 최신 도면을 밀어낸다.
- **PHP 사전과 계약 사전은 사람이 동기한다**([manual-sync-drift](../concepts/manual-sync-drift.md)): `ORDER_STATUS_CUSTOMER_LABELS`·`ORDER_STATUS_PROGRESS_APPLIES` ↔ `sp_order_status.extend.php`, 배송방법 한글 라벨 ↔ `/adm`·메일 `{택배회사}` 치환. 한쪽만 바꾸면 주문내역(PHP)과 `/app`이 다른 말을 한다.
- **트랙·도메인 사이 사전 교차 import 금지**: `pcb-claim` vs `bom-claims`, `DEVELOP_BUDGET_RANGES` vs `MARKET_BUDGET_RANGES`(단위 자체가 다름), BOM 포털 `/api/partner/rfqs` vs PCB `/api/partner/pcb-rfqs`. 값이 같아 보여도 각자 진화한다.
- **`BizError` 두 형태를 라우트 응답 스키마에 모두 선언**: 한쪽만 두면 `reply.conflict()`가 직렬화에서 막혀 409→500. `DateOnly`는 아직 전면 통일이 아니다 — `pcb-rfq.ts` `quotedDeliveryDate`·`pcb-eq-review.ts` `dueOn`·`admin.ts` `from/to`는 정규식만 쓴다(2월 30일 통과).
- **워크스페이스 전체 lint/typecheck가 이 패키지에서 멈춘다(09-18 커밋 메시지 실측)**: `pnpm -r lint`는 `order-progress.ts` 120·122행 `prefer-optional-chain`/`no-unnecessary-condition` 2건, `pnpm -r typecheck`는 `e2e/specs/bom-receiving-navigation.e2e.test.ts`의 `@sp/api-contract` 모듈 해석(TS2307)으로 중단. 패키지 단독 `eslint src/schemas/parts.ts`는 통과.
- **순수 함수의 테스트는 패키지 밖에 있다**: `apps/api/src/lib/pcb-eq-rejection.test.ts`·`pcb-eq-files.test.ts`·`pcb-delivery-overdue.test.ts`·`pcb-project-name.test.ts`·`pcb-stencil-track.test.ts`, `packages/utils/*.test.ts`(레지스트리·문서·견적 산식). 함수를 옮기거나 시그니처를 바꾸면 그 위치를 같이 봐야 한다. [testing](testing.md).
- **레지스트리 분야 코드는 z.enum이 아니다**: `MarketAreaCodeLoose`(문자열)로 저장·파싱되고 유효성은 `marketAnswerIssues`/`developAnswerIssues`가 본다. 분야 코드를 다른 파일에 문자열로 박지 말 것(분야 추가 = `MARKET_AREAS` 항목 + 픽스처).
- **`DEVELOP_FOLLOWUP` 문항은 클라이언트가 지어낼 수 없다** — 등록 payload `aiQuestions`의 문항은 서버가 잡 결과에서 다시 읽고 답만 합친다. `AiRunResponse.diagramJobId`는 유스케이스 off·자료 부족 게이트면 null(`diagramSkipReason`).
- **여전히 유효한 07-27 함정**: `bom.ts`만 snake_case+`.passthrough()`(엔진 미러, 07-25 이후 불변) · 신규 근거 필드는 `.nullable().optional()`(이관·구 견적에 없음) · 호출 상한 두 곳(`supplierSearchMaxCalls` vs `max_calls`) · `differentDesign` 누락 = 가격 0원 · `category`/`orderCategory` 스왑 · 마켓 `cadTools` 빈 배열 = 전체 허용 · `DiagramSpec` `.catch` 흡수 · `thumbnailUrl` 서명 만료·파생값 PATCH 금지 · 이관 specJson `_legacy` 키는 응답 직렬화 전 strip.

## Sources [coverage: high — 71 sources]

- 패키지: [package.json](../../samplepcb-web-mono-app/packages/api-contract/package.json) · [src/index.ts](../../samplepcb-web-mono-app/packages/api-contract/src/index.ts) · [src/routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts)
- 기반·코어: [common.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/common.ts) · [auth.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/auth.ts) · [pcb-project.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-project.ts) · [admin.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/admin.ts) · [members.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/members.ts) · [orders.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/orders.ts) · [settings.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/settings.ts) · [slides.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/slides.ts) · [seo.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/seo.ts)
- BOM: [bom.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom.ts) · [parts.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/parts.ts) · [bom-quote.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-quote.ts) · [bom-rfq.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-rfq.ts) · [bom-po.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-po.ts) · [bom-receiving.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-receiving.ts) · [digikey.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/digikey.ts) · [bom-orders.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-orders.ts) · [bom-claims.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/bom-claims.ts)
- PCB 트랙: [pcb-rfq.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-rfq.ts) · [pcb-po.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-po.ts) · [pcb-orders.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-orders.ts) · [pcb-cases.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-cases.ts) · [pcb-remittance.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-remittance.ts) · [pcb-eq-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-eq-review.ts) · [order-progress.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/order-progress.ts) · [pcb-as-case.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-as-case.ts) · [pcb-claim.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/pcb-claim.ts)
- 조직·부품·횡단: [partner.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/partner.ts) · [partner-parts.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/partner-parts.ts) · [admin-mail.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/admin-mail.ts) · [file-preview.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/file-preview.ts)
- 마켓·개발의뢰·AI: [market.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market.ts) · [market-areas.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-areas.ts) · [area-registry.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/area-registry.ts) · [market-dev-review.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-review.ts) · [market-dev-diagram.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/market-dev-diagram.ts) · [ai.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/ai.ts) · [develop.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop.ts) · [develop-areas.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-areas.ts) · [develop-followup.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-followup.ts) · [develop-docs.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-docs.ts)
- 소비처·테스트: [packages/shared/src/api-client.ts](../../samplepcb-web-mono-app/packages/shared/src/api-client.ts) · [packages/utils/src/kst-date.ts](../../samplepcb-web-mono-app/packages/utils/src/kst-date.ts) · [apps/api/src/lib/pcb-eq-rejection.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-eq-rejection.test.ts) · [pcb-eq-files.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-eq-files.test.ts) · [pcb-delivery-overdue.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-delivery-overdue.test.ts) · [pcb-project-name.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-project-name.test.ts) · [pcb-stencil-track.test.ts](../../samplepcb-web-mono-app/apps/api/src/lib/pcb-stencil-track.test.ts)
- 규칙 문서: [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) · [AGENTS.md(BOM 역할 경계)](../../AGENTS.md)
- 도메인 정본: [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) · [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) · [PARTNER_PARTS](../../docs/PARTNER_PARTS.md) · [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) · [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) · [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) · [MAIL_LOG](../../docs/MAIL_LOG.md) · [DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md) · [partner-i18n](../../docs/partner-i18n.md) · [pricing-engine-parity](../../docs/pricing-engine-parity.md) · [prompts/sp-engine-candidate-decision](../../docs/prompts/sp-engine-candidate-decision.md)
- 이전 컴파일분 정본: [BOM_QUOTE](../../docs/BOM_QUOTE.md) · [PARTS_SEARCH](../../docs/PARTS_SEARCH.md) · [MARKET_FLOW](../../docs/MARKET_FLOW.md) · [AI_DIAGRAM](../../docs/AI_DIAGRAM.md)(08-28 대체됨 표기) · [SEO_MANAGEMENT](../../docs/SEO_MANAGEMENT.md) · [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) · [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md)
