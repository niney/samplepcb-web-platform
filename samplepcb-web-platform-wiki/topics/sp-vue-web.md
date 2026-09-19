---
topic: sp-vue-web
last_compiled: 2026-09-19
sources_count: 87
status: active
---

# sp-vue-web

## Purpose [coverage: high — 12 sources]

`sp-vue` — samplepcb 신규 화면 영역의 **Vue 3 SPA** (`samplepcb-web-mono-app/apps/web`, 패키지명 `web`). 그누보드5/영카트(`sp-php`)와 **같은 도메인**에서 nginx 로 합류하며 `/app` 경로에 마운트된다(`base: '/app/'` 고정). 별칭 규칙상 "web" 호칭은 금지(PHP `samplepcb-web/` 와 혼동) — 문서·커밋에서는 `sp-vue`.

소스 날짜 범위는 2026-07-05(order-notify-gating) ~ 2026-09-18(BOM_QUOTE·마지막 커밋). **최근 3개월(2026-06-19~09-19)이 사실상 전부**라 "최근 합의"와 "이전 패턴"의 경계는 지난 컴파일(07-27) 이다 — 이전 패턴 = 관리자 콘솔 + 고객 BOM 2축(2026-07 컴파일분, 아래 Key Decisions 하단에 날짜 그대로 보존), 최근 합의 = 07-27 이후 322커밋(7월 39·8월 258·9월 25)으로 세워진 **세 번째·네 번째 축**: ① **협력사 포털 `/app/partner`**(BOM/PCB 모듈 분리 R1→사이드바 셸 R3→3개 언어) ② **관리자 업무 모듈 5종**(통합·PCB·BOM·개발·마켓 — 헤더 모듈 스위처 + 역할별 워크큐 + 단일 Case 상세). 코드 규모는 94,545줄(pages 69·components 90·composables 60여 파일).

역할 전제는 2026-07-19 이후 "관리자 콘솔 + 일반(회원) 화면"이고(router.ts 주석 정본), 08-10 부터는 **협력사(파트너) 화면**까지 셋을 한 앱에 담는다. 셸(레이아웃)이 넷: `DefaultLayout`(최소 홈)·`AdminLayout`(모듈 스위처+사이드바)·`BomLayout`(Parts Eyes 고객 셸, Figma 확정 디자인)·`PartnerLayout`(관리자 셸 미러). 고객 단순 화면은 여전히 sp-php(`/`), 재능마켓 소비자는 `sp-market`(`/market`), 개발의뢰 고객은 `apps/develop`(`/develop`:5177, 2026-09-05)이며 sp-vue 는 그 둘의 **관리 표면**(`/app/admin/market/*`·`/app/admin/develop/*`)을 맡는다. 관리자 콘솔은 최고관리자(cf_admin) 전용, 그누보드 `/adm` 과 병행 존속. UI 는 문서상 여전히 "프로토타입" 선언이나 실무 화면 전부가 확정 운영 중이고, 고객 BOM 셸(07-19)·랜딩(08-05~18 Figma 정밀 정합)만 명시적 확정 디자인이다.

## Architecture [coverage: high — 24 sources]

- **스택**: Vite 8 + Vue 3.5 + TypeScript 6 + Vue Router 4 + Pinia 3 + @tanstack/vue-query 5(+`vue-virtual`) + Tailwind v4 + vue-i18n 11. 인쇄·라벨용 `jspdf`·`html2canvas-pro`·`qrcode`. 폰트 Pretendard variable. workspace 의존 `@sp/api-contract`(Zod 계약)·`@sp/shared`(API 클라이언트·auth store)·`@sp/utils`(bom-pricing·kst-date 등 순수 함수)·**`@sp/ui`**(검토서 뷰어·구성도·드롭존·미리보기 — 18파일이 소비, 소비 앱 `style.css` 에 `@source` 필요)·`@sp/config`.
- **부트스트랩**(`main.ts`): pinia → i18n → vue-query → **마운트 전 `useAuthStore(pinia).bootstrap()`** → router 설치. 순서 필수(딥링크가 빈 auth 가드에 튕김). `App.vue` 는 `<RouterView>` + **`UiConfirmHost` 하나**(앱 전역 확인창 호스트).
- **라우터**(`router.ts`, 442줄): 4 그룹 + 공개 2 라우트. `/bom`(회원, 정적 세그먼트 `search`·`history` 를 `:id` 앞에)·`/partner`(회원 가드만 프론트, 소속·승인은 서버 `requirePartner` 매 요청)·`/rfq-reply/:token`·`/pcb-rfq-reply/:token`(가드 없음 — 토큰이 인증)·`/admin`(`requiresAdmin`). 07-27 이후 신설 페이지는 전부 **`() => import()` 지연 로딩**(52개) — 정적 import 는 홈·BOM 4·코어 관리자 12 뿐(17개). meta 는 `requiresAdmin`·`requiresMember`·`wide`·`adminContentFlush`(관리자 BOM 워크벤치가 본문 여백 제거).
- **관리자 셸**(`AdminLayout.vue`·`admin/menu.ts`): 모듈 사전 `adminModules = [core 통합, pcb PCB, smartbom BOM, develop 개발, market 마켓]`(2026-09-16 순서).
  - **활성 모듈 = 라우트 이름 접두에서 순수 파생**(`resolveAdminModuleKey`: `admin-develop*`→develop, `admin-smartbom*`·`admin-bom*`→smartbom, `admin-pcb*`→pcb, `admin-market-*`→market, 나머지 core) — 북마크·새로고침에도 메뉴가 안 어긋난다(레거시 useAppMode gotcha 회수).
  - 메뉴 항목은 `{to, labelKey, badge?, activeRouteNames?, placement?: 'bottom'}` — `placement:'bottom'` 은 저빈도 메뉴(BOM 업로드)를 사이드바 하단 그룹으로, `activeRouteNames` 는 상세 라우트에서 상위 메뉴를 켠다.
  - **배지 = 역할이 "지금 움직여야 하는 수" 하나씩**(19종 키) — 통합 1·BOM 5·PCB 6·개발 6, 훅 20여 개가 관리자 로그인 시에만 조회. PCB 배지는 대기 큐+진행 중 내 차례의 **합산**(SmartBOM 과 다름). 개발은 목록 호출 하나의 `counts`·`signals` 로 6배지.
  - Case 상세의 활성 메뉴는 `CASE_FROM_MENU`(라우트별 2단 사전)가 `?from=` 로 진입 워크큐에 동기.
