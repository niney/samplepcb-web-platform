---
topic: sp-develop-web
last_compiled: 2026-09-19
sources_count: 58
status: active
---

# sp-develop-web

## Purpose [coverage: high — 8 sources]

`sp-develop` — **개발의뢰(의뢰자 ↔ 샘플피씨비 직접 개발 용역) 고객 대면 Vue 3 SPA** (`samplepcb-web-mono-app/apps/develop`, base `/develop/`, 포트 **5177**) + 그 백엔드(`apps/api/src/routes/develop-requests.ts`·`admin-develop-*.ts`) + 관리자 「개발」 모듈(sp-vue `/app/admin/develop/*`). 소스 날짜 범위는 **2026-08-28(AI 사전 검토서 1건 체계) ~ 2026-09-11(간편 서식 간소화·운영 G 정리)**, 코드 최종 커밋 2026-09-11. 정본은 [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md)(§7.2.1 위저드 v2·§13.6 간소화가 최신 합의) — 2026-09-05 의 3스텝 위저드·2026-09-09 의 문서 8종·G/C 공존(09-09~10)은 **이전 패턴**이고, 지금은 **5스텝 위저드·문서 5종·C 단독 정본**이다. 공개 도메인은 **centrafab.co.kr**(samplepcb.co.kr 은 다른 호스팅).

**왜 만들었나**: 재능마켓([sp-market-web](sp-market-web.md))은 전문가 매칭 구조라, 성숙 전에 상담·견적·진행·납품 노하우를 **당사가 직접 수행하는 과도적 사이트**에서 먼저 쌓는다. 레거시 `shop/estimate.php?category=circuit` "개발의뢰"(→`sp_estimate`→관리자 항목 견적→ca_id 20 카트)의 현대판이며, DB 이관에서 빠져 플랫폼에 대응물이 없던 트랙이다. 마켓과의 결정적 차이 셋: **전문가·입찰·공개 목록이 없다**(전부 소유자·관리자만) · **AI 는 고객이 아니라 관리자가 돌린다**(초안→편집→공개) · **견적은 당사가 항목별로 낸다**(마일스톤 결제). "고객 대면 신규 화면 = sp-php" 원칙의 두 번째 예외(첫째는 마켓)로, 루트 [AGENTS.md](../../AGENTS.md) 호칭 표에 `sp-develop` 이 추가됐고 `/develop` 은 그누보드 예약 경로다.

흐름(정본 §4): `received → reviewing → quoted → accepted → in_progress → delivered → completed` (+`cancelled`·`declined`). 접수 즉시 서버가 **AI 사전 검토서·시스템 구성도 초안을 백그라운드로** 만들고(관리자 전용), 관리자가 편집·공개 → 항목별 견적서 발송 → 고객 수락(조건 동의 = 계약) → 마일스톤별 영카트 결제(lazy paid 승격) → 착수 뒤 **프로젝트 문서 5종·업무표**(§13) → 납품·검수(7일 자동확정) → 잔금 후 최종 산출물 잠금 해제.

## Architecture [coverage: high — 12 sources]

- **스택**: Vite 8 + Vue 3.5 + TS 6 + Vue Router + Pinia + @tanstack/vue-query + Tailwind v4 + vue-i18n(`ko` 실서비스·`en` 스텁). workspace 의존 `@sp/api-contract`·`@sp/shared`·`@sp/utils`·**`@sp/ui`**·`@sp/config`. 타입 강성 "매우 강함" 동일([mono AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md)).
- **부트스트랩([main.ts](../../samplepcb-web-mono-app/apps/develop/src/main.ts))**: pinia → i18n → vue-query → **마운트 전 `useAuthStore().bootstrap()`** → 그 뒤 `app.use(router)` — 마켓 main.ts 관례(딥링크가 비로그인으로 첫 렌더되지 않게).
- **라우트([router.ts](../../samplepcb-web-mono-app/apps/develop/src/router.ts))**: `createWebHistory('/develop/')`, 단일 `DevelopLayout` 하위 7종 — `Home`(`/`) · `RequestWizard`(`/request`) · `Me`(`/me`) · `RequestDetail`(`/requests/:id`) · `RequestEdit`(`/requests/:id/edit`) · `QuotePrint`(`/requests/:id/quotes/:qid/print`, `meta.bare` = 헤더·푸터 없음) · `DocumentPrint`(`/requests/:id/documents/:docId/print`, bare). **`/c/*` → `/*` redirect** 는 2026-09-10 G/C 공존 종료 뒤 로컬 북마크용 잔재. 라우트 가드 없음 — 로그인 필요 화면이 `/bbs/login.php?url=…` 로 왕복(`lib/auth-urls.ts`).
- **dev 서버([vite.config.ts](../../samplepcb-web-mono-app/apps/develop/vite.config.ts))**: `port: SP_DEVELOP_PORT ?? 5177` + `strictPort`(nginx 고정 프록시) · `host: '127.0.0.1'`(Windows IPv6 502 회피) · `allowedHosts: ['local-web.samplepcb.co.kr']` · proxy `/api`→3333·`/spcb`→8888. 루트 `pnpm dev` 가 web(5173)+market(5176)+develop(5177)+api 동시 기동.
- **src 구조**:
  - `pages/` — Home(랜딩: 히어로→개발 메뉴 5 `#areas`→진행 방식 7단계 `#how`(레거시 계승)→왜 직접 개발→FAQ→CTA; 메뉴는 위저드 1스텝과 같은 계약 상수) · RequestWizard · Me · RequestDetail(647줄) · RequestEdit · QuotePrint · DocumentPrint.
  - `components/request/` — **위저드 v2 5스텝** `StepMenu`·`StepDescribe`·`StepQuestions`·`StepProduction`·`StepReview` + `ContactFields`·`WizardAside`.
  - `components/detail/` — ProgressStepper·RequestContent·QuoteCard·Timeline(`event-actions` 슬롯)·AttachmentList·CommentComposer·DecisionPanel·ProjectProgress·Document{List,View,Content,Decision}.
  - `composables/useRequestForm.ts`(861줄, 폼 상태 단일 소유 — 위저드와 수정 화면이 공유)·`useFollowupJob.ts` · `api/useDevelopRequests.ts`(쿼리 키 `['develop', …]` 한 뿌리, 훅 6종+)·`useDevelopAi.ts` · `lib/{auth-urls,download,error-msg,format}.ts` · `i18n/locales/{ko,en}.ts` · `style.css`.
