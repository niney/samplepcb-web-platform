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
| `sp_develop_request` | 의뢰 | `mbId` · `title` · **`requestMode`**(system\|individual, §7.2.1) · `serviceAreas`(string[] — 시스템개발이면 6분야 전부) · `tools`(MarketTools) · `description` · `answers`(MarketAnswers) · **`currentStage`·`targetStage`·`wishDate`(YYYY-MM-DD)·`wishNote`·`expertDelegate`·`production`(DevelopProductionPlan JSON)** · 연락처 `contactName/Company/Phone/Email/Hours` · `budgetRange`(**개발의뢰 전용 사전** `DEVELOP_BUDGET_RANGES`) · `ndaWanted` · `aiConsent` · `status`(§4) · `assigneeMbId` · `internalMemo`(고객 비노출) · `aiSupplement`(AI 코퍼스용 보충 메모) · 검토서 3층 `devReviewDraft`·`devReview`·`devReviewPublic`(+`devReviewDraftAt`·`devReviewEditedAt/By`·`devReviewPublishedAt`·`devReviewInputHash`) · 구성도 `devDiagram`(메타)·`devDiagramHtml`·`devDiagramPublicHtml`·`devDiagramPublishedAt`·`devDiagramSource`(ai\|upload) · `reviewDays`(검수 기간, 수락 견적에서 복사) · `startedAt`·`deliveredAt`·`completedAt`·`cancelledAt`·`cancelReason`·`declinedReason` |
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

### 6.1 개발 일정(예상) — 검토서 전용 블록 (2026-09-05)

**역할 분리: 검토서의 일정은 "예상", 견적서의 기간은 "약속".** 검토서는 자료만으로 낸 추정이라 범위로 말하고, 계약이 걸리는 확정 기간·마감은 견적서(`durationDays`·마일스톤)가 정한다. 두 문서가 같은 수치를 다르게 말하면 견적서가 이긴다 — 화면 캡션(`DEV_REVIEW_SCHEDULE_CAPTION`)이 그 순서를 그대로 적는다.

- **개발의뢰에서만 만든다.** 러너가 `target.kind === 'develop'` 일 때만 `features.schedule` 을 켜고, 그때만 프롬프트에 `[개발 일정]` 블록·`DEV_REVIEW_LLM_JSON_SCHEMA_WITH_SCHEDULE`·일정 후처리가 붙는다. 마켓(`market.dev-review`)은 프롬프트 문자열·후처리 결과가 v5 와 **바이트 동일**하고 저장분에 `schedule` 키 자체가 없다(단위 테스트가 박제, e2e-market 회귀).
- **스키마는 additive**: `MarketDevReview.schedule`(선택·nullable), `DEV_REVIEW_VERSION` 은 **4 유지**. 옛 저장분·마켓 검토서가 그대로 파싱된다. 저장분 읽기는 `.catch(null)` 로 관대하고, 관리자 PUT(`AdminDevelopReviewPutBody`)만 catch 를 벗겨 잘못된 값에 400 을 낸다.
- **수치는 범위만.** 단계 3~8개, 각 단계 `minWeeks`·`maxWeeks`(정수 1~104주)·산출물·고객 선행 조건·비고. **점 추정 필드도 합계 필드도 없다** — 합계는 `devReviewScheduleTotals` 가 단계에서 매번 다시 낸다(모델이 준 합계는 버린다). 후처리가 이름 빈 단계 삭제·1~104 클램프·min>max 교환·8개 절단을 결정적으로 한다(진단 `schedulePhasesDropped`).
- **희망 완료 시점 대조는 순수 함수**(`devReviewScheduleFit`) — LLM 판단이 아니다. 상한(주)은 `within_1m`=4 · `m2_3`=13 · `m4_6`=26 · `over_6m`=상한 없음. 판정: 상한 없음 → ok · 최대 ≤ 상한 → ok · 최소 ≤ 상한 < 최대 → tight · 최소 > 상한 → over. `wishCode` 는 후처리가 `answers` 의 `timeline` 에서 채우고, '협의해서 정할게요'(unknown)·미응답이면 null → unknown.
- **관리자 편집**: 검토서 편집기에 "개발 일정(예상)" 섹션(단계 추가·순서 이동·삭제, 전제 한 줄, 실시간 합계·대조). 일정 통째 삭제("일정 없이 공개") → `schedule=null` → 고객 화면에서 섹션이 사라진다. 일정이 없을 때 `단계 추가` 가 빈 일정을 만들고 `wishCode` 는 고객 답변에서 온다(관리자가 고르는 값이 아니다).
- **견적으로 가져오기**(견적 편집기, 관리자가 누를 때만): `검토서 일정 가져오기` → `durationDays = 최대 주 × 7일`(보수적, 이미 값이 있으면 인라인 확인) · `단계로 마일스톤 초안 만들기` → 결제 조건을 통째 교체(첫 행 `on_accept` "착수금", 마지막 행 `on_completion`+산출물 해제 "잔금", 중간은 `manual` 제목=단계명, 비율은 균등 분할 정수·나머지는 마지막 행, 합 100%). 자동 반영은 없다 — 예상을 약속으로 바꾸는 것은 사람의 결정이다.
- 고객·전문가·관리자가 보는 화면은 공용 `DevReviewView` 하나다(기술개발 검토 결과 **뒤**, 개발명세서 **앞**). `schedule` 이 없거나 단계 0이면 섹션째 안 그린다.

### 6.2 검토서 버전 원장 — 이력·비교·복원 (2026-09-05)

3층 컬럼(`devReviewDraft`·`devReview`·`devReviewPublic`)은 **현재 포인터**일 뿐 이력이 없었다 — 초안을 다시 만들면 이전 AI 초안이 사라지고, 다시 공개하면 고객이 전에 본 판을 되짚을 수 없었다. `sp_develop_review_version`(의뢰별 `seq` 1부터, `kind`, 검토서 JSON 스냅샷, `contentHash`, `parentSeq`, `author`, `jobId`, `inputHash`, `note`)이 그 이력이다. 3층 컬럼은 그대로다.

