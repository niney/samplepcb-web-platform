# 거버 주문 프로세스 — 업로드부터 장바구니까지

> 거버 뷰어에서 [주문하기]를 누른 순간부터 영카트 장바구니(cart.php)에 행이 보이기까지,
> **영카트 코어를 한 줄도 수정하지 않고** 커스텀 레이어(sp-node·인증 브리지·거버 뷰어)로
> 동적 주문을 구현한 과정의 기록. 설계 결정의 배경은 `HANDOFF.md`, 플랫폼 전반은 `AGENTS.md` 참조.
>
> 작성 2026-07-02 · 실브라우저 end-to-end 검증 완료 시점 기준

---

## 1. 목표와 제약

**문제**: PCB 주문은 고정 상품이 아니다 — 사용자가 Gerber 파일을 올리면 그때 사양과 가격이 정해진다.
영카트는 "미리 등록된 상품을 담는" 모델이라 정면으로 충돌한다. 레거시는 **주문마다 상품을 강제
생성**(EAV 여분필드 `it_1~it_50`에 사양 저장)해서 풀었지만, 상품 테이블 오염·관리자 노이즈·
모델 왜곡을 낳았다.

**제약(원칙)**:
- 그누보드/영카트 **코어 비수정** — subtree pull 로 보안 패치를 계속 받아야 한다
- 신규 기능은 모노레포(sp-node/sp-vue)·`spcb/`(브리지)·테마에만
- 신규 테이블은 `sp_` 접두사, 그누보드 스키마 직접 결합 금지(한정 예외만 허용)

**해법 한 줄 요약**: 상품은 카테고리 앵커(템플릿 4종)로 고정하고, 주문의 실체(사양·파일·가격)는
`sp_*` 테이블이 소유하며, 영카트에는 **스냅샷(cart 행)만 밀어 넣는다.**

## 2. 등장 요소

```
[브라우저]
  거버 뷰어 (React) ── local-gerber.samplepcb.co.kr (dev) / www…/gerberview (prod)
      │
[PHP — 그누보드/영카트, 코어 무수정]
  spcb/api/me.php      인증 브리지(커스텀): 세션 → JWT 발급 (mbId + cartId 클레임)
  shop/cart.php        장바구니(코어 그대로): 세션 ss_cart_id 로 조회만
      │
[Node — sp-node (Fastify), samplepcb-web-mono-app/apps/api]
  POST /api/pcb-projects   담기 API: 검증→견적→파일→저장→cart INSERT
  src/pricing/engine.ts    가격 엔진(레거시 PHP 이식, 골든 테스트 검증)
  src/lib/file-server.ts   파일서버 업로드 대행
  src/lib/g5-db.ts         g5_shop_cart 접근(한정 예외 모듈)
      │
[저장소]
  samplepcb_app DB (Prisma 소유): sp_quote · sp_order_spec · sp_file
  그누보드 DB:                    g5_shop_cart (INSERT만) · g5_shop_item (템플릿 SELECT만)
  file.samplepcb.kr:              실파일 (pathToken 발급)
```

## 3. 프로세스 — 단계별

### ① 인증: 세션 → JWT (브리지)

```
거버 뷰어 ──GET /spcb/api/me (credentials: include)──▶ me.php
         ◀── { token: JWT(mbId·mbNick·level·isAdmin·cartId, 10분) } ──
```

- 브라우저가 **PHPSESSID 쿠키**를 자동 첨부 → `me.php`가 그누보드 세션으로 회원 확인
- 핵심 클레임 **`cartId`** = 영카트 세션의 `ss_cart_id`(없으면 표준 `set_cart_id()`로 생성).
  이 값이 곧 `g5_shop_cart.od_id` — cart.php 가 장바구니를 조회하는 유일한 키다.
  **JWT는 "누구인가"와 함께 "어느 장바구니 버킷인가"를 배달하는 서명된 택배**
- 비로그인 → 401 → 거버가 로그인 페이지로 유도 (비회원 주문은 미사용 결정)
- dev 교차 서브도메인(local-gerber→local-web): same-site 라 쿠키는 전달되고,
  me.php 의 CORS 가 `*.samplepcb.co.kr` 오리진을 반사 허용
- 세션 = 진실원본, JWT = 10분 캐시. 갱신은 me 재호출(제출 직전 발급 패턴 — 저장 금지)

### ② 제출: 단일 multipart 호출

```
거버 뷰어 ──POST /api/pcb-projects (Authorization: Bearer JWT)──▶ sp-node
  FormData:
    gerber    : 거버 zip (IndexedDB 보드 → zip blob)
    thumbnail : 렌더 썸네일 png
    payload   : JSON { flow, projectName, category, orderCategory, qty, message, spec{…} }
```