- **위저드 v2(2026-09-08, [RequestWizard.vue](../../samplepcb-web-mono-app/apps/develop/src/pages/RequestWizard.vue))**: ① 개발 메뉴(`requestMode` — **시스템개발** 배타 / **개별 견적** PCB·기구·앱·서버 복수; 회로·펌웨어는 시스템개발 안에서만) ② 의뢰 내용(제목·설명·현재/목표 단계·희망 완료 시기·예산·참고 자료 드롭존·AI 동의) ③ 세부 질문(시스템개발 = **AI 후속 질문 `develop.followup`** 또는 "전문가에게 맡김" / 개별 = 분야별 선택지+서술 혼합) ④ 제작 계획(시제품 수량·제작 범위·연간 수량·조달·납품 형태) ⑤ 검토·접수(연락처 4칸 자동 채움 + 요약 + 동의). **고객이 기다리는 잡은 후속 질문 하나뿐** — 검토서·구성도는 등록 뒤 서버가 관리자용으로 만든다. 확인 대화는 전부 인라인 패널(네이티브 confirm 금지).
- **디자인 토큰([style.css](../../samplepcb-web-mono-app/apps/develop/src/style.css))**: 마켓과 무관하게 새로("엔지니어링 스튜디오" — 밝은 종이·짙은 잉크·일렉트릭 블루 `brand-500 #1b6ef3`). `@sp/ui` 는 **시맨틱 토큰만**(`brand-*`·`ink-*`·`paper`·`line`·`tx-*`·`text-micro…h1`·`--color-area-*`) 쓰고 값은 각 앱이 정한다(마켓은 `brand-*`=카퍼 별칭). `@source "../../../packages/ui/src"` 필수(Tailwind v4 는 심링크 미스캔).
- **공용 `@sp/ui`([index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts), 2026-09-05 마켓에서 추출)**: `DevReviewView`·`DevDiagramSection`·`AreaIcon`·`FileDropZone`·`FilePreviewModal`·`QuestionField`·`UiPagination` + `lib/file-preview`·`error-msg`. i18n 미사용·API 경로 비하드코딩(`filesPath` prop). 마켓·개발의뢰·관리자 셋이 소비 — 관리자가 고객과 같은 렌더러로 검토서를 미리 보기 위한 결정(복사하면 3앱이 갈린다).
- **백엔드 모듈(sp-node)**:
  - 라우트 5본 — `develop-requests.ts`(1,283줄, 회원 16종) · `admin-develop-requests.ts`(워크큐·상세·전이·AI 재생성·검토서 3층·버전 원장·구성도·이벤트·파일) · `admin-develop-quotes.ts`(견적·마일스톤) · `admin-develop-docs.ts`(문서·업무표·AI 메일) · `admin-develop-settings.ts`(싱글턴).
  - lib 8본 — `develop.ts`(전이·이벤트·상태 파서) · `develop-payment.ts`(lazy 승격 3종) · `develop-ai.ts`·`develop-ai-source.ts`(자동 초안 진입점·코퍼스) · `develop-docs.ts` · `develop-email.ts`(메일 10종) · `develop-review-versions.ts` · `develop-settings.ts`.
  - AI — `ai/develop-followup.ts`·`develop-doc-mail.ts`·`doc-mail-runner.ts`(프롬프트 코드 정본) + 러너 **타깃 어댑터** `runner.ts DevReviewTarget {market|develop}`·`dev-diagram-runner.ts DiagramTargetRef`.
  - 스크립트 — `seed-develop-anchor-item.ts`(앵커 상품 멱등 시드)·`backfill-develop-review-versions.ts`(버전 원장 백필, idempotent)·`develop-g-rollback.ts`(운영 G 테이블 정리).
- **계약([develop.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop.ts) 1,135줄)**: `DEVELOP_*_LABELS` 라벨 정본(sp-develop·sp-vue·sp-node 메일 공유) + [develop-areas.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-areas.ts)(`DEVELOP_REGISTRY` — `createAreaRegistry` 팩토리([area-registry.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/area-registry.ts)) 위에 마켓 5분야 정의 재사용 + **기구설계 `mech` 신설**, 시스템개발 3문항·협업 범위 2문항) + `develop-docs.ts`(문서 5종 필드 스펙·업무표·진행 요약 순수 함수) + `develop-followup.ts`(leaf). 검토서·구성도 JSON 은 마켓 스키마 `MarketDevReview`·`MarketDevDiagram` 그대로(+additive `schedule`·`adminComment`·`resolution`).
- **관리자 「개발」 모듈(sp-vue, 2026-09-09)**:
  - 상단 스위처 `통합 | PCB | BOM | 개발`([menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/menu.ts) `AdminModuleKey 'develop'`, 판정 = 라우트 이름 접두 `admin-develop`).
  - [develop-menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/develop-menu.ts) 8메뉴 = 진행현황(홈) · 접수·검토 · 견적·계약 · 진행 프로젝트 · 납품·검수 · 문의·A/S · 전체 의뢰 · 설정. 배지는 "지금 관리자 차례" 하나씩(`developReceived`·`developAccepted`·`developDocsAwaiting`·`developDelivered`·`developInquiries`·`developReplyOverdue`, 훅 `useDevelopModuleSignals` 60초).
  - 상세 `AdminDevelopRequestDetail.vue` = **단일 컬럼 1120px + 탭 6**(의뢰 내용·AI 검토서·구성도·견적서·타임라인·프로젝트 문서, `?tab=` URL, `v-show` 전부 마운트라 편집 초안이 탭 이동에 안 날아감) + "의뢰 내용 옆 보기" 420px 패널(localStorage). 조각 `components/admin/develop/` 26본 + 순수 모듈 6(`develop-{badge,doc-edit,files,queue,quote-edit,review-edit}.ts`) + `admin/useAdminDevelop.ts`·`develop-navigation.ts`(큐 URL 보존·「← 목록으로」).

