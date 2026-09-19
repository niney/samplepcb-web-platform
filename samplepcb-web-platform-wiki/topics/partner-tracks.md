---
topic: partner-tracks
last_compiled: 2026-09-19
sources_count: 52
status: active
---

# partner-tracks

## Purpose [coverage: high — 12 sources]

**협력사(파트너) 트랙** = 고객 주문의 뒤편에서 도는 **관리자 ↔ 협력사 협업 축** 전체. 레거시 SmartBOM(sp-smartbom-web + samplepcb_xpse)의 두 트랙을 "레거시 설계 추종이 아니라 **돌아가는 프로세스만** 이식"해 플랫폼 척추(sp-node `/api` + sp-vue `/app/admin`·`/app/partner` + sp-php 브리지)로 재구성했다. 소스 날짜 범위는 **2026-07-29(BOM 트랙 정본 작성) ~ 2026-09-16(관리자 BOM 메뉴 통합)** 이고 이 토픽의 사실은 전부 6개월 이내다. 시간축은 셋으로 읽는다:

1. **07-29~08-02 BOM 트랙**이 문법을 세웠다 — 스냅샷 박제·서버 인가 핑퐁·역할별 워크큐·"박스에 먼저 담는" 발송 모델.
2. **08-04~08-18 PCB 트랙**이 그 자산의 7할을 재사용하며 PCB 고유 축(EQ 5단계·MD 2단·다중통화·A/S 회차·직송·스텐실)을 얹었고, **08-10~08-11 완주 여정 1~43호**가 결함 60여 건을 교정해 가드 체계를 굳혔다.
3. **08-22~09-16**은 새 상태 기계가 아니라 **통합·UX**다 — 포털 사이드바 셸 R3·협력사 보유 부품 원장·i18n·Mouser 인계·입고 스캔·관리자 메뉴 정리.

정본 우선순위: [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md)는 **§5.1 정정이 본문보다 우선**, [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md)은 **§9 구현 기록이 §5 설계안보다 우선**이며 레거시 위키·문서는 신뢰하지 않는다(코드·DDL 헤더 주석 > doc > 위키).

범위와 정본:

- **BOM 트랙** — 고객 스마트 BOM 견적(`sp_bom_quote`, 정본은 [sp-node-api](sp-node-api.md)의 BOM 절)이 `reviewing`에 들어간 뒤: 협력사 RFQ(부분 행 발송·매직링크 무로그인 회신·관리자 대리 입력) → 3사 라이브 시세와 나란히 비교·선정 → 확정가 → 고객 주문(견적 통째 1카트행, 확정가×1.1) → 결제 확인 후 협력사 발주서(PO)·외부공급사 카트/리스트 → 선적 핑퐁(국제 6·국내 3단계)·Packing List·QR·상업송장·거래문서 → 입고 → 고객 배송 → 클레임. 정본 [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md)(D1~D42, §6.1~6.38).
- **PCB 트랙** — 거버 견적(`sp_order_spec`) 위에 확정가 **앞단**의 협력사 RFQ(직속·MD 2단·KRW/USD/CNY) → 선정+확정가 → 주문·입금 후 PO → **EQ 5단계**(또는 메탈마스크의 문의+좌표파일) → 생산 → 박스 발송(받는측 관리자/MD, 직송, Case ID 갈래, 항공/해상) → 입고확인 → 고객 배송 → A/S 재발주 회차 → 고객 클레임. 정본 [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) §6 결정·§9 구현 기록.
- **파트너 포털** IA·셸([PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md)), **협력사 보유 부품 원장**([PARTNER_PARTS](../../docs/PARTNER_PARTS.md)), 포털 **i18n**([partner-i18n](../../docs/partner-i18n.md)), **발송 이력 원장**([MAIL_LOG](../../docs/MAIL_LOG.md)), 고객 주문의 **배송방법 축**([DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md)), **사내 서비스 BOM API**([BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md)), 회수한 레거시 자료([legacy-smartbom](../../docs/legacy-smartbom/README.md)).

역할 다섯이 축이다:

- **관리자** — 검토·배정·선정·확정가·발주·EQ 승인·입고확인·송금·삭제. "만능 대행"(D11)으로 협력사 몫도 대신 밀고 `byRole='ADMIN'`이 박제된다.
- **협력사** — 회신·발주 확인·EQ 올림·생산·발송·A/S 회신·재고표 업로드. 포털 계정이 없어도 매직링크(RFQ)와 관리자 대행으로 트랙이 끝까지 간다(여정 12호).
- **마스터딜러(MD)** — 위로는 협력사, 아래로는 관리자. 하위 배정·마진·중계 물류·관전/대행(`byRole='MASTER_DEALER'`).
- **고객** — 주문·EQ 고객 확인·진행 조회·A/S 접수. 협력사명·발주가는 끝까지 비노출(공급망 차단, 여정 43호).
- **공급사**(DigiKey·Mouser·UniKeyIC) — 로그인 주체 없는 API 조직. RFQ 행으로 물질화하지 않고 구매 조건 원장에서 파생(D6), 발주는 카트/리스트까지만(D20).

화면·라우트 상세는 [sp-vue-web](sp-vue-web.md)·[sp-node-api](sp-node-api.md), 스키마는 [api-contract](api-contract.md), 하네스는 [testing](testing.md)이 맡고 이 토픽은 **업무 흐름·상태 기계·가드·역할·돈·문서**의 정본 요약만 담는다.

## Architecture [coverage: high — 9 sources]

**조직 모델 — 계정·조직·자동화 3축 분리**(D4·D5):

- `sp_partner`(type `partner|supplier|house`, `capabilities ["bom_rfq","pcb_rfq","part_sale"]`, status `pending|approved|suspended`, `country` ISO2 = 발송 출발국, `defaultCurrency`/`inputCurrency`, 사업자정보 6칸) + `sp_partner_member`(g5 계정 연결 — 가짜 회원 없음, 1계정=1조직 가드) + `sp_partner_relation`(MD↔하위, **링크 결제통화** 박제, 2단 강제·다중 상위 허용).
- 로그인 능력=멤버 존재, API 자동화 능력=`supplierCode` 존재 — 조합으로 일반 협력사/순수 공급사/하이브리드/자사 house가 표현된다.
- 인증은 `requirePartner`([auth.ts](../../samplepcb-web-mono-app/apps/api/src/plugins/auth.ts))가 **매 요청 DB 판정**(JWT에 조직 클레임 없음 — 정지 즉시 403, 토큰 재발급 불필요), capability는 라우트가 다시 확인한다 — [server-single-truth](../concepts/server-single-truth.md).
- 포털 진입은 `GET /api/partner/access`가 `tracks {bom,pcb,parts}`로 파생([partner-access.ts](../../samplepcb-web-mono-app/apps/api/src/routes/partner-access.ts)), PHP 헤더 링크는 [sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php)가 같은 기준(멤버 ∧ approved)으로 직접 SELECT — [admin-vue-consume-php](../concepts/admin-vue-consume-php.md).

**관리자 콘솔** = 모듈 스위처 3모듈(통합 관리 / 스마트 BOM / PCB 협력 — 모듈 간 화면 공유 금지 D9, 컴포넌트 재사용만) × **역할별 워크큐**(견적/주문·결제/발주/[송금]/선적·배송/A·S·클레임) → 단일 **Case 상세** 척추:

- 첫 탭=그 역할의 **대기 큐**, 배지="지금 움직여야 하는 수"+진행 중 내 차례 합산(D12). 이관분 `_legacy`는 대기 큐에서만 제외(재촉 목록 330·195건이 눌러앉던 실측).
- Case 상세는 `?from=quotes|orders|pos|logistics` 로 무관 섹션을 한 줄 접힘 바로(스크롤·강조는 제거).
- 파트너 기준정보는 2026-08-06부터 통합 관리 `/admin/partners`(BOM·PCB·부품 판매가 공유하는 조직 정본).
- 삭제는 2단계 레이어(프리뷰 SHA-256 토큰 → `STALE_PREVIEW`) + `sp_delete_audit` 공용 감사(subjectType) + `audited|reset` 모드. PCB는 관리자 체크 하나로 차단 전면 해제(D14), 고객 경로는 `PARTNER_TRACK_ACTIVE` 불변.

**포털**(`/app/partner`, [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md)):

- 리졸버 `PartnerEntry`(트랙 0 안내 / 1 그 모듈 / 2 `localStorage sp.partnerModule` 기억) → 모듈 홈(오늘 할 일 카드 4장: 회신할 견적·확인할/진행할 발주·📦 보낼 물건·진행 중 발송).
- **R3 사이드바 셸**(관리자 `AdminLayout` 동형, `partner/menu.ts`, 배지는 홈 카드와 같은 쿼리 캐시 `usePartnerWork`, 본문 최대 1440px, `PartnerPageHeader` 통일, 모듈 색 BOM indigo/PCB teal/공통 amber) + 워크큐 목록 4화면(`bom|pcb/rfqs·pos`, `?tab=`).
- **공통 영역**(수금 현황 `tracks.pcb`·보유 부품 `tracks.parts`) — 모듈에 억지 배속하지 않는다.
- 발송은 **[📦 보내기] 두 칸 보드**(좌 선반 ↔ 우 박스, "발송 누르기 전엔 자유", 대표 개념 은닉, 마지막 꺼내기=박스 소멸) — 레거시 3층 선적 그룹 보드 대신 **발송 시점에 묶는다**(§6.10→§6.11). 협력사 관점 상태 번역 `partnerPoDisplayStatus`('마감' 단어 소거).
- i18n은 `PartnerLayout` 범위의 `pt()` 주입(ko/en/zh-Hans, `sp.partner.locale`) — 전역 vue-i18n·메일·매직링크·PHP는 범위 밖.

**BOM 상태 기계** — `quote.status draft→requested→reviewing→answered→closed`는 불변이고 그 아래에 하위 계층이 돈다(D10 상태 계층 분리):

- `BOM_RFQ_STATUS requested→quoted→closed` — diff 발송: 빠진 협력사 중 **미회신만 회수**, quoted 보존(D32-1). 0곳 발송=미회신 전부 회수. 회신 3경로(포털·매직링크·대리)는 `saveRfqReply` 코어 하나.
- PO `issued→confirmed→closed`(D18 — 발주서=Case×협력사 1건 박제 문서, **결제 확인(od isPaid) 후**, VAT 별도, `issued`만 삭제). 공급사 PO는 관리자 [구매 완료 처리]로만 confirmed(D33).
- 선적 `INTL preparing→requested→shipped→arrived→customs→done / DOMESTIC preparing→shipping→delivered` — 모드는 협력사 `country`로 서버가 생성 시 박제(D28). 주체 사전 `BOM_SHIPMENT_ACTORS`: 국제는 협력사가 **선적 요청 한 번**, 이후 선적·도착·통관·완료 전부 관리자; 국내 종점은 관리자 [입고 확인] 전용 API.
- 12단계 **파생** 타임라인(`smartbomStepOf`, 저장 안 함 — [lazy-derived-state](../concepts/lazy-derived-state.md)). 주문·결제 상태는 `ctId→g5_shop_cart→g5_shop_order` 조인 파생이며 g5 미러 컬럼을 두지 않는다.

**PCB 상태 기계** — 앵커는 `it_id`가 아니라 **`sp_order_spec.id`**(specId):

- RFQ `requested|quoted|selected|unselected`(UK `specId+partnerId+parentPartnerId+reorderRound`). 담기지 않은 active 스펙 전체에 시작 가능, 진행 중 주문은 **원가 소싱 모드**(D10). 선정=확정가 등록 **앞단**(담김/주문이면 409 — 레거시 소급 전파 폐기, [snapshot-freeze](../concepts/snapshot-freeze.md)).
- 주문·입금 → PO `issued→eq_requested→eq_done→producing→produced`. `PCB_EQ_FORWARD/REVERT` 사전이 라벨·서버 검증의 단일 정본, EQ 승인은 **관리자만**(D3), 첨부 eq 선택/working 권장(D19)·승인요청 뒤 `EQ_LOCKED`, 반려↔요청취소는 **note 유무**로만 갈리고 판정은 `isPcbEqRejectionEvent` 하나.
- **메탈마스크 트랙**은 status를 포크하지 않고 `resolvePcbPoTrack(category) → 'eq'|'stencil'`로 라벨·게이트만 가른다(좌표파일 필수·문의 선택·확인 뒤 통보 없는 고객 열람).
- 선적은 BOM 코드사전·transport 사전을 **재사용**하되 `receiverKind admin|md`·`destinationCountry`(직송 KR/CN/VN)·**박스 contextKey `받는측:받는조직:직송지:회차`**(같은 컨텍스트 preparing 박스에 합류 — 고객·스펙 축은 없어 다른 고객 물건이 한 상자에 섞이는 것이 정상)·**출고 게이팅**(MD는 하위 입고확인 전 상위 출고 `OUTBOUND_BLOCKED`).
- 입고확인 `receivedAt`이 다음 일을 여는 열쇠(국내는 `RECEIVE_REQUIRED`로 상태까지 함께 닫힘) → 고객 배송 큐(판정=관리자 수신 선적의 입고 신호, 직송은 [직송 완료]). od 상태는 **무접촉**(D6).
- **MD 2단**: RFQ 하위 배정→하위 회신→마진%로 상위 회신가 서버 계산(`mdAmount=하위금액×환율×(1+마진%)`, 최종 1회 HALF_UP, `source_*` 박제) → 발주 건별 `fulfillmentMode self|delegated` 박제(08-18) → 위임이면 하위 발주 후 상위 상태 미러·MD는 RECEIVER fallback.
- **A/S**: 얇은 접수 헤더 `sp_pcb_as_case`(draft→submitted→accepted|rejected→proceeded) + proceed 시 회차 MAX+1 채번·원발주 복사(납기는 비움)로 회차 발주서가 같은 EQ·선적 파이프를 탄다. 회차 하위 발주는 원회차 조건 복사(childRfqId 불요).

**가드 체계(잠김→정리→열림)** — 재작업 검증 1~3단계(08-10)와 여정들이 세운 앱 가드(스키마 무변경). 검사 순서가 곧 명세다(발주 취소는 `NOT_ISSUED`를 `IN_SHIPMENT`보다 먼저 본다):

