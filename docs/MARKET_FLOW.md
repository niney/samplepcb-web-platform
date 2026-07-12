# MARKET_FLOW — PCB 재능마켓 (sp-market)

재능마켓(회로개발·PCB설계 전문가 ↔ 의뢰인 매칭)의 **단일 설명원본**. 1차(매칭까지) 구현 기준이며,
근거 기획은 `D:\work\workspace_other\samplepcb-market-prototype`(2026 HTML 프로토타입)와 2021 PPTX 2건.
브랜치 `feat/market-mvp` (2026-07-08).

## 1. 범위

- **1차(구현됨) = 매칭까지**: 전문가 등록(개인/기업)·관리자 승인 → 프로젝트 의뢰(역견적=공개
  블라인드 입찰 / 지정견적=1:1) → NDA 게이트 첨부 → 블라인드 견적 제출·비교·**채택**.
- **2차(구현됨, 2026-07-08) = 거래 완결**: 채택 시 계약(`sp_market_contract`) 자동 생성 →
  **영카트 주문 재사용 결제**(앵커 상품 스냅샷 카트행 — 거버 담기와 동형) → 작업 납품
  (산출물 업로드) → 검수(수동 확정 + **7일 자동확정**) → 관리자 정산(전문가측 수수료 공제). §8.
- **3차 후보**: 1:1 메시지룸, 인앱 알림, 알림톡(iwinv 템플릿 등록 후), 리뷰·평점, 제조·양산
  연계 페이지, SEO(프리렌더), `market.samplepcb.co.kr` 301.

## 2. 아키텍처

```
local-web.samplepcb.co.kr (nginx 443)
├─ /api/    → :3333  sp-node   routes/market-*.ts · admin-market-*.ts (6파일)
├─ /app/    → :5173  sp-vue    /app/admin/market/{experts,projects,settings}
├─ /market/ → :5176  sp-market apps/market (Vue3+Vite, strictPort — 드리프트 금지)
└─ /        → :8888  sp-php    로그인·회원(인증 브리지 /spcb/api/me)
```

- 인증: 기존 브리지 무수정 재사용(`@sp/shared` `useAuthStore.bootstrap()`). 비로그인 액션은
  `/bbs/login.php?url=<returnPath>` 왕복(`apps/market/src/lib/auth-urls.ts`).
- 역할: 별도 테이블 없음 — **전문가 = `sp_market_expert.status='approved'` 행 보유 회원**,
  관리자 = JWT `isAdmin`(cf_admin 1인). 한 회원이 의뢰인 겸 전문가 가능.
- **라이브 nginx 반영 완료(2026-07-08)**: `D:\nginx\conf\nginx.conf` 통합 호스트에
  `location /market/`(→5176, X-Forwarded-Proto 포함) 추가됨. 라이브 nginx 는 Windows
  서비스('nginx')라 `-s reload` 신호가 Access denied — 변경 시 관리자
  `net stop nginx & net start nginx`(순단 ~1초).

## 3. 데이터 모델 (Prisma `sp_market_*` 5테이블, 2026-07-08 마이그레이션)

| 테이블 | 역할 | 핵심 |
|---|---|---|
| `sp_market_expert` | 전문가 프로필 | mbId unique · expertType `individual\|company\|house` · 승인 워크플로(status/statusReason/decidedBy/decidedAt) · 정산계좌(2차 대비) |
| `sp_market_project` | 의뢰 | method `open\|targeted`(+targetExpertId) · bidDeadlineAt(**lazy 마감** — 저장 전이 없음) · status `bidding\|closed\|awarded\|cancelled`(2차 예약 working/completed) · awardedBidId · `specialties`(세부분야, Prisma `categories`)·`cadTools`(요구 툴, 빈 배열=무관) |
| `sp_market_bid` | 입찰 | **unique(projectId, expertId)** = 전문가당 1입찰(재제출=같은 행) · amount 원 단위 Int · status `submitted\|awarded\|rejected\|withdrawn` |
| `sp_market_nda_sign` | NDA 전자서명 | unique(projectId, mbId) · textVersion(문구 원문은 계약 상수) · signedName·ip 감사 스냅샷 |
| `sp_market_settings` | 설정 싱글턴(id=1) | feeRateBp(기본 1000=10%) — GET 폴백/PATCH upsert, 시드 불요 |
| `sp_market_contract` | 계약(2차) | **projectId unique**(프로젝트당 1건) · amount=채택 입찰액(VAT 포함 총액) · **feeRateBp/fee/payout 채택 시점 스냅샷** · **contractKey**(uuid=영카트 io_id·주문 라인 식별) · ctId(카트행, 재주입 시 갱신) · status `pending\|paid\|delivered\|completed\|settled\|cancelled` · hold(자동확정 정지)·검수·정산·취소 감사 필드 |

