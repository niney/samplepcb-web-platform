# SmartSMT 연동 (로그인 인계 · 견적서 수신 · 관리자 화면)

> **1차 구현 완료 (2026-11-14).** 로그인 인계 · 토큰 · 견적서 수신 · 가져오기 · 관리자 화면까지 만들었다(§8).
> 남은 것은 개발 서버 배포와, SmartSMT 회신(로그인 수신 주소 · 실제 견본 견적서)을 받아 맞추는 일.
> 결정 대기 항목은 §7, SmartSMT 에 물어야 할 것은 §6.
> 근거 문서(리포 밖, `.tmp/smt/`): `2026-11-13_smartSMT_API_요청주소.xlsx`(판 0.1),
> `2026-10-20_smartSMT_견적서_포맷_v0.3.xlsx`(판 0.3, 본문 날짜 2026-10-22).
> 다시 읽을 때: `node .tmp/smt-tools/dump-xlsx.cjs <apps/api 절대경로> <xlsx…>`.
>
> **인증은 SmartSMT 원문(`X-API-Key`)을 따르지 않는다(2026-11-13 사용자 결정) — §4.2.**
> SmartSMT 에 보낼 요청서는 `docs/SMARTSMT_AUTH_REQUEST.html`(판 0.1, 아직 전달 전). 인증 규격은 그 문서가 정본이다.

## 1. 한눈에

```
회원 브라우저 ──(A) 로그인 인계: samplepcb 가 로그인 확인 → 2분짜리 토큰을 주소에 실어 SmartSMT 로 ──▶ SmartSMT
SmartSMT 서버 ──(B) 견적서 전송 POST multipart, Authorization: Bearer ──▶ sp-node 수신 주소
                    envelope(JSON) + quote_id + order_id + gerber_archive + bom + cpl
sp-node ──(C) 견적서 가져가기 GET /api/pricing/envelope?orderId= (Bearer, 파일 없음) ──▶ SmartSMT
관리자(/app/admin/smt) ── 받은 견적 목록 · 상세 · 다시 가져오기 · 수신 기록
```

- 지금까지 견적·주문은 이 플랫폼 안에서 만들었다(PCB 거버, 스마트 BOM). SmartSMT 는 **바깥에서 계산을
  끝낸 견적서가 들어오는** 첫 축이다. sp-node 는 계산하지 않고 받은 값을 그대로 보관·표시한다.
- **고객은 우리 로그인으로 SmartSMT 를 쓴다**(2026-11-13 사용자 확인).
- SmartSMT 주소는 `https://smteyes.samplepcb.co.kr`(2026-11-18 부터 — 화면과 API 모두, §8 "SmartSMT 회신과 그 뒤").
  처음에는 개발 서버 `http://1.255.226.33:8090`(평문 HTTP)였다. 2026-11-13 실측: 키 없이
  조회하면 `403 {"detail":{"reason":"BAD_KEY","message":"키가 맞지 않습니다"}}` — 사유는 `detail.reason` 에 있다(문서 미기재).

## 2. SmartSMT 원문이 말하는 것

인증(`X-API-Key`, 견적서 안 `signature`, 서명 확인 호출)은 §4.2 로 대체한다. 나머지는 그대로 따른다.

**전송(SmartSMT → 우리)**: POST, `multipart/form-data`, 타임아웃 10초(보내는 쪽 설정값),
**재시도 없음**(실패하면 담당자가 다시 보냄). 성공 판정은 2xx 뿐이고 본문은 보지 않는다. 실패는 화면에
`HTTP_<코드>` 로 뜬다. 확정되지 않은 견적(`NOT_PUBLISHABLE`)은 보내지 않는다.

| 파트 | 종류 | 내용 |
|---|---|---|
| `envelope` | 값 `application/json` | 견적서 |
| `quote_id` · `order_id` | 값 `text/plain` | 견적 번호 · 주문 번호 |
| `gerber_archive` · `bom` · `cpl` | 파일 | 고객 제조 파일 묶음 · BOM · 금액 계산에 쓴 CPL |

**같은 주문을 다시 보내면** `order_id` 는 같고 `quote_id` · `header.made_at` 은 다르다 → 주문 1 : 견적 N.

**가져가기 응답**: 200 견적서 JSON / 404 주문 없음·만료(**보관 24시간**) /
409 `NO_INPUTS`(담당자 계산 전) · `NOT_PUBLISHABLE`(확정 전).

**견적서 뼈대** (`kind="smartsmt.quote"`, `envelope_version="3"`):
- `header` — 번호·시각(`quote_id`·`order_id`·`made_at`), 통화(`currency`·`fx_rate`·`fx_at`·`lang`), 요율 판
  (`pricing_model_version`·`policy_version`·`catalog_version`·`calculator_version`·`policy_is_default`),
  `controls`(30칸)·`customs`·`disabled`·`volume_factor`, 사람이 정한 값(`strategy`·`order_scenario`·
  `assembly_sides`·`reflow_atmosphere`·`parts_supply`·`metal_mask_*`·`processes` …), `quantities`(7칸),
  고객이 쓴 것(`quote_request`·`due_date`·`remark`·`remark_warn`), `files`(part·name·bytes·sha256).
- `quote` — `quote_status`(`CALCULATED`|`REVIEW_REQUIRED`), 세는 값, 금액(`direct_cost`→`indirect_cost`→
  `profit`→`supply_price`→`vat`→`total`), `lines`(17칸), `subtotals`, `input_warnings`, `integrated`.
- `quote.integrated` — `totals`(supply_price·vat·total), `blocked_by`, `known`, `blocks`(PCB/PARTS/SHIPPING).
- `signature` — `{algorithm:"HMAC-SHA256", value}` 또는 null. **우리는 지금 쓰지 않는다.**

**금액을 읽는 법**
- **최종 금액 = `quote.integrated.totals.total`**. `quote.total` 은 SMT 작업비만(PCB·부품·배송 제외).
- `known_subtotal` · `integrated.known.sum` 은 참고값이다.
- `null` = 미정, `0` = 0원. 화면에서 둘을 섞지 않는다.
- 블록 `reason` 11종은 "합계에 드는가"가 정해져 있다(예: `QTY_UNVERIFIED` 는 금액은 있어도 합계에 안 든다).
- `controls` 의 % 는 숫자 그대로(10 = 10%), 피치는 nm.

**관리자 전용 값** — `labor_charge`(전달 전용 · 고객용 사본 제외), `user_edits`(담당자 메모 · `owner_mb_id`).
나중에 고객 화면을 붙일 때 이 값이 새지 않도록 관리자용 응답과 고객용 응답을 처음부터 나눈다.

## 3. 범위

