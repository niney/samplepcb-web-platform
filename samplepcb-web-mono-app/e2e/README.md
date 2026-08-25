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

| env                  | 기본                                | 용도                                                                                                                                          |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORTAL_E2E`         | (없음)                              | `1` 일 때만 실행                                                                                                                              |
| `E2E_BASE_URL`       | `https://local-web.samplepcb.co.kr` | SPA 오리진(nginx 통합 도메인 — 실환경 동형, /bbs 포함 전 경로). nginx 없이는 `http://127.0.0.1:5173`(vite 가 /api·/spcb 프록시, /bbs 는 불가) |
| `E2E_API_URL`        | `http://127.0.0.1:3333`             | API 레벨 호출 대상                                                                                                                            |
| `E2E_BOM_ENGINE_URL` | `http://127.0.0.1:8400`             | Smart BOM 추출·공급사 검색 엔진(BOM 여정 사전 점검)                                                                                           |
| `E2E_MAILPIT_URL`    | `http://127.0.0.1:8025`             | Mailpit REST                                                                                                                                  |
| `E2E_HEADED`         | (없음)                              | `1` 이면 창 표시                                                                                                                              |
| `MOUSER_E2E`         | (없음)                              | `1` 일 때만 Mouser 카트 인계 e2e(bom-mouser-cart-handoff) 실행 — **실 Mouser Cart API**, SamplePCB 계정에 e2e 카트 1개가 생겼다 비워진다 |

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
               createG5OrderFixture·createOrderSpec — 실데이터에 없는 제품군×상태 조합을 통째로 만들 때
               (예: metalMask 는 열린 주문이 0건이라 주문·카트·스펙을 e2e 소유로 세운다)
  browser.ts   newSession(identity, opts) — /spcb/api/me 스텁 로그인·localStorage 프리셋·snap
  mailpit.ts   목록/검색/본문/선택 삭제 (전체 삭제는 의도적으로 미제공)
  php-login.ts newPhpSession(creds) — 그누보드 실로그인(거버·주문서 등 PHP 구간)
  journey.ts   여정 공용부 — 리포트·거버 제출·PCB/BOM 영카트 주문
