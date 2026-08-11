# e2e — 파트너 포털 E2E 하네스

파트너 포털 재설계(R1~R3, `docs/PARTNER_PORTAL.md`) 검증용 러너·헬퍼·픽스처.
**시나리오는 재설계 본 세션이 작성**하고, 이 패키지는 그 기반(로그인 세션·시드/정리·
브라우저·메일 검증)을 제공한다. 관례 정본: `HANDOFF_E2E_TEST.md` "준비 산출물".

## 실행

```bash
# 사전: nginx(Windows 서비스)·API·웹 dev 서버가 떠 있어야 한다
# (없으면 beforeAll 이 안내 메시지로 중단)
pnpm dev:api   # 127.0.0.1:3333
pnpm dev:web   # 127.0.0.1:5173 (nginx 가 /app 으로 프록시)

pnpm -F e2e e2e          # 전체 실행 (PORTAL_E2E=1 자동 세팅)
pnpm -F e2e e2e:headed   # 브라우저 창을 띄워 관찰
pnpm -F e2e e2e harness  # 파일명 필터 (vitest 인자 그대로 전달)

pnpm -F e2e test         # 게이트 없이 실행 → 전부 skip (turbo test/CI 안전)
```

옵트인 게이트는 `PORTAL_E2E=1`(apps/api 의 `PARTS_IT=1` 관례 미러) — 모든 스펙은
`describe.skipIf(!RUN)` 로 감싼다.

| env | 기본 | 용도 |
|---|---|---|
| `PORTAL_E2E` | (없음) | `1` 일 때만 실행 |
| `E2E_BASE_URL` | `https://local-web.samplepcb.co.kr` | SPA 오리진(nginx 통합 도메인 — 실환경 동형, /bbs 포함 전 경로). nginx 없이는 `http://127.0.0.1:5173`(vite 가 /api·/spcb 프록시, /bbs 는 불가) |
| `E2E_API_URL` | `http://127.0.0.1:3333` | API 레벨 호출 대상 |
| `E2E_MAILPIT_URL` | `http://127.0.0.1:8025` | Mailpit REST |
| `E2E_HEADED` | (없음) | `1` 이면 창 표시 |

`JWT_SECRET`·`DATABASE_URL` 은 `apps/api/.env` 에서 자동으로 읽는다(별도 설정 불요).
https 인증서는 mkcert — 브라우저는 시스템 신뢰로 통과하고, Node 측 fetch 는 e2e
스크립트에 포함된 `NODE_OPTIONS=--use-system-ca` 가 처리한다(`bom:verify` 관례).

## 구조