- **기록 3순간**: AI 초안 완성(`runner.writeReviewToTarget`, `ai_draft`, author=모델명) · 관리자 저장 `PUT …/review` 와 초안 가져오기 `reset`(`working`, reset 은 note `초안에서 가져옴`) · 공개 `publish`(`published`). `unpublish` 는 기록하지 않는다. 초안이 작업본을 seed 할 때도 같은 내용이라 따로 기록하지 않는다.
- **중복 규칙**: 같은 의뢰의 **직전 버전**과 `kind`·`contentHash` 가 모두 같으면 기록하지 않는다. kind 가 다르면 내용이 같아도 기록한다(공개는 공개한 시각 자체가 사실). `contentHash` = `meta.editedAt/By` 를 뺀 키 정렬 JSON 의 sha256(저장 시각·저장자는 내용이 아니다 — 그 외 meta(jobId·model·generatedAt)는 내용이다: 새 AI 실행은 글자가 같아도 새 판).
- **복원** `POST …/review/versions/:seq/restore`: 그 판을 작업본으로 덮고(`meta.editedAt/By` 는 지금·복원자) `working` 버전을 `parentSeq=seq`, note `v{seq} 복원` 으로 쌓는다. 이력은 지우지 않는다.
- **목록** `GET …/review/versions` 는 본문 없는 메타(요약 80자·요구사항/상의/일정 단계 수)와 `current{draftSeq,workingSeq,publicSeq}`(지금 3층 JSON 과 contentHash 가 같은 최근 버전 — "지금 초안/작업본/공개" 배지 근거)를 준다. 본문은 `GET …/review/versions/:seq`.
- **구조 비교**는 `@sp/utils` 순수 함수 `diffDevReview(a,b)`(글자 diff 아님) — summary·adminComment·일정 전제는 단일 텍스트, 요구사항은 text 일치, 분야는 area 코드로 짝짓고 명세는 `item`·관찰은 text, 상의 항목은 question 으로 짝지어 **확인 결과 변화**도 changed, 일정은 단계 `name` 으로 짝지어 기간·산출물·선행 조건·비고·희망 시점, 한쪽만 일정이면 단계 전부 added/removed. checks·meta·brief 는 비교하지 않는다. 변경 문장은 `diffWords`(공백 토큰 LCS)로 단어 하이라이트.
- **관리자 화면**: 검토서 패널 세 번째 탭 "버전" — 왼쪽 목록(최신 위, kind 배지·지금 포인터 배지·작성자·note·`← v{parent}`), 각 행 A/B 라디오·보기·작업본으로 복원(인라인 확인, 편집 중이면 "저장하지 않은 편집이 사라집니다" 경고만). 기본 선택 **A=지금 공개본, B=지금 작업본**(지금 공개하면 고객에게 무엇이 바뀌는지) — 공개본이 없으면 최신 AI 초안 ↔ 작업본. 편집 탭 옆에 `v{n} 작업본` 한 줄.
- **고객 화면**: 최신 공개본 하나만 그대로 보되 헤더 메타 줄 끝에 `v{n} 공개본`(`DevelopRequestDetail.reviewPublicSeq`). 고객용 변경 이력은 필요해지면 그때.
- **백필** `apps/api/src/scripts/backfill-develop-review-versions.ts`(idempotent — 버전 0개인 의뢰만, 초안→작업본(초안과 다를 때만)→공개본을 시각 순으로, note `백필`). 2026-09-05 로컬 실행: 의뢰 2건·3판.
- 구성도(HTML)도 같은 패턴이 가능하지만 이번엔 검토서만. 기존 `publishedStale` 은 여전히 시각 비교(editedAt > publishedAt)라 내용이 같아도 켜질 수 있다 — 원장의 contentHash 로 바꾸는 것은 후속.

## 7. 화면

### 7.1 공용 패키지 `@sp/ui`

마켓에서 옮기는 것(i18n 미사용·`@sp/*` 의존만 확인됨): `DevReviewView`·`DevDiagramSection`·`AreaIcon`·`FileDropZone`·`FilePreviewModal`(+`lib/file-preview.ts`·`error-msg.ts`)·`QuestionField`(+`QuestionState` 타입)·`UiPagination`. 클래스는 시맨틱 토큰만(`copper-*` → `brand-*`). 마켓 `style.css` 에 `--color-brand-*` 별칭 추가, 앱 CSS 는 `@source "../../../packages/ui/src"`(Tailwind v4 가 node_modules 심링크를 스캔하지 않음).

### 7.2 고객 (`apps/develop`)

연락처 자동 채움(2026-09-10): 신규 위저드는 `GET /api/me/contact`로 로그인한 본인의 이름·회사·전화·이메일을 한 번 조회한다. 이름은 `mb_name`, 전화는 휴대전화(`mb_hp`) → 일반전화(`mb_tel`), 회사는 `sp_member_profile.companyName` → 레거시 `mb_2` 순서다. 비어 있거나 조회에 실패하면 직접 입력한다. 고객이 입력하거나 지운 칸은 늦게 온 응답으로 덮어쓰지 않으며, 자동 채움 안내를 표시하고 자유롭게 수정할 수 있다. 수정값은 해당 의뢰의 연락처 스냅샷에만 저장하고 회원정보를 갱신하지 않는다. 기존 의뢰 수정·임시저장 복원 시에는 빈칸을 포함해 저장값이 우선한다. "처음부터"는 회원정보 기본값을 다시 적용한다.

임시저장은 `sp-develop-request-draft:{encodeURIComponent(mbId)}` 키와 `v:3, mbId` 소유자 기록으로 회원별 분리한다. 계정이 바뀌면 현재 폼을 비우고 해당 회원의 초안만 확인한다. 구 공용 키의 v2 초안은 소유자를 확인할 수 없어 자동 이관/복원하지 않으며 원본은 삭제하지 않는다. 파일은 종전처럼 저장하지 않는다. API는 JWT의 본인 ID만 사용하며 응답은 `Cache-Control: no-store`, JWT·기존 `/api/me` 계약·DB 구조는 유지한다. 검증: `pnpm --filter api test -- src/routes/me.test.ts`, `pnpm --filter e2e e2e develop-contact`(연락처 API 스텁, DB 쓰기 없는 브라우저 검증).