specs/
  harness.e2e.test.ts        하네스 자가 검증 — 새 시나리오의 복사 시작점
  pcb-ship-board.e2e.test.ts PCB 보내기 보드 §9 스토리(세션 스모크 28케이스 편입판)
  pcb-package-qr.e2e.test.ts PCB Case QR — 합배송 PO별 라벨·권한·재인쇄·무효화·입고 동기화
  pcb-transport.e2e.test.ts  운송수단(항공/해상) — 수단 박제·첨부 종류 접힘 회귀·해상 B/L 게이트·전환 정리·국내 배제
  bom-transport-contract.e2e.test.ts BOM 선적 운송수단 계약·서버 정합(read-only — 실데이터 위 직렬화·첨부 사전 오염 확인)
  bom-mouser-cart-handoff.e2e.test.ts Mouser 카트 인계(D41) — 발주서당 CartKey 고정·전체 교체 [다시 담기]·실카트 대조 [카트 상태 확인]·가져오기 .csv·Case 화면 왕복(MOUSER_E2E=1 옵트인, 실 API)
  bom-receiving-scan.e2e.test.ts     입고 스캔(D42) — 공급사 봉투 ECIA 2D 라벨 파싱·발주 품목 대조·원장(기록/취소/진행)·선적·배송 통합 스캔 박스 화면·DigiKey 3-legged 연결 가드(RUN 게이트만, 실 로그인 제외); `pnpm -F e2e e2e:receiving:keep`(RECEIVING_E2E_KEEP=1)은 견적·발주·스캔·선적을 지우지 않고 남김; `e2e:receiving:seed`(RECEIVING_E2E_SEED_ONLY=1)는 검사 없이 발주한 상태(issued) DigiKey·Mouser 발주서만 만들어 남김(화면 스캔 연습 무대)
  delivery-method.e2e.test.ts        배송방법 P1 — 비택배(퀵·방문수령·직배송)는 송장 없이 배송 전이·한글 라벨 병용·택배 3필드 가드(docs/DELIVERY_METHOD.md)
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
  journey-search.e2e.test.ts           여정 24호 — 검색 정확성(read-only: 세 키 적중·와일드카드 escape·검색×탭 교집합)
  journey-authz.e2e.test.ts            여정 25호 — 역할 경계 매트릭스(read-only: 무인증401·회원403·협력사403·관리자200, 양성 대조 포함)
  journey-stock.e2e.test.ts            여정 26호 — 재고 축(배송에서 차감·주문 복귀에서 복원·이중 복원 없음 = 정리 관례의 근거)
  journey-delete.e2e.test.ts           여정 27호 — 삭제의 위계(보관함 2단계·PARTNER_TRACK_ACTIVE·정리 후 열림·고아 0)
  journey-maillog.e2e.test.ts          여정 28호 — 발송 이력 원장(종류·주체·수신처·컨텍스트 연결 = 보냈다는 증거)
  journey-as-rounds.e2e.test.ts        여정 29호 — A/S 다회차(채번 1→2→3·회차 공존·박스가 회차로 갈림)
  journey-remit-multi.e2e.test.ts      여정 30호 — 송금 다회·증빙(3회 분할 잔액·완납 큐 이동·증빙 회차별·정정 반영)
  journey-notify-gate.e2e.test.ts      여정 31호 — 알림 게이트(요청 스위치·설정 우선·노출-발송 정합, 전역 설정 원복 필수)
  journey-screens.e2e.test.ts          여정 32호 — 화면 렌더 회귀(세 역할 16화면 pageerror·5xx·빈 껍데기 전수)
  md-quote-loop.e2e.test.ts            MD 1편 — 2단 견적 루프(mdtester 상설 픽스처, RUN 게이트만)
  md-direct-self.e2e.test.ts           MD 직접 제작 — 하위 견적·발주 없이 직접 회신→self 발주→EQ·생산·발송
  md-quote-rework.e2e.test.ts          MD 3편 — 하위 재선정·배정 회수(RUN 게이트만)
  md-order-relay.e2e.test.ts           MD 2편 — 주문 연결 완주(국내 MD: 하위 국제 + 관리자행 국내)
  md-domestic-relay.e2e.test.ts        MD 4편 — 전 구간 국내(KR MD: 받는측 md domestic + 게이팅)
  md-cn-relay.e2e.test.ts              MD 5편 — CN MD(mdtester2상사: 비KR domestic + CN→KR 국제)
  journey-metal-mask.e2e.test.ts       메탈마스크 트랙 — EQ 대신 고객문의사항(선택)+좌표파일(필수 게이트·문의 사진·확인 뒤 통보 없는 고객 열람·이름 중립화·EQ 트랙 무영향)
  pcb-guards.e2e.test.ts               확정 409 가드 박제(PO_ISSUED·EQ_LOCKED·RECEIVE_LOCKED 등 10종)
  rework-probe.e2e.test.ts             재작업 가드 회귀 — 잠김→정리→열림 순환(W2~W9, 스크립트 probe)
  journey-bom-domestic.e2e.test.ts     BOM 여정 1호 — 혼합 BOM→RFQ→주문→국내 배송 완료
  journey-bom-split.e2e.test.ts        BOM 여정 2호 — 단일검색→2개 부분 RFQ→국내·국제 분할 조달
  journey-bom-revision.e2e.test.ts     BOM 여정 3호 — 고객 회신→품목 정정→재회신→수정 주문
  journey-bom-reorder.e2e.test.ts      BOM 여정 4호 — 묶음 부분취소→재주문→이력 보존→조달 완료
  journey-bom-shortage-recovery.e2e.test.ts BOM 여정 5호 — 결제 후 부분 부족→잔량 대체발주→분할 입고
  journey-bom-rfq-reassignment.e2e.test.ts BOM 여정 6호 — 미응답 RFQ 회수→재배정→매직링크 회신
  journey-bom-supplier-procurement.e2e.test.ts BOM 여정 7호 — 공급사 자동실행 실패→수동 구매→국제 조달
  journey-bom-receiving-order.e2e.test.ts  입고 스캔 주문 여정 — 고객 주문 붙은 Case 의 DigiKey·Mouser 봉투 스캔→입고 완료(선적 생략)→배송 처리 대기→배송·완료 (journey:bom:receiving, 생성물 보존)
  journey-bom-trade-documents.e2e.test.ts BOM 여정 8호 — 국내 PO별 견적서→묶음 거래명세서→배송 완료
  journey-bom-case-deletion.e2e.test.ts BOM 여정 9호 — Case audited/reset 삭제→주문·공유·경합 보호
  journey-bom-bulk-deletion.e2e.test.ts BOM 여정 10호 — 혼합 일괄 삭제→부분 성공·보호·선택 유지
  journey-bom-claims.e2e.test.ts       BOM 여정 11호 — 배송 후 문제 접수→관리자 검토·해결→주문 불변
  journey-bom-access-control.e2e.test.ts BOM 여정 12호 — 고객 소유권→직접 URL 은닉·오류 복구
  journey-bom-history-management.e2e.test.ts BOM 여정 13호 — 내역 검색→보호·삭제 실패 복구·모바일 탐색
  journey-bom-workbook-recovery.e2e.test.ts BOM 여정 14호 — 다중 시트 분석 영속→오류 복구·시트 복원
  journey-bom-draft-save-recovery.e2e.test.ts BOM 여정 15호 — 초안 자동저장 경쟁→503·이탈·요청 복구
  journey-bom-quantity-boundaries.e2e.test.ts BOM 여정 16호 — 수량 직접 입력→경계 보정·요청 안전성
  journey-bom-manual-part-workspace.e2e.test.ts BOM 여정 17호 — 고객 수동 부품 검색→추가·변경·실패 복구
  journey-bom-candidate-selection.e2e.test.ts BOM 여정 18호 — 후보 비교→검토 선택·차단·제외 복원
  journey-bom-comparison-workspace.e2e.test.ts BOM 여정 19호 — 전체 BOM 비교→필터·페이지·오류·모바일 열 탐색
  journey-bom-admin-comparison-workspace.e2e.test.ts BOM 여정 20호 — 관리자 전체 비교→가림·페이지·복구·모바일 감사
  journey-bom-admin-workbook-recovery.e2e.test.ts BOM 여정 21호 — 관리자 실제 XLSX→분석·시트 오류 복구·모바일 감사
  customer-eq-menu.e2e.test.ts         마이페이지 "확인 요청 > 제조 확인"(/shop/eq) — /mine API·배지·목록에 결정 폼 없음·딥링크·390px
  customer-as-menu.e2e.test.ts         마이페이지 "문의 > A/S 접수"(/shop/as) — PCB·BOM /mine 배타·회색 배지 합산·탭·폼 없음·앵커·390px
  journey-pcb-as-mypage.e2e.test.ts    여정 44호 — PCB 완주(거버→완료) 뒤 **마이페이지 A/S 접수 진입점으로** 접수→재생산 회차→종결 완주(정리 포함, JOURNEY_KEEP=1 로 남김)
  demo-pre-eq-keep.e2e.test.ts         데모 무대 — EQ 직전(발주서 발행)까지만 달리고 남긴다(DEMO_KEEP=1, 협력사 기본 tester2협력 = 사람이 로그인 가능한 실계정)
  orderinquiry-tabs.e2e.test.ts        주문내역 유형 탭(전체/PCB/부품) — 총건=DB count·페이지 링크 track 유지·폴백·사이드바 다크 필·제목 36px
  prompt-modal.e2e.test.ts             커스텀 대화상자(prompt·confirm 대체)가 실제로 뜨는지