```
helpers/
  env.ts       게이트(RUN)·URL·apps/api/.env 로더 (게이트 꺼짐 수집 시에도 import 안전)
  jwt.ts       signJwt(identity) — me.php 동형 클레임 HS256 로컬 서명
  api.ts       api(token, method, path, body?) — 스모크 call 미러(FST empty-json 함정 처리)
  db.ts        getPrisma()/disconnectPrisma()/num() — apps/api 생성 클라이언트 재사용
  seed.ts      getPartner·pickFreeSpecs·createPcbPo·cleanupPcbPos·countPcbResidue·ensureSecondCustomer
  browser.ts   newSession(identity, opts) — /spcb/api/me 스텁 로그인·localStorage 프리셋·snap
  mailpit.ts   목록/검색/본문/선택 삭제 (전체 삭제는 의도적으로 미제공)
  php-login.ts newPhpSession(creds) — 그누보드 실로그인(거버·주문서 등 PHP 구간)
  journey.ts   여정 공용부 — createJourneyReport(관찰 규약)·submitGerberRfq·placeOrderFromQuotes
specs/
  harness.e2e.test.ts        하네스 자가 검증 — 새 시나리오의 복사 시작점
  pcb-ship-board.e2e.test.ts PCB 보내기 보드 §9 스토리(세션 스모크 28케이스 편입판)
  journey-gerber-rfq.e2e.test.ts       여정 1호 — 해외 협력사(USD·국제 선적 6단계)
  journey-domestic-partner.e2e.test.ts 여정 2호 — 국내 협력사(KRW·국내 3단계·EQ 반려 왕복)
  journey-batch-shipment.e2e.test.ts   여정 3호 — 묶음 발송(주문 2건 → 한 박스 → 각자 배송)
  journey-md-relay.e2e.test.ts         여정 4호 — MD 경유 2단(2단 견적·EQ 위임·출고 게이팅)
  journey-as-reorder.e2e.test.ts       여정 5호 — A/S 재발주 회차(접수→회신→proceed→회차 생산·발송 분리)
  journey-direct-ship.e2e.test.ts      여정 6호 — 직송 3종(직송지 축 모드 파생·박스 분리·배송 큐 실측)
  journey-as-advanced.e2e.test.ts      여정 7호 — A/S 심화(MD 경유 회차·거절→재접수→2회차·유상 송금 큐 대조)
  journey-remittance.e2e.test.ts       여정 8호 — 송금 원장 완주(돈 축: 부분 송금·증빙·환차·무상 A/S 제외·가드 순환)
  journey-multi-customer.e2e.test.ts   여정 9호 — 다중 고객 × 묶음 발송(한 박스 두 주인·정보 격리·cross-member 큐)
  journey-order-cancel.e2e.test.ts     여정 10호 — 주문 취소·부분 취소(한 주문서 두 줄·부분/전량 취소 가드 대조)
  journey-combo-stress.e2e.test.ts     여정 11호 — 조합 스트레스(묶음 × A/S 회차 × 직송: 박스 키 두 축의 분리·합류 교차)
  journey-admin-proxy.e2e.test.ts      여정 12호 — 관리자 대행 완주(포털 없는 협력사: 대리 회신·EQ/선적 대행·대행 안내 메일 대조)
  journey-partner-suspend.e2e.test.ts  여정 13호 — 협력사 정지 중의 진행 건(배제 후 매직링크 경계·메일 CTA·대행 완주·복귀)
  journey-overdue.e2e.test.ts          여정 14호 — 기한 초과(납기 경과·EQ 확인 기한·매직링크 TTL — DB 날짜를 과거로 밀어 검증)
  journey-rewind.e2e.test.ts           여정 15호 — 되돌리기 전 구간 순환(주체 비대칭·체인 되돌림·재진행·선적 왕복·선정 해제 순환)
  journey-concurrency.e2e.test.ts      여정 16호 — 동시 조작 경합(같은 요청을 둘이 동시에 — 불변식으로 판정: 상태 한 칸·박스 1개·수납 1회)
  journey-legacy.e2e.test.ts           여정 17호 — 레거시 이관분 접합(read-only: _legacy 메타 방어·대기 큐 제외·조감 노출·Case 렌더)
  journey-customer-loop.e2e.test.ts    여정 18호 — 고객 축 셀프 루프(주문 뒤 사양 수정·발주 후 잠금·EQ 반려 2회차 격리·견적 삭제 차단)
  journey-bulk-box.e2e.test.ts         여정 19호 — 대량 묶음(한 박스 5건: 합류·송장 5줄·전이 파급·입고 1회 종결, 시드 발주)
  journey-currency.e2e.test.ts         여정 20호 — 환율·통화 축(KRW null·회신엔 환율 없음·선정 박제·조직 통화 흔들어도 발주 불변)
  journey-md-multi.e2e.test.ts         여정 21호 — MD 다중 상위·단수 제한(한 하위 두 상위·관계별 배정·2단 강제, 관계 무접촉)
  journey-files.e2e.test.ts            여정 22호 — 파일·첨부 권한(남의 첨부는 URL 알아도 404·잠금·공유 목록이 경계)
  journey-counts.e2e.test.ts           여정 23호 — 집계·카운트 정합(read-only: 배지=목록·페이지 경계·부분 합=전체, 실데이터 2만 건)
  md-quote-loop.e2e.test.ts            MD 1편 — 2단 견적 루프(mdtester 상설 픽스처, RUN 게이트만)
  md-quote-rework.e2e.test.ts          MD 3편 — 하위 재선정·배정 회수(RUN 게이트만)
  md-order-relay.e2e.test.ts           MD 2편 — 주문 연결 완주(국내 MD: 하위 국제 + 관리자행 국내)
  md-domestic-relay.e2e.test.ts        MD 4편 — 전 구간 국내(KR MD: 받는측 md domestic + 게이팅)
  md-cn-relay.e2e.test.ts              MD 5편 — CN MD(mdtester2상사: 비KR domestic + CN→KR 국제)
  pcb-guards.e2e.test.ts               확정 409 가드 박제(PO_ISSUED·EQ_LOCKED·RECEIVE_LOCKED 등 10종)
  rework-probe.e2e.test.ts             재작업 가드 회귀 — 잠김→정리→열림 순환(W2~W9, 스크립트 probe)
  prompt-modal.e2e.test.ts             커스텀 대화상자(prompt·confirm 대체)가 실제로 뜨는지
```