- **PCB 작업 위치 복원**(`admin/pcb-navigation.ts`, 2026-08-14): 7섹션(cases·rfqs·orders·pos·remittances·shipments·claims)의 마지막 섹션·탭을 **관리자 mbId 별 localStorage** 에 기억, 모듈 스위처·메뉴 클릭이 그 자리로 간다. 화면 상태(탭·페이지·검색·날짜)는 URL query, 상세 진입 URL 에 복귀 경로 동봉. 개발 모듈도 동형(`develop-navigation.ts`, G 프로토타입 이식): 큐 탭·신호·검색·페이지를 쿼리에, 상세 `?from=`+`lt/ls/lq/lp` 로 「← 목록으로」가 떠난 자리로.
- **포털 셸**(`PartnerLayout.vue`·`partner/menu.ts`, R3 2026-08-22): 관리자 셸 **동형**(사이드바 w-60·`lg` 미만 햄버거·모듈 스위처·테마·프로필).
  - 모듈 2(`bom` BOM 부품/`pcb` PCB 제작) + **공통 영역**(수금 `requiresTrack:'pcb'`·보유 부품 `requiresTrack:'parts'`) — 항목이 노출 조건을 들고 셸이 건다. 스위처는 **보유 트랙 2개일 때만**(1트랙은 사이드바 상단 모듈명이 정체성).
  - 배지 8종은 홈 카드와 **같은 vue-query 캐시**(`usePartnerWork.ts` — 목록 훅에 `enabled` 인자를 넣어 트랙 없는 모듈은 부르지 않음)라 숫자가 어긋나지 않고 추가 요청 0.
  - 진입 리졸버 `PartnerEntry.vue`(정식 진입점 — 포털 메일 전수가 이 URL): 트랙 0=안내 / 1=그 모듈 / 2=`sp.partnerModule` 기억값이 현재 트랙에 유효하면 그것, 아니면 BOM. 모듈 색 = BOM indigo / PCB teal / 공통 amber.
  - 페이지 헤더 `PartnerPageHeader.vue`(제목·부제·←복귀·배지·액션 슬롯 — 최상위 화면은 복귀 링크 없음, 상세만 "← 견적요청/발주서"), 워크큐 탭 `PartnerWorkqueueTabs.vue`(관리자 워크큐와 같은 밑줄 탭, count 는 탭 미반영 분포), 탭 상태 `useRouteTab.ts`(`?tab=`, 기본 탭은 쿼리에서 생략, 탭 바뀌면 page 리셋 — 4 워크큐가 사용).
- **포털 i18n**(`partner/i18n.ts`·`i18n-core.ts`·`locales/{common,bom,pcb,shipment,parts}.ts` 993줄, 2026-09-06): 전역 vue-i18n 과 **별개의 주입 컨텍스트** — `PartnerLayout` 만 `providePartnerI18n()` 으로 범위를 열고, 하위·텔레포트 모달이 `usePartnerI18n()` 의 `pt(원문, params)`·`pn`·`pd`·`pm` 을 쓴다.
  - 메시지는 **한국어 원문 키 → `[ko 개선문, en, zh-CN]` 튜플**. 포털 밖에서 같은 공용 컴포넌트가 쓰이면 `pt` 는 원문을 그대로 돌려줘 관리자·고객 문구가 보존된다(42파일이 사용). 앱 루트의 `UiConfirmHost` 만 `route.matched` 로 명시 스코프를 넘긴다.
  - 날짜는 `Asia/Seoul` 고정(해외에서 납기가 하루 앞당겨지지 않게), 통화는 표시만 바뀌고 금액·통화 불변. 포털 진입 시 `document.lang` 을 바꾸고 퇴장 시 복원.
- **디렉터리**: `pages/admin/` 43(코어 8·마켓 4·개발 9·BOM 업로드 2·smartbom 8·pcb 9·mail-logs·partners·partner-parts) · `pages/partner/` 19 · `pages/bom/` 4 · `components/admin/` 38+`bom/`(07-28 관리자 스냅샷 10)+`smartbom/` 15+`pcb/` 11+`develop/` 29 · `components/partner/` 9 · `components/pcb/` 4 · `components/smartbom/` 7(견적서·인보이스·패킹·거래문서 시트) · `components/ui/` 6(`UiConfirmHost`·`UiPromptModal`·`UiPagination`·`UiBadge`·`UiComboInput`·`PartImage`) · `admin/` 35 훅·사전 · `partner/` 13 · `bom/` 9 · `lib/` 12.
- **공용 헬퍼(lib)**: `confirmDialog.ts`(`if (!(await confirmDialog('…'))) return;` — 61곳, `tone:'danger'`) · `usePrintIsolation.ts`(인쇄 격리 `<style>` 의 **열림 수명** 관리 + 참조 카운트, 7 모달) · `route-ids.ts`(BigInt PK 선검증 — 잘못된 id 를 "재시도"로 오안내하지 않음) · `pcb-spec.ts`(2,505줄 **자동 생성** — 거버 앱이 정본, 세트는 category·orderCategory·kindPcb) · `pcb-money.ts`·`pcb-eq-review.ts`·`pcb-shipment-label.ts`·`shipment-carriers.ts`·`useDaumPostcode.ts`. `admin/useRowSelection.ts`(현재 페이지 범위만 전체선택, 4화면) · `admin/smartbom.ts`(12단계 파생 타임라인 — 저장 상태가 아니라 계산).
- **테마**: `bom/useTheme.ts` 싱글턴(`data-theme` + `sp-theme` localStorage, 없으면 OS 설정) — 다크 테마는 07-29 BOM 셸에서 시작해 `AppThemeToggle.vue` 로 관리자·기본·포털 셸이 공용(BOM 셸만 Figma 크롬 색 자체 버튼). `AppProfileMenu.vue`(08-02) 는 셸 3종 공용 — 로그인/로그아웃/회원정보 + 슈퍼관리자 "시스템 관리자"(`/adm`) 링크(08-05) + 파트너 포탈.
- **설정 페이지 탭 4종**(`SettingsTabs`): `businessInfo`·`gerberPricing`·`aiIntegration`·`bomQuote`. AI 연동 폼은 **8블록**(연결 / 검토서 생성+샘플 테스트 / 정밀 구성도 / 개발의뢰 검토서·구성도 / 후속 질문 / 문서 메일 초안 / 실행 이력) — 프롬프트 본문은 코드 정본이라 textarea 없음.
- **관리자 BOM 스냅샷 원칙**(`components/admin/bom/README.md`, 07-28): 관리자 업로드 워크벤치(`AdminBomQuote`·`AdminBomUpload`)는 고객 BOM 표시 컴포넌트를 **복제한 독립 스냅샷**(BomCandidateDrawer 3,306줄 별본) — 고객 화면 개편이 관리자에 자동 전파되지 않게 하고, 결함 수정은 양쪽에 명시 반영. 계약·훅·`PartImage`·`src/bom/` 원본만 공유.
- **타입 강성 "매우 강함"**·dev 서버(5173, `host:'127.0.0.1'`, `allowedHosts`, proxy `/api`→3333·`/spcb`→8888)는 이전과 동일.