**P0 (초반 구현)**
1. 로그인 인계 — 우리 로그인으로 SmartSMT 에 들어가는 주소 하나(§4.2).
2. 수신 주소 — 견적서와 파일을 받아 보관한다. 수신 시도는 성공·실패 모두 기록한다.
3. 가져오기 — 관리자가 주문 번호로 견적서를 당겨 온다(파일 없음).
4. 관리자 화면 — 목록, 상세, 연동 상태.

**P0 밖**: 고객 화면 노출, 영카트 주문·결제 전환, 알림 메일, 요율·제어값 되보내기(API 없음, §6-7),
견적서 서명 확인(§4.2 "나중에").

## 4. 설계 (권장안)

### 4.1 저장 — Prisma 추가형, `migrate deploy` 만

| 표 | 역할 |
|---|---|
| `sp_smt_order` | 주문 1건(`orderId` 유니크). 최신 견적 연결, 주인(`ownerMbId`·`ownerName`), 처음·마지막 수신 시각, 관리자 메모 |
| `sp_smt_quote` | 견적 1건(`quoteId` 유니크). 받은 견적서 JSON(MEDIUMTEXT) + 목록·정렬용 승격 열(`madeAt`·`currency`·`strategy`·`quoteStatus`·수량·`smtTotal`·`finalTotal`·`blockedBy`) + 출처(`push`\|`pull`) + 파일 대조 결과 |
| `sp_smt_receive_log` | 수신 시도 1건. 결과(받음·인증 실패·형식 오류·해시 불일치·파일 저장 실패·중복), 돌려준 HTTP 코드, 걸린 시간, 크기, 보낸 주소 |
| `sp_file`(기존) | 동봉 파일. `refType='sp_smt_quote'`, `fileType`=gerber\|bom\|cpl, 파일서버 serviceType 은 새로 정한다 |

- 목록 조회는 견적서 JSON 열을 읽지 않는다(승격 열만).
- 같은 `quoteId` 가 다시 오면 덮어쓰지 않고 2xx 로 받은 것으로 답한다(기록에는 중복으로 남김).
- `ownerMbId` 는 견적서의 `owner_mb_id`(= 로그인 토큰의 `sub`)에서 온다. 수신 때 우리 회원인지 대조해 표시한다.

### 4.2 인증 — 공유 비밀 하나 + 2분짜리 JWT (HS256)

SmartSMT 에 전달하는 규격은 `docs/SMARTSMT_AUTH_REQUEST.html` 이 정본이다. 여기에는 결정 근거와 우리 쪽 구현 메모를 둔다.

**방식**: 두 서버가 SmartSMT 전용 비밀 문자열 하나를 나눠 갖는다. 비밀을 그대로 보내지 않고, 그것으로 서명한 토큰을 보낸다.

| 쓰임 | `iss` | `aud` | 싣는 곳 |
|---|---|---|---|
| 회원 로그인 인계 | `samplepcb` | `smartsmt-login` | 주소의 `token` 파라미터 |
| 우리 → SmartSMT 호출 | `samplepcb` | `smartsmt` | `Authorization: Bearer` |
| SmartSMT → 우리 호출 | `smartsmt` | `samplepcb` | `Authorization: Bearer` |

- 공통 칸 `iss`·`aud`·`iat`·`exp`(= iat + 120). 로그인 토큰만 `sub`(회원 아이디)·`name`.
- 받는 쪽은 자기 자리에 맞는 `aud` 만 받는다 — 로그인 토큰과 호출 토큰이 서로 바뀌어 쓰이지 않는다.
- 넘기는 회원 정보는 아이디·이름(늘) + 회사명·연락처·이메일(값이 있을 때만, 2026-11-18 SmartSMT 요청 — §8 "회신 준비"). 부서·관리자 여부는 넘기지 않는다.

**결정 경과 (2026-11-13)** — 같은 논의를 반복하지 않도록 남긴다.

| 안 | 결과 | 이유 |
|---|---|---|
| ES256 키 쌍 교환 + 본문 해시 | 기각 | 사용자 판단: 지금 단계에 너무 복잡하다 |
| `X-API-Key` 고정 키 + 1회용 코드 교환 | 채택 안 함 | SmartSMT 가 HTTP 라 키가 그대로 드러난다. 로그인에 SmartSMT→우리 서버 호출이 필요해 로컬 개발기로 시험할 수 없다 |
| `JWT_SECRET` 을 SmartSMT 와 공유 | 기각 | 더 단순해지지 않는다(설정 한 줄 차이). 그 값을 가진 쪽은 로그인 없이 관리자 토큰을 만들 수 있고(`plugins/auth.ts` 는 서명만 믿는다), 주문 알림 호출·썸네일 서명도 같은 값이다 |
| **별도 공유 비밀 + HS256 JWT** | **채택** | 비밀이 전송되지 않는다. 로그인에 서버 간 호출이 없다. 양쪽 구현이 몇 줄이다 |

**우리 쪽 구현**
- **인계 주소** `GET /spcb/sso/smartsmt?state=`(sp-php, `spcb/` 아래 — 코어 비수정):
  그누보드 세션 확인 → 비로그인이면 그누보드 로그인 화면을 거쳐 돌아옴 → `spcb_jwt_encode()`(기존 `spcb/lib/jwt.php`)로
  로그인 토큰 발급 → 등록된 로그인 수신 주소로 302. `state` 는 `^[A-Za-z0-9_-]{0,200}$` 만 받고 그대로 돌려준다.
  로그인 수신 주소는 설정값이고 요청 파라미터로 받지 않는다.
- **호출 토큰 검사·발급**(sp-node, `lib/smartsmt-token.ts`): 수신 라우트는 본문을 읽기 전(`onRequest`)에 검사한다.
  `@fastify/jwt` 는 `JWT_SECRET` 으로 등록돼 있으므로 쓰지 않고 `node:crypto` 로 따로 서명·검증한다 — 두 비밀이 한 코드 길에서
  섞일 여지를 없앤다. 요청서 7.3 의 검증 견본을 단위 테스트가 그대로 돌린다.
- **설정**: sp-node `.env` 에 `SMARTSMT_BASE_URL` · `SMARTSMT_SHARED_SECRET` · `SMARTSMT_TIMEOUT_MS`,
  sp-php `spcb/lib/secret.php` 에 같은 비밀과 로그인 수신 주소. **`JWT_SECRET` 과 반드시 다른 값**,
  개발용과 운영용도 다른 값. 비밀은 DB·화면에 두지 않는다.
- **요청서의 견본 토큰**: `.tmp/smt-tools/make-example-token.cjs` 로 만들었다(견본 비밀은 문서 전용).
  요청서를 고친 뒤에는 `.tmp/smt-tools/check-auth-doc.cjs` 로 문서 속 값이 여전히 검증되는지 확인한다.

**감수하는 것**
- 비밀이 새면 교체 전까지 가짜 견적을 넣을 수 있다. P0 는 관리자 화면까지만이라 피해가 한정된다.
- 로그인 토큰이 주소에 실린다. 2분 안에 그 주소를 본 사람은 SmartSMT 에 그 회원으로 들어갈 수 있다.
  HTTP 단계에서는 SmartSMT 세션 쿠키가 어차피 보이므로 추가 위험이 아니다.