## 완주 여정 (탐색 주행)

옵트인 2중 게이트(`PORTAL_E2E=1` + `JOURNEY=1`)로만 돈다. 사전 조건이 많다 —
nginx·API(3333)·웹(5173)·**거버(8040)**·Mailpit + `e2e/.env.e2e` 고객 자격.

| 스크립트 | 대상 |
| --- | --- |
| `pnpm -F e2e journey` | 전 여정 연속(파일 직렬 — journey-*) |
| `pnpm -F e2e journey:intl` | 1호만 — 해외 협력사 |
| `pnpm -F e2e journey:domestic` | 2호만 — 국내 협력사 |
| `pnpm -F e2e journey:batch` | 3호만 — 묶음 발송 |
| `pnpm -F e2e journey:md` | 4호만 — MD 경유 2단 |
| `pnpm -F e2e journey:as` | 5호만 — A/S 재발주 회차 |
| `pnpm -F e2e journey:direct` | 6호만 — 직송 3종(CN→CN 국내·CN→VN 국제·KR→CN 국제) |
| `pnpm -F e2e journey:as2` | 7호만 — A/S 심화(MD 경유 회차·거절→재접수→2회차·유상 송금 큐, mdtester2상사 상설 픽스처) |
| `pnpm -F e2e journey:money` | 8호만 — 송금 원장 완주(돈 축: 부분 송금·증빙·환차·무상 A/S 제외·HAS_REMITTANCE 순환) |
| `pnpm -F e2e journey:multi` | 9호만 — 다중 고객 × 묶음(고객 2인 동시 세션·한 박스 두 주인·정보 격리·cross-member 배송 큐) |
| `pnpm -F e2e journey:cancel` | 10호만 — 주문 취소·부분 취소(한 주문서 두 줄·부분 취소 대 전량 취소 가드 대조) |
| `pnpm -F e2e journey:combo` | 11호만 — 조합 스트레스(묶음 × A/S 회차 × 직송: 박스 키의 회차·직송지 두 축 교차, W8 순환·대표 승계·돈 축 교차) |
| `pnpm -F e2e journey:proxy` | 12호만 — 관리자 대행 완주(포털 계정 없는 협력사: 대리 회신·EQ/생산/선적 대행·무계정 대행 안내 메일 4종 대조, `e2e한국협력` 상설 픽스처) |
| `pnpm -F e2e journey:suspend` | 13호만 — 협력사 정지(운영 배제) 중의 진행 건(포털 즉시 403·매직링크 경계·메일 CTA·관리자 대행 완주·해제 복귀, `e2e정지협력` 전용 상설 픽스처) |
| `pnpm -F e2e journey:overdue` | 14호만 — 기한 초과(한 Case 에 납기 어제↔+30일 두 발주 대조 · EQ 확인 기한 왕복 · 매직링크 30일 TTL) |
| `pnpm -F e2e journey:rewind` | 15호만 — 되돌리기 순환(관리자 만능 되돌림 ↔ 협력사 자기 차례만 · 첨부 유지 · 선적 취소→재담기 · 선정 해제→재선정) |
| `pnpm -F e2e journey:concurrency` | 16호만 — 동시 조작(동시 선정·입금확인·발행·전이·담기 — 유니크 위반이 500 이 아니라 도메인 응답으로 나오는지) |
| `pnpm -F e2e journey:legacy` | 17호만 — 레거시 이관분(read-only, 쓰기 0 — 실데이터 위에서 _legacy 소거·NOT_LEGACY 큐 제외 확인) |
| `pnpm -F e2e journey:customer` | 18호만 — 고객 셀프 루프(W6 동기+결제 기록 불변 · PO_ISSUED 경계 · 반려 왕복 2회차 사유 격리 · ALREADY_ORDERED) |
| `pnpm -F e2e journey:bulk` | 19호만 — 대량 묶음(개수가 코드 경로를 가르는 자리: 송장 품목 5줄·비대표도 같은 박스·입고 1회 파급) |
| `pnpm -F e2e journey:currency` | 20호만 — 환율이 언제 굳는가(회신 아닌 선정에서 · 수동 발주 환율 필수 · 조직 통화 변경에도 발주 박제) |
| `pnpm -F e2e journey:mdmulti` | 21호만 — MD 다중 상위(관계별 통화 박제 · 400=구조 불가/409=지금만 충돌 구분 · 거절 후 관계 불변) |
| `pnpm -F e2e journey:files` | 22호만 — 파일 권한(다운로드 경계 직접 두드리기 · EQ_LOCKED · sharedFileIds 밖은 고객도 404) |
| `pnpm -F e2e journey:counts` | 23호만 — 집계 정합(네 큐 전 탭 total==counts · 페이지 중복 0 · 부분 합==전체, 쓰기 0) |
| `pnpm -F e2e md` | MD 2편 — 주문 연결 완주(국내 MD·상설 픽스처) |
| `pnpm -F e2e md:domestic` | MD 4편 — 전 구간 국내(KR MD, 협력1 KRW 링크) |
| `pnpm -F e2e md:cn` | MD 5편 — CN MD(mdtester2상사·비KR domestic 최초) |