## Talks To [coverage: high — 10 sources]

- **sp-node**([sp-node-api](sp-node-api.md)) — 유일한 데이터 소스. 회원 `/api/develop/*`(소유자만) · 관리자 `/api/admin/develop/*`(`requireAdmin`) · `GET /api/me/contact`(연락처 자동 채움, 2026-09-10) · AI `GET /api/ai/develop.followup/status`(공개)·`POST …/run`(multipart)·`GET /api/ai/jobs/:id`(3초 폴링 — 마켓 5초보다 촘촘, 고객이 기다리므로). 에러 봉투 `{result:false,error:'CODE'}`(회원)·`ApiError`(관리자), 코드→메시지는 [error-msg.ts](../../samplepcb-web-mono-app/apps/develop/src/lib/error-msg.ts) 23종 단일 맵(`@sp/ui apiErrorMessage` 위임).
- **sp-php 인증 브리지**([spcb-bridge](spcb-bridge.md)) — `@sp/shared` `bootstrap()` 이 `GET /spcb/api/me` 로 세션→JWT. **회원 전용**(결정 15) — 비회원 의뢰 없음. checkout 직전 `bootstrap()` 재발급으로 JWT `cartId` 스테일 방지, 그래도 `NO_CART_ID` 면 1회 재시도 뒤 `/shop/orderform.php` 로 `window.location.assign`.
- **영카트 결제** — 마켓 ⑲ 동형: 앵커 상품 **`sp-develop-svc`**(`g5_shop_item`, it_price 0 · it_sc_type 1 · ca_id '10', 시드 `develop:seed-anchor` 멱등) + `insertQuoteOption(itId, paymentKey, amount)`+`insertCartRow`(상품명 `개발의뢰 · {제목} · {마일스톤명}`). PHP 쪽은 [sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) `sp_develop_it_ids()` 가 quote·market·bom 사전과 union(주문서·주문메일 자동 포함) + 테마 `cart.php` 배지. paid 승격은 [develop-payment.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-payment.ts) `ensureDevelopLazy` — `PAID_ORDER_STATUSES ∧ io_id==paymentKey ∧ io_price==amount`(단방향 래칫, cron 없음) → 첫 paid 가 `accepted→in_progress`.
- **AI(Ollama, sp-node 유스케이스 계층)** — [usecases.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/usecases.ts) 별도 행 4종: `develop.dev-review`(기본 kimi-k3 think medium — 관리자 대기라 정밀), `develop.dev-diagram`(kimi-k3 high), `develop.followup`(kimi-k3 low·300s), `develop.doc-mail`. 잡 저장소는 `sp_ai_job`(DB, 08-28 인메모리 폐기). 프롬프트·후처리 R1~R9 는 마켓 [AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) 정본을 **러너 타깃 어댑터**로 공유 — `features.schedule` 은 `target.kind==='develop'` 일 때만 켜져 마켓 프롬프트는 바이트 동일. 관리자 모델·think·추가 지침은 `/app/admin/settings` AI 탭의 develop 카드(⑥ 후속 질문·⑦ 문서 메일 포함).
- **sp-vue**([sp-vue-web](sp-vue-web.md)) — 관리 화면 전부. sp-develop 은 소비자 표면만(관리자 가드 없음).
- **파일서버** — `sp_file` 폴리모픽(`refType` = `sp_develop_request`(attachment `area/slot`·`diagram`) · `sp_develop_quote`(`po`) · `sp_develop_event`(`deliverable`·`review`·`comment`) · `sp_develop_document`). serviceType 은 env `DEVELOP_FILE_SERVICE_TYPE`(기본 `develop`, 운영 수용 실측은 첫 배포 체크리스트). 미리보기는 고객·관리자 라우트가 같은 `buildFilePreview`.
- **메일** — [develop-email.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-email.ts) 비차단·`sp_mail_log` 기록: 고객 7종(접수·견적·결제·납품·검수 확정·불가/취소·문의 답변) + 관리자 5종(`settings.notifyEmails`). 문서 발송 메일은 결정적 초안 `buildDevelopDocMailDraft` → `develop.doc-mail` 다듬기 → 관리자 확인본 저장. 로컬은 Mailpit(하네스가 8025 조회).
- **nginx**([infrastructure](infrastructure.md)) — [local-web.conf](../../ops/nginx/local-web.conf) `upstream vite_develop 5177` + `location /develop/`(WS Upgrade, 2026-09-05 신설 — 폐지된 `/rnd` 5177 블록 재활용). 운영은 static alias+SPA fallback(주석 예비) — 실제 운영 nginx 는 gitignore 보관본 `ops/nginx-live/sites-enabled/centrafab`(`/develop/` alias·`= /develop` 301). 배포는 루트 [deploy.sh](../../deploy.sh) 케이스 **5**(풀: api+web+market+develop+DB, 마이그레이션 뒤 앵커 시드 자동)·**9**(sp-develop 정적만).
- **sp-market 와의 관계(문서 확인)** — **테이블 분리**(`sp_market_project` channel 컬럼 기각: 공개 목록 쿼리에서 필터 하나 빠지면 비공개 의뢰가 샌다), 위저드는 **재사용하지 않고 별도 구현**(마켓 3스텝 vs 개발의뢰 5스텝, 컴포넌트 별개), 공유하는 것은 `@sp/ui` 렌더러·검토서/구성도 JSON 스키마·분야 레지스트리 정의(`MARKET_AREA_MAP` 5분야)·AI 러너·영카트 카트 주입·lazy 승격 관례. `e2e-market` 회귀가 러너 일반화의 가드(148/0).