## Talks To [coverage: high — 10 sources]

- **sp-node** (`/api`, Fastify 5) — 유일한 데이터 통로. 관리자 `/api/admin/*`(Bearer JWT `requireAdmin` — quotes·orders·members·partners·partner-parts·parts·settings·slides·seo·mail-logs·market·develop·bom-quotes·bom-orders·bom-pos·bom-shipments·pcb-cases/rfqs/pos/remittances/shipments/claims·digikey), 협력사 `/api/partner/*`(`requirePartner` 매 요청 — `GET /api/partner/access` 가 `tracks:{bom,pcb,parts}`·`partnerName` 을 조직 capabilities 에서 파생), 고객 `/api/bom`(회원 `authenticate`), 매직링크 `/api/rfq-reply/:token`·PCB 동형. 계약은 `@sp/api-contract`(Zod) — 라벨 사전(`DEVELOP_*_LABELS`·`MARKET_*_LABELS`·`PCB_STEPS`·`DeliveryMethod`) 도 계약이 정본이라 i18n 으로 복제하지 않는다. 상세: [sp-node-api](sp-node-api.md).
- **sp-php 인증 브리지** (`/spcb/api/me`, HS256 JWT TTL 10분) — `requiresMember` 가드는 그누보드 로그인 왕복(`lib/auth-urls.ts` 의 loginUrl/logoutUrl/memberInfoUrl/systemAdminUrl). PHP 사이트 홈 공용 GNB 도 같은 `/api/partner/access` 승인 상태를 조회해 "파트너 포탈" 링크를 표시(양쪽 노출 판정이 서버 하나). e2e 는 이 브리지를 **라우트 스텁**으로 대체해 비밀번호 없이 임의 계정으로 풀스택을 돌린다 — [testing](testing.md).
- **sp-engine·Elasticsearch** — 직접 통신 없음(sp-node 잡 프록시·투영 필드 렌더만). 09-14 수량 누락(`quantityState`)·09-18 검색 후보 `searchMatch`·`engine.incompleteSuppliers` 도 엔진 판정을 그대로 소비.
- **DigiKey OAuth**(외부, D42) — `useAdminDigikey.ts` 가 `/api/admin/digikey/oauth/start` 로 승인 URL 을 받아 브라우저를 DigiKey 로그인으로 보내고 복귀는 `smartbom/receiving`(→ logistics 리다이렉트) 로 돌아온다. 유일한 외부 사이트 왕복.
- **sp-market**(`/market`)·**sp-develop**(`/develop`) — 소비자 SPA 와 "관리=sp-vue" 짝. 개발의뢰는 `apps/develop`(고객) ↔ `/app/admin/develop/*`(관리자) 가 같은 `sp_develop_*` 를 본다 — [sp-develop-web](sp-develop-web.md).
- **"관리=sp-vue / 소비=sp-php" 짝**: 슬라이드·SEO 는 이전과 같고, **EQ 고객 확인**(P4.1, 08-07)은 관리자 요청 → 고객이 sp-php 주문내역에서 승인, **주문 진행 표시**(§6.36, 08-25)는 sp-node `/api/order-progress` 파생을 sp-php 목록·상세와 sp-vue 관리자 드로어가 같이 소비.
- **Mailpit/메일** — sp-vue 는 발송 주체가 아니라 **원장 조회자**(`/app/admin/mail-logs`, Case 상세 '보낸 메일', 대시보드 실패 위젯 — `MailLogList.vue` 하나 공유). 재발송은 quick_mail 만.
- **nginx** — `/app/`→5173·`/api/`→3333·`/market/`→5176·`/develop/`→5177·`/`→8888. 협력사 트랙 업무 규칙은 [partner-tracks](partner-tracks.md), 위저드 등 개념은 [admin-vue-consume-php](../concepts/admin-vue-consume-php.md).

## API Surface [coverage: high — 9 sources]

sp-vue 는 API 를 노출하지 않는 소비자다. 노출 표면은 **브라우저 라우트**(`/app` 하위, 2026-09-19 router.ts 실측 78 라우트):