여정들은 고객 조작(거버 제출·주문서 작성)과 관찰 규약을 `helpers/journey.ts` 로 공유한다.
주문서를 채우는 손놀림이 갈라지면 한쪽만 고쳐지고 다른 쪽은 묵기 때문이다 — 10호가 필요로 한
**한 주문서 여러 줄**도 새 함수가 아니라 `placeOrderFromQuotes({ alsoSpecIds })` 로 체크만 늘려
같은 손놀림을 그대로 쓴다(생략하면 기존 호출과 완전히 동일하다).

1·2호가 갈라지는 것은 협력사 축뿐이다: **선정 환율 유무(USD↔KRW)·선적 체인 길이(6단계 vs
3단계)·Invoice 필수 여부**. 그래서 화면 마찰이 고쳐지면 양쪽이 함께 검증된다.

4호는 **MD 경유 2단**을 세운다 — MD 는 진행 중 수주 발주가 없는 조직만 될 수 있어(전환 시 EQ
주체가 위임으로 바뀐다) 발주가 비어 있는 조직을 MD 로 쓰고, 관계는 주행이 만들고 끝나면
해제한다. 관계 해제는 문서가 종결돼야 되므로 그 순서 자체가 검증이다.

3호만 할 수 있는 것은 **고객 축과 묶음의 접합**이다. 협력사 축의 묶음 메커니즘(합류·대표
승계·게이팅·묶음 전이)은 `pcb-ship-board` 가 시드 발주로 이미 지키지만, 거기엔 주문이 없다.
3호는 서로 다른 주문 두 건을 한 박스로 보내고 입고 뒤 **두 주문이 모두** 고객 배송 대기 큐에
오르는지 본다 — 선적 문서의 specId 는 대표 한 건뿐이라 그걸로 판정하면 동반 주문이 큐에서
사라지기 때문이다(서버는 발주서 축으로 조인한다).

9호는 3호를 **고객 축**으로 한 칸 넓힌다 — 그 전까지 모든 여정은 고객이 하나였고, 주문이
둘이어도 주인이 같아 "남의 것이 안 보인다"가 한 번도 시험되지 않았다. 9호는 ① 박스
contextKey(받는측:조직:직송지:회차)에 **고객 축이 없다**는 설계를 두 주인의 발주가 한 박스에
합류하는 것으로 실증하고, ② 화면(주문내역·상세·진행 카드·남의 상세 직접 접근)과
API(`pcb-progress`·`pcb-eq-reviews`·EQ decide)의 **정보 격리**를 자기 것 양성 대조와 함께
확인하며, ③ **회원이 다른** 두 주문이 한 입고로 함께 `to_ship` 큐에 오르는지(3호는 같은
회원이었다) 본다. 2번 고객은 **상설 픽스처** `e2e-customer2` — `ensureSecondCustomer()` 가
1번 고객 회원 행을 통째로 복제해 만들어(비밀번호 해시까지 동일 → 자격은 아이디만 다르고
`.env` 에 원문이 늘지 않는다) 주행 뒤에도 남긴다. `newPhpSession` 은 호출마다 새
BrowserContext 라 두 고객 세션이 동시에 살아 있어도 쿠키가 섞이지 않는다.