- 양쪽 서버 시계가 2분 넘게 어긋나면 실패한다.

**나중에** (구조를 바꾸지 않고 붙일 수 있다)
- HTTPS 전환 — **실제 고객 오픈 전 필수**. 그때 비밀도 새 값으로 바꾼다. 그 전에는 시험 계정·시험 파일만 쓴다.
- 로그인 토큰 1회용 처리, nginx 에서 `/api/smartsmt/` 를 SmartSMT 서버 IP 로 제한.
- 견적서 본문 서명 — 견적을 주문·결제로 잇기 전에 다시 검토한다.

**회원 정보 제공 고지·동의**: 지금은 절차를 두지 않는다. 나중에 고려한다(2026-11-13 사용자 결정).

**개발용 공유 비밀**: 2026-11-13 발급해 `apps/api/.env` 의 `SMARTSMT_SHARED_SECRET` 에 넣었다(64자, `JWT_SECRET` 과 다른 값).
SmartSMT 에는 이 값을 요청서와 별도 경로로 전달한다. sp-php `spcb/lib/secret.php` 에는 인계 주소를 만들 때 같은 값을 넣는다.

### 4.3 계약 — `@sp/api-contract` `smartsmt.ts`

- 받는 스키마는 **느슨하게**. 반드시 검사: `kind`, `envelope_version`, `header.quote_id`, `header.order_id`,
  `header.made_at`, `quote` 존재, multipart 의 `quote_id`·`order_id` 와 `header` 값 일치.
- 코드 값(`basis` 16종, `lines.status`, 블록 `reason` 11종 …)은 `z.enum` 으로 막지 않는다 — 모르는 값은
  코드 그대로 보여 준다. 재시도가 없으므로 "모르는 값이라 거절"은 데이터 유실이다.
- `rates` 는 칸 수가 고정이 아니고 **모르는 키도 보관**한다(문서 명시). 견적서 JSON 을 통째로 보관하면 충족된다.
- 한국어 라벨 사전(basis·status·reason)은 계약 패키지 한 곳에 둔다.

### 4.4 수신 라우트 — `POST /api/smartsmt/quotes`

순서: ① 토큰 검사(본문을 읽기 **전**. 비밀 미설정이면 503) → ② multipart 읽기 → ③ 최소 검증 →
④ 파일별 `bytes`·`sha256` 대조 → ⑤ 파일서버 저장 → ⑥ DB 저장 → ⑦ 2xx.

- **`envelope` 파트는 객체로 온다(확인됨)**: `@fastify/multipart` 10.0.0 은 `application/json` 값 파트를
  `secureJSON.parse` 로 객체로 바꿔 넘긴다(index.js 312–326). 기존 `collectMultipart`(lib/market.ts)는 문자열이
  아닌 값을 버리므로 그대로 쓰면 견적서가 사라진다. 이 라우트는 객체를 받아 `JSON.stringify` 로 보관한다.
  값 파트 기본 한도 1MB 도 함께 올린다.
- **10초 · 재시도 없음**: 파일서버 전송은 파일당 1요청 순차라 큰 거버 묶음은 10초를 넘길 수 있다.
  P0 는 동기 저장으로 가되 걸린 시간을 수신 기록에 남긴다. **타임아웃 상향은 미리 요청하지 않는다 — 실제로
  문제가 보이면 그때 요청한다(2026-11-13 사용자 결정).** 그때의 선택지는 SmartSMT 쪽 상향 또는
  "로컬 임시 보관 → 2xx → 뒤에서 파일서버로 옮김"이다.
- 파일 저장이 실패하면 견적만 반쪽으로 남기지 않고 2xx 가 아닌 코드로 답한다(담당자가 다시 보내도록).
- 실패 응답 본문은 SmartSMT 와 같은 모양 `{"detail":{"reason","message"}}` 으로 맞춘다.

### 4.5 관리자 라우트 — `/api/admin/smt/*` (requireAdmin)

목록 · 상세(견적서 파싱 결과 + 같은 주문의 견적 이력) · 파일 내려받기(서버 경유) · 가져오기 ·
수신 기록 · 연동 상태(주소·비밀 설정 여부만, 값은 내보내지 않음).

### 4.6 관리자 화면 — 새 모듈 `smt` (`src/next`, shadcn)

| 화면 | 경로 · 이름 | 내용 |
|---|---|---|
| 받은 견적 | `/admin/smt/quotes` · `admin-smt-quotes` | 주문 단위 한 줄(최신 견적). 주문 번호 · 고객 · 샘플/양산 · 수량 · 최종 금액 · 상태 · 받은 시각. 탭: 전체 / 검토 필요 / 합계 막힘 |
| 견적 상세 | `/admin/smt/quotes/:id` · `admin-smt-quote` | 머리(번호·시각·요율 판) · 수량 · 견적 줄 표(묶음 소계) · 통합 합계(블록별 사유) · 경고 · 동봉 파일 · 견적 이력 · 원문 보기 · 다시 가져오기 |
| 연동 상태 | `/admin/smt/link` · `admin-smt-link` | 설정 여부 · 시험 호출 · 수신 기록 · 우리 수신 주소 표시 |

손댈 곳: `admin/menu.ts`(`AdminModuleKey`·`adminModules`·`resolveAdminModuleKey`), `next/admin-menu.ts`
(`NextModuleKey`·모듈 정의·`resolveNextModuleKey`·`nextModuleOf`), 새 `next/smt-navigation.ts`, `router.ts`,
`i18n/locales/{ko,en}.ts`, `next/pages/smt/*`, `next/components/smt/*`(배지 사전). 화면 규약은 `docs/ADMIN_NEXT_UI.md`.

### 4.7 시험

- **로그인 인계는 로컬 개발기로 바로 시험할 수 있다** — 브라우저만 두 사이트를 오간다.
- **견적서 전송은 SmartSMT 개발 서버가 로컬 개발기를 부를 수 없다** → 보내는 쪽 흉내 스크립트(multipart · 토큰 ·
  파일 3개)를 만든다. 견본 견적서는 SmartSMT 에서 받는다(§6-1).
- 단위·계약: 서버를 띄우지 않는 inject 하네스로 토큰 없음 · 만료 · `aud` 불일치 · 번호 불일치 · 해시 불일치 · 중복.
- 화면: e2e(playwright-core + `/spcb/api/me` 스텁).

## 5. 검토 의견 (위험 순)

1. **HTTP 구간은 인증 방식과 무관하게 다 보인다.** SmartSMT 세션 쿠키와 고객이 올린 거버·BOM 이 해당한다.
   실제 고객 오픈의 조건은 SmartSMT 의 HTTPS 전환이다.
