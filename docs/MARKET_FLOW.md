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

## 3. 데이터 모델 (Prisma `sp_market_*` 7테이블 — 2026-07-08 5종 + 계약 + 수정 이력)

| 테이블 | 역할 | 핵심 |
|---|---|---|
| `sp_market_expert` | 전문가 프로필 | mbId unique · expertType `individual\|company\|house` · 승인 워크플로(status/statusReason/decidedBy/decidedAt) · 정산계좌(2차 대비) |
| `sp_market_project` | 의뢰 | method `open\|targeted`(+targetExpertId) · bidDeadlineAt(**lazy 마감** — 저장 전이 없음) · status `bidding\|closed\|awarded\|cancelled`(2차 예약 working/completed) · awardedBidId · `specialties`(세부분야, Prisma `categories`)·`cadTools`(요구 툴, 빈 배열=무관) |
| `sp_market_bid` | 입찰 | **unique(projectId, expertId)** = 전문가당 1입찰(재제출=같은 행) · amount 원 단위 Int · status `submitted\|awarded\|rejected\|withdrawn` |
| `sp_market_nda_sign` | NDA 전자서명 | unique(projectId, mbId) · textVersion(문구 원문은 계약 상수) · signedName·ip 감사 스냅샷 |
| `sp_market_settings` | 설정 싱글턴(id=1) | feeRateBp(기본 1000=10%) — GET 폴백/PATCH upsert, 시드 불요 |
| `sp_market_project_revision` | 의뢰 수정 이력(2026-09-05) | unique(projectId, revNo) · `snapshot`=수정 **직전** 값 한 덩어리 · `changedFields`·`major`(중대 = 견적 전제가 달라짐) — §11 |
| `sp_market_contract` | 계약(2차) | **projectId unique**(프로젝트당 1건) · amount=채택 입찰액(VAT 포함 총액) · **feeRateBp/fee/payout 채택 시점 스냅샷** · **contractKey**(uuid=영카트 io_id·주문 라인 식별) · ctId(카트행, 재주입 시 갱신) · status `pending\|paid\|delivered\|completed\|settled\|cancelled` · hold(자동확정 정지)·검수·정산·취소 감사 필드 |

- **첨부·증빙은 `sp_file` 폴리모픽 재사용**: refType `'sp_market_project'`(attachment) /
  `'sp_market_expert'`(license·portfolio·bizreg). pathToken 비노출·`uploadedBy`에 mbId 금지
  (varchar(20)) 불변식 유지. 파일서버 serviceType은 env `MARKET_FILE_SERVICE_TYPE`(기본 `market`).