8호가 지키는 것은 **돈이 발주와 따로 흐른다**는 사실 하나다. 다른 여정은 발주가 서면 그
금액을 그대로 "낼 돈"으로 보지만, 실제로는 발주 뒤에 **여러 번 나뉘어·다른 환율로** 나가고
증빙이 붙는다. 그래서 8호는 협력2(CN·USD)로만 성립한다 — 외화라야 ① 발주 회계 환율,
② 1차 송금 실환율, ③ 잔금 실환율이 **셋 다 다를 수 있고**, 그때 `원장 KRW 합계 ≠ 발주
krwAmount`(= 환차손익)라는 부등식이 참이 된다. 이 여정은 그 부등식을 수치로 못 박아
"KRW 환산을 발주 환율로 뭉개는" 회귀를 막는다(실측 ₩412,500 vs ₩414,000 = ₩−1,500).
그 위에서 ① 잔액·상태(unpaid→partial→paid)와 워크큐 탭·counts 가 같은 계산기에서 나오는지,
② `sp_pcb_po.remittedAt` 이 원장 파생 캐시로 KST 앵커를 지키며 따라오는지(마지막 송금일,
원장이 비면 null 복귀), ③ 관리자 집계·**협력사 포털**·Case 패널 세 화면의 금액이 갈라지지
않는지(창구는 여럿, 원장은 하나), ④ 무상 A/S 회차가 **양쪽 모수 모두**에서 빠지는지를
스냅샷 델타로 확인한다(7호 T3d 는 송금 0원 상태의 큐 소속만 봤고 포털은 안 봤다). 마지막
M7 은 `HAS_REMITTANCE` 순환을 **끝까지** 돈다 — 잠김(409) → 원장·증빙 정리 → 취소 200
(`rework-probe` W4 는 원장 정리에서 멈춘다). 그래서 이 여정만은 스크린샷(M8)을 가드
순환보다 **먼저** 찍는다: 순환의 종착이 원장과 발주의 소멸이라 순서를 지키면 빈 화면이 남는다.

10호는 여정 중 유일하게 **주문이 거꾸로 가는 길**을 밟는다. 앞의 아홉은 "주문은 앞으로만 간다"를
전제했고, 그래서 둘이 통째로 미검증이었다. 하나는 **1주문 = 1스펙** — 3호·9호는 주문이 둘이어도
주문서가 둘이었다. 견적관리에서 여러 건을 함께 체크해 **한 주문서에 카트 n 줄**을 만드는
경로(`quotes.php` → `POST /api/pcb-projects/order` 의 ids 배열 → 한 번의 `ct_select`)는 한 번도
안 밟혔는데, 부분 취소는 그 조합이 있어야만 성립한다. 다른 하나는 **취소가 협력 트랙에 어떻게
비치는가**다.

이 여정의 골격은 대조다: **같은 3종 프로브**(EQ 전진 · 발송 담기 · A/S 접수)를 **부분 취소**와
**전량 취소**에 각각 쳐서 `ORDER_CANCELED` 가드가 어느 쪽에서 서는지 나란히 세운다. 첫 주행의
실측 결론은 **전량 취소는 3종 모두 409 로 막고, 부분 취소는 3종 모두 200 으로 통과한다**였다 —
가드가 `od_status` 하나만 봐서 줄 단위 취소가 협력 트랙에 전혀 전달되지 않았다(취소된 보드가
계속 생산되고 박스에 담겨 나갈 수 있었다는 뜻이다).

**교정 후(같은 날) 양쪽이 똑같이 409 로 선다** — `isPcbOrderLineCanceled`(`lib/pcb-shipment.ts`)
가 `od_status='취소'` **또는** 그 줄 `ct_status` 취소류를 함께 본다. 이 스펙은 이제 그 가드의
**회귀선**이다: X6 이 다시 200 이 되면 부분 취소가 새어 나간 것이다. 정리 경로(EQ 되돌리기)는
양쪽 모두 200 이어야 한다 — 가드가 정리까지 막으면 취소 뒷정리가 통째로 죽는다.

부분 취소는 협력 트랙 밖에서도 넷을 더 드러냈고, 셋은 함께 고쳤다: ① 과입금이 **음수 미수**로만
남고 환불 경로가 없다(**미해결 — 결제수단·회계가 걸린 별건, 정책 결정 대기**), ② 취소된 줄이
고객 상세의 **제작 진행 카드**에 살아 진행되던 것 → `listCustomerPcbProgress` 가 `ct_status` 로
거른다, ③ 한 주문서 두 줄이 **같은 상품명**으로 찍히던 것 → 주문 상세가 줄별 `it_name` 을 찍고
상품표를 전폭으로 돌려 '주문취소' 배지가 잘리지 않는다, ④ `force-status '배송'` 이 취소 줄을
**되살리던** 것 → 전진 target 은 취소류를 대상에서 뺀다(전량 취소 주문에 걸면 409
`NO_ACTIVE_LINES`). 정리는 `cleanup-probe.mts` 로 보강 없이 된다 — 역방향 `'주문'` 만은 취소류를
계속 포함하기 때문이다(un-cancel + 재고 점유 해제, X12 가 실증).