2. **재시도가 없으니 수신은 "가능하면 받는다".** 모르는 코드·모르는 판은 거절하지 않고 받아서 표시를 줄인다.
   거절은 인증·형식·해시 불일치뿐이다. 24시간 안에는 가져오기로 견적서는 되살릴 수 있지만 **파일은 전송으로만 온다**.
3. **10초 타임아웃과 파일서버 순차 전송이 부딪친다**(§4.4). 저장은 됐는데 보내는 쪽이 실패로 보면 담당자가
   다시 보내 견적이 한 벌 더 생긴다. 해롭지는 않지만 수신 기록 없이는 원인을 못 찾는다.
4. **SmartSMT 용 비밀은 `JWT_SECRET` 과 달라야 한다.** 운영에 올릴 때 같은 값을 넣는 실수가 가장 위험하다 —
   설정 이름을 처음부터 따로 둔다.
5. **최종 금액을 잘못 고르기 쉽다.** `quote.total` 이 아니라 `integrated.totals.total`. `blocked_by` 가 비어 있지
   않으면 "합계 미확정"으로 보인다.
6. **문서에 빈 곳이 많다**(§6-2). 전체 예시 JSON 이 없어 지금은 뼈대만 확정할 수 있다. 화면의 세부 칸은 견본을
   받은 뒤 맞춘다.
7. **견적의 주인은 `owner_mb_id` 로만 이어진다.** 로그인 인계가 붙기 전에 만들어진 SmartSMT 주문에는 우리 회원
   아이디가 아닌 값이 들어 있을 수 있다 — 대조에 실패하면 연결하지 않고 글자로만 보인다.

## 6. SmartSMT 에 물어야 할 것

인증 관련 회신 항목(로그인 수신 주소 · 구현 가능 여부 · 회원 정보 항목 · 담당자 로그인 · 운영 환경)은
요청서 10장에 있다. 아래는 견적서 쪽 질문이다.

1. 실제 견적서 JSON 견본 2~3건(정상 · 검토 필요 · 합계 막힘)과 동봉 파일 견본.
2. 문서에 빠진 목록·위치: `lines.group` 값, 블록의 `request_status`·`valuation`·`completeness` 값,
   `input_warnings`·`blockers`·`quote_request` 구조, `files`·`user_edits`·`development_lines`·`rates`·
   `labor_charge` 가 JSON 어디에 있는지.
3. `order_id` 는 무엇을 가리키는가, 로그인 인계 전에 만들어진 주문의 `owner_mb_id` 는 어떤 값인가.
4. 다시 보낼 때 `quote_id` 가 항상 바뀌는가, 최신 판정 기준(`made_at`?), 취소·철회를 알려 주는가.
5. 파일 최대 크기, 파일 없이 보내는 경우가 있는가.
6. `envelope_version` 이 바뀔 때의 호환 규칙. 문서 날짜 불일치(파일명 10-20 · 본문 10-22),
   `policy_is_default` 예시가 문자열 `"false"` 인 점.
7. Rates 시트의 "모르는 키 보관 (되보낼 때 필요)" — 요율·제어값을 되보내는 API 계획이 있는가.
8. 404 의 "보관 24시간"은 언제부터 세는가.

## 7. 결정 (사용자)

**정해진 것 (2026-11-13)**
- 관리자 메뉴는 새 모듈 `SMT` 로 둔다.
- P0 범위는 §3 그대로.
- SmartSMT 고객 화면은 이 프로젝트에 없다 — samplepcb 화면에 SmartSMT 진입 메뉴를 걸지 않는다(SmartSMT 가 인계 주소로 보내는 쪽만 지원).

**남은 것**
- 요청서(`docs/SMARTSMT_AUTH_REQUEST.html`)와 개발용 공유 비밀을 SmartSMT 에 전달하는 시점.
- SmartSMT 가 견적서를 보낼 수 있는 우리 개발 서버 주소(로컬 개발기는 SmartSMT 서버에서 닿지 않는다).

## 8. 구현 현황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 로그인 인계 주소 `GET /spcb/sso/smartsmt` | 완료 |
| 2 | 토큰 만들기·검사 (sp-node) | 완료 |
| 3 | 저장 구조(표 3개) + 견적서 수신 `POST /api/smartsmt/quotes` + 수신 기록 | 완료 |
| 4 | 견적서 가져오기 `POST /api/admin/smt/pull` | API 완료(2026-11-13) — 관리자 화면의 버튼은 5단계와 함께. 실제 견적서 수신은 SmartSMT 가 토큰 검사로 바꾼 뒤 확인 |
| 5 | 관리자 화면(모듈 `SMT`: 받은 견적 · 견적 상세 · 연동 상태) | 완료(2026-11-14) — 칸 구성은 문서로 짠 가짜 견본 기준. 실제 견본이 오면 맞춘다 |

**파일**
- sp-php: `samplepcb-web/spcb/sso/smartsmt.php`, `spcb/lib/secret.php.example`(설정 항목 2개 추가)
- sp-node: `lib/smartsmt-token.ts`(토큰), `lib/smartsmt.ts`(읽기·대조·저장·수신 기록), `routes/smartsmt-inbound.ts`,
  `lib/smartsmt-sample.ts`(문서로 짠 **가짜** 견본), `scripts/smartsmt-send-sample.ts`
- 계약: `packages/api-contract/src/schemas/smartsmt.ts`
- DB: `prisma/migrations/20261113230000_smartsmt_inbound`(추가형 — 표 3개)
- 테스트: `lib/smartsmt-token.test.ts`(14) · `lib/smartsmt.test.ts`(10) · `routes/smartsmt-inbound.test.ts`(25),
  e2e `specs/smartsmt-sso.e2e.test.ts`(4, 실로그인)

**시험하는 법**
```bash
cd samplepcb-web-mono-app/apps/api
pnpm smartsmt:send-sample                       # 정상 견적서 1건 (주문 SIM-0001 에 새 견적)
pnpm smartsmt:send-sample --blocked --status=REVIEW_REQUIRED
pnpm smartsmt:send-sample --bad-hash            # 400 FILE_MISMATCH
pnpm smartsmt:send-sample --bad-token           # 401 BAD_TOKEN
cd ../../e2e && PORTAL_E2E=1 npx vitest run smartsmt-sso   # 로그인 인계 (302 를 따라가지 않는다)
```
흉내 스크립트는 파일 3개를 실제 파일서버에 올리고 `sp_smt_*` 에 행을 만든다. 관리자 화면이 생기기 전에는 치울 화면이 없다.

**실측으로 확인한 것**
- 파일서버가 serviceType `smt` 를 받는다(올리기 · 내려받기 · 지우기, 해시 일치).
- 실제 서버 · DB 로 보낸 여섯 경우가 기대대로 답한다: 정상 200 · 같은 견적 다시 200(duplicate) · 같은 주문의 새 견적 200(최신 견적이 바뀜) ·
  잘못된 토큰 401 · 파일 내용 바뀜 400 · 파일 없이 200. 수신 기록에 일곱 줄이 남았다. 확인 뒤 시험 행과 파일은 지웠다.