## API Surface [coverage: high — 6 sources]

브라우저 라우트(`/develop` 하위, 전부 소유자만 — 공개 목록 없음):

| 라우트 | 화면 |
|---|---|
| `/` | 랜딩 — 히어로·개발 메뉴 5(`#areas`)·진행 방식 7단계(`#how`)·FAQ·CTA |
| `/request` | 위저드 v2 5스텝(임시저장 `sp-develop-request-draft:{mbId}`) |
| `/me` | 내 의뢰(상태 배지·"지금 할 일" 칩 → 상세 앵커 `#quotes`·`#timeline`·`#documents`) |
| `/requests/:id` | 상세 — 스텝퍼·의뢰 내용·AI 검토서(공개본, `v{n} 공개본`)·구성도·견적 수락/거절/결제·진행 현황·문서(현재 판·결정 패널)·타임라인·산출물(잠금) |
| `/requests/:id/edit` | 수정(`received\|reviewing` 만, 스텝 없이 한 화면·첨부는 즉시 반영·PATCH 는 바뀐 필드만) |
| `…/quotes/:qid/print` · `…/documents/:docId/print` | 인쇄용(bare, 견적은 `?mode=contract` = 계약서 보기) |

서버 표면(계약 상수 [routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts) `developRequests`·`developMyRequests`·`adminDevelop{Requests,Quotes,Milestones,Documents,Files,Settings}`):

| 그룹 | 라우트 | 비고 |
|---|---|---|
| 회원 `/api/develop` ([develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/develop-requests.ts)) | `POST /requests`(multipart) · `GET /my/requests` · `GET\|PATCH /requests/:id` · `POST\|DELETE …/files(/:fileId)` · `GET …/files/:fileId(/preview)` · `POST …/cancel` · `POST …/quotes/:qid/accept\|decline` · `POST …/comments` · `POST …/milestones/:mid/checkout` · `POST …/deliveries/:eventId/:decision` · `POST …/review-requests/:eventId/:decision` · `POST …/documents/:docId/decide` | 16종. 게이트 `ANSWERS_REQUIRED`·`FOLLOWUP_JOB_INVALID`, 수정 409 `NOT_EDITABLE`, 잠금 403 `LOCKED_UNTIL_PAID`, 문서 409 `NOT_APPROVAL_DOC`·`DOC_NOT_OPEN` |
| 관리자 의뢰 ([admin-develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-requests.ts)) | `GET /requests` · `GET\|PATCH /requests/:id` · `POST …/status` · `POST …/ai/review\|diagram` · `PUT …/review` · `POST …/review/publish\|unpublish\|reset` · `GET …/review/versions(/:seq)` · `POST …/review/versions/:seq/restore` · `POST …/diagram/publish\|unpublish\|upload` · `POST …/events`(multipart) · `GET /files/:fileId(/preview)` | 목록은 탭 `DEVELOP_ADMIN_TABS` + 합산 `intake`·`contract` + `signal`(`docs_awaiting`·`inquiries_open`·`reply_overdue`) + `counts`·`signals`·행별 `ops` |
| 관리자 견적 ([admin-develop-quotes.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-quotes.ts)) | `POST /requests/:id/quotes` · `PATCH\|DELETE /quotes/:qid` · `POST /quotes/:qid/send\|withdraw` · `POST /milestones/:mid/mark-paid\|open` | draft 만 수정, 발송 시 금액 확정, 종류 409 `KIND_MISMATCH`, `open` = 수동 청구 열기(G 이식) |
| 관리자 문서 ([admin-develop-docs.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-docs.ts)) | `POST /requests/:id/documents` · `PATCH\|DELETE /documents/:docId` · `POST …/revise\|send\|ai-mail` · `POST\|DELETE …/files(/:fileId)` · `PUT /requests/:id/tasks` | 문서는 `accepted` 이후, 납품확인서는 delivered·completed 만; 업무표 409 `REVISION_CONFLICT`·`TASK_HAS_PROGRESS` |
| 관리자 설정 ([admin-develop-settings.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-settings.ts)) | `GET\|PATCH /settings` | 싱글턴 id=1 |
| AI | `GET /api/ai/develop.followup/status` · `POST /api/ai/develop.followup/run` · `GET /api/ai/jobs/:jobId` | `stage` attachments→followup, 같은 입력 1시간 재사용 |

## Data [coverage: high — 6 sources]

DB 직접 접근 없음 — 전부 sp-node 경유. Prisma `sp_develop_*` **9테이블**([schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) L1938~2200):

| 테이블 | 역할 | 핵심 |
|---|---|---|
| `sp_develop_request` | 의뢰 | `requestMode`·`serviceAreas`(시스템개발이면 6분야 전부 `resolveDevelopServiceAreas`)·`answers`·`aiQuestions`·연락처 5칸·`budgetRange`(**전용 사전 `DEVELOP_BUDGET_RANGES`**)·`currentStage/targetStage/wishDate/wishNote/expertDelegate/production`·`aiConsent`·`ndaWanted`·`status`·`assigneeMbId`·`internalMemo`·`aiSupplement` · **검토서 3층** `devReviewDraft/devReview/devReviewPublic`(+`devReviewInputHash` stale 판정) · 구성도 `devDiagram/devDiagramHtml/devDiagramPublicHtml/devDiagramSource(ai\|upload)` · 일정 3컬럼 `baseStartOn/plannedEndOn/expectedEndOn` · `reviewDays` |
| `sp_develop_review_version` | 검토서 버전 원장 | `seq`(의뢰별 1부터)·`kind ai_draft\|working\|published`·`contentHash`·`parentSeq`·`author`·`jobId`·`note` |
| `sp_develop_event` | 타임라인·문의 한 스트림 | append-only, `type`(§4.3 16종)·`byAdmin`·`visibleToCustomer`·`payload`(from/to·final·locked·세금계산서) |
| `sp_develop_quote` · `sp_develop_quote_item` | 견적서(버전)·항목 | `requestId+version` unique, `kind initial\|revision\|change`, `vatMode`, 금액은 **발송 시 확정**, `terms` 는 설정 복사본, `validUntil` KST, 수락 기록 `acceptedName/Ip` |
| `sp_develop_milestone` | 결제 단위 | `paymentKey` uuid = g5 `io_id`, `trigger on_accept\|on_delivery\|on_completion\|manual`, `status draft\|pending\|paid\|cancelled`, `paidBy lazy\|admin`, `unlocksDeliverables` |
| `sp_develop_settings` | 싱글턴 id=1 | 표준 조건·실비·하자 180·검수 7·유효 30·기본 마일스톤·`notifyEmails`·`aiAutoDraft`·`aiDiagramAutoDraft`(GET 은 기본값, PATCH upsert) |
| `sp_develop_document` | 문서 5종 | `type+seq+version` unique, `status draft→sent→결정\|superseded`, 결정 = 동의 기록(`decidedName/Ip/At`), `mailSubject/Body` 확인본 |
| `sp_develop_task` | 업무표 | 6단계 `phase`·상태 7(제외 포함)·`weightBp`·`progressPct`·`visibleToCustomer` |