11호는 앞의 열 편이 **따로** 지켜 온 축들을 한 주행에서 교차시킨다. 박스 합류 키
(`contextKey = 받는측:조직:직송지:회차` — `lib/pcb-shipment.ts` `pcbShipContextKey`)는 네 축을
한 문자열에 담는데, 3·9호는 묶음만·5·7호는 회차만·6호는 직송지만 밟았다. **키의 두 축이 동시에
움직일 때** 판정이 유지되는지는 아무도 안 봤고, 그 위에 얹힌 것들(회차 배지·직송 종결·무상 A/S
집계 제외·묶음 구성 표시)이 전부 이 키에 기대어 서 있다.

주행은 협력2(CN 직거래) **한 조직 안에서** 조직 축을 고정한 뒤 고객 주문 3건(A·B·C)으로 나머지
두 축만 흔들어 박스 세 칸을 만든다 — `admin:0:-:r0`(A+B 묶음) · `admin:0:-:r1`(A′) ·
`admin:0:CN:r1`(C′ 직송). 그 셋이 넷을 실증한다: ① 회차 축이 **가른다**(r0 묶음 박스에 r1 은 못
들어간다) ② 회차 축이 **묶는다**(스펙이 달라도 같은 r1 끼리는 한 박스 — "키에 고객·스펙 축이
없다"는 9호의 발견이 회차에도 그대로다) ③ 직송지 축이 **가른다**(같은 r1 인데 `:-` 와 `:CN` 이
갈린다) ④ 그래서 두 축은 **곱해진다**.

교차가 드러내는 것은 축 자체가 아니라 그 위의 규율이다. 박스 합류는 **대표 발주 기준**이라
(`findPreparingPcbShipment` 가 대표의 partnerId·reorderRound 를 본다) 어서션은 늘 "대표가
누구인가"부터 묻는다 — 대표 C′ 를 꺼내면 A′ 가 대표를 승계하고 **발송 문서의 specId 까지** 함께
옮겨간다. 직송지 변경은 재작업 가드 W8 의 순환(담긴 채로 409 `IN_SHIPMENT` → detach → 변경 →
재담기)을 통째로 밟아야 하고, A/S proceed 가 직송지를 **복사**하므로(`pcb-as-case.ts`
`proceedPcbAsCase`) "직송 회차"는 **복사 후 수정**으로만 만들어진다. 돈 축은 그 전부를 무시한다 —
무상 회차(C′)가 직송 박스로 갈라져 나가도, 유상 회차(A′)가 묶음 박스에 담긴 채여도, 송금
워크큐·협력사별 집계·포털 수금 세 창구에서 **박스가 아니라 발주(회차·chargeType)**로만 갈린다.

첫 주행이 박제한 **결함 하나와 마찰 하나는 교정됐다**(08-11) — X7·X9 의 어서션이 뒤집혀
이제 회귀선이다:

- **[bug→fix] 회차 발주의 직송지가 원주문의 종결 동선을 뒤집었다**(X9). 고객 배송 큐의 직송 판정
  축이 "최상위·**최신 회차** 발주의 직송지"라, 원발주(round 0)가 **KR 로 실제 입고된** 주문이라도
  그 뒤에 선 A/S 회차에 직송지를 주면 행이 `직송 CN` 으로 바뀌고 종결 버튼이 [배송 처리] →
  **[직송 완료]**(운송장 없이 완료 종결)가 됐다 — 실물은 자사 창고에 있는데 "현지에서 수령했다"로
  닫히는 경로. 교정 후 판정 축은 **입고 신호를 만든 그 발주**(관리자 수신 선적의 `receivedAt`)의
  직송지다(`resolvePcbDirectShipCountry`). X9 가 두 갈래를 함께 어서션한다: 회차에만 직송지를 줘도
  원주문은 [배송 처리] 유지(`directShipCountry=null`) · 회차 발주 **자체가 직송으로 입고**되면
  그 주문은 [직송 완료]. 직송지가 섞이면(원발주 KR 입고 + 회차 CN 입고) 보수적으로 null 이다.