- 로그인 인계의 토큰은 SmartSMT 전용 비밀로만 검증되고 `JWT_SECRET` 으로는 검증되지 않는다(e2e 가 지킨다).

**가져오기 (4단계)**
- `POST /api/admin/smt/pull` `{orderId}`(requireAdmin) → sp-node 가 `GET {SMARTSMT_BASE_URL}/api/pricing/envelope?orderId=` 를
  `Authorization: Bearer`(iss=samplepcb, aud=smartsmt)로 부른다. 받은 견적서는 전송과 같은 길로 저장한다(출처 `pull`, 파일은 전부 `missing`,
  견적서는 받은 글자 그대로). 이미 가진 `quote_id` 면 저장하지 않고 `duplicate`.
- 파일: `lib/smartsmt-pull.ts` · `routes/admin-smt.ts` · 테스트 `lib/smartsmt-pull.test.ts`(18) · `routes/admin-smt.test.ts`(8).
- 실패 코드: `SMARTSMT_NOT_CONFIGURED`(503) · `SMARTSMT_UNREACHABLE`(502) · `SMARTSMT_AUTH_REJECTED`(502) ·
  `SMARTSMT_NOT_FOUND`(404, 보관 24시간) · `SMARTSMT_NOT_READY`(409, 계산 전 · 확정 전) · `SMARTSMT_BAD_RESPONSE`(502).
- 물어본 주문과 다른 주문의 견적서가 오면 저장하지 않는다. 다른 주소로 넘기는 응답(3xx)은 따라가지 않는다(토큰이 엉뚱한 곳으로 가지 않게).
- 가져오기는 수신 기록(`sp_smt_receive_log`)에 남기지 않는다 — 그 원장은 SmartSMT 가 보낸 시도만 담는다. 결과는 화면 응답과 서버 로그에 남는다.
- 실측(2026-11-13): 실제 SmartSMT 개발 서버를 불렀더니 `403 BAD_KEY` 가 왔고 `502 SMARTSMT_AUTH_REJECTED (HTTP 403 · BAD_KEY)` 로 답했다.
  SmartSMT 가 아직 `X-API-Key` 방식이라서다 — 요청서대로 토큰 검사로 바뀌면 통한다.
- 설정: `SMARTSMT_BASE_URL`(비우면 503), `SMARTSMT_TIMEOUT_MS`(기본 10000).

**관리자 화면 (5단계)** — `/app/admin/smt/*`, 리뉴얼 셸(`src/next`)에만 있다(옛 화면 없음).
- API(`routes/admin-smt.ts`, 전부 requireAdmin): `GET /smt/orders`(탭 · 검색 · 탭별 건수) · `GET /smt/quotes/:id`(견적서 전체 + 파일 + 이력) ·
  `GET /smt/files/:id`(서버 경유 내려받기 — SmartSMT 견적의 파일만) · `GET /smt/receive-logs` · `GET /smt/link-status` · `POST /smt/pull`.
  계약과 **라벨 사전**은 `packages/api-contract/src/schemas/smartsmt.ts`. 테스트 `routes/admin-smt.test.ts`(25).
- 화면: `next/pages/smt/SmtQuotesPage.vue`(받은 견적) · `SmtQuotePage.vue`(견적 상세) · `SmtLinkPage.vue`(연동 상태 + 수신 기록),
  조각 `next/components/smt/*`(`smt-envelope.ts` = 견적서를 타입 가드로 읽는 곳, `smt-badges.ts` = 배지 색, `useAdminSmt.ts` = 서버 상태 훅),
  배선 `next/smt-navigation.ts` · `next/admin-menu.ts` · `admin/menu.ts` · `router.ts` · i18n.
- e2e `specs/admin-smt.e2e.test.ts`(8, `PORTAL_E2E=1`): 견적 4건을 수신 주소로 넣고 목록 · 상세 · 파일 내려받기 · 이력 · 연동 상태 · 가져오기 실패 문장을 보고,
  끝나면 자기가 만든 것만 지운다. 스크린샷은 `e2e/output/admin-smt-*.png`. 가져오기 단언은 실제 SmartSMT 개발 서버를 1회 부른다.
- 화면에서 정한 것:
  - 목록의 한 줄은 주문 1건, 금액 · 상태는 마지막에 받은 견적. 탭은 전체 / 검토 필요(`REVIEW_REQUIRED`) / **합계 미확정**(최종 금액이 null).
  - 최종 금액이 미정이면 "미정"이라 쓰고 SMT 작업비를 이름을 붙여 보조로 보인다(최종 금액으로 읽히지 않게).
  - 견적서의 `owner_mb_id` 가 우리 회원이 아니면 "회원 아님" 표지. 아이디가 없거나 회원 조회에 실패하면 표지를 달지 않는다(모름).
  - 상세의 칸 이름은 SmartSMT 「견적서 전송 양식」의 "뜻" 칸을 따른다. 사전에 없는 코드는 코드 그대로 보인다.
    블록의 `request_status` · `valuation` · `completeness` 는 값 목록을 받지 못해 코드 그대로다(§6-2).
  - 요율 · 제어값과 원문 JSON 은 접힌 채로 둔다. 원문에는 관리자 전용 값(`labor_charge` · `user_edits`)이 들어 있다.
  - 관리자 메모(`sp_smt_order.adminMemo`) 편집은 아직 없다.
- 견본 데이터로 화면 보기: `pnpm smartsmt:send-sample`(apps/api) 뒤 `/app/admin/smt/quotes`.

**구현하며 정한 것**
- 인증 실패 기록은 시간당 30건까지만 원장에 남긴다 — 바깥에서 얼마든지 만들 수 있는 요청이라서다.
- 같은 새 주문의 서로 다른 견적 두 건이 동시에 오면 주문 행에서 유니크 충돌이 난다. 중복으로 답하면 견적을 잃으므로 한 번 더 쓴다.
- 보낸 서버의 주소는 `X-Real-IP` 에서 읽는다(`lib/client-ip.ts`) — nginx 뒤라 `request.ip` 는 언제나 127.0.0.1 이다.
- 로그인 수신 주소는 우리가 정해서 알렸고(2026-11-14), SmartSMT 가 고객 화면 주소로 바꿔 달라고 회신했다(2026-11-18):
  **`https://smteyes.samplepcb.co.kr/auth/samplepcb`**. 수신 주소는 고객 화면과 같은 주소여야 세션 쿠키가 실린다.
