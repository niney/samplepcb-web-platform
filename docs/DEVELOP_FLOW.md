# DEVELOP_FLOW — 개발의뢰 (sp-develop)

의뢰자 ↔ **샘플피씨비 직접** 개발 용역 사이트의 **단일 설명원본**. 2026-09-05 기획 확정(사용자), 브랜치 `feat/develop-mvp`.

## 0. 왜 만드는가

- 재능마켓(sp-market, `docs/MARKET_FLOW.md`)은 전문가 매칭 구조라 성숙시키기 전에 운영 노하우(상담·견적·진행·납품)를
  **당사가 직접 수행하는 과도적 사이트**에서 먼저 쌓는다. 나중에 마켓 house 전문가(당사)로 합류할 여지만 열어 둔다.
- 레거시(samplepcb_php `shop/estimate.php?category=circuit`, "개발의뢰" 버튼 → `sp_estimate` → 관리자 항목·단가·수량 견적
  → ca_id 20 카트 → 주문)가 같은 모델이었고 DB 이관에서 빠져(주문 라인 spec_json 병합만) 플랫폼에 대응물이 없다. 이 사이트가 그 현대판이다.
- 마켓과의 결정적 차이 세 가지: **전문가·입찰·공개 목록이 없다**(전부 소유자·관리자만), **AI 는 고객이 아니라 관리자가 돌린다**
  (초안 → 편집 → 공개), **견적은 당사가 항목별로 낸다**(마일스톤 결제 포함).

## 1. 이름·경로

| 항목 | 값 |
|---|---|
| 별칭 | `sp-develop` (상위 AGENTS.md 호칭 표에 추가) |
| 앱 | `samplepcb-web-mono-app/apps/develop` (Vue3+Vite, base `/develop/`, **포트 5177**, strictPort) |
| 경로 | 고객 `/develop/*` · API `/api/develop/*` · 관리자 API `/api/admin/develop/*` · 관리자 화면 `/app/admin/develop/*` |
| 테이블 | `sp_develop_*` (Prisma 소유, 수기 additive migration → `migrate deploy`) |
| 계약 | `packages/api-contract/src/schemas/develop.ts` (+ 마켓 레지스트리 `market-areas.ts`·`market-dev-review.ts`·`market-dev-diagram.ts` 재사용) |
| 공용 UI | **`packages/ui` (`@sp/ui`) 신설** — 마켓에서 추출한 렌더 컴포넌트(§7.1). 마켓·개발의뢰·관리자 셋이 소비 |
| 앵커 상품 | `sp-develop-svc`(영카트 g5_shop_item, 마켓 `sp-market-svc` 와 동형·별개) |
| AI 유스케이스 | `develop.dev-review` · `develop.dev-diagram`(sp_ai_usecase 별도 행 — 마켓 설정과 독립) |
| 서비스명 | "개발의뢰"(레거시 메뉴명 승계). 화면 카피는 ko 인라인 + 도메인 라벨은 계약 상수(마켓 관례) |

nginx: `ops/nginx/local-web.conf` 에 `upstream vite_develop 127.0.0.1:5177` + `location /develop/`. 라이브 nginx 는 Windows 서비스라 관리자 `net stop/start nginx`.

## 2. 아키텍처 결정