| 경로 | 화면 |
|---|---|
| `/develop` | 랜딩 — 서비스 소개·프로세스(레거시 7단계 계승)·분야 5·CTA·FAQ |
| `/develop/request` | **위저드 v2 5스텝(2026-09-08, §7.2.1)** — ① 개발 메뉴(시스템개발 배타 / PCB·기구·앱·서버 복수) ② 의뢰 내용(제목·설명·현재/목표 단계·희망 완료 시기·예산·참고 자료·AI 동의·NDA·시스템개발이면 후속 질문 방식) ③ 세부 질문(시스템개발 3문항 또는 전문가 맡김 / 개별은 분야별 질문·툴·슬롯) ④ 제작 계획(시제품 수량·제작 범위·연간 수량·조달·납품 형태) ⑤ 검토·접수(**연락처** + 요약 + 동의) |
| `/develop/me` | 내 의뢰 목록(상태 배지·다음 할 일) |
| `/develop/requests/:id` | 상세 — 상태 스텝퍼 · 의뢰 내용 · AI 검토서(공개본) · 시스템 구성도 · 견적서(들)·수락 · 결제(마일스톤) · 진행·문의 타임라인 · 산출물(잠금 표시) |
| `/develop/requests/:id/edit` | 수정(received·reviewing) |
| `/develop/requests/:id/quotes/:qid/print` | 견적서 인쇄용 |

접수 완료 화면: "담당자가 검토 후 연락드립니다(영업일 2~3일)" + 메일.

#### 7.2.1 위저드 v2 — 프로토타입 이식 (2026-09-08)

- **디자인·기구 범위 질문 정리(2026-09-08)** — 시스템개발의 고정 범위 질문은 `system.product_design`·`system.mech_design` **2개**다. 각각 준비 상태·담당을 이미 묻으므로 중복된 `system.collab`은 신규·수정 폼에서 제거했다(아래 협업 3문항 기록은 이전 구성). 섹션은 "제품 외관·기구 개발 범위", 외관·형태·사용성과 케이스 구조·배치·조립 설계를 설명으로 구분한다. 두 문항에 `modify`(기존 자료를 바탕으로 당사에 수정 의뢰)를 추가했고 `other_vendor` 선택 시에만 업체 담당 범위·자료 전달 시기 메모를 선택 입력한다. 다른 선택으로 바꾸면 숨겨진 메모는 전송하지 않는다. 전문가에게 맡김·AI 질문 사용 중에도 범위 2문항은 유지한다. DB 변경 없이 기존 저장 JSON은 유지하며, 제거된 질문은 기존 미지 코드 표시 규칙으로 읽고 수정 제출 시 제외한다.

사용자가 준 프로토타입(ChatGPT toolgate `samplepcb-development-request`, 5스텝)을 기준으로 위저드를 재편했다. 사용자 결정 4건: **개별 메뉴에서 회로·펌웨어를 뺀다** · **스텝 5개** · **분야별 질문은 선택지+서술 혼합** · **예산 사전은 마켓과 분리**. v1.9 질문서(244문항, 커밋 87103f388)는 같은 날 main 에서 되돌렸다(너무 복잡 — `feat/develop-questionnaire-v19` 에만 남음).