| 그룹 | 라우트 | 화면·비고 |
|---|---|---|
| 홈 | `/` | DefaultLayout — 스마트 BOM·관리자·파트너 포탈 링크(승인 시) |
| 고객 BOM(회원) | `/bom` · `/bom/search` · `/bom/history` · `/bom/:id` | Parts Eyes 셸. 09-14 수량 누락 팝업·행별 수량 확정, 09-18 단일검색 공급사 확인 완료 후 후보 확정 |
| 협력사 포털(회원+서버 판정) | `/partner`(리졸버) | 트랙 0 안내 / 1 그 모듈 / 2 기억값 |
| · BOM 부품 모듈 | `bom`(홈 오늘 할 일) · `bom/rfqs`(todo/done/all) · `bom/rfqs/:id` · `bom/pos`(todo/active/done/all) · `bom/pos/:id` · `bom/ship`(📦 보내기 두 칸+진행 중) · `bom/shipments/done` | 워크큐 탭·검색·20건 페이지는 클라이언트(서버 전량 반환) |
| · PCB 제작 모듈 | `pcb` · `pcb/rfqs` · `pcb/rfqs/:id`(회신+MD 하위 재요청·선정) · `pcb/pos`(todo 내 차례/watching 관전/all) · `pcb/pos/:id`(EQ 5단계·MD 하위 발주) · `pcb/as` · `pcb/ship`(박스 보드) · `pcb/shipments/done` | 모듈 간 화면 공유 금지(D9 미러) |
| · 공통 영역 | `remittances`(tracks.pcb) · `parts` · `parts/uploads/:uploadId`(tracks.parts) | 수금·보유 부품은 억지 배속 안 함 |
| 공개(토큰) | `/rfq-reply/:token` · `/pcb-rfq-reply/:token` | 가드 없음, 서버가 토큰 검증(무효 404), RFQ 1건 스코프 |
| 관리자 · 통합 | `/admin`(대시보드 — 발송 실패 위젯) · `quotes` · `orders`(배송방법 셀렉트 08-17·트랙별 진행 스텝퍼) · `members` · `partners`(조직·capabilities·MD 소속) · `partner-parts`(원장 끄기/비우기/대행 업로드) · `parts` · `slides` · `seo` · `mail-logs`(필터·프리셋 `?status=failed`) · `settings` | 09-16 마켓 4메뉴 이탈 |
| 관리자 · PCB | `pcb/cases`(구간 탭+12단계 칩, 기본 탭 발주·생산) · `pcb/rfqs` · `pcb/orders` · `pcb/pos` · `pcb/remittances` · `pcb/shipments` · `pcb/claims` · `pcb/cases/:id`(3,409줄 단일 척추, `?from=` 접힘) · `pcb/packages/:code`(QR 도착점) | 첫 탭 = 역할의 대기 큐(D12) |
| 관리자 · BOM | `smartbom`(진행현황) · `smartbom/quotes` · `smartbom/orders` · `smartbom/pos` · `smartbom/logistics`(조달 선적+고객 배송+**통합 스캔 박스**) · `smartbom/claims` · `smartbom/cases/:id` · `smartbom/packages/:code` · `bom`·`bom/:id`(업로드 워크벤치, 하단 메뉴) · `smartbom/receiving`→logistics 리다이렉트 · `smartbom/partners`→`partners` 리다이렉트 | `/admin/bom-quotes` 는 09-16 제거(리다이렉트 없음) |
| 관리자 · 개발 | `develop`(진행현황) · `develop/intake` · `develop/contracts` · `develop/projects` · `develop/deliveries` · `develop/inquiries` · `develop/requests` · `develop/requests/:id(\d+)`(전면 상세 6탭 `?tab=`) · `develop/settings` | 단계별 워크큐, 공용 표 `DevelopQueueTable` |
| 관리자 · 마켓 | `market/experts` · `market/projects` · `market/contracts` · `market/settings` | 09-16 독립 모듈 |

라우터 가드는 UX 용 — **실제 보안은 sp-node 의 JWT·`requirePartner`·소유 검증**. 화면 상태의 URL 계약: 워크큐 `?tab=`(+`page`·`q`·날짜), 상세 `?from=quotes|orders|pos|logistics|…`(섹션 접힘·활성 메뉴), 개발 상세 `?tab=`·`?doc/kind`, 큐 복귀 `lt/ls/lq/lp`.

## Data [coverage: high — 11 sources]

- sp-vue 는 DB 직접 접근 없음 — 전부 sp-node 경유. 간접 저장소는 이전 목록(sp_bom_*·sp_part*·sp_quote·sp_market_*·sp_seo·sp_config·g5_*)에 더해 `sp_partner`(+member·capabilities)·`sp_bom_rfq/po/shipment`·`sp_pcb_rfq/po/shipment/as_case`·`sp_pcb_remittance`·`sp_partner_part*`·`sp_mail_log`·`sp_develop_*`·`sp_bom_receiving_scan`·`sp_ai_job`. 자세한 소유·전이는 [sp-node-api](sp-node-api.md)·[partner-tracks](partner-tracks.md).
- **판정·계산은 서버, FE 는 소비만** — 07 컴파일의 원칙이 새 축에서도 그대로: 진행현황 `step`(12단계)·워크큐 소속 탭·배지 카운트·`myTurn`·EQ 반려 판정(`isPcbEqRejectionEvent` 계약 함수 하나)·알림 체크박스 게이트(`GET /admin/orders/notify-config` boolean)·배송방법 어휘(`DeliveryMethod` 계약 enum)·파트너 `tracks`·개발 큐 `signals`·첨부 미리보기 갈래(`fileViewKind` 계약 함수 FE/BE 공유). 관리자 교체·추가 API 는 클라 가격·재고·합계를 받지 않는다.
- **클라 상태 3층**: ① Pinia 는 auth 뿐(`@sp/shared`) ② vue-query 도메인 키(`['admin', …]`·`['partner','access', mbId]`·`['bom', …]`) — 배지·홈 카드·목록이 **같은 키를 구독**해 숫자 불일치와 추가 요청을 구조적으로 제거, 성공 시 `['admin','develop']` 같은 접두 무효화 ③ **URL query** 가 화면 상태의 정본(탭·페이지·검색·from·doc). 편집 초안은 컴포넌트 로컬 — 개발 상세는 `v-show` 로 5탭을 전부 마운트해 탭 이동에 초안이 안 날아가고, 검토서 편집기는 서버 응답을 **필드별 복제**(`cloneDevelopReview`)해 든다.
- **localStorage 키**(전부 try/catch, 프라이빗 모드 무해): `sp.partnerModule`(마지막 포털 모듈 — 보조 신호, 서버 tracks 가 무효화) · `sp.partner.locale`(ko/en/zh-CN) · `sp-theme` · `sp:admin-module`(기록만) · PCB 관리자 섹션·탭 기억(mbId 별) · 개발 상세 "옆 보기" 토글.
- **i18n 두 체계**: 전역 vue-i18n `ko.ts`(1,246줄)/`en.ts`(동형 키 집합, en 은 fallback ko) + `develop-ko/en.ts`(659줄) — 관리자·고객 BOM 문구. 포털은 원문 키 튜플(위 Architecture). 도메인 라벨은 둘 다 계약 사전을 그대로 쓴다. `admin.mailLogs.kind.*` 미등록 코드는 원문 노출(catchall)이라 서버 kind 추가에 UI 가 안 깨진다.
- 가격·수량·날짜 공용 함수: `@sp/utils` bom-pricing(골든 14)·**`kst-date`**(`fmtKstDate`·`kstDateInput`·`kstToday` — 08-06 납기 하루 밀림 교정 후 관리자 6화면·포털 2화면·SmartBOM 11파일 일괄 교체).
- 알려진 한계: 포털 워크큐·PCB 발주 워크큐(`loadAdminPcbPoWorkItems` 전건 로드+N+1)는 건수 증가 시 서버 페이지네이션 전환 예정. 역할 권한(계정별 메뉴 제한)은 미구현 — 전 메뉴가 최고관리자에게.