- 요청서의 회신 항목은 셋으로 줄였다(2026-11-14): 보내 줄 것 = 실제 견적서 견본 하나, 다르면 알려 줄 것 = 로그인 수신 주소 · 회원 정보 항목.
  뺀 것 — 구현 가능 여부(어려우면 알려 올 내용), 운영 환경(오픈 전에 다시 묻는다), 담당자 로그인(권한은 SmartSMT 가 직접 관리한다고 요청서 4.4 에 적음).
- 요청서 5.1 "견적서 보내는 법"을 넣었다 — 보낼 주소 · 인증 헤더 · 파트 표 · 규칙 · curl 예시(로컬 서버로 실제 실행해 확인).

**SmartSMT 회신과 그 뒤 (2026-11-18)**
- SmartSMT 가 요청서대로 구현을 마쳤다. 화면과 API 가 **`https://smteyes.samplepcb.co.kr`** 로 옮겨졌다(옛 `http://1.255.226.33:8090` 도 같은 서버).
  실측: 로그인 수신 주소는 토큰이 없으면 `/?login_error=NO_TOKEN` 으로 돌려보내고, API 는 `X-API-Key` 대신 토큰을 검사한다 —
  우리 비밀로 만든 토큰은 통하고(없는 주문 → 404), 쓰임이 다른 토큰은 `WRONG_AUDIENCE`, 다른 비밀은 `BAD_TOKEN`.
  로컬 sp-node 에서 `POST /api/admin/smt/pull` 을 불러 `404 SMARTSMT_NOT_FOUND` 까지 확인했다(인증 통과).
  SmartSMT 의 404 본문은 `{"detail":"…"}`(글자)라서 `detail.reason` 이 없다 — 우리 쪽은 상태 코드로 가르므로 문제없다.
- **서버 설정 스크립트** `ops/scripts/smartsmt-server-config.mjs` — 서버의 `.env` · `secret.php` 는 git 이 추적하지 않아 손으로 고쳐야 했고,
  그 과정에서 서버 `.env` 의 `JWT_SECRET` 이 로컬 개발용 값으로 바뀌어 로그인한 모든 API 가 401 이 됐다(2026-11-17).
  스크립트가 두 파일을 한 번에 맞춘다: 로그인 토큰 비밀(두 파일이 같게), SmartSMT 공유 비밀(같게), 로그인 수신 주소, SmartSMT 주소.
  비밀 값은 찍지 않고 백업은 웹 밖(`~/samplepcb-config-backups`)에 둔다. 서버에서:
  ```bash
  cd /home/samplepcb/samplepcb-web-platform && git pull
  node ops/scripts/smartsmt-server-config.mjs            # 점검만
  node ops/scripts/smartsmt-server-config.mjs --apply    # 고친다
  sudo systemctl restart sp-api && sudo systemctl reload php8.1-fpm
  ```
  로그인 토큰 비밀이 둘 다 실제 값이거나 둘 다 개발용 자리표시 값이면 자동으로 고르지 않는다(`--jwt-from=php|env` · `--new-jwt-secret`).
- **`/spcb/api/me` 는 SmartSMT 화면에 토큰을 주지 않는다.** 이 주소는 `https://*.samplepcb.co.kr` 전체에 열려 있었는데(거버 뷰어용),
  `smteyes` 도 하위 도메인이라 그 화면의 스크립트가 로그인한 회원(관리자 포함)의 우리 토큰을 받을 수 있었다 — SmartSMT 용 비밀을 따로 둔
  취지가 무너진다. `me.php` 에서 `https://smteyes.samplepcb.co.kr` 만 막았다(e2e `smartsmt-sso` 가 지킨다). 허용 목록으로 바꾸려면
  거버 뷰어의 운영 주소를 알아야 한다(이 리포에 없다).
- SmartSMT 세션 쿠키는 `smteyes` 주소에만, 이름은 `PHPSESSID` 가 아닌 것으로 — 요청서 4.4 에 한 줄 넣었다(판 0.2).
  상위 도메인 전체에 같은 이름으로 심으면 우리 로그인이 풀린다(예전 사이트와 겪은 문제 — `spcb/lib/legacy-session-pick.php`).

**운영에 올릴 때**
1. `prisma migrate deploy`(표 3개).
2. 운영용 공유 비밀을 새로 만들어 `apps/api/.env` 의 `SMARTSMT_SHARED_SECRET` 과 `spcb/lib/secret.php` 의 `SPCB_SMARTSMT_SECRET` 에 같은 값으로 넣는다.
   개발용 값을 그대로 쓰지 않는다. `JWT_SECRET` 과 같은 값이면 두 주소 모두 503 으로 닫힌다.
3. `secret.php` 의 `SPCB_SMARTSMT_LOGIN_URL` 에 SmartSMT 운영 로그인 수신 주소를 넣는다.
4. `.env` 의 `SMARTSMT_BASE_URL` 에 SmartSMT 운영 주소를 넣는다(가져오기가 부른다).
5. SmartSMT 가 HTTPS 로 바뀌었는지 확인한다(§4.2 "나중에").

**개발 단계 배포 (2026-11-13 사용자 결정)** — `new.samplepcb.co.kr` · `centrafab.co.kr`(같은 서버, 아직 오픈 전)에 그대로 올려
SmartSMT 개발 서버와 맞춰 본다. 오픈 전이라 개발용 **SmartSMT 공유 비밀**을 그대로 쓴다: 위 1번을 한 뒤 서버에서
`node ops/scripts/smartsmt-server-config.mjs --apply` 를 돌린다(위 "서버 설정 스크립트").
⚠ **로컬 `.env` · `secret.php` 를 서버에 통째로 올리지 말 것** — 로그인 토큰 비밀(`JWT_SECRET`) · DB 주소 · 경로가 로컬 값으로 바뀐다.
**실제 오픈 전에는 2~5번을 다시 한다.**

### 실제 견적서에서 알게 된 것 (2026-11-18)

SmartSMT 가 서버(`new.samplepcb.co.kr`)로 실제 견적서를 보냈다 — 17:10 · 20:50 · 22:41 세 건, 모두 200 으로 받았고 저장한 파일의 sha256 이 견적서 값과 같다.
받은 견적서는 `envelope_version` **9** 로, 「견적서 전송 양식 0.3」과 다른 곳이 있다.