- 마이그레이션 6본(수기 additive, `migrate deploy` 전용): `20260905150000_develop_request` · `…190000_develop_review_version` · `20260908120000_develop_wizard_v2` · `…150000_develop_ai_questions` · `20260909120000_develop_workflow_docs` · `20260911170000_develop_docs_simplify`(옛 8종→5종 재번호). G 프로토타입 마이그레이션 2본은 리포에서 제거·운영 DROP 완료(2026-09-11).
- **판정은 서버**: `payable`(`milestonePayable` — `manual` 은 `milestone_opened` 로 연 것만)·`nextAction`(`answer_document` 는 결제·검수보다 뒤)·미답변 문의·회신 기한 초과·달성도(`developProgressSummary` — 가중치 없으면 **기간 가중**)는 전부 서버 파생, 화면은 재계산하지 않는다. 미응답 `review_request` 판정은 `Timeline` 부모가 후속 이벤트의 `payload.eventId` 로 한다.
- **스냅샷 박제**: 견적 발송 시 `supply/vat/total`+마일스톤 금액 확정(설정이 바뀌어도 불변) · 공개본 = 작업본 스냅샷 · `kickoff` 문서의 계약 부분 = 수락 견적 스냅샷(읽기 전용, PATCH 가 원값 복원) · 문서 발송 = 판 고정+메일 확인본 저장, 재발송은 새 판(`revise`, **첨부는 복사하지 않음**) · `aiQuestions` 는 서버가 잡에서 되읽어 답만 합쳐 박제.
- AI 잡은 `sp_ai_job` 재사용(useCase `develop.*`, mbId=의뢰인). 코퍼스([develop-ai-source.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-ai-source.ts)) = 제목·설명·답변·참고 자료(`area null`)·이미지 판독 + **`aiSupplement` 관리자 보충 메모**(전화 상담 내용이 R1/R2 후처리에 지워지지 않게 근거로 합류) + `developConditionLines`·`developWishCode`(≤4주 within_1m·≤13 m2_3·≤26 m4_6·그 밖 over_6m).
- 클라이언트 상태: Pinia auth(`@sp/shared`) + vue-query. localStorage 는 **임시저장**(`sp-develop-request-draft:{encodeURIComponent(mbId)}`, `v:3, mbId` 소유자 기록 — 구 공용 키 v2 는 이관·삭제 없음, 파일 미저장)과 관리자 "옆 보기" 켬/끔뿐.

## Key Decisions [coverage: high — 9 sources]

1. **2026-09-11 — 간편 서식 6장 기준 간소화**(사용자 결정 3: 01 승인형 · 업무 행 요약만 공개 유지 · 변경 승인→change 견적 자동): 문서 **8종→5종**(`kickoff` KO·`stage_review` REV(검토 단계 8종, 제작 단계만 승인 범위 체크리스트 `when`)·`change_request` CR·`delivery_confirm` DC·`progress_report` PR), 업무 단계 7→**6**, 달성도 **기간 가중**(1일 착수회의 = 18일 펌웨어 무게 오류 교정), 수행계획 문서 폐지→의뢰 일정 3컬럼+`schedule_changed` 이벤트. 하네스 191/0.
2. **2026-09-11 — 운영 G 정리·main 재작성**: [prod-develop-cleanup.sh](../../ops/scripts/prod-develop-cleanup.sh)(git ff→G 테이블 3 DROP(스냅샷 먼저)→`deploy.sh 5`→검증) 실행, 비교 커밋 6개를 `17a966dbe` 하나로 접고 세부는 태그 `proto-gc-coexist-20260910`·`proto-c-original-20260910` 이 보관. 원격 프로토타입 브랜치 3개 삭제.
3. **2026-09-10 — 프로토타입 G(수행관리 JSON 한 통) 제거·C(문서·업무표·워크큐) 정본 승격**([develop-prototypes](../../docs/develop-prototypes.md)): 경로 `/develop/c`·`/app/admin/develop-c`·`/api/develop-c` → 원복, 모듈 라벨 「개발」, 설정 id=2→**id=1 단일 행**. G 에서 이식한 규칙 7(수동 청구 열기 `milestone_opened`·납품확인서 자동 동기화 `closeDeliveryConfirmDocs`·업무표 upsert/낙관적 잠금/제외·큐 URL 보존·이탈 가드·수납 시야·지연 작업 수).
4. **2026-09-10 — 연락처 자동 채움·초안 회원별 분리**: `GET /api/me/contact`(`mb_name`·`mb_hp`→`mb_tel`·`sp_member_profile.companyName`→`mb_2`, `no-store`), 고객이 입력한 칸은 늦은 응답으로 덮지 않음, 회원정보 갱신 없음.
5. **2026-09-09 — 관리자 「개발」 독립 모듈**(§14): PCB·BOM 과 같은 급의 스위처 모듈, 메뉴 = **단계별 워크큐**(서식은 건 안의 도구), 배지 = "내 차례" 하나씩, 문서·이벤트 파생 신호는 DB 로 못 잘라 탭 전 행을 메모리에서 페이지.
6. **2026-09-08 밤 — AI 후속 질문 `develop.followup`**(§7.2.2): "위저드에서 AI 제거" 결정 3의 **유일한 예외** — 검토서가 아니라 질문 고르기 한 번, 상한 8·서버 정규화·`unknown` 부착, 꺼짐/실패/300초 초과면 고정 서술 3문항으로 **조용히 폴백**. 같은 입력 키면 잡 재사용(스텝 왕복에 재호출 없음).
7. **2026-09-08 — 위저드 v2 5스텝(프로토타입 `samplepcb-development-request` 이식)**:
   - `requestMode` system/individual, 개별 메뉴에서 **회로·펌웨어 제외**, 분야 레지스트리 팩토리 분리(`DEVELOP_REGISTRY`, `mech` 신설, `kind:'text'` 서술 문항), 예산 사전 **마켓과 분리**, 마켓 공통 조건(`timeline`·`target_stage`·`deliverable_scope`) 미사용. v1.9 질문서(244문항) 같은 날 되돌림.
   - 저녁·밤 2판: 협업 범위 문항(→`system.product_design`·`mech_design` 2개로 정리, `askOnDelegate`)·tier 접기 폐기·툴 UI 제거(PCB 만 `pcb.tool`)·슬롯 UI 제거·AI 동의 5스텝 통합. 일부러 안 가져온 것: 정규식 "입력 분석 완료" 가짜 배지·auto 후속 질문·랜덤 접수번호.