| # | 결정 | 근거 |
|---|---|---|
| 1 | 별도 Vue 앱 + **공용 패키지 추출**(복사 아님) | 관리자가 검토서를 편집하려면 고객과 같은 렌더러로 미리보기가 필요. 지금 sp-vue 는 축약본(`DevReviewSummary`)뿐이고 복사하면 3앱이 각자 갈린다 |
| 2 | **테이블 분리**(`sp_market_project` channel 컬럼 기각) | 마켓 공개 목록 쿼리 하나에서 필터가 빠지면 비공개 의뢰가 마켓에 샌다. 상태 어휘(bidding·awarded)·NDA·입찰 의미도 안 맞는다. JSON 모양은 같아 나중 합류는 데이터 복사로 충분 |
| 3 | 위저드에서 **AI 전부 제거**, 등록 즉시 **서버 백그라운드 초안**(관리자 전용) | 고객 대기 0. 관리자가 열면 초안이 이미 있다. 수동 재실행은 보조 |
| 4 | **관리자 보충 메모를 근거 코퍼스에** 넣어 재생성 | 후처리 R1/R2 가 "자료에 없는 수치"로 지우는 것을 막는 유일한 길. 전화 상담 내용이 검토서에 들어간다 |
| 5 | 고객 대기가 없으니 **정밀 모델 허용**(기본 `glm-5.3` 또는 `kimi-k3`, think medium) | AI_DEV_REVIEW §12.8 — glm-5.3 이 가장 촘촘하나 3~9분이라 마켓은 못 썼다. 관리자 설정으로 변경 가능 |
| 6 | 검토서 = **초안(AI 원본) · 작업본(편집) · 공개본(스냅샷)** 3층 | 재생성이 편집을 덮지 않고, 공개 뒤 편집이 고객 화면을 흔들지 않는다 |
| 7 | 편집은 **구조 편집 + 담당자 의견 블록**, 에디터 라이브러리 없음 | 검토서가 섹션별 JSON 이라 행 편집 폼으로 충분. 자유 서술은 텍스트(줄바꿈 유지) 한 블록 |
| 8 | 구성도는 편집 대상이 아니다 — **재생성(지시문)·교체 업로드·비공개** 3가지 | LLM HTML/SVG 는 회차마다 구조가 달라 편집기가 성립하지 않는다 |
| 9 | 견적서는 **조건 문서**(§5) — 항목표 + 결제 조건(마일스톤) + 기간 + 산출물 + 별도 실비 + 표준 조건 + 검수 기간 + 유효기간 | 국내 개발 용역 실무: 고객 회사 결재를 통과하는 한 장 |
| 10 | 결제 = **마일스톤별 영카트 주문**(마켓 카트 주입·lazy 승격 재사용), 기본 1건 전액 | 수천만 원대는 무통장+세금계산서가 실무. 카드는 영카트 설정 그대로 |
| 11 | 수락 = **조건 동의 기록**(시각·IP·이름, 마켓 NDA 서명 패턴) + 선택 발주서 첨부 | 견적 승인이 곧 계약 |
| 12 | 착수 뒤 변경은 **추가 견적**(`kind=change`) — 한 의뢰에 수락 견적 여러 건 | 범위 변경이 상례 |
| 13 | 중간 산출물 **확인 요청**(회로도·아트웍 승인 게이트) 이벤트 | 책임 소재의 기준 |
| 14 | 최종 산출물은 **잔금 후 공개**(잠금 플래그, 마지막 마일스톤 paid 가 해제) | 당사 보호 관행. 1건 전액이면 잠금 없음 |
| 15 | 회원 전용(그누보드 로그인). 비회원 의뢰는 안 받는다 | 결제·마이페이지·알림이 회원 전제 |
| 16 | 위저드 조건에서 견적 방식·견적 마감·공개 범위 제거, NDA 는 "비밀유지 계약 희망" 체크, **연락처 블록 추가** | 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무. 레거시 estimate.php 에도 연락처 층이 있었다 |
| 17 | 문의 스레드는 P2(견적과 함께) — "조정 요청"이 곧 스레드 | 견적 전 질의응답이 노하우가 쌓이는 자리 |
| 18 | AI 동의(1스텝) 유지 — 미동의면 관리자 AI 버튼 비활성(사유 표시) | 첨부가 외부 LLM 으로 나간다 |
| 19 | 디자인은 마켓과 무관하게 새로 만든다(사용자: 따라할 필요도 안 따라할 필요도 없음). 공용 컴포넌트는 **시맨틱 토큰**(`brand-*`·`ink-*`·`paper`·`line`·`tx-*`)만 쓰고 각 앱이 값을 정한다 | 마켓은 `brand-*` = 카퍼 값으로 별칭해 시각 무변경 |

## 3. 데이터 모델 (`sp_develop_*`)