| 코드 | 잠김 | 정리(출구) |
|---|---|---|
| `PO_ISSUED` | 발주 있으면 선정 해제·사양 수정 불가 | 발주 취소 |
| `RFQ_NOT_SELECTED` | 미선정 회신을 근거로 발주 불가(수동 발주 API는 유지) | 선정 |
| `HAS_REMITTANCE` | 송금 기록 있으면 발주 취소 불가 | 원장 삭제 라우트(leaf-first) |
| `IN_SHIPMENT` | 담긴 발주는 취소·직송지 변경 불가 | 박스에서 detach |
| `DOC_LOCKED` | preparing 아니면 첨부 삭제 불가 | 되돌리기(재진입은 Invoice 재요구) |
| `RECEIVE_REQUIRED` | 국내 delivered는 입고확인으로만 | [입고 확인] |
| `ORDER_CANCELED` | od 취소 **또는 그 줄 `ct_status` 취소류** — EQ 전진·하위 발주·담기·A/S 접수 차단 | revert·detach·발주 취소는 열림 |
| 그 밖 | `EQ_LOCKED`·`RECEIVE_LOCKED`·`NOT_ISSUED`·`HAS_CHILDREN`·`PRICE_LOCKED`·`SELF_FULFILLMENT`·`PARTNER_TRACK_ACTIVE`(고객 영구 삭제)·`PARTNER_SUSPENDED`(매직링크)·`CASE_REF_REQUIRED`·`MISSING_AWB_FILE/MISSING_BL_FILE` | |

BOM 쪽 대응: 주문 `NOT_ANSWERED/NOT_CONFIRMED`, PO `NOT_PAID`, 품목 변경 `expectedQuoteUpdatedAt`+`force`, 회신 `ITEM_OUT_OF_SCOPE`, 묶음 `INVALID_GROUP_PO/NOT_PREPARING`, 공급사 PO `PO_NOT_CONFIRMED`, 완료 문서 `SHIPMENT_DOCUMENTS_LOCKED`, 배송 `BOM_FULFILLMENT_INCOMPLETE`(입고 n/n·미복구 부족분), 회신 게이트 `BOM_ITEM_REVIEW_REQUIRED`(D29 지문 확인 대기열).

**돈**:

- PCB: 한 링크=한 결제통화(관리자↔협력사·MD는 조직 `defaultCurrency`, MD↔하위는 관계 `settlementCurrency`), 각 당사자는 자기 통화만 보고 환율은 **변환점에서만** 박제(선정 시 `krwAmount`, 회신 바디엔 환율 키 자체가 없음, 생략하면 수출입은행 당일 tts, KRW는 null).
- **송금은 상태가 아니라 원장**(`sp_pcb_remittance`, D15): 잔액=발주가−송금 합계, `unpaid|partial|paid|over`, 송금 환율은 발주 환율과 별도라 원장 KRW 실합≠발주 회계=환차, 무상 A/S 회차와 MD 하위 발주는 집계 제외, 결제조건별 예정일 `remittanceDueOn`, 완납 통지는 발주서당 1회 `pcb_remit_settled`.
- **과입금**은 `od_refund_price`에 환불 사실만 기록(코어 미수 산식에 이미 포함되어 적는 순간 0으로 닫힘, 실행은 사람).
- BOM: RFQ **KRW 고정**(D7), 실효 회신수량 `stampOrderQty(replyQty ?? orderQty, moq)` 단일 공식(§6.38), 카트 금액 `round(confirmedTotal×1.1)`, 협력사 PO VAT 별도, 국내 거래문서 공급가/VAT 분리, 부분취소는 영카트 원칙으로 `od_cancel_price`·미수·세액 재계산(D30). 대체 발주 단가 차이는 내부 조달 차이(D31-4 — 결제 후 고객 금액 소급 변경 금지).

**문서**:

- BOM: 고객 견적서(브라우저 인쇄만 D12, `CASE-B-YYMMDD-{id}` 표시 채번, 확정 전 "가안") · 협력사 견적서 `PQT-SPB-{poId}`·거래명세서 `STMT-SPB-{shipmentId}-R{rev}`(국내 전용, 발행 시 `quotationData` 박제 D27) · Commercial Invoice(국제 전용, `invoiceData` 편집본+`fresh` 재조립, PDF 자동 첨부+XLSX 다운로드 D23, 묶음이면 소속 PO 전체) · Packing List+부품 QR(`sp_bom_part_package`, 실물 취급 단위 1개=QR 1개, 최초 발송 전 필수 D24) · 공급사 가져오기 csv.
- PCB: 인보이스 생성기(BOM 컴포넌트 재사용, Case ID 갈래는 **엑셀-온리** 첨부) · 첨부 종류 `invoice/airwaybill/bill_of_lading/test_report/origin_cert`(모르는 종류는 접지 말고 뺀다) · Case QR(선적 박스×PO 1장, token≠권한) · EQ 파일 `eq/working/coord/inquiry`(누적 유지+`isLatest`, inquiry는 전부 최신).
- 공유 컴포넌트 5종(RfqReplyForm·BomEstimateSheet·InvoiceEditorModal·ShipmentPackingModal·TradeDocumentModal)이 관리자/포털/매직링크 3자 공용.

**두 트랙의 공통점과 차이**:

| 축 | 공통 | BOM | PCB |
|---|---|---|---|
| 척추·단위 | `sp_partner` 3축·requirePartner·매직링크(64hex·30일·회전) | `sp_bom_quote` Case, RFQ=문서+행(부분 발송, 행별 회신) | `sp_order_spec`, RFQ=행 1:1 단일가+**납기 필수**, 회차·MD 축 |
| 선정→가격 | 서버 재계산만 신뢰 | `selectedOffer` 박제 → `confirmedTotal` 수동 확정(토글) | 선정+확정가 한 번에(P4.7), 담김/주문 시 409 |
| 통화 | 수출입은행 환율 캐시 공유 | KRW 고정 | KRW/USD/CNY+입력통화+링크 통화, 변환점 박제 |
| 발주 게이트 | od isPaid | 공급사 PO 자동 실행(Mouser 카트·DigiKey 리스트, 실결제는 사람) | EQ/스텐실 5단계, MD 하위 발주, A/S 회차 |
| EQ | — | 없음(품목 확인 대기열 D29) | EQ 고객 확인 별도 축(`sp_pcb_eq_review`) |
| 선적 | 코드사전·transport·Case ID 갈래·박스 두 칸·서버 인가 핑퐁 | 협력사 국가로 모드, Packing List·QR 필수, `sp_bom_shipment` | 받는측 admin/md, 직송지, contextKey 합류, 출고 게이팅, `sp_pcb_shipment` 미러 |
| 입고→고객 | force-status '배송'(코어 알림 미발송) | 입고 n/n 게이트 | `receivedAt` 신호→to_ship, 직송 완료 동선 |
| 돈 | 과입금 환불 기록 공용 | VAT 별도 PO | 송금 원장·잔액·환차·완납 통지 |
| 취소 | 협력 트랙은 od를 게이트하지 않는다 | `io_id=bom-{quoteId}` 안정 키, 취소행 PO 차단 | `ct_status` 줄 축 `ORDER_CANCELED` |
| 클레임 | 마이페이지 `/shop/as` 탭, `resolved` 어휘 트랙별 | `sp_bom_claim`(품목 테이블, D37) | `sp_pcb_claim`(귀책 판정→A/S 케이스 핸드오프) |
| 고객 진행 | `/api/order-progress` 공용 스텝퍼 | 7칸(부품 조달·발송·운송·입고) | 8칸(제조 확인·생산·생산완료·입고) |

## Talks To [coverage: high — 8 sources]