- **첨부·증빙은 `sp_file` 폴리모픽 재사용**: refType `'sp_market_project'`(attachment) /
  `'sp_market_expert'`(license·portfolio·bizreg). pathToken 비노출·`uploadedBy`에 mbId 금지
  (varchar(20)) 불변식 유지. 파일서버 serviceType은 env `MARKET_FILE_SERVICE_TYPE`(기본 `market`).
- 프로젝트 분류는 `requestType`(시스템 통합 개발/개별 분야 개발)과 복수
  `serviceAreas`(회로·PCB·펌웨어·제품디자인·기구설계·앱·서버·Linux/Windows 소프트웨어·기타)로
  분리한다. 전문가도 같은 `serviceAreas`를 보유해 검색·매칭 기준을 공유하며, 세부분야
  18종(`categories`)과 툴 역량은 별도 축으로 유지한다.
- **의뢰 STEP2 "전문 기술·도구"는 분야 종속 동적 스텝**: 분야→질문 그룹 사전
  (`MARKET_AREA_TOOL_GROUPS`: circuit/pcb→ecad, 기구→mcad, 제품디자인→design ·
  `MARKET_AREA_SPECIALTIES`: circuit/firmware→세부분야 부분집합)의 **합집합**으로 섹션을
  구성하고, 질문 그룹이 없는 분야(앱·서버·SW·기타)만 선택하면 스텝 자체가 목록에서
  빠진다(4스텝). 프로젝트 `categories`는 물리 컬럼 `specialties`(Prisma `@map` — 인접
  `category`=requestType 물리명과 혼동 회피)에 저장.
- **AI 시스템 구성도**: 위저드 "설명·자료" 뒤 동적 스텝(관리자 활성 시) — Ollama 로 단일
  HTML 구성도를 생성해 `diagramHtml`(sandbox iframe 렌더 전용)에 저장. 정본
  **docs/AI_DIAGRAM.md**(범용 AI 유스케이스 계층·프로빙 확정 프롬프트·운영).
- 툴 코드는 ECAD·MCAD·디자인 통합 flat 배열(`MARKET_TOOL_CODES`) — DB/계약 필드명은
  `cadTools` 그대로(호환), 그룹 해석은 `MARKET_TOOL_GROUP_CODES` 로 UI/매칭 단계에서 한다.
  **빈 배열 = 특정 툴 요구 없음**. 구 `'any'` 코드는 레거시 데이터 호환용으로만 enum 잔존
  (마이그레이션 백필 `['any']→[]` + 읽기 정규화 보험). `categories` 의 `firmware`·`software`
  코드는 serviceArea 와 동어반복이라 신규 선택 UI 에서 숨김(`MARKET_ACTIVE_CATEGORIES`).
- 코드 사전(서비스 영역·세부분야 18종·툴·예산/경력/지역/이동거리 구간)과 **한글 라벨의 정본은
  `packages/api-contract/src/schemas/market.ts`** (`MARKET_*`, `MARKET_*_LABELS`) — sp-market·
  sp-vue·sp-node 메일 빌더 3곳이 공유. DB에는 코드만 저장(Json 배열).
- 마이그레이션 규율 준수: 수기 CREATE → `prisma migrate deploy` → `generate`
  (`migrate dev`/`reset` 절대 금지 — 공유 DB).

## 4. 상태 머신

**마감 원칙**: cron 없음. `biddingClosed = status=='bidding' && now>=bidDeadlineAt` 를 읽기
응답과 쓰기 가드가 같은 식으로 판정(`apps/api/src/lib/market.ts isBiddingClosed`).
`closed` 저장값은 소유자 조기 마감 전용.

- expert: `(등록)→pending → approved | rejected(사유)` · `rejected --수정 재제출--> pending` ·
  `approved ↔ suspended`(관리자, 사유). **approved 프로필 수정(재승인)은 2차** — 1차는
  pending/rejected 만 수정 가능.
- project: `(등록)→bidding → closed(소유자 조기 마감) | awarded(채택) | cancelled`.
  채택 = 트랜잭션(project 조건부 updateMany[bidding|closed & 미채택] + bid[submitted] 조건부 +
  나머지 submitted→rejected). **unaward 없음** — 협의 결렬은 cancel.