| 테이블 | 역할 | 핵심 |
|---|---|---|
| `sp_develop_request` | 의뢰 | `mbId` · `title` · `serviceAreas`(string[]) · `tools`(MarketTools) · `description` · `answers`(MarketAnswers) · 연락처 `contactName/Company/Phone/Email/Hours` · `budgetRange` · `ndaWanted` · `aiConsent` · `status`(§4) · `assigneeMbId` · `internalMemo`(고객 비노출) · `aiSupplement`(AI 코퍼스용 보충 메모) · 검토서 3층 `devReviewDraft`·`devReview`·`devReviewPublic`(+`devReviewDraftAt`·`devReviewEditedAt/By`·`devReviewPublishedAt`·`devReviewInputHash`) · 구성도 `devDiagram`(메타)·`devDiagramHtml`·`devDiagramPublicHtml`·`devDiagramPublishedAt`·`devDiagramSource`(ai\|upload) · `reviewDays`(검수 기간, 수락 견적에서 복사) · `startedAt`·`deliveredAt`·`completedAt`·`cancelledAt`·`cancelReason`·`declinedReason` |
| `sp_develop_event` | 타임라인·문의 **한 스트림**(append-only) | `requestId` · `type`(§4.3) · `actorMbId` · `byAdmin` · `visibleToCustomer` · `title` · `body` · `payload`(JSON: from/to 상태, 잠금 등) · 첨부는 `sp_file(refType='sp_develop_event')` |
| `sp_develop_quote` | 견적서(버전) | `requestId`+`version` unique · `kind`(initial\|revision\|change) · `status`(draft\|sent\|accepted\|declined\|expired\|superseded\|withdrawn) · `title` · `vatMode`(separate\|included\|exempt) · `supplyAmount`·`vatAmount`·`totalAmount`(발송 시 확정) · `durationDays` · `scheduleNote` · `deliverables`(string[]) · `exclusions` · `terms`(표준 조건 복사본, 건별 수정) · `warrantyDays` · `reviewDays` · `validUntil`(YYYY-MM-DD KST) · `note`·`internalNote` · `sentAt`·`acceptedAt`·`acceptedName`·`acceptedIp`·`declinedAt`·`declineReason`·`supersededById` · `createdBy` |
| `sp_develop_quote_item` | 견적 항목 | `quoteId`+`seq` unique · `title` · `description` · `amount`(공급가) · `durationDays` |
| `sp_develop_milestone` | 결제 단위 | `quoteId`·`requestId`·`seq` · `title`(계약금·잔금…) · `ratioBp`(입력 보조) · `amount`(VAT 포함 결제액) · `trigger`(on_accept\|on_delivery\|on_completion\|manual) · `status`(draft\|pending\|paid\|cancelled) · **`paymentKey`**(uuid = 영카트 io_id) · `ctId` · `paidOdId` · `paidAt` · `paidBy`(lazy\|admin) · `unlocksDeliverables` |
| `sp_develop_settings` | 설정 싱글턴(id=1) | `defaultTerms` · `defaultExclusions` · `defaultWarrantyDays`(180) · `defaultReviewDays`(7) · `defaultValidDays`(30) · `defaultVatMode` · `defaultMilestones`(JSON) · `notifyEmails`(관리자 수신) · `aiAutoDraft`·`aiDiagramAutoDraft` |

- 첨부는 `sp_file` 폴리모픽: `sp_develop_request`(attachment, `area/slot` 슬롯 포함 · `diagram` 교체 업로드) · `sp_develop_quote`(`po` 발주서) · `sp_develop_event`(`deliverable`·`review`·`comment`). pathToken 비노출·`uploadedBy` 에 mbId 금지 불변식 유지. 파일서버 serviceType 은 env `DEVELOP_FILE_SERVICE_TYPE`(기본 `develop`, 운영 전 수용 1회 실측).
- 세금계산서는 컬럼이 아니라 이벤트(`tax_invoice`, payload {issuedAt, supplyAmount, vatAmount, memo}) — 발행은 홈택스 수동, 여기엔 사실만.
- AI 잡은 `sp_ai_job` 재사용(useCase `develop.*`, mbId = 의뢰인). 연결은 요청 컬럼(`devDiagram.jobId`·`devReviewInputHash`)으로.

## 4. 상태 머신

### 4.1 의뢰 `status`

```
received(접수됨) → reviewing(검토 중) → quoted(견적 발송) → accepted(수락·착수금 대기) → in_progress(개발 진행 중)
→ delivered(납품·검수 중) → completed(완료)          + cancelled(취소) · declined(진행 불가)
```

| 전이 | 주체·조건 |
|---|---|
| received → reviewing | 관리자 "검토 시작"(담당자 배정 겸) |
| reviewing → quoted | 견적서 **발송**이 자동 전이. 재견적(revision)은 quoted 유지, 이전 sent 는 superseded |
| quoted → accepted | 고객 수락(조건 동의). 거절은 quoted 유지 + 견적 declined + 이벤트 |
| accepted → in_progress | **첫 마일스톤 paid**(lazy) 또는 관리자 "착수"(후불 조건) |
| in_progress → delivered | 관리자 납품 이벤트(`deliverable`, `final: true`) |
| delivered → completed | 고객 검수 확정 · `reviewDays` 경과 자동확정(lazy, 마켓 `ensureAutoConfirmLazy` 동형) · 관리자 대행 확정 |
| delivered → in_progress | 고객 "수정 요청"(이벤트 `review_changes`) → 관리자 재납품 |
| → cancelled | 고객: in_progress 전까지. 관리자: 언제나(사유). 환불은 기존 주문 관리 환불 기록 창구 |
| → declined | 관리자, 사유 필수, 고객 메일 |

수정 창: 고객 의뢰 수정은 `received|reviewing` 에서만(409 `NOT_EDITABLE`). 수정하면 검토서 초안은 `stale`(inputHash 불일치) 배지.

### 4.2 견적 `status` · 마일스톤 `status`