| 상대 | 방향/방식 |
|---|---|
| sp-node lib·routes | 판정·저장 전부 서버(`lib/bom-rfq·bom-po·bom-invoice·bom-packing·bom-trade-documents·pcb-rfq·pcb-po·pcb-shipment·pcb-remittance·pcb-as-case·pcb-eq-review·mail-log`). PCB 선적은 BOM 계약 사전을 공유하는 **미러 lib**(bom-po.ts 무접촉) — [sp-node-api](sp-node-api.md) |
| sp-vue `/app/admin`·`/app/partner`·공개 `/app/rfq-reply`·`/app/pcb-rfq-reply` | 관리자 3모듈·포털 모듈 셸·매직링크 페이지 — [sp-vue-web](sp-vue-web.md) |
| sp-php 브리지 (extend + spcb/api) | [sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php)(세션→2분 JWT→`SPCB_NODE_BASE 127.0.0.1:3333`, PHP는 sp_ 테이블에 **쓰지 않는다**, `eq-decide` POST+CSRF, `eq-file`·`coord-file` 다운로드 브리지) · [sp_pcb_claim.extend.php](../../samplepcb-web/extend/sp_pcb_claim.extend.php)(`claim-create` multipart 중계) · [sp_bom_claim.extend.php](../../samplepcb-web/extend/sp_bom_claim.extend.php)(부품 탭 목록만, 함수 분리=어휘 격리) · [sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php)(GNB 포털 링크). 사이드바 배지만 DB 직접 count. 페이지 `/shop/eq`(확인 요청>제조 확인)·`/shop/as`(문의>A/S 접수)·`/shop/quotes`(D17 통합 목록)·주문내역 상세(진행 카드·EQ·A/S 섹션) — [spcb-bridge](spcb-bridge.md)·[theme-sp-lite](theme-sp-lite.md) |
| 영카트(g5) | `g5-db.ts` 카탈로그로만: isPaid·주문 헤더·카트 링크·force-status(재고 앵커)·`purgeOrderRows`·`updateOrderedCartOption`(W6 — ct_option만, io_id/ct_price 불변)·`od_delivery_method`·`od_refund_price`·PCB 큐 SQL 조인 페이지네이션(한정 예외 ⑳) — [gnuboard-integration](gnuboard-integration.md) |
| sp-engine | BOM 후보·`admin_rfq_compare` 강제 라이브 3사 재조회(`force_live`)·협력사 재고 `inventory` 프로필·`local_products` 주입(가격 없음, 소스 순위 뒤) — 판단은 엔진, 표시·정책은 sp-node([judgment-single-owner](../concepts/judgment-single-owner.md)) — [parts-engine](parts-engine.md) |
| Mouser / DigiKey | Mouser Cart API(발주서당 CartKey 고정·전체 교체·live 대조, 주문 키는 검색 키와 별개 `MOUSER_ORDER_API_KEY`) · DigiKey third-party 리스트(무인증 single-use URL) · DigiKey Barcoding v3(**3-legged 전용**, `sp_config digikey_oauth` refresh 90일) · 봉투 ECIA 2D 라벨은 로컬 파싱 |
| 한국수출입은행 | USD tts 캐시 + CNH 교차(`pcb_exchange_rate_cnh`), 매일 12:10 KST, `GET /admin/pcb-exchange-rate` prefill |
| SMTP(Mailpit 로컬)·알림톡 | 래퍼 3종(`sendBomRfqMail`·`sendPcbMail`·`sendMarketMail`)이 `sp_mail_log` 자동 기록, 실패 비차단, 무계정/정지 조직엔 포털 CTA 대신 대행 안내(`resolvePcbPortalCta`) |
| 파일서버 | `sp_file` 폴리모픽(refType `sp_bom_shipment`·`sp_pcb_po_eq`·`sp_pcb_shipment`·`sp_pcb_remittance`·`sp_pcb_as_case`·`sp_partner_part_upload`…), serviceType `bom_shipment`, 다운로드는 권한 프록시 스트림(pathToken 비노출), `uploadedBy ADMIN/PARTNER/MASTER_DEALER/CUSTOMER` |
| nginx | `/api/svc/`는 코드가 아니라 **nginx allow/deny**가 접근 통제(2026-08-27 미설정) — [infrastructure](infrastructure.md) |
| e2e 하네스 | `samplepcb-web-mono-app/e2e/` — `/spcb/api/me` 스텁 로그인, 여정 1~44호·BOM 1~21호·MD 5편, 상설 픽스처 — [testing](testing.md) |

## API Surface [coverage: high — 6 sources]

`apiRoutes` 키 기준([api-contract](api-contract.md) `routes.ts`) — 상세 바디는 [sp-node-api](sp-node-api.md).

| 주체 | 경로 | 역할 |
|---|---|---|
| 협력사(requirePartner) | `/api/partner/access` · `/rfqs`·`/pos`·`/shipments`(BOM: 회신·발주 확인·부족 신고·담기 attach/detach·advance/revert·files·invoice·packing-list·quotation/statement·done 아카이브) · `/pcb-rfqs`(회신·거버 프록시·MD 하위 배정/선정) · `/pcb-pos`(전이 4종·EQ 파일·MD 하위 발주·수취 전이·receive) · `/pcb-shipments`(보드·`box` 담기·done) · `/pcb-remittances`(수금 현황 — 수주 발주만) · `/pcb-as-cases`(회신·첨부·claim-files) · `/parts`(재고표 업로드·remap·commit·행 수정) | 소유 조직 데이터만(타 조직 404), capability는 라우트 재확인 |
| 무인증 매직링크 | `GET/PUT /api/rfq-reply/:token` · `/api/pcb-rfq-reply/:token` | 메일함 소유=신원, 스코프=그 RFQ 1건. GET은 마감돼도 열람, PUT만 `RFQ_CLOSED`; 정지 조직은 GET·PUT 모두 409 `PARTNER_SUSPENDED`, 30일 만료는 404 |
| 고객(authenticate) | `POST /api/bom/quotes/:id/order`·`/order`(배치) · `/api/bom/quotes/:id/claims`·`/api/bom/claims/mine` · `/api/pcb-eq-reviews?odId`·`/mine`·decide · `/api/pcb-claims`·`/mine` · `/api/pcb-progress`·**`/api/order-progress[/batch]`**(트랙 공용) · `coord-files/:fileId` | 소유권 `mbId`·`spec.mbId`, 타인·미존재 동일 404 |
| 사내 서비스 | `/api/svc/bom/*` = `bomRoutes`·`bomQuoteRoutes` 재등록(`serviceActorHook`, 고정 mbId `SVC_BOM_MB_ID`) | 무인증인데 고객 견적은 여전히 404, 일일 한도 상한만 해제 |
| 관리자(requireAdmin) — 조직·BOM | `/api/admin/partners`(+`/:id/relations`) · `/admin/partner-parts` · `bom-quotes/:id/{rfqs,rfq-selection,supplier-offer-refresh,items,item-reviews,pos,shortages,answer-email,complete,quick-mail,print,partner-stock,force-delete[-preview]}` · `bom-pos`(횡단, external check/import-file/confirm) · `bom-shipments`(횡단) · `bom-orders`(파생 워크큐, cancel) · `bom-claims` · `bom-receiving`(scan·complete) · `digikey` OAuth · `mail-logs`(+resend) | 대행 라우트는 관리자 경로에만(포털 경로에서 관리자는 403) |
| 관리자(requireAdmin) — PCB | `pcb-cases`(12단계 조감) · `pcb-rfqs` · `pcb-projects/:id/{rfqs,pos,spec,price}` + `pos/:poId/{eq-approve,eq-reject,eq-revert,shipment,shipment/box,shipment/advance,remittances,eq-reviews}` · `pcb-pos`·`pcb-orders`(SQL 페이지네이션)·`pcb-shipments`(`mdLegs=show|hide`)·`pcb-remittances`(협력사별)·`pcb-as-cases`·`pcb-claims`·`pcb-packages/:token` · `orders/:odId/refund` | 대기 큐 탭은 별도 데이터 소스(검색 미지원) |