- 레거시도 "파일+사양 단일 form.submit()"이었으므로 같은 모델 유지 — 클라이언트 변경 최소화
- **어댑터(`toProjectPayload`)**: 기존 화면단 조립(`inputOptions`)은 그대로 두고 전송 직전에만
  신규 포맷으로 보정(별칭·오탈자 정규화, menu→category / category→orderCategory 승격 등).
  뿌리 수정 없이 계약을 맞추는 전략
- **가격은 보내지 않는다** — 화면 표시용일 뿐. 서버 재계산만이 진실(위변조 원천 차단)

### ③ sp-node 처리 (한 요청 안에서 순차)

```
1. payload Zod 검증 ── @sp/api-contract PcbProjectPayload (spec 키 39종 계약)
2. JWT 검증 ── 없으면 401. mbId·cartId 클레임 확보
3. 견적 재계산 ── pricing/engine.ts (레거시 pcb_price*.lib.php 충실 이식)
     standard → 면적식+옵션표+마진브래킷+소형고정가 / metalMask → 국내가표
     advance·flexible류 / 양산(mass) / 가격 0 → rfq (자동견적 불가)
4. 파일서버 업로드 대행 ── file.samplepcb.kr (서버-to-서버, pathToken 클라이언트 미노출)
     실패 시 여기서 중단 — 파일 없는 프로젝트를 만들지 않는다
5. 저장 (Prisma 단일 트랜잭션, samplepcb_app DB)
     sp_quote      견적 스냅샷 (specHash·가격표버전·72h 만료) — 감사·재검증의 진실원본
     sp_order_spec 프로젝트 실체 (mbId·사양 JSON·quoteStatus)
     sp_file       pathToken 연결 (ref_type='sp_order_spec')
6. 장바구니 INSERT ── flow=order & 가격 확정일 때만 (lib/g5-db.ts, 한정 예외)
     od_id = JWT cartId · it_id = 템플릿 상품 · it_name = "Standard PCB · mood.zip"(스냅샷)
     실패해도 5까지는 유효 — 프로젝트는 "견적 보관" 상태로 남아 데이터 오염 없음
7. spec.ctId ← cart insertId 연결, 응답 반환
```

응답:

```jsonc
{ "result": true, "data": {
    "projectId": 7, "quoteId": "…", "quoteStatus": "priced",
    "price": 35000, "eta": "2026.07.13",
    "cartAdded": true, "redirectUrl": "…/shop/cart.php" } }
```

### ④ 장바구니: 코어가 "그냥" 보여준다

- 거버는 `redirectUrl`로 이동만 한다 (rfq 는 견적함 — 페이지 준비 전 임시 홈)
- cart.php 는 **한 줄도 안 고쳤다** — 자기 세션의 `ss_cart_id`로 조회했더니 행이 있을 뿐.
  ①에서 그 세션 값을 JWT로 배달했고 ⑥에서 od_id 로 꽂았으므로 순환이 닫힌다
- 이후 주문서(orderform)→PG 결제→관리자 주문관리는 영카트 표준 흐름 그대로

## 4. 코어 무수정을 지킨 기법 카탈로그

코어와 충돌한 지점마다 "코어를 고치는 대신" 쓴 우회 기법들. **이 문서의 핵심 가치.**

| # | 충돌 지점 (코어 동작) | 기법 |
|---|---|---|
| 1 | 상품이 미리 있어야 담긴다 | **템플릿 상품 4종**(카테고리 앵커, `sp-pcb-std` 등) — 가격·사양은 읽지 않고 존재만 시킨다. 주문 실체는 `sp_order_spec` |
| 2 | cart 는 담는 시점 값을 복사(스냅샷) | 이를 **역이용** — `cartupdate.php` 를 우회해 직접 INSERT 하며 행마다 다른 `it_name`("템플릿명 · 파일명")·사양요약(`ct_option`)·가격 주입 |
| 3 | `before_check_cart_price` 가 조회마다 `ct_price`≠상품가면 **상품가로 덮어씀** (`lib/shop.lib.php:2582`) | 견적가를 **`io_price`(옵션가)** 에 싣는다 — `ct_price=0(=템플릿가)`, `io_id='sp-quote'`(옵션테이블 미등록이라 재검증 스킵). 합계 = (ct_price+io_price)×qty, 표준 계산식 그대로 |
| 4 | 장바구니 키 `od_id` = PHP 세션 `ss_cart_id` — 외부 서버는 알 수 없음 | **인증 브리지 확장** — `me.php`(커스텀 영역) JWT 에 `cartId` 클레임 추가. cart.php 무수정 |
| 5 | `cartupdate.php:276` 이 같은 `it_id` 재담기 시 기존 행 전부 삭제 | 템플릿 상품을 **일반 목록/상세에 노출 금지** — 표준 담기 경로 자체를 차단 |
| 6 | 가격 로직이 PHP 에 있음 | **골든 테스트 이식** — 레거시 PHP 를 CLI 로 직접 실행한 기대값과 대조하는 테스트로 TS 이식(버그까지 충실 재현, 개선은 별도 결정) |
| 7 | 사양이 EAV(`it_1~it_50`) 50슬롯 제한 | `sp_order_spec.spec_json` — 슬롯 제한 없음(레거시에서 유실되던 `gusset` 등도 수용) |