- 견적: `draft → sent → accepted | declined | expired(validUntil 경과, lazy) | superseded(같은 의뢰에 새 sent) | withdrawn(관리자)`. initial/revision 은 의뢰당 sent 1건, change 는 독립.
- 마일스톤: 견적 draft 에 붙어 `draft` → 수락 시 `pending` → 결제 `paid`(lazy 라인 검증: `PAID_ORDER_STATUSES ∧ io_id==paymentKey ∧ io_price==amount`, 단방향 래칫) / 관리자 수동 paid(오프라인 입금) → 견적 철회·의뢰 취소 시 `cancelled`(잔존 '쇼핑' 카트행 정리).
- 결제 가능 시점 = trigger: `on_accept` 즉시 · `on_delivery` 의뢰 delivered 이후 · `on_completion` completed 이후 · `manual` 관리자가 열 때.
- 최종 산출물 잠금: `unlocksDeliverables` 마일스톤이 paid 가 아니면 잠긴 산출물은 파일명만 보이고 다운로드 403 `LOCKED_UNTIL_PAID`.

### 4.3 이벤트 `type`

`status_changed` · `edited`(고객 수정) · `note`(관리자 진행 메모, 공개 토글) · `comment`(문의, 양방향, 첨부) · `review_request`(중간 확인 요청, 첨부) · `review_approved` · `review_changes` · `deliverable`(납품, `final`·`locked`) · `quote_sent` · `quote_accepted` · `quote_declined` · `payment_confirmed` · `ai_drafted` · `published`(검토서·구성도 공개) · `tax_invoice` · `as_request`(완료 후 A/S, comment 의 태그).

## 5. 견적서

- 항목: 이름 + 금액(공급가) + 선택 설명·기간. **붙여넣기 파싱**(`parseDevelopQuoteLines`, 계약 순수 함수): `H/W 회로·PCB 설계 3,600,000원` 한 줄 = 항목 하나(끝의 금액 토큰·"원"·콤마 허용, 실패 줄은 그대로 남겨 관리자가 고친다).
- 금액: `vatMode=separate` 기본 — 공급가 합 · VAT 10% · 합계. `included` 는 합계에서 역산, `exempt` 는 VAT 0. 마일스톤 `amount` 는 **VAT 포함 합계**를 비율(`ratioBp`)로 나누고 끝 마일스톤이 반올림 차액을 흡수한다.
- 표준 조건(`terms`)은 설정 기본 문구를 견적 생성 시 복사 — 산출물 소유권 이관 · 하자보수 · 변경 시 추가 견적 · 취소·환불 · 검수 기간. 별도 실비(`exclusions`)는 PCB 제작·부품·인증·양산 등 금액 없이 안내(당사 PCB/BOM 트랙으로 별도 주문).
- 발송 = `supply/vat/total` 확정 + `sentAt` + 이벤트 + 메일(`estimate-email.ts` 매체 원칙: table+inline, esc) + 의뢰 `quoted`. 인쇄용 화면 `/develop/requests/:id/quotes/:qid/print`(브라우저 인쇄 → PDF, 회사 정보는 `getShopEstimateProfile`).
- 고객: 수락(조건 동의 체크 + 이름, 선택 발주서 첨부) · 거절(사유) · 조정 요청은 스레드.

## 6. AI 파이프라인 (관리자 주도)

```
등록(aiConsent ∧ settings.aiAutoDraft ∧ usecase enabled) → 서버가 검토서 잡 + 구성도 잡(게이트) 백그라운드 시작(소유자=의뢰인)
  검토서 done → request.devReviewDraft (+ devReview 가 비어 있으면 작업본에도 복사) · 이벤트 ai_drafted(비공개)
  구성도 done → request.devDiagram/devDiagramHtml(비공개)
관리자 상세: 초안 상태(폴링) · [재생성]  — aiSupplement(보충 메모)가 코퍼스 "담당자 보충 자료"로 합류 · [초안 → 작업본] · 구조 편집 · [공개]
공개 = devReview → devReviewPublic 스냅샷(+publishedAt) · 구성도는 현재 html → devDiagramPublicHtml
```

- 재사용: `lib/ai/runner.ts startDevReviewJob` 의 write-back 대상을 `{ kind:'market', projectId } | { kind:'develop', requestId }` 로 일반화. `dev-diagram-runner.ts` 의 연결 대상(`linkedProject`)·메타 쓰기·알림을 **타깃 어댑터**로 갈라 마켓 동작은 불변(e2e-market 회귀).
- 코퍼스 = 제목·설명·답변·참고 자료(area null) 텍스트·이미지 판독 + **aiSupplement**. 후처리 R1~R9 그대로(보충 메모가 근거가 된다).
- 편집 스키마: `MarketDevReview` 에 additive 선택 필드 — `adminComment?: string|null`(담당자 의견 블록) · `openQuestions[].resolution?: string|null`(상의 항목 확인 결과) · `meta.editedAt/editedBy`. 마켓은 무시. 공유 렌더러가 있으면 표시.
- 구성도 교체 업로드: svg·png(이미지) 또는 html(`sanitizeDevDiagramHtml` 통과) → `devDiagramSource='upload'`.
- 고객 화면은 **공개본만**. 공개 전엔 "담당자가 검토 중입니다" 안내.