- 프로젝트 분류는 복수 `serviceAreas` — **2026-09-04 v3: 분야 레지스트리 5종**(회로·PCB·펌웨어·앱·서버, `packages/api-contract/src/schemas/market-areas.ts` 정본, docs/AI_DEV_REVIEW.md §13). 분야 코드는 문자열 + 레지스트리 검증(빠진 분야는 라벨 "(종료)"). `requestType` 은 서버 파생값(2개 이상=`system`). 표기는 `marketAreaBadge`(1개=분야명, 2~4개="회로 + PCB", 5개="풀 개발(…)"). 세부분야(`categories`)·CAD 툴(`cadTools`) 축은 폐기되고 **분야별 희망 툴·언어 `tools {byArea}`**(빈 분야 = 전문가 추천)로 바뀌었다 — 전문가도 같은 모양.
- **의뢰 위저드 v5(2026-09-04) = 3스텝**(docs/AI_DEV_REVIEW.md §13.4): ① 의뢰 내용(분야 카드 5개 + "잘 모르겠어요 — 전부 맡길게요"(=5종) · 제목 · 설명 · 참고 자료 · AI 동의) ② 몇 가지만 더(**프로젝트 공통 조건 6 필수**[예산·완료 시점·목표 단계·견적 방식·인도 범위·NDA, §13.8] + 공통 질문 3 + 선택 분야마다 [맞춤 질문 2~3(풀 개발이면 2) · 희망 툴·언어(전문가 추천 기본) · 추가자료 슬롯 → `sp_file.area/slot`]) ③ 검토·등록(AI 사전 검토서 + 견적 마감). 조건 3 미응답은 등록 400 `ANSWERS_REQUIRED`. 답변은 `answers` 컬럼(`MarketAnswers`). 등록 뒤 **정밀 시스템 구성도**(kimi-k3 thinking high, 비동기 큐)가 `devDiagram`·`devDiagramHtml` 에 붙고 의뢰인에게 메일(§13.5).
- **AI 사전 검토서(단일 산출물)** — 정본 **docs/AI_DEV_REVIEW.md**. 옛 4산출물(구성도 HTML·
  구성 명세·작업검토지시서·분야별 카드)·80문항 인터뷰·선분석·provenance 체계는 폐기(`docs/
  AI_DIAGRAM.md` 는 경위 기록). 검토서는 `sp_market_project.devReview`(JSON) 하나에 저장되고
  공개 범위는 description 과 동일(상세를 볼 수 있는 뷰어 전원). 4문항 답변은
  `interviewAnswers` 컬럼 재사용(`DevReviewActiveAnswers`, 저장 검토서 brief 는 옛 코드도 파싱).
  - 파이프라인 2단: 첨부 판독(비전 모델, 이미지·PDF 미리보기가 있을 때만) → 검토서(주모델,
    텍스트 전용) → 서버 후처리(근거 없는 항목·자료에 없는 수치·품번 **삭제**, 상의 항목 ≤6) →
    `sp_ai_job`(DB) 저장. `POST /api/ai/market.dev-review/run`(multipart) → `GET /api/ai/jobs/:id`
    폴링(`stage: attachments|review`).
  - 등록은 `devReviewJobId` 만 보낸다 — 서버가 자기 저장분을 소유자·완료·유스케이스·입력 해시
    (제목·분야·설명·답변·첨부 원본 SHA-256 앞 10개)까지 대조한 뒤 박제. 불일치 400
    `REVIEW_STALE`, 타인·미완료 잡 400 `REVIEW_JOB_INVALID`. 클라이언트는 산출물 본문을 보내지
    않으므로 해시 대조·"고객 수정본" 라벨 체계가 없다.
  - ~~검토서와 원천은 항상 일치한다는 불변식(409 `DEV_REVIEW_ATTACHED`)~~ → **2026-09-05 폐지**:
    원천을 바꿔도 검토서를 떼지 않고 `devReviewStale` 배지로 "수정 전 내용으로 만든 것"임을 알린다(§11).
  - **v2(2026-09-02) 는 확정만** — 항목 상태 축 없음, 정해지지 않은 것은 "전문가와 상의할 항목"
    한 목록(≤6). 섹션 = 고객 의뢰내용 · 제안 시스템 구성도(입력→메인 보드→출력·연동 3열 카드,
    `renderDevReviewDiagramHtml`) · 기술개발 검토 결과(분야별 준비 상태 확정 n·상담 m + 검토 관찰 + 답변↔자료 정합 R9, docs/AI_DEV_REVIEW.md §12.10) · 개발명세서(확정 행만).
    (작업 항목·개발 단계 섹션은 09-03 제거 — 정적 안내.) 판정어·리스크 등급·금액·주수는 없다(기간은 전문가 입찰
    `durationDays`). 프롬프트는 코드 정본(`dev-review.v2.1`), 관리자는 사용 토글·모델·첨부 판독
    모델·추가 지침·샘플 테스트·실행 이력만 만진다. v1 저장분은 파싱 실패 → 검토서 없음.
  - 계약 채택 스냅샷(`sp_market_contract.requestSnapshot`)에는 `devReview` 가 들어간다(옛 스냅샷은
    zod strip 으로 계속 파싱).
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
| 입찰 가드 사슬 | 승인 전문가 → 자기 프로젝트 금지 → targeted 지정자만 → lazy 마감(전체서비스 회사 전용 가드는 2026-08-28 폐지) → unique 중복(409 ALREADY_BID→PATCH 유도) |
| 소유자 수정 | **접수 중(bidding ∧ 마감 전)이면 입찰이 있어도 가능**(method·지정 대상만 변경 불허). 마감·채택·취소 뒤는 409 `NOT_EDITABLE` — §11 참조 |
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
| 소비자 화면 | `apps/market/src/pages/{Home,Projects,ProjectDetail,Experts,ExpertDetail,RequestWizard,ExpertRegister,Me}.vue` — 의뢰 위저드 v5(3스텝)는 `components/request/Step{Describe,Details,Review}.vue·QuestionField.vue` + `composables/useRequestWizardForm.ts`·`useDevReviewJob.ts` + `components/dev-review/DevReviewView.vue` |
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
  (STEP2 확장 세부분야·빈 요구 툴·레거시 `['any']` 정규화, 2026-07-12 + **AI 사전 검토서 11케이스**(잡 시드·REVIEW_STALE·REVIEW_JOB_INVALID·DEV_REVIEW_ATTACHED·requestType 파생·개인 입찰 200, 2026-08-28 — 총 101항목))
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

## 11. 의뢰 수정·버전 (2026-09-05)