- bid: `submitted ↔(재제출/철회) withdrawn`, 채택 트랜잭션이 `awarded|rejected` 종결.
  철회·채택 레이스는 조건부 updateMany(0건=409)가 방어.
- **contract(2차)**: `(채택 tx)→pending → paid → delivered → completed → settled`, +`cancelled`.
  - **paid 승격 = cron 없는 lazy write-back**: 계약을 읽거나 전이 가드를 대는 모든 지점에서
    `ensureContractLazy`(lib/market-contract.ts) 선행 — **라인 검증**(자기 카트행 ct_status ∈
    PAID_ORDER_STATUSES ∧ io_id==contractKey ∧ io_price==amount)으로 판정('부분취소'는
    od_status 값이 아니라 행 단위 취소이므로 od 헤더만 보면 오판). 승격 시 project
    awarded→working. 단방향 래칫(이후 od 역행해도 paid 유지 — 관리자 드로어가 od 파생
    상태를 상시 표시해 괴리 가시화). 무통장 미입금(od '주문')은 미승격 = 입금 대기 안내.
  - **자동확정**: delivered ∧ hold 없음 ∧ deliveredAt+7일 경과 → completed(confirmedBy='auto',
    **completedAt=deliveredAt+7d 파생값**). 승격 지점 = 당사자 조회 + 관리자 계약 목록의
    탭 무관 스윕. 관리자 hold/unhold 로 정지 가능(해제 시 기한 경과면 다음 조회에서 즉시 확정).
  - 취소: pending 만 의뢰인 취소(+project cancelled + **카트행·옵션행 정리** — 잔존 '쇼핑'
    행은 코어 buy 경로로 취소된 계약을 결제할 수 있는 구멍). paid 이후는 관리자 운영 취소만
    (환불 실행은 주문 관리/PG 도메인 — 기록만). project cancel 은 계약 paid+ 면 409 CONTRACT_ACTIVE.
  - checkout 멱등: 주입 전 io_id 단위 '쇼핑' 행 청소 + 기존 ctId 분해(쇼핑∧내 버킷=재사용 /
    버킷 불일치·행 소멸·주문 취소/삭제=재주입 / od '주문'=409 ORDER_PENDING / 결제 라인=409
    ALREADY_PAID). JWT cartId 클레임 필수(me.php 브리지 — checkout 직전 FE 가 bootstrap 재발급).

## 5. 접근 제어 (서버 강제 — UI 숨김은 보안 아님)

| 관점 | 규칙 |
|---|---|
| 블라인드 | 공개=bidCount 만 · 전문가=자기 입찰만(`my-bid`) · 소유자=`/:id/bids` 전체 · 관리자=admin 표면. **타인 입찰을 주는 엔드포인트 자체가 없음** |
| 마스킹 | 의뢰인 표시명은 서버가 `maskName`(@sp/utils) 적용 — 원명·mbId 는 공개 응답에 부재. 전문가 displayName 은 비마스킹(프로필 공개 동의 — 약관 명문) |
| NDA 메타 | ndaRequired && 미서명(소유자·관리자 제외) → 첨부 **개수만**(파일명도 기밀 힌트) |
| 첨부 다운로드 | 소유자 ∨ 관리자 ∨ (승인 전문가 ∧ (targeted→지정자) ∧ (접수 중 ∨ 채택 전문가) ∧ (NDA 불요 ∨ 서명)). 프록시 스트림 = 게이트 실집행점 |
| NDA 서명 자격 | 다운로드 자격 전문가와 동일 집합 + 채택 전문가는 마감 후에도 서명 가능(작업 열람 데드락 방지) |
| 입찰 가드 사슬 | 승인 전문가 → 자기 프로젝트 금지 → targeted 지정자만 → lazy 마감 → unique 중복(409 ALREADY_BID→PATCH 유도) |
| 소유자 수정 | 입찰 0건(≠withdrawn) && 접수 중일 때만(method·지정 대상 변경 불허) |
| 연락처·계좌 | 본인·관리자 외 어떤 응답에도 부재(채택 전 직거래 차단 — 연락 개시는 2차 계약/메시지) |

에러 봉투: 회원 라우트 `{result:false,error:'CODE'}`(pcb-projects 관례) · 관리자 라우트
`ApiError{error,message}` 선언형. FE 는 `@sp/shared` 가 두 형태를 정규화(`ApiMemberError`),
코드→메시지 맵은 `apps/market/src/lib/error-msg.ts` 단일 소스.