- **[ux→fix] 포털 보드에서 박스가 왜 갈렸는지 읽을 수 없었다**(X7). 박스 헤더가 받는곳·모드·건수만
  내고 직송지는 실리는데(`· 직송 CN`) **회차가 안 실려** r0 박스와 r1 박스의 헤더가 글자까지 같았다.
  교정 후 헤더에 `A/S N차` 배지가 선다(계약 `PcbShipmentView.reorderRound` — 같은 카드를 쓰는
  `PcbShipmentCard.vue` 진행 중 발송도 함께).

12호가 지키는 것은 **협력사가 포털을 쓰지 않아도 트랙이 끝까지 간다**는 사실이다. 앞의 열한 편은
전부 협력사 토큰으로 포털을 두드렸지만, 실무 협력사 상당수는 **계정이 없다**(메일과 전화로 일한다).
그래서 D11 이 "관리자 만능 대행"을, 재점검 #15 가 무계정 조직용 **대행 안내 메일**을 두었는데 —
**대행만으로 완주한 여정은 하나도 없었다**. 주인공은 상설 픽스처 `e2e한국협력`(#9·KR/KRW·**연결
계정 0**)이고, 계정이 없으니 협력사 토큰을 만들 방법 자체가 없다(`getPartner().mbId === null` 이
첫 어서션이다). RFQ 대리 회신(`PUT admin …/rfqs/:id/reply`) → EQ·Working **대행 업로드** →
`eq-request`·`production-start`·`production-complete` **대행 전이** → 선적 담기·전이·입고 확인까지
**관리자 토큰 하나**로만 민다. 포털은 한 번도 열지 않는다 — 그게 이 편의 전제다.

증거는 **DB 실측 둘**이다: 대행 업로드의 `sp_file.uploadedBy='ADMIN'`(2/2)과 대행 전이의
`sp_pcb_po.eqHistory[].byRole='ADMIN'`(4/4 — 회차 전체에 PARTNER 가 한 칸도 없다). 대행이라고
규율이 느슨해지지도 않는다: 승인요청 후 첨부 교체는 포털과 같은 `EQ_LOCKED` 로 막히고, 국내
종점은 같은 `RECEIVE_REQUIRED` 로 [입고 확인]에 묶인다.

셋째 축은 **메일 대조**다. 무계정 조직엔 포털 버튼 대신 대행 안내(+운영자 문의처 mailto)가 가야
하고, 계정 있는 협력2 는 버튼을 유지해야 한다 — 그래서 **같은 스펙·같은 순간에 발주서를 두 장
발행해** 같은 종류의 메일을 나란히 세운다(대조군 발주서는 대조 직후 취소한다). 4종(발주서 도착·
EQ 결정·선적 차례·입고 확인) 모두에서 무계정본은 `담당자가 대행합니다` + `mailto:` 를 담고
`/app/partner` 링크가 **한 개도 없다**. 예외는 **견적요청 메일** 하나인데, 매직링크는 로그인 없이
실행되는 CTA 라 대행 치환 대상이 아니다(무계정에도 `가입 없이 바로 회신하기` 가 그대로 간다) —
이 편은 그 예외까지 함께 박제한다.

첫 주행이 결함 하나를 박제했고 **곧 닫았다**: 무계정 조직의 발송을 화면만으로는 시작할 수
없었다. 선적 큐 발송 대기 탭은 "관리자는 Case 상세에서 대행할 수 있습니다"
(`AdminPcbShipments.vue:200`)라고 안내하는데, Case 상세의 선적 줄은 **발송 문서가 이미 있을 때만**
렌더되고(`AdminPcbCase.vue` `shipRowsOf`) 담기 라우트는 협력사 전용
(`POST /api/partner/pcb-shipments/box`)뿐이라, **계정이 영영 없는 조직은 UI 로 발송을 열 수
없었다**. 교정으로 담기만 하는 관리자 라우트(`POST …/pos/:poId/shipment/box`)와 Case 상세
**[발송 시작]** 버튼이 생겼다 — 담기까지만 하고 멈추는 이유는 첫 전이의 필수값이 모드마다 다른데
(국내=운송장 · 국제=출고예정일+Invoice) 그 **모드는 담아 봐야 정해지기** 때문이다. 박스를 먼저
열면 그 다음은 기존 [~ 진행]이 모드를 알고 정확히 묻는다. **P5 는 어서션이 뒤집혀 회귀선이
됐다** — 버튼을 눌러(확인 대화 승인) 선적 줄이 서고 박스가 `preparing`·`domestic` 으로 열리는
것을 DB 실측까지 이어 본다.