## Key Decisions [coverage: high — 20 sources]

1. **2026-09-16 — 업무 메뉴 정리(c2708fc8a)**: 통합 안의 마켓 4메뉴 → **마켓 모듈** 신설(직접 접속·새로고침도 활성), 통합의 중복 BOM 견적요청(`/admin/bom-quotes`·`AdminBomQuotes.vue` 337줄) **제거·리다이렉트 없음** → BOM 견적관리+Case 상세로 통일, BOM 업로드는 BOM 모듈 **사이드바 하단**(`placement:'bottom'`). 입고 이력의 견적 연결 없는 행은 링크 대신 "연결 없음" 표기.
2. **2026-09-09~11 — 개발 = 독립 모듈**(DEVELOP_FLOW §14): 통합 메뉴 2개+상세 탭 6개 → 모듈 스위처 「개발」 + 단계별 워크큐 8메뉴(배지 6 = 관리자 차례) + 공용 표 `DevelopQueueTable`·열 프리셋. G 프로토타입 제거·C 정본(09-10). 상세는 단일 컬럼 1120px·탭 `?tab=`·"의뢰 내용 옆 보기"(09-05, 사이드 340px 폐기). 편집 중 이탈 가드 = `confirmDialog`(라우터)+`beforeunload`.
3. **2026-09-06 — 포털 3개 언어**: 전역 vue-i18n 을 바꾸지 않고 포털 범위 주입 컨텍스트 + 원문 키 튜플. 공용 컴포넌트는 포털 밖에서 원문 반환, 사용자 데이터·코드값·상업송장 인쇄 헤더는 번역 안 함, 날짜 `Asia/Seoul`·통화 불변.
4. **2026-08-25 — 주문 진행 표시 트랙 공용**: sp-node `/api/order-progress` 파생(PCB 7칸·BOM 6칸)을 관리자 드로어·고객 목록·줄·카드가 함께 소비, 트랙별 스텝퍼. 어휘·단계색·취소류 표기 교정(P4.14).
5. **2026-08-22~23 — 포털 R3 하이브리드 셸 + 보유 부품 공통 영역**: 허브-앤-스포크(홈만 허브) → 관리자 셸 미러 사이드바 + 워크큐 목록 4화면(`?tab=`) + `PartnerPageHeader` 통일 + 배지=홈 카드 같은 캐시. 홈(오늘 할 일)·리졸버·모듈 기억은 유지. 본문 좌측 정렬·최대 1440px. 보유 부품은 모듈이 아니라 공통 영역(`tracks.parts`=`part_sale`), 메뉴 항목이 `requiresTrack` 을 든다.
6. **2026-08-22 — 입고 스캔은 선적·배송의 통합 스캔 박스**(D42): 우리 포장 QR/라벨과 공급사 봉투 ECIA 라벨을 **한 입력**으로 받아 갈래를 나눈다. `smartbom/receiving` 은 리다이렉트로만 남김(OAuth 복귀·옛 링크). DigiKey 3-legged 연결은 관리자가 한 번 로그인, 서버가 refresh.
7. **2026-08-20 — 인쇄 격리 스타일의 수명 = 열림 구간**(`usePrintIsolation`): SFC `<style>` 상주(ShipmentPackingModal)가 BOM 견적서 인쇄를 백지로 만든 실측 → 가해자가 규칙을 걷어가는 컴포저블 + 참조 카운트.
8. **2026-08-14 — PCB 관리자 마지막 작업 위치 복원**: 화면 상태는 URL, 다음 진입 위치는 mbId 별 localStorage 로 나눠 보존. 개발 모듈이 09-10 같은 규약을 이식.
9. **2026-08-10 — 네이티브 대화상자 전면 제거**(P4.11): `window.prompt` 7곳 → `UiPromptModal`(필드 정의·필수값 잠금·Ctrl+Enter), `window.confirm` 33곳 → `confirmDialog()`+앱 루트 `UiConfirmHost`. 이유는 취향이 아니라 "추가 대화상자 표시 안 함" 체크 한 번에 **조작이 통째로 막히고** 두 번째 창 취소로 첫 입력이 사라지던 실결함. 현재 61곳 사용, 남은 prompt 는 클립보드 복사 실패 폴백 1곳.
10. **2026-08-10 — 포털 BOM/PCB 모듈 분리(R1·R2)**: 혼합 홈 → 모듈 스위처+모듈별 화면, 화면 공유 금지(컴포넌트 재사용은 허용), 구 URL 완전 제거(리다이렉트 잔재 없음). PCB 완료 발송 아카이브 신설.
11. **2026-08-07 — 관리자 정보구조 3건**: 파트너 관리 smartbom → **통합**(조직 정본이 PCB·부품 판매까지 공유) · 헤더 모듈 순서·명칭 재구성 · 발송 이력 원장 화면(코어 모듈, `MailLogList` 전역+Case 임베드 공유) + P3(재발송·실패 위젯·보존 180일).
12. **2026-08-06 — 삭제 UX 위험 3단 레이어 통일**: 거버 견적 삭제 모달을 SmartBOM Case 삭제와 같은 3단(차단 사유 전부 표시·관리자 체크로 차단 해제·무기록)으로, PCB 견적요청에도 배치 삭제. 선택 툴바·모달 형태를 SmartBOM 기준으로.
13. **2026-08-05 — PCB 워크큐 첫 탭 = 역할의 대기 큐**(D12, P3.6): RFQ/PO/선적 행이 있어야 모수에 들던 3화면에 `PcbTodoQueue` 편입, 진행현황은 구간 탭+12단계 칩(기본 탭 발주·생산 — 완료 2만 건이 모수를 덮지 않게), `CASE_FROM_MENU` 라우트별 2단 사전으로 교정.
14. **2026-08-02 — 관리자 메뉴 = 역할별 워크큐, 상세 = 단일 Case 척추**(§6.12): 견적/주문·결제/발주/선적·배송(+클레임 08-11) 목록은 파트 전용 탭·인라인 액션, 상세 4벌 금지 대신 `?from=` 로 **무관 섹션 한 줄 접힘**(초기 `?focus=` 스크롤+강조는 과잉으로 제거). PCB 모듈이 같은 골격을 미러(구현 분리, D9).
15. **2026-07-29~31 — smartbom 모듈 스위처(D15)·다크 테마·포털 첫 개통**: `adminModules` 사전 + 라우트 접두 파생 활성 모듈, 색을 역할 토큰으로 모으고 다크 지원, 매직링크 무로그인 회신·견적서 열람·인쇄.
16. **2026-07-28 — 관리자 BOM 워크벤치 독립 스냅샷**: 고객 화면 개편의 자동 전파 차단(README).
17. **2026-07-26(이전 컴파일 보존)** — 자체 카탈로그 우선 조회를 `localCatalogTrace` 전용 카드로 검색 과정 1번에(`로컬 ES · API 0회`) · 제조사 카탈로그 부품 = "문의 견적"(금액 없는 선정, 5곳 같은 어휘) · 카탈로그 파괴 작업 2종 안전 등급 분리([필터 결과 전체 삭제]는 견적 연결분 보호, [카탈로그 초기화]는 연결 견적 강제 삭제).
18. **2026-07-24** — 행별 검색조건 보완을 후보 패널에서(`searchRequirements` 별도 저장, 부품 유형 9종 동적 폼, 해당 행만 재검색).
19. **2026-07-22** — 정확 MPN 우선 선정은 하되 불일치를 숨기지 않는다(`품번 일치 우선 선정 · 추가 정보 불일치` 배지+툴팁).
20. **2026-07-21** — "공급사 원응답 N건" 과 "최종 후보 N개" 를 i18n `bomSearchTrace` 사전으로 분리 표기.
21. **2026-07-20** — 행 단위 렌더 격리(`BomQuoteRow`+참조 안정 동기화+PATCH `setQueryData`, 12~16ms→0.6~3ms) · [후보 비교] 우측 패널 통합 · 단일 검색 하이브리드(카탈로그 즉답+공급사 보충).
22. **2026-07-19** — sp-vue 일반(회원) 라우트 그룹 신설("/app=관리자 전용" 전제 공식 변경) · 조용한 자동 보강(`enrichStatus` 라벨만) · Parts Eyes 셸 Figma 이식(프로토타입 선언의 첫 예외).
23. **2026-07-18** — 부품 카탈로그 관리 화면 `/app/admin/parts`(단위 지능은 TS `spec-units.ts`, 검색 2트랙).
24. **2026-07-04~12** — 관리 표면 sp-vue 이관(견적·회원·주문·설정) · `ORDER_PIPELINE` SSOT · 마켓 관리 4종 · "관리=sp-vue / 소비=sp-php SSR"(SEO·슬라이드) · AI 연결/유스케이스 분리 · placeholder 라우트 금지.
25. **(플랫폼 초기)** — 같은 도메인 경로 분기(`/`·`/app`·`/market`·`/api`, base 변경 금지) · Zod 계약 단일 진실 · 마운트 전 부트스트랩 · 판정은 서버 · UI 프로토타입 선언(ko 실서비스·en 스텁).