## 6. API·화면 지도

| 영역 | 위치 |
|---|---|
| 회원 라우트 | `apps/api/src/routes/market-{experts,projects,bids}.ts` (prefix `/api`) |
| 관리자 라우트 | `apps/api/src/routes/admin-market-{experts,projects,settings}.ts` (prefix `/api/admin`, requireAdmin addHook) + `GET /api/admin/market/files/:fileId` |
| 공용 헬퍼 | `apps/api/src/lib/market.ts`(asXxx 내로잉·lazy 마감·마감 계산 KST 23:59:59·sp_file 조각·multipart 수집) |
| 계약 | `packages/api-contract/src/schemas/market.ts` + `routes.ts` apiRoutes 10종 |
| 소비자 화면 | `apps/market/src/pages/{Home,Projects,ProjectDetail,Experts,ExpertDetail,RequestWizard,ExpertRegister,Me}.vue` |
| 관리자 화면 | `apps/web/src/pages/admin/AdminMarket{Experts,Projects,Settings}.vue` + `admin/useAdminMarket.ts` |

## 7. 알림 (1차 = 메일 4종, 비차단)

`apps/api/src/lib/market-email.ts`(estimate-email 매체 원칙 미러: table+inline style·esc()) —
①지정견적 요청→지정 전문가 ②새 입찰→의뢰인(블라인드 예외라 금액 안내) ③채택→전문가
④승인/반려→신청자. 수신 주소는 `getMembersByIds().email`(카탈로그 확장 없음). 실패는 로그만
(액션 성패와 독립). 로컬 검증 = Mailpit(127.0.0.1:25 → http://localhost:8025).
**알림톡은 2차** — iwinv templateCode 사전 심사가 릴리즈를 블로킹(lib/alimtalk.ts 선례).

## 8. 2차 결제·검수·정산 (구현됨 2026-07-08)

- **결제 = 영카트 재사용**: 앵커 상품 `sp-market-svc` 1종(`seed-market-anchor-item.ts` —
  **it_price=0**(코어 before_check_cart_price 통과 조건)·**it_sc_type=1 무료배송 명시**(기본 0은
  "쇼핑몰 기본 배송정책"이라 차등 배송비가 붙음)·ca_id='10' 노출 억제·과세). checkout 이
  `insertQuoteOption(contractKey, amount)`+`insertCartRow{io_id=contractKey, io_price=amount,
  ct_price=0, ct_qty=1}` 주입 → `ct_select` 선택 → `/shop/orderform.php` 직행. 주문 후
  `cart.od_id` 가 실주문번호로 덮어써져 계약↔주문은 ctId 파생 조인(`getOrderInfoByCtId`).
- **PHP 이원 렌더 union**: 주문서(pc/mobile orderform.sub.php)·주문메일(ordermail1.inc.php)의
  일반 상품(GROUP BY) 제외 목록과 건별(ct_id) 렌더 포함 목록을 `sp_custom_row_it_ids_in()`
  (= sp_quote 4종 ∪ sp-market-svc, extend/sp_quote_cart.extend.php ⑥) **같은 union** 으로.
  **sp_quote 목록에 합치지 않음** — 테마 cart.php 견적 카드·JS enrich 가 sp_quote 를 소비해
  계약 행이 들어가면 파손. 테마 cart.php 는 마켓 행에 "재능마켓 계약" 배지 + [선택사항수정]
  숨김(코어 optionmod 의 it_id 전삭제 트랩) + 수량 표시 생략.
- 수수료 정책(확정): **전문가측 10% 단일 공제**(크몽식), 총액(VAT 포함) 기준. 요율은
  `sp_market_settings.feeRateBp`, 계약 생성 시 스냅샷(설정 변경과 절연). 실수령 =
  amount − round(amount×bp/10000).
- 알림 메일 4종 추가(비차단, 전이 updateMany count==1 게이트 뒤 — lazy 승격 동시 조회의
  중복 발송 방지): 결제 확인→전문가 / 납품(+7일 자동확정 고지)→의뢰인 / 검수 확정→전문가 /
  정산 완료→전문가.
- 산출물 = sp_file 재사용(refType `'sp_market_contract'`, fileType `'deliverable'`) — 전문가
  업로드(완료 보고 multipart: 평문 `note` + `deliverable` 파일들), 다운로드는 당사자·관리자
  인증 프록시.
- 화면: 소비자 `ContractCard`(거래 스텝·역할별 액션, ProjectDetail 사이드바 최상단 분기) +
  `/app/admin/market/contracts`(탭 counts·드로어=od 파생 결제 상시·계좌·hold/settle/운영취소).
- **알려진 제약**: 한 카트에 계약 2건 이상 동시 담김 시 cart.php·주문메일의 일반 분기가
  같은 앵커 it_id 로 병합 표시(주문서는 union 건별이라 정상, 데이터는 행별 io_id/io_price 로
  정확 — 결제·승격 무영향). 검증 스크립트가 g5_shop_order 를 직접 다룰 땐 od_id 를 **2^53
  미만 대역**으로(9e15 대역은 mysql2 number 정밀도 손실 — E2E 실측 함정).

## 9. 운영 절차·환경

- 시드: `pnpm --filter api run market:seed`(당사 전문가, 멱등) + **2차
  `market:seed-anchor`**(앵커 상품 sp-market-svc, 멱등 — 미시드면 checkout 503
  ANCHOR_ITEM_MISSING). 로컬 실행 완료.
- env(apps/api/.env): 기존 JWT_SECRET·SMTP_*·FILE_SERVER_URL 재사용 +
  `MARKET_FILE_SERVICE_TYPE`(선택, 기본 `market`) — **파일서버가 신규 serviceType 을 받는지
  운영 전 1회 실측 필요**(테스트 'demo' 선례상 가능 추정).
- dev: `pnpm --filter market dev`(5176, strictPort — 점유 시 실패가 정상 신호),
  api(3333)·web(5173)과 병행. 통합 확인은 local-web(라이브 nginx 반영 후).
- **E2E 회귀**: `ops/scripts/e2e-market.mts` — 1차 매칭 36 + **2차 거래 56 = 총 92항목**
  (STEP2 확장 세부분야·빈 요구 툴·레거시 `['any']` 정규화 + AI 구성도 diagramHtml 왕복, 2026-07-12)
  (§4·§5·§8의 실행 가능한 명세 — 계약 생성 스냅샷·checkout DB 실증·주문 결제 시뮬→lazy
  승격·hold/자동확정·confirm/settle·취소 카트 정리·재주입). api 가동 상태에서
  `pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run`
  → 확인 후 같은 명령 `cleanup`(계약·카트행·옵션행·시뮬 주문·파일서버 실파일까지 정리).
  실존 회원 3명을 임시 주체로 쓰며 메일은 Mailpit 이 가로챈다.
- **실브라우저 검증 완료(2026-07-08)**: 결제하기→orderform(계약 1행·배송비 0·과세 분리)→
  무통장 실주문→`/app/admin/orders` 입금 처리→조회만으로 working 승격→납품→검수 확정→
  `/app/admin/market/contracts` 정산 기록까지 전 구간 실측(픽스처 생성·정리 스크립트로 원복).
- 문구 정책(1차): 도메인 라벨은 계약 `MARKET_*_LABELS` 정본, 화면 고유 카피는 마켓·관리자
  화면에서 ko 인라인(다국어(en) 도입 시 i18n 이관 — 모노레포 AGENTS "라벨 i18n" 원칙의
  1차 한정 예외).

## 10. 남은 것 / 알려진 제약

- [x] 라이브 nginx `location /market/` 반영(§2) — 2026-07-08 완료(서비스 재시작으로 적용,
      같은 도메인 PHPSESSID 자동 로그인까지 실브라우저 확인).
- [ ] 파일서버 serviceType `market` 수용 실측(§9) — 운영 전 1회.
- [ ] 운영 빌드 static 블록(ops/nginx 주석) 전환 시 `pnpm --filter market build` 산출물 경로 확인.
- **subtree pull 재적용 목록(2차 추가)**: `shop/orderform.sub.php`·`mobile/shop/orderform.sub.php`·
  `shop/ordermail1.inc.php` — 코어 기수정 파일에 sp_custom_row_it_ids_in() union 커스텀
  (extend·테마 파일은 subtree 무관).
- 조회수 dedup 없음(참고 지표) · 입찰 수정 감사 이력은 updatedAt 만 · 본인인증은 관리자
  수동 체크(identityVerified) — 실인증 연동 후속.
- 3차 후보(§1)에 추가: 계약 카트행의 cart.php 딥링크(현재 상품 링크 유지), 재사용 카트행의
  옵션 행 소실 시 자동 복구(현재는 사용자 행 삭제 후 재결제 경로로 해소).
- 위키 재컴파일(`/wiki-compile`) 권장 — sp-node-api·sp-vue-web·infrastructure 토픽에 마켓 반영.