6호와 MD 4·5편은 **국가×물류모드 매트릭스**의 남은 칸을 채운다 — 모드는 국적이 아니라
"발송자국가=수신국가" 파생임을 조합으로 실증한다(4편 KR MD 전 구간 국내 · 5편 CN MD 의
CN→CN 비KR 국내 + CN→KR 국제 · 6호 직송 CN→CN 국내/CN→VN·KR→CN 국제). MD 편은 **상설
픽스처**를 쓴다: `마스터딜러상사`(KR/KRW·mdtester — 관계 협력1 KRW·협력2 USD),
`mdtester2상사`(CN/USD·mdtester2 — 관계 협력2 USD·다중 상위), `e2e한국협력`(KR/KRW·**연결 계정
없음** — 6호가 세우고 **12호가 주인공으로 쓴다**: 관리자 대행 전용). ⚠ `cleanup-md.mts` 는 관계를
해제하므로 이 편들에 쓰면 안 된다 — 정리는 `cleanup-probe.mts`(e2e-customer 스펙 축 훑기·상설
무접촉)로만.

**생성물은 자동 정리하지 않는다.** 완주 후 리포트(`output/journey/findings*.md`)의 생성물
대장을 보고 손으로 지운다 — 순서는 ① 주문을 `force-status '주문'` 으로 내려 **재고 복원**
② g5 cart+order ③ sp_* 역순(file→shipment_po→shipment→eq_review→po→rfq→file→spec).

## 핵심 설계

- **브라우저 로그인 = `/spcb/api/me` 라우트 스텁.** sp-vue 는 마운트 전 이 PHP
  브리지로 세션→JWT 교환을 하므로, Playwright 라우트 인터셉트로 로컬 서명 JWT 를
  반환하면 **비밀번호·PHP 세션 없이** 임의 계정(파트너/관리자)으로 실 Vue + 실
  Node API 풀스택이 돈다. 그누보드 실로그인 왕복 자체를 검증해야 할 때만 실계정
  자격증명이 필요하다(현재 스펙엔 없음 — 익명 가드의 URL 왕복 검증까지는 무자격 가능).
- **playwright-core + 시스템 Chrome/Edge channel** — 브라우저 다운로드 없음.
- **파일 간 직렬 실행**(`fileParallelism: false`) — 공유 DB(sp_* = 그누보드 동거)에서
  시드·정리 교차를 막는다. 파일 안 test 도 정의 순서대로 순차.
- **자족 시드→검증→무잔재 정리** — 만든 id 를 레지스트리(배열)에 등록하고 afterAll
  에서 일괄 정리+잔재 카운트 0 검증. `prisma migrate reset` 절대 금지.

## 함정 (HANDOFF §5 요약 + 하네스 고유)

- 협력1 은 진행 중 **실데이터** 보유 — 읽기만. 쓰기 시드는 협력2(PCB PO 0건 전제)
  또는 신규 시드로.
- 발주서 UK `(specId, partnerId, parentPartnerId, reorderRound)` — 시드 스펙은
  `pickFreeSpecs()` 로 골라 충돌 회피.
- 날짜는 KST 앵커(`YYYY-MM-DDT00:00:00+09:00`) — UTC 파싱 시 하루 밀림.
- 재설계 중 URL·route name 유동 — 셀렉터는 data-testid·텍스트·URL 패턴 위주로,
  하드코딩 최소화.
- 기본 도메인은 nginx 통합(`https://local-web.samplepcb.co.kr`) — nginx(Windows
  서비스)가 꺼져 있으면 beforeAll 에서 중단된다. `E2E_BASE_URL=http://127.0.0.1:5173`
  (vite 직결)로 우회 가능하나 `/bbs`(그누보드 화면) 검증은 불가.
- Mailpit 은 사용자 관찰용이기도 하다 — 시드가 유발한 메일만 `mailpitDelete(ids)`. 같은 제목이
  주행마다 반복되므로(프로젝트명이 픽스처 파일명이다) **발송 전에 기준선(최신 1통 ID)을 잡고**
  그 뒤 신착만 본다 — 안 그러면 지난 주행 메일을 잡는다.
- 스크린샷은 `e2e/output/journey/` **공용 폴더**에 쌓인다 — 여정마다 접두사 글자를 하나씩
  전용으로 쓴다(D=2호·J=6호·M/T/W·X=11호·P=12호…). 겹치면 다른 편의 캡처를 조용히 덮어쓴다.