## Gotchas [coverage: high — 14 sources]

- **역할 서술 문서 불일치(지속)**: 루트 AGENTS.md 표·본문은 아직 "sp-vue = 관리자 전용", 모노 AGENTS.md 도 "실질 기본 용도는 관리자"(포털 i18n 예외만 추가). 정본은 router.ts 주석 + PARTNER_PORTAL.md — 셋(관리자·회원·협력사)을 담는다.
- **워크큐 기본 탭이 "우리 건"의 탭이 아니다**: PCB 진행현황 기본=발주·생산, 발주 워크큐=발주 대기, 주문·결제=입금 대기, 포털은 `todo`. 검증·탐색 시 탭 클릭+검색으로 좁힐 것 — e2e 오탐의 단골.
- **같은 URL 이 `?from=` 에 따라 다르게 렌더**된다(Case 상세 섹션 접힘·활성 메뉴). 버그로 오인하지 말 것. from 없음 = 전체 표시.
- **포털 사이드바 라벨은 `partner.menu.*` i18n 키가 아니라 `PartnerLayout` 안 `MENU_LABELS` 사전**(09-06 개선안 문구 — '발주 관리'·'출하 준비')을 `pt()` 로 번역한다. `labelKey` 는 식별자 역할만. 메뉴 문구를 바꾸려면 두 곳을 보되 실제 표시는 사전 쪽.
- **`pt()` 는 원문 키 정확 일치** — 원문 한 글자가 바뀌면 조용히 번역이 빠진다. e2e `partner-i18n` 스펙이 누락·변수 불일치·중복 키를 검사하므로 문구 수정 후 반드시 돌릴 것.
- **엔진 판정을 FE 가 재구성하지 말 것**(지속): 재고 사유·`quantityState`·`searchMatch`·EQ 반려·myTurn·step 전부 서버 필드. "금액 없음 ≠ 미선정".
- **`.vue` 발 타입은 ESLint 프로그램에서 error type** — 변수 주석/`satisfies` 에 물리면 `no-unsafe-*` 오탐 → 추론 타입+`as const`. `structuredClone` 은 reactive proxy 에서 던진다(필드별 복제). `@sp/shared apiGet` 은 `.catch()` 든 스키마도 그대로.
- **인쇄 모달 새로 만들 때** SFC `<style>` 에 `body > :not(.내-호스트)` 를 두면 임포트 순간부터 다른 모달 인쇄를 지운다 — 반드시 `usePrintIsolation(styleId, css, isOpen)`.
- **네이티브 `confirm/alert/prompt` 금지**(워커 지시서 공통 규율). 확인은 `confirmDialog`(동시에 하나, 앞선 물음은 취소로 닫힘), 값 입력은 `UiPromptModal`, 상태 사유 등은 인라인 패널.
- **BigInt 라우트 id**: `/develop/requests/:id(\d+)` 처럼 정규식 또는 `isPositiveBigIntId` 로 선검증 — 아니면 400/500 을 "재시도"로 오안내.
- **정적 import 잔존**: 홈·BOM 4·코어 관리자 12 페이지는 아직 정적 — 고객 `/bom` 방문자가 코어 관리자 코드를 내려받는다(신설분은 전부 lazy). 07-19 776KB 이후 번들 재측정 없음.
- **e2e 스텁 로그인**은 `/spcb/api/me` 라우트 인터셉트 — 도메인와이드 PHPSESSID 충돌로 실브라우저에서 401·익명이면 그 도메인 쿠키부터 삭제. 여정 연속 주행 502 는 앱이 아니라 nginx 임시 포트 고갈(keepalive 반영됨).
- **DigiKey OAuth 복귀 경로**는 `smartbom/receiving` 리다이렉트에 의존 — 이 라우트를 지우면 연결이 끊긴다.
- **BOM 워크벤치 상태 판정 함정**(이전 컴파일 유효): `items.length===0` 은 분석 중 신호가 아님(`buildStatus`), done 뒤 카탈로그 재매칭 호출 금지, searching 중 PATCH 잠금. **[카탈로그 초기화]는 연결 견적까지 지운다**(부분 정리는 [필터 결과 전체 삭제]).
- **검색 과정 건수 오독**(공급사 원응답 ≠ 최종 후보) · **AI 연동 env 우선**(`.env` 값이 있으면 화면 입력 잠김 — "저장했는데 안 바뀜") · **알림 체크박스는 서버 게이트**(설정 꺼진 채널은 목록·상세 모두 숨김, 코어 orderlist 무조건 노출 결함의 의도적 패리티 이탈).
- **Windows Vite host**(`host:'127.0.0.1'`·`allowedHosts` 필수, turbo 깨짐 → `pnpm -r typecheck`) · `any`/`as any`/`@ts-ignore` 금지 · 공유 DB 라 `prisma migrate reset` 절대 금지(g5_* 드랍).
- **포털 목록은 서버 전량 반환** — 탭·검색·페이지가 클라이언트라 건수가 크면 느려진다(서버 페이지네이션 전환 예정). 관리자 PCB 발주 워크큐도 전건 로드+N+1.