## 7. 화면

### 7.1 공용 패키지 `@sp/ui`

마켓에서 옮기는 것(i18n 미사용·`@sp/*` 의존만 확인됨): `DevReviewView`·`DevDiagramSection`·`AreaIcon`·`FileDropZone`·`FilePreviewModal`(+`lib/file-preview.ts`·`error-msg.ts`)·`QuestionField`(+`QuestionState` 타입)·`UiPagination`. 클래스는 시맨틱 토큰만(`copper-*` → `brand-*`). 마켓 `style.css` 에 `--color-brand-*` 별칭 추가, 앱 CSS 는 `@source "../../../packages/ui/src"`(Tailwind v4 가 node_modules 심링크를 스캔하지 않음).

### 7.2 고객 (`apps/develop`)

| 경로 | 화면 |
|---|---|
| `/develop` | 랜딩 — 서비스 소개·프로세스(레거시 7단계 계승)·분야 5·CTA·FAQ |
| `/develop/request` | 위저드 3스텝 — ① 분야·제목·설명·참고 자료·AI 동의 ② 조건(예산·완료 시점·목표 단계·인도 범위·비밀유지 희망) + 공통 질문 3 + 분야별 질문·툴·슬롯 ③ **연락처** + 요약 + 등록 |
| `/develop/me` | 내 의뢰 목록(상태 배지·다음 할 일) |
| `/develop/requests/:id` | 상세 — 상태 스텝퍼 · 의뢰 내용 · AI 검토서(공개본) · 시스템 구성도 · 견적서(들)·수락 · 결제(마일스톤) · 진행·문의 타임라인 · 산출물(잠금 표시) |
| `/develop/requests/:id/edit` | 수정(received·reviewing) |
| `/develop/requests/:id/quotes/:qid/print` | 견적서 인쇄용 |

접수 완료 화면: "담당자가 검토 후 연락드립니다(영업일 2~3일)" + 메일.

**P1 구현(2026-09-05)** — 페이지 `pages/{Home,RequestWizard,Me,RequestDetail,RequestEdit,QuotePrint}.vue`, 위저드 조각 `components/request/{StepDescribe,StepConditions,StepContact,ContactFields,WizardAside}.vue`, 상세 조각 `components/detail/{ProgressStepper,RequestContent,QuoteCard,Timeline,AttachmentList}.vue`, 폼 상태 `composables/useRequestForm.ts`, 서버 상태 `api/useDevelopRequests.ts`, 포맷·다운로드·에러 `lib/{format,download,error-msg,auth-urls}.ts`. 결정 넷: ① 위저드와 수정 화면이 **같은 폼 상태**를 공유하고 수정은 스텝 없이 한 화면에 이어 붙인다(이미 쓴 글을 고치러 온 사람에게 3단계를 다시 걷게 하지 않는다) — 그래서 `StepDescribe` 는 `showAttachments`, `StepConditions` 는 `showSlots` 로 등록 전용 블록만 끈다. ② 수정 화면의 첨부는 저장을 기다리지 않고 서버에 즉시 반영한다(파일에 대한 사용자의 기대가 그렇다) — 본문은 PATCH 로 **바뀐 필드만** 보낸다. ③ 검토서가 있으면 구성도를 `DevReviewView` 안에 넣고, 없을 때만 `DevDiagramSection` 을 단독 섹션으로 그린다(같은 도면이 두 번 뜨지 않게). ④ 수락·거절·문의·결제는 P2 라우트가 없어 **버튼 자리를 만들지 않는다**(비활성 버튼은 없는 기능을 있는 것처럼 보이게 한다). 날짜 표기는 `dateShort`·`dateTimeKst` 가 **둘 다 KST 기준**이다 — UTC 문자열을 그냥 자르면 저녁 접수 건이 헤더와 타임라인에서 하루 어긋난다.