```

## 완주 여정 (탐색 주행)

옵트인 2중 게이트(`PORTAL_E2E=1` + `JOURNEY=1`)로만 돈다. 공통 사전 조건은
nginx·API(3333)·웹(5173)·Mailpit + `e2e/.env.e2e` 고객 자격이다. PCB 1–4호는
**거버(8040)**, BOM 1–3호·14호·21호는 **sp-engine(8400)**이 추가로 필요하다. BOM 4호는 이미
회신 완료된 거래 스냅샷부터 시작해 주문 하류만 검증하므로 엔진이 필요하지 않다. BOM 5호도
회신 완료 스냅샷부터 시작하며 결제 이후 공급 차질 복구를 검증한다. BOM 6호는
견적요청 스냅샷부터 시작해 미응답 RFQ 회수·재배정과 무로그인 회신을 검증하므로 엔진이
필요하지 않다. BOM 7호는 공급사 구매조건이 선정된 회신 완료 스냅샷부터 시작하며,
표준 Mouser 공급사를 스스로 준비한다. 모든 공급사 SKU를 의도적으로 비워 외부 API를
호출하지 않고도 자동 실행 실패와 수동 구매 복구를 검증하므로 엔진도 필요하지 않다.
BOM 8호는 회신 완료된 국내 거래 스냅샷 2건부터 시작하고 전용 표준 파트너를 스스로
준비해 PO별 견적서와 묶음 거래명세서의 불변성을 검증하므로 엔진이 필요하지 않다.
BOM 9호는 실행 중 만든 회신 완료 Case만 삭제 대상으로 사용한다. 일반·미입금·결제 Case는
제품 삭제 경로로 정리하고, 공유 주문 2건은 차단 결과를 확인하기 위해 생성물 대장에 남긴다.
서버 프리뷰·영카트 주문·감사 원장을 직접 대조하므로 엔진과 협력사 계정은 필요하지 않다.
BOM 10호는 일반·결제·실행 직전 변경·공유 주문 Case를 한 목록 선택에 섞어 일괄 삭제한다.
성공 3건만 선택과 원장에서 제거되고 실패·보호 2건은 선택된 채 남는지 확인하며, 엔진과
협력사 계정은 필요하지 않다. 성공·stale 표본은 제품 경로로 정리하고 공유 주문 2건만 남긴다.
BOM 11호는 회신 완료 Case를 고객 주문·입금한 뒤 선행 조달·입고 fixture로 배송 경계를 만든다.
배송 전 접수 차단부터 완료 주문의 복수 품목 접수, 활성 접수 중복·Case 삭제 보호, 관리자
검토·낙관적 잠금·해결, 고객 답변과 주문 불변을 검증하며 엔진과 협력사 계정은 필요하지 않다.
BOM 12호는 소유자·타 회원·관리자·익명 세션을 한 Case에 교차 적용해 목록·상세·파일·변경·
주문·클레임의 소유권과 직접 URL 은닉을 검증한다. 비존재와 타인 ID는 같은 404로 숨기되,
일시적 503은 같은 화면의 재시도로 복구하는지 확인하며 엔진과 협력사 계정은 필요하지 않다.
BOM 13호는 별도 가상 고객에게 상태 6종·26건을 만들어 검색·필터·페이지 선택 범위, 목록·삭제
503 복구, 단건·선택·전역 삭제, 삭제 직전 상태 경합, 느슨한 파일 참조 정리와 390px 표 탐색을
검증한다. 테스트 소유 데이터만 제품 경로로 삭제하고 종료 훅이 나머지를 전부 회수한다.
BOM 14호는 실제 다중 시트 XLSX와 유효 BOM이 없는 XLSX를 업로드해 시트 판별, prepare 502
재시도, 엔진 잡 삭제 후 DB 분석 스냅샷 계산, 시트 변경 503 재시도·제외·동일 라인 복원,
390px 업로드·실패 화면과 키보드 모달 경계를 검증하고 Case·엔진 잡을 모두 회수한다.
BOM 15호는 별도 가상 고객의 작성 중 견적 2건으로 저장 중 후속 편집 직렬화, PATCH 503 뒤
로컬 변경 보존·명시적 재시도, 실패 중 견적 이동 차단, 디바운스 이탈 전 저장, 실제
beforeunload 경고, 견적요청 전 저장 게이트와 키보드 모달을 검증한다. 390px에서 오류·비교·추가
버튼과 요청 모달이 화면 안에 완전히 표시되는지도 확인하고 종료 훅이 두 견적을 모두 회수한다.
BOM 16호는 별도 가상 고객의 작성 중 견적 6건으로 세트·예비·행 주문수량의 빈 값, 음수,
소수, 상한 초과를 직접 입력해 정수 범위 보정과 안내를 검증한다. 키보드 증감·최솟값의 무변경
저장 생략, DB 정수 상한의 API 400, 상한 보정 직후 견적요청 동결, 390px 표시까지 확인하고
종료 훅이 모든 견적을 회수한다.
BOM 17호는 별도 가상 고객의 업로드형 작성 중 견적 4건에서 미저장 수량을 먼저 저장하고
전체화면 부품 추가 작업공간을 여는 흐름부터 실제 색인 MPN 검색, Mouser 추가와 Digikey 변경의
동일 행 upsert, 추가·수량·삭제 503 복구를 검증한다. 검색 작업공간의 초점·스크롤·키보드 경계와
390px 결과 액션·추가 목록·완료 동선도 확인하고 종료 훅이 모든 견적을 회수한다.
BOM 18호는 별도 가상 고객의 업로드형 작성 중 견적 6건과 실제 색인 부품 3개를 연결해
sp-engine의 자동 선정·검토 필요·차단 후보 판정을 그대로 표시하는지 검증한다. 검토 후보의
중첩 확인·고객 선택 이력, 선택 503 뒤 원장 보존과 재시도, 차단 후보 API 409, 수량 확인 행의
제외·복원과 후보 정체성 보존을 교차 확인한다. 후보 드로어의 초점·스크롤·키보드 경계와
390px 행 액션·후보 카드·검토 확인창도 확인하고 종료 훅이 모든 견적을 회수한다.
BOM 19호는 별도 가상 고객의 업로드형 작성 중 견적 1건에 영속 분석 원문과 정상 4·검토 2·
미검색 2개 활성 행, 선택 제외 시트 1개와 직접 추가 행을 구성한다. 만료된 엔진 잡을 호출하지
않고도 비교 요약·2페이지·검색·판정·시트 필터를 복원하는지 확인하고, 비교 GET 503 재시도와
닫기·재열기의 쿼리 초기화, 전체화면 키보드 경계를 검증한다. 390px에서는 Excel 원본 열이
공급사 후보를 덮지 않고 좌우 탐색 이름·안내·최우측 공급사명이 실제로 보이는지 확인한다.
BOM 20호는 별도 가상 관리자 소유의 업로드형 작성 중 견적 1건에 19호와 같은 영속 비교 원장을
구성해 독립 스냅샷인 관리자 워크벤치를 검증한다. 적층 레이아웃의 분석 패널이 상단 비교 버튼을
가리지 않는지부터 전체화면 포커스·2페이지 유지·필터 이름·503 재시도·재진입 쿼리 초기화를
확인한다. 390px에서는 Excel 원본 열을 지나 최우측 공급사 결과까지 키보드와 좌우 스크롤로
실제로 탐색할 수 있는지 확인하며 엔진 잡을 다시 호출하지 않고 종료 후 fixture를 회수한다.
BOM 21호는 관리자 독립 업로드 화면에서 실제 다중 시트 XLSX와 유효 BOM이 없는 XLSX를 올린다.
업로드 503 알림, prepare 502 뒤 완료된 같은 엔진 잡 재사용, 시트 변경 503 재시도와 제외·복원,
DB 분석 스냅샷 계산을 검증한다. 업로드 카드와 시트 관리 모달의 키보드·포커스·배경 스크롤,
390px 실패 화면의 전체 시트명까지 확인하고 테스트 견적·원본 파일·엔진 잡을 모두 회수한다.

| 스크립트 | 대상 |
| --- | --- |
| `pnpm -F e2e pcb:qr` | PCB Case QR 5개 시나리오 — 합배송·보안·재인쇄·무효화·입고 동기화 |
| `pnpm -F e2e journey` | 전 여정 연속(파일 직렬 — journey-*) |
| `pnpm -F e2e journey:intl` | 1호만 — 해외 협력사 |
| `pnpm -F e2e journey:domestic` | 2호만 — 국내 협력사 |
| `pnpm -F e2e journey:batch` | 3호만 — 묶음 발송 |
| `pnpm -F e2e journey:md` | 4호만 — MD 경유 2단 |
| `pnpm -F e2e journey:bom` | BOM 1~21호 연속(파일 직렬) |
| `pnpm -F e2e journey:bom:1` | BOM 1호만 — 파일 BOM·국내 단일 조달 |
| `pnpm -F e2e journey:bom:2` | BOM 2호만 — 단일검색·분할 RFQ·복합 물류 |
| `pnpm -F e2e journey:bom:3` | BOM 3호만 — 회신 후 품목 정정·재견적 |
| `pnpm -F e2e journey:bom:4` | BOM 4호만 — 묶음 부분취소·재주문·조달 완료 |
| `pnpm -F e2e journey:bom:5` | BOM 5호만 — 공급 부족·잔량 대체발주·분할 입고 |
| `pnpm -F e2e journey:bom:6` | BOM 6호만 — RFQ 미응답 회수·재배정·매직링크 회신 |
| `pnpm -F e2e journey:bom:7` | BOM 7호만 — 공급사 자동실행 실패·수동 구매·국제 조달 |
| `pnpm -F e2e journey:bom:8` | BOM 8호만 — 국내 견적서·묶음 거래명세서·인쇄 UX |
| `pnpm -F e2e journey:bom:9` | BOM 9호만 — Case 삭제·초기화 안전 경계 |
| `pnpm -F e2e journey:bom:10` | BOM 10호만 — 혼합 일괄 삭제·부분 성공 |
| `pnpm -F e2e journey:bom:11` | BOM 11호만 — 배송 후 접수·검토·해결 |
| `pnpm -F e2e journey:bom:12` | BOM 12호만 — 고객 소유권·직접 URL·오류 복구 |
| `pnpm -F e2e journey:bom:13` | BOM 13호만 — 내역 검색·보호·삭제 복구 |
| `pnpm -F e2e journey:bom:14` | BOM 14호만 — 다중 시트 분석 영속·복구 |
| `pnpm -F e2e journey:bom:15` | BOM 15호만 — 초안 자동저장·이탈 복구 |
| `pnpm -F e2e journey:bom:16` | BOM 16호만 — 수량 직접 입력·경계 보정 |
| `pnpm -F e2e journey:bom:17` | BOM 17호만 — 수동 부품 검색·추가·변경·실패 복구 |
| `pnpm -F e2e journey:bom:18` | BOM 18호만 — 후보 비교·검토 선택·차단·제외 복원 |
| `pnpm -F e2e journey:bom:19` | BOM 19호만 — 전체 비교·필터·페이지·오류 복구 |
| `pnpm -F e2e journey:bom:20` | BOM 20호만 — 관리자 비교·패널 가림·모바일 감사 |
| `pnpm -F e2e journey:bom:21` | BOM 21호만 — 관리자 XLSX 분석·오류 복구·모바일 감사 |
| `pnpm -F e2e journey:bom:headed` | BOM 1~21호 브라우저 관찰 모드 |
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
| `pnpm -F e2e journey:search` | 24호만 — 검색 정확성(% 한 글자가 전체를 반환하던 LIKE escape 누락 회귀선, 쓰기 0) |
| `pnpm -F e2e journey:authz` | 25호만 — 역할 경계(네 주체 × 열 경로 · 남의 문서 id 직접 접근 차단 · 양성 대조, 쓰기 0) |
| `pnpm -F e2e journey:stock` | 26호만 — 재고 축(모든 여정의 정리가 기대는 force-status '주문' 복원이 실제로 맞는지) |
| `pnpm -F e2e journey:delete` | 27호만 — 삭제 위계(1단계 보관함/2단계 영구 · 협력 트랙 가드 · 조직은 정지로 배제) |
| `pnpm -F e2e journey:maillog` | 28호만 — 발송 이력(sp_mail_log 에 종류·sentBy·recipient 가 남고 Case 상세에서 되찾히는가) |
| `pnpm -F e2e journey:asrounds` | 29호만 — A/S 3차까지(회차 채번·원발주 불변·박스 3개 분리, 시드 발주) |
| `pnpm -F e2e journey:remitmulti` | 30호만 — 송금 다회(100+100+100 잔액 정확 · 완납이 큐를 가름 · 정정·삭제 즉시 반영) |
| `pnpm -F e2e journey:notify` | 31호만 — 알림 게이트(설정이 실제로 발송을 막는가 · 전역 cf_email_use 를 잠깐 끄므로 순차 주행 전제) |
| `pnpm -F e2e journey:screens` | 32호만 — 화면 렌더 회귀(어느 여정도 안 여는 화면까지 전수, 쓰기 0) |
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

BOM 1호는 `fixtures/bom-journey-1-diverse.csv`를 실제 고객 세션으로 업로드한다. 엔진이
활성화한 행을 런타임에 읽어 RFQ 회신·선정·발주·QR 포장까지 같은 품목 집합으로 연결하므로,
픽스처에 예시 행이 늘어나도 시나리오의 품목 개수 상수를 수정할 필요가 없다. 관리자 회신은
기본 고객 이메일 노출과 일회성 변경 주소 발송·재발송을 함께 검증한다.

BOM 2호는 `/app/bom/search`에서 정확 MPN 4건을 하나의 견적으로 구성한다. 가격이
있는 3건은 두 협력사에 서로 다른 부분 RFQ로 보내고 품목별로 분할 선정하며, 정확히
일치하지만 가격이 없는 1건은 제조사·설명·이미지를 유지한 미산정 품목으로 고객에게
보여준다. 선정 결과는 서로소인 2개 PO로 연결하고 국내·국제 물류를 각각 완주한 뒤,
입고 게이트가 `0/2 → 1/2 → 2/2`에서 오직 2/2에서만 고객 배송을 여는지 검증한다.
현재 BOM RFQ 계약은 협력사 기본 통화와 무관하게 KRW로 고정되므로, 2호는 해외 협력사도
KRW로 회신되는 현재 제약을 명시적으로 기록한다.

BOM 3호는 작은 원본 CSV를 고객이 요청하고 협력사 회신·고객 확정까지 진행한 뒤, 관리자가
원본 품목을 강제 교체하고 누락 품목을 수동 추가한다. 실수로 추가한 수동 행만 다시 제거하며
원본 행 제거 409, 오래된 화면의 변경 409, 관리자 확인 지문 무효화와 회신 게이트를 함께
검증한다. 동일 RFQ ID에서 수정 품목을 재회신받고 새 주문·PO·배송에는 수정 스냅샷만
들어가는지 확인하며, 최초 고객 메일과 선택 이력은 감사 원장에 그대로 보존한다.

BOM 4호는 저항·MLCC Case와 MCU·커넥터 Case를 확정 거래 스냅샷으로 준비하고 두 건을 한
영카트 주문으로 묶는다. 미입금 상태에서 A만 취소해 주문 헤더·미수금·세액이 B 기준으로
재계산되는지, 헤더가 이후 `입금`이어도 취소 A의 발주는 막히는지 검증한다. 고객이 A를 다시
주문하면 새 `ct_id`·새 주문을 만들되 옛 취소행과 원주문 Case 연결을 보존해야 한다. 두 현재
Case를 각각 발주한 뒤 한 국내 발송으로 합쳐 입고·고객 배송을 완료하며, 배송·완료 전이도
과거 취소행을 되살리지 않는지 끝에서 다시 확인한다.

BOM 5호는 MCU·MLCC·커넥터·LED 4품목을 국내 협력사에 발주한 뒤 MLCC 20개 중 7개가
부족해진 결제 후 차질을 만든다. 원 협력사는 포털에서 발송 전에 부족 수량·사유를 신고하고,
관리자는 같은 견적 품목에 재고·단가를 회신한 다른 협력사를 골라 정확히 7개만 새 PO로
발행한다. 원 PO와 고객 확정·결제 금액은 불변이며 국내 원 공급분 13개와 국제 대체분 7개의
선적 리스트·Invoice가 실제 수량을 사용해야 한다. 배송 API는 미복구 부족분과 입고 1/2에서
각각 409로 막히고, 2/2 입고 뒤에만 고객 배송 큐가 열린다.

BOM 6호는 확정 전 3품목 Case를 1차 협력사에 발송했다가 미응답 RFQ를 회수한다.
회수 즉시 포털 조회와 구 매직링크가 404로 끊기고, 다른 협력사에 재배정한 뒤
링크 재발급이 구 토큰을 즉시 무효화하는지 본다. 새 링크에서 계정 없이 3품목을
회신하고, 선정·고객 확정·국제 PO·Invoice/AWB·통관·입고·고객 배송을 완주한다.
말미에 회수된 협력사 RFQ·PO가 0건이고 모든 선정 포인터가 재배정 협력사를 가리키는지,
390px 무로그인 회신표의 가로 이동 안내·화살표와 품목·필드별 입력 접근성 이름을 검증한다.
또한 일시적 503은 만료 링크와 구분해 재시도할 수 있어야 하며, 허용 범위를 벗어난 숫자는
해당 품목·필드 안내와 포커스를 제공하고 API 요청 전에 차단되어야 한다.

BOM 7호는 사람 협력사 RFQ 없이 Mouser 구매조건만 선정한 Case를 고객 주문·결제까지
진행한다. 공급사 SKU가 전부 없는 안전한 조건에서 외부 요청 없이 자동 실행 실패를 만들고,
실패 사유가 발주 원장과 관리자 화면에 남는지 확인한다. 발행 상태에서는 선적 생성을 409로
차단하고 구매담당자가 공급사 사이트의 실제 주문·결제를 확인한 뒤 [구매 완료 처리]를 해야
국제 포장·Invoice·AWB·출고·도착·통관·입고와 고객 배송을 진행할 수 있다. 마지막에는
사람 RFQ가 0건인 직접 공급사 선정 구조와 390px 조달표의 문서 가로 넘침까지 재검증한다.

BOM 8호는 국내 협력사에 선정된 Case 2건을 한 주문으로 결제하고 각각 PO를 발행한 뒤
한 박스 선적으로 묶는다. PO별 협력사 견적서는 발행 시점 사업자정보·품목·가격을 보존하고,
묶음 거래명세서는 Packing List R0 초안에서 R1 확정으로 바뀌며 두 PO의 출고 수량·LOT·
Date Code·VAT를 합산해야 한다. 관리자와 협력사 API·화면이 같은 원본을 보는지, 발행 후
파트너 기준정보 변경과 입고·고객 완료가 문서를 소급 변경하지 않는지 검증한다. 390px
문서 레이어의 대화상자 의미·포커스 트랩/복귀·좌우 이동·잘못된 응답 뒤 재시도도 포함한다.

BOM 9호는 관리자가 Case 상세 위험 구역에서 보는 삭제 영향을 서버 프리뷰와 대조한 뒤,
일반 Case의 사유 포함 감사 삭제와 단독 미입금 주문의 기록 없는 초기화를 각각 실제 UI로
완주한다. 단독 결제 주문은 별도 강제 체크와 복구 불가 재확인 뒤에만 주문·cart를 지우고
SmartBOM 감사행과 영카트 주문 백업을 남겨야 한다. 두 Case가 공유하는 주문은 결제 강제
플래그로도 삭제할 수 없고, 프리뷰 뒤 Case가 바뀌면 오래된 토큰은 거부돼야 한다. 삭제
레이어의 3단계 접근성 이름·포커스 트랩/복귀·배경 스크롤 잠금, 390px 가로 넘침, 영향 조회
실패 뒤 명시적 재시도와 정상 삭제 직후 불필요한 상세 404가 없는지도 함께 검증한다.

BOM 10호는 진행현황 목록에서 일반 Case, 결제 주문 Case, 실행 직전 변경될 Case, 공유 주문
Case를 함께 선택한다. Case별 영향 조회 한 건이 깨져도 같은 레이어에서 명시적으로 다시
확인할 수 있어야 하고, 결제 주문 강제 포함으로 대상 범위가 바뀌면 기존 복구 불가 확인을
무효화해야 한다. 실행 시 프리뷰가 낡은 Case만 실패시키고 나머지를 계속 처리하며, 결과
레이어는 삭제·실패·처음부터 제외된 보호 대상을 구분한다. 닫은 뒤에는 성공한 ID만 선택에서
빠지고 실패·보호 ID는 남아야 하며, SmartBOM 감사행·영카트 결제 주문 백업·공유 주문 원장을
교차 검증한다. 3단계 이름·포커스 트랩/복귀·배경 스크롤 잠금과 390px 표시도 함께 확인한다.

BOM 11호는 완료된 주문의 부품 누락·파손·오배송을 주문 취소나 환불과 분리된 서비스 원장으로
접수한다. 배송 전에는 화면과 API가 접수를 막고, 배송·완료 뒤 고객은 정확한 부품과 문제 수량,
상세 내용, 자동 환불이 아님을 확인해야 한다. 활성 접수는 중복 생성과 Case 영구 삭제를 막으며,
관리자는 `접수됨 → 검토 중 → 해결 완료/처리 불가` 순서와 version 경합 방어를 거쳐 답변한다.
390px에서 숨은 오른쪽 패널을 `주문·문제 접수`로 발견할 수 있는지, 중첩 Escape와 포커스 복귀,
부품 표 내부 가로 이동, 해결 뒤 다음 접수 자격과 영카트 주문·결제 불변까지 교차 검증한다.

BOM 12호는 한 고객의 견적을 소유 고객·타 회원·관리자·익명 세션에서 교차 조회한다. 타 회원의
상세·원본 파일·변경·견적요청·주문·클레임·삭제는 존재하지 않는 ID와 같은 404여야 하고, 목록과
Recent file에도 제목이 노출되면 안 된다. 숫자가 아닌 깨진 주소는 API를 호출하지 않는 영구 오류,
일시적 503은 같은 화면에서 회복 가능한 오류로 구분한다. 390px 오류 카드의 활성 포커스·가로
안전성·`내 BOM 내역` 우선 행동, 익명 로그인 원 URL 왕복, 비관리자 관리자 화면 가드와 관리자
전용 API/고객 API 분리를 함께 검증한다.

**생성물은 원칙적으로 자동 정리하지 않는다.** 단, 9·10호의 삭제 성공 표본은 제품 삭제
경로 검증 자체가 정리이며 stale 표본도 reset 경로로 정리하고 공유 주문 차단 표본만 남긴다.
12~21호의 거래 관계가 없는 격리 fixture는 소유권·목록·분석·초안·수량·수동 추가·후보 선택·고객·관리자 전체 비교와 관리자 업로드 검증 뒤 하네스가 직접 정리한다.
그 밖의 생성물은 완주 후 리포트
(`output/journey/findings*.md`) 대장을 보고 손으로 지운다 — 순서는 ① 주문을
`force-status '주문'` 으로 내려 **재고 복원** ② g5 cart+order ③ sp_* 역순
(file→shipment_po→shipment→eq_review→po→rfq→file→spec).

## 핵심 설계

- **브라우저 로그인 = `/spcb/api/me` 라우트 스텁.** sp-vue 는 마운트 전 이 PHP
  브리지로 세션→JWT 교환을 하므로, Playwright 라우트 인터셉트로 로컬 서명 JWT 를
  반환하면 **비밀번호·PHP 세션 없이** 임의 계정(파트너/관리자)으로 실 Vue + 실
  Node API 풀스택이 돈다. 그누보드 실로그인 왕복 자체를 검증해야 할 때만 실계정
  자격증명이 필요하다(완주 여정은 `e2e/.env.e2e`의 로컬 테스트 회원을 사용하고,
  익명 가드의 URL 왕복 검증까지는 무자격으로 가능).
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
- **여정을 연속으로 돌리면 502 로 죽는다 — 원인은 앱이 아니라 프록시다**(2026-08-16 규명).
  Vite dev 는 모듈 하나가 요청 하나라 여정 몇 편이면 수만 건이 나가는데, nginx 가 upstream
  연결을 재사용하지 않으면 소켓이 TIME_WAIT 으로 쌓여 **Windows 임시 포트(약 14K)가
  고갈**된다(`error.log` 에 `10048 Only one usage of each socket address`). 그러면 SPA 모듈이
  502 로 안 내려와 화면이 비고, 테스트는 엉뚱하게 "버튼이 안 보인다"·"hidden body"로 죽는다.
  **증상이 테스트마다 떠도는 게 특징**(어제는 K03, 오늘은 C06). 처방은 `map $http_upgrade`
  + `upstream … keepalive` — `ops/nginx/local-web.conf` 에 반영돼 있다. 리포트의
  `## HTTP ≥400` 에 502 가 무더기면 이걸 의심한다.
- Mailpit 은 사용자 관찰용이기도 하다 — 시드가 유발한 메일만 `mailpitDelete(ids)`. 같은 제목이
  주행마다 반복되므로(프로젝트명이 픽스처 파일명이다) **발송 전에 기준선(최신 1통 ID)을 잡고**
  그 뒤 신착만 본다 — 안 그러면 지난 주행 메일을 잡는다.
- 스크린샷은 `e2e/output/journey/` **공용 폴더**에 쌓인다 — 여정마다 접두사 글자를 하나씩
  전용으로 쓴다(D=2호·J=6호·M/T/W·X=11호·P=12호…). 겹치면 다른 편의 캡처를 조용히 덮어쓴다.