- **의뢰 방식 `requestMode`** — `system`(시스템개발: 회로·PCB·펌웨어·기구·앱·서버·시제품 통합 분석, 다른 메뉴와 배타) / `individual`(PCB설계·기구설계·앱개발·서버개발 복수). 저장 `serviceAreas` 는 시스템개발이면 **6분야 전부**(`resolveDevelopServiceAreas`) — 배지·검토서 분야 카드·프롬프트가 분야 코드만 보고 동작하고, 전 분야 = "시스템개발" 배지. 회로·펌웨어는 시스템개발 안에서만 다룬다.
- **레지스트리 분리** — `packages/api-contract/src/schemas/area-registry.ts`(팩토리 `createAreaRegistry`: 자료형·정렬·배지·질문 목록·답변 검증·툴·슬롯 파싱을 한 곳에) 위에 마켓 `MARKET_REGISTRY`(market-areas.ts, export 이름·시그니처 불변)와 개발의뢰 `DEVELOP_REGISTRY`(develop-areas.ts)를 각각 만든다. 개발의뢰 6분야 중 회로·PCB·펌웨어·앱·서버의 프롬프트 조각·툴·슬롯은 마켓 정의를 재사용하고 질문만 프로토타입 문안으로 바꿨다. **기구설계(mech)** 는 새로 정의(질문 7·MCAD 툴·슬롯 4·프롬프트 조각). 질문 `kind:'text'`(선택지 없이 서술 — 답은 `choices: []` + `note`, 최대 2000자)가 생겼고 `QuestionField` 가 textarea 로 그린다. 시스템개발은 분야별 질문 대신 `DEVELOP_SYSTEM_QUESTIONS` 3문항(사용 상황·입력/출력·장애 시 동작, 전부 서술) — 팩토리 `fullQuestions`.
- **컬럼으로 옮겨간 조건** — 현재/목표 개발단계(`DEVELOP_CURRENT_STAGES`·`DEVELOP_TARGET_STAGES`), 희망 완료 시기(`wishDate` 날짜 **또는** `wishNote` 자유문, 하나 이상), 예산(`DEVELOP_BUDGET_RANGES`: 1천만 미만 ~ 1억 이상 + 견적 후 결정 — 마켓 500만 단위 사전과 별개, 로컬 옛 행은 migration 이 코드 매핑), `expertDelegate`(시스템개발 "전문가에게 맡김" — 3스텝 생략, 실린 답변은 서버가 버린다), `production`(시제품 모드·수량·제작 범위·연간 수량·조달·납품 형태(우선순위 항목은 2026-09-08 화면에서 제거, 컬럼은 null 유지) — 제작 범위가 없으면 조달·납품은 null 로 정규화). 마켓 공통 조건(`timeline`·`target_stage`·`deliverable_scope`)·공통 질문은 개발의뢰에서 더 안 쓴다(옛 행의 답변 코드는 코드 라벨로 보인다).
- **AI 코퍼스** — `DevReviewSource` 에 `registry`·`conditionLines`·`wishCode` 가 생겼다. 개발의뢰 소스(`develop-ai-source.ts`)는 `DEVELOP_REGISTRY` + 컬럼을 "- 라벨 → 값" 줄로 만든 `developConditionLines`(프롬프트 "■ 프로젝트 조건"·근거 코퍼스·원천 서명에 합류) + `developWishCode(wishDate, createdAt)`(검토서 일정 대조 코드: ≤4주 within_1m · ≤13 m2_3 · ≤26 m4_6 · 그 밖 over_6m, 자유문만이면 null=unknown). 프롬프트 [개발 분야]·답변 라벨·후처리 분야 정렬·구성도 프롬프트·LLM JSON 스키마 분야 enum(`buildDevReviewLlmJsonSchema(codes, withSchedule)`)이 전부 레지스트리를 본다. 마켓 호출은 레지스트리 생략 = `MARKET_REGISTRY` 라 프롬프트·스키마 바이트 동일(dev-review.test 26·dev-diagram.test 6·market-areas.test 14 green).
- **화면** — `@sp/ui` `DevReviewView` 에 `registry` prop(개발의뢰 화면은 `DEVELOP_REGISTRY` 를 넘긴다), `AreaIcon` mech 아이콘, `--color-area-mech` 토큰(develop·web·market style.css). `packages/utils` `buildDevReviewBriefRows/AreaCards/View(review, registry)`. 고객 위저드·수정·상세·홈·목록과 관리자 워크큐·상세·의뢰 내용은 워커 브리프 `docs/prompts/develop-wizard-v2a-app.md`·`-v2b-admin.md` 대로.
- **프로토타입에서 일부러 안 가져온 것** — 키워드 정규식으로 띄우는 "입력 분석 완료" 배지(가짜 AI), 후속 질문 4택 중 easy/expert/auto(auto 는 180자 규칙이라 가짜 — 결정 3 "위저드에서 AI 제거"와 충돌; delegate 만 채택), 회사명·연락처 한 칸(현행 연락처 블록 유지, 마지막 스텝), 랜덤 접수번호(requestId 로), 3스텝 재진입 시 답변 소실·무검증(결함).
- **하네스** — `ops/scripts/e2e-develop.mts` 픽스처를 v2 payload(개별 PCB+앱·단계·희망 자유문·시제품 계획)로 바꾸고 시스템개발 등록 2건(맡김이면 답변 0·6분야·기구 포함 / 서술 답변 저장)·개별 메뉴 밖 분야 400·서술 문항에 선택지 400·시제품 수량 누락 400·분야 축소 시 답변 자동 정리를 더했다(136/0). 계약 단위 테스트 `packages/utils/src/develop-areas.test.ts`(11). 브라우저 스모크 `e2e/specs/develop-wizard.e2e.test.ts`(`PORTAL_E2E=1 pnpm -F e2e e2e develop-wizard`) — 시스템개발 5스텝 완주(메뉴 배타·맡김·제조 연계 확인)·개별 PCB+기구(서술 문항 textarea)·관리자 워크큐 칩/상세 의뢰 내용, pageErrors 0.
- **프로토타입 2판 반영(2026-09-08 저녁, 사용자 결정)** — 같은 날 프로토타입이 다시 바뀌었다(앱·서버를 "자료 분석형"으로 재분류 + 설명문·첨부 파일명 정규식으로 이미 언급된 문항 생략 + 후속 질문 방식 4택을 앱·서버까지 확장 + 시스템개발에 「제품디자인·기구설계 및 협업 범위」 select 3문항). 채택: ① **협업 범위 3문항**을 `DEVELOP_SYSTEM_COLLAB_QUESTIONS`(선택지형 `system.product_design`·`system.mech_design`·`system.collab`, 탈출구 "잘 모르겠음·전문가 판단 요청"/"상담 후 역할 분담 결정")로 시스템개발 문항에 더했고 `askOnDelegate` 라 **전문가에게 맡김에서도 묻는다**(등록·수정 라우트는 `keepDevelopDelegateAnswers` 로 이 밖의 답변만 버린다). ② 앱·서버의 "쉬운 질문" 부분집합은 라디오 대신 문항 `tier:'more'`(앱 역할·오프라인 / 서버 규모·프로토콜·운영 / PCB 기구 간섭·주의 신호 / 기구 재질·환경·방열)로 두어 3스텝에서 "더 자세히 답하기"로 접는다(답은 그대로 저장). 기각: 정규식 문항 생략·질문 방식 4택 확장·"자료 분석형" 꼬리표(가짜 분석 — 진짜 분석은 접수 뒤 검토서의 상의 항목).
- **예시 사이트 기준 간소화(2026-09-08 밤, 사용자 결정)** — 예시에 없는 것은 걷어냈다: "더 자세히 답하기" 접기(tier 폐기, 분야 문항 전부 펼쳐 나열) · 희망 툴 UI(분야별 툴 칩 — PCB 만 문항 `pcb.tool`(Altium/OrCAD·Allegro/PADS/KiCad/기타 + 버전 메모)로 대체, `tools` 컬럼은 빈 값으로 저장) · 분야별 자료 슬롯("있으면 좋은 자료" — 첨부는 2스텝 업로드 존 하나, `attachment:<area>:<slot>` 파트는 서버가 여전히 받는다) · 2스텝 AI 동의 체크(5스텝 동의 하나로 통합 — "견적 검토와 AI 사전 검토 목적" 문구, 그 체크가 `aiConsent`) · 사이드 DRAFT 요약 카드·하단 바 답변/첨부 카운터 · 연락처 "통화 가능 시간"(컬럼은 남고 화면만 뺐다). 비밀유지 체크는 5스텝 동의 옆(수정 화면은 연락처 아래)으로 옮겼다. 유지: 연락처 4칸(이름·회사·전화·이메일), 예산 필수("견적 후 결정"이 미선택 역할), 선택지+서술 혼합, 협업 3문항.
- **화면 구현 결정(워커 보고)** — 시제품 라디오는 폼 안에서만 "미선택(null)"을 들고 저장 직전 계약 모양으로 정규화한다(필수 검증 문구를 살리기 위해). 하단 바 오류는 다음/접수를 누른 뒤에만 띄우고 스텝이 바뀌면 지운다. 관리자 목록·상세는 시스템개발이면 분야 배지("시스템개발")가 의뢰 방식 칩과 같은 말이라 칩만 남긴다. 현재→목표 단계는 한 행(옛 v1 행은 "—"). 검토서 비교 탭(`diffDevReview`)도 레지스트리 인자를 받는다.