**P2 구현(2026-09-05)** — 고객 행동이 붙었다: 신규 조각 `components/detail/{CommentComposer,DecisionPanel}.vue`, `QuoteCard.vue` 에 수락 패널·거절·마일스톤 결제 버튼, `Timeline.vue` 에 `event-actions` 스코프 슬롯, `api/useDevelopRequests.ts` 에 훅 6종(`useAcceptQuote`·`useDeclineQuote`·`usePostComment`·`useCheckoutMilestone`·`useDeliveryDecision`·`useReviewRequestDecision`). 결정 넷: ① 수락은 **표준 조건 동의 체크 + 이름**이 둘 다 있어야 열린다(서버가 시각·IP·이름을 기록해 계약을 갈음하므로 동의가 클릭 한 번에 묻히면 안 된다). ② `payable` 은 서버 파생이라 화면이 다시 계산하지 않고, 그 마일스톤 행에만 결제 버튼을 세운다 — 나머지 행은 상태·결제일·주문번호와 무통장 "입금 확인 중" 배지를 보여 준다. ③ **미응답 판정은 타임라인 부모가 한다**(어떤 `review_request` 가 아직 안 끝났는지는 뒤따르는 `review_approved`/`review_changes` 의 `payload.eventId` 를 봐야 알 수 있다) — `Timeline` 은 슬롯만 내주고 판정을 모른다. ④ 결제는 주입 직전 `auth.bootstrap()` 으로 JWT `cartId` 스테일을 막고, 그래도 `NO_CART_ID` 면 한 번 더 부트스트랩하고 재시도한 뒤 영카트 주문서(`/shop/orderform.php`)로 `window.location.assign` 한다. 목록에서 "지금 할 일" 칩이 있는 행은 상세의 해당 섹션 앵커(`#quotes`·`#timeline`)로 바로 보낸다 — 칩만 링크로 만들면 카드 링크 안에 링크가 들어가므로 카드 자체에 앵커를 건다.

### 7.3 관리자 (`apps/web` `/app/admin/develop`)

| 경로 | 화면 |
|---|---|
| `requests` | 워크큐 — 탭(접수·검토 중·견적 발송·결제 대기·진행 중·납품·완료·전체) counts, 검색, 담당자 |
| `requests/:id` | **전면 상세**(드로어 아님) — 헤더(상태·전이·담당자) · 의뢰 내용·연락처 · AI 패널(초안 상태·재생성·보충 메모·구조 편집·공개) · 구성도 패널 · 견적서 목록·작성(붙여넣기)·발송 · 마일스톤·결제(od 파생·수동 확인) · 타임라인(메모·문의·확인 요청·납품·세금계산서) · 내부 메모 |
| `settings` | 표준 조건·기본 마일스톤·검수/하자/유효기간·수신 메일·AI 자동 초안 |

AI 모델·think·추가 지침은 기존 `/app/admin/settings` AI 탭에 `develop.*` 블록 추가.

P1 구현(2026-09-05): 신규 `apps/web/src/admin/useAdminDevelop.ts`(목록·상세 폴링·patch·status·aiRun·review PUT/액션·diagram 액션/업로드·이벤트 생성·설정·배지 카운트) · 페이지 `pages/admin/AdminDevelop{Requests,RequestDetail,Settings}.vue` · 조각 `components/admin/develop/`(StatusBar·RequestContent·ReviewPanel·ReviewEditor·DiagramPanel·Timeline·SideCards·AiChips + 순수 모듈 `develop-review-edit.ts`·`develop-badge.ts`). 기존 파일은 `layouts/AdminLayout.vue`(배지 `developReceived` 분기)·`components/admin/AiSettingsForm.vue`(develop 카드 2장)·`i18n/locales/ko.ts`·`en.ts`(`admin.develop.*` 237키)만 건드렸다. 결정 셋: ① 상태·이벤트·견적 라벨은 계약 사전(`DEVELOP_*_LABELS`)이 정본이라 i18n 으로 복제하지 않고 화면 고유 문구만 키로 둔다. ② 검토서 편집기는 서버 응답을 필드별로 새로 만들어(`cloneDevelopReview` — `structuredClone` 은 reactive proxy 에서 던진다) 로컬 상태로 들고, 행 상한(`DEVELOP_REVIEW_LIMITS`)은 계약 zod `.max()` 와 같은 값을 복제해 초과 추가를 UI 에서 막는다. ③ 타임라인 등록 게이트는 종류별로 갈린다 — 세금계산서는 발행일만 채우면 열리고(원장 성격, 서버도 payload 만으로 받는다), 나머지는 제목·본문·첨부 중 하나를 요구한다. ④ 확인이 필요한 자리(초안 가져오기·상태 사유)는 전부 인라인 패널이다(네이티브 `confirm` 없음).