의뢰를 등록한 뒤에도 고칠 수 있다. 옛 규칙(**입찰 1건이라도 있으면 잠금**)은 오타 하나도 못 고치게 만들었고,
검토서가 붙어 있으면 원천 수정을 아예 막았다(`DEV_REVIEW_ATTACHED`). 둘 다 폐지하고, 대신 **수정 직전 값을
남기고 바뀌었음을 상대에게 보이게** 한다.

### 11.1 규칙

| 축 | 결정 |
|---|---|
| 수정 창 | `bidding ∧ 마감 전` 이면 **입찰 유무 무관**하게 수정 가능. 마감·채택·취소 뒤는 409 `NOT_EDITABLE`(그 뒤 원천이 바뀌면 계약 분쟁) |
| 수정 대상 | 제목 · 개발 분야 · 희망 툴 · 설명 · **답변**(신규 — 옛 계약엔 없어 조건을 못 고쳤다) · 예산 · NDA · 마감 · 첨부. `method`·지정 대상은 불변(입찰 자격의 근거) |
| 이력 | 수정 한 번 = `sp_market_project_revision` 한 행(append-only). `snapshot` = **수정 직전** 값 한 덩어리(필드가 늘어도 스키마 불변, 되돌리기 여지). 바뀐 값이 없으면 행을 만들지 않는다 |
| 중대/사소 | **중대** = 분야·설명·답변·마감·첨부(이미 낸 견적의 전제가 달라진다) → 입찰자 경고 + 마감 자동 연장 대상. **사소** = 제목·툴·예산·NDA → 이력에만 남는다(배너 남발 방지) |
| 마감 자동 연장 | 중대한 수정인데 남은 시간이 **24시간 미만**이면 마감을 **48시간 뒤**로 민다(`MARKET_REVISION_DEADLINE_*`). 소유자 선택이 아니라 규칙 — 입찰자가 견적을 고칠 시간을 남긴다 |
| 검토서 | 원천이 바뀌어도 **지우지 않는다**. `devReviewStale`(검토서 생성 뒤 제목·분야·설명·답변·첨부가 바뀌었나)로 "수정 전 내용으로 만든 검토서" 배지만 세운다. 제거는 여전히 소유자 선택(`devReview:null`) |
| 첨부 | 추가·삭제는 즉시 반영(파일서버 왕복이라 저장 버튼과 트랜잭션 경계가 다르다) — 각각 자기 revision 을 남긴다. 이력에는 **개수 변화만** 담는다(파일명은 NDA 게이트 뒤 정보) |
| 되돌리기 | 1차 범위 밖. 되돌린 것도 또 하나의 수정이라 스냅샷만 쌓아 두면 나중에 붙일 수 있다 |

### 11.2 "바뀌었다" 를 알리는 법 (알림 기능 없이)

판정은 하나뿐이다: **내 견적 `updatedAt`(재제출 최종 시각) < 마지막 중대 revision `createdAt`**.

- 상세 헤더 배지 `수정됨 v3 · 9/4` → 누르면 이력 섹션으로.
- 입찰자 전용 경고 배너(`viewer.myBidOutdated`) — "견적을 내신 뒤 의뢰 내용이 바뀌었습니다" + [바뀐 내용 보기] [견적 수정].
  견적을 다시 내면(재제출 = 같은 행 수정) `updatedAt` 이 앞서므로 경고가 스스로 사라진다.
- 내 견적 목록 배지(`projectRevisedAfterBid`) — 상세에 다시 안 들어와도 보이게.
- 수정 이력 섹션 — 필드별 이전/이후. 서버가 스냅샷 사슬에서 만들어 내려준다(rev N 의 "이후" = rev N+1 의 스냅샷,
  마지막은 현재 프로젝트) — 화면은 diff 를 계산하지 않는다.
- 메일은 붙이지 않았다(`sendMarketMail` 인프라는 있으므로 나중에 한 줄).

### 11.3 구현 위치

| 층 | 위치 |
|---|---|
| DB | `sp_market_project_revision`(projectId·revNo unique · actorMbId · byOwner · major · changedFields · snapshot) — 마이그레이션 `20260905090000_market_project_revision` |
| 계약 | `MarketProjectUpdateBody`(+answers) · `MarketProjectRevisionItem`/`ListResponse` · `MarketProjectUpdateResponse{revNo,major,deadlineExtendedTo}` · `MARKET_REVISION_FIELDS`/`_LABELS`/`MARKET_MAJOR_REVISION_FIELDS`/`isMajorMarketRevision`/`MARKET_REVISION_DEADLINE_*` · Detail `revisionCount·lastRevisionAt·devReviewStale` · Viewer `myBidOutdated` · MyBid `projectRevisedAfterBid` |
| 서버 | `lib/market-revision.ts`(스냅샷·diff·기록·stale 판정) · `routes/market-projects.ts` PATCH/`GET :id/revisions`/첨부 2종 · `routes/market-bids.ts` my/bids |
| 화면 | `pages/ProjectEdit.vue`(신규, 라우트 `/projects/:id/edit`) · `ProjectDetail.vue`(배지·경고 배너·이력 섹션·검토서 stale) · `Me.vue`(견적 목록 배지) |