## 5. 데이터 소유권 지도

| 데이터 | 소유 | 접근 규칙 |
|---|---|---|
| 사양·파일연결·견적 (`sp_quote`/`sp_order_spec`/`sp_file`) | **sp-node (Prisma)** | 그누보드/PHP 는 접근하지 않음 |
| 실파일 | file.samplepcb.kr | sp-node 가 업로드 대행, pathToken 만 보관 (다운로드 보안은 추후 과제) |
| `g5_shop_cart` | 영카트 코어 | sp-node 는 **INSERT + 파생 SELECT 만** (한정 예외, `lib/g5-db.ts` 에 명시) |
| `g5_shop_item` (템플릿) | 영카트 코어 | sp-node 는 SELECT 만 (배송정책 스냅샷용) |
| 회원/세션 | 그누보드 | sp-node 는 JWT 클레임으로만 식별 (DB 직접 결합 없음) |
| cart↔spec 관계 | **저장하지 않음** | `spec.ctId → g5_shop_cart` 조회 시점 조인으로 파생 — 동기화 로직 자체가 없어 불일치 불가능 |

## 6. 왜 이 구조인가 (요약된 결정 근거)

- **스냅샷 모델이 열쇠**: 영카트 cart/order 는 담는 시점 값을 복사하고 이후 상품을 다시 보지 않는다
  (`shop/cartupdate.php:291`). 그래서 "임의 가격의 행"을 밀어 넣어도 결제·정산·취소가 전부 정상 —
  인쇄·명함 등 주문제작형 영카트 사이트들의 검증된 패턴
- **cart 삭제 동기화가 필요 없는 이유**: cart 행은 주문되면 삭제가 아니라 `ct_status='주문'` 이 된다.
  관계를 저장하지 않고 파생하므로, 사용자가 cart 에서 지워도 스펙은 그대로("결제 대기열에서 뺀 것")
- **주문/견적 화면 분리**: 주문(priced)은 cart.php 로 이미 완결. rfq 만 갈 곳이 없으므로
  **견적함**(sp-vue) 을 신규로 만든다 — 레거시 `estimate_*` 는 코어가 아닌 레거시 커스텀이라
  subtree 에 없고, EAV 전제라 이식 가치도 없음
- 전체 결정 이력(폐기안 포함)은 `HANDOFF.md` 6장 결정 로그

## 7. 현재 상태와 남은 것

**동작 검증 완료 (2026-07-02, 실브라우저)**: 로그인 → 거버 업로드 → [주문하기] →
cart.php 에 "Standard PCB · <파일명>" 행 + 견적가 표시.

남은 것(우선순위): ① 견적함 페이지(rfq 목적지) ② 전 메뉴 실전송 검증(standard 만 완료)
③ 관리자 가격 확정(rfq→quoted)+담기 ④ 운영 전환(거버 prod 분기·운영 nginx `/api`) —
상세 체크리스트는 `HANDOFF.md` 7장.

## 8. 관련 파일 색인

| 역할 | 위치 |
|---|---|
| 인증 브리지 | `samplepcb-web/spcb/api/me.php` |
| 담기 API | `samplepcb-web-mono-app/apps/api/src/routes/pcb-projects.ts` |
| 가격 엔진 (+골든 테스트) | `…/apps/api/src/pricing/engine.ts` · `engine.test.ts` · `pricing-data.json` |
| 파일서버 클라이언트 | `…/apps/api/src/lib/file-server.ts` |
| g5 접근(한정 예외) | `…/apps/api/src/lib/g5-db.ts` |
| DB 스키마 | `…/apps/api/prisma/schema.prisma` (sp_quote/sp_order_spec/sp_file) |
| 요청 계약 | `…/packages/api-contract/src/schemas/pcb-project.ts` · `auth.ts` |
| 템플릿 상품 시드 | `…/apps/api/src/scripts/seed-template-items.ts` |
| 거버 제출부 | `samplepcb_gerber/apps/view/src/ResultPanel/submit.tsx` (별도 repo) |