## Sources [coverage: high — 87 sources]

문서
- [AGENTS.md (root)](../../AGENTS.md) · [samplepcb-web-mono-app/AGENTS.md](../../samplepcb-web-mono-app/AGENTS.md) — 호칭·역할 서술·스택·포털 i18n 예외·`@sp/ui`·`/develop` 프록시
- [docs/PARTNER_PORTAL.md](../../docs/PARTNER_PORTAL.md) — 포털 IA·진입 규칙·R3 셸·홈 대칭·검증 · [docs/partner-i18n.md](../../docs/partner-i18n.md) — 3개 언어 범위·구현 경계
- [docs/SMARTBOM_PARTNER_RFQ.md](../../docs/SMARTBOM_PARTNER_RFQ.md) — §3 모듈 스위처·§5.1 정정·§6.12 역할별 워크큐·`?from=` 접힘·§6.34/35 카트 인계·입고 스캔 · [docs/PCB_PARTNER_TRACK.md](../../docs/PCB_PARTNER_TRACK.md) — §5.4 PCB 모듈·P3.6 대기 큐·P4.11 대화상자
- [docs/PARTNER_PARTS.md](../../docs/PARTNER_PARTS.md) — §6 포털·관리자 화면·정렬·행 수정 · [docs/MAIL_LOG.md](../../docs/MAIL_LOG.md) — 발송 이력 UI·위젯·재발송
- [docs/BOM_QUOTE.md](../../docs/BOM_QUOTE.md) — 화면 절·관리자 스냅샷·요청 모달 · [docs/PARTS_SEARCH.md](../../docs/PARTS_SEARCH.md) — AdminParts
- [docs/DEVELOP_FLOW.md](../../docs/DEVELOP_FLOW.md) — §7.3·§13.5·§14 관리자 개발 모듈 · [docs/AI_DEV_REVIEW.md](../../docs/AI_DEV_REVIEW.md) — §6 AI 연동 탭·§12.4·§13.4 관리자 표시
- [docs/prompts/develop-phase1b-admin.md](../../docs/prompts/develop-phase1b-admin.md) · [phase2b](../../docs/prompts/develop-phase2b-admin.md) · [wizard-v2b](../../docs/prompts/develop-wizard-v2b-admin.md) · [followup](../../docs/prompts/develop-followup-admin.md) · [dev-review-phase4b](../../docs/prompts/dev-review-phase4b-admin.md) — 관리자 화면 규율(파일 스코프·i18n·네이티브 대화상자 금지·계약 사전 비복제)
- [docs/MARKET_FLOW.md](../../docs/MARKET_FLOW.md) — 관리자 화면 지도·첨부 미리보기 · [docs/AI_DIAGRAM.md](../../docs/AI_DIAGRAM.md) — AI 연동 탭 · [docs/SEO_MANAGEMENT.md](../../docs/SEO_MANAGEMENT.md)
- [docs/order-notify-gating.md](../../docs/order-notify-gating.md) · [docs/DELIVERY_METHOD.md](../../docs/DELIVERY_METHOD.md) — 주문 화면 게이트·배송방법 FE 반영
- [samplepcb-web-mono-app/e2e/README.md](../../samplepcb-web-mono-app/e2e/README.md) — `/spcb/api/me` 스텁 로그인·함정 · [components/admin/bom/README.md](../../samplepcb-web-mono-app/apps/web/src/components/admin/bom/README.md)
- 이전 컴파일 보존: [bom-quote-code-review-2026-07-19](../../docs/bom-quote-code-review-2026-07-19.md) · [GERBER_PRICE_MODE](../../docs/GERBER_PRICE_MODE.md) · [GERBER_ORDER_FLOW](../../docs/GERBER_ORDER_FLOW.md) · [DELIVERY_CARRIER_INTEGRATION](../../docs/DELIVERY_CARRIER_INTEGRATION.md) · [DB_TUNING](../../docs/DB_TUNING.md)