**P1 구현(2026-09-05)** — 페이지 `pages/{Home,RequestWizard,Me,RequestDetail,RequestEdit,QuotePrint}.vue`, 위저드 조각 `components/request/{StepDescribe,StepConditions,StepContact,ContactFields,WizardAside}.vue`, 상세 조각 `components/detail/{ProgressStepper,RequestContent,QuoteCard,Timeline,AttachmentList}.vue`, 폼 상태 `composables/useRequestForm.ts`, 서버 상태 `api/useDevelopRequests.ts`, 포맷·다운로드·에러 `lib/{format,download,error-msg,auth-urls}.ts`. 결정 넷: ① 위저드와 수정 화면이 **같은 폼 상태**를 공유하고 수정은 스텝 없이 한 화면에 이어 붙인다(이미 쓴 글을 고치러 온 사람에게 3단계를 다시 걷게 하지 않는다) — 그래서 `StepDescribe` 는 `showAttachments`, `StepConditions` 는 `showSlots` 로 등록 전용 블록만 끈다. ② 수정 화면의 첨부는 저장을 기다리지 않고 서버에 즉시 반영한다(파일에 대한 사용자의 기대가 그렇다) — 본문은 PATCH 로 **바뀐 필드만** 보낸다. ③ 검토서가 있으면 구성도를 `DevReviewView` 안에 넣고, 없을 때만 `DevDiagramSection` 을 단독 섹션으로 그린다(같은 도면이 두 번 뜨지 않게). ④ 수락·거절·문의·결제는 P2 라우트가 없어 **버튼 자리를 만들지 않는다**(비활성 버튼은 없는 기능을 있는 것처럼 보이게 한다). 날짜 표기는 `dateShort`·`dateTimeKst` 가 **둘 다 KST 기준**이다 — UTC 문자열을 그냥 자르면 저녁 접수 건이 헤더와 타임라인에서 하루 어긋난다.

**P2 구현(2026-09-05)** — 고객 행동이 붙었다: 신규 조각 `components/detail/{CommentComposer,DecisionPanel}.vue`, `QuoteCard.vue` 에 수락 패널·거절·마일스톤 결제 버튼, `Timeline.vue` 에 `event-actions` 스코프 슬롯, `api/useDevelopRequests.ts` 에 훅 6종(`useAcceptQuote`·`useDeclineQuote`·`usePostComment`·`useCheckoutMilestone`·`useDeliveryDecision`·`useReviewRequestDecision`). 결정 넷: ① 수락은 **표준 조건 동의 체크 + 이름**이 둘 다 있어야 열린다(서버가 시각·IP·이름을 기록해 계약을 갈음하므로 동의가 클릭 한 번에 묻히면 안 된다). ② `payable` 은 서버 파생이라 화면이 다시 계산하지 않고, 그 마일스톤 행에만 결제 버튼을 세운다 — 나머지 행은 상태·결제일·주문번호와 무통장 "입금 확인 중" 배지를 보여 준다. ③ **미응답 판정은 타임라인 부모가 한다**(어떤 `review_request` 가 아직 안 끝났는지는 뒤따르는 `review_approved`/`review_changes` 의 `payload.eventId` 를 봐야 알 수 있다) — `Timeline` 은 슬롯만 내주고 판정을 모른다. ④ 결제는 주입 직전 `auth.bootstrap()` 으로 JWT `cartId` 스테일을 막고, 그래도 `NO_CART_ID` 면 한 번 더 부트스트랩하고 재시도한 뒤 영카트 주문서(`/shop/orderform.php`)로 `window.location.assign` 한다. 목록에서 "지금 할 일" 칩이 있는 행은 상세의 해당 섹션 앵커(`#quotes`·`#timeline`)로 바로 보낸다 — 칩만 링크로 만들면 카드 링크 안에 링크가 들어가므로 카드 자체에 앵커를 건다.

#### 7.2.2 AI 후속 질문 — 시스템개발 3스텝 (2026-09-08 밤, 사용자 결정)

시스템개발의 「몇 가지 질문에 답하기」를 고정 서술 3문항에서 **AI 가 설명문·첨부를 읽고 견적 산출에 꼭 필요한데 자료에서 확인되지 않는 것만 묻는 질문**으로 바꿨다. 결정 3("위저드에서 AI 제거")의 예외 — 검토서가 아니라 질문 고르기 한 번이며, 폴백이 있어 위저드가 LLM 에 인질 잡히지 않는다. 사용자 결정: 모델은 설정에서 고르되 기본 kimi-k3 · 질문 개수·형태는 정하지 않고 AI 에 맡긴다(폭주 방어 상한 8) · 읽을 수 있는 첨부는 전부 읽는다(문서 텍스트 + 이미지·스캔 비전 판독) · AI 동의는 2스텝 업로드 존 아래(모든 의뢰 공통 — 자료가 나가는 시점 앞).