⚠ 수정 화면은 등록 위저드를 재사용하지 않는다 — 위저드는 AI 잡 오케스트레이션까지 소유해서 수정 경로로 끌고 오면
검토서를 다시 돌리게 된다. 문항·분야 카드·드롭존 컴포넌트만 빌려 쓴다.
⚠ 마감은 **손댔을 때만** 보낸다(`deadlineTouched`) — 등록은 시각까지 있는 값이고 수정 화면은 날짜 입력이라,
그대로 보내면 저장만 눌러도 23:59 로 밀려 "중대한 수정"(입찰자 경고)이 공짜로 발생한다.

검증(2026-09-05): e2e-market **146/0**(수정 8케이스 신규 — 사소/중대 구분 · 빈 수정 무이력 · 이력 목록 · 입찰
있는 수정 · myBidOutdated · 재제출로 경고 해소 · 채택 후 NOT_EDITABLE) · api 단위 980 + `market-revision` 6 ·
계약/api/market/web 타입체크·lint 0 · 실브라우저 수정 왕복(pageErrors 0).

### 11.4 수정 뒤 AI 검토서 갱신 — 자동이 아니라 선택 (2026-09-05)

수정하면 검토서는 "수정 전 내용" 이 된다(`devReviewStale`). **자동으로 다시 돌리지 않는다.**

| 왜 자동이 아닌가 | |
|---|---|
| 비용이 대칭이 아니다 | 검토서 30초~3분인데 **구성도는 5~10분**(kimi thinking high, 큐 동시 1). 제목 오타 하나에 10분짜리가 도는 건 과하다 |
| 수정은 한 번으로 안 끝난다 | 설명 저장 → 답변 저장 → 첨부 추가처럼 연달아 누른다. 자동이면 그때마다 잡이 쌓이고 구성도 큐가 눈덩이가 된다 |
| 이미 사고는 막혀 있다 | stale 배지가 고객·전문가 모두에게 "수정 전 내용" 이라고 알린다. 갱신은 급한 일이 아니라 **고객이 원할 때 하는 일** |

- **경로**: `POST /market/projects/:id/dev-review`(소유자·관리자). 수정과 **같은 창**에서만(마감·채택 뒤 409 `NOT_EDITABLE` —
  그 뒤 검토서가 바뀌면 전문가가 본 전제가 사후에 달라진다). 유스케이스가 꺼져 있으면 409 `USECASE_DISABLED`.
- **근거**는 저장분에서 다시 만든다 — `buildProjectDevReviewSourceWithImages`(신규): 설명·답변 + 참고 자료 실파일의
  **텍스트와 이미지**. ⚠ 옛 `buildProjectDevReviewSource` 는 이미지를 버렸다(구성도는 텍스트만 보므로) — 그대로 쓰면
  재생성본이 원본보다 근거가 빈약해진다(첨부 이미지 판독이 통째로 빠진다).
- **완료 처리**: 러너에 `projectId` 를 주면 완료 순간 `project.devReview` 에 써 넣는다(구성도 러너와 같은 연결 규칙).
  같은 입력의 완료 잡이 있으면 다시 돌리지 않고 그 결과를 박제한다(`cached: true`) — 등록 직후 재생성이 3분을 헛돌지 않게
  `devReviewAttachmentHashes` 를 **등록 라우트와 같은 형식**으로 쓴다(이 함수는 이번에 `routes/ai.ts` → `lib/ai/dev-review.ts` 로 옮겼다).
- **화면**: ① 수정 저장 직후 CTA("새 내용으로 다시 만들까요?" + `구성도도 함께` 체크박스, 기본 해제) ② 상세 검토서 카드의
  stale 배너 옆 상시 버튼 ③ 진행 중에는 기존 검토서를 그대로 두고 얇은 띠만(완료되면 그 자리에서 바뀐다).
  버튼은 유스케이스 상태(`/ai/market.dev-review/status`)로 감춘다.