코드(`samplepcb-web-mono-app/apps/web/`)
- [src/router.ts](../../samplepcb-web-mono-app/apps/web/src/router.ts) · [src/main.ts](../../samplepcb-web-mono-app/apps/web/src/main.ts) · [src/App.vue](../../samplepcb-web-mono-app/apps/web/src/App.vue) · [package.json](../../samplepcb-web-mono-app/apps/web/package.json) · [vite.config.ts](../../samplepcb-web-mono-app/apps/web/vite.config.ts) · [src/i18n/index.ts](../../samplepcb-web-mono-app/apps/web/src/i18n/index.ts)
- [src/admin/menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/menu.ts) · [develop-menu.ts](../../samplepcb-web-mono-app/apps/web/src/admin/develop-menu.ts) · [pcb-navigation.ts](../../samplepcb-web-mono-app/apps/web/src/admin/pcb-navigation.ts) · [develop-navigation.ts](../../samplepcb-web-mono-app/apps/web/src/admin/develop-navigation.ts) · [smartbom.ts](../../samplepcb-web-mono-app/apps/web/src/admin/smartbom.ts) · [useRowSelection.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useRowSelection.ts) · [useAdminDigikey.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminDigikey.ts) · [useAdminParts.ts](../../samplepcb-web-mono-app/apps/web/src/admin/useAdminParts.ts)
- [src/partner/menu.ts](../../samplepcb-web-mono-app/apps/web/src/partner/menu.ts) · [partnerModule.ts](../../samplepcb-web-mono-app/apps/web/src/partner/partnerModule.ts) · [i18n.ts](../../samplepcb-web-mono-app/apps/web/src/partner/i18n.ts) · [i18n-core.ts](../../samplepcb-web-mono-app/apps/web/src/partner/i18n-core.ts) · [usePartnerWork.ts](../../samplepcb-web-mono-app/apps/web/src/partner/usePartnerWork.ts) · [usePartnerAccess.ts](../../samplepcb-web-mono-app/apps/web/src/partner/usePartnerAccess.ts) · [useRouteTab.ts](../../samplepcb-web-mono-app/apps/web/src/partner/useRouteTab.ts)
- [src/layouts/AdminLayout.vue](../../samplepcb-web-mono-app/apps/web/src/layouts/AdminLayout.vue) · [PartnerLayout.vue](../../samplepcb-web-mono-app/apps/web/src/layouts/PartnerLayout.vue) · [DefaultLayout.vue](../../samplepcb-web-mono-app/apps/web/src/layouts/DefaultLayout.vue) · [BomLayout.vue](../../samplepcb-web-mono-app/apps/web/src/layouts/BomLayout.vue)
- [src/pages/partner/PartnerEntry.vue](../../samplepcb-web-mono-app/apps/web/src/pages/partner/PartnerEntry.vue) · [src/pages/admin/AdminDashboard.vue](../../samplepcb-web-mono-app/apps/web/src/pages/admin/AdminDashboard.vue) · [AdminSmartbomLogistics.vue](../../samplepcb-web-mono-app/apps/web/src/pages/admin/AdminSmartbomLogistics.vue) · [AdminParts.vue](../../samplepcb-web-mono-app/apps/web/src/pages/admin/AdminParts.vue) · [src/pages/bom/BomQuote.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomQuote.vue) · [BomSearch.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomSearch.vue) · [BomHistory.vue](../../samplepcb-web-mono-app/apps/web/src/pages/bom/BomHistory.vue)
- [src/components/ui/UiConfirmHost.vue](../../samplepcb-web-mono-app/apps/web/src/components/ui/UiConfirmHost.vue) · [src/lib/confirmDialog.ts](../../samplepcb-web-mono-app/apps/web/src/lib/confirmDialog.ts) · [route-ids.ts](../../samplepcb-web-mono-app/apps/web/src/lib/route-ids.ts) · [usePrintIsolation.ts](../../samplepcb-web-mono-app/apps/web/src/lib/usePrintIsolation.ts) · [pcb-spec.ts](../../samplepcb-web-mono-app/apps/web/src/lib/pcb-spec.ts) · [src/bom/useTheme.ts](../../samplepcb-web-mono-app/apps/web/src/bom/useTheme.ts) · [extraction-display.ts](../../samplepcb-web-mono-app/apps/web/src/bom/extraction-display.ts)
- [src/components/AppThemeToggle.vue](../../samplepcb-web-mono-app/apps/web/src/components/AppThemeToggle.vue) · [AppProfileMenu.vue](../../samplepcb-web-mono-app/apps/web/src/components/AppProfileMenu.vue) · [partner/PartnerPageHeader.vue](../../samplepcb-web-mono-app/apps/web/src/components/partner/PartnerPageHeader.vue) · [partner/PartnerWorkqueueTabs.vue](../../samplepcb-web-mono-app/apps/web/src/components/partner/PartnerWorkqueueTabs.vue)
- [src/components/admin/SettingsTabs.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/SettingsTabs.vue) · [AiSettingsForm.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/AiSettingsForm.vue) · [OrderStatusStepper.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/OrderStatusStepper.vue) · [BomQuoteSettingsForm.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/BomQuoteSettingsForm.vue) · [EstimateSendControl.vue](../../samplepcb-web-mono-app/apps/web/src/components/admin/EstimateSendControl.vue)
- [src/components/bom/BomCandidateDrawer.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomCandidateDrawer.vue) · [BomQuoteRow.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomQuoteRow.vue) · [BomPartOfferOptions.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartOfferOptions.vue) · [BomPartSearchPanel.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartSearchPanel.vue) · [BomQuoteOfferModal.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomQuoteOfferModal.vue) · [BomPriceBreaks.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPriceBreaks.vue) · [BomPartSearchNotice.vue](../../samplepcb-web-mono-app/apps/web/src/components/bom/BomPartSearchNotice.vue)
- [src/i18n/locales/ko.ts](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/ko.ts) · [en.ts](../../samplepcb-web-mono-app/apps/web/src/i18n/locales/en.ts) — 모듈 라벨(통합·PCB·BOM·개발·마켓)·`bomSearchTrace`·`admin.mailLogs.kind`
- git log `--since=2026-07-27 -- apps/web`(322커밋, 마지막 2026-09-18) 및 커밋 c2708fc8a(메뉴 정리)·ad992497b(PCB 작업 위치 복원)·239f06487(수량 누락)·59a232e85(검색 후보 확정)