역할 경계 실측(여정 25호): 무인증 401 · 일반 회원 403 · 협력사는 포털 200/관리자 403 · 관리자는 관리자 200/포털 403. counts 키 규약이 큐마다 다르다(PO snake_case `eq_pending`, Case camelCase `todoRfq`, Order `toShip`).

## Data [coverage: high — 7 sources]

Prisma `sp_*`(그누보드 DB 동거, **`migrate deploy`만**, String status+계약 리터럴 유니온, mbId FK 금지):

- **조직** `sp_partner`(위 참조 + `statusReason/decidedBy/decidedAt`) · `sp_partner_member`(UK partnerId+mbId, role owner|staff) · `sp_partner_relation`(UK parent+child, `settlementCurrency`).
- **BOM RFQ·선정** `sp_bom_rfq`(UK quoteId+partnerId+parentPartnerId, `requestedItemIds` null=전체, `magicToken/At`, totalAmount·deliveryDate) · `sp_bom_rfq_item`(UK rfqId+quoteItemId, source manual|api, unitPrice·replyQty·moq·stock·dateCode·leadTime) · `sp_bom_quote_item.selectedRfqItemId`+`selectionSource='partner'`(박제 `selectedOffer.offerKey='rfq:{id}'`, `pinned`) · `sp_bom_quote_item_review`(D29 지문).
- **BOM 발주·선적** `sp_bom_po`(UK quoteId+partnerId, `externalRef` Json=공급사 실행·live 대조 박제, `quotationData`) · `sp_bom_po_item`(supplierSku) · `sp_bom_po_shortage`(D31, 대체 PO FK SetNull) · `sp_bom_shipment`(mode/status/transport air|sea/carrier/tracking/`shipDate` UTC 자정/shippedAt/receivedAt/completedAt/`invoiceData`/packing revision/`caseRef*` D40) · `sp_bom_shipment_po`(poId UK — 발주서는 최대 1선적, 소속의 진실) · `sp_bom_shipment_item`→`sp_bom_part_package`(token·`PKG-` labelCode·`prepared→received→inspected→stored→issued|voided`)→`sp_bom_part_event` · `sp_bom_receiving_scan`(D42 봉투 스캔 원장, `voidedAt`) · `sp_bom_claim/_item/_event`(`activeKey` unique).
- **PCB** `sp_pcb_rfq`(UK specId+partnerId+parentPartnerId+reorderRound, 결제통화 3종+입력통화 `sub_*` 3종+MD `source_*`·`marginRate`·`selectedChildRfqId`, `suggested/quotedDeliveryDate`, 매직링크) · `sp_pcb_po`(같은 UK, status 5종, `fulfillmentMode self|delegated`, 통화 7컬럼+`krwAmount`(MD 하위는 null), `destinationCountry`, `paymentTerms`·`remittanceDueOn`·`remittedAt`(원장 파생 캐시)·`deliveryDate`, **`eqHistory` Json `[{at,byRole,fromStatus,toStatus,note}]`**) · `sp_pcb_eq_review`(1:N, `sharedFileIds`, requested|approved|rejected|canceled, `dueOn`) · `sp_pcb_remittance`(remittedOn·amount·exchangeRate·krwAmount·증빙) · `sp_pcb_as_case`(UK specId+reorderRound, round는 proceed 시 부여) · `sp_pcb_claim/_event`(`activeKey 'pcb:{specId}'`, faultType·resolutionKind·chargeAmount/refundAmount) · `sp_pcb_shipment`(대표 poId+specId FK cascade, `receiverKind`, `destinationCountry`, `transport` **default 없음**, `caseRef*`) · `sp_pcb_shipment_po`(poId UK) · `sp_pcb_package/_event`(박스×PO QR).
- **보유 부품** `sp_partner_part_upload`(parsing→preview→applied|failed|superseded, `previewJson` **표본 200행만**) · `sp_partner_part`(`mpnRaw` 원문 불변, `isActive`, `editedAt/By`) · `sp_partner_part_key`(canonical|alternative, FK 없음) + 카탈로그 파생 투영 `sp_part_offer(supplier='partner', sku='{partnerId}:{rowId}', priceBreak 없음)`·ES `partnerOnly/hasPartnerStock`.
- **횡단** `sp_mail_log`(kind·refType/refId FK 없음·channel·status sent|failed|skipped·reason·recipient·body는 quick_mail만·params·sentBy null=시스템, retention `mail_log_retention_days` 기본 180) · `sp_mail_template` · `sp_delete_audit`(subjectType pcb_case|bom_case, `overriddenBlockers`) · `sp_config` 키 `partner_parts`(낡음 기준일)·`pcb_exchange_rate_cnh`·`bom_estimate_contact`·`digikey_oauth`.
- **g5 접점**(코어 무수정 — [core-nonmodification](../concepts/core-nonmodification.md)) `g5_shop_order.od_delivery_method`(신설 varchar, `''=택배`, 비택배는 `od_delivery_company` 한글 라벨 병용+`od_invoice=''` — **운영 DDL 수동**) · `od_refund_price`(과입금 환불 누계) · `od_mod_history` append · `g5_shop_cart.ct_status/io_id/ct_option`. 이관 `specJson._legacy`는 PII라 spec 응답에서 strip 필수.

## Key Decisions [coverage: high — 10 sources]