- **이력에는 남기지 않는다** — AI 산출물은 원천의 함수라 수정(revision)의 대상이 아니고, 입찰자 경고도 원천 변경 시점에 이미 나갔다.
- 한계: 재생성 중 서버가 죽으면 그 잡은 running 인 채 남는다(구성도의 ABANDONED 복구 같은 장치는 없다) — 다시 누르면 된다.

검증(2026-09-05): e2e-market **148/0**(재생성 가드 2 신규 — 제3자 403 · 채택 후 NOT_EDITABLE) ·
실 LLM 왕복 1회(옛 검토서 → 설명 수정 → stale 배너 → 버튼 → 진행 띠 → 새 검토서로 교체, 요약에 수정 내용 반영, pageErrors 0).

### 11.5 저장 = 편집의 끝 (2026-09-05)

옛 흐름은 저장해도 편집 폼에 남고, 결과(v2·마감 연장)와 다음 행동(검토서 갱신)이 폼 아래 카드로 붙어
**끝나는 지점이 없었다**. 저장을 종료 지점으로 만든다.

- **저장하면 상세로 나간다.** 알릴 것이 있을 때만 결과 모달(`SaveResultModal`)을 한 번 띄우고,
  **두 버튼 모두 상세로** 이동한다 — 시작한 곳과 결과를 보는 곳을 같게 만든다.
- 모달을 띄우는 조건 = 검토서가 낡았거나(stale ∧ 유스케이스 켜짐) · 마감이 자동 연장됐거나 · 중대한 수정일 때.
  그 밖에는 모달 없이 바로 상세 + `?saved=v2` → 상세 상단에 "수정했습니다 — v2" 5초(그 뒤 쿼리 제거).
- 모달 내용 = `수정했습니다 — v2` · 입찰자 경고 안내 · 마감 자동 연장 · (낡았으면) "AI 사전 검토서를 바뀐 내용으로 다시 만들까요?" 질문 + `구성도도 함께` 체크박스 — 버튼이 그 답이다.
  버튼은 `[검토서 다시 만들고 상세로]` / `[나중에 · 상세로]`. **Esc·바깥 클릭은 닫기만 한다**(상세로 가지 않고
  폼에 남는다) — "지금/나중에" 결정을 실수 클릭이 대신 고르지 않게. 요청 중엔 닫히지 않는다(`role=dialog`, 열리면 포커스 이동).
- **바뀐 게 없는 저장**(서버 `revNo: null`)도 조용히 옮기지 않는다 — 모달이면 제목 `바뀐 내용이 없어 그대로입니다`,
  아니면 `?saved=none` 으로 상세 상단에 같은 문구. (검토서가 이미 낡아 있던 프로젝트는 변경 0이어도 모달이 뜬다.)
- **재생성을 고르면 `?reviewJob=<uuid>` 를 함께 넘긴다** — 상세가 그 잡을 이어받아 폴링해 도착 즉시 진행 띠를 보인다.
  이 배선이 없으면 편집 화면에서 시작한 잡을 상세가 몰라 "다 되면 이 자리에서 바뀝니다" 약속이 깨진다(실측으로 발견).
  이어받은 잡을 서버가 모르면(404) 상세가 "상태를 확인할 수 없다 — 다시 만들기" 로 말한다(띠가 그냥 안 뜨면 이유를 모른다).
- 저장 버튼 문구는 `저장하기`, 옆은 `취소하고 돌아가기`. **고르기만 하고 안 올린 첨부는 저장이 대신 올린다**
  (저장이 곧 이탈이라 그대로 두면 조용히 사라진다). 올리기가 **실패하면 저장을 멈추고** 폼에 남아 에러를 보인다
  — 삼키고 나가면 파일도 에러도 사라진다.
- 첨부 올리기와 PATCH 는 판을 따로 남긴다(첨부 v2 · 필드 v3, 이력에는 둘 다 보인다). 그래서 `POST …/files` 응답이
  `revNo·major` 를 싣고, 편집 화면은 **마지막 판 번호 + 둘 중 하나라도 중대** 로 합쳐 한 번만 알린다 — 첨부만 바꾼
  저장도 "수정했습니다 — v2 · 입찰자 경고" 가 빠지지 않는다.
- 저장 전 확인은 두지 않았다 — 저장은 되돌릴 수 있고(또 수정하면 된다), 정작 알아야 할 것은 **결과**다.

검증(2026-09-05): 실브라우저 왕복 — 수정 → 모달(v1·경고 안내·검토서 낡음) → `검토서 다시 만들고 상세로`
→ 상세 도착 즉시 진행 띠 + 저장 토스트 → 실 LLM 완료 후 그 자리에서 새 검토서로 교체, pageErrors 0.