P2 관리자 견적 화면(2026-09-05): 상세 본문에 견적 섹션(`components/admin/develop/DevelopQuoteSection.vue` — 앵커 `#develop-quotes`, 사이드 카드는 요약+앵커만) · 견적서 한 장 읽기·철회·마일스톤 수동 입금 확인(`DevelopQuoteCard.vue`) · draft 전용 편집기(`DevelopQuoteEditor.vue`) · 폼↔계약 변환·검사 순수 모듈(`develop-quote-edit.ts`). 훅은 `useAdminDevelop.ts` 에 6개 추가(quote create/patch/delete/send/withdraw · milestone mark-paid, 성공 시 `['admin','develop']` 무효화). 결정 셋: ① 편집기는 문자열 폼으로 들고 저장 직전에만 계약 모양으로 바꾼다 — 금액 입력은 콤마를 허용하고(`parseAmountInput`) blur 에서 천단위로 다시 쓴다. ② 계약 zod 가 막는 자리(항목·마일스톤 ≥1, 비율 합 100%, 해제 마일스톤 ≤1, 각 길이·범위)를 `developQuoteIssues` 가 저장 전에 같은 값으로 먼저 검사한다 — 400 을 사용자 문구로 번역하는 대신 애초에 못 보내게 한다. ③ 발송은 "저장 → send" 두 걸음을 한 버튼에 묶고 그 사이에 인라인 확인 패널(합계·마일스톤 요약)을 세운다. ④ 새 견적 종류는 상태에서 파생한다(`defaultDevelopQuoteKind`: 착수 전 initial/revision · 착수 뒤 change) — 서버 409 `KIND_MISMATCH` 와 같은 규칙이라 화면에서 고를 수 없는 종류가 안 뜬다. ⑤ 붙여넣기 채우기는 빈 행을 버리고 뒤에 붙이며, 금액을 못 읽은 줄은 지우지 않고 경고로 되돌려 준다.

## 8. API 지도

회원(prefix `/api`, 소유자만): `POST /develop/requests`(multipart) · `GET /develop/my/requests` · `GET /develop/requests/:id` · `PATCH /develop/requests/:id` · `POST|DELETE /develop/requests/:id/files(/:fileId)` · `GET …/files/:fileId(/preview)` · `POST …/cancel` · `POST …/comments`(P2) · `GET …/quotes/:qid` · `POST …/quotes/:qid/accept|decline`(P2) · `POST …/milestones/:mid/checkout`(P2) · `POST …/deliveries/:eventId/confirm|changes`·`POST …/review-requests/:eventId/approve|changes`(P3).

관리자(prefix `/api/admin`, requireAdmin): `GET /develop/requests`(+counts) · `GET|PATCH /develop/requests/:id` · `POST …/status` · `POST …/ai/review`·`POST …/ai/diagram` · `PUT …/review`·`POST …/review/publish|unpublish|reset` · `POST …/diagram/publish|unpublish|upload` · `POST …/quotes`·`PATCH /develop/quotes/:qid`·`POST …/send|withdraw` · `POST …/events`(multipart) · `POST /develop/milestones/:mid/mark-paid` · `GET /develop/files/:fileId` · `GET|PATCH /develop/settings`.

에러 봉투: 회원 `{result:false,error:'CODE'}` · 관리자 `ApiError` — 마켓 관례 그대로. 코드→메시지는 각 앱 `lib/error-msg.ts`.

## 9. 알림 (메일, 비차단, sp_mail_log)

고객: 접수 확인 · 견적 발송 · 결제 확인 · 납품(검수 안내) · 검수 확정 · 진행 불가/취소 · 문의 답변. 관리자(`settings.notifyEmails`): 새 의뢰 · 수락 · 결제 확인 · 고객 문의 · 검수 확정. 알림톡은 템플릿 심사 뒤(iwinv 선례).

## 10. 영카트 연동

마켓 ⑲ 그대로: 앵커 `sp-develop-svc`(시드 `develop:seed-anchor`, it_price 0 · it_sc_type 1 · ca_id '10') · `insertQuoteOption(itId, paymentKey, amount)` + `insertCartRow`(상품명 `개발의뢰 · {제목} · {마일스톤명}`) → `/shop/orderform.php`. PHP 는 `extend/sp_quote_cart.extend.php` 의 마켓 it_id 사전에 `sp-develop-svc` 추가(주문서·주문메일 union 자동 포함) + 테마 cart.php 배지 문구. 검증 스크립트는 od_id 를 2^53 미만 대역으로(마켓 함정).

## 11. 단계·검증

| 단계 | 내용 | 방식 |
|---|---|---|
| P0 | 앱 스캐폴딩(5177) · `@sp/ui` 추출(마켓 전환) · 계약 `develop.ts` · Prisma 모델+migration · 라우트/메뉴 뼈대 · 앵커 시드 · PHP 사전 · nginx 스니펫 · 문서 | 직접(설계 판단) |
| P1 | 의뢰 등록·목록·상세·수정(고객) · 관리자 워크큐·상세 · AI 자동 초안·재생성(보충 메모)·구조 편집·공개 · 상태 전이 · 메일 | 계약·서버 직접 → 화면 2워커(고객 앱 ∥ 관리자) 위임 + 전수 감사 |
| P2 | 견적서 CRUD·붙여넣기·발송·인쇄 · 수락/거절 · 마일스톤·checkout·lazy 승격 · 문의 스레드 | 같음 |
| P3 | 확인 요청·납품·검수·자동확정·잠금 해제 · 추가 견적 · 세금계산서 기록 · A/S | 같음 |
| 검증 | `ops/scripts/e2e-develop.mts`(API 하네스, 마켓 하네스 관례: run → cleanup) · 실브라우저 워크 · `pnpm -r typecheck/lint` · e2e-market 회귀(러너 일반화 영향) | |