- **2026-09-16 — 관리자 BOM 메뉴 통합**: 고객 견적요청 검토는 `/admin/smartbom/quotes`+Case 상세로 단일화, 중복 `/admin/bom-quotes` 메뉴·라우트 제거(리다이렉트 없음), BOM 업로드는 메뉴 하단.
- **2026-09-06 — 포털 i18n(ko/en/zh-Hans)은 화면 문구만**: `PartnerLayout` 범위 주입, 사용자 입력·메일·매직링크·PHP 밖. `Stock` 명시 납기만 재고 보유로 표시.
- **2026-08-27 — 사내 BOM API `/api/svc`**: 라우트 복제 0(재등록+서비스 액터), 소유 격리 유지, 접근 통제는 nginx.
- **2026-08-27 — 협력사 회신 실효 수량 단일 공식**(MOQ→회신수량 한 방향 파생, `replyQty<moq` 거부) · **P5 정책 변경: 단일검색 Distributor에 협력사명 노출**(08-23 비노출 → 08-27 노출; 연락처·조직 ID·협력사별 재고는 계속 비노출).
- **2026-08-25 — 고객 진행 표시는 od 무접촉 파생**: 트랙 공용 `/api/order-progress`, 스텝퍼 PCB 8칸/BOM 7칸, 라벨 사전 단일화; 마이페이지 "확인 요청>제조 확인"(EQ를 화면에 쓰지 않는다)·"문의>A/S 접수"(PCB/부품 탭, 접수 폼은 복제하지 않음).
- **2026-08-23 — 협력사 보유 부품**: 별도 원장이 정본이되 **카탈로그 파생 투영 하이브리드**(같은 날 저장 분리 → 투영; 색인 제외 → 색인하되 판단 자리에서만 제외로 재결정), RFQ 제한 없음(D32와 충돌·인센티브 왜곡), 만료 없음(대신 나이 상시 표시+관리자 뒤처리), **가격 금지**(값의 정본은 RFQ 회신), 브랜드 없는 행 자동 선정 금지, `part_sale` 재사용, 회신 프리필은 단가 제외.
- **2026-08-22 — 포털 R3 하이브리드 셸**(허브-앤-스포크 → 관리자 미러 사이드바+홈 유지) · **Mouser 인계 4갈래**(API 카트≠웹 장바구니라 CartKey 고정·live 대조·csv 우회) · **입고 스캔은 ECIA 로컬 파싱+별도 원장**(DigiKey Barcoding은 3-legged, Mouser는 API 없음; 패킹리스트는 전량 조건이라 부분 입고를 못 담는다).
- **2026-08-18 — MD 건별 `fulfillmentMode`**: 관계 보유만으로 전건 위임 → 발주 건별 self|delegated 박제, 뒤늦은 하위 발주는 `SELF_FULFILLMENT`.
- **2026-08-16~17 — 운송수단 air|sea 공용 사전**(default 없음, 국제 전용, 전환 시 carrier·tracking 소거) · **메탈마스크 = status 포크 없이 category 파생 트랙**(좌표파일 필수·문의 선택·문의 사진 누적·확인 뒤 통보 없는 열람) · **반려 판정 단일화**(다섯 곳 복제 → `isPcbEqRejectionEvent`, 되돌리기는 note 안 남김, `RESERVED_REASON`).
- **2026-08-13~15 — Case ID 갈래**(운송 계약 주체: 협력사 직접 vs 샘플피씨비 운송, 상태 사전 불변·문서 레벨 분기, 인보이스 엑셀-온리) · **PCB Case QR**(박스×PO 1장) · **고객 클레임 P5**(귀책 판정→A/S 케이스 핸드오프, 금액은 기록만) · **MD 관전·대행 교정**(blocked=내 차례, 진행 중 발주 섹션, `counterpartyName`, meRole MASTER_DEALER).
- **2026-08-11 — 권한·판정 축 교정(여정 13~16호)**: 포털 가능 판정 '멤버 존재' → **'멤버 ∧ 조직 approved'**(정지 조직 매직링크 `PARTNER_SUSPENDED`), 부분 취소 `isPcbOrderCanceled` → **`isPcbOrderLineCanceled`**(ct_status 줄 축), 전진 force-status는 취소류 제외(`NO_ACTIVE_LINES`), 유니크 위반 500 → 담기 200 합류/발행 409, 납기 경과 `isPcbDeliveryOverdue`(produced부터는 지연 아님).
- **2026-08-11 — 미결 판단 3건 종결(여정 33호)**: **EQ 첨부 누적+`isLatest`**(교체안 기각)+반려 뒤 보완 표시, **과입금 환불 = `od_refund_price` 기록 창구**, **완납 통지 발주서당 1회**. 같은 날 직송 종결 판정=입고된 발주, LIKE escape, 관리자 대행 발송 시작점(`shipment/box`)·`partnerHasPortal` 배지(발주 이후 한정 — RFQ는 매직링크라 예외).
- **2026-08-11 — BOM D32~D38**: 미응답 RFQ 회수·재배정(구 토큰 즉시 무효), 공급사 PO 수동 구매 확인(`PO_NOT_CONFIRMED`), 국내 묶음 거래문서 불변, Case 삭제·일괄 삭제 안전 경계, 배송 후 클레임 원장(D37), 고객 소유권·직접 URL 은닉(D38).
- **2026-08-10 — 가드 체계 신설**(W2~W9 프로브를 409 회귀로 승격) · **W6 주문 후 사양 수정 허용**(차단 → 허용+`ct_option`만 동기) · **D19 EQ 파일 선택**(필수 → 선택, Working 권장).
- **2026-08-10 — A/S 회차 모델**(초안은 회차 미점유, 납기 비움) · **박스 모델의 PCB 일반화**(전이 순간 일회성 묶기 폐기 → contextKey preparing 박스 합류) · **포털 BOM/PCB 모듈 분리 R1/R2** · 선정+확정가 한 번에·환율 자동(P4.7) · BOM D30 부분취소·재주문, D31 잔량 대체발주.
- **2026-08-07 — EQ 고객 확인은 별도 축**(고객 승인이 발주 상태를 바꾸지 않음, **메일에 승인 버튼 금지**—스캐너 GET 프리페치, 공개 파일은 관리자가 고른 것만, 회원 주문만, sp-php 첫 쓰기 경로=POST+CSRF) · **견적 계산은 라이브 가격표**(D18) · **`sp_mail_log` 전 채널 공용화**(실패·스킵도 기록, 재발송은 quick_mail만, retention).
- **2026-08-06 — 송금은 상태가 아니라 원장**(D15, PCB 전용 FK) · **관리자 재량 삭제 D14**(D13 '우회는 결제만' → 체크 하나로 전면 해제+무기록 reset, 코어 삭제 SQL `purgeOrderRows` 수술) · `sp_delete_audit` 공용화 · 파트너 관리 → 통합 관리 이동 · BOM 고객 회신 확정을 `complete` 명령으로 분리.
- **2026-08-04 — PCB 이식 결정 D1~D8**: MD 1차 포함, KRW+USD+CNY 전부, EQ 승인 관리자만, 영문 코드+라벨 사전, 직송 포함, od 자동 동기는 1차 수동, 레거시 데이터 미이관, 회수 자료 커밋. 문법 전환 3: it_id → specId 앵커, 소급 전파 → 확정가 앞단 선확정, 프론트 신뢰 → 서버 인가. 이어 D9 모듈 분리, D10 원가 소싱 모드, D11 관리자 만능 대행, D12 대기 큐+이관분 제외(08-05).
- **2026-08-02 — 관리자 메뉴 역할별 워크큐**(§6.12, 발주를 주문·결제에서 분리, `?from=` 접힘) · **국내·국외 발송 분리 D28**(협력사 `country`=출발국, 모드 서버 결정, 국내 최종은 입고확인 API만) · D22-1 정정(국제 국내도착 주체 협력사 → **관리자**).
- **2026-08-02 — RFQ 부분 행 발송**(0곳 발송=미회신 회수) · Case 영구 삭제 2단계 · D24 QR 선적 리스트 · D25/D26 품목 교체·추가(강제 변경은 회신 무효화) · D27 협력사 견적서·거래명세서 · 빠른 메일.
- **2026-08-01 — 선적 그룹 보드 대신 발송 시점 묶기 → 포털 재구성**: 발주서 상세는 열람 전용, [📦 보내기] 두 칸(선반↔박스), 대표 개념 은닉, 협력사 관점 상태 번역, 완료 발송 분리.
- **2026-07-31 — D22 핑퐁 서버 인가 신설**(레거시 프론트 검증 교정)+양방향 메일 · D23 상업송장 PDF+XLSX · 고객 회신 메일 · 견적서 인쇄 · **D11 후속 매직링크**(저장형 토큰=회수 가능).
- **2026-07-30 — D18 PO=박제 문서+paid 게이트**(타임라인 ⑦결제→⑧발주) · D19 주문 축 워크큐(입금확인은 기존 전이 API 재사용) · D20 외부공급사는 카트/리스트까지(sp-node 직접) · D21 경량 선적+영카트 재사용(**일괄 전이 → force-status**로 정정).
- **2026-07-29 — BOM 트랙 결정 D1~D17**: `sp_bom_quote` 단일 척추(견적서 엔티티 복제 없음), 수량은 `orderQty` 정본, `sp_partner` 조직 단일 테이블+capabilities, 공급사는 RFQ 행으로 물질화하지 않음(라이브 재조회로 파생), 1차 KRW 단일, 협력사에 목표단가 미노출, 확정가 수동, 코드 사전(한글 리터럴·g5 미러 금지), 브라우저 인쇄만, 견적 통째 1카트행 ×1.1·같은 트랙끼리 배치. **§5.1 정정**: Case 상세는 `AdminBomQuote` 재사용 → 신규 `AdminSmartbomCase`, diff 삭제는 미회신만, 확정가 토글식+게이트 인지 장치.