- **유스케이스 `develop.followup`**(`sp_ai_usecase` 행, 기본 kimi-k3 · think low · 300초). 프롬프트는 코드 정본 `lib/ai/develop-followup.ts`(`develop-followup.v1`): 비전문가 전제, "견적 산출에 영향 주는 항목" 7개 목록 안에서만·자료에 답이 있으면 묻지 않음·기술값(전압·임피던스·층수·품번) 금지·2·4스텝에서 이미 받은 것(단계·시기·예산·수량·디자인/기구 주체) 제외·선택지 2~6 또는 서술·`understood`(자료에서 파악한 제품 한 문장). 파서가 결정적으로 정리: 빈 질문 삭제·중복 접기·상한 8·선택지 중복 제거·모델이 준 "모름" 류 제거 후 서버가 `unknown`/"잘 모르겠음" 부착·선택지 1개면 서술형·id `q1…`·옵션 코드 `o1…`.
- **흐름**: 2→3스텝 전환 때 `POST /api/ai/develop.followup/run`(multipart `payload {title, description}` + `attachment[]`) → 잡(검토서와 같은 2단: 이미지 판독 → 질문 생성, `sp_ai_job`, 같은 입력 1시간 재사용) → `GET /api/ai/jobs/:id` 폴링(`stage` attachments/followup, done 이면 `followup`) → 질문 표시. `GET /api/ai/develop.followup/status` 가 꺼져 있거나 error·시간 초과면 **고정 서술 3문항으로 폴백**. 진행 중엔 "기다리지 않고 전문가에게 맡김으로 진행" 탈출 버튼. 협업 범위 3문항은 그대로 아래에.
- **저장**: 등록 payload `aiQuestions { jobId, answers[{id, choice, text}] }` → 서버가 **잡에서 질문을 되읽어**(본인·완료 잡만, 아니면 400 `FOLLOWUP_JOB_INVALID`) 답만 합쳐 `sp_develop_request.aiQuestions`(`DevelopAiQuestions`: jobId·model·generatedAt·understood·questions[+answer])에 박제. 레지스트리 `answers` 와 분리(문항이 고정이 아니다). 수정 `PATCH aiQuestions {answers}` 는 답만(저장분 없으면 409 `NO_AI_QUESTIONS`), 맡김·개별 견적으로 바꾸면 통째로 비운다.
- **검토서 코퍼스**: 답한 AI 질문은 `DevReviewSource.extraAnswerLines`("- 질문 → 답")로 프롬프트 "질문 답변"·근거 코퍼스·원천 서명에 합류한다.
- **관리자**: AI 설정 탭 ⑥ 개발의뢰 후속 질문 카드(사용·모델·thinking·추가 지침), 의뢰 상세 "AI 추가 질문" 블록(understood + 질문/답).
- 폴백 경로는 하네스가(유스케이스 꺼진 상태 409·잡 없는 등록 400·저장분 없는 PATCH 409), 실 LLM 경로는 프로빙(`develop-followup` 샘플 실행)으로 본다.

### 7.3 관리자 (`apps/web` `/app/admin/develop`)

2026-09-09 비교 브랜치 `prototype/develop-g-c`에서는 이 모듈을 **개발(G)**로 표시하고, `origin/feat/develop-workflow-docs`의 구현을 **개발(C)**(`/app/admin/develop-c`, 고객 `/develop/c`)로 함께 제공한다. 의뢰 소속·목록·API·개발 설정을 분리하며 기존 의뢰는 G로 유지한다. 정본: [G/C 공존 프로토타입](develop-prototypes.md).

**개발 독립 모듈(2026-09-09)**: 상단 `통합 | PCB | BOM | 개발`에서 선택한다. 기존 통합 메뉴의 개발의뢰·설정은 개발 모듈로 이동했다. 업무별 목록은 프로젝트 단위로 검색·상태 필터·페이지를 제공하고, 선택한 업무의 상세 탭으로 연결한다. 메뉴 변경에 따른 DB migration은 없다.

| 경로 | 화면 |
|---|---|
| 루트 | 진행현황 — 전체 프로젝트 상태, 작업 진척도, 지연 작업·승인 대기 바로가기 |
| `requests` | 의뢰·검토 — 탭(접수·검토 중·견적 발송·결제 대기·진행 중·납품·완료·전체) counts, 검색, 담당자 |
| `quotes` | 견적·계약 — 검토/견적/수락 단계 또는 견적이 있는 의뢰, 견적 버전·금액·상태, 계약서 바로가기 |
| `schedule` | 수행·일정 — 수락 이후 또는 수행관리 이력이 있는 의뢰, 진척도·지연 작업·완료 예정일·착수 준비 |
| `documents` | 문서·승인 — 수락 이후 또는 수행관리 이력이 있는 의뢰, 문서별 현재 공개 버전·고객 응답·회신 요청일 |
| `delivery` | 납품·검수 — 진행/납품/완료 의뢰, 납품일·검수 기간·납품 완료확인서 |
| `payments` | 청구·결제 — 수락한 견적의 결제 단계, 수납·미수납 금액, 기존 입금 확인·수동 청구 연결 |
| `requests/:id` | **전면 상세**(드로어 아님) — 헤더(상태·전이·담당자) · 의뢰 내용·연락처 · AI 패널(초안 상태·재생성·보충 메모·구조 편집·공개) · 구성도 패널 · 견적서 목록·작성(붙여넣기)·발송 · 마일스톤·결제(od 파생·수동 확인) · 타임라인(메모·문의·확인 요청·납품·세금계산서) · 내부 메모 |
| `settings` | 표준 조건·기본 마일스톤·검수/하자/유효기간·수신 메일·AI 자동 초안 |

AI 모델·think·추가 지침은 기존 `/app/admin/settings` AI 탭에 `develop.*` 블록 추가.

업무 목록 조회는 `GET /api/admin/develop/workspace`(`section`, `tab`, `q`, `page`, `pageSize`)이며 `requireAdmin`으로 보호한다. DB에서 업무 범위와 검색·상태 조건을 적용한 뒤 페이지를 나누고, 해당 페이지의 수행관리 JSON에서 요약만 반환한다. 문서 본문·과거 버전·AI 결과는 목록 응답에서 제외한다. 고객 승인 집계는 현재 공개 버전 기준이고, 미수납은 수락 견적의 `pending` 결제 단계만 합산한다. 결제·만료·자동검수의 lazy 동기화는 기존 상세 조회 흐름을 유지한다.

기존 `requests/:id` 주소는 유지한다. `from`은 진입 업무 메뉴, `listTab/listQ/listPage`는 복귀 조건, `tab`은 상세 기능, `doc/kind`는 문서 선택·유형이다. 문서를 직접 선택해도 URL을 갱신한다. 상세의 일정·문서 패널은 재사용해 탭 이동 시 작성 중인 내용을 보존하며, 페이지를 떠날 때는 미저장 내용 확인을 거친다. 고객 `/develop`의 메뉴 구조는 유지한다. PCB·BOM 주문과의 정식 데이터 연결은 후속 범위다.