8. **2026-09-08 — thinking `max` 단계**([AI_DEV_REVIEW](../../docs/AI_DEV_REVIEW.md) §13.13): `AI_THINK_LEVELS` 에 max, `think==='max'` 면 유스케이스 타임아웃 ×2 — 개발의뢰 검토서·후속 질문 러너가 이 값을 쓴다(기본값 무변경).
9. **2026-09-05 저녁 — 검토서 버전 원장·개발 일정(예상)·관리자 상세 재배치**: `sp_develop_review_version` 기록 3순간(AI 초안·저장/reset·공개, unpublish 는 미기록), 직전 판과 `kind`+`contentHash` 같으면 미기록, `diffDevReview` **구조 비교**·복원(`parentSeq`). 일정 블록은 **develop 전용**(`features.schedule`), 수치는 범위(`minWeeks/maxWeeks`)·합계는 매번 재계산, **"검토서 일정은 예상, 견적 기간은 약속"** — 견적으로 가져오기는 관리자가 누를 때만. 상세는 사이드 폐기→단일 컬럼 1120px→탭 6.
10. **2026-09-05 — 기획 확정·P0~P3 구현(브랜치 `feat/develop-mvp`, 결정 19건 §2)**:
    - 별도 앱 + **`@sp/ui` 추출(복사 아님)** · 테이블 분리 · 위저드 AI 전부 제거→**서버 백그라운드 초안**(고객 대기 0, 정밀 모델 허용) · 검토서 **초안·작업본·공개본 3층** · 구성도는 편집 대상 아님(재생성·교체 업로드·비공개) · 회원 전용 · 연락처 블록 · 디자인은 새로(시맨틱 토큰).
    - 견적서 = **조건 문서**(항목표+마일스톤+기간+산출물+실비+표준 조건+검수·유효기간, 붙여넣기 파싱 `parseDevelopQuoteLines`) · 마일스톤별 영카트 주문(기본 1건 전액) · 수락 = 조건 동의 기록(NDA 서명 패턴) · 착수 뒤 변경은 `kind=change` · 최종 산출물 잔금 후 공개.
    - 진행 방식: 계약·서버 직접 → 화면은 워커 2본 병렬(고객 앱 ∥ 관리자, [phase1a](../../docs/prompts/develop-phase1a-app.md)·[1b](../../docs/prompts/develop-phase1b-admin.md)·[2a](../../docs/prompts/develop-phase2a-app.md)·[2b](../../docs/prompts/develop-phase2b-admin.md)) + 전수 감사. [P3 일정](../../docs/prompts/develop-phase3-schedule.md)·[버전 원장](../../docs/prompts/develop-phase3-review-versions.md)은 워커 중단으로 Fable 직접.