## Gotchas [coverage: high — 11 sources]

- ⚠ **날짜 전용 필드는 KST 자정 앵커** — `iso.slice(0,10)` 은 하루 앞당긴다(납기가 저장마다 하루씩 밀린 실사고). `fmtKstDate/kstDateInput/kstToday/kstDateStr` 만. 단 `shipDate`처럼 UTC 자정에 앵커한 값은 손대지 않는다.
- ⚠ **`z.coerce.boolean`은 `'false'`도 truthy**(invoice `fresh` 저장본이 늘 덮이던 결함) — 쿼리 불리언은 `z.enum`.
- ⚠ **워크큐 기본 탭 함정**: `/admin/pcb/pos` 기본 탭은 '발주 대기'(발주서 없는 건), `/pcb/orders`는 '입금 대기' — 진행 중 건을 찾으려면 탭 이동+검색. RFQ·발주 큐의 기본 대기 탭엔 검색창이 없다. 없는 포털 URL은 흰 화면(404가 결함처럼 보인다).
- ⚠ **협력 트랙은 od를 게이트하지 않는다** — 취소 판정은 헤더+**줄 `ct_status`** 둘 다, 부분 취소는 od가 '입금'인 채로 줄만 취소된다. 주문 취소의 정식 경로는 `PATCH /orders/:odId/items/status`(force-status enum에 '취소' 없음). 되돌리기 `'주문'`만 취소류 포함(un-cancel+재고 복원 — 모든 e2e 정리가 기대는 근거, 여정 26호).
- ⚠ **반려 vs 요청취소는 같은 전이** `eq_requested→issued` — note 유무로만 갈린다. 되돌리기에 note를 넣으면 넷이 동시에 거짓말한다. 사유가 예약어 '되돌리기'면 409.
- ⚠ **계약 키 오독 3종**: 회신 기한은 `dueOn`(`dueDate` 아님 — 전 여정이 기한을 저장하지 못했던 오타), 고객 EQ 결정 enum은 `approve|reject`, 반려 사유는 `note`. `PATCH …/spec`은 **전체 교체**(부분 병합 아님).
- ⚠ **매직링크**: 저장형 토큰이라 재발급이 곧 회수 — 재배정 후 옛 메일 링크는 무효이니 [링크 복사]로 새 링크를 전달해야 한다. 만료 404·정지 409로 응답이 갈리는 것이 의도. 같은 견적·같은 협력사에 RFQ 재발송은 중복이라 시도조차 없다(발송 경로를 여러 번 태우려면 견적을 나눠라).
- ⚠ **환율은 회신이 아니라 선정에서 굳는다**; 발주 뒤에는 조직 통화를 바꿔도 박제 불변. 외화 송금은 오늘 날짜만 자동 환율, 과거·미래일은 명시 필수(`EXCHANGE_RATE_REQUIRED`). 송금 바디는 `remittedOn`이고 `currency`를 받지 않는다(발주 통화 강제). `krwPoAmount ≠ krwPaidAmount + krwBalance`가 **정상**(환차).
- ⚠ **BOM RFQ 통화는 KRW 고정** — 해외 협력사도 KRW로 회신한다(BOM 여정 2호가 제약을 박제). 협력사 후보(보유 부품)는 가격이 없어 담긴 행은 `lineTotalKrw=null`이며 주문 게이트는 라인이 아니라 관리자 확정가다. 금액은 `ct_price`가 아니라 `io_price`, 템플릿 상품 `sp-bom-parts`, 정리는 `io_id='bom-{quoteId}'`로.
- ⚠ **Mouser API 카트≠웹 현재 장바구니**('저장한 장바구니'), 하루쯤 뒤 비어 있었고 `GET /cart`는 없는 키에도 200+빈 카트 — "빈 카트"는 존재 증명이 아니다. DigiKey Barcoding은 2-legged 401, 앱 Redirect URI는 하나(로컬/운영 환경별 연결). `SubmitOrder` 실주문은 사용자 결정 없이 켜지 않는다.
- ⚠ **대용량 JSON·트랜잭션**: `previewJson`에 엔진 결과 원문(12,175행=6.36MB)을 넣으면 MySQL 패킷 한도에서 연결이 끊긴다(표본 200행만, 커밋은 보관 원본 재실행). 후보 대량 저장은 20건 배치, 대량 삭제는 무tx 청크. 카탈로그 투영 동시 반영은 갭 락 교착 → `withWriteRetry`. 협력사 offer는 원장 FK가 없어 조직 삭제 시 `purgeOrphanPartnerOffers` 필요.
- ⚠ **Fastify 훅을 동기 `void`로 두면 요청이 영구 hang**(tsc·eslint 통과) — `Promise<void>`. `/api/svc` nginx allow는 2026-08-27 기준 미설정. `SVC_BOM_MB_ID` 회원은 ID 선점용으로 만들 것.
- ⚠ **완납 통지 레이스는 프로세스 내 직렬화뿐**(다중 인스턴스는 열림 — 원자 claim 컬럼은 이월). MD 경유 EQ 결정 메일의 MD 사본 여부는 정책 대기. `loadAdminPcbPoWorkItems`는 전건 로드+N+1(PO가 쌓이면 SQL 페이지네이션으로).
- ⚠ **sp-php 쓰기 브리지 함정**: `get_token()`은 문자열만 반환(hidden input으로 감싸야 제출이 된다), `check_token()`은 실패 시 자체 alert라 `sp_pcb_check_token()` 복제본 사용(코어 변경 시 동기), CSS 고치면 `G5_CSS_VER` 올릴 것, 주문 상세 카드 우측 열에 문장을 넣을 땐 폭을 묶어라(사양 열 0px 붕괴 2회). 배송 처리 모달의 방법 셀렉트로 force-status 우회는 끝났지만 코어 관례상 이 경로는 고객 알림 미발송.
- ⚠ **e2e 픽스처 규율**([e2e/README](../../samplepcb-web-mono-app/e2e/README.md)·[fixtures/README](../../samplepcb-web-mono-app/e2e/fixtures/README.md)): 협력1은 진행 중 **실데이터**(읽기만)·협력2(CN·USD)가 쓰기 무대; 상설 조직 #7 `마스터딜러상사`(KR/KRW, 관계 협력1 KRW·협력2 USD)·#8 `mdtester2상사`(CN/USD, 다중 상위)·#9 `e2e한국협력`(KR, **계정 0**=대행 전용)·`e2e정지협력`(정지 전용)·고객 `e2e-customer/-customer2`; `cleanup-md.mts`는 관계를 해제하므로 상설 편에 금지; 무대는 `ensureStagePartner`(e2e-* 계정만, 실계정 직삽입 금지).
- ⚠ **e2e 주행 함정**: `pickFreeSpecs`는 PO 유무만 봐서 `ctId null`·`active` 필터 필요; `capabilities`에 `bom_rfq`가 빠져 있으면 BOM 여정이 죽는다; `NODE_OPTIONS=--use-system-ca` 없으면 mkcert 거부; 연속 주행 502는 앱이 아니라 nginx 임시 포트 고갈(`upstream keepalive`); Mailpit은 기준선 ID 뒤 신착만; 픽스처 이름·메모에 검사 키워드 금지(자기가 심은 글자를 자기가 찾는다); 없는 필드를 읽으면 기본값이 조용히 어서션을 통과한다; raw SQL 컬럼명 추측 금지(Prisma 필드로); 검색창 placeholder는 화면별 실제 문구.
- ⚠ **화면 폭**: grid item `min-width:auto` 라 긴 파일명(295자)이 협력사 보드를 가로로 터뜨린다 — 카드에 `min-w-0`. 191자 초과 프로젝트명은 non-strict MySQL이 조용히 자르고 strict는 500 → `clampPcbProjectName` 저장 전 절단.
- **레거시 자료는 코드·DDL만 신뢰** — 위키는 "USD 단일 정본" 같은 정반대 서술이 남아 있고, `sp_pcb_partner_order` CREATE DDL은 [legacy-smartbom](../../docs/legacy-smartbom/README.md)의 실 DB 덤프가 유일 명세다. 레거시 워크플로 데이터는 미이관(D7).