| 무엇 | 실제 견적서(판 9) | 우리 쪽 대응 |
|---|---|---|
| 확정 금액 | 세 건 모두 `REVIEW_REQUIRED` — `quote.total` · `integrated.totals.total` 이 전부 `null` | 그대로 "미정" |
| 추정 금액 | `quote.estimated_total`(SMT 작업비) · `integrated.totals.estimated_total`(통합) · `estimated_blocks` 가 따로 온다. 고객 화면의 "최종합계"가 이 값 | 열 2개 추가(`smtEstimatedTotal` · `finalEstimatedTotal`, 마이그레이션 `20261118230000_smartsmt_estimated_totals` — 이미 받은 견적도 채운다). 목록 · 상세 · 이력에 **"추정"** 이라고 이름 붙여 보인다 |
| 블록 | `blocks` 는 PCB · PARTS · SHIPPING. `DETAIL` 은 줄이 없고 SMT 작업비 자신을 가리킨다(`blocked_by` · `known.blocks` · `estimated_blocks`) | 블록 · 출처 · 요청 상태 · 금액 성격 · 완전성 · 공정 묶음에 한국어 이름(계약 사전) |
| 수량 | `quantities` 의 칸이 `make_set_qty` · `spare_set_qty` · `total_set_qty` · `price_set_qty` · `order_type` | 온 칸을 온 순서대로 보인다(양식 0.3 의 이름도 사전에 남김) |
| 주문 공정 | `header.processes` = `["pcb","parts","stencil","smt"]` 또는 `["smt"]` | 조건 맨 앞에 "주문 공정" |
| 고객 요청 | `quote_request` 가 `{text, mb_id, mb_name, updated_at}` 객체, `user_edits.preorder`(긴급 · 추가 요청 · 부품 형태) | 글(`text`)만 보이고 긴급 제작 · 추가 요청을 함께 |
| PCB 사양 | `user_edits.pcb_spec_inputs`(고객이 넣은 값, PCB 를 시켰을 때) | 주문 정보에 "PCB 사양 (고객 입력)" — 칸 이름은 SmartSMT 것 그대로 |
| 그 밖 | 파일 목록은 `header.files`, 맨 위 `signature` 는 `null`, `lang` 없음 | 변경 없음 |

⚠ **새 코드 값의 한국어 이름은 우리가 붙였다** — 양식 0.3 에 값 목록이 없다(`packages/api-contract` `smartsmt.ts` 의 "실제 견적서에서 본 코드").
SmartSMT 가 값 목록을 주면 그 뜻으로 고친다. 사전에 없는 값은 화면에 코드 그대로 나온다.

**SmartSMT 에 알리거나 물을 것**

1. 첨부는 세 번 모두 `gerber_archive` · `bom` **2개**였다. `cpl` 은 파트도 없고 `header.files` 에도 없다(고객이 파일 3개를 올린 주문 포함).
2. `GET /api/pricing/envelope` 는 **부를 때마다 견적번호(`quote_id`) · `made_at` 을 새로 만든다**(13초 간격 3번 = 번호 3개).
   우리는 `quote_id` 로 중복을 가리므로 "가져오기"를 누를 때마다 이력이 한 줄씩 는다. 내용이 같으면 같은 번호가 필요하다.
3. 주문이 금방 사라진다 — 17:10 에 보낸 주문을 21:40 에 가져오니 404 "세션이 없거나 만료"(안내는 24시간). 실패 본문도 `{"detail":"글자"}` 모양이다.
4. 2026-11-18 「확인 및 요청 사항 0.1」(로그인 토큰에 회사 · 부서 · 연락처 · 이메일 추가, 담당자 확정 견적을 `POST /api/pricing/received` 로 되돌려 보내기,
   `packing` · `stackup` · `report` 파트)은 **아직 결정 · 구현 전**이다. 담당자 확정은 "수정"이 아니라 미정 블록(부품 · 배송 · SMT 작업비)을 채우는 일이라
   범위(어느 칸을 우리가 바꾸는가)를 SmartSMT 와 먼저 맞춘다.

**서버 로그인이 30분쯤에 풀리던 것** — 연동과 무관한 서버 설정이다. `/etc/php/8.1/fpm/php.ini` 의 `session.gc_maxlifetime = 1440` 을
Ubuntu 세션 청소 타이머(매시 9 · 39분)가 그대로 써서, 24분 넘게 안 쓴 세션을 지운다(그누보드의 3시간 설정은 요청 처리 중에만 적용).
`10800` 으로 바꾸고 `php8.1-fpm` 을 다시 읽힌다. smteyes 로그인은 인계 뒤 SmartSMT 자체 세션이라 samplepcb 세션이 끝나도 남는다.

**운영 반영** — `prisma migrate deploy`(열 2개 추가 + 기존 견적 채우기) 뒤 API · 웹을 다시 올린다.

### 회신 준비 (2026-11-18 밤)

SmartSMT 「확인 및 요청 사항 0.1」에 답하면서 우리 쪽에서 할 수 있는 것을 먼저 했다. 전달 문서는 두 개다 —
`docs/SMARTSMT_REPLY.html`(회신, 판 0.1) · `docs/SMARTSMT_AUTH_REQUEST.html`(요청서, 판 0.3).

**사용자 결정**

| 건 | 결정 |
|---|---|
| 주문이 4시간 반 만에 사라진 것 | 일단 넘어간다(더 보고 판단). 회신에 넣지 않는다 |
| 견적서 양식(판 9) | 값 목록을 요구하지 않고 **받은 것을 보고 맞춘다** |
| 좌표 파일(`cpl`) | 수정을 요청한다 |
| 견적번호 | 고정을 요청하고, 어려우면 **samplepcb 가 관리**하자고 제안한다(양쪽 공통 열쇠는 주문 번호) |

**구현한 것**

- **파일 파트를 이름 규칙으로 받는다** — `gerber_archive` · `bom` · `cpl` 세 이름만 받던 것을 규칙으로 바꿨다:
  소문자로 시작 · 소문자·숫자·밑줄 · 32자(`SMARTSMT_FILE_PART_PATTERN`), 견적서 하나에 12개(`SMARTSMT_MAX_FILE_PARTS`).
  `packing` · `stackup` · `report` 는 견본이 없어 형식을 묻는 대신 이렇게 열어 두었다. 규칙에 맞지 않는 이름과 모르는 글자 파트는
  읽지 않고 수신 기록에 남긴다(200). 보관 종류(`sp_file.fileType`)는 `gerber_archive` 만 `gerber`, 나머지는 파트 이름 그대로.
- **형식 실측** — SmartSMT 화면이 받는 형식(7z · rar · tar · zip · xls · xlsx · csv · txt · pos)과 실제 좌표 파일(74,025바이트, CP949)을
  로컬 수신 주소로 보내 파일서버에서 되받아 해시를 대조했다(11개 모두 같음, `.tmp/smt-tools/ext-test.cjs`). 요청 전체 한도는 nginx 100MB.
- **로그인 토큰의 회원 정보** — `company`(회원 프로필 → 옛 `mb_2`, sp-node `member-company.ts` 와 같은 순서) · `phone`(`mb_hp` → `mb_tel`) ·
  `email`(아이디와 다를 때만). 값이 없으면 칸을 넣지 않는다. 부서는 저장하는 곳이 없어 넘기지 않는다.
  SmartSMT 는 저장하지 않고, 토큰이 주소에 실리므로 접속 기록에 남기지 않는다는 조건을 두 문서에 적었다.
  **실제 오픈 전에는 개인정보처리방침에 SmartSMT 로 넘기는 항목을 적어야 한다.**