P1 구현(2026-09-05): 신규 `apps/web/src/admin/useAdminDevelop.ts`(목록·상세 폴링·patch·status·aiRun·review PUT/액션·diagram 액션/업로드·이벤트 생성·설정·배지 카운트) · 페이지 `pages/admin/AdminDevelop{Requests,RequestDetail,Settings}.vue` · 조각 `components/admin/develop/`(StatusBar·RequestContent·ReviewPanel·ReviewEditor·DiagramPanel·Timeline·SideCards·AiChips + 순수 모듈 `develop-review-edit.ts`·`develop-badge.ts`). 기존 파일은 `layouts/AdminLayout.vue`(배지 `developReceived` 분기)·`components/admin/AiSettingsForm.vue`(develop 카드 2장)·`i18n/locales/ko.ts`·`en.ts`(`admin.develop.*` 237키)만 건드렸다. 결정 셋: ① 상태·이벤트·견적 라벨은 계약 사전(`DEVELOP_*_LABELS`)이 정본이라 i18n 으로 복제하지 않고 화면 고유 문구만 키로 둔다. ② 검토서 편집기는 서버 응답을 필드별로 새로 만들어(`cloneDevelopReview` — `structuredClone` 은 reactive proxy 에서 던진다) 로컬 상태로 들고, 행 상한(`DEVELOP_REVIEW_LIMITS`)은 계약 zod `.max()` 와 같은 값을 복제해 초과 추가를 UI 에서 막는다. ③ 타임라인 등록 게이트는 종류별로 갈린다 — 세금계산서는 발행일만 채우면 열리고(원장 성격, 서버도 payload 만으로 받는다), 나머지는 제목·본문·첨부 중 하나를 요구한다. ④ 확인이 필요한 자리(초안 가져오기·상태 사유)는 전부 인라인 패널이다(네이티브 `confirm` 없음).

P2 관리자 견적 화면(2026-09-05): 상세 본문에 견적 섹션(`components/admin/develop/DevelopQuoteSection.vue` — 앵커 `#develop-quotes`, 옛 사이드 요약 카드는 삭제) · 견적서 한 장 읽기·철회·마일스톤 수동 입금 확인(`DevelopQuoteCard.vue`) · draft 전용 편집기(`DevelopQuoteEditor.vue`) · 폼↔계약 변환·검사 순수 모듈(`develop-quote-edit.ts`). 훅은 `useAdminDevelop.ts` 에 6개 추가(quote create/patch/delete/send/withdraw · milestone mark-paid, 성공 시 `['admin','develop']` 무효화). 결정 셋: ① 편집기는 문자열 폼으로 들고 저장 직전에만 계약 모양으로 바꾼다 — 금액 입력은 콤마를 허용하고(`parseAmountInput`) blur 에서 천단위로 다시 쓴다. ② 계약 zod 가 막는 자리(항목·마일스톤 ≥1, 비율 합 100%, 해제 마일스톤 ≤1, 각 길이·범위)를 `developQuoteIssues` 가 저장 전에 같은 값으로 먼저 검사한다 — 400 을 사용자 문구로 번역하는 대신 애초에 못 보내게 한다. ③ 발송은 "저장 → send" 두 걸음을 한 버튼에 묶고 그 사이에 인라인 확인 패널(합계·마일스톤 요약)을 세운다. ④ 새 견적 종류는 상태에서 파생한다(`defaultDevelopQuoteKind`: 착수 전 initial/revision · 착수 뒤 change) — 서버 409 `KIND_MISMATCH` 와 같은 규칙이라 화면에서 고를 수 없는 종류가 안 뜬다. ⑤ 붙여넣기 채우기는 빈 행을 버리고 뒤에 붙이며, 금액을 못 읽은 줄은 지우지 않고 경고로 되돌려 준다.

관리자 상세 레이아웃(2026-09-05 저녁, 사용자 결정): 우측 340px 사이드를 없애고 **단일 컬럼 max-w 1120px**. 사이드는 카드 4개가 짧아 아래가 통째로 비었는데 본문(검토서·견적 편집기·타임라인)만 좁아져 손해였다. 옛 사이드 내용은 헤더 아래 운영 띠(`DevelopOpsStrip.vue`, 구 `DevelopSideCards.vue`)로 흡수 — 진행 시각은 칩 한 줄, 검수 기간은 인라인 입력, 내부 메모는 기본 접힘(첫 줄 미리보기), 견적 요약은 삭제(본문 견적 섹션이 전부). 이어서(같은 날 밤) 다섯 섹션(의뢰 내용·AI 검토서·구성도·견적서·타임라인)은 **탭**으로 하나씩 본다 — 모두 길어 한 화면 나열은 스크롤 부담만 컸다. 탭은 URL `?tab=` 에 두어 새로고침·뒤로가기·딥링크가 살고, 패널은 `v-show` 로 전부 마운트해 편집 중 초안이 탭 이동에 안 날아간다(편집 중이면 탭에 "수정 중" 배지, 그 밖에 검토서 생성 중/초안/공개/공개 뒤 수정·구성도·견적 건수·발송 n·타임라인 건수 배지). 검토서·견적을 쓰며 참고하도록 **의뢰 내용 옆 보기**(탭 줄 오른쪽 체크박스 → 우측 420px 패널, 관리자 헤더 아래 자체 스크롤, 켜면 본문 최대 너비 1120→1560px, 의뢰 내용 탭에선 숨김, 켬/끔은 localStorage)를 둔다. 관리자 상세의 input·textarea·select 는 본문보다 한 단계 작은 글자.

## 8. API 지도

회원(prefix `/api`, 소유자만): `GET /ai/develop.followup/status`·`POST /ai/develop.followup/run`(multipart, §7.2.2)·`GET /ai/jobs/:jobId` · `POST /develop/requests`(multipart) · `GET /develop/my/requests` · `GET /develop/requests/:id` · `PATCH /develop/requests/:id` · `POST|DELETE /develop/requests/:id/files(/:fileId)` · `GET …/files/:fileId(/preview)` · `POST …/cancel` · `POST …/comments`(P2) · `GET …/quotes/:qid` · `POST …/quotes/:qid/accept|decline`(P2) · `POST …/milestones/:mid/checkout`(P2) · `POST …/deliveries/:eventId/confirm|changes`·`POST …/review-requests/:eventId/approve|changes`(P3).