## Sources [coverage: high — 52 files]

- [SMARTBOM_PARTNER_RFQ](../../docs/SMARTBOM_PARTNER_RFQ.md) — BOM 트랙 정본(D1~D42, §6.1~6.38, §5.1 정정 우선, 2026-07-29~09-16)
- [PCB_PARTNER_TRACK](../../docs/PCB_PARTNER_TRACK.md) — PCB 트랙 정본(§0~§8 조사·결정 D1~D19, §9 P1~P5·여정 1~44호·MD 연작·스텐실·Case ID·운송수단, 2026-08-04~08-26)
- [PARTNER_PORTAL](../../docs/PARTNER_PORTAL.md) — 포털 IA·진입 규칙·R3 셸(2026-08-10~08-23)
- [PARTNER_PARTS](../../docs/PARTNER_PARTS.md) — 협력사 보유 부품 원장·inventory 프로필·카탈로그 투영·색인 정책(2026-08-23~08-27)
- [partner-i18n](../../docs/partner-i18n.md) — 포털 3개국어 범위·구현 경계(2026-09-06)
- [MAIL_LOG](../../docs/MAIL_LOG.md) — `sp_mail_log` 전 채널 원장·kind 코드표·재발송·retention(2026-08-07)
- [DELIVERY_METHOD](../../docs/DELIVERY_METHOD.md) — `od_delivery_method`+한글 라벨 병용, 운영 DDL 수동, P2/P3 로드맵(2026-08-17)
- [BOM_SERVICE_API](../../docs/BOM_SERVICE_API.md) — `/api/svc` 호출측 문서(2026-08-27)
- [legacy-smartbom/README](../../docs/legacy-smartbom/README.md) — 회수 자료 3종(통화 설계서·UML Atlas·DDL 덤프)
- [AGENTS.md](../../AGENTS.md) — 호칭·BOM 역할 경계·인증 브리지·nginx 라우팅
- [e2e/README](../../samplepcb-web-mono-app/e2e/README.md) — 하네스 구조·여정 시나리오 절·함정
- [e2e/fixtures/README](../../samplepcb-web-mono-app/e2e/fixtures/README.md) — BOM 픽스처 짝·거버 zip
- 협력사 라우트(헤더 스캔): [partner-access](../../samplepcb-web-mono-app/apps/api/src/routes/partner-access.ts) · [partner-rfqs](../../samplepcb-web-mono-app/apps/api/src/routes/partner-rfqs.ts) · [partner-pos](../../samplepcb-web-mono-app/apps/api/src/routes/partner-pos.ts) · [partner-parts](../../samplepcb-web-mono-app/apps/api/src/routes/partner-parts.ts) · [partner-pcb-rfqs](../../samplepcb-web-mono-app/apps/api/src/routes/partner-pcb-rfqs.ts) · [partner-pcb-pos](../../samplepcb-web-mono-app/apps/api/src/routes/partner-pcb-pos.ts) · [partner-pcb-shipments](../../samplepcb-web-mono-app/apps/api/src/routes/partner-pcb-shipments.ts) · [partner-pcb-as-cases](../../samplepcb-web-mono-app/apps/api/src/routes/partner-pcb-as-cases.ts)
- 공개·고객 라우트: [rfq-reply](../../samplepcb-web-mono-app/apps/api/src/routes/rfq-reply.ts) · [pcb-rfq-reply](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-rfq-reply.ts) · [bom-claims](../../samplepcb-web-mono-app/apps/api/src/routes/bom-claims.ts) · [pcb-claims](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-claims.ts) · [pcb-eq-reviews](../../samplepcb-web-mono-app/apps/api/src/routes/pcb-eq-reviews.ts)
- 관리자 BOM 라우트: [admin-partners](../../samplepcb-web-mono-app/apps/api/src/routes/admin-partners.ts) · [admin-partner-parts](../../samplepcb-web-mono-app/apps/api/src/routes/admin-partner-parts.ts) · [admin-bom-rfqs](../../samplepcb-web-mono-app/apps/api/src/routes/admin-bom-rfqs.ts) · [admin-bom-pos](../../samplepcb-web-mono-app/apps/api/src/routes/admin-bom-pos.ts) · [admin-bom-orders](../../samplepcb-web-mono-app/apps/api/src/routes/admin-bom-orders.ts) · [admin-bom-claims](../../samplepcb-web-mono-app/apps/api/src/routes/admin-bom-claims.ts) · [admin-bom-receiving](../../samplepcb-web-mono-app/apps/api/src/routes/admin-bom-receiving.ts) · [admin-mail](../../samplepcb-web-mono-app/apps/api/src/routes/admin-mail.ts)
- 관리자 PCB 라우트: [admin-pcb-rfqs](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-rfqs.ts) · [admin-pcb-pos](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-pos.ts) · [admin-pcb-cases](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-cases.ts) · [admin-pcb-orders](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-orders.ts) · [admin-pcb-packages](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-packages.ts) · [admin-pcb-remittances](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-remittances.ts) · [admin-pcb-as-cases](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-as-cases.ts) · [admin-pcb-claims](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-claims.ts) · [admin-pcb-eq-reviews](../../samplepcb-web-mono-app/apps/api/src/routes/admin-pcb-eq-reviews.ts)
- [auth.ts](../../samplepcb-web-mono-app/apps/api/src/plugins/auth.ts) — `requirePartner` 매 요청 판정
- [schema.prisma](../../samplepcb-web-mono-app/apps/api/prisma/schema.prisma) — `sp_partner*`·`sp_bom_*`·`sp_pcb_*`·`sp_mail_log` 모델
- [api-contract routes.ts](../../samplepcb-web-mono-app/packages/api-contract/src/routes.ts) — `apiRoutes` 키
- PHP 브리지: [sp_partner.extend.php](../../samplepcb-web/extend/sp_partner.extend.php) · [sp_pcb_eq.extend.php](../../samplepcb-web/extend/sp_pcb_eq.extend.php) · [sp_bom_claim.extend.php](../../samplepcb-web/extend/sp_bom_claim.extend.php) · [sp_pcb_claim.extend.php](../../samplepcb-web/extend/sp_pcb_claim.extend.php)
- sp-vue 포털 디렉터리(목록 스캔): [pages/partner](../../samplepcb-web-mono-app/apps/web/src/pages/partner) 19화면 · [partner/](../../samplepcb-web-mono-app/apps/web/src/partner)(menu·i18n·usePartnerWork·partnerPoStatus·useRouteTab) · [components/partner](../../samplepcb-web-mono-app/apps/web/src/components/partner)(행 4종·PartnerShipmentCard·PartnerPageHeader·PartnerPartEditModal)
