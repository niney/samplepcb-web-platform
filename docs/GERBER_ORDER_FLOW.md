# 거버 주문 프로세스 — 업로드부터 장바구니까지

> 거버 뷰어에서 [주문하기]를 누른 순간부터 영카트 장바구니(cart.php)에 행이 보이기까지,
> **영카트 코어를 한 줄도 수정하지 않고** 커스텀 레이어(sp-node·인증 브리지·거버 뷰어)로
> 동적 주문을 구현한 과정의 기록. 설계 결정의 배경은 `HANDOFF.md`, 플랫폼 전반은 `AGENTS.md` 참조.
>
> 작성 2026-07-02 · 실브라우저 end-to-end 검증 완료 시점 기준
> 갱신 2026-07-03 · 가격 엔진 라이브 패리티 체계 + spec 키 differentDesign 통일 반영
> 갱신 2026-07-03 · 견적관리(/shop/quotes)·지난 견적 보관함(/shop/quotes/archive) — 장바구니와 독립 모델 확립
> 갱신 2026-07-03 · 장바구니 견적 행 건별 인라인 수량변경 — 담긴 상태에서 서버 재견적+cart 행 동기화(기법 #8 개정)
> 갱신 2026-07-04 · 견적 수신처 회사명 2층 구조(SpOrderSpec.companyName 스냅샷 + SpMemberProfile 프로필) — 여분필드(mb_1/mb_2) 비사용
> 갱신 2026-07-04 · 관리자 회원 관리(/app/admin/members) — 레거시 member_list.php 이관. g5 한정 예외에 ⑧(g5_member·g5_config read-only SELECT)·⑨(g5_member mb_intercept_date·mb_level UPDATE) 추가
> 갱신 2026-07-04 · 회원 상세 편집 확장 — 회원 정보(이름·닉·이메일·연락처·주소)+관리자 메모. 카탈로그 ⑨-b(g5_member 정보/메모 UPDATE — 코어 정합성 이식, 가드 차등: self·cf_admin 허용)
> 갱신 2026-07-04 · 드로어 주소 검색(Daum/카카오 우편번호) — 범용 composable `useDaumPostcode.ts`(win_zip 매핑 이식). mb_addr_jibeon 은 코어 동일 **형식 플래그(R/J)** 저장(검색 시) / addr1 수동 변경 시 '' 초기화(감사 판정 — HANDOFF #12). DB 스키마·카탈로그 문구 무변경
> 갱신 2026-07-04 · **방침 개정** — sp-php 업무 기능의 모노레포 점진 마이그레이션 확정. g5 접근을 "원칙 금지 + 한정 예외"에서 "규율된 **접근 카탈로그**"로 재정의(5장, HANDOFF 결정 로그 #11)
> 갱신 2026-07-05 · 관리자 주문내역 **상태 전이·선택삭제 백엔드**(adm/shop_admin/orderlistupdate.php·orderlistdelete.php 이식) + **PHP 알림 브리지**(spcb/api/order-notify.php — 메일/SMS 는 Node 재구현이 아니라 커스텀 주문 메일 템플릿 재사용). g5 카탈로그에 ⑬(g5_shop_order 상태·금액 UPDATE·DELETE / g5_shop_cart ct_status / g5_shop_item it_sum_qty·재고 / g5_shop_item_option 재고) 추가

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
  관리자 견적 관리 (Vue, sp-vue) ── /app/admin/quotes — 전 사용자 견적 목록·가격 확정
      │
[PHP — 그누보드/영카트, 코어 무수정]
  spcb/api/me.php                인증 브리지(커스텀): 세션 → JWT 발급 (mbId + cartId 클레임)
  shop/cart.php                  장바구니(코어 + 테마 스킨 오버라이드): 세션 ss_cart_id 로 조회
  spcb/pages/quotes.php          견적관리 /shop/quotes (커스텀): 순수 견적 목록·수량 재견적·바로 주문·삭제
  spcb/pages/quotes-archive.php  지난 견적 보관함 /shop/quotes/archive (커스텀): 삭제된 견적 목록·영구 삭제
      │
[Node — sp-node (Fastify), samplepcb-web-mono-app/apps/api]
  POST  /api/pcb-projects        담기 API: 검증→견적→파일→저장→cart INSERT
  GET   /api/pcb-projects        목록(?status=active|deleted) — cart 삭제 지연 반영(lazy reconcile) 겸함
  POST  /api/pcb-projects/order  바로 주문: 배치 담기 + ct_select 행 단위 선택 → orderform 직행
  PATCH /api/pcb-projects/:id    수량 수정 = 서버 재견적(새 quoteId 발급)
  DELETE /api/pcb-projects/:id   active→소프트 삭제(보관함) / deleted→하드 삭제(파일 포함 파기)
  GET   /api/admin/pcb-projects       관리자 목록(전 사용자·탭·검색·기간·페이지네이션) — requireAdmin
  GET   /api/admin/pcb-projects/:id   관리자 상세(사양 전체·파일·회원·견적 스냅샷)
  PATCH /api/admin/pcb-projects/:id/price  가격 확정 rfq→quoted (finalPrice/pricedBy/pricedAt 기록)
  GET   /api/admin/pcb-files/:fileId  관리자 원본 다운로드(거버 등 — Bearer, pathToken 미노출)
  src/pricing/engine.ts          가격 엔진(레거시 PHP 이식, 라이브 실측 패리티 검증)
  src/lib/file-server.ts         파일서버 업로드·삭제 대행
  src/lib/g5-db.ts               g5 접근(한정 예외 모듈: cart INSERT·옵션 행·ct_select·파생 SELECT)
      │
[저장소]
  samplepcb DB 공유(sp_* 는 Prisma 소유): sp_quote · sp_order_spec · sp_file
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
     가격표 = 라이브 pricing_data.json 스냅샷(관리자가 수시 조정 — 동기화·재캡처 절차는
     docs/pricing-engine-parity.md). spec 의 파일 개수 키는 differentDesign (2026-07-03 통일)
4. 파일서버 업로드 대행 ── file.samplepcb.kr (서버-to-서버, pathToken 클라이언트 미노출)
     실패 시 여기서 중단 — 파일 없는 프로젝트를 만들지 않는다
5. 저장 (Prisma 단일 트랜잭션, sp_* 테이블)
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

- 거버는 `redirectUrl`로 이동만 한다 (order+가격 확정 → cart.php / rfq → 견적관리 `/shop/quotes`)
- cart.php 코어는 **한 줄도 안 고쳤다** — 자기 세션의 `ss_cart_id`로 조회했더니 행이 있을 뿐.
  ①에서 그 세션 값을 JWT로 배달했고 ⑥에서 od_id 로 꽂았으므로 순환이 닫힌다
  (표현은 테마 스킨 오버라이드 — 견적 행은 [선택사항수정] 숨김·"견적 N건" 표기, 아래 기법 #8)
- 이후 주문서(orderform)→PG 결제→관리자 주문관리는 영카트 표준 흐름 그대로

### ⑤ 견적관리와 보관함: 한 건은 한 화면에만 (독립 모델, 2026-07-03)

```
견적관리 /shop/quotes        순수 견적 (ctId 없음, status='active')
장바구니·주문내역 (영카트)     담긴/주문된 건 (cart 행 존재) — 견적관리에 미노출
보관함 /shop/quotes/archive   삭제된 건 (status='deleted') — 영구 삭제만 가능
```

- **견적관리**: cart.php 와 같은 카드 문법(체크|썸네일|이름+사양요약+메타|수량+가격) +
  툴바 [선택삭제]/[비우기]. 수량 인라인 수정 = PATCH 서버 재견적(새 quoteId, 비선형 브래킷),
  [바로 주문] = POST /order (배치 담기 + `ct_select` 행 단위 선택 → orderform 직행).
  목록 API 의 `optionSummary` 가 cart 의 `ct_option` 과 같은 문자열이라 두 화면 표기가 항상 일치
- **장바구니에서도 수량 변경·주문 (2026-07-03)**: 담긴 견적은 견적관리에 안 나오지만(독립 모델),
  이제 **장바구니 카드에서 직접** 수량을 바꾼다 — 견적 행을 건별(ct_id) 카드로 분리하고 인라인
  수량 입력이 `PATCH /:id`(담김 허용) 를 호출, 서버가 재견적하고 **cart 행 `io_price`/`ct_option`/
  옵션 행을 새 견적에 동기화**(기법 #8·한정 예외 ⑥). 주문은 `/order`(행 단위 선택)로 직행
- **장바구니에서 삭제하면**: sp-lite cart 의 [선택삭제]/[비우기]는 견적 행을 `DELETE /:id`(담김
  허용, cart 행·옵션 행을 **ct_id 단위**로 제거 → status='deleted' 보관함)로 지운다. 코어
  cartupdate 로 지운 경우(다른 경로)를 위한 **lazy reconcile 백스톱**도 유지 — 목록 조회 시점에
  "ctId 는 있는데 cart 행이 없다"를 감지해 status='deleted' 로 지연 반영. 주문 완료 건의 cart
  행은 코어가 보존하므로 오탐 없음
- **보관함**: 보기 전용 + [영구 삭제](복원 없음). 하드 삭제 순서가 핵심 — 실파일(파일서버) 먼저,
  전부 성공했을 때만 DB 파기. 실패 시 spec 보존 → 재클릭이 곧 재시도(멱등)

## 4. 코어 무수정을 지킨 기법 카탈로그

코어와 충돌한 지점마다 "코어를 고치는 대신" 쓴 우회 기법들. **이 문서의 핵심 가치.**

| # | 충돌 지점 (코어 동작) | 기법 |
|---|---|---|
| 1 | 상품이 미리 있어야 담긴다 | **템플릿 상품 4종**(카테고리 앵커, `sp-pcb-std` 등) — 가격·사양은 읽지 않고 존재만 시킨다. 주문 실체는 `sp_order_spec` |
| 2 | cart 는 담는 시점 값을 복사(스냅샷) | 이를 **역이용** — `cartupdate.php` 를 우회해 직접 INSERT 하며 행마다 다른 `it_name`("템플릿명 · 파일명")·사양요약(`ct_option`)·가격 주입 |
| 3 | `before_check_cart_price` 가 조회마다 `ct_price`≠상품가면 **상품가로 덮어씀**, 옵션가도 옵션표와 대조 (`lib/shop.lib.php:2582`) | 견적가를 **`io_price`(옵션가)** 에 싣는다 — `ct_price=0(=템플릿가)`, 견적마다 `g5_shop_item_option` 에 **옵션 행을 실등록**(`io_id=quoteId`, `io_price=견적가`)해 코어 재검증을 정당하게 통과. 합계 = (ct_price+io_price)×qty, 표준 계산식 그대로. (미등록 io_id 로 스킵시키는 초기안은 PHP 8 null 경고로 폐기) |
| 4 | 장바구니 키 `od_id` = PHP 세션 `ss_cart_id` — 외부 서버는 알 수 없음 | **인증 브리지 확장** — `me.php`(커스텀 영역) JWT 에 `cartId` 클레임 추가. cart.php 무수정 |
| 5 | `cartupdate.php:276` 이 같은 `it_id` 재담기 시 기존 행 전부 삭제 | 템플릿 상품을 **일반 목록/상세에 노출 금지** — 표준 담기 경로 자체를 차단 |
| 6 | 가격 로직이 PHP 에 있음 | **실측 패리티 이식** — 라이브 레거시 API 에 실캡처 body 46케이스를 재생한 fixture 와 대조(`legacy-parity.test.ts`, 판매가·제작일·무게·eta 전항목). 가격표는 서버 라이브 파일이 정본이라 스냅샷 동기화 절차가 필수(`pnpm pricing:sync` → PRICE_VERSION bump → `pnpm pricing:capture`). 상세 `docs/pricing-engine-parity.md` |
| 7 | 사양이 EAV(`it_1~it_50`) 50슬롯 제한 | `sp_order_spec.spec_json` — 슬롯 제한 없음(레거시에서 유실되던 `gusset` 등도 수용) |
| 8 | [선택사항수정] 팝업이 수량을 옵션표 `io_price`×수량으로 선형 재계산 — 견적 행은 io_price 가 **총액**이라 곱 오류. 게다가 코어 cart 는 `GROUP BY it_id` 라 같은 템플릿 견적이 한 카드("견적 N건")로 뭉친다 | **테마 cart 스킨에서 견적 행을 건별(ct_id) 카드로 분리 + 인라인 수량 입력** — 코어 [선택사항수정] 대신 수량 입력이 sp-node 재견적(`PATCH /:id`)을 호출해 비선형 가격을 서버가 다시 계산하고 담긴 cart 행의 `io_price`/`ct_option`/옵션 행을 새 견적에 동기화한다(한정 예외 ⑥). 주문·삭제도 ct_id 단위로 sp-node(`/order`·`DELETE /:id`) 경유 — 코어 `buy`/`seldelete` 는 it_id 단위라 형제 견적을 함께 처리하므로. **(개정 2026-07-03: "수량 변경은 견적관리에서" 링크 → 장바구니에서 직접 변경)** |
| 9 | 코어 "주문하기"(cartupdate act=buy)의 `ct_select` 선택이 **it_id 단위** — 템플릿 공유 시 다른 견적까지 함께 선택됨 | 견적만 체크: sp-node 가 `ct_select`/`ct_select_time` 을 **행(ct_id) 단위로 직접 UPDATE** 후 orderform 직행 (한정 예외 ④). 혼합 카트(일반 상품 체크 포함): 코어 폼으로 보내되 **미체크 견적 ct_id 를 쿠키(`sp_cart_deselect`)로 전달** → orderform 진입 시 `extend/sp_quote_cart.extend.php` 가 ct_select=0 보정(1회용 쿠키). 혼합 선택삭제/비우기도 견적은 sp-node DELETE 선처리 후 일반 상품만 코어 폼 **(개정 2026-07-04: 혼합 카트 경로 보정)** |
| 10 | 장바구니에서 삭제(cartupdate)해도 sp-node 는 알 수 없음 — 훅·트리거는 코어 수정 | **지연 반영(lazy reconcile)** — 관계를 저장하지 않고 파생하는 구조를 역이용, 목록 조회 때 "ctId 있음 + cart 행 없음"이면 status='deleted' 전환. 삭제 신호를 조회가 겸하므로 훅이 필요 없다 |
| 11 | 주문서(`shop/orderform.sub.php`)의 품목 합산(내부 SUM)·옵션 나열(`print_item_options`)이 **ct_select 무필터** — "선택 단위=it_id" 불변식 전제라, ct_id 단위 선택과 만나면 미선택 견적까지 합산·표시되고, 부풀린 `od_price` 가 최종 검증(`orderformupdate.php:222`)에서 `die("Error.")` | **코어 최소 수정 2곳(무수정 원칙의 기록된 예외)** — 내부 SUM 에 `ct_select='1'` 추가, 옵션 나열을 extend 의 `sp_print_item_options_selected()` 로 교체(function_exists 폴백). 스톡은 it_id 전량 선택이라 두 수정 모두 동작 불변(no-op) → subtree pull 충돌 시 같은 취지로 재적용. 원본 print_item_options 는 cart.php(진입 시 ct_select 전체 0 초기화)와 공유 함수라 직접 필터 불가 (2026-07-04) |

## 5. 데이터 소유권 지도 (= sp-node 의 g5 접근 카탈로그)

> **방침(2026-07-04 개정, HANDOFF 결정 로그 #11)**: sp-php(그누보드/영카트)에서 이 프로젝트
> 업무에 필요한 기능은 모노레포로 **점진 마이그레이션**한다(최적화·커스텀 목적). 따라서 아래
> g5_* 행은 "금지의 예외"가 아니라 sp-node 의 **접근 카탈로그**다 — 필요하면 확장하되,
> ① `lib/g5-db.ts` 일원화 ② 함수·컬럼 단위 기록 ③ 코어 병행 동작과의 정합성(부수효과) 확인
> ④ 이 표 + HANDOFF 동시 갱신이 규칙. 민감 컬럼 SELECT 배제·Prisma 의 g5 비편입은 불변.

| 데이터 | 소유 | 접근 규칙 |
|---|---|---|
| 사양·파일연결·견적 (`sp_quote`/`sp_order_spec`/`sp_file`) | **sp-node (Prisma)** | 그누보드/PHP 는 접근하지 않음 |
| 수신처 회사명 2층 (`sp_order_spec.companyName` 스냅샷 · `sp_member_profile` 프로필) | **sp-node (Prisma)** | 관리자 견적서 수신처 표기·프리필용(2026-07-04). 스냅샷=문서 박제(견적서에 고정), 프로필=회원 기본값(같은 회원 다음 견적서에 프리필). 표시값 = `스냅샷 ?? (회원이면)프로필`. 그누보드 여분필드(mb_1/mb_2) 대신 sp측 명시 필드 사용 |
| 실파일 | file.samplepcb.kr | sp-node 가 업로드 대행, pathToken 만 보관 (다운로드 보안은 추후 과제) |
| 실파일 삭제 | file.samplepcb.kr | 보관함 영구 삭제 시 sp-node 가 `GET /api/delete/:pathToken` 호출. ⚠ **보안 미처리 과제**: 이 API 는 인증 없이 pathToken 만으로 삭제되는 GET — pathToken 유출 시 임의 파일 삭제 가능. 내부망 제한 또는 서버 간 인증 추가 필요(2026-07 결정: 기능 먼저, 접근 제한은 인프라 트랙에서 후속 처리) |
| `g5_shop_cart` | 영카트 코어 | sp-node 는 **INSERT · 파생 SELECT · ct_select UPDATE(주문 선택 ④) · 견적 행 UPDATE(재견적 동기화 io_id/io_price/ct_option ⑥) · 견적 행 DELETE(ct_id 단위 빼기 ⑥)** (한정 예외, `lib/g5-db.ts` 에 명시) |
| `g5_shop_item_option` (견적 옵션 행) | 영카트 코어 | sp-node 는 견적 옵션 행(io_id=quoteId) **INSERT + 보상 DELETE** (한정 예외 확장, 기법 #3) · ⑬ 배송 전이 재고차감(order_update_delivery 미러 — io_stock_qty-=ct_qty, per-quote 옵션 행이라 9999999 버퍼 감소, 멱등 ct_stock_use 가드) |
| `g5_shop_item` (템플릿) | 영카트 코어 | sp-node 는 SELECT(배송정책 스냅샷) + ⑬ **UPDATE**: 완료 전이 it_sum_qty(전 주문 '완료' SUM(ct_qty) 판매 통계) · 배송 전이 it_stock_qty 차감(cart 행에 io_id 없을 때만 — 견적 행은 옵션 행 경로) |
| `g5_shop_order` (주문 헤더) | 영카트 코어 | sp-node 는 **관리자 API 한정**. read-only SELECT: ⑩ 견적 완전삭제 프리뷰(주문됨 견적이 묶인 주문의 결제상태·수납액·PG거래·형제 cart 파악 — od_status·od_receipt_price·od_cart_price·od_settle_case·od_tno·od_pg·od_misu, `getOrderInfoByCtId`) · ⑫ 관리자 주문내역(adm/shop_admin/orderlist.php 이식 — 목록/상세/배타 counts/누적주문수, 컬럼 화이트리스트, **민감 컬럼 od_pwd·od_cash·od_cash_info 는 SELECT 자체 배제**, 날짜는 KST native 문자열, WHERE 는 파라미터 바인딩(qField·정렬 컬럼은 화이트리스트 상수), `searchOrders`/`getOrderRow`/`getCartRowsByOdId`/`getMemberOrderCounts`). **UPDATE**: ⑬ 관리자 상태 전이(adm/shop_admin/orderlistupdate.php 이식 — 주문→입금(무통장, od_receipt_price/od_misu/od_receipt_time)→준비→배송(od_delivery_company/od_invoice/od_invoice_time)→완료, 원자 가드 WHERE od_id AND od_status. 전이 후 미수금·과세 재계산 od_misu/od_tax_mny/od_vat_mny/od_free_mny/od_send_cost(get_order_info 산식 미러 — send_cost·쿠폰은 상태 전이 불변이라 저장값 재사용, get_sendcost/쿠폰테이블 포트 미이식 갭). od 단위 독립 처리 processed/skipped. `setOrdersReceipt`/`setOrdersPreparing`/`setOrdersDelivery`/`setOrdersComplete`). **DELETE**: ⑪ 미입금 주문 완전삭제(od_status='주문'만 — 백업(serialize)→cart ct_status='삭제'→order DELETE, 코어 orderlistdelete.php 이식, `deleteUnpaidOrder`/`deleteOrders` 배치). 메일/SMS 는 sp-node 가 아니라 **PHP 브리지 재사용**(order-notify.php, 아래 8장). `lib/g5-db.ts` |
| `g5_member` (회원 정보·상태) | 그누보드 | sp-node 는 **관리자 API 한정**. read-only SELECT: ⑤ 견적 신청자 표시(mb_name/nick/email/hp/tel 최소 컬럼, `getMembersByIds`) · ⑧ 회원 관리 목록/상세(컬럼 화이트리스트 — 연락처·주소·수신동의·여분필드 mb_1~9 등, 민감 컬럼(mb_password·mb_dupinfo·mb_lost_certify·mb_certify·mb_email_certify2)은 SELECT 자체 배제, `searchMembers`/`getMemberDetailRow`). **UPDATE(화이트리스트)**: ⑨-a 차단/레벨(mb_intercept_date·mb_level — 가드 3종 탈퇴/self/cf_admin 409, `setMemberIntercept`/`setMemberLevel`) · ⑨-b 회원 정보/메모 편집(mb_name·mb_nick·mb_email·mb_hp·mb_tel·mb_zip1/2·mb_addr1~3·mb_addr_jibeon·mb_memo — 가드 2종 미존재 404+탈퇴 409, **self·cf_admin 허용**(권한 공격 벡터 아님), `updateMemberInfo`/`updateMemberMemo`). 코어 정합성(adm/member_form_update.php 이식): 닉/이메일/hp 중복 거부(⑧ COUNT)·hp 하이픈 정규화·zip 3+2 분해·주소 변경 시 mb_addr_jibeon 초기화·mb_nick_date 미갱신. 화이트리스트 밖 컬럼 쓰기 금지. `lib/g5-db.ts` |
| `g5_config` (사이트 기본설정) | 그누보드 | sp-node 는 **관리자 회원 관리 한정 read-only SELECT** — cf_admin(최고관리자 mb_id) 1컬럼만, 차단/레벨 변경의 cf_admin 가드용 (한정 예외 ⑧, `lib/g5-db.ts` `getCfAdminId`) |
| `g5_shop_default` (쇼핑몰 기본설정) | 영카트 코어 | sp-node 는 **관리자 견적서 한정 read-only SELECT** — de_admin_company_*/de_admin_info_*/de_bank_account 최소 컬럼, 견적서 발신처 표기용(하드코딩 대신 재사용) (한정 예외 ⑦, `lib/g5-db.ts` `getShopEstimateProfile`) |
| 회원/세션 | 그누보드 | sp-node 는 JWT 클레임으로만 **식별** (DB 직접 결합 없음 — 표시용 read-only 예외는 위 `g5_member` 행) |
| cart↔spec 관계 | **저장하지 않음** | `spec.ctId → g5_shop_cart` 조회 시점 조인으로 파생 — 동기화 로직 자체가 없어 불일치 불가능 |

## 6. 왜 이 구조인가 (요약된 결정 근거)

- **스냅샷 모델이 열쇠**: 영카트 cart/order 는 담는 시점 값을 복사하고 이후 상품을 다시 보지 않는다
  (`shop/cartupdate.php:291`). 그래서 "임의 가격의 행"을 밀어 넣어도 결제·정산·취소가 전부 정상 —
  인쇄·명함 등 주문제작형 영카트 사이트들의 검증된 패턴
- **cart 삭제는 훅 없이 흡수**: cart 행은 주문되면 삭제가 아니라 `ct_status='주문'` 이 된다.
  관계를 저장하지 않고 파생하므로 동기화 로직이 없고, 사용자가 cart 에서 지운 경우만
  조회 시점 지연 반영으로 보관함에 수거된다(기법 #10) — "삭제해도 견적은 유실되지 않는다"
- **한 건은 한 화면에만 (독립 모델)**: 견적관리 = 순수 견적, 장바구니·주문내역 = 담긴 이후,
  보관함 = 삭제분. 같은 건이 두 화면에 겹쳐 보이면 상태 동기화 문제가 UI 로 번지므로
  소속을 배타적으로 갈랐다. 두 화면의 카드 표현은 통일(공통 해부 + 뱃지/가격 자리만 상태 표현)
- **견적관리는 sp-php**: 사용자 노출 페이지는 결제 연계(세션·orderform)가 있는 PHP 영역이
  자연스러워 sp-vue 안을 폐기하고 `spcb/pages/`(코어 밖 커스텀)로 구현 — 레거시 `estimate_*` 는
  코어가 아닌 레거시 커스텀이라 subtree 에 없고, EAV 전제라 이식 가치도 없음
- 전체 결정 이력(폐기안 포함)은 `HANDOFF.md` 6장 결정 로그

## 7. 현재 상태와 남은 것

**동작 검증 완료 (2026-07-02, 실브라우저)**: 로그인 → 거버 업로드 → [주문하기] →
cart.php 에 "Standard PCB · <파일명>" 행 + 견적가 표시.

**2026-07-03 갱신**:
- 가격 엔진 **라이브 패리티 확립** — 가격 불일치의 원인이 가격표 스냅샷 드리프트로 판명
  (라이브는 관리자가 수시 조정). 라이브 표 동기화 + 실측 47케이스 패리티 테스트로 판매가·
  제작일·무게·eta 전항목 일치. eta 도 레거시 실동작(달력일+주말보정)으로 정정
- spec 파일 개수 키 **differentDesign 통일** — 거버 어댑터(`toProjectPayload.ts`)의
  `differentDesign→diffDesign` 역행 매핑 제거. ⚠ 이 키가 빠지면 "0원 → rfq(견적 대기)"로
  빠진다(실사고 있었음 — `docs/pricing-engine-parity.md` 증상 노트)
- **견적관리 완성** — `/shop/quotes`: cart 카드 문법 통일(썸네일·사양요약 `optionSummary`),
  수량 인라인 재견적, [바로 주문](행 단위 `ct_select`), 툴바 [선택삭제]/[비우기].
  cart 견적 행의 [선택사항수정] 선형 곱 버그는 테마 스킨 분기로 차단(기법 #8)
- **지난 견적 보관함** — `/shop/quotes/archive` + 독립 모델(3장 ⑤): 장바구니 삭제는
  lazy reconcile 로 수거, 보관함 [영구 삭제]는 실파일 선삭제 → DB 파기(멱등 재시도)
- **관리자 견적 관리** — `/app/admin/quotes` (sp-vue 첫 실기능, 기존 "남은 것 ②③" 구현):
  전 사용자 목록(상태 탭+카운트·회원ID/프로젝트명 검색·기간·카테고리·보관함 토글·오프셋
  페이지네이션) + 상세 드로어(사양 전체·거버 원본 다운로드·견적 스냅샷·신청자) +
  **가격 확정 rfq→quoted**(priced 수동 조정·quoted 재확정 포함 — `finalPrice`/`pricedBy`/
  `pricedAt` 기록, 담김(cart)·주문됨(ordered)은 409 거부). 서버 경계는 신규 `requireAdmin`
  데코레이터(JWT `isAdmin` 클레임 — 첫 사용). 확정가는 기존 `finalPrice ?? autoPrice`
  우선순위를 타고 사용자 견적관리·담기·주문 금액에 즉시 반영된다. 신청자 표시를 위해
  g5 한정 예외에 ⑤ `g5_member` read-only SELECT 추가(5장). rfq 대기 수 뱃지는 관리자
  **사이드바**에 구현. 관리자 목록 GET 은 lazy reconcile 을 하지 않는다(읽기가 타 사용자
  데이터를 변경하지 않도록 — 유령 건은 가격 확정 시도 시점에 정리·409).

- **장바구니 인라인 수량변경** — `theme/sp-lite/shop/cart.php`: 견적 행을 건별(ct_id)
  카드로 분리하고 수량 입력 → `PATCH /:id` 서버 재견적 → 담긴 cart 행 동기화(io_price/
  ct_option/옵션 행). 주문·삭제도 ct_id 단위 sp-node(`/order`·`DELETE /:id`). 담긴 상태의
  PATCH/DELETE 거부(IN_CART)는 제거하고 재견적 시 rfq 로 떨어지는 수량만 거부
  (REQUOTE_RFQ_IN_CART). 카드 보강 데이터는 신규 `GET /pcb-projects/cart-items`
  (ct_id별 실수량·projectId·거버 썸네일). g5 쓰기 한정 예외에 ⑥(cart 행 UPDATE/DELETE) 추가.
  ⚠ 실브라우저 end-to-end 재검증 미완(코드/타입체크/lint 통과 기준).

**2026-07-04 갱신**:
- **견적 수신처 회사명 2층 구조** — 관리자 견적서(A4) 수신처 "회사명"이 저장 없는 수기
  입력뿐이던 문제를 2층으로 해결. ① `SpOrderSpec.companyName`(문서 스냅샷 — 견적서에
  박제) ② `SpMemberProfile`(회원별 기본값 — 관리자가 저장하면 기억해 같은 회원의 다음
  견적서에 프리필). 해석 규칙(서버 공통) = `스냅샷 ?? (회원이면)프로필`. 신규 `PATCH
  /api/admin/pcb-projects/:id/company-name`(빈 값=스냅샷 삭제, 값+회원이면 프로필 upsert;
  삭제는 프로필 불변). /price 와 달리 **status/cart 가드 없음**(회사명은 문서 메타데이터라
  담김·주문·보관 무관). 상세·estimate GET 응답에 해석값 `companyName` 추가, 드로어 신청자
  카드에 회사명 저장 UI, 견적서 시트 `recipientCompany` 프리필. 레거시 여분필드(mb_1/mb_2)
  해킹을 반복하지 않기로 한 결정(2026-07-04)의 신규 구현. 마이그레이션은 공유 DB drift 로
  `migrate dev` 가 전체 reset 을 요구하므로 추가 전용 migration.sql + `migrate deploy` 로
  적용(결정 로그 7 관례 — `HANDOFF.md`). ⚠ 사용자측 신청 폼 수집은 다음 단계.
- **관리자 회원 관리** — `/app/admin/members` (sp-vue): 레거시 `/adm/member_list.php` 를 sp-vue
  로 재구성(디자인·노출 필드는 답습하지 않음). 전 회원 목록(상태 탭 **배타 집계**(정상/차단/
  탈퇴)·통합검색(아이디/이름/닉네임/이메일/휴대폰, **LIKE 특수문자 escape**)·가입일 기간·정렬
  (가입일↓/최근접속↓)·오프셋 페이지네이션) + 상세 드로어(연락/주소·수신동의·이메일 인증일·
  **레거시 사업자 정보**(mb_1~9 라벨 복원 read-only)·관리자 메모·최근 견적 5건 + [견적 관리에서
  검색] + [그누보드 관리자에서 열기]) + **sp 프로필 회사명 저장**(2층 구조의 프로필층 — 저장 시
  ['admin','quotes']까지 무효화해 견적 관리 해석값 연동) + **관리 작업 g5 쓰기 2종**: 차단/해제
  (mb_intercept_date=KST 오늘 YYYYMMDD)·레벨 변경(mb_level 1~10). 가드 3종(탈퇴 409 LEFT_MEMBER /
  자기 자신 409 SELF_FORBIDDEN / cf_admin 계정 409 ADMIN_PROTECTED, 이 순서). g5 한정 예외에 ⑧
  (g5_member·g5_config read-only SELECT — 민감 컬럼(비밀번호·dupinfo·인증)은 SELECT 자체 배제)·
  ⑨(g5_member 2컬럼 UPDATE)를 추가(5장). 삭제·본인확인·포인트·엑셀·일괄수정·회원 추가는 그누보드
  관리자(/adm 병행 존속)에 위임(드로어 링크). 운영 커스텀 컬럼(mb_partner_auth, mb_11~20)은 로컬
  신설 DB 에 없어 참조 안 함. 차단 즉시효력: PHP 는 매 요청 intercept 검사로 즉시, sp JWT 는 최대
  10분 잔존 후 me.php 재발급 거부(수용). `kstDateStr` 은 `lib/kst.ts` 로 추출해 견적서 라우트와 공유.

남은 것(우선순위): ① 전 메뉴 실전송 검증(standard 만 완료) ② rfq 대기 수 **사용자측**
sp-php 헤더 뱃지(관리자 사이드바 뱃지는 구현됨) + quoted 견적의 사용자발 재견적 요청
플로우 ③ **사용자측 신청 폼 회사명 수집** — 거버 제출/신청 시 회사명을 받아 `SpMemberProfile`
프로필로 프리필·최종 기억(관리자측 2층은 구현됨, 수집 진입점만 남음) ④ 파일 삭제 API 접근
제한(5장 ⚠) ⑤ 운영 전환(거버 prod 분기·운영 nginx `/api`) — 상세 체크리스트는 `HANDOFF.md` 7장.

## 8. 관련 파일 색인

| 역할 | 위치 |
|---|---|
| 인증 브리지 | `samplepcb-web/spcb/api/me.php` |
| 담기·목록·주문·재견적·삭제 API | `samplepcb-web-mono-app/apps/api/src/routes/pcb-projects.ts` |
| 견적관리 페이지 | `samplepcb-web/spcb/pages/quotes.php` (`/shop/quotes` — 루트 `.htaccess` 라우팅) |
| 지난 견적 보관함 | `samplepcb-web/spcb/pages/quotes-archive.php` (`/shop/quotes/archive`) |
| 장바구니 테마 스킨 | `samplepcb-web/theme/sp-lite/shop/cart.php` (견적 행 분기) · `css/default_shop.css` |
| 가격 엔진 (+골든 테스트) | `…/apps/api/src/pricing/engine.ts` · `engine.test.ts` · `pricing-data.json` |
| 가격 패리티 (실측 대조) | `…/apps/api/src/pricing/legacy-parity.test.ts` · `__fixtures__/legacy-pricing-goldens.json` · `docs/pricing-engine-parity.md` |
| 가격표 동기화·캡처 | `…/apps/api/src/scripts/sync-pricing-data.ts` · `capture-legacy-pricing-goldens.ts` (`pnpm pricing:sync` / `pricing:capture`) |
| 거버 payload 어댑터 | `samplepcb_gerber/apps/view/src/ResultPanel/toProjectPayload.ts` (별도 repo) |
| 파일서버 클라이언트 | `…/apps/api/src/lib/file-server.ts` |
| g5 접근(한정 예외) | `…/apps/api/src/lib/g5-db.ts` |
| 관리자 견적 관리 API | `…/apps/api/src/routes/admin-pcb-projects.ts` (가드: `plugins/auth.ts` `requireAdmin`) |
| 관리자 견적 관리 화면 | `…/apps/web/src/pages/admin/AdminQuotes.vue` · `components/admin/Quote*.vue` · `admin/useAdminQuotes.ts` |
| 관리자 회원 관리 API | `…/apps/api/src/routes/admin-members.ts` (가드: `requireAdmin` · g5 접근: `g5-db.ts` 예외 ⑧⑨) |
| 관리자 회원 관리 화면 | `…/apps/web/src/pages/admin/AdminMembers.vue` · `components/admin/Member*.vue` · `admin/useAdminMembers.ts` |
| 관리자 주문내역 API (읽기+쓰기) | `…/apps/api/src/routes/admin-orders.ts` (가드: `requireAdmin` · g5 접근: `g5-db.ts` 예외 ⑫ 읽기·⑬ 상태 전이/삭제 · 순수 로직 테스트 `g5-db.test.ts`: WHERE 빌더·`computeOrderMoney`·`orderTransitionGuard`·`matchDeliveryRows`·`phpRound`) |
| 주문 알림 브리지 (PHP) | `samplepcb-web/spcb/api/order-notify.php` (`POST /spcb/api/order-notify` — 서비스 JWT(svc:'sp-node') 검증 후 커스텀 메일 템플릿 `adm/shop_admin/ordermail.inc.php` 재사용·SMS conv_sms_contents 미러. dryRun 프리뷰 지원) · 서명 검증 `spcb/lib/jwt.php` `spcb_jwt_decode` |
| 주문 알림 브리지 클라이언트 (Node) | `…/apps/api/src/lib/php-bridge.ts` (`notifyOrderEvent` — 서비스 JWT `fastify.jwt.sign`, 타임아웃 10s, 실패는 'failed' 로 삼킴 → 전이 성공 불변) |
| KST 날짜 유틸(공유) | `…/apps/api/src/lib/kst.ts` (`kstDateStr` 견적서·`kstTodayYmd` 차단일) |
| 사양 요약 공용 헬퍼 | `…/apps/api/src/lib/option-summary.ts` (`buildOptionSummary` — cart·사용자·관리자 표기 통일) |
| DB 스키마 | `…/apps/api/prisma/schema.prisma` (sp_quote/sp_order_spec/sp_file) |
| 요청 계약 | `…/packages/api-contract/src/schemas/pcb-project.ts` · `auth.ts` · `admin.ts`(견적 관리) · `members.ts`(회원 관리) |
| 템플릿 상품 시드 | `…/apps/api/src/scripts/seed-template-items.ts` |
| 거버 제출부 | `samplepcb_gerber/apps/view/src/ResultPanel/submit.tsx` (별도 repo) |
