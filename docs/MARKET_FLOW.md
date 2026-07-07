# MARKET_FLOW — PCB 재능마켓 (sp-market)

재능마켓(회로개발·PCB설계 전문가 ↔ 의뢰인 매칭)의 **단일 설명원본**. 1차(매칭까지) 구현 기준이며,
근거 기획은 `D:\work\workspace_other\samplepcb-market-prototype`(2026 HTML 프로토타입)와 2021 PPTX 2건.
브랜치 `feat/market-mvp` (2026-07-08).

## 1. 범위

- **1차(구현됨) = 매칭까지**: 전문가 등록(개인/기업)·관리자 승인 → 프로젝트 의뢰(역견적=공개
  블라인드 입찰 / 지정견적=1:1) → NDA 게이트 첨부 → 블라인드 견적 제출·비교·**채택**.
- **2차(설계만)**: 계약(`sp_market_contract`) + **영카트 주문 재사용 결제**(앵커 상품 스냅샷
  카트행 — 거버 담기와 동형) + 검수 + 정산(전문가측 수수료 공제). §8.
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
| `sp_market_project` | 의뢰 | method `open\|targeted`(+targetExpertId) · bidDeadlineAt(**lazy 마감** — 저장 전이 없음) · status `bidding\|closed\|awarded\|cancelled`(2차 예약 working/completed) · awardedBidId |
| `sp_market_bid` | 입찰 | **unique(projectId, expertId)** = 전문가당 1입찰(재제출=같은 행) · amount 원 단위 Int · status `submitted\|awarded\|rejected\|withdrawn` |
| `sp_market_nda_sign` | NDA 전자서명 | unique(projectId, mbId) · textVersion(문구 원문은 계약 상수) · signedName·ip 감사 스냅샷 |
| `sp_market_settings` | 설정 싱글턴(id=1) | feeRateBp(기본 1000=10%) — GET 폴백/PATCH upsert, 시드 불요 |

- **첨부·증빙은 `sp_file` 폴리모픽 재사용**: refType `'sp_market_project'`(attachment) /
  `'sp_market_expert'`(license·portfolio·bizreg). pathToken 비노출·`uploadedBy`에 mbId 금지
  (varchar(20)) 불변식 유지. 파일서버 serviceType은 env `MARKET_FILE_SERVICE_TYPE`(기본 `market`).
- 코드 사전(분야 18종·CAD·예산/경력/지역/이동거리 구간)과 **한글 라벨의 정본은
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

## 8. 2차 설계 방향 (구현 금지선 아님 — 계획서 승인분)

- `sp_market_contract`: projectId·bidId·amount·**feeRateBp 스냅샷**(설정 변경과 절연)·
  feeAmount·payoutAmount·contractKey(uuid=`io_id`)·ctId(g5_shop_cart 링크, od_id 는 파생 조인).
- 결제 = 영카트 재사용: 앵커 상품(`sp-market-*`, seed-template-items 패턴) +
  `insertQuoteOption`+`insertCartRow`(g5-db 카탈로그 확장) → `/shop/orderform.php`.
  관리자 수기 전이는 무통장 한정(PG 취소는 PG 도메인) 기존 규칙 준수.
- 수수료 정책(2026-07-08 확정): **전문가측 10% 단일 공제**(크몽식). 프로토타입 결제 화면의
  "의뢰인 5%+VAT"는 채택하지 않음. 요율은 `sp_market_settings.feeRateBp`.

## 9. 운영 절차·환경

- 시드: `pnpm --filter api run market:seed` — 당사(샘플피씨비) 전문가 1행(지정 1번,
  mbId=`g5_config.cf_admin`, 멱등 키=house 존재). 로컬 실행 완료(#1).
- env(apps/api/.env): 기존 JWT_SECRET·SMTP_*·FILE_SERVER_URL 재사용 +
  `MARKET_FILE_SERVICE_TYPE`(선택, 기본 `market`) — **파일서버가 신규 serviceType 을 받는지
  운영 전 1회 실측 필요**(테스트 'demo' 선례상 가능 추정).
- dev: `pnpm --filter market dev`(5176, strictPort — 점유 시 실패가 정상 신호),
  api(3333)·web(5173)과 병행. 통합 확인은 local-web(라이브 nginx 반영 후).
- **E2E 회귀**: `ops/scripts/e2e-market.mts` — 매칭 전 과정+부정 경로 33항목(§4·§5의
  실행 가능한 명세). api 가동 상태에서
  `pnpm --filter api exec tsx --env-file=.env ../../../ops/scripts/e2e-market.mts run`
  → 확인 후 같은 명령 `cleanup`(파일서버 실파일까지 정리). 실존 회원 2명을 임시 주체로
  쓰며 메일은 Mailpit 이 가로챈다.
- 문구 정책(1차): 도메인 라벨은 계약 `MARKET_*_LABELS` 정본, 화면 고유 카피는 마켓·관리자
  화면에서 ko 인라인(다국어(en) 도입 시 i18n 이관 — 모노레포 AGENTS "라벨 i18n" 원칙의
  1차 한정 예외).

## 10. 남은 것 / 알려진 제약

- [x] 라이브 nginx `location /market/` 반영(§2) — 2026-07-08 완료(서비스 재시작으로 적용,
      같은 도메인 PHPSESSID 자동 로그인까지 실브라우저 확인).
- [ ] 파일서버 serviceType `market` 수용 실측(§9).
- [ ] 운영 빌드 static 블록(ops/nginx 주석) 전환 시 `pnpm --filter market build` 산출물 경로 확인.
- 조회수 dedup 없음(참고 지표) · 입찰 수정 감사 이력은 updatedAt 만 · 본인인증은 관리자
  수동 체크(identityVerified) — 실인증 연동 2차.
- 위키 재컴파일(`/wiki-compile`) 권장 — sp-node-api·sp-vue-web·infrastructure 토픽에 마켓 반영.