**아직 만들지 않은 것 — 담당자 견적 전송**

회신에 보낼 모양을 제안해 두었다: `POST {SmartSMT}/api/pricing/received`, 토큰은 `iss=samplepcb` · `aud=smartsmt`, 본문은 받은 견적서 JSON 에
`quote.integrated.totals`(공급가 · 부가세 · 합계)와 정한 블록의 `amount` 를 채우고 맨 위에 `review_status`(`CONFIRMED` · `HOLD`) ·
`customer_note` · `reviewed_at`. `stored: true` 만 성공으로 본다. SmartSMT 의 답(고객 화면이 읽는 칸 · `aud` · 다시 보낼 때)을 받은 뒤 만든다.
견적번호가 "나"(samplepcb 관리)로 정해지면 가져오기의 중복 판별을 견적번호 대신 주문 번호 + 내용으로 바꾼다.

**운영 반영 순서** — 푸시 → 서버에서 `git pull` · `prisma migrate deploy` · API·웹 재배포 → 그 뒤에 두 문서를 전달한다
(회신 5장 · 7장이 "반영돼 있습니다"라고 적혀 있다).

## 9. 관리자 확정 — 항목별 가격 수정 (2026-11-19)

**사용자 결정** — SmartSMT 주문 화면의 결과가 최종 가격의 바탕이다. 관리자는 그 결과를 놓고 **항목별로** 금액을 고친다.
총액을 직접 고치지 않는다 — 항목을 고치면 간접비 · 기업이윤 · 배송 · 부가세가 계산돼 총액이 나온다.
(블록 단위로만 입력하자는 안은 쓰지 않는다.) 배송비는 samplepcb 가 정한다.

### 9.1 SmartSMT 화면 실측 (주문 `a49af3b5fa9f`)

- **주문 화면** — PCB 제작 61,000 · 부품 구매 845,485 · SMT 조립 790,000(확인 필요 2건) · 메탈마스크 0 · 수삽 83,750 · 추가 작업 0
  → 공급가액 1,944,500 · 부가세 194,450 · 최종합계 2,138,950. "상세보기"는 그 자리에서 펼쳐진다.
- **견적 확인** — 「견적 미리보기」 대화상자: 통합 견적서 + 별첨 4종(PCB · BOM · 메탈마스크 · SMT 견적서) + 인쇄. "세부 견적서"는 비활성.
- **통합 견적서의 줄 = 견적서 JSON 의 `quote.lines`** (39줄. 수량이 0 인 "미적용" 줄은 화면에 나오지 않는다).
  묶음은 `quote.subtotals[]` 의 `label` · `codes`(메탈마스크 / SMT / 수삽 및 후공정 / 검사 · 시험 · 프로그램 / 완제품 조립 · 포장),
  맨 끝이 "기타: 간접비 · 기업이윤 · 배송". PCB · 부품 · 배송은 `quote.integrated.blocks[]`.
- **계산식** — 실제 견적 3건이 원 단위까지 맞는다(`.tmp/smt-tools/verify-math.cjs`):

  | 단계 | 식 |
  |---|---|
  | 직접공정비 | 견적 줄 금액의 합 |
  | 간접비 | round(직접공정비 × `markup.indirect_cost_rate`%) |
  | 기업이윤 | round((직접공정비 + 간접비) × `markup.profit_rate`%) |
  | 공급가액 | 직접공정비 + 간접비 + 기업이윤 + 이 주문에서 사는 블록(PCB · 부품 · 배송) |
  | 부가세 · 합계 | round(공급가액 × `policy.vat_rate`%), 공급가액 + 부가세 |

- ⚠ **줄에는 "—"인데 합계에는 들어 있다** — 견적서의 간접비 · 기업이윤 줄은 "—"로 나오지만, 공급가액에는 기본 요율(8% · 10%)로 계산한
  164,265원이 이미 들어 있다(줄 합 1,780,235 ≠ 공급가액 1,944,500). 견적서 머리의 `policy_is_default: true` 가 "기본 요율"이라는 표시다.
  SmartSMT 가 요율을 정하면 견적서의 `header.controls` 값이 바뀌고, 우리 계산은 그 값을 그대로 쓴다.
- 견적서에만 있고 JSON 에 없는 것: 프로젝트 이름 · 유효기간 · 납기 일수 · 결제계좌 · 공급자 정보 · 수신(회사명 · 부서 · 연락처 · 이메일).

### 9.2 구현

- **계산** — `packages/api-contract` `smartsmt-review.ts` 의 `computeSmartsmtSheet`. 화면(입력하는 동안)과 서버(저장할 때)가 같은 함수를 쓴다.
  빈 금액은 0 으로 세고 `complete: false` — 빈 금액이 하나도 없어야 확정할 수 있다(0원은 정한 금액).
- **저장** — `sp_smt_review`(마이그레이션 `20261119010000_smartsmt_review`, 추가 전용). 견적 하나에 한 벌: 고친 줄 금액 · 블록 금액 · 고객 안내 글 ·
  계산 결과 · 상태(`draft` 임시 저장 / `confirmed` 확정) · 누가 · 언제. 고치지 않은 항목은 저장하지 않는다(SmartSMT 금액 그대로).
- **API** — `PUT /api/admin/smt/quotes/:id/review`(항목 금액만 받고 합계는 서버가 계산, 확정은 빈 금액이 있으면 409) ·
  `DELETE …/review`(SmartSMT 금액으로 되돌림). 상세 응답에 `review`, 목록 · 이력에 `reviewStatus` · `reviewTotal`.
- **화면** — 견적 상세의 "견적서" 구획(`SmtQuoteSheet.vue`): 통합 견적서와 같은 순서의 표, 줄마다 SmartSMT 금액과 확정 금액 입력칸,
  묶음 소계, 기타(간접비 · 기업이윤은 자동 계산, 배송은 입력), 합계는 SmartSMT 금액과 확정 금액을 나란히. 수량 0 인 줄은 접어 둔다.
  임시 저장 · 확정 · SmartSMT 금액으로 되돌리기, 고객 안내 글. 목록은 확정한 견적에 "확정 314,116원"처럼 보인다.
- 줄끼리 물린 식(예: 샘플 최소작업비 조정 = 300,000 − 실장 소계)은 다시 계산하지 않는다 — 줄마다 관리자가 정한다.

### 9.3 아직 없는 것

- **SmartSMT 로 돌려보내기** — 회신문 6장의 제안(고친 줄 · 블록 금액과 다시 계산한 합계를 견적서 JSON 에 채워 `POST /api/pricing/received`)에
  SmartSMT 가 답하면 만든다. 그때까지 확정은 우리 쪽 기록이다.
- 고객에게 메일로 알리기, 확정 견적서 출력(통합 견적서 모양)은 정하지 않았다.

**운영 반영** — `prisma migrate deploy`(표 1개 추가) 뒤 API · 웹 재배포.