11. **2026-09-04 — 마켓 AI 사전 검토서 v3→v5**(개발의뢰가 재사용하는 기반): 분야 레지스트리 5종(`market-areas.ts`)·3스텝·**정밀 시스템 구성도 비동기**(kimi-k3 high, 게이트 첨부 ≥800자/설명 ≥500자, 프로세스 내 큐 동시 1·재시작 복구)·검토서 안 3열 카드 구성도 폐지(v4)·공통 조건 6 필수 `ANSWERS_REQUIRED`·분야 맞춤 질문 14(v5)·AI 분석 대상 = 1스텝 참고 자료뿐.
12. **2026-09-02~03 — v2 간소화·절충**: 2스텝·4문항·**확정만**(상태 축 폐지, 근거 없으면 삭제)·작업 항목/개발 단계 섹션 제거(정보량 0)·R8 자료 간 불일치·R9 답변↔자료 정합·검토 관찰(권고 어휘 삭제)·PCB 담당자 "공학 구성도" 프롬프트는 실측 뒤 **고객용 미채택**(인터페이스·전압·전원 체인이 TBD 또는 환각).
13. **2026-08-28 — AI 산출물을 "AI 사전 검토서" 1건으로 전면 재구성**([AI_DIAGRAM](../../docs/AI_DIAGRAM.md) 대체): 가격 산정 없음·판정어 없음·프롬프트 코드 정본(관리자는 토글·모델·추가 지침만)·`sp_ai_job` DB 저장소(인메모리 폐기)·주모델 `deepseek-v4-pro:0813 think=off`·비전 `qwen3.5:397b`·sp-rnd 삭제. Phase 3 백엔드([dev-review-phase3-backend](../../docs/prompts/dev-review-phase3-backend.md))·Phase 4 화면 2워커([4a](../../docs/prompts/dev-review-phase4a-market.md)·[4b](../../docs/prompts/dev-review-phase4b-admin.md)) 위임.
14. **(미결, 2026-09-06)** 인접 트랙 [CONTACT_INQUIRY](../../docs/CONTACT_INQUIRY.md): 일반 문의 폼(Contact Us) 접수 경로 A 게시판/B PHP/**C sp-node(추천 — `sp_contact_inquiry`·`POST /api/contact`·`/app/admin/inquiries`)** 사용자 결정 대기. 개발의뢰와 별개 흐름(주문·의뢰에 묶이지 않는 마케팅 필드·동의 기록).

## Gotchas [coverage: high — 9 sources]

- **`developPath` 가 아직 `/c` 접두를 붙인다**([auth-urls.ts](../../samplepcb-web-mono-app/apps/develop/src/lib/auth-urls.ts)): 로그인·로그아웃 되돌아올 경로가 `/develop/c/...` 로 만들어지고 router 의 `/c/*` redirect 에 기대어 동작한다 — G/C 공존 잔재. redirect 를 지우면 로그인 왕복이 깨진다.
- **5177 = 옛 sp-rnd 포트** — nginx 블록·deploy 케이스 9 를 재활용했고 [DEPLOY_CENTRAFAB](../../docs/DEPLOY_CENTRAFAB.md) 는 아직 `rnd` 를 적고 develop 을 모른다(2026-09-16 갱신에도 미반영). 배포 절차의 진실은 [deploy.sh](../../deploy.sh) 헤더(케이스 5/9, 앵커 시드 자동, 첫 배포 체크리스트: nginx-live 보관본 복사 · AI 설정에서 `develop.*` 켜기(기동 시 행만 생성·**기본 꺼짐**) · 파일서버 serviceType `develop` 실측).
- **하네스는 실 LLM 0** — 시작 시 `develop.*` 유스케이스 4종을 `enabled=0` 으로 내리고 끝에 원복; 관리자 재생성은 force 라 부르지 않는다. 실 LLM 경로는 프로빙·관리자 샘플 테스트로만. 실행은 `apps/api` 에서 `pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts run|cleanup`(공유 DB — 스스로 만들고 지움, `CART_BUCKET 7777000002` 마켓과 분리, od_id 는 2^53 미만 대역). 브라우저 스모크는 `PORTAL_E2E=1 pnpm -F e2e e2e develop-wizard|develop-contact`.
- **main.ts 설치 순서**·**strictPort**·**Windows `host: '127.0.0.1'`**·**`allowedHosts`** 함정은 마켓과 동일([sp-market-web](sp-market-web.md) Gotchas).
- **위저드의 유일한 대기 = 후속 질문** — 클라이언트 타임아웃 300초(서버가 더 길어도), 폴백은 안내 한 줄뿐이라 "AI 질문이 안 나온다"는 유스케이스 꺼짐(`status` false)·실패·시간 초과 중 하나. 폴백이면 `aiQuestions=null` 로 등록된다.
- **서버는 슬롯 첨부 파트(`attachment:<area>:<slot>`)를 여전히 받는다** — 09-08 밤 화면에서 슬롯 UI 를 뺐을 뿐. AI 코퍼스는 `area null` 참고 자료만(마켓 §13.10 규칙 동일).
- **날짜는 전부 KST** — `dateShort`·`dateTimeKst`(UTC 문자열을 자르면 저녁 접수가 하루 어긋남), `validUntil`·`wishDate`·일정 3컬럼은 `YYYY-MM-DD` 문자열, 견적 만료는 lazy(`validUntil < 오늘`).
- **`structuredClone` 은 reactive proxy 에서 던진다** → 관리자 편집기는 `cloneDevelopReview` 로 필드별 복사. 행 상한 `DEVELOP_REVIEW_LIMITS` 는 계약 zod `.max()` 와 같은 값을 UI 가 복제.
- **견적 종류는 상태에서 파생**(`defaultDevelopQuoteKind`: 착수 전 initial/revision · 착수 뒤 change) — 서버 409 `KIND_MISMATCH` 와 같은 규칙. 발송은 "저장→send" 두 걸음을 한 버튼+인라인 확인.
- **`publishedStale` 는 아직 시각 비교**(`editedAt > publishedAt`) — 내용이 같아도 켜질 수 있다. 원장 `contentHash` 로 바꾸는 것은 후속.
- **문서 새 판은 첨부를 복사하지 않는다**(파일 행 복제 → 한쪽 삭제가 실파일을 지움). 첨부는 draft 에서만, 고객 다운로드는 보낸 판만.
- **잠금 산출물**은 `unlocksDeliverables` 마일스톤 paid 전엔 파일명만 보이고 다운로드 403 `LOCKED_UNTIL_PAID`. 1건 전액 견적이면 잠금 없음.
- **관리자 홈은 `tab=all&pageSize=100` 뒤 클라이언트 필터** — 활성 의뢰 100건을 넘으면 서버 탭 `active` 로 바꿀 것(워커 보고). 신호 큐는 탭 전 행 메모리 페이징.
- **정본 문서 드리프트**: [DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §7.3 의 `GET /api/admin/develop/workspace` 문단은 코드에 없다(G 잔재로 보임 — 실제 목록 API 는 `GET /api/admin/develop/requests`). §13.5·§14 가 인용하는 `docs/prompts/develop-workflow-{a-app,b-admin,c-module}.md` 는 리포에 없다.
- **공유 DB 규율**: `prisma migrate reset/dev` 금지, additive 만. G 테이블 DROP 도 마이그레이션이 아니라 수동 SQL+스냅샷이었다.
- **i18n 경계**: sp-vue 관리자만 i18n 키(`develop-ko/en.ts`, 상태·이벤트·견적 라벨은 계약 `DEVELOP_*_LABELS` 정본이라 복제 안 함), `@sp/ui`·`apps/develop` 는 ko 인라인 관례.

## Sources [coverage: high — 58 sources]

- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — 단일 설명원본(왜·이름·결정 19·데이터·상태 머신·견적·AI·화면·API·알림·영카트·문서·모듈)
- [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — AI 사전 검토서 v1→v5·후처리 R1~R9·프로빙·정밀 구성도·thinking max
- [docs/develop-prototypes.md](../../docs/develop-prototypes.md) — G 제거·C 승격·경로 원복·운영 정리 실행 기록·원복 태그
- [docs/CONTACT_INQUIRY.md](../../docs/CONTACT_INQUIRY.md) — 문의 접수 경로 검토(결정 대기)
- [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — 대체된 4산출물 체계·AI 유스케이스 계층(`sp_ai_usecase`·`/api/ai/:useCase/run`) 경위
- [docs/DEPLOY_CENTRAFAB.md](../../docs/DEPLOY_CENTRAFAB.md) — 운영 배포 런북(develop 미반영 — 드리프트 근거)
- [docs/prompts/dev-review-phase3-backend.md](../../docs/prompts/dev-review-phase3-backend.md) · [4a-market](../../docs/prompts/dev-review-phase4a-market.md) · [4b-admin](../../docs/prompts/dev-review-phase4b-admin.md) — 검토서 체계 위임 지시서(08-29)
- [docs/prompts/develop-phase1a-app.md](../../docs/prompts/develop-phase1a-app.md) · [1b-admin](../../docs/prompts/develop-phase1b-admin.md) · [2a-app](../../docs/prompts/develop-phase2a-app.md) · [2b-admin](../../docs/prompts/develop-phase2b-admin.md) · [3-schedule](../../docs/prompts/develop-phase3-schedule.md) · [3-review-versions](../../docs/prompts/develop-phase3-review-versions.md) — P1~P3 워커 지시서(09-05)
- [docs/prompts/develop-wizard-v2a-app.md](../../docs/prompts/develop-wizard-v2a-app.md) · [v2b-admin](../../docs/prompts/develop-wizard-v2b-admin.md) · [followup-app](../../docs/prompts/develop-followup-app.md) · [followup-admin](../../docs/prompts/develop-followup-admin.md) — 위저드 v2·후속 질문 브리프(09-08)
- [AGENTS.md (root)](../../AGENTS.md) · [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 호칭 표·예약 경로·apps/develop 위치·`@sp/ui`
- [ops/nginx/local-web.conf](../../ops/nginx/local-web.conf) · [deploy.sh](../../deploy.sh) — `/develop`→5177·운영 static·케이스 5/9·첫 배포 체크리스트
- [ops/scripts/e2e-develop.mts](../../ops/scripts/e2e-develop.mts) · [ops/scripts/prod-develop-cleanup.sh](../../ops/scripts/prod-develop-cleanup.sh) — API 하네스(191/0)·운영 정리 스크립트
- [apps/develop/src/router.ts](../../samplepcb-web-mono-app/apps/develop/src/router.ts) · [main.ts](../../samplepcb-web-mono-app/apps/develop/src/main.ts) · [vite.config.ts](../../samplepcb-web-mono-app/apps/develop/vite.config.ts) · [style.css](../../samplepcb-web-mono-app/apps/develop/src/style.css) · [lib/auth-urls.ts](../../samplepcb-web-mono-app/apps/develop/src/lib/auth-urls.ts) · [lib/error-msg.ts](../../samplepcb-web-mono-app/apps/develop/src/lib/error-msg.ts) · [pages/RequestWizard.vue](../../samplepcb-web-mono-app/apps/develop/src/pages/RequestWizard.vue) · [composables/useFollowupJob.ts](../../samplepcb-web-mono-app/apps/develop/src/composables/useFollowupJob.ts) · [api/useDevelopRequests.ts](../../samplepcb-web-mono-app/apps/develop/src/api/useDevelopRequests.ts) — 고객 앱 경량 스캔
- [apps/api/src/routes/develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/develop-requests.ts) · [admin-develop-requests.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-requests.ts) · [admin-develop-quotes.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-quotes.ts) · [admin-develop-docs.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-docs.ts) · [admin-develop-settings.ts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-develop-settings.ts) · [lib/develop-payment.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-payment.ts) · [lib/develop-email.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-email.ts) · [lib/develop-ai-source.ts](../../samplepcb-web-mono-app/apps/api/src/lib/develop-ai-source.ts) · [lib/ai/usecases.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/usecases.ts) · [lib/ai/runner.ts](../../samplepcb-web-mono-app/apps/api/src/lib/ai/runner.ts) · [scripts/seed-develop-anchor-item.ts](../../samplepcb-web-mono-app/apps/api/src/scripts/seed-develop-anchor-item.ts) · [prisma/schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — 백엔드·DB 스캔
- [packages/api-contract/src/schemas/develop.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop.ts) · [develop-areas.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-areas.ts) · [develop-docs.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-docs.ts) · [develop-followup.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/develop-followup.ts) · [area-registry.ts](../../samplepcb-web-mono-app/packages/api-contract/src/schemas/area-registry.ts) · [routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts) · [packages/ui/src/index.ts](../../samplepcb-web-mono-app/packages/ui/src/index.ts) — 계약·공용 UI
- [apps/web/src/admin/develop-menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/develop-menu.ts) · [apps/web/src/admin/menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/menu.ts) — 관리자 「개발」 모듈 메뉴·배지
- [samplepcb-web/extend/sp_quote_cart.extend.php](../../samplepcb-web/extend/sp_quote_cart.extend.php) — `sp_develop_it_ids` 앵커 사전 union
- [e2e/specs/develop-wizard.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/develop-wizard.e2e.test.ts) · [develop-contact.e2e.test.ts](../../samplepcb-web-mono-app/e2e/specs/develop-contact.e2e.test.ts) — 브라우저 스모크(PORTAL_E2E=1)