### 11.1 구현 상태 (2026-09-05, 브랜치 `feat/develop-mvp`)

| 층 | 상태 |
|---|---|
| 백엔드(P0~P3 전부) | 완료 — 계약 `develop.ts` · migration `20260905150000_develop_request` · 라우트 `develop-requests.ts`(회원 17종: 등록·목록·상세·수정·첨부·취소·**수락/거절·문의·checkout·검수 확정/수정 요청·확인 요청 응답**) · `admin-develop-requests.ts`(워크큐·상세·전이·AI 재생성·검토서 PUT/publish/unpublish/reset·구성도 publish/upload·이벤트·파일) · `admin-develop-quotes.ts`(견적 CRUD·발송·철회·마일스톤 수동 입금) · `admin-develop-settings.ts` · lib `develop*.ts`(lazy 승격·자동확정·만료·메일 10종·설정) · AI 러너 target 어댑터 일반화(마켓 e2e 148/0 무결) |
| 고객 앱 `apps/develop` | 완료 — 랜딩·위저드 3스텝·내 의뢰·상세(스텝퍼·검토서/구성도 공개본·견적 카드 **수락/거절/마일스톤 결제**·문의·A/S·검수·확인 요청 응답·첨부 미리보기)·수정·견적서 인쇄. Opus 워커 2본(`docs/prompts/develop-phase1a-app.md`·`develop-phase2a-app.md`) + 전수 감사 |
| 관리자 `apps/web` | 완료 — 워크큐·전면 상세(전이·AI 3층 편집기·구성도·**견적 편집기(붙여넣기 파싱)·발송·철회·마일스톤 수동 입금**·타임라인·내부 메모·검수 기간)·설정·AI 설정 develop 블록·사이드바 배지. 워커 2본(`develop-phase1b-admin.md`·`develop-phase2b-admin.md`) + 감사 |
| 공용 `@sp/ui` | 마켓 7컴포넌트 추출(brand-* 시맨틱 토큰·`filesPath` prop·`uploaded`·`resolution`/`adminComment` 렌더). 마켓 typecheck·lint 0 |
| 검증 | e2e-develop **110/0**(run→cleanup 잔여 0) · e2e-market **148/0** · api 단위 999 · utils 152(견적 순수 함수 8 포함) · 8워크스페이스 typecheck 0 · lint 0(기존 `order-progress.ts`·`bom-claims.ts`·`pcb-claims.ts` 의 prefer-optional-chain 3건은 이 작업 전부터 있던 것) · 실브라우저: 고객 위저드 완주·상세·수정·인쇄 / 관리자 4화면 / 견적 작성→발송→수락→수동 입금→in_progress·철회·삭제, pageErrors 0 |
| 운영 반영 | 앵커 `sp-develop-svc` 시드 · PHP 사전(`sp_develop_it_ids` union·cart 배지) · 라이브 nginx `/develop/`(폐지된 `/rnd` 5177 블록 재활용) 반영·재시작 완료 |

남은 것: 파일서버 serviceType `develop` 운영 수용 실측 · 알림톡 템플릿 · 실 LLM 초안 육안 1회(관리자 상세에서 `초안 다시 만들기`) · 위키 재컴파일 · 발주서(PO) 첨부 라우트(계약 `poFile` 자리만 있음) · 마일스톤 `manual` 트리거의 청구 열기 플래그.

## 12. 결정 로그

- 2026-09-05 기획 확정(사용자): 마켓과 분리·이름·관리자 주도 AI·항목별 견적·마일스톤·회원 전용·실무 보강 6건(연락처·조건 문서 견적서·동의 기록·추가 견적·확인 요청·잔금 후 해제) 채택. 디자인은 새로.
- 2026-09-05 구현 중 결정: `develop.dev-review` 기본 모델 kimi-k3 think medium(관리자 대기라 정밀, §12.8 프로빙 근거) · 하네스는 develop.* 유스케이스를 끄고 돈다(관리자 재생성은 force 라 부르지 않음) · 세금계산서 이벤트는 payload 만으로 등록 허용 · `DevelopOkResponse`·`paidBy` 계약 additive · 관리자 워커가 세션 강제 종료로 끊겨 i18n 230키를 재스폰 워커가 보충(키 누락 검사 스크립트 관례 확립).
