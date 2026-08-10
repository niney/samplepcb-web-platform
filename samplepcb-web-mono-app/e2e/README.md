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
  seed.ts      getPartner·pickFreeSpecs·createPcbPo·cleanupPcbPos·countPcbResidue
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
| `pnpm -F e2e journey` | 1~7호 연속(파일 직렬) |
| `pnpm -F e2e journey:intl` | 1호만 — 해외 협력사 |
| `pnpm -F e2e journey:domestic` | 2호만 — 국내 협력사 |
| `pnpm -F e2e journey:batch` | 3호만 — 묶음 발송 |
| `pnpm -F e2e journey:md` | 4호만 — MD 경유 2단 |
| `pnpm -F e2e journey:as` | 5호만 — A/S 재발주 회차 |
| `pnpm -F e2e journey:direct` | 6호만 — 직송 3종(CN→CN 국내·CN→VN 국제·KR→CN 국제) |
| `pnpm -F e2e journey:as2` | 7호만 — A/S 심화(MD 경유 회차·거절→재접수→2회차·유상 송금 큐, mdtester2상사 상설 픽스처) |
| `pnpm -F e2e md` | MD 2편 — 주문 연결 완주(국내 MD·상설 픽스처) |
| `pnpm -F e2e md:domestic` | MD 4편 — 전 구간 국내(KR MD, 협력1 KRW 링크) |
| `pnpm -F e2e md:cn` | MD 5편 — CN MD(mdtester2상사·비KR domestic 최초) |

세 여정은 고객 조작(거버 제출·주문서 작성)과 관찰 규약을 `helpers/journey.ts` 로 공유한다.
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

6호와 MD 4·5편은 **국가×물류모드 매트릭스**의 남은 칸을 채운다 — 모드는 국적이 아니라
"발송자국가=수신국가" 파생임을 조합으로 실증한다(4편 KR MD 전 구간 국내 · 5편 CN MD 의
CN→CN 비KR 국내 + CN→KR 국제 · 6호 직송 CN→CN 국내/CN→VN·KR→CN 국제). MD 편은 **상설
픽스처**를 쓴다: `마스터딜러상사`(KR/KRW·mdtester — 관계 협력1 KRW·협력2 USD),
`mdtester2상사`(CN/USD·mdtester2 — 관계 협력2 USD·다중 상위), 6호의 `e2e한국협력`(KR/KRW·
연결 계정 없음 — 관리자 대행 전용). ⚠ `cleanup-md.mts` 는 관계를 해제하므로 이 편들에 쓰면
안 된다 — 정리는 `cleanup-probe.mts`(e2e-customer 스펙 축 훑기·상설 무접촉)로만.

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
- Mailpit 은 사용자 관찰용이기도 하다 — 시드가 유발한 메일만 `mailpitDelete(ids)`.