관리자(prefix `/api/admin`, requireAdmin): `GET /develop/requests`(+counts) · `GET|PATCH /develop/requests/:id` · `POST …/status` · `POST …/ai/review`·`POST …/ai/diagram` · `PUT …/review`·`POST …/review/publish|unpublish|reset` · `POST …/diagram/publish|unpublish|upload` · `POST …/quotes`·`PATCH /develop/quotes/:qid`·`POST …/send|withdraw` · `POST …/events`(multipart) · `POST /develop/milestones/:mid/mark-paid` · `GET …/review/versions`·`GET …/review/versions/:seq`·`POST …/review/versions/:seq/restore`(§6.2 버전 원장) · `GET /develop/files/:fileId(/preview)`(의뢰·이벤트·견적 파일 한 번호 체계, 미리보기는 고객 라우트와 같은 buildFilePreview) · `GET|PATCH /develop/settings`.

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
| 관리자 `apps/web` | 완료 — 워크큐·전면 상세(전이·AI 3층 편집기(**개발 일정(예상) 섹션·버전 탭(원장·구조 비교·복원, §6.2)**)·구성도·**견적 편집기(붙여넣기 파싱·검토서 일정 가져오기·단계로 마일스톤 초안)·발송·철회·마일스톤 수동 입금**·타임라인·내부 메모·검수 기간)·설정·AI 설정 develop 블록·사이드바 배지. 워커 2본(`develop-phase1b-admin.md`·`develop-phase2b-admin.md`) + 감사 |
| 공용 `@sp/ui` | 마켓 7컴포넌트 추출(brand-* 시맨틱 토큰·`filesPath` prop·`uploaded`·`resolution`/`adminComment` 렌더). 마켓 typecheck·lint 0 |
| 검증 | e2e-develop **110/0**(run→cleanup 잔여 0) · e2e-market **148/0** · api 단위 999 · utils 152(견적 순수 함수 8 포함) · 8워크스페이스 typecheck 0 · lint 0(기존 `order-progress.ts`·`bom-claims.ts`·`pcb-claims.ts` 의 prefer-optional-chain 3건은 이 작업 전부터 있던 것) · 실브라우저: 고객 위저드 완주·상세·수정·인쇄 / 관리자 4화면 / 견적 작성→발송→수락→수동 입금→in_progress·철회·삭제, pageErrors 0 |
| 운영 반영 | 앵커 `sp-develop-svc` 시드 · PHP 사전(`sp_develop_it_ids` union·cart 배지) · 라이브 nginx `/develop/`(폐지된 `/rnd` 5177 블록 재활용) 반영·재시작 완료(로컬). **운영 배포**는 `deploy.sh`(2026-09-05 갱신: 5번에 develop 빌드, 9번=sp-develop 단독, 2·5번 마이그레이션 뒤 앵커 시드 자동) — 첫 배포 순서: main 병합 → `./deploy.sh 5`(추가형이라 N) → 운영 nginx 는 로컬 보관본 `ops/nginx-live/sites-enabled/centrafab`(gitignore; 2026-09-05 `/develop/` alias·`= /develop` 301·`/rnd` 제거 반영)을 서버 `/etc/nginx/sites-enabled/centrafab` 에 올림 → 7 → 6(PHP) → 관리자 AI 설정에서 develop 유스케이스 켜기 → 첨부 업로드 1회 실측(파일서버 serviceType `develop`) |

남은 것: 파일서버 serviceType `develop` 운영 수용 실측 · 알림톡 템플릿 · 실 LLM 초안 육안 1회(관리자 상세에서 `초안 다시 만들기`) · 위키 재컴파일 · 발주서(PO) 첨부 라우트(계약 `poFile` 자리만 있음) · 마일스톤 `manual` 트리거의 청구 열기 플래그.

## 12. 결정 로그

- 2026-09-09 수행관리 프로토타입(`prototype/develop-workflow`): 기존 접수·견적·결제에 계약 후 일정·문서·승인 관리를 연결했다. 의뢰별 적용, 관리자 착수 확인, 수락 견적 기반 계약 문서, 승인 대상 후속 작업 제한을 사용자 확정했다. 이후 사용자 요청으로 환경변수 게이트를 제거해 기본 제공하며, `pnpm dev`와 운영 배포에서 자동 백업·마이그레이션한다. 새 테이블은 2개다. 구현·검증은 [수행관리 프로토타입](develop-workflow-prototype.md), 운영 DB의 시점 원복은 [DB 스냅샷과 원복](db-snapshot-rollback.md)이 보충 정본이다. 위의 `manual` 청구 미구현 항목은 **수행관리를 시작한 의뢰에서는 해결**되었다(수동 청구 열기 → 기존 견적서 결제).

- 2026-09-08 위저드 v2(사용자): 프로토타입 5스텝 이식 · 개별 메뉴에서 회로·펌웨어 제외(시스템개발 안에서만) · 분야별 질문은 선택지+서술 혼합 · 예산 사전 분리(`DEVELOP_BUDGET_RANGES`). 같은 날 v1.9 질문서(244문항) main 되돌림(강제 푸시, 로컬 브랜치에만 잔존). 로컬 DB 에 남아 있던 v1.9 migration 컬럼 12개는 수동 drop + `_prisma_migrations` 행 삭제로 정리했다(운영 미반영이라 무해). 상세 §7.2.1.

- 2026-09-05 기획 확정(사용자): 마켓과 분리·이름·관리자 주도 AI·항목별 견적·마일스톤·회원 전용·실무 보강 6건(연락처·조건 문서 견적서·동의 기록·추가 견적·확인 요청·잔금 후 해제) 채택. 디자인은 새로.
- 2026-09-05 구현 중 결정: `develop.dev-review` 기본 모델 kimi-k3 think medium(관리자 대기라 정밀, §12.8 프로빙 근거) · 하네스는 develop.* 유스케이스를 끄고 돈다(관리자 재생성은 force 라 부르지 않음) · 세금계산서 이벤트는 payload 만으로 등록 허용 · `DevelopOkResponse`·`paidBy` 계약 additive · 관리자 워커가 세션 강제 종료로 끊겨 i18n 230키를 재스폰 워커가 보충(키 누락 검사 스크립트 관례 확립).
