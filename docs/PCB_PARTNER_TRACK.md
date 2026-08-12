# PCB 파트너 트랙 이식 조사 — 레거시 SmartBOM PCB → 플랫폼

2026-08-04 작성. 레거시 SmartBOM( `sp-smartbom-web`(Vue) + `samplepcb_xpse`(Spring) )의 **PCB 트랙** —
고객 PCB 제조 주문에 대한 **협력사 견적(RFQ)·선정·발주·EQ 승인·생산·선적(그룹/국내외)·상업송장·A/S 재발주·다중통화 정산** —
을 이 플랫폼(sp-vue 관리자 `/app/admin` + sp-node `/api` + 협력사 포털 `/app/partner`)으로 이식하기 위한 전수 조사 + 설계안이다.

- 원본 리포: `D:\work\workspace_other\sp-smartbom-web` · `D:\work\workspace_other\samplepcb_xpse` (프론트 13라우트·API 85호출, 백엔드 84엔드포인트를 전수 추적)
- 자매 정본: **docs/SMARTBOM_PARTNER_RFQ.md** — 같은 레거시의 **BOM 트랙**을 먼저 이식한 정본. 본 문서의 설계는 그 자산 재사용이 전제다.
- 회수 자료: **docs/legacy-smartbom/** — 레거시 gitignore(`tmp/`)에만 있던 통화 설계서·UML Atlas(07-29)·실 DB DDL 덤프. 유실 위험이 있어 조사 시점에 회수했다.

---

## 0. 한눈 요약

1. **고객 쪽은 이미 끝나 있다.** 거버 업로드→서버 재계산→`sp_quote`/`sp_order_spec`/`sp_file`→앵커 상품 카트→무수정 영카트 주문, 견적관리(quotes.php), PCB 제작 12단계 주문 상태 체인(`g5-db.ts` SSOT: 주문→입금→준비→가격확인→파일검사→**EQ**→생산시작→생산중→품질시험→생산완료→**A/S**→배송→완료)까지 플랫폼에 정석 구현·이관 완료. **없는 것은 그 뒤편의 관리자↔협력사 협업 축** 전부다.
2. **BOM 트랙 이식 자산이 척추다.** `sp_partner` 3종(조직·계정·관계), requirePartner, 파트너 포털(두 칸 UI), 매직링크, RFQ→PO→선적 핑퐁(서버 인가), 상업송장·거래명세서·QR 선적리스트, 관리자 워크큐 6메뉴+배지+`?from=` 접힘, 메일 계층, 수출입은행 환율(`lib/exchange-rate.ts`)까지 — PCB 트랙이 필요로 하는 것의 7할이 이미 있다. `sp_partner.capabilities` 예시에 `"pcb_rfq"`가 이미 있을 정도로 확장이 예정돼 있었다.
3. **이식은 복제가 아니라 3가지 문법 전환이다.**
   - **앵커 전환**: 레거시는 주문마다 생성된 영카트 상품 `it_id`(레거시 DB에 PCB 상품 38,766개)가 Case 축. 플랫폼은 앵커 상품 6종 + `sp_order_spec`(projectId, 20,537행)이 그 역할 → 신설 테이블은 `it_id`가 아니라 **specId**를 참조한다.
   - **소급 전파 → 선확정**: 레거시 선정은 `it_price`/전 카트 `ct_price`/주문 `od_misu`까지 **소급 갱신**(스냅샷 원복 동반). 플랫폼은 `PATCH /api/admin/pcb-projects/:id/price`가 담김/주문됨이면 **409로 거부**(snapshot-freeze) — 파트너 견적 루프는 확정가 등록 **앞단**에 끼운다.
   - **프론트 신뢰 → 서버 인가**: 레거시 선적 진행(`PUT /spShipments/{id}/progress`)은 **주체·전이 검증 전무**(principal조차 안 받음). BOM 트랙 D22에서 이미 서버 인가로 교정한 패턴을 그대로 승계한다.

---

## 1. 이식 대상 — 레거시 PCB 트랙 전수

### 1.1 프로세스와 역할

```
고객 PCB 접수(그누보드 ca_id=10, it_23='rfq', it_24=견적상태) — 레거시 www가 생성
 → 관리자 PCB 검토(PcbReview)
     ├─ 직접 판매가 확정(sellPrice) ────────────────────────┐
     └─ 협력사 견적요청(diff 배정+제시 납기) → 협력사 회신(가격+납기 필수)
        → [MD면: 하위 재요청 → 하위 선정+마진 → 상위 회신]  │
        → 관리자 선정(sellPrice + 외화면 환율 박제) ────────┤
 → g5 판매가 전파(it_price/ct_price/od_misu, 스냅샷 보관) ←─┘   ※ 플랫폼에선 폐기(§5.2)
 → 고객 주문/입금 → PCB 발주서(POD) 생성(목적지·결제통화·납기·조건 박제)
 → EQ 5단계: 발주접수 → EQ승인요청(수주자, EQ 선택·Working 권장, 첨부 없이도 가능) → EQ완료(관리자 승인/반려)
             → 생산시작 → 생산완료 (한 칸 되돌리기: 그 전이의 주체만)
 → 선적 그룹(같은 leg·목적지·회차, 생산완료만) → 물리 선적 + 상업송장(엑셀/PDF)
 → 국제 6단계(선적 준비→선적 요청→선적→국내도착→통관→완료)
   또는 국내 3단계(배송준비→배송중→배송완료; sender 국가==목적지 국가면 domestic 박제)
 → 완료 내역 → (A/S) 작성→접수→협력사 회신(재생산가능/불가)→재발주진행(회차 MAX+1, POD 복사)
```

| 역할 | 레거시 식별 | 하는 일 |
|---|---|---|
| 관리자 | `mb_level=10` | 검토·배정·**선정**(판매가)·발주·**EQ 승인/반려**·통관/완료·A/S 접수·환율/통화 설정 |
| 마스터딜러(MD) | `g5_member.mb_1='MASTER_DEALER'` | 양면: 위로는 협력사처럼 수주, 아래로는 관리자처럼 발주. 하위 선정+마진 박제. EQ에선 다리(fallback), A/S에선 읽기전용 중계 |
| 협력사 | 그 외(`mb_partner_auth`) | 견적 회신(가격+**예상 배송일 필수**)·EQ 올림·생산·발송·송장 생성·A/S 회신 |

### 1.2 도메인 모델 (테이블 — 실 DDL은 docs/legacy-smartbom/legacy-pcb-ddl.sql)

전부 **MyISAM(무롤백)**. `sp_pcb_partner_order`의 CREATE DDL은 레거시 리포에 없고(alter만 존재) 실 DB 덤프가 유일 명세다.

| 테이블 | 역할 | 핵심 컬럼 |
|---|---|---|
| `sp_pcb_partner_order` (견적행) | RFQ 배정~선정. **UK `(it_id, partner_mb_no, parent_mb_no, reorder_round)`** | status(협력사 견적요청/견적완료/견적완료/미선정), is_select_partner, `meta_item`(선정 전 g5 값 **selectSnapshot**), price(KRW 보조)+**currency/price_original/exchange_rate**(결제통화 정본 3종)+**sub_\***(입력통화 원본 3종)+**source_\***(MD 변환점 박제 3종), selected_sub_partner_order_id, margin_rate, suggested/quoted_delivery_date. forwarder/shipping/tracking·estimate_file1은 사장된 잔존 컬럼(미이식) |
| `sp_pcb_partner_order_document` (발주서=POD) | 발주~EQ~생산~선적 배정. UK 동형 4키 | status(EQ 5단계), order_price(KRW 회계 — 관리자 직발주 외화 건만)+order_currency/original/rate+order_sub_\*, destination_country(KR/CN/VN, NULL=레거시 경유), payment_terms, remitted_at, delivery_date, **eq_history_json**, shipment_group_id/shipment_id, pcb_partner_order_id(원 견적행) |
| `sp_pcb_as_case` | A/S 헤더. UK `(it_id, reorder_round)` — round는 **[재발주 진행] 시점에 부여**(초안이 회차 점유 금지) | case_type(관리자실수/제품불량), charge_type(유상/무상 — 불량=무상 기본), status(작성→접수→재생산가능/불가→재발주진행), target_mb_no, reply_reason |
| `sp_shipment` (BOM과 **공용**, order_type) | 물리 선적 | status, carrier/tracking, shipment_mode('domestic'/NULL)+domestic_country, ship_date/shipped_at/..., history_json, **invoice_data**(송장 편집본), ship_qty, case_id(+required) |
| `sp_shipment_group` | PCB 물류 단위(같은 leg 묶음) | order_type, reorder_round, sender/receiver_mb_no(직송=0), destination_country, title |
| `sp_master_dealer_partner` | MD↔협력사 소속 + **링크 결제통화** | settlement_currency(NULL=런타임 USD) |
| `sp_file` (공용) | 다형성 첨부 | PCB refType: `pcb_partner_order`(견적서)·`pcb_partner_order_document`(발주 첨부)·`pcb_pod_eq`(EQ/Working, file_type='eq'/'working')·`pcb_as_case`·`shipment`(airwaybill/invoice) |

주의: `sp_pcb_parts`/`_price`/`_price_step`(12만 행)은 이름과 달리 **부품(BOM) 가격 카탈로그**다 — PCB 트랙 무관, 플랫폼 `sp_part*`가 대체 완료, 이식 불필요. `sp_partner_chat_*`(파트너 채팅)·`sp_outsourcing`(외주)은 PCB 워크플로 밖(이식 범위 제외).

### 1.3 상태 머신 5종 (값 전수 · 서버 검증 유무)

| 축 | 값(순서) | 주체 | 서버 검증 |
|---|---|---|---|
| 견적행 status | 협력사 견적요청 → 협력사 견적완료 → 견적완료(선정) \| 미선정 | 협력사 회신 / 관리자 선정 | **있음** — 화이트리스트, 이중 선정 금지, 외화 환율 필수, **unselect는 입금(od_receipt_price>0) 시 거부** |
| POD status (EQ) | 발주접수 → EQ승인요청 → EQ완료 → 생산시작 → 생산완료 (반려→발주접수) | RECEIVER=수주자(+MD parent fallback) / ORDERER=**항상 루트 관리자**(코드 기준 — Swagger 문구 "관리자/해당 MD"와 불일치) | **있음** — expectedFrom 순서 강제, revert는 직전 전이 주체만·생산완료 revert는 선적 미배정일 때만 |
| A/S status | 작성 → 접수 → 재생산가능 \| 재생산불가 → 재발주진행 | 관리자 / 협력사 회신 / 관리자 proceed | **있음** |
| 선적 status | 국제: 선적 준비 → 선적 요청(S) → 선적(R) → 국내도착 → 통관 → 완료 / 국내: 배송준비 → 배송중(S: 택배사+송장) → 배송완료(R 수령확인) | S=보내는측, R=받는측 (프론트 `Shipment.types.ts`의 actorForStatus/fieldsForTransition이 유일 정의) | **전무** — `PUT /spShipments/{id}/progress`는 주체 검증도 principal도 없이 통째 저장. 유일한 서버 로직은 완료 진입 시 completed_at 박제 |
| 고객 견적상태 `it_24` | 견적접수 → 견적확인중 → 견적완료 | 배정 시/선정 시 자동 + 관리자 수동 | 3값 화이트리스트 |

파생(저장 안 함): 그룹 상태 미시작/진행중/완료, `myTurn`(견적/발주/물류 단일 규칙 — **백엔드 계산**), `outboundReady`(출고 게이팅: 같은 it_id 입고 발주서 전건 배정+최종완료, 없으면 생산완료), MyTurn 배지 맵(키=**프론트 라우트 경로 문자열**).

### 1.4 통화·환율·MD 정산 (문서 최약체 — DDL 헤더 주석과 코드가 정본)

- **한 링크 = 한 결제통화**: 관리자↔협력사·관리자↔MD는 `g5_member.mb_currency`, MD↔하위는 `sp_master_dealer_partner.settlement_currency`(기본 USD). 허용 `KRW|USD|CNY`. 각 당사자는 자기 통화만 보고, 환율은 **변환점에서만** 등장해 그 시점 박제.
- **금액 정본 = `price_original`(결제통화)**. `price`(KRW)는 보조 — 관리자 직발주 외화 건만 채움(needsKrwAccounting = 외화 && parent==0), MD→하위 발주는 null.
- **입력통화 레이어**: 입력≠결제일 때만 `sub_currency/sub_price_original/sub_exchange_rate` 3종 박제(중국 협력사 위안화 입력 관행), 같으면 명시적으로 null 클리어.
- **MD 마진**: `mdAmount = 하위금액 × getRate(하위통화→MD통화) × (1+margin/100)` — 단일 BigDecimal 체인, **최종 1회만 HALF_UP**(KRW 0자리/외화 2자리). `source_currency/amount/rate` 3종으로 감사 박제("¥7,200 @0.139 ×1.08 = $1,080.09" 복원 가능). 마진 컬럼은 **MD 변환점에만** 존재 — 관리자→고객 단계는 sellPrice 직접 입력.
- **환율 소스**: 한국수출입은행 AP01(@Primary, USD tts·CNY는 CNH/USD 교차, 당일 1회 lazy 캐시, 스케줄러 없음) → 실패 시 `g5_shop_default.de_usd_exchange_rate`(1350)/`de_cny_usd_exchange_rate`(0.139) 폴백(성공값을 폴백에 역저장). 환율 이력 테이블 없음.
- **VAT**: 레거시 전파 시 `(int)(sellPrice*0.1)` **버림**(카트 요약은 Math.round — 서로 다름). 플랫폼은 "부가세 포함가 역산" 체계(GERBER_PRICE_MODE.md)라 이 계산 자체가 소멸된다(§5.2).

### 1.5 화면 (레거시 13라우트 → 자세한 인벤토리는 조사 원본 참조)

관리자: PCB 검토(목록/상세 1,217줄 — 협력사 견적 현황·선정 모달(마진%↔판매가 양방향)·직접가·발주 현황) · 주문 현황(주문대기 섹션) · 발주 내역/상세(EQ 패널·MD 하위 재발주) · 선적(그룹 보드+ShipmentPanel) · A/S · 완료 · 설정 3종(환율/협력사 통화·국가/MD 소속).
협력사: 견적 현황(역할별 2~4섹션, '내 차례' 하이라이트) · 견적 제출(통화 토글+납기 필수+이탈 방지) · 발주 확인·EQ · 선적 발송 · A/S 회신.
MD 전용: 하위 비교·선정(마진 미리보기) · 입고/출고/직송 중계 3라우트.
공통: SideNav MyTurn 배지(인디고=처리 차례, 틸=미배치 풀), BOM/PCB 모드 토글.

### 1.6 API 표면 (84 엔드포인트 요약)

`/api/spPcbPartnerOrders` 17종(검색/그룹검색/상세/회신/선정/취소/직접가/배정 diff/MD subs·select/통화·국가 설정 6종) ·
`/api/spPcbPartnerOrderDocs` 12종(upsert/검색/상세/삭제 + EQ 6전이) · `/api/spPcbAsCases` 11종 ·
`/api/spShipmentGroups` 11종(+pool/relay) · `/api/spShipments` 진행·삭제·송장 3종 · `/api/exchangeRate` 5종 ·
`/api/pcb/myTurnCounts` · `/api/masterDealerPartners` 7종 · g5 직접(카트 검색 `it_23='rfq' AND ca_id='10'` 고정 필터, 견적상태, PCB 삭제 cascade, 주문 검색 0-base).
메일은 xpse에 없음 — 견적요청 후 프론트가 PHP `partner.php?w=sendPcbEstimateMail`을 베스트에포트 호출.

### 1.7 레거시 결함·미완 (이식 시 교정/승계 판단 목록)

| # | 항목 | 판단 |
|---|---|---|
| L1 | 선적 진행/삭제 API 인가·전이 검증 전무(그룹 경로만 sender 검증 — 같은 행위에 보안 수준 2개) | **교정**(BOM D22 서버 인가 패턴) |
| L2 | EQ 승인 주체 코드(관리자만) vs 문서(MD 포함) 불일치 | 결정 D3 |
| L3 | VAT 버림/반올림 혼재 | 플랫폼 포함가 체계로 소멸(§5.2) |
| L4 | `sp_shipment` BOM/PCB id 충돌 위험(findById는 order_type 미확인) | **교정** — 전용 테이블 분리(§5.3) |
| L5 | 목적지 거점 주소 KR/CN/VN enum 하드코딩(CN/VN은 임의값) | 설정화(sp_config) + 실주소 확인 필요 |
| L6 | 메일 발송이 프론트 책임(유실 가능) | **교정** — sp-node 메일 계층 |
| L7 | MyISAM 무롤백 전제 설계(leaf-first 삭제, 멱등 upsert, 회차 채번 경합) | InnoDB+Prisma 트랜잭션으로 재평가 |
| L8 | findCartByItId fetchFirst(다건 카트 임의 1건) vs 전파는 전 카트 — 비대칭 | 플랫폼 앵커 전환으로 소멸 |
| L9 | MyTurn 배지 키=프론트 경로 문자열 결합 | 논리 키로 재설계 |
| L10 | 통화 위키/문서 전면 stale(폐기된 "USD 단일 정본"·"통화 일치 가드" 서술 잔존) | 코드·DDL만 신뢰(회수 자료 참조) |
| L11 | doc/ §9 잔여: 회차 배지·분할발주 다중 A/S·MD 납기 버퍼 등 미구현 | 이식 범위에서 제외(후속) |

---

## 2. 플랫폼 현행 자산 (접합부)

### 2.1 고객 PCB 파이프라인 (구현 완료 — 무변경 전제)

- 거버 뷰어(별도 React) → `POST /api/pcb-projects`(서버 재계산·파일서버 대행·스냅샷) → `sp_quote`(불변 견적)/`sp_order_spec`(프로젝트 정본: specJson·status·**quoteStatus(priced/rfq/quoted)**·finalPrice·pricedBy/At·**ctId**)/`sp_file` → 앵커 상품 카트행 → 무수정 코어 주문(od).
- **확정가 경로 실측**: `PATCH /api/admin/pcb-projects/:id/price` — finalPrice+quoteStatus='quoted' 기록. **IN_CART/ALREADY_ORDERED면 409**, 유령 active는 보관함 정리 후 거부. rfq는 가격이 없어 카트 진입 불가(NOT_PRICED)라 항상 통과. → **파트너 견적 루프의 종점 = 이 확정가 등록**.
- sp-php는 읽기 전용 셸(quotes.php 통합 목록·주문내역 라벨 `sp_order_status.extend.php`) — **파트너 트랙 이식으로 고객 화면 변경은 사실상 없음**.

### 2.2 주문 상태 체인 (이미 PCB 제작 축 보유)

`g5-db.ts`: PRODUCTION_STATUSES 7단계 + 전체 체인 12단계(§0), 선형 전이 맵 + **force-status**(임의 전이, 재고 앵커). 관리자 조작은 sp-vue `/app/admin/orders`. **'EQ'·'A/S' 상태가 이미 존재** — 신설 파트너 트랙(POD EQ·A/S 회차)과 의미가 겹치므로 동기화 정책이 결정 사항(D6).

### 2.3 BOM 트랙 이식 자산 재사용표

| 계층 | 자산 | PCB 재사용 |
|---|---|---|
| 스키마 | `sp_partner`(+capabilities에 `"pcb_rfq"` 예시 선반영)/`sp_partner_member`/**`sp_partner_relation`(MD 대비 스키마만 선반영, 미구현)**, `sp_file`(uploadedBy), `sp_mail_template/log` | 그대로 |
| 서버 | requirePartner(매 요청 판정), 매직링크(`bom-rfq.ts` 토큰 발급·회전·30일 TTL), `mailer.ts`+`rfq-email.ts`(7종 빌더, 비차단), **`lib/exchange-rate.ts`(한국수출입은행! 이미 존재)**, `bom-po.ts`의 선적 핑퐁(advance/revert 주체·필수값 서버 검증)+입고확인+파일 프록시, `bom-invoice.ts`(상업송장 초안·엑셀)·`bom-trade-documents.ts`(견적서/거래명세서)·`bom-packing.ts`(QR 선적리스트), `bom-shipment-policy.ts`(국가→모드), g5-db 카탈로그(getOrderHeadersLite·isPaid·getCartOrderLinks 등) | 패턴/모듈 재사용(일부 공용화 추출) |
| 웹 | 모듈 스위처(adminModules)+워크큐+배지 시스템+Case `?from=` 접힘, 통합 관리의 공용 파트너 기준정보(`/admin/partners`), **진짜 공유 컴포넌트 5종**(RfqReplyForm·BomEstimateSheet·InvoiceEditorModal·ShipmentPackingModal·TradeDocumentModal — 관리자/파트너/매직링크 3자 공용), UiPagination | 참조 아키텍처=2세대 smartbom 모듈 |
| 포털 | `/partner` 홈(할 일 카드)+두 칸 선반↔박스+PartnerShipmentCard+partnerPoDisplayStatus(상태 번역) | PCB 문서를 같은 포털에 합류 |

테스트 주의: BOM 트랙도 `bom-rfq.ts`/`bom-po.ts`/`bom-invoice.ts`/`bom-order.ts`/`rfq-email.ts`는 전용 단위테스트가 없다(E2E 스크립트는 scratchpad 소멸). PCB 이식 시 공용화 추출과 함께 테스트를 신설하는 편이 안전.

### 2.4 DB 현황

- 플랫폼 DB(`samplepcb`)에 `sp_pcb_*`/`sp_shipment*`/`sp_master_dealer_partner`/`sp_estimate` **전부 없음**(레거시 xpse 소유분 미이관 — LEGACY_DB_MIGRATION 방침).
- 레거시 워크플로 실데이터는 소량: 견적행 135(AUTO_INCREMENT 기준)·발주서 11·A/S 1·선적 11·그룹 5·MD 매핑 2. **데이터 이관 부담은 사실상 0** — §5.6.

---

## 3. 개념 매핑 (레거시 → 플랫폼)

| 레거시 | 플랫폼 대응 | 비고 |
|---|---|---|
| 견적건 `it_id`(주문마다 상품 생성, ca_id=10·it_23='rfq') | **`sp_order_spec.id`(projectId)** — RFQ는 주문 전(비담김) 스펙 전체에 시작 가능, 워크큐 기본 필터만 rfq·미확정 우선(§8 V4 정정) | 주문 연동은 ctId→od lazy 파생(BOM D10 동형, g5 미러 금지) |
| `sp_pcb_partner_order` | 신설 `sp_pcb_rfq` | specId+partnerId+parentPartnerId(0 센티넬)+round UK. 문서(RFQ)와 행이 1:1(BOM처럼 rfq/rfq_item 분리 불필요 — PCB는 단일가) |
| `sp_pcb_partner_order_document` | 신설 `sp_pcb_po` | status 5단계+eqHistory(Json)+통화 6컬럼+목적지+납기+회차 |
| `eq_history_json`+`pcb_pod_eq` 첨부 | `sp_pcb_po.eqHistory`(Json)+`sp_file`(refType `sp_pcb_po_eq`) | |
| `sp_shipment`(order_type 공용) | 신설 `sp_pcb_shipment`(+`sp_pcb_shipment_po` 묶기 조인) | BOM `sp_bom_shipment`와 분리(L4 교정). 핑퐁 로직은 공용 모듈로 추출 |
| `sp_shipment_group`(3층 보드) | **발송 시점 묶기**(BOM §6.10 검증 모델) | 그룹 엔티티 자체는 미이식 — withPoIds+조인이 동등 기능 |
| `sp_pcb_as_case` | 신설 `sp_pcb_as_case`(동명, Prisma) | round는 proceed 시 부여 규칙 승계 |
| MD(`mb_1`+`sp_master_dealer_partner`) | `sp_partner_relation`(+settlementCurrency 이미 있음) 활성화 | **1차부터 포함**(D1 사용자 결정, 2026-08-04) — parentPartnerId 축 실사용 |
| `applySellPrice` g5 소급 전파+selectSnapshot | **폐기** → 선정 결과를 확정가(`PATCH .../price`)로 등록 | 주문 후 가격 변경 금지는 플랫폼 불변식 |
| `it_24` 견적상태 | `sp_order_spec.quoteStatus`(rfq→quoted) | 파트너 배정 중임은 RFQ 존재로 파생(별도 상태 불필요) |
| 환율 3종 서비스+`g5_shop_default` 폴백 | `lib/exchange-rate.ts` 확장(CNY 교차·수동 폴백은 `sp_config`) | 환율 이력은 박제 컬럼으로 충분(레거시 동일) |
| MyTurn 카운트(경로 키) | 배지 시스템(counts.*) 확장 | 논리 키(pcbRfqPending 등) |
| PHP sendPcbEstimateMail | `rfq-email.ts` 계열 신규 빌더(sp-node 발송) | L6 교정 |
| PcbEstimatePrintModal(견적서) | 기존 견적서 발송(estimate-email)+BomEstimateSheet 동형 | 이미 플랫폼에 있음 |

---

## 4. 갭 분석

| 필요 요소 | 상태 |
|---|---|
| 파트너 조직·계정·승인·포털·매직링크·메일·환율·워크큐 셸·송장/명세서/QR 문서 | **있음(재사용)** |
| 선적 핑퐁 서버 인가·국내/국제 모드·입고확인 | **있음(공용화 추출 필요)** — bom-po.ts에서 BOM 전용으로 구현됨 |
| PCB RFQ 대상 워크큐(quoteStatus='rfq' 목록) | **부분** — admin-pcb-projects 목록·counts.rfq 존재, 파트너 배정 UI 없음 |
| PCB 견적행/발주서/EQ/A-S 테이블·API·화면 | **없음(신설)** |
| 다중통화 박제 컬럼·MD 마진 | **없음(신설)** — 환율 소스는 있음, sp_partner_relation 스키마는 대비됨 |
| 납기 신호(제시 vs 회신, 변경/최빠름 배지) | **없음(신설)** — BOM RFQ에 없는 PCB 고유 |
| 목적지 직송(KR/CN/VN) | **없음(신설)** — 1차 범위 결정 D5 |
| POD EQ ↔ 주문 상태(가격확인~생산완료) 동기 | **없음** — 현재 force-status 수동(D6) |

---

## 5. 이식 설계안

### 5.1 원칙

BOM 트랙 정본(SMARTBOM_PARTNER_RFQ.md)의 문법 승계: **레거시 설계 추종이 아니라 프로세스만 이식** — snapshot-freeze(결정 시점 박제+서버 재계산만 신뢰), lazy-derived(주문 상태 미러 금지), server-single-truth(myTurn·역할·전이 전부 서버 계산), InnoDB+Prisma(레거시 MyISAM 제약 기반 설계 재평가), 서버 인가 신설(L1), 상태값 String+계약 리터럴 유니온(enum 미사용 관례), 알림은 sp-node 메일(비차단)+매직링크.

### 5.2 프로세스 재설계 (레거시와 다른 지점만)

1. **RFQ 단계 = 주문 전(비담김) 스펙 전체.** 초안은 quoteStatus='rfq' 한정이었으나 실측 정정(§8 V4): 레거시는 모든 PCB 견적건(`it_23='rfq'`는 전 상품 마커)에 파트너 견적이 가능했고, 실 DB도 rfq 1건/priced 0/quoted 20,536(이관분 전부 quoted)이라 rfq 한정은 워크큐를 공동화시킨다. → **RFQ 시작 조건 = 담기지 않은 active 스펙**(rfq·priced·quoted 재견적 모두 허용), 워크큐 기본 필터만 rfq·미확정 우선. 선정 후 관리자가 sellPrice를 **확정가 등록**(기존 PATCH 재사용, quoted 전환) → 고객이 담기·주문. 레거시의 "주문된 건 소급 전파+스냅샷 원복"은 폐기 — unselect 가드(입금 시 금지)도 "확정 전만 선정 변경 가능"으로 단순화된다.
2. **발주(PO) 단계 = 주문·입금 후.** 게이트 = od isPaid(BOM D18 동형, getOrderHeadersLite 재사용). 발주가는 선정된 견적행 스냅샷(통화 포함). VAT는 포함가 역산 체계에 이미 흡수돼 별도 계산 없음.
3. **EQ·생산 = 레거시 상태 머신 그대로**(서버 검증 있는 유일한 축이라 승계 가치 높음). 첨부(EQ/Working)·반려 사유·한 칸 revert·이력 Json 동형.
4. **선적 = BOM D21/D22/§6.10 모델에 PCB 필드 추가.** 발주서당 1선적+발송 시점 묶기(withPoIds), 모드 박제(협력사 국가 기준 — `bom-shipment-policy.ts` 재사용), 핑퐁 서버 인가, 입고확인=검수, 상업송장/거래명세서/QR 재사용. 레거시 국제 6단계와 BOM 6단계는 라벨만 다르고 구조 동일 — **BOM 코드사전으로 통일**.
5. **A/S = 회차 모델 승계.** proceed 시 round MAX+1·copyForReorder(가격/목적지/통화 재사용, EQ/선적/송금 초기화)·완료 발송과 회차 분리. g5 전파 이슈는 애초에 소멸(전파 자체가 없음).

### 5.3 데이터 모델 초안 (Prisma, InnoDB)

```
sp_pcb_rfq        id, specId, partnerId, parentPartnerId(0), reorderRound(0),
                  status(requested|quoted|selected|unselected), currency, priceOriginal(Dec 15,2),
                  exchangeRate(Dec 12,6)?, subCurrency?, subPriceOriginal?, subExchangeRate?,
                  sourceCurrency?, sourceAmount?, sourceRate?, marginRate?,        ← MD 변환점 박제(1차 사용)
                  suggestedDeliveryDate?, quotedDeliveryDate?, memo, respondedAt,
                  magicToken?, magicTokenAt?                                        ← BOM 동형 무로그인 회신
                  @@unique([specId, partnerId, parentPartnerId, reorderRound])
sp_pcb_po         id, specId, partnerId, parentPartnerId(0), reorderRound(0), rfqId?,
                  status(issued|eq_requested|eq_done|producing|produced — 라벨은 계약 사전),
                  currency/priceOriginal/exchangeRate/sub_* 6컬럼, krwAmount?(회계 보조),
                  destinationCountry?, paymentTerms?, remittedAt?, deliveryDate?,
                  eqHistory Json?, memo, issuedAt/confirmed.../timestamps
                  @@unique([specId, partnerId, parentPartnerId, reorderRound])
sp_pcb_shipment   sp_bom_shipment 동형(mode/status/carrier/tracking/shipDate/shippedAt/
                  receivedAt/completedAt/invoiceData/…) + shipQty?  — poId→sp_pcb_po
sp_pcb_shipment_po(shipmentId, poId UNIQUE) — 발송 시점 묶기
sp_pcb_as_case    id, specId, reorderRound?, caseType, chargeType, description, status,
                  targetPartnerId, replyReason, createdBy, timestamps
                  @@unique([specId, reorderRound])
sp_file refType 추가: sp_pcb_rfq / sp_pcb_po / sp_pcb_po_eq / sp_pcb_as_case / sp_pcb_shipment
```

통화 속성의 자리(레거시 → 플랫폼): 관리자↔협력사 결제통화 = **기존 `sp_partner.defaultCurrency`**(레거시 `mb_currency` 대응, 조직 속성으로 승격) · 입력/표시 통화 = **`sp_partner.inputCurrency` 신설**(레거시 `mb_sub_currency`) · MD↔하위 링크 통화 = **기존 `sp_partner_relation.settlementCurrency`** · 소재국 = 기존 `sp_partner.country`(국내/국제 모드 판정 — `bom-shipment-policy.ts` 재사용).

마이그레이션은 BOM 트랙과 동일하게 `prisma migrate deploy` 방식(공유 DB — reset 금지).

### 5.4 API·화면 초안

- **sp-node**: `admin-pcb-rfqs.ts`(배정 diff·회신 대리입력·선정·매직링크) / `admin-pcb-pos.ts`(발주 생성·EQ 전이·선적·송장) / `admin-pcb-as.ts` / `partner-pcb.ts`(포털: 받은 PCB 견적·회신, 발주 확인·EQ 올림, 발송) / `pcb-rfq-reply.ts`(매직링크). 재사용 전략 정정(§8 V6): 선적의 공용 절단면은 **계약 패키지에 이미 존재**(`bomShipmentNextStatus`·모드/상태 코드사전 — FE/BE 공용)하므로 bom-po.ts는 건드리지 않는다. PCB 전용 `lib/pcb-po.ts`·`pcb-shipment.ts`가 같은 계약 사전을 공유하는 **미러**로 구현(BOM 회귀 위험 제거, 미러링 교훈의 '도메인 식별자가 다르면 분리' 축) + PCB lib에 단위테스트 신설. 계약은 `schemas/pcb-rfq.ts`·`pcb-po.ts` 신설 + `apiRoutes` 키 추가.
- **sp-vue**: adminModules에 세 번째 모듈 **`pcb`**("PCB 협력") 신설 — 스마트 BOM 모듈과 같은 골격, 구현은 PCB 전용·분리(§6 D9로 확정): 진행현황(총괄 조감·모듈 홈)/견적요청(RFQ)/주문·결제(경리 — 레거시 이관 주문 이력 포함)/발주·EQ/선적·배송(+A-S는 P4). ~~파트너(공유 진입)~~ — 모듈 간 화면 공유는 하지 않는다(D9, 별칭 공유안 철회). Case 상세는 admin-pcb-projects 상세(견적 스펙·거버)에 RFQ 패널·PO 패널을 얹는 형태(AdminSmartbomCase 패턴+`?from=` 접힘 — P3.6 구현). **각 워크큐의 첫 탭은 그 역할의 "대기 큐"**(요청 대기·발주 대기·발송 대기 — P3.6/D12), 배지는 대기 수 + 진행 중 내 차례의 합산: pcbRfqPending(요청 대기+선정 대기)·pcbOrdersAwaiting(입금 대기)·**pcbPosPending**(발주 대기+EQ 승인 대기)·pcbShipmentPending(발송 대기+관리자 차례). 진행현황은 12단계 파생 타임라인(`PCB_STEPS`) 칩 + 구간 탭.
- **포털**: 기존 `/partner` 홈 할 일 카드에 PCB 카드 합류(회신할 PCB 견적/확인할 PCB 발주·EQ/보낼 물건). 납기 필수 입력·통화 토글은 RfqReplyForm의 PCB 변형으로.
- **고객(sp-php)**: 무변경(§2.1). 후속 아이디어로만: EQ 단계 고객 안내 메일.

### 5.5 단계 분할

(2026-08-04 결정 반영: **MD·통화 3종이 1차 범위로 편입** — 구 P5 소멸, P1~P3에 분산)

| 단계 | 범위 | 완료 판정 |
|---|---|---|
| P1 | `sp_pcb_rfq`(+`sp_partner.inputCurrency` 추가) + **직속·MD 2단 RFQ 루프**(배정 diff → 회신[결제·입력통화 3종+납기 필수] → MD 하위 선정+마진·source_* 박제 → 관리자 선정) → 확정가 연동, 매직링크·대리입력, 납기 신호, CNH 교차 환율 확장, 메일, 관리자 'PCB 협력' 모듈(진행현황·견적요청 워크큐+배지), 포털 회신 | rfq 견적이 (MD 경유 포함) 파트너 회신·선정을 거쳐 quoted 전환, E2E green |
| P2 | `sp_pcb_po` + paid 게이트 발주(직속+**MD 하위 재발주**·통화 박제) + EQ 5단계(첨부·반려·revert·**MD 미러/fallback**)·포털 발주 확인 | EQ 왕복+생산완료 E2E |
| P3 | `sp_pcb_shipment(+_po)` + 핑퐁 서버 인가·국내/국제 모드·**목적지 직송(KR/CN/VN)·MD 입고/출고/중계 뷰·출고 게이팅**·입고확인·상업송장/명세서/QR 재사용 | 국내/국제·직송 발송→입고 E2E, 계약 사전 확장 시 BOM 회귀 확인 |
| P4 | `sp_pcb_as_case` 회차 재발주(MD 경유 포함) + od 상태 자동 동기 옵션(D6 재검) + MyTurn 배지 통합 | A/S 1회차 E2E |

### 5.6 데이터 이관

**미이관 권고.** 레거시 워크플로 데이터는 수십 건 규모이고 진행 중 건은 레거시에서 종결하는 것이 안전(이중 운영 기간 최소화). 완료 이력 열람이 필요해지면 읽기전용 참조 화면 또는 1회성 스크립트(레거시 DB `legacy()` 클라이언트 패턴)로 후속 — 유일한 대량 테이블 `sp_pcb_parts*`는 이식 대상 아님(§1.2).

---

## 6. 결정 사항 — **확정(2026-08-04, 사용자 원-체크 완료)**

| # | 질문 | **결정** | 비고 |
|---|---|---|---|
| D1 | MD(마스터딜러) 계층 1차 포함? | **1차부터 포함** | 사용자 결정(권고는 제외였음). 2단 RFQ·마진 박제는 P1, 하위 재발주·EQ 미러는 P2, 중계 물류는 P3에 편입 |
| D2 | 다중통화 1차 범위? | **KRW+USD+CNY 전부** | 결제통화 3종+입력통화(sub_*)까지 P1. 수출입은행 CNH 교차를 exchange-rate.ts에 확장 |
| D3 | EQ 승인 주체? | **관리자만** | 레거시 실코드 승계(Swagger 문구는 stale). MD는 다리(fallback)만 |
| D4 | POD 상태 라벨? | **영문 코드+계약 라벨 사전** | BOM 관례(issued/…) — DB 한글 리터럴은 레거시 오염 함정의 뿌리 |
| D5 | 목적지 직송(KR/CN/VN) 1차 포함? | **포함(P3)** | MD 포함 결정의 귀결 — 중계 물류가 직송 없이는 미완결. 거점 실주소는 sp_config로 설정화(CN/VN 실주소 확인 필요) |
| D6 | POD EQ 전이 시 od 상태 자동 동기? | **1차 수동 유지** | force-status 현행 방식. 실측(§8 V7)상 부수 로직이 없어 P4에서 자동화 재검 |
| D7 | 레거시 데이터 이관? | **미이관** | §5.6 |
| D8 | 회수 자료 커밋? | **전부 커밋** | 보고서+docs/legacy-smartbom/ 4종 |

**D19 (2026-08-10) — EQ 첨부는 선택, Working 파일은 권장이다.** 발주접수→EQ 승인요청 전이는 파일 유무로 막지 않는다(사용자 결정). ① **EQ 파일은 선택** — 제조 확인 사항이 있을 때만 올린다. ② **Working 파일은 생산 자료라 업로드를 권장**하되 필수 게이트로 만들지 않는다. 포털은 미업로드 카드를 강조하고 "승인요청 후에는 추가·교체할 수 없음"을 알려 지금 올리도록 유도하지만 버튼은 활성 상태다. ③ **첨부 잠금은 유지** — 승인요청 뒤 파일이 바뀌어 관리자가 다른 자료를 검토하는 문제를 막기 위해 업로드·삭제는 계속 `issued`에서만 허용한다. 빠뜨렸다면 EQ 요청 취소/반려 후 보완한다. ④ 관리자 대행 전이와 메일도 같은 정책을 사용하며, `MISSING_EQ_FILES` 서버 오류와 계약의 `needsEqFiles` 표시는 폐기한다. 상태 순서·주체·주문 취소 게이트는 그대로다.

**D13 (2026-08-06) — 견적 영구 삭제의 협력 트랙 차단 + 감사 원장 공용화.** BOM Case 삭제(§bom-case-delete)를 복제하지 않고 PCB 실정에 맞게 이식한다. ① **차단 확장** — 기존 `PAID_ORDER` 에 `PO_ISSUED`·`SHIPMENT_EXISTS`·`SHARED_ORDER` 추가(우회 정책은 D14 로 대체). ② **경고 4종**(`RFQ_EMAILS_REMAIN`·`PCB_ATTACHMENTS_DELETED`·`UNPAID_ORDER_DELETED`·`LEGACY_CASE`) + 최종확인 체크. PCB 는 모수가 2만 건이라 BOM 의 단건 2단계 모달이 아니라 **배치 프리뷰를 강화**하는 형태다. ③ **감사 원장 공용화** — `sp_bom_case_delete_audit` → **`sp_delete_audit`**(트랙 접두사 없음 = 횡단 관례) + `quoteId` → `subjectType`+`subjectId` 중립화. 범위는 테이블 이름이 아니라 `subjectType` 이 말한다(이름만 공용이고 `quoteId` 에 묶인 `sp_mail_log` 가 반면교사).

**D18 (2026-08-07) — 견적 계산은 라이브 가격표를 그대로 쓴다.** 가격의 단일 진실은 레거시 서버의 **`gerber_api/pricing_data.json` 파일 하나**다: 레거시 관리자 도구(`adm/price_adjust.php`)가 예고 없이 덮어쓰고, 레거시 PHP 가격 API(`PcbPriceBase`)는 **매 요청 이 파일을 읽어** 즉시 반영된다. 반면 sp-node 는 빌드에 박힌 스냅샷(7-03)으로 계산해 **거버 뷰어가 방금 보여준 가격과 담긴 가격이 어긋났다**(실측 최대 10% — ENIG 165,000 vs 148,000). 결정: ① `calculateQuote` 를 실행하는 세 곳(거버 담기·수량 재견적·관리자 사양 수정) 모두 **계산 직전에 라이브 파일을 fetch 해 그대로 쓴다**(`live-pricing.ts`). 주기 폴링·핫스왑·push 훅은 만들지 않는다 — 필요한 순간에 당겨오는 것으로 충분하다. ② **폴백 사다리** 라이브 → 마지막 성공본 → 번들 스냅샷: 가격표 서버가 죽어도 견적은 절대 실패하지 않고, 실패 후 60초는 재시도 없이 즉답해 장애 중 매 계산이 타임아웃을 물지 않는다. ③ 어느 표로 계산했는지는 `sp_quote.priceVersion` 에 남는다(`live-<조회일>` vs 스냅샷 상수). ④ **골든 테스트는 번들 스냅샷으로 결정론 유지** — `calculateQuote(input, pricing?)` 의 기본값이 스냅샷이라 골든은 로직 패리티를 검증하고, 라이브 표가 바뀌어도 깨지지 않는다. `pnpm pricing:sync` 는 폴백 스냅샷 갱신용으로만 남는다.

**D17 (2026-08-07) — 제작 사양 수정은 재견적이고, 전 필드를 연다.** 관리자가 상세에서 사양을 직접 고친다. ① **사양은 가격의 입력이다**(`calculateQuote({category, orderCategory, qty, spec})`) — 따로 고칠 수 없다. 그래서 수량 변경(재견적)이 이미 쓰는 길을 그대로 탄다: **새 `sp_quote` 발급(스냅샷 불변)** → 가격 재계산 → `quoteStatus` 재판정 → 담긴 견적이면 cart 행·옵션 동기화. 새 경로를 만드는 게 아니라 **입력을 수량에서 사양까지 넓히는 일**이다. ② **전 필드 수정 가능**(사용자 결정 — "관리자가 알아서 판단"). 거버 파생값(크기·층수·파일 개수)도 막지 않되 화면이 "거버 파생" 배지와 경고로 그 사실을 알린다 — 막는 대신 대가를 보여주는 D14 와 같은 결. ③ **차단은 둘뿐** — `PO_ISSUED`(협력사와 합의된 사양은 조용히 못 바꾼다. 발주 취소나 EQ 로) · `REQUOTE_RFQ_IN_CART`(담긴 견적을 자동견적 불가 사양으로 바꾸면 담긴 금액을 못 지킨다 — 고객 재견적의 가드 승계). ④ **확정가는 서버가 지우지 않는다** — `finalPriceStale` 로 "다시 매기라"고 알리기만 한다(판단은 관리자). 협력사 회신이 있으면 `answeredRfqCount` 로 재확인 필요를 알린다(차단 아님). ⑤ **이력은 새 원장 없이** — `sp_quote` 체인이 이미 사양 스냅샷을 회차별로 담아 "언제 무엇이"를 복원한다. 빠진 **누가·왜**만 `revisedBy`·`revisedReason` 두 칸으로 더한다(송금·EQ 와 달리 원장을 새로 만들 이유가 없다).

**D16 (2026-08-07) — EQ 고객 확인은 별도 축이고, 메일은 승인 버튼을 갖지 않는다.** 협력사 EQ(제조 확인 사항)를 고객에게 물어보는 기능. ① **전이 머신 불변** — 고객이 승인해도 발주서는 `eq_requested` 그대로이고 `eq_done` 은 여전히 ORDERER(관리자) 몫이다. 고객 확인은 **관리자 승인의 근거**이지 권한 이양이 아니다(사용자 결정). 관리자가 [고객 확인] 으로 선택 발송하며, 모든 EQ 를 고객에게 보내지 않는다(내부 사정도 EQ 에 섞인다). ② **⚠ 메일에 승인 버튼을 넣지 않는다** — 메일 보안 게이트웨이(O365 ATP·프루프포인트 등)가 링크를 **자동 GET** 하므로 링크 하나로 상태가 바뀌면 고객이 열어보기도 전에 승인된다. 여기에 오클릭 비가역성(EQ 승인=생산 시작)·메일 전달로 인한 제3자 승인·파일을 안 보고 답하는 문제가 겹친다. **규칙: 링크는 화면을 열기만(GET), 결정은 화면 안에서 POST.** ③ **공개 파일은 관리자가 고른 것만**(사용자 결정) — 협력사가 올린 EQ·Working 첨부에는 협력사명·로고·연락처가 들어 있어 전량 공개는 공급망을 드러내고 직거래 유인이 된다. 화면 어디에도 협력사명을 쓰지 않고 "제조사" 로 표기한다. ④ **회원 주문만**(사용자 결정) — 소유권을 `spec.mbId` 로 확실히 판정하기 위해. 비회원 건은 종전대로 관리자가 유선·메일로 처리한다. ⑤ **원장으로 기록** — EQ 는 반려 → 보완 → 재요청이 반복되므로 발주서 컬럼 한 칸이 아니라 `sp_pcb_eq_review`(1:N) 다(D15 와 같은 판단). ⑥ 고객에겐 발주서가 아니라 **"내 주문의 확인 요청"** 으로 보인다 — MD 경유로 발주서가 여러 개여도 그 구조를 노출하지 않는다.

**D15 (2026-08-06) — 송금은 상태가 아니라 원장이다.** 송금 이력 관리 요청(사용자)에 대한 결정. ① **원장 신설**(`sp_pcb_remittance`, 발주서 1:N) — 상태 한 칸으로 두면 부분·분할 송금을 못 남긴다. 결제조건에 `50% PRE-PAID` 를 제공하면서 송금은 한 줄만 받던 모순의 해소다. `sp_pcb_po.remittedAt` 은 파생 캐시로 강등한다. ② **미지급 잔액 = 발주가 − 송금 합계**가 이 기능의 핵심 지표이며, 종전 구조로는 금액이 없어 계산 자체가 불가능했다. ③ **통화는 뭉치지 않는다** — 협력사별 집계를 통화별로 나눠 내고 KRW 환산은 참고 총계로만. 송금 환율은 발주 환율과 별도로 박제한다(환차손익). ④ **메뉴 신설**(발주 다음·선적 앞) — 역할(경리·재무)이 다르므로 D12 워크큐 교리에 따라 독립 메뉴이고 첫 탭은 대기 큐다. ⑤ **협력사 포털에 공개**(사용자 결정) — 자기 발주서의 수금 내역·미수금까지. "언제 얼마 들어왔나" 문의를 화면으로 옮긴다. 증빙 파일은 내부 자료라 제외. ⑥ **PCB 전용**(공용 `sp_remittance` 아님) — 살아있는 발주서에 FK 로 붙어야 잔액이 깨지지 않는다.

**D14 (2026-08-06) — 관리자 체크로 차단 전면 해제 + 무기록 삭제.** D13 의 "우회는 `PAID_ORDER` 하나뿐" 을 **철회**한다(사용자 결정). 관리자 판단이 최종이고 화면의 일은 막는 게 아니라 **대가를 끝까지 보여주는 것**이다.

- **차단 전면 해제** — `forceDeleteAll` 체크 하나로 `PAID_ORDER`·`PO_ISSUED`·`SHIPMENT_EXISTS`·`SHARED_ORDER` 가 모두 풀린다. `remainingBlockers()` 는 체크 시 빈 배열을 돌려준다. 차단 사유는 사라지지 않고 건별 카드·강제 체크 옆·감사 스냅샷(`overriddenBlockers`)에 그대로 남는다.
- **사유는 선택** — `reason` 이 필수에서 optional 로. 생략하면 감사행에 빈 문자열로 남는다. 남은 필수 입력은 `acknowledgeIrreversible` 하나.
- **무기록 삭제** — `mode: 'reset'`(SmartBOM 과 같은 어휘)이면 `sp_delete_audit` 행도 `g5_shop_order_delete` 백업도 만들지 않는다. 서버 접속 로그·DB 백업·발송된 메일까지 없어진다는 뜻은 아니며 모달이 그렇게 말한다.
- **⚠ 이 결정이 실제로 동작하려면 코어 삭제 SQL 을 손봐야 했다** — 기존 `forceDeletePaidOrder` 는 이름만 강제였다. `deleteUnpaidOrder` 의 일반 경로는 `WHERE od_status='주문' AND od_receipt_price=0 …` 가드가 **SQL 에 박혀** 있어 `allowPaymentEvidence` 를 줘도 0행 삭제 후 `'paid'` 로 되돌아왔다(2026-08-06 실측). 진짜 하드 삭제(포인트 환원·쿠폰·PG 로그 정리)는 SmartBOM 전용 `deleteExclusiveOrder` 에만 있었고 그것도 형제 cart 가 있으면 `'shared'` 로 거부했다. → 그 함수를 **`purgeOrderRows`** 로 일반화해 대상 cart 를 집합으로 다루고, `deleteAllCarts` 옵션으로 형제 행까지 물리삭제한다. PCB 강제 삭제는 이 경로를 탄다.
- **`SHARED_ORDER` 강제만 성격이 다르다** — 선택하지 않은 **다른 견적의 주문까지** 지운다(그 견적은 주문 전 상태로 되돌아간다). 유일하게 "남의 데이터" 를 건드리는 우회라 모달에서 붉은 띠로 따로 못 박는다.
- **고객 경로는 그대로** — `DELETE /api/pcb-projects/:id` 의 `PARTNER_TRACK_ACTIVE` 가드는 유지한다. 전면 해제는 관리자 판단에 주는 권한이지 고객이 협력 기록을 지울 수 있다는 뜻이 아니다.

**D12 (2026-08-05) — 워크큐 대기 큐 원칙 + 이관분 제외.** 각 역할 워크큐의 **첫 탭 = 그 역할이 시작해야 할 대기 큐**, 배지 = 그 수 + 진행 중 내 차례의 **합산**. 대기 큐(요청 대기·발주 대기·발송 대기)에서는 **레거시 이관분(`specJson._legacy`)을 제외**한다(사용자 결정). 근거: 이관 주문은 레거시에서 이미 RFQ·발주가 처리됐지만 그 이력은 이관 대상이 아니어서(§2.4·5.6), 제외하지 않으면 요청 대기 330·발주 대기 195건이 영구히 눌러앉아 실제 처리 대상 6·5건이 묻힌다(2026-08-05 실측). 제외는 **재촉 목록에서만** — 진행현황·주문·결제에는 그대로 보이고 Case 상세 RFQ/발주 패널도 열려 있어(D10) 필요하면 언제든 진행할 수 있다. 사용자 원칙("완전히 완료된 건이 아니면 레거시로도 PCB 기능 이용 가능")과 같은 방향.

---

## 7. 리스크·함정

1. **레거시 문서·위키를 그대로 믿지 말 것** — PCB 트랙 위키는 06-20(xpse는 06-11) 이후 30여 커밋(통화 재설계·국내모드·직송·납기·A/S)이 통째로 빠졌고, "USD 단일 정본"·"통화 일치 가드"·"출고 게이팅 미적용" 등 **정반대가 된 서술**이 남아 있다. 정본 우선순위: 코드·DDL 헤더 주석 > doc/pcb-*.md(06-22~24) > 위키.
2. **프론트 하드코딩 규칙의 서버 이전** — 레거시 선적 전이·필드 필수값·EQ 액션 매핑의 유일 정의가 프론트 타입 파일이다. 이식 시 서버 검증으로 옮기지 않으면 L1 결함을 승계한다(BOM D22가 선례).
3. **서버 파생 필드 누락 시 화면 전체가 죽는다** — myTurn/outboundReady/eqDocId·myEqRole은 백엔드 계산 전제. 신규 API 설계에 처음부터 포함할 것.
4. **BOM 회귀** — 선적 핑퐁 공용화 추출(P3)은 sp_bom_shipment 경로를 건드린다. 추출 시 BOM E2E(선적 25케이스 계열) 회귀 필수.
5. **외화 표시 3값 로직** — 외화 견적은 선정 전 KRW가 null. 목록·모달 전부 `main(통화, 원본, KRW)+sub(입력 원본)` 표시 유틸(레거시 `utils/currency.ts` 이식)로 통일하지 않으면 "전부 0원/–" 사고.
6. **spec-응답 직렬화 함정(기존 메모)** — 이관 견적 specJson의 `_legacy` 메타는 toClientSpec strip 필수. 신규 RFQ 상세가 spec을 파트너에게 노출할 때 **PII 제거는 서버 책임**(레거시도 백엔드 null 처리) — 주문자 연락처·가격요약을 파트너 응답에서 제거.
7. **공유 DB 규율** — prisma migrate reset 금지, 마이그레이션은 deploy 방식(기존 메모·BOM 트랙 관례).
8. **날짜 전용 필드는 KST로 렌더할 것(2026-08-05 실측 결함)** — 납기·출고예정일은 서버가 `parseKstDate`로 **KST 자정**에 앵커해 저장한다. 그 인스턴트의 ISO는 UTC 기준 전날 15:00 이라, 화면이 `iso.slice(0, 10)` 으로 자르면 **하루 앞당겨 보인다**. 표시만의 문제가 아니다 — 발주 모달이 그 값을 `<input type="date">` 에 프리필하므로 저장할 때마다 납기가 하루씩 밀린다(RFQ 08-21 → 발주 08-20 → 재발주 08-19 …). 타임스탬프(발행일·입고일)도 KST 00~09시 사건이 전날로 찍힌다. 공용 `@sp/utils` `fmtKstDate`/`kstDateInput`/`kstToday` 로 통일했다(PCB·BOM·포털·매직링크·거래문서 일괄 — 견적서/상업송장 발행일은 문서 무결성 문제라 함께 교정). **새 화면에서 날짜에 `slice(0, 10)` 을 쓰지 말 것.** 단, 이미 KST 날짜를 UTC 자정에 앵커해 둔 값(예: `OrderFilterBar.kstMidnight`, `sp_bom_shipment.shipDate` — D22-6)은 어느 쪽으로 읽어도 같은 날짜라 손댈 필요 없다.

---

## 8. 2차 코드 실측 검증 (2026-08-04 — 문서가 아니라 실코드·실DB 기준 재확인)

| # | 검증 대상(실측 파일/데이터) | 결과 → 설계 영향 |
|---|---|---|
| V1 | `prisma/schema.prisma` SpQuote/SpOrderSpec/SpFile 실물 | 일치 — autoPrice null=rfq, quoteStatus priced\|rfq\|quoted, ctId 파생 조인, finalPrice/pricedBy/At. 신설 테이블 FK는 specId로 확정 |
| V2 | `routes/admin-pcb-projects.ts` 확정가 PATCH | 일치 — IN_CART/ALREADY_ORDERED 409, 유령 active 정리. RFQ 루프 종점=이 API 재사용 확정 |
| V3 | `routes/pcb-projects.ts` | 일치 — `flow==='rfq' \|\| listPrice===null → 'rfq'`, NOT_PRICED 카트 가드, 재견적 rfq화 시 담긴 건 거부 |
| V4 | 실 DB `sp_order_spec` 분포 | **quoted 20,536 / rfq 1 / priced 0** → 정정 C1: RFQ 시작 조건을 quoteStatus 한정에서 "주문 전(비담김) 스펙 전체"로 확대(§5.2-1) |
| V5 | 실 DB `sp_partner` | partner 7개 조직이 이미 `capabilities ["bom_rfq","pcb_rfq"]`로 시드됨(승인 상태) → 발송 대상 필터(approved+pcb_rfq) 즉시 성립 |
| V6 | `lib/bom-po.ts` 선적 핑퐁 | `bomShipmentNextStatus` 등 다음단계·코드사전이 **@sp/api-contract에 이미 공용** → 정정 C2: bom-po.ts 추출 대신 계약 사전 공유 + PCB 전용 lib 미러(§5.4) |
| V7 | `lib/g5-db.ts:1801-1829` | PRODUCTION_STATUSES는 **A/S 포함 8종**, 부수 로직 없음(재고차감·송장은 '배송' 진입만) → D6 자동 동기 부담 낮음 확인 |
| V8 | `lib/exchange-rate.ts` + `.env` | 수출입은행 AP01, sp_config 캐시(`bom_quote_exchange_rate_usd`), 매일 12:10 KST 갱신+수동 모드+안전마진+역탐색 10일 — 레거시보다 우수. `KOREAEXIM_API_KEY` 로컬 설정 확인. PCB는 이 캐시를 공유 소비(USD), CNY는 이 모듈에 CNH 교차를 추가하는 확장 지점(P4) |
| V9 | `apps/web/src/admin/menu.ts` | 모듈 사전에 "확장 자리(PCB주문·…)는 실제로 생길 때 추가" 주석 실재. `resolveAdminModuleKey`가 startsWith 분기 → 신규 모듈 = AdminModuleKey에 'pcb' 추가+라우트 프리픽스 `admin-pcb-*`+분기 1줄(기존 core 라우트명과 충돌 없음 — 견적관리는 'admin-quotes') |
| V10 | `packages/api-contract/src/` 구조 | schemas/pcb-project.ts·bom-rfq.ts·bom-po.ts·partner.ts 확인 → 신설은 schemas/pcb-rfq.ts·pcb-po.ts + apiRoutes 키(포털은 BOM 전용 `/api/partner/rfqs`와 구분되는 `/api/partner/pcb-rfqs`·`/pcb-pos`) |
| V11 | `plugins/auth.ts` requirePartner | 매 요청 서버 판정+`partnerContext{partnerId,partnerName,role}` — PCB 라우트 그대로 사용 |
| V12 | `spcb/pages/quotes.php` | QUOTE_LABEL에 rfq='견적 대기' 등 3상태 이미 노출, rfq 항목 주문 차단 안내 존재 → 고객측 무변경 확정 |
| V13 | `AdminQuotes.vue`(129줄)+`useAdminQuotes.ts` | 얇은 셸(탭 all/rfq/priced/quoted/carted + 드로어)+확정가/견적서 발송 훅 완비 → PCB 협력 모듈의 Case 상세는 admin-pcb-projects 상세 계약을 재사용해 RFQ/PO 패널을 얹는 신규 화면(AdminSmartbomCase 패턴)으로 확정 |
| V14 | `lib/bom-rfq.ts` 서두 | diff 발송·replace-all 회신·매직링크 코어 구조 확인 — PCB 변형은 행(item) 계층이 없어 더 단순(단일가+납기), scope 파생 로직 불필요 |

## 9. P1 구현 기록 (2026-08-04 — 파트너 RFQ 루프 완료)

§5.5 P1 범위를 전부 구현·검증했다(MD 2단·통화 3종 포함, D1·D2 반영).

- **스키마**: `SpPcbRfq`(sp_pcb_rfq — UK specId+partnerId+parentPartnerId+reorderRound, 통화 6컬럼+MD source_* 3종+납기 2필드+매직링크) + `SpPartner.inputCurrency`. 마이그레이션 `20260804150000_add_pcb_rfq`(deploy 방식) 적용 완료. **링크 결제통화는 배정 시점에 행에 박제**(이후 조직 설정 변경과 무관 — snapshot-freeze).
- **계약**: `schemas/pcb-rfq.ts`(상태 4종 영문 코드+라벨 사전, 회신/배정 diff/선정/MD 하위선정 바디, 관리자·포털·매직링크 뷰, 횡단 워크큐) + apiRoutes 3키.
- **환율**: `lib/exchange-rate.ts`에 CNH 캐시(`sp_config: pcb_exchange_rate_cnh`)·`getPcbExchangeRate`(KRW 경유 교차, tts 기준, scale 6)·`roundPcbAmount`(부동소수 보정 HALF_UP — 1.005 함정 교정) 추가. 기존 BOM USD 경로 무변경, 일일 12:10 KST 스케줄러에 CNH 동승(USD 실패와 독립).
- **lib**: `pcb-rfq.ts`(배정 diff — 미회신만 회수·회신 보존, 회신 저장 — 입력≠결제 시 sub_* 박제·같으면 명시 클리어, MD 하위선정 — mdAmount=source×rate×(1+마진%) 단일 체인·최종 1회 반올림·source_* 박제·납기 상향 pass-through, 관리자 선정 — 외화 환율 필수·krwAmount 박제·형제 전부 미선정(레거시 승계)·해제 시 가격 유무 복귀, 스펙 게이트 — 확정가 PATCH 와 동일 논리, 매직링크 — 64hex·30일·회전, PII 제거 — 파트너 응답에 주문자·고객가 구조적 부재+specJson 언더스코어 strip) + `pcb-rfq-email.ts`(요청/회신 통지 빌더 — 발송은 서버 소유, L6 교정).
- **라우트**: `admin-pcb-rfqs.ts`(횡단 워크큐 /admin/pcb-rfqs + 스펙별 현황·배정·대리 회신·선정/해제·재발급) / `partner-pcb-rfqs.ts`(requirePartner — 목록·상세·회신·거버 파일 프록시 다운로드·MD 하위 배정/선정) / `pcb-rfq-reply.ts`(매직링크 GET/PUT). server.ts 등록.
- **웹**: adminModules 세 번째 모듈 **'PCB 협력'**(resolveAdminModuleKey `admin-pcb` 분기) — `AdminPcbRfqs.vue`(워크큐: 회신 대기/선정 대기/선정 완료 탭+검색, 배지=선정 대기 수) · `AdminPcbCase.vue`(스펙 요약은 기존 admin-pcb-projects 상세 계약 재사용 + RFQ 패널: 배정 모달(pcb_rfq 능력 필터)·대리 회신(공용 폼)·선정 모달(외화 환율)·납기 신호 배지·매직링크 복사/재발급·**확정가 등록 버튼(선정 KRW 프리필)**) · 포털 `PartnerPcbRfqDetail.vue`(회신 폼+MD 하위 배정/선정) + 홈 PCB 카드 · `PublicPcbRfqReply.vue` · 공용 `PcbRfqReplyForm.vue`(통화 토글 — 3화면 공용, 저장 경로 단일).
- **검증**: 스모크 24 + 풀 E2E 33 **ALL PASS**(실서버 — 이관 rfq 스펙 실데이터, CNY 7,200→실환율 0.148048→US$1,065.95→마진 8%→$1,151.23→선정 환율 1444.19→₩1,662,595→확정가→quoted, Mailpit 실수신 3통·관리자 통지 포함, 비소속 하위 배정 400·타 조직 행 404·선정 후 수정 409 등 부정 케이스 포함). `pnpm -r typecheck`·ESLint 신규 파일 0건·vitest **635 passed**(회귀 0).
- **로컬 시드(dev DB)**: 파트너 9=MD(USD·CN·메일), 10=하위(입력 CNY·CN·메일), 관계 9→10(USD). E2E 스크립트는 scratchpad(소멸 전제) — 재검증 시 JWT 로컬 서명 패턴(.env JWT_SECRET HS256)으로 재작성.
- **P1 후속 소항목**: 선정 모달 환율 prefill(수출입은행 캐시 노출 API), 워크큐 서버 페이지네이션(현 메모리 — 규모상 무해), 매직링크 페이지의 첨부 다운로드(현재 포털 로그인 안내), Case 삭제 프리뷰에 RFQ 카운트 표시.

### P2 구현 기록 (2026-08-04 — 발주서·EQ 5단계 완료)

§5.5 P2 범위 전부 구현·검증(MD 위임·미러·fallback 포함).

- **스키마**: `SpPcbPo`(sp_pcb_po — UK specId+partnerId+parentPartnerId+reorderRound, 통화 7컬럼+destinationCountry 선반영+paymentTerms/remittedAt/deliveryDate+`eqHistory` Json). 마이그레이션 `20260804170000_add_pcb_po`.
- **계약**: `schemas/pcb-po.ts` — 상태 5종(issued→eq_requested→eq_done→producing→produced) + **정방향/역방향 전이 사전(PCB_EQ_FORWARD/REVERT)이 FE 라벨과 서버 검증의 단일 정본**(레거시 pcbEqWorkflow.ts 대응). EQ 파일 2종(eq=선택/working=권장, 둘 다 전이 비필수)·이벤트·관리자/포털 뷰·워크큐.
- **lib `pcb-po.ts`**: 발주 생성(paid 게이트=`getOrderInfoByCtId.isPaid`, 선정 견적행 스냅샷 프리필, 외화 관리자 발주 환율 필수→krwAmount 박제, **MD 하위 발주는 KRW 회계 없음** — 레거시 승계), PATCH(금액은 issued에서만)·삭제(issued+하위 잔존 거부, 첨부 leaf-first 정리), **EQ 전이 서버 강제**(expectedFrom 고정 — 오발 방지, 주체 검증, 파일 유무는 전이와 무관(D19), 반려 사유·되돌리기=직전 주체 1칸, eqHistory 누적), **MD 위임**(관계 보유 조직 수주 상위=자체 EQ 차단→blocked/delegatePoId, 하위 전이 시 상위 상태 미러, MD가 하위 RECEIVER를 fallback 대행 — byRole MASTER_DEALER), EQ 첨부(sp_file refType `sp_pcb_po_eq`, 업로드 대행·issued에서만 편집·프록시 다운로드).
- **라우트**: `admin-pcb-pos.ts`(횡단 워크큐 /admin/pcb-pos — 경유 상위 제외 실작업 단위, 발행/수정/삭제, eq-approve/reject/revert — **승인은 관리자만(D3)**, 첨부 열람) / `partner-pcb-pos.ts`(목록 수주·발주 양방향+myTurn, 상세, 스펙·EQ 파일 프록시, multipart 업로드, 전이 4종, MD 하위 발주). 메일 4종(발행/EQ요청→관리자/승인·반려→수주자/생산완료→발주 주체).
- **웹**: AdminPcbCase에 **발주 패널**(발행 모달=선정 회신 승계 프리필+조건, PO 표=EQ 승인/반려/승인취소/발주취소+첨부+MD 하위 블록) · `AdminPcbPos.vue` 워크큐(메뉴 '발주·EQ'+배지=EQ 승인 대기) · 포털 `PartnerPcbPoDetail.vue`(5단계 스텝퍼+EQ 선택/Working 권장 파일 업로드(잠금 규칙)+전이/되돌리기+MD 하위 발주+위임 안내·fallback 보조 스타일) · 홈 '진행할 PCB 발주' 카드.
- **검증**: **풀 E2E 44 ALL PASS**(실서버 — 결제 완료 실주문 스펙 Q20584: paid 게이트 409, 금액/환율 필수 400, 파일 없이 요청 409(**D19 이전 정책**, 현재는 허용), 요청 후 파일 잠금, 순서 위반 409, 반려(사유 이력)→재요청→승인→승인취소→재승인, 생산 완주, 워크큐, 이력 8이벤트, MD blocked→하위 발주→위임/미러/fallback(byRole 검증), 타 조직 404, **다단 revert로 원상복구 후 삭제**(HAS_CHILDREN 가드 포함), Mailpit 11통). vitest 635·`pnpm -r typecheck`·ESLint 신규분 0건.
- **P2 후속 소항목**: MD 포털의 하위 발주 취소 라우트(현재 관리자 발주만 삭제 가능 — E2E에서 확인된 공백), 발주서 첨부(비EQ 일반 첨부), EQ 잠금 해제 시 파일 교체 UX 개선, od 상태 자동 동기(D6 — P4 재검).

### P3 구현 기록 (2026-08-04 — 선적·배송·상업송장 완료)

§5.5 P3 범위 전부 구현·검증(묶음 발송·MD 입고·출고 게이팅·송장 생성기 포함).

- **스키마**: `SpPcbShipment`(sp_pcb_shipment — 대표 poId+모드/상태/받는측(receiverKind admin|md, receiverPartnerId)/destinationCountry **생성 시 박제**, carrier/tracking/shipDate/shippedAt/receivedAt(+note)/completedAt, `invoiceData` Json) + 조인 `SpPcbShipmentPo`(poId UK — 발주서는 한 발송에만). 마이그레이션 `20260804190000_add_pcb_shipment`.
- **계약**: `schemas/pcb-po.ts` 확장 — **상태·핑퐁 주체·라벨은 BOM 선적 코드사전(`bomShipmentNextStatus/PrevStatus/ActorOf/StatusLabel`, intl 6·domestic 3) 재사용**, PCB 고유 재해석은 receiverKind(BOM actor 'ADMIN'=받는측/'PARTNER'=보내는측 → PCB에선 받는측이 관리자 또는 MD). `PcbShipmentView`(TDZ 회피 위해 AdminPcbPoView 앞 배치), AdminPcbPoListResponse.data={pos,**shipments**}, PartnerPcbPoDetail+={shipment,shippableWith,canShip,outboundBlocked}, Advance/Receive 바디, PcbInvoiceResponse(BomInvoiceData 재사용), 관리자 워크큐(탭 pending/active/received/all).
- **lib `pcb-shipment.ts`**: 컨텍스트 해석(sender 국가=조직 country 필수, 받는측=직송이면 destination·MD 하위면 MD·기본 관리자 KR, **모드=국가 동일 여부로 생성 시 판정·박제**) · `ensurePcbShipment`(produced+게이팅 통과 시 첫 advance에서 생성) · **출고 게이팅**(비직송 하위 전부의 shipment.receivedAt 확인 전 상위 출고 409 — 레거시 규칙 서버 강제) · **advance**(다음 단계 주체 검증 — 관리자는 양측 만능 대행, 단계별 필수값: 선적요청=출고예정일+Invoice 첨부·배송중=택배사+송장·선적=트래킹, shippedAt/completedAt 박제) · **묶음**(withPoIds — 최초 발송 전이에서만, 같은 sender·produced·미소속·같은 받는측/목적지/회차 가드) · revert(직전 진입 주체만·**입고확인 후 RECEIVE_LOCKED**) · receive(받는측 전용·preparing 불가·note) · detach(preparing만·대표 불가) · 첨부(sp_file refType `sp_pcb_shipment`, invoice/airwaybill 종류별 1건 교체) · 상업송장(**BomInvoiceData·renderInvoiceXlsx 재사용** — 국제 전용, 프리필=sender 조직/자사 사업자정보(getBusinessInfo)/MD 수신, 품목=묶음 발주서별 스펙·수량·단가, invoiceData 저장) · 워크큐 집계(adminTurn=받는측 admin이고 다음 전이가 받는측이거나 최종·입고 미확인).
- **라우트**: partner(advance/revert/receive/membership DELETE/files multipart/invoice draft·save·xlsx — 전이 시 받는측 통지 메일, 수령 시 보내는측 통지) / admin(동일 세트 + `/admin/pcb-shipments` 워크큐, Case 패널 4곳 {pos,shipments} 동봉). 포털 목록 myTurn에 선적 차례(sender/MD 입고) 편입.
- **웹**: 포털 `PartnerPcbPoDetail.vue` **발송 카드**(canShip→[발송 준비 시작], BOM 라벨 스텝퍼, 같이 보내기 체크(shippableWith), 단계별 전이 폼(출고예정일/택배사+송장), 되돌리기/묶음에서 빼기, MD 받는측 전이+수령확인, 첨부 2종, **InvoiceEditorModal(BOM 컴포넌트) 콜백 주입**=`partnerPcbInvoiceApi`(xlsx·PDF 자동 첨부)) · `AdminPcbCase.vue` 발주 패널에 선적 서브행(배지·묶음·트래킹·입고 메모·관리자 대행 진행/입고확인/송장 모달/파일) + MD 하위 라인 선적 배지 · `AdminPcbShipments.vue` 워크큐(메뉴 '선적·배송'+배지=관리자 차례 발송 수).
- **검증**: **풀 E2E 65 ALL PASS**(실서버 Q20584+이관 paid 스펙 Q20583 — 국내 묶음: 빈 전이 409·preparing 생성·묶음 2건·핑퐁 revert·detach 규칙 3종·재묶음·주체 위반 409·수령 후 RECEIVE_LOCKED·국내 송장 409 / MD 체인: 하위 CN→MD CN=domestic 입고(받는측 md)·**출고 게이팅 409→하위 수령확인 후 해제**·MD CN→관리자 KR=international 완주(필수값 3종 409 포함)·송장 draft 프리필(CHINA→KOREA·USD)·저장·xlsx 8.3KB·첨부 교체 / 워크큐 pending·received 집계·adminTurn·파일 다운로드 양측·무관 조직 404 / Mailpit 26통 — 단계별 통지 실수신). vitest **635 passed**·`pnpm -r typecheck`·ESLint 0건.
- **발견 결함 교정(BOM 포함)**: invoice draft GET의 `?fresh=false`가 `z.coerce.boolean` 때문에 true로 coerce(문자열 'false' truthy)되어 **저장본이 항상 새 draft로 덮이는 결함** — PCB 2곳+기존 BOM 2곳(admin-bom-pos·partner-pos) 전부 enum→transform으로 교정.
- **E2E 재현 시드**: 하위 발주는 같은 스펙의 하위 회신 RFQ 필요 — `INSERT INTO sp_pcb_rfq (specId,partnerId,parentPartnerId,reorderRound,status,currency,priceOriginal,requestedAt,respondedAt,createdAt,updatedAt) VALUES (20584,10,9,0,'quoted','USD',1000,NOW(3),NOW(3),NOW(3),NOW(3))` 후 스크립트 인자로 전달, 종료 후 sp_pcb_shipment_po/sp_pcb_shipment/sp_pcb_po/sp_file(ref_type sp_pcb_po_eq·sp_pcb_shipment)·삽입 RFQ 삭제.
- **P3 후속 소항목**: 관리자 대행용 선적 파일 업로드 훅/UI(현재 다운로드만 — 대행 시 Invoice는 포털 몫), 관리자 Case의 같이 보내기 UI(포털에만 있음), 택배사 코드 사전·트래킹 URL 자동 생성(레거시 Shipment.types.ts 후보), A/S 재발주 회차(reorderRound>0)의 선적 UI 표기(P4).

### P3.5 구현 기록 (2026-08-04 — 레거시 편입·모듈 구조 완성)

배경: 이관 견적 20,537건 중 20,535건이 주문 연결(완료 19,442·취소 933·**진행 중 160**)인데 PCB 모듈에서 보이지도, 손대지도 못하는 상태였다(견적요청 워크큐=RFQ 행 보유 스펙만·Case 진입점 부재). 사용자 결정: SmartBOM과 같은 골격(각자 분리 구현)+레거시 견적·주문 이력 노출+미완료 건은 PCB 기능 사용 가능해야 함.

- **결정 추가**: **D9** 모듈 메뉴 = 진행현황(홈)/견적요청/**주문·결제(신설)**/발주·EQ/선적·배송 — SmartBOM 골격 미러, 구현은 PCB 전용(공유는 라이브러리 수준만, 파트너 별칭 공유안 철회). **D10** RFQ 게이트 완화 — 진행 중 주문(paid, 완료·취소 제외)은 **원가 소싱 모드**로 RFQ 허용(판매가=확정가는 불변 — PATCH 게이트 별도 유지, 미입금 `ORDER_NOT_PAID`·완료/취소 `ORDER_CLOSED` 차단). **D11** EQ·생산 **관리자 만능 대행**(선적과 동일 원칙) — advance/revert에서 admin이면 주체 검증 통과, 이력 `byRole: 'ADMIN'`으로 대행 기록, EQ 파일 대행 업로드/삭제 라우트(잠금 규칙 동일).
- **계약**: admin.ts — AdminQuoteListQuery.tab `preorder`(비담김+유령) + counts.preorder + ListItem `pcbRfq {total,quoted,selected}|null`(페이지 행 enrich, 회신 판정=respondedAt — unselected는 미회신 탈락 포함이라 status 판정 금지) + Detail `order {odId,odStatus,isPaid,수납액,주문금액,결제수단,주문일}|null`. 신규 `pcb-orders.ts` — 탭 awaiting/active/done/canceled/all + 라벨 사전 + 행(스펙+od+poCount).
- **서버**: `admin-pcb-projects` 목록 preorder 탭(유령은 `listGhostActiveSpecIds` id 합류 — cart 행 소실 케이스, 거버 주문 플로우 업로드 후 장바구니 삭제 시 발생)·상세 order/pcbRfq 동봉. 신규 `admin-pcb-orders.ts` + g5-db **한정 예외 ⑳ `listPcbOrderSpecs`** — sp_order_spec×g5_shop_cart×g5_shop_order **SQL 조인 서버 페이지네이션**(BOM D19 메모리 방식은 "월 수십 건" 전제라 2만 건에 사용 금지, 같은 DB라 조인 가능·read-only). counts=SUM(CASE) 1쿼리, 검색=프로젝트명/mbId/주문번호.
- **웹**: `AdminPcbCases.vue`(진행현황 — 모듈 홈, AdminQuoteList 계약 재사용, 탭 RFQ 가능/견적 대기/전체, RFQ 배지) · `AdminPcbOrders.vue`(주문·결제 — od 상태 배지·발주 대기 신호·배지=입금 대기 수) · `AdminPcbCase.vue` 보강(주문 정보 카드·**원가 소싱 모드 배너**·주문된 건 확정가 버튼 숨김·배정 버튼 게이트 사유 표시·**D11 대행 버튼 3종+EQ 파일 대행 업로드/삭제**·`?from=` 일반화 — cases/rfqs/orders/pos/shipments) · 코어 견적 관리 드로어에 "PCB Case 열기" 크로스 링크 · QuoteStatusTabs는 preorder 타입만 수용(코어 화면 미노출).
- **검증**: **E2E 34 ALL PASS**(실DB — preorder 2건·carted 20,535·주문결제 counts {0,160,19442,933} 실측 대조, 완료 탭 마지막 페이지(389p) 정합, 주문번호 검색, 완료 주문 배정 409 ORDER_CLOSED·진행 중 주문 배정 200·**확정가 PATCH 409 불변 확인**, D11 파일 없이 409→대행 업로드→요청/승인/생산 대행 완주→**이력 byRole ADMIN 4건**→만능 revert 원상복구). vitest 635·`pnpm -r typecheck`·ESLint 0건. 시드 원상(po 0·rfq 3행).
- **후속**: counts.preorder는 비담김만 집계(유령 포함 정확값은 preorder 탭 진입 시 total — 매 요청 g5 전수 대조 회피), A/S 재발주(P4)가 완료·취소 건의 재작업 경로, 주문·결제 워크큐에서 입금 확인 액션은 코어 주문 관리 링크로(현재 read-only 조감). **preorder·counts.preorder·listGhostActiveSpecIds 는 P3.6 에서 회수됐다**(→ /admin/pcb-cases).
- **주문 취소 후속(2026-08-09)**: 주문·결제 목록과 Case 주문 카드에 공용 취소 모달을 추가했다. 서버 미리보기는 카트행 범위(부분/전체)·수납·결제수단·RFQ/PO 수를 반환하고, 실행은 **미입금·수납 0·무통장·PO 0건**만 허용한다. 영카트 카트행 취소(재고·취소금액·미수금·세액·전량취소 헤더)를 재사용하되 주문 헤더 `FOR UPDATE` 잠금과 단일 트랜잭션으로 입금확인 레이스를 막는다. PG/입금 주문은 영카트 승인취소·환불 화면, PO 보유 건은 Case 선행 정리로 안내한다. 부분취소된 PCB 스펙은 주문 헤더 상태와 별개로 취소 탭에 집계하고 후속 RFQ·발주도 라인 상태로 차단한다. DB 마이그레이션 없음.
- **제작 사양 라벨 정합(08-04 추가)**: 상세 4화면(Case·포털 RFQ/PO·매직링크)이 specJson 원키를 그대로 노출하던 것을 **레거시 정본 명칭·순서**(sp-smartbom-web `types/pcbCart.ts` SPEC_ROWS = PHP `estimate_form_ca10.php` 원문 — '보광판'·'기준점표시' 등 표기 그대로)로 교체 — 공용 `lib/pcb-spec.ts`(`pcbSpecEntries`: PCB크기=width X length 합성, 미지 키 후미 보존). 코어 i18n specKeys 도 동일 정합 — **material=PCB선택(TG)·kindPcb=PCB재료(FR-4) 라벨이 뒤바뀌어 있던 결함 교정**(+패널/최소트랙공간/표면처리/임피던스제어/기준점표시/커팅 등 정정).

### P3.6 구현 기록 (2026-08-05 — 역할별 대기 큐·진행 단계 조감)

배경: "입금이 끝났는데 발주·EQ 메뉴에 그 건이 안 보인다"(사용자). 조사해 보니 **워크큐 5개 중 3개가 같은 병**이었다 — 견적요청은 `sp_pcb_rfq` 행, 발주·EQ는 `sp_pcb_po` 행, 선적·배송은 `sp_pcb_shipment` 행이 있어야만 모수에 들어와, 각 역할이 **아직 시작하지 않은 일**이 어느 화면에도 없었다(진행현황으로 되돌아가야만 진입 가능). SmartBOM 은 각 워크큐 첫 탭을 "대기"로 두어 이미 해결한 문제다(SMARTBOM_PARTNER_RFQ.md §6.12) — 같은 골격, 구현은 PCB 전용(D9).

- **결정 추가**: **D12** 대기 큐 원칙 + 이관분 제외(§6 표 아래).
- **계약**: 신설 `schemas/pcb-cases.ts` — 구간 탭(quoting/unpaid/production/closed/all) + 대기 탭(todo_rfq/todo_po), `PCB_STEPS` 12단계 라벨, `AdminPcbCaseItem`(스펙+od+RFQ·PO·선적 파생 + `step`·`isLegacy`). `pcb-po.ts` — `ADMIN_PCB_PO_TABS`에 **to_ship**(생산완료·발송 미편성) 추가 + `awaitingShipment` 필드 + counts 확장. **회수**: 코어 `AdminQuoteListQuery.tab` 의 PCB 전용 `preorder` 와 `counts.preorder`(→ pcb-cases 로 이관, 코어 계약에 PCB 개념을 남기지 않는다).
- **서버**: g5-db **`listPcbCaseSpecs`**(한정 예외 ⑳ 연장 — 스펙 축 **LEFT JOIN** 판이라 주문 전·유령까지 모수, counts 는 SUM(CASE) 1쿼리, 검색에 견적번호 정확일치 추가). 신설 `routes/admin-pcb-cases.ts` — 페이지 행만 RFQ·PO·선적으로 enrich 해 `step` 을 서버에서 계산(판정 원장이 전부 서버에 있으므로 FE 는 라벨만). `lib/pcb-po.ts` `loadAdminPcbPoWorkItems` 의 소속 탭을 **배열**로 전환(to_ship 은 produced 의 부분집합이라 배타적이지 않다) + 선적 배정 링크 1쿼리 선조회. `listGhostActiveSpecIds` 제거(유일 소비처였던 preorder 소멸 — 유령 판정은 LEFT JOIN 이 대신한다).
- **웹**: `PcbTodoQueue.vue` 신설(요청 대기·발주 대기 공용 큐 — 인라인 [견적요청 →]·[발주하기 →]) · `AdminPcbRfqs`/`AdminPcbPos`/`AdminPcbShipments` 첫 탭에 대기 큐 편입 · `AdminPcbCases.vue` 재작성(구간 탭 + **12단계 칩**·이관 배지, 기본 탭=발주·생산 — 완료 2만 건이 모수를 덮지 않게) · 배지 3종 합산 재정의(pcbRfqPending=요청 대기+선정 대기, **pcbPosPending**=발주 대기+EQ 승인 대기, pcbShipmentPending=발송 대기+관리자 차례) · **AdminLayout `CASE_FROM_MENU` 를 라우트별 2단 사전으로 교정**(SmartBOM 전용이라 PCB Case 는 어디서 들어와도 진행현황이 켜지던 결함 — 워크큐는 이미 `?from=` 을 넘기고 있었다) · `AdminPcbCase.vue` 에 §6.12 방식 **섹션 접힘**(rfqs→발주 접힘 / orders·pos·shipments→RFQ 접힘, 제작 사양은 발주·선적 때 확인이 잦아 접지 않음).
- **검증**: **E2E 47 ALL PASS**(실DB — 구간 counts {136,0,195,20607}·합=전체 20938 대조, todo {6,5} 대조 + **이관 포함 시 {330,195}** 로 제외 효과 확인, 대기 큐 행 불변식 4종(이관 0·RFQ 0건·발주 0건·결제 완료·완료/취소 아님), 단계 파생 6종, 마지막 페이지(1031p) 정합, 견적번호·주문번호 검색, to_ship counts·행 불변식, preorder 400 회수 확인). vitest 644+109·`pnpm -r typecheck`·ESLint 0건. 브라우저 실탐방으로 4화면·Case 진입(활성 메뉴·접힘) 확인.
- **흐름 실검(08-06)**: Q20984(주문 2026080522133120·입금)로 발주 대기 → **발주서 발행**(선정 RFQ 승계 ₩50,000·납기) → EQ/Working 대행 업로드 → EQ 요청·승인 → 생산 시작·완료 → **발송 대기 자동 편입** → 국내 발송(택배·송장) → 입고확인까지 완주. 당시 게이트 정상(파일 없이 EQ 요청 409 — **D19에서 폐기**, 순서 건너뛴 승인·생산 409은 유지), 이력 4건 전부 `byRole ADMIN`, 배지가 역할 간에 넘어감(발주·EQ 5→4 · 선적·배송 0→1→0), 진행현황 단계 7→8→10→11.
- **납기 하루 밀림 교정(08-06)**: 위 실검에서 발견 — §7-8 참조. 공용 `@sp/utils/kst-date`(`fmtKstDate`·`kstDateInput`·`kstToday`, 단위테스트 8) 신설 후 PCB 관리자 6화면·포털 2화면·매직링크·회신 폼과 **SmartBOM 동일 결함 11개 파일**을 일괄 교체. 서버는 원래 맞았으므로 스키마·API 무변경.
- **후속**: `loadAdminPcbPoWorkItems` 는 여전히 `sp_pcb_po` 전건 로드 + 행별 `resolveEqDelegation`(N+1) — PO 가 쌓이면 SQL 페이지네이션으로 옮겨야 한다(주문·결제·진행현황이 선례). 역할 권한(계정별 메뉴 제한)은 SmartBOM 과 동일하게 후속. 남은 `slice(0, 10)` 은 재능마켓·회원·파트너 목록의 생성일뿐이다(같은 −9h 이지만 업무 판정에 쓰이지 않아 후속). **`OrderFilterBar.toYmd` 는 결함이 아니다** — `kstMidnight()` 이 KST 날짜를 UTC 자정에 앵커해 두므로 UTC 게터·슬라이스가 전부 정합이다(2026-08-06 오인 → 재확인).

### P3.7 구현 기록 (2026-08-06 — 견적 영구 삭제의 협력 트랙 안전장치)

배경: "BOM 에 있는 삭제 기능을 PCB 에도"(사용자). 조사해 보니 PCB 에도 배치 삭제
(`/pcb-projects/delete-preview`·`/delete`)가 이미 있었지만 BOM 보다 한 세대 이전 설계였고,
협력 트랙이 생기면서 **세 군데가 새고 있었다**(전부 실측):
① 차단 판정이 `PAID_ORDER` 하나뿐이라 **발주서가 나가 생산 중인 건도 미입금이면 삭제**됐다.
② `purgeQuoteData` 가 `refType='sp_order_spec'` 만 지워 **EQ·선적 첨부가 파일서버에 영구 잔류**.
③ `SpPcbShipment` 만 spec 관계가 없어 **선적 행이 남아 선적 워크큐에 유령 행**으로 떴다.
그리고 조사 중 넷째가 나왔다 — ④ **고객 삭제 경로에 협력 가드가 전무**했다. RFQ 는 주문 전
스펙에도 보낼 수 있어(D10), 고객이 보관함 건을 한 번 더 지우면 협력사에 메일이 나간
견적요청이 통째로 cascade 로 사라졌다.

- **결정 추가**: **D13**(§6 표 아래) — 차단 확장·경고 레이어·감사 원장 공용화.
- **스키마**(마이그레이션 `20260806090000`): `sp_bom_case_delete_audit` → **`sp_delete_audit`**
  RENAME(기존 감사행 보존) + `subjectType`·`subjectId`·`subjectStatus` 중립화 · `sp_pcb_shipment.specId`
  에 **FK ON DELETE CASCADE** 신설(고아 선적 선정리 포함). ⚠ RENAME 은 구 코드가 옛 이름을
  참조하므로 **코드와 함께 배포**해야 한다.
- **계약**: `AdminDeleteBlockReason`(4종)·`AdminDeleteWarning`(4종) + 각 설명 사전 · 프리뷰 item 에
  `blockReasons`·`warnings`·`pcb{rfqs,pos,shipments,attachments}`·`isLegacy` · summary 에
  `blockReasons`·`warnings`·`forceableCount` · 신설 `AdminDeleteExecuteBody`(사유 필수 +
  `acknowledgeIrreversible` + `forceDeletePaidOrder`) · 결과 item 에 `blockReason`.
  ※ 사유 필수·`forceDeletePaidOrder`·`forceableCount` 는 **P3.9 에서 바뀌었다**(D14).
- **서버**: 신설 `lib/pcb-case-delete.ts` — `loadPcbTrackFacts`(배치 집계, N+1 회피)·`judgePcbCaseDelete`
  ·`remainingBlockers`. **프리뷰와 실행이 같은 함수로 판정**한다(둘이 갈라지지 않게 + 프리뷰를
  거치지 않은 직접 호출도 막게). 실행은 건별로 `sp_delete_audit`(subjectType='pcb_case') 에
  스냅샷·사유·행위자·IP 를 남긴 뒤 삭제한다(로그 warn 대체). `purgeQuoteData` 는 PCB 첨부
  (`sp_pcb_po_eq`·`sp_pcb_shipment`)를 실파일→DB 순서로 함께 정리 — 차단 덕에 API 경로로는
  도달하지 않는 **방어선**이라 단위테스트로 검증한다. 고객 라우트에 `PARTNER_TRACK_ACTIVE` 409.
- **웹**: `DeleteQuoteModal` 에 차단 사유별 안내·경고 레이어·협력 집계 배지(`협력 R/P/S`)·이관
  배지·**사유 입력·최종확인 체크**·결제 강제 해제 체크(있을 때만). 강제 체크를 켜면 "결제만
  걸린 건"이 삭제 대상으로 옮겨오는 계산까지 서버 규칙과 동일하게 미러.
  ※ 강제 체크의 범위는 **P3.9 에서 전체 차단으로 확대**됐다(D14).
- **검증**: **E2E 31 ALL PASS**(실DB 시드 3건 — 차단 판정·협력 집계·경고·바디 검증 400·강제
  체크로 발주 차단 우회 불가·감사행 기록·**고객 경로 409**·선적 FK cascade·차단 해제 후 삭제),
  단위 4(`quote-delete.test.ts` — 첨부 수집 순서·트랜잭션 포함·불필요 쿼리 없음·파일서버 실패 시
  DB 무변경). vitest 648+117 · typecheck · ESLint 0건.
- **후속**: BOM 삭제도 같은 감사 테이블을 쓰지만 차단·경고 세트는 트랙별로 다르다.
  (선적 삭제 경로 부재는 P3.8 에서 해소)

### P3.8 구현 기록 (2026-08-06 — 선적 취소·회차 표시·두 축 신호)

D13 의 `SHIPMENT_EXISTS` 차단에는 **출구가 없었다** — 협력사 detach 는 대표 발주서를 뺄 수
없어(REPRESENTATIVE_PO) 잘못 만든 선적을 없앨 방법이 아예 없었다. 그러면 그 견적은 영원히
삭제 불가다. 그 출구를 만들고, 앞서 미뤄둔 화면 보강 두 가지를 함께 넣었다.

- **선적 취소**: `cancelPcbShipment` + `DELETE /admin/pcb-projects/:id/pos/:poId/shipment`.
  위계는 발주 취소(`deletePcbPo`: issued 만)와 같다 — **preparing·입고 전**만 허용하고 그 이후는
  되돌리기로 내려온 뒤 취소한다. 묶음이면 통째로 사라지고, 첨부는 파일서버 먼저 → DB 순서.
  관리자 전용(협력사는 detach 로 충분). Case 상세 선적 행에 [선적 취소] 버튼(묶음 수 경고 포함).
- **회차 표시**: 발주·RFQ 패널 행에 `n차` 배지 + **이전 회차 접힘 바**(워크큐엔 배지가 있는데
  상세엔 없어, A/S 회차가 쌓이면 "지나간 발주"와 "지금 발주"가 한 표에서 구분되지 않았다).
  지금은 전부 0차라 보이지 않는 준비 작업 — P4 가 그대로 얹힌다.
- **두 축 불일치 신호**: 주문 축(od_status)과 협력 축은 서로를 게이트하지 않아 **발주 없이
  배송**(Q40 실측 — 결제도 0원)되거나 **입고 완료인데 주문은 입금**(Q20984 실측)인 상태가 생긴다.
  이관 주문 19,665건이 협력 기록 없이 '완료'라 게이트는 걸 수 없다 — 대신 Case 상세 헤더에
  `협력 발주 없이 진행된 주문`·`배송 처리 대기` 배지로 **보이게만** 한다(자동 동기는 D6/P4).
  (`배송 처리 대기` 는 P4.6 에서 배송 처리 버튼·워크큐 대기 큐로 승격됐다.)
- **서버측 KST 날짜 교정**: §7-8 의 클라이언트 일괄 교정 때 서버가 빠져 있었다 — 발주서 메일·
  MD 하위 발주 메일·RFQ 회신 메일(포털·매직링크)의 **납기가 하루 일찍** 나가고, PCB 상업송장
  `invoiceDate`·BOM 거래문서 납기도 같았다. 전부 `kstDateStr` 로 교체. 덤으로 `pointExpireDate`
  (g5 DATE 컬럼 → mysql2 로컬 Date → UTC 슬라이스)도 하루 당겨지던 것을 교정.
- **삭제 진입점(08-06 추가)**: 삭제는 원래 **통합 관리 → 견적 관리**에만 있었다(목록 체크박스
  → [선택 삭제], 상세 드로어 → [완전삭제]). 차단을 푸는 곳(발주 취소·선적 취소)이 PCB Case
  상세라 모듈을 오가야 했으므로 PCB 모듈 안에도 창구를 냈다 — **Case 상세 헤더 [견적 삭제]**
  (단건) · **진행현황 목록**(배치) · **견적요청 목록**(RFQ 축 표 + 요청 대기 큐, 배치).
  대기 큐 컴포넌트를 공유하므로 발주·EQ 의 발주 대기에서도 같은 선택 삭제가 뜬다.
  창구는 여럿, **판정·모달은 하나**다. 상세에서 삭제하면 진입 워크큐(`?from=`)로 되돌리고,
  목록은 선택을 비운다. 선택 규칙은 공용 `useRowSelection`(현재 페이지 범위만 전체선택 ·
  탭·검색·페이지 이동 시 해제)·툴바는 공용 `PcbSelectionBar` 로 한 곳에 모았다.
  **툴바 형태도 SmartBOM 진행현황과 동일**하다 — 선택이 없어도 항상 보이는 중립색(gray-50)
  안내 줄("현재 페이지에서 견적을 체크해 함께 삭제할 수 있습니다" + N건 선택)에 outline
  danger 버튼("선택 N건 영구 삭제", 0건이면 disabled) 하나. 선택해야 나타나는 붉은 툴바는
  기능의 존재 자체가 숨겨져서 쓰지 않는다. '선택 해제'는 헤더 체크박스가 대신한다.
- **삭제 모달 디자인 통일(08-06)**: 단층 모달이던 것을 **SmartBOM Case 삭제와 같은 3단 위험
  레이어**로 맞췄다(사용자 결정) — ① 1차(연빨강 헤더) = 통계 4칸(선택·삭제 가능·결제 강제
  가능·보호됨 — **P3.9 에서 3칸으로**) + 합산 영향 4칸 + **건별 카드**(상태 배지·이관 태그·차단
  사유 전부) + 주문 그룹 경고 + ⚠ 경고 목록, ② 2차(진빨강 헤더) = 강제 해제 체크 · 사유 ·
  복구 불가 확인,
  ③ 결과 = 삭제·차단·실패 보고. 되돌릴 수 없는 배치 작업이라 "보고 나서 한 번 더 결심"하는
  층을 두는 것이 요지다. SmartBOM 모달은 한국어 리터럴이지만 이 모달은 원래 i18n 이라
  ko/en 키를 확장해 유지한다(견적 관리와 공유하므로 로케일을 깨면 안 된다).
  또한 모달이 **대표 차단 사유 하나만** 보여 "강제 삭제하면 되겠네"로 오해할 여지가 있었다
  (결제·발주·선적이 동시에 걸린 건이 실재) — 사유를 항목별로 전부 나열하도록 교정.
  ⚠ **병행 세션 충돌 기록**: 같은 시간대 다른 세션이 이 모달을 3단으로 이미 구현해 커밋
  (`e1a077860`)했는데, 이 세션이 파일을 통째로 덮어써(2단·한국어 하드코딩) 그 작업과 ko/en
  키 33개가 사라졌다. 되돌려 그쪽 구현을 정본으로 삼았다 — i18n 유지·결과 레이어·건별 상태
  배지가 더 낫다. 같은 파일을 두 세션이 동시에 만질 때는 `Write` 전면 교체를 피할 것.
- **검증**: E2E 15(선적 취소 — 발송 후 409·입고 후 409·묶음 통째·첨부 정리·발주 보존·재취소
  409·**SHIPMENT_EXISTS 해소 후 삭제 완주**) + 기존 삭제 E2E 31 재통과. vitest 648+117 ·
  typecheck · ESLint 0건. 브라우저 실탐방으로 견적 관리·Case 상세 두 진입점 확인.

### P3.9 구현 기록 (2026-08-06 — 관리자 재량 삭제: 차단 전면 해제·무기록·사유 선택)

**D14 의 구현.** P3.7 이 세운 "우회는 결제 하나뿐" 위계를 사용자 지시로 걷어냈다. 안전장치를
없앤 게 아니라 **판정에서 고지로 옮겼다** — 서버는 여전히 전부 판정하고, 화면은 그 대가를
건별로 끝까지 보여주며, 넘긴 사실은 감사 스냅샷에 남는다.

- **계약**: `AdminDeleteExecuteBody` = `mode`(`audited`|`reset`, 기본 audited) · `reason` **optional**
  · `acknowledgeIrreversible`(유지) · `forceDeletePaidOrder` → **`forceDeleteAll`**. 프리뷰 summary 의
  `forceableCount`·`totalFileCount` 제거(전자는 `blockedCount` 와 동의어가 됐고 후자는 미사용).
  `ADMIN_DELETE_BLOCK_TEXT` 4종을 "먼저 정리해 주세요" 에서 "강제 삭제하면 무엇이 사라지는지"
  로 다시 썼다 — 이제 막는 문장이 아니라 값을 매기는 문장이다.
- **서버**: `remainingBlockers(reasons, forceAll)` = 체크 시 빈 배열. 감사행은 `mode!=='reset'` 일
  때만 쓰고 스냅샷에 `forceDeleteAll`·**`overriddenBlockers`**(무엇을 넘겼는지) 추가.
  `reset` 은 `deleteUnpaidOrder({retainBackup:false})` 로 주문 백업까지 생략한다.
- **⚠ 코어 삭제 SQL 수술** — 기존 강제는 **이름만 강제였다**(D14 참조). `deleteExclusiveOrder` 를
  **`purgeOrderRows`** 로 일반화: 대상 cart 를 배열로 다루고(재고 환원·물리삭제·`it_sum_qty`
  재계산을 행별 루프), `exclusiveCart=null` + 옵션 `deleteAllCarts` 면 주문의 모든 cart 를 지운다.
  `deleteUnpaidOrder` 는 `deleteAllCarts` 를 보면 이 경로로 분기한다. 강제가 아니면 종전대로
  코어와 같은 소프트 경로(백업 + `ct_status='삭제'`)를 탄다.
- **웹**: 통계 4칸 → **3칸**(선택·바로 삭제·강제 필요) — '보호됨' 칸은 개념이 사라졌다.
  배지도 2종. 2차 레이어에 체크 **둘**: 강제 해제(걸린 차단 사유를 그 자리에 전부 나열,
  `SHARED_ORDER` 가 있으면 **"선택하지 않은 다른 견적의 주문까지 삭제된다"** 를 붉은 띠로 따로
  고지) · 감사 미기록(켜면 사유 입력칸이 사라진다 — 남길 곳이 없으니). 1차 합산 영향은
  **선택분 전체** 기준으로 센다(삭제 가능분만 세면 "강제하면 더 사라지는 것"이 감춰진다).
  결과 레이어 문구도 모드에 따라 갈린다.
- **고객 경로 불변**: `PARTNER_TRACK_ACTIVE` 409 유지.
- **검증**: **E2E 32 ALL PASS**(사유 없이 삭제·감사행 `reason=''` · reset 무기록 · PO+선적 차단
  유지 · 같은 건 강제 삭제 후 **RFQ·PO·선적 cascade 0** + 감사 `overriddenBlockers` 2종 ·
  **결제 주문 강제 시 `g5_shop_order`·`g5_shop_cart` 물리삭제 + 백업 1건** · `SHARED_ORDER` 강제 시
  **형제 cart 행까지 삭제** + reset 이면 백업 0 · `acknowledgeIrreversible` 누락 400).
  vitest 650+117 · typecheck · ESLint 0건.

### P3.10 구현 기록 (2026-08-06 — 송금일 선택 + 발주 조건 수정 창구)

**요청**: 발주에 송금 날짜를 고를 수 있게. **판단**: 체크박스를 없애고 날짜 하나로 바꾼다.

- **날짜가 곧 송금 여부다** — `remitted: boolean` 계약을 폐기하고 **`remittedOn`**(YYYY-MM-DD, nullable)
  으로 교체했다. DB(`sp_pcb_po.remittedAt DateTime?`)는 처음부터 날짜 하나였고 체크박스는 그
  위에 덧씌운 UI였다. 체크 순간을 `new Date()` 로 박제하던 방식은 **송금일이 아니라 입력일**을
  남겼다 — 경리가 며칠 뒤 정리하면 그대로 틀어진다. 상태 필드를 따로 두면 "체크했는데 날짜
  없음" 같은 모순이 생기므로, null=미송금 / 값=송금완료 하나로 유지한다. 편의는 [오늘]·[지움]
  버튼이 대신한다. 마이그레이션 없음(컬럼 그대로, 실데이터 송금 기록 0건).
- **⚠ 그것만으로는 쓸 수 없었다** — 발행 모달에만 입력칸이 있었고 **발주 조건 수정 UI가 아예
  없었다**(`usePatchPcbPo` 훅은 만들어 두고 어디서도 호출하지 않는 죽은 코드였다). 송금은 대개
  발주 *다음*에 일어나므로, 실제 송금일을 남기려면 발주서를 지우고 다시 내는 수밖에 없었다
  (그마저 EQ 가 진행되면 막힌다). → 발주서 행에 **[조건 수정]** 을 붙이고 결제조건·송금일·
  납기·메모를 고치는 모달을 신설했다. 금액·환율은 서버가 `issued` 상태로만 허용하는 별도
  규칙(`PRICE_LOCKED`)이라 이 모달에서 다루지 않는다.
- **KST 규율**(§7-8): 저장 `parseKstDate` · 프리필 `kstDateInput` · 표시 `fmtKstDate`.
  `deliveryDate` 와 같은 앵커(KST 자정 = UTC 전날 15:00)를 쓴다. 검증은 두지 않는다 —
  미래일(예정 기록)도 발주일 이전(선불 송금)도 실무에서 정상이다.
- **표시**: 발주서 표의 `조건/송금` 칸이 `송금완료` 배지에서 **`송금 YYYY-MM-DD`** 로,
  미송금은 `송금 전`으로. 협력사 포털은 이미 `완료 (날짜)` 형태라 그대로 맞다.
- **검증**: **E2E 20 ALL PASS**(발행 시 없이·발행 후 기록·**KST 왕복 3회 무손실**·미래일·
  발주일 이전·null 되돌리기·undefined 보존·형식 400·**구 boolean 계약 400**·발행 시 동시 입력).
  vitest 650+117 · typecheck · ESLint 0건. 브라우저 실탐방(Q20984)으로 [조건 수정] → [오늘] →
  저장 → `송금 2026-08-06` 표시 → [지움] 원복까지 확인.

### P3.11 구현 기록 (2026-08-06 — 송금 원장·워크큐·협력사별 잔액)

**D15 의 구현.** "송금 이력 관리 + 파트너사별 송금 여부 확인" 요청(사용자)에서 출발했다.

- **원장 신설** — `sp_pcb_remittance`(발주서 1:N). 날짜·금액·통화·환율·메모·기록자·증빙.
  마이그레이션 `20260806140000`, 기존 `remittedAt` 값은 '발주가 전액 1회'로 승계(종전의
  암묵 가정 그대로). `sp_pcb_po.remittedAt` 은 **파생 캐시로 강등**(마지막 송금일) —
  `syncPoRemittedAt` 이 원장 변경마다 갱신하며 직접 쓰지 않는다.
- **입력 경로 일원화** — P3.10 이 발주 바디에 넣었던 `remittedOn` 을 **회수**했다(발행
  모달·조건 수정 모달에서도 제거). 두 경로를 두면 금액 없는 기록이 다시 생긴다.
  송금은 오직 `/pcb-remittances` 로만 들어온다.
- **계산 단일화** — `summarizePcbRemittances()` 하나가 목록·상세·협력사 집계·협력사 포털의
  잔액을 만든다. 상태는 `unpaid|partial|paid|over` 4종이며 **과지급(over)** 을 감춘 채
  paid 로 뭉개지 않는다(실수 송금이 눈에 띄어야 한다).
- **메뉴 신설** — 사이드바 `발주·EQ` 다음·`선적·배송` 앞에 **[송금]**. 흐름 순서(발주 →
  송금 → 선적)이자 역할(경리·재무) 분리다. 첫 탭 = 송금 대기, 배지 = 그 수(D12 그대로).
  `협력사별` 탭이 사용자가 요청한 조감 — 협력사×통화별 발주·송금·잔액 한 줄, 행을 누르면
  그 협력사 발주로 드릴다운.
- **통화는 뭉치지 않는다** — 협력사마다 KRW/USD/CNY 가 섞이므로 집계를 통화별로 나눠 내고
  KRW 환산은 참고 총계로만 병기한다(발주서 `krwAmount` 회계 박제 기준). 송금 건의
  `exchangeRate` 는 **송금 시점 실제 환율** — 발주 환율로 뭉개면 환차손익이 사라진다.
- **협력사 포털 노출**(사용자 결정) — 발주서 상세에 자기 건의 수금 내역(날짜·금액·메모)과
  미수금. 상태 표시를 `완료/대기` 2값에서 `입금 전 / 부분 입금 — 미수 N / 완료(날짜)` 로
  넓혔다. **증빙 파일은 내부 자료라 포털에 싣지 않는다.**
- **⚠ 그것만으로는 협력사가 볼 수 없었다**(사용자 지적 2026-08-06, 같은 날 보강) — 포털
  홈은 `myTurn`(협력사 차례)인 PCB 발주만 띄우므로 **생산완료·마감된 발주서는 홈에 뜨지
  않는다**. 즉 수금 내역을 넣어 둔 발주서 상세로 **가는 길 자체가 없었다**(URL 직입력 외).
  → 협력사 전용 **[수금 현황]** 화면(`/partner/remittances`)과 포털 홈 요약 카드를 신설.
  통화별 미수금 총계 + 발주서별 입금/미수 + 행 펼침(입금 건별) + '미수금 있는 건만' 필터.
  API `GET /api/partner/pcb-remittances` 는 **내 조직이 수주한 발주서만** 센다(MD 가 하위에
  지급하는 돈은 성격이 다르고 기록 창구도 관리자 쪽이다). **교훈: 데이터를 넣은 것과 그
  화면에 도달할 수 있는 것은 다른 문제다** — 목록·홈에 진입점이 없으면 구현은 없는 것과 같다.
- **증빙** — `sp_file` refType `sp_pcb_remittance`(EQ 첨부와 같은 규약), 삭제는 실파일 먼저.
- **공용화하지 않은 이유** — 송금은 **살아있는 발주서**에 붙어 잔액을 계산하므로 FK 무결성이
  필요하다. `sp_delete_audit` 이 FK 없이 `subjectType` 규약을 쓴 건 대상이 이미 삭제된 뒤를
  가리키기 때문이고 성격이 다르다. BOM 트랙엔 아직 송금 개념 자체가 없다.
- **검증**: **E2E 38 ALL PASS**(송금 전 잔액=발주가 · 부분 송금 · **KST 앵커** · remittedAt
  파생 동기 · 잔금→paid · **과지급 감지·삭제 복귀** · 금액 수정 시 잔액 추종 · 탭 분류·counts·
  검색 · 협력사별 통화 집계 · **협력사 포털 노출 + 증빙 비노출** · 발주 바디로는 송금 불가 ·
  발주 삭제 시 원장 cascade). vitest 650+117 · typecheck · ESLint 0건.
  브라우저 실탐방(Q20984): 메뉴·배지·탭 카운트·부분 송금 기록(₩20,000/₩50,000 → 잔액
  ₩30,000, '부분 송금' 배지)·삭제 원복까지 확인.
- **남은 것**: 통화별 KRW 환산이 발주서 `krwAmount` 비례배분이라 MD 하위 발주(krwAmount
  null)는 환산 총계에서 빠진다 — 통화별 값이 정본이므로 실무엔 지장 없으나, 회계 리포트를
  낼 때는 송금 건의 `krwAmount` 합으로 다시 세는 편이 정확하다.
  → **해소(2026-08-11, 여정 8호 재점검 #8)**: 협력사별 집계의 **지급액은 원장 `krwAmount`
  실합**으로 바꿨다(`krwPaidAmount`). 잔액 환산(`krwBalance`)만 발주 회계 환율 기준으로
  남아 두 기준이 나뉘므로 `krwPoAmount ≠ krwPaidAmount + krwBalance` 가 **정상**이고 그
  차이가 환차다 — 화면 캡션이 그렇게 말한다. 환율 미기입 송금이 섞이면 실합에서 빠지므로
  `krwPaidRateMissing` 플래그로 캡션에 밝힌다. 발주서 상세(패널)에도 `원장 실지급 ₩x
  (환차 ±₩y)` 한 줄을 뒀다.

### P3.11 보강 (2026-08-11 — 여정 8호 재점검 확정 16건)

관찰 러너(`e2e/output/obs-j8-money.mts`)로 부분 송금·환율 누락·무상 회차 상태를 화면에
세워 두고 점검한 결과. 돈 축의 결함은 **금액이 화면에서 사라지거나(무상 회차 프리필,
비례배분 환산) 구분이 사라지는(부분/완납 같은 배지) 형태**로 나타난다는 것이 요지다.

- **무상 A/S 상세도 목록과 같은 판정을 한다** — `GET /pcb-remittances/:poId` 에 `isFreeAs`
  를 실어 잔액을 0 으로 눕힌다. 상세만 전액을 주던 탓에 패널이 무상 회차에 $300 을
  프리필했다(안 줘도 될 돈을 한 번에 보낼 뻔한 자리). 화면은 프리필 금지 + 배너 +
  [기록] 기본 잠금(명시 해제 시에만 활성).
- **삭제에 확인 대화(P4.11 규율)** — 송금 행 삭제는 잔액을 되돌리고 증빙 실파일까지
  지운다. `confirmDialog(tone:danger)` 로 동반 삭제 건수를 문장에 넣어 묻는다(증빙 개별
  삭제도 같다).
- **부분/완납 구분** — Case 발주 행의 초록 `송금 {날짜}` 배지를 `송금 $150/$500 · 잔액 $350`
  으로 바꿨다(`AdminPcbPoView.remittance` 신설). 날짜만으론 반쯤 나간 돈이 다 준 것으로 읽혔다.
- **집계 어휘 정정** — `미송금 발주`(status=unpaid)는 이름과 달리 '한 푼도 안 나간 건'만
  세어 잔액이 남았는데도 0 으로 보였다. `미착수 발주`로 고치고 `잔여 발주`(잔액>0,
  `openPoCount`)를 나란히 낸다.
- **회차 표기 전면화** — 워크큐·협력사 포털 목록에 `reorderRound` 배지(Case·파트너 홈과
  같은 표기). 같은 프로젝트가 두 줄로 서면 유상 회차는 구분할 방법이 없었다.
- 그 밖: 목록 통화별 소계(조건 전체 모수·무상 제외)·결제조건/발주일(D+n) 열·`Q21145`
  검색 허용(`^[Qq]?\d+$`)·드릴다운 시 검색어 동기 초기화·과지급 사전 확인·환율 미기입
  배지와 저장 전 경고·수정 폼 환율 칸(계약은 처음부터 받고 있었다)·`@1400 선정 시점`/
  `@1380 발주 시점` 꼬리표(같은 외화가 두 KRW 로 뜨는 이유)·포털 총계의 무상 제외 문구.
- **협력사 통지는 화면으로** — 홈 미수금 카드(R1 포털 분리 때 유실된 것을 복원)와 셸
  [수금 현황] 배지(`unpaidCount`). 송금 기록마다 메일을 보내지 않는 이유는 기록이
  정정·삭제되는 원장이고 분할 송금마다 발송되면 알림이 사실보다 앞서기 때문이다 —
  통지가 필요해지면 '잔액 0 달성' 1회를 `sp_mail_log` 래퍼로 보내는 편이 맞다(미구현).
- **메모는 협력사에게 보인다** — D15 ⑤·P3.11 이 이미 '날짜·금액·메모' 공개를 명시하므로
  계약은 그대로 두고, 관리자 입력칸에 "협력사에게 보입니다" 고지만 붙였다.
- **회귀 가드**(여정 8호): 무상 회차 상세 `balance=0·isFreeAs` · Case 발주 표 협력사 열
  폭>0(`measurePoRowPartnerWidths` — 견적관리 가드의 미러) · `잔여 발주` 수와 통화별
  `balance>0` 의 관계 · 원장 실지급 델타(=₩412,500) ≠ 발주 회계(₩414,000).

### P3.11 후속 (2026-08-12 — 송금 환율 자동 적용·누락 차단)

- **PCB 선정 패턴 재사용** — 외화 송금 입력을 열면 공용 `GET /admin/pcb-exchange-rate`
  (수출입은행 TTS 캐시)로 당일 USD/CNY→KRW 환율과 고시일을 자동 채운다. 늦은 응답은
  관리자가 이미 고친 값을 덮지 않고, 자동값은 실제 은행 적용값으로 수정할 수 있다.
- **날짜 안전 규칙** — 자동값은 `remittedOn=오늘(KST)`에만 쓴다. 과거·미래 송금일에
  최신 캐시를 붙이면 '송금 시점 실제 환율'이 거짓이 되므로 화면·서버 모두 명시 입력을
  요구한다. 화면은 `금액×환율` 예상 KRW도 저장 전에 보여준다.
- **서버 보증** — 외화 신규 송금에서 환율 생략 시 서버도 `getPcbExchangeRate(ccy,'KRW')`로
  당일값을 박제한다. 캐시 미준비 또는 오늘이 아닌 날짜면 400 `EXCHANGE_RATE_REQUIRED`.
  따라서 UI 외 호출도 `krwAmount=null` 신규 행을 만들 수 없다. 수정도 금액·환율을 건드릴
  때 환율 없는 상태를 허용하지 않는다.
- **레거시 가시성 유지** — 이미 존재하는 환율 미기입 행의 배지·집계 누락 경고는 남겨
  과거 데이터 문제를 감추지 않는다. 수정 화면에서 환율을 채우면 정상 KRW 박제로 치유된다.
- **회귀 가드 갱신** — 여정 8호 M7은 과거일 환율 생략 400과 오늘 생략 시 공용 TTS 자동
  박제(`exchangeRate`·`krwAmount`)를 함께 검증한다.

### P4.1 구현 기록 (2026-08-07 — EQ 고객 확인: 관리자 요청 → 주문내역 승인)

**D16 의 구현.** sp-php(그누보드)를 처음으로 쓰기 경로에 넣은 작업이다.

- **스키마**: `sp_pcb_eq_review`(마이그레이션 `20260807090000`) — 발주서 1:N, `specId` 비정규화
  (고객 화면이 주문→cart→spec 으로 들어오므로), `sharedFileIds` Json, 상태 4종
  `requested|approved|rejected|canceled`. 발주서 FK cascade.
- **서버**: `lib/pcb-eq-review.ts` + 관리자·고객 라우트 2개.
  - 요청 생성은 `eq_requested` 상태에서만, **열린 요청이 있으면 409**(고객이 어느 것에
    답할지 헷갈리지 않게). 공개 파일은 **이 발주서의 EQ 첨부인지 서버가 검증**한다.
  - 고객 결정은 원장 상태만 바꾸고 **발주서 status 를 건드리지 않는다**(E2E 로 못 박음).
  - 파일 다운로드는 `sharedFileIds` 에 있는 것만 — 없으면 404.
  - 결정이 오면 관리자에게 메일(놓치면 생산이 멈춘다).
- **메일**: `buildPcbEqCustomerRequestEmail` — 확인 문구 + 기한 + **[주문내역에서 확인하기]**
  버튼 하나. 버튼 아래에 "이 버튼은 화면을 열 뿐이며 누르는 것만으로는 승인되지 않습니다"
  를 명시한다. 협력사명·발주서 정보는 넣지 않는다.
- **관리자 웹**: Case 상세 발주서 행에 **[고객 확인]**(eq_requested 일 때만) → 패널에서
  문구 작성·기한·**공개 파일 체크 선택**·발송. 열린 요청은 취소 가능하고 지난 이력이
  회차별로 쌓인다. 기한 초과 건은 붉은 배지("재촉 필요").
- **sp-php**: 테마 `theme/sp-lite/shop/orderinquiryview.php` 에 섹션 신설(코어 비수정).
  - `extend/sp_pcb_eq.extend.php` — 세션 → `spcb_jwt_encode()` 단기 JWT(2분) → sp-node 호출.
    **PHP 는 sp_ 테이블에 쓰지 않는다**(권한·상태·회차 판정을 두 곳에 복제하면 어긋난다).
  - `spcb/api/eq-decide.php` — **POST 전용** + 그누보드 `check_token()` CSRF. GET 으로는
    아무 일도 하지 않는다(D16 ②).
  - `spcb/api/eq-file.php` — 첨부 다운로드 브리지(브라우저가 Bearer 를 못 붙이므로).
  - 승인/반려 전 확인 한 번 더, 반려는 사유 필수(클라이언트+서버 양쪽).
- **공용 커스텀 팝업 신설**(`theme/sp-lite/js/sp-dialog.js` + `default.css`) — 네이티브
  `alert`/`confirm` 을 대체한다. 코어 `alert()` 은 `bbs/alert.php` 로 **페이지를 통째로
  갈아치운 뒤** 시스템 팝업을 띄우고 되돌아온다(빈 화면 → 팝업 → 뒤로가기). 의존성 없는
  Promise API(`spDialog.alert/confirm`)라 기존 `confirm()` 자리를 그대로 대체하며, 접근성
  (role=alertdialog·ESC·포커스 트랙·복귀)과 XSS 안전(textContent)까지 갖춘다. confirm 은
  **취소에 먼저 초점**을 둔다(엔터 연타로 확정되는 사고 방지).
  - 서버 결과 안내는 `alert()` 대신 **원래 화면으로 리다이렉트 + `?sp_msg=&sp_tone=`** 이고
    sp-dialog 가 로드 직후 모달로 띄운 뒤 `replaceState` 로 주소에서 지운다(새로고침·
    뒤로가기에서 재발 방지). PHP 에서 모달을 띄울 수 없는 구조적 한계를 이렇게 우회한다.
  - `check_token()` 은 실패 시 **자체 alert 을 띄우고 끝나** 커스텀 팝업으로 감쌀 수 없어,
    검증 로직만 같게 복제한 `sp_pcb_check_token()`(extend)을 쓴다. 코어가 바뀌면 동기화 필요.
- **⚠ 함정(2026-08-07 실측)**: `get_token()` 은 hidden 태그가 아니라 **토큰 문자열만 반환**한다.
  `<?php echo get_token(); ?>` 로 쓰면 토큰이 화면에 그대로 찍히고, 더 나쁘게는 폼에
  `name="token"` 필드가 없어 **제출이 전부 막힌다**(기능이 아예 동작하지 않는다).
  올바른 형태는 `<input type="hidden" name="token" value="<?php echo get_token(); ?>">`.
  - CSS 는 `default_shop.css` 에 `#sod_fin` 스코프로. **`G5_CSS_VER` 를 26080701 로 올렸다**
    (안 올리면 옛 CSS 가 캐시돼 "적용 안 됨"으로 보인다 — §7 함정).
- **검증**: **E2E 26 ALL PASS**(요청 전 0건 · 파일 선택 공개 · **중복 발송 409** · **남의 파일
  400** · 고객 조회 시 협력사·발주서 정보 없음 · **남의 주문 0건** · 반려 사유 필수 400 ·
  **남이 결정 시 404** · 고객 승인 후 **발주 상태 eq_requested 불변** · 재결정 409 ·
  관리자 화면에 의견·결정자 반영 · 재요청으로 회차 누적 · **비공개 파일 404** · cascade).
  vitest 657+117 · typecheck · ESLint 0건.
- **남은 것**: ① 고객 무응답(기한 초과) 건이 지금은 Case 상세에서만 보인다 — 발주·EQ 워크큐
  탭이나 배지로 올리면 재촉을 놓치지 않는다(P4.8 에서 해소). ② 고객 반려 사유를 협력사에 전달하는 것은
  아직 관리자 수동(반려 시 그 문구를 EQ 반려 사유에 옮겨 적는다). ③ 브라우저 실탐방 미실시
  (회원 계정 로그인이 필요) — 실제 주문 건으로 한 번 확인이 필요하다.

### P4.2 구현 기록 (2026-08-07 — 관리자 제작 사양 수정)

**D17 의 구현.** 새 경로를 만들지 않고 **고객 재견적(`PATCH /api/pcb-projects/:id`)의 골격을
관리자용으로 미러**했다 — 같은 문제를 두 번 풀지 않기 위해서다.

- **스키마**: `sp_quote.revisedBy`·`revisedReason`(마이그레이션 `20260807140000`). 견적 체인이
  이미 "언제 무엇이"를 담으므로 새 원장을 만들지 않는다. 기존 행은 NULL = 고객이 만든 견적.
- **계약**: `AdminSpecReviseBody`(spec 전체 + qty? + **reason 선택** — 삭제 사유와 같은 규칙,
  비우면 `revisedReason` 이 null 이 된다. 빈 문자열로 남기면 "적었는데 비었다"와 "안 적었다"가
  구분되지 않는다) · `AdminSpecReviseResponse`
  (새 quoteId · autoPrice/previousAutoPrice · **finalPriceStale** · **answeredRfqCount** ·
  changedKeys) · `ADMIN_SPEC_REVISE_BLOCK_TEXT` 2종.
- **서버**: `PATCH /api/admin/pcb-projects/:id/spec`. 발주 존재 시 409, 담긴 견적을 rfq 사양으로
  바꾸면 409. 트랜잭션에서 새 견적 발급 + `spec.specJson`·`quoteId`·`qty`·`quoteStatus` 갱신,
  담김이면 옵션 행 등록 → cart UPDATE → 옛 옵션 삭제(고객 재견적과 같은 순서·같은 이유).
  ⚠ `changedKeys` 비교는 **스칼라만** — 이관 레코드의 `_legacy` 는 객체라 `String()` 이
  `'[object Object]'` 가 되어 늘 "바뀐 것"으로 잡힌다(lint 가 먼저 잡아준 함정).
- **웹**: `PcbSpecEditModal` — 전 필드 텍스트 입력(사양 값은 자유 텍스트 스키마라 드롭다운
  사전이 없다) + 사전에 없는 확장 키도 실어 보낸다(조용히 버리면 사양 손실) + **변경 요약**
  (전/후, 거버 파생 배지) + 저장 후 결과(가격 전/후·확정가 낡음·협력사 재확인).
  ⚠ Vue 템플릿 안에서 `as Record<string, ...>` 같은 제네릭 단언을 쓰면 파서가 `>` 를 태그
  종료로 오인한다(`vue/no-parsing-error`) — 단언은 script 의 computed 에서 한다.
- **검증**: **E2E 25 ALL PASS**(새 견적 발급·**가격 실제 재계산**(₩50,000→₩67,100) · 옛 견적
  스냅샷 보존 · 수정자/사유 기록 · `spec.specJson` 동기 · 수량 동시 변경 · **확정가 낡음 신호와
  서버가 지우지 않음** · **사유 없이도 저장(수정자는 남고 사유만 null)** · **발주 시 409 + 사양
  불변** · 협력사 회신 시 알림만 · 거버 파생 필드도 수정됨 · 404).
  vitest 657+117 · typecheck · ESLint 0건.
- **남은 것**: ① 브라우저 실탐방 미실시(dev 포트 충돌로 web 재기동을 건너뜀 — 화면 확인 필요).
  ② 사양이 바뀐 뒤 협력사에 재요청하는 것은 아직 관리자 수동이다(`answeredRfqCount` 로
  알리기만 한다). ③ 고객에게는 사양 변경이 통지되지 않는다 — 주문 후 변경이 잦아지면
  EQ 고객 확인(D16) 경로를 재사용하는 편이 자연스럽다.

### P4.3 구현 기록 (2026-08-07 — 견적 계산의 라이브 가격표 사용)

**D18 의 구현.** 발단은 사양 수정(P4.2) 후 "재계산되는 가격이 맞긴 한가"라는 질문 —
조사해 보니 sp-node 만 한 달 전 스냅샷에 멈춰 있었다(거버 뷰어·레거시 PHP 는 항상 라이브).

- **호출 구조 실측**(정본 근거): 거버 뷰어는 옵션 변경마다 라이브
  `samplepcb_pricing_api.php` 로 화면가를 그리고, 담기 시 sp-node 에 **spec 만** 보낸다
  (`toProjectPayload.ts` — 가격 미전송, 서버 재계산이 유일한 진실). 가격표를 바꾸는 곳은
  레거시 `adm/price_adjust.php`(파일 덮어쓰기) 하나다.
- **`pricing/live-pricing.ts`**: `getFreshPricingData(log?)` — 5초 타임아웃 fetch → 느슨한
  형태 검증(HTML 에러 페이지·잘린 JSON 차단이 목적) → 성공 60초 캐시 / 실패 60초 재시도
  억제 → 라이브 → 마지막 성공본 → 번들 스냅샷 폴백. URL 은 `PRICING_DATA_URL` 로 교체 가능.
- **`engine.ts`**: `calculateQuote(input, pricing = BUNDLED_PRICING)` — 가격표·버전을 주입
  가능하게 만들고 내부 헬퍼(`findMenu`·`calEta`·`transferCostByWeight`)에 관통시켰다.
  기본값이 번들 스냅샷이라 골든·기존 호출부는 무변경.
- **호출부 3곳**: 거버 담기(`pcb-projects.ts` POST)·수량 재견적(PATCH `/:id`)·관리자 사양
  수정(admin PATCH `/:id/spec`) — 모두 트랜잭션 **밖**에서 fetch 한다(외부 HTTP 를 tx 안에서
  기다리지 않는다).
- **검증**: vitest 73(pricing — 골든 무변경 + live-pricing 6케이스: 주입 관통·캐시·HTTP
  오류·형태 불량·실패 억제·성공본 유지) · **E2E 4/4** — 사양 수정 hasl→enig 실호출에서
  autoPrice 162,800원 = **라이브 148,000 × 1.1(supply 모드)**, 스냅샷이었다면 181,500원,
  `priceVersion = live-2026-08-07` 기록. typecheck·ESLint 0건.
- **남은 것**: 없음(이 축은 완결). 관리자에게 "현재 가격표 기준일"을 보여주는 표시는
  필요해지면 `priceVersion` 노출로 충분하다.

### P4.4 구현 기록 (2026-08-07 — EQ 고객 확인 상태의 행 노출)

**요구(사용자)**: [고객 확인]을 클릭하지 않아도 보냈는지·답했는지 보이게. **열람 추적은
하지 않는다** — 메일 스캐너가 링크를 자동 GET 해 열람 신호는 오염된다(D16 과 같은 근거).
믿을 신호는 "보냈다(확인중)"와 고객의 결정(승인/반려)뿐이다.

- **계약**: `PcbPoEqReviewSummary`(status·requestedAt·dueOn·overdue·decidedAt·decisionNote)
  + `AdminPcbPoView.eqReview`(nullable). 요약 규칙: 열린 요청 우선, 없으면 마지막 결정,
  canceled 뿐이면 null(미요청 취급 — 취소했으면 다시 물어봐야 한다).
- **서버**: `loadEqReviewRowSummaries()` — P4.1 때 만들고 안 쓰던 `loadEqReviewSummaries`
  를 경량 대체(파일 로딩 없음, po 묶음 1쿼리). `serializeAdminPos` 가 `eqFiles` 와 같은
  패턴으로 싣는다.
- **웹**(AdminPcbCase): [고객 확인] 버튼이 상태를 입는다 — 미요청 `고객 확인`(sky) /
  `고객 확인중`(amber) / `고객 회신 기한초과`(red) / `고객 승인 <일자>`(emerald) /
  `고객 반려 <일자>`(red·툴팁에 사유 원문). **eq_requested 가 지나도 배지로 남는다**
  (승인의 근거 — 클릭하면 이력 모달). 모달의 새 요청 폼은 발주가 eq_requested 일 때만
  열린다(서버 가드 `NOT_EQ_REQUESTED` 의 화면 미러).
- **검증**: E2E 8/8(사다리 전수 — 미요청 null·대기·기한초과 overdue·승인·반려+사유·
  취소만 null·반려 후 재요청은 requested 우선) · vitest 683 · typecheck·lint 0건 ·
  실화면(Q21037 — 오늘 고객이 승인한 발주가 `고객 승인 2026-08-07` 로 표시됨).

### P4.5 구현 기록 (2026-08-07 — 레거시 호환 가격 라우트·거버 스위칭 비교)

정본은 **docs/pricing-engine-parity.md** — `/api/pcb-pricing` 레거시 드롭인 호환 라우트와
거버 뷰어 가격 API 스위칭 비교를 다룬다(이 문서에는 번호 연속성을 위한 포인터만 둔다).

### P4.6 구현 기록 (2026-08-09 — 고객 배송 큐: 입고확인 다음 단계의 복원)

배경(사용자 지적): 선적·배송 워크큐가 **입고 완료에서 끝나** "입고가 되면 고객에게
발송"하는 프로세스가 어디에도 없었다. 협력 축과 주문 축은 서로 게이트하지 않으므로
(P3.8) 입고가 끝나도 od 는 '입금'에 머무는데, 통합 주문내역의 운송장 일괄 입력은
'생산완료' 탭(선형 전이) 전용이라 그 탭에도 안 떴다. 남은 길은 force-status 를 아는
관리자의 수동 점프뿐 — 재촉(큐·배지)이 어디에도 없었다. SmartBOM 물류 화면의
"② 고객 배송" 섹션(D21-3)이 참조 답안이고, 구현은 PCB 전용·분리다(D9).

- **판정은 od 문자열이 아니라 협력 축 입고 신호다** — BOM 은 od(입금|준비)로 대기를
  판정하지만, PCB 는 제작 단계가 길고 force-status 혼용 여지가 있어 `배송 처리 대기 =
  결제됨 ∧ od ∉ {주문, 배송, 완료, 취소} ∧ 관리자 수신 선적(receiverKind='admin')
  입고확인(receivedAt) 존재`로 정의했다. 이관·수동 처리 건은 입고확인 자체가 없어
  **자연 제외**된다(D12 와 같은 효과 — 명시 제외 불필요). 판정 조인은 **발주서 축**
  (sp_pcb_po→shipment_po→shipment) — 묶음 선적의 대표 스펙이 다른 스펙일 수 있어
  shipment.specId 로 판정하지 않는다(라우트의 입고 수 enrich 도 동일 이유로 발주서 축).
- **계약·서버**: `ADMIN_PCB_ORDER_DELIVERY_TABS`(to_ship·shipping — 주문·결제 5탭과 분리,
  화면 몫이 다르다) + counts.toShip/shipping + 행 `receivedPoCount`·`deliveryCompany`·
  `invoiceNo`. `listPcbOrderSpecs`(한정 예외 ⑳)에 PO 축 파생 테이블 LEFT JOIN — 2만 건
  모수의 SQL 페이지네이션 유지, 파생 테이블은 선적 문서 수 규모라 비용 무시 가능.
- **전이는 코어 경로 재사용** — [배송 처리] = 운송장 입력 → `force-status '배송'`(운송장
  반영+재고 앵커), [구매확정] = `force-status '완료'`(BOM D21-3 동형 — 조작 경로 단일).
  코어 관례상 이 경로는 **고객 알림 미발송**이고 모달이 그 사실을 말한다. 알림까지
  원하면 입고확인 시 od 를 '생산완료'로 동기(D6)해 코어 선형 전이(알림 게이트·운송장
  일괄 입력)로 편입하는 것이 자연스럽다 — P4 od 동기 재검과 묶는다.
- **웹**: 선적·배송 화면을 SmartBOM 물류와 같은 **두 섹션 골격**으로(사용자 결정 08-09 —
  처음엔 한 탭바에 7탭으로 편입했으나 '전체' 탭이 선적 축만 가리켜 모호했고, 탭은 한
  번에 하나만 보여 "들어오는 것/나갈 것" 동시 조감이 안 됐다): **① 협력사 선적**(발송
  대기[발주서 축]·입고·처리 대기·이동 중·입고 완료·전체 — 협력사→자사 방향) / **② 고객
  배송**(배송 처리 대기·배송 중 — **주문 축**, 입고확인은 협력 축의 종점이라 그 다음
  일은 od 를 모수로 잡아야 보인다). **방향이 뒤집히는 지점(자사→고객)만 섹션 경계** —
  ① 내부의 발주서/선적 2축은 같은 방향의 앞뒤 단계라 나누지 않는다. 공용
  `PcbCustomerShipModal`(미입고 n/m 경고+confirm). Case 상세의 '배송 처리 대기' 배지
  (P3.8 — 보이게만 하던 신호)를 **버튼으로 승격**해 같은 모달을 그 자리에서 연다.
  배지 pcbShipmentPending = 발송 대기 + 관리자 차례 + **고객 배송 대기** 3항 합산(D12).
- **검증**: **E2E 26 ALL PASS**(실서버·실데이터 Q20984 — 입고확인 완료·od 입금 상태
  그대로 대기 큐 편입·행 입고 1/1, 전 행 입고 신호 보유(이관 미유입), force-status 배송
  → 운송장·재고 앵커(옵션행 io_stock_qty — 상품행 아님 주의) → shipping 탭 편입·운송장
  노출 → 구매확정 → 원상복구(주문[재고 복원]→입금+운송장 SQL 원복) → 대기 큐 재편입).
  vitest 733+121 · `pnpm -r typecheck` · ESLint 0건.
- **남은 것**: ① 브라우저 실탐방 미실시(관리자 로그인 세션 필요) — 세 화면(워크큐 탭·
  모달·Case 배지 버튼) 1회 확인 필요. ② 배송 안내 알림은 코어 관례대로 미발송 — D6
  자동 동기와 묶어 재검(P4). ③ 구매확정 자동화(수령 후 N일)는 미기획.

### MD 소속 관리 UI 구현 기록 (2026-08-09)

그간 `sp_partner_relation` 은 읽기 4곳(RFQ 배정 검증·링크 통화·EQ 위임 판정·하위 목록)뿐,
생성·관리 경로가 시드/DB 직삽입밖에 없었다(레거시 설정 3종 중 'MD 소속'의 플랫폼 대응 공백).

- **계약**: `partner.ts` 에 `AdminPartnerRelation*`(뷰 링크·후보·추가/통화 바디) — 링크
  통화는 `PcbCurrency`(KRW|USD|CNY) 재사용, view 는 null 허용(런타임 USD 폴백 표기).
- **서버**: `admin-partners.ts` 에 `GET/POST/PUT/DELETE /admin/partners/:id/relations(/:childId)`.
  - 연결 규칙: 사람 협력사(type partner)·승인 상태끼리만. **2단 강제** — 하위가 이미 MD 면
    `CHILD_IS_MD`, 부모가 이미 다른 MD 의 하위면 `PARENT_IS_CHILD`(사슬·순환 동시 차단).
    다중 상위(한 하위가 여러 MD 소속)는 스키마·소비 코드가 모두 수용하므로 허용.
  - **첫 하위 연결 가드**: 연결 순간 조직이 MD 로 전환돼 진행 중 수주 발주의 EQ 주체가
    자체→위임으로 뒤집힌다(`resolveEqDelegation`) — 관리자 직속 미종결 발주가 있으면 409.
  - **해제 가드**: 진행 중 문서(RFQ requested|quoted · selected 인데 같은 회차 발주 없음 ·
    발주 ≠produced)가 있으면 409. 선적은 행에 받는측이 박제돼 링크와 무관하므로 세지 않는다.
  - 통화 변경(PUT)은 자유 — 배정 시점에 견적행으로 박제되므로 이후 배정부터만 적용된다.
- **웹**: 파트너 관리(/app/admin/partners) 상세 드로어에 **'마스터딜러 소속'** 섹션(type
  partner 만) — 소속 상위 MD·하위 협력사 목록(링크 통화 select 즉시 저장 + 진행 n건 배지 +
  해제), 하위 연결 폼(후보는 서버가 2단 규칙 선반영·`pcb_rfq` 능력 없으면 표기), 다른 MD 의
  하위 조직이면 추가 폼 자체를 감춘다.
- **검증**: 자족 스모크 **23 ALL PASS**(실서버 — 임시 조직 3곳 생성→가드 6종·CRUD 왕복·후보
  규칙→정리, 시드 무접촉) · `turbo typecheck`·ESLint 0건.
- **발견**: 로컬 dev DB 의 P1 로컬 시드(파트너 9=MD·10=하위)가 **현재 DB 에 없다**(신규
  협력사 id 가 3부터 발급됨 — 테이블 리셋 흔적). §9 P1 '로컬 시드' 항은 현 DB 기준 무효 —
  이 화면으로 관계를 직접 만들 수 있으므로 시드 재삽입은 불필요.
- **브라우저 실탐방(같은 날)**: /app/admin/partners 실세션 — 협력(USD)↔협력1(KRW) 왕복.
  섹션 렌더·후보 "협력1 · KR"(pcb_rfq 보유라 경고 없음)·연결(하위 (1) 행 USD)·행 통화
  USD→CNY 즉시 저장·**하위 드로어**(소속된 마스터딜러 행 + "2단 제한" 문구로 추가 폼 숨김)·
  하위 쪽 해제(parents 축 DELETE)→즉시 (0)+연결 폼 재노출, 콘솔 에러 0, 관계 원상 복구.
  (CDP 스크린샷 타임아웃·타일 아티팩트는 로컬 렌더러 부하 — 앱 무관)
- **남은 것**: `PARENT_HAS_ACTIVE_POS`·`RELATION_ACTIVE` 가드는 진행 중 실데이터가 필요해
  스모크 미포함(로직은 count 1개) — 다음 PCB E2E 때 곁들여 확인.

### 포털 묶음 발송 재구성 (2026-08-09 — [📦 PCB 보내기] 보드)

**배경(사용자 지적이 정확했다)**: 묶음 발송은 서버(P3 `withPoIds`)와 상세 화면 체크박스로
"있었지만", 실사용 흐름에서 도달 불가였다 — 후보 조건(같은 받는 곳·회차·produced·미편성)이
동시에 성립하는 창이 거의 없고(순차 완주 시 항상 0건), 발주서마다 [발송 준비]를 누르면 서로
다른 단독 발송에 소속돼 **영구히 못 묶는 함정**(협력사는 대표 detach 불가)까지 있었다.
dev DB 실데이터로 재현 판정 후, "전이 순간 일회성 묶기" 모델 자체를 폐기하고 BOM §6.11
**"박스에 먼저 담는" 모델의 PCB 일반화**로 재구성했다.

- **모델**: 박스 = **컨텍스트당 preparing 발송 1개**(BOM 과 달리 받는 곳이 갈린다 —
  관리자행/직송 KR·CN·VN/MD행, contextKey = 받는측:받는조직:직송지:회차). 규칙은 하나 —
  "발송 전(preparing)엔 자유"(담기·꺼내기, 대표 개념 은닉).
- **서버**(`pcb-shipment.ts`): ①`ensurePcbShipment` 합류 의미론 — 같은 컨텍스트 preparing
  박스가 있으면 합류, 없으면 생성(모든 경로 공통이라 "각자 발송 준비" 함정 자체가 소멸)
  ②`detachPcbShipmentPo` BOM §6.11 동형 — 대표 꺼내면 승계(poId+specId), 마지막이면 첨부
  정리 후 발송 소멸(구 REPRESENTATIVE_PO 폐기) ③`advancePcbShipment` — withPoIds 제거,
  **최초 전이 시 묶음 전체 출고 게이팅 재검**(구 withPoIds 는 동반 발주서 게이팅을 안 봐
  우회 가능했다 — 교정) ④구성 변경(합류·꺼내기) 시 `invoiceData` DbNull 클리어(품목 누락
  송장 방지 — 국제 묶음의 "서류 먼저, 묶기 나중" 순서 함정 해소) ⑤`loadPartnerPcbShipBoard`
  (선반=수주 produced·미편성 + 받는 곳 라벨·게이팅·국가 상태 / 박스 / 진행 / 완료 수).
- **계약**: `PcbShipmentView.groupPos`(소속 발주서 표시 정보 — additive), AdvanceBody 의
  `withPoIds`·상세 `shippableWith` 제거(모노레포 동시 배포라 breaking 무해), 보드 계약
  `PartnerPcbShip*` 신설. apiRoutes `partnerPcbShipments`(P3 때 선등록된 키) 첫 사용.
- **라우트**: `partner-pcb-shipments.ts` 신설 — `GET /partner/pcb-shipments`(보드) +
  `POST /partner/pcb-shipments/box`(담기 — 서버가 컨텍스트 해석해 합류·생성, 멱등).
  꺼내기·전이·서류·입고는 기존 발주서 경유 라우트 재사용.
- **웹**: `/partner/pcb-ship` **[📦 PCB 보내기]** 신설(BOM 두 칸 미러 + 받는 곳 배지·박스
  복수 나열·게이팅/국가 비활성 사유) · 상세 발송 카드는 체크박스 → **묶음 구성 표시**
  (groupPos + 보드 링크)로 교체 · 포털 홈에 "보낼 PCB 물건" 진입 카드(선반·박스 있을 때만).
- **검증**: 실서버 스모크 **27 ALL PASS**(자족 시드 협력2(CN) — 모드 파생(CN발 관리자행=국제
  ·직송 CN=국내) 겸 검증: 라벨·합류·컨텍스트 분리·멱등 담기·대표 승계·박스 소멸·게이팅
  담기 409+**전이 재검 409**·MD 라벨(협력1 보드 읽기)·묶음 전이·동반 상세 동기·revert·
  관리자 입고확인→완료 분류·정리 무잔재) · typecheck · ESLint 0건 · vitest 회귀 0.
- **후속(같은 날) — 발송 조작을 보드로 단일화**(사용자 결정: "BOM처럼 아예 보내기에서").
  상세에 박혀 있던 보내는측 발송 UI 를 `components/pcb/PcbShipmentCard.vue` 로 추출
  (스텝퍼·전이 폼·첨부 업로드·상업송장 생성기·되돌리기 — BOM PartnerShipmentCard 미러,
  조작은 대표 poId 경유). 보드는 박스 확정 시 같은 화면에서 카드 전개(BOM readyMode
  미러)하고 진행 중 발송도 카드로 바로 전이한다. **상세는 읽기 요약**(스텝퍼·운송장·묶음
  구성·첨부 다운로드)+보드 링크로 축소 — 단, **받는측(MD 입고확인·수신 전이)은 상세에
  유지**(보드는 보내는측 화면, 받는 흐름은 "발주한 하위 건" 상세가 자리다). [발송 준비
  시작] 버튼(빈 전이 409 트릭)도 보드 링크로 대체 — 진입점 단일화. 서버·계약 무변경,
  스모크 27 재실행 ALL PASS · web typecheck·ESLint 0건.
- **후속 2(같은 날) — 확인 시점 가시성 보완**(사용자 지적: BOM 은 발주 확인 즉시 '보낼
  물건' 건수가 잡히는데 PCB 는 생산완료까지 아무 표시가 없다). 담기 기준을 낮추는 건
  도메인 위반(생산 전 발송 불가·NOT_PRODUCED 가드)이라 기각하고 **가시성 패턴만 BOM 에
  맞췄다**: 보드 응답에 `producing`(수주·생산완료 전 목록) 추가 → 보드 선반 하단
  "곧 보낼 물건 (n건 생산 진행 중 — 생산완료되면 위로 올라옵니다)" 읽기 목록(상태
  배지·상세 링크) + 홈 카드 노출 조건 완화(선반·박스·생산중·진행 발송 중 하나라도
  있으면)·보조 라인 우선순위(박스 계속하기 > 보내기 > **생산 진행 중 n건** > 진행 중
  발송). 메인 숫자는 담기 가능 수 유지(BOM 카운트도 담기 가능 수 — 이게 진짜 일관성).
  스모크 28 ALL PASS(producing 분류·선반 제외 검증 추가).
- **남은 것**: ① 관리자 Case '같이 보내기' UI(P3 후속 그대로 — 관리자 대행도 ensure 합류
  의미론은 이미 공유) ② 국제 묶음 E2E(Invoice 첨부 필수 경로) ③ 브라우저 실탐방 —
  협력사 계정(tester2) 로그인이 필요해 자동화 불가(자격증명 입력 금지), 수동 확인 1회:
  /app/partner/pcb/ship 담기→카드 전개→국내 전이, 상세 요약·보드 링크, 홈 카드
  '생산 진행 중' 보조 표기.
- **포털 재설계 편입(2026-08-10)**: 포털이 BOM/PCB 모듈로 분리되며 PCB 화면들은
  `/partner/pcb/*` 로 이동, PCB 홈(트랙 어휘 카드 4장)·완료 발송 아카이브
  (`GET /partner/pcb-shipments/done` + PartnerPcbShipmentsDone) 신설. IA·진입 규칙
  정본은 **docs/PARTNER_PORTAL.md**. 검증은 E2E 기반으로 전환 중(HANDOFF_E2E_TEST.md).

### P4.7 구현 기록 (2026-08-10 — 선정+확정가 한 번에·선정 환율 자동)

여정 1호 주행 후 사용자 개선 의견 2건("선정하면 확정가까지 두 번 클릭", "환율 수동
입력 비대칭")을 반영 — 레거시 선정 모달(마진%↔판매가 동시 입력)의 플랫폼 복원이자,
P1 이연 TODO "선정 환율 prefill"의 해소.

- **확정가 코어 추출** `lib/pcb-price.ts`: `checkPcbPriceGate`(active·비담김 검사 +
  유령 active 보관함 정리 — 기존 PATCH price 게이트 그대로) / `confirmPcbFinalPrice`
  (게이트 + 조건부 updateMany로 finalPrice·quoted·pricedBy/At 박제). 기존
  `PATCH /admin/pcb-projects/:id/price` 는 이 코어 호출로 교체(동작 무변경).
- **선정 API 확장** `POST …/rfqs/:rfqId/select` body `finalPrice?` 추가: 있으면
  확정가 게이트를 **선검사**(선정만 되고 확정가는 실패하는 부분 성공 방지 — 두 게이트는
  축이 달라 D10 이후 어긋날 수 있음) → 선정 → `confirmPcbFinalPrice`. 선검사~등록
  사이 극소 레이스는 409로 "선정은 완료됐지만 확정가 등록 실패 — [확정가 등록] 재시도"
  명시.
- **선정 환율 자동** `selectPcbRfq`: 외화 회신 선정 시 `exchangeRate` 생략이면
  `getPcbExchangeRate(ccy,'KRW')`(수출입은행 당일 캐시, tts·KRW 경유 교차) 자동 적용 —
  회신 환산·MD 마진과 같은 의미론(이 변환점만 순수 수동이던 비대칭 해소). 명시값은
  오버라이드. 캐시 미준비면 400 EXCHANGE_RATE_REQUIRED(명시 입력 요구).
- **환율 노출** `GET /admin/pcb-exchange-rate?from=USD|CNY` 신설(FE prefill 용,
  `{rate, rateDate}|null`).
- **선정 모달 개편**(AdminPcbCase): 외화면 열릴 때 당일 환율 prefill(고시일 라벨,
  수정 가능 — 손대면 라벨 해제) + 원가 KRW 미리보기(서버 박제식과 동형) + 판매가
  섹션(마진%↔판매가 VAT 포함 양방향, 판매가=원가KRW×(1+마진%)×1.1 — 레거시 공식) +
  [선정만]/[선정+확정가 등록] 2버튼. 판매가 섹션은 확정가 게이트와 같은 조건
  (`cartState==='none' && status==='active'`)에서만 — 진행 중 주문(원가 소싱 모드)이면
  감추고 선정만. 기존 [확정가 등록] 모달은 수정 창구로 유지.
- **검증**: 여정 1호 S5를 새 계약(`{finalPrice}` 한 번, 환율 생략)으로 갱신해 재주행 —
  11/11 green, 환율 자동 적용 실동작(USD 1432.98/08-07 고시, 폴백 미발동), quoted
  전이·finalPrice DB 어서션 통과, HTTP 오류·pageerror 0. 생성물은 재고 복원
  (force-status '주문') 후 전체 삭제(잔재 0).

### P4.8 구현 기록 (2026-08-10 — EQ 고객 확인의 고아 요청 종료·워크큐 고객 신호)

D16 축의 결함 2건. 어느 쪽도 **고객 결정이 EQ 를 전이시키지 않는다**는 설계(P4.1)를 바꾸지
않는다 — 두 축은 그대로 분리돼 있고, 어긋난 것은 "관리자가 EQ 를 움직였을 때 열린 요청이
남는다"는 뒷정리와 목록의 신호였다.

- **열린 요청 자동 종료**(`lib/pcb-po.ts`): EQ 전이 3곳(승인 advance·반려·되돌리기)에서
  그 발주서의 `status='requested'` 리뷰를 `canceled` 로 닫는다. 전이·상위 미러·요청 종료는
  **한 `$transaction`** 이다(나뉘면 발주만 넘어가고 고객 화면엔 답할 수 없는 요청이 남는다).
  이 결함은 두 얼굴이었다: ① 반려·되돌리기 뒤에도 고객 주문내역에 승인/반려 폼이 계속 떠
  결정이 관리자 메일까지 발송됐고 ② 협력사가 보완 후 재요청하면 `createEqReview` 가
  `ALREADY_OPEN` 409 로 막혀 관리자가 옛 요청을 손으로 취소해야 했다.
- **결정 가드**(`lib/pcb-eq-review.ts`): `decideEqReview` 가 발주 상태를 함께 읽어
  `eq_requested` 가 아니면 `NOT_EQ_REQUESTED`(생성 가드와 같은 코드) — 전이 직전에 열려
  있던 낡은 화면에서 눌린 결정을 막는다. 라우트는 409 + "이미 처리된 확인 요청입니다 —
  화면을 새로고침해 주세요.", `spcb/api/eq-decide.php` 는 409 문구를 하드코딩하지 않고
  **sp-node 메시지를 그대로** 실어 되돌린다(기존 오류 표시 패턴).
  ※ 취소된 요청은 고객 화면에서 사라지지 않고 **'요청 취소'(sp_eq_off)로 남는다** — 폼만
  없어진다. 관리자 수동 취소와 같은 표시라 새 처리가 필요 없다.
- **워크큐 고객 신호**(`AdminPcbPoWorkItem.eqReview` + `AdminPcbPos.vue`): 'EQ 승인 대기'
  탭은 행이 전부 `eq_requested` 라 상태 배지만으로는 **지금 승인하면 되는 건**(고객 승인)과
  고객 확인중·고객 반려·미요청이 섞였다. Case 상세와 같은 요약(`loadEqReviewRowSummaries`,
  po 묶음 1쿼리)을 행에 실어 배지로 가른다. 판정·팔레트는 `web/src/lib/pcb-eq-review.ts`
  공용(sky=미요청·amber=확인중·red=반려/기한초과·emerald=승인 — Case 버튼과 같은 색).
  `adminTurn` 도 정직해졌다: 고객 답을 기다리는 동안은 false(공이 고객에게 있다), **회신
  기한이 지나면 재촉이 관리자 몫이라 다시 true**. P4.1 의 남은 것 ①(무응답 건이 Case
  상세에서만 보임)이 이걸로 닫힌다.
- **검증**: typecheck·ESLint 0건(@sp/api-contract·api·web) · vitest 737 green(회귀).
  스키마 변경 없음(기존 `sp_pcb_eq_review.status` 로 해결).

### P4.9 구현 기록 (2026-08-10 — 여정 1호 재점검: 고객 주문 마찰·미수금 사각지대)

여정 1호를 단계별로 다시 훑어 나온 것들. **먼저 테스트 코드 탓인지부터 가렸고**, 그 과정에서
지난 세션의 판정 하나를 뒤집었다.

- **정정 — 무통장 입금확인은 2단계가 아니다.** 이전 주행이 "정상 경로는 `receipt` →
  `force-status` 2단계"라고 기록했는데, 실 UI 는 어느 화면에서든 `PATCH /orders/status`
  **한 번**이고 그 안에서 `od_receipt_price=od_misu·od_misu=0` 까지 처리한다
  (`useAdminPcbOrders.useConfirmPcbOrderReceipt` → `g5-db.setOrdersReceipt`). 여정 S7 이
  실 UI 가 밟지 않는 경로를 검증하고 있었고, 그래서 **고객 입금 확인 메일도 통째로
  미검증**이었다. S7 을 실 경로로 교체하고 미수금 0 어서션을 붙였다.
- **주문서만 테마 오버라이드가 없었다**(`theme/sp-lite/shop/` 에 `orderform*` 부재). 장바구니·
  견적관리·주문내역은 전부 덮었는데 그 사이 한 화면만 영카트 원본이라, 마찰이 거기 몰려 있었다.
  코어 무수정 원칙대로 **테마 JS**(`js/orderform-defaults.js`, `order-vat-breakdown.js` 와 같은
  `add_javascript` 경로)로 해결: ① 배송지 기본 선택(기본배송지 → 없으면 주문자와 동일) ②
  결제수단 기본 선택(무통장) ③ `#settle_bank` 표시 동기화 ④ 계좌 select 빈 옵션 제거.
  프로그램적 `click()` 으로 **코어 핸들러를 그대로 태워** 값 채움·배송비 재계산을 함께 얻는다.
  - `#settle_bank` 는 인라인 `display:none` + click 에서만 펼침이라, 뒤로가기·bfcache 복원 시
    라디오는 선택된 채 입력란만 숨어 **필수 검증에서 빠져나올 수 없는 상태**가 됐다(오류 표시가
    배경색뿐이라 숨겨진 필드에선 아무 변화도 안 보인다). `pageshow` 까지 동기화한다.
  - **'주문자와 동일'은 누른 순간에만 복사한다**(코어 `gumae2baesong`). 회원 정보에 주소가
    없으면 로드 시점 복사본이 빈 값이라, 고객이 그 뒤 주문자 주소를 채워도 받는분은 빈 채로
    남아 제출에서 막힌다 — 실제로 재주행에서 이 순서로 실패했다. 선택이 유지되는 동안
    주문자 변경을 따라가게 하고(300ms 디바운스 — 배송비 AJAX 억제), 주소 검색처럼 값이
    코드로 들어오는 경우를 위해 **submit capture 단계에서 한 번 더** 맞춘다.
- **무통장 입금 안내 배너**(`orderinquiryview.php` 주문번호 아래): 주문 직후 고객이 도착하는
  곳이 여기인데(전용 완료 페이지 없음) "얼마를 어디로"가 페이지 아래에 흩어져 있었고 결제금액
  칸은 미입금이면 "아직 입금되지 않았거나…"로 떴다. 입금액·계좌(복사 버튼)·입금자명을 상단에
  못박는다. 기한 문구는 정책이 리포에 없어 넣지 않았다(없는 약속을 만들지 않는다).
- **상태 표시 지뢰 제거**(`extend/sp_order_status.extend.php`): `default` 가 `'주문취소'` 라
  모르는 상태가 오면 정상 진행 중인 주문이 고객에게 취소로 보였다. 취소/반품/품절을 명시
  `case` 로 두고 default 는 **원문을 진행 중 색으로** 노출한다.
- **견적 대기 행 안내**(`spcb/pages/quotes.php`): 배지는 '견적 대기'인데 금액은 자동견적가가
  그대로 떠 담당자 검토 결과로 오해하기 쉬웠다(실제로 확정가는 1.43배였다). BOM 행의
  '확정가 안내 후 주문 가능' 과 같은 자리에 정체와 다음 일을 적는다.
- **PCB 축 미수금 사각지대**: `AdminPcbOrderItem.isPaid` 는 `od_status` 파생이라 상태만 올린
  주문도 결제됨으로 보이는데, PCB 화면엔 미수금 필드가 아예 없어 드러날 방법이 없었다.
  `od_misu` 를 목록 SQL·계약·응답에 싣고 주문 워크큐에 **미수 배지**를 띄운다. 강제 상태
  변경 모달에도 결제 이후 단계로 갈 때 미수 잔액 경고를 넣었다(모달은 misu 를 받지도 않았다).
- **오승인 방어**(`AdminPcbCase.vue`): 고객이 반려했거나 아직 답하지 않은 건도 `[EQ 승인]`이
  confirm 없이 한 클릭이었다. 되묻되 서버는 막지 않는다(D11 관리자 만능 대행). 반려 시
  `window.prompt` 기본값에 **고객 반려 사유를 프리필**해 재타이핑을 없앴다.
- **여정 관찰 품질**: 단계 대부분이 API 라 열어 둔 화면이 저절로 바뀌지 않는데 재로드가 없어
  **관리자 스크린샷 3장이 전부 S3 시점 그대로**였다(화면 검증이 사실상 없었음). `view()`
  헬퍼로 각 단계에서 다시 열고, 견적관리는 목록이 채워질 때까지 기다린 뒤 찍는다. 주문서
  기본값은 이제 **테스트가 채우지 않고 확인만** 한다 — 비어 있으면 findings 에 남아 회귀가 드러난다.
- **검증**: typecheck·ESLint 0건 · PHP `php -l` 6파일 · 여정 재주행 **11/11 green**(findings 에
  bug 0 — 기본값이 전부 적용됐다는 뜻, 입금 배너·계좌 표시 육안 확인) · 생성물 정리 CLEAN.
  주행 중 S6 이 32초 → 2.6초로 줄었다(막히던 입력을 화면이 미리 채운 효과).

### 완주 여정 2호 — 국내 협력사 (2026-08-10)

1호(협력2·CN·USD·국제)와 같은 고객 흐름을 국내 협력사(협력1·KR·KRW)로 태운 두 번째 여정.
협력사 축만 갈리므로 **고객 조작과 관찰 규약은 `e2e/helpers/journey.ts` 로 공유**한다
(`createJourneyReport`·`submitGerberRfq`·`placeOrderFromQuotes`) — 주문서 마찰이 고쳐지면
양쪽이 함께 검증된다. 1호도 같은 헬퍼를 쓰도록 정리했고 22케이스 연속 green 으로 회귀를 확인했다.

국내에서 실제로 갈라지는 지점은 셋이고, 여정이 그것만 정조준한다.

- **선정에 환율이 없다** — KRW 회신은 그대로 원가가 된다. `exchangeRate` 를 보내지 않고
  `krwAmount = 회신가`·`exchangeRate = null` 을 어서션한다(P4.7 자동 환율의 KRW 분기).
- **선적이 3단계다** — `preparing → shipping`(협력사: 택배사+송장) `→ delivered`(관리자).
  국제의 `requested`(Invoice 필수)·`arrived`·`customs` 가 통째로 없고, **Invoice 첨부 없이**
  발송이 진행돼야 한다. 모드 판정(`resolvePcbShipContext`: 발송자 KR = 받는측 KR)도 함께 못박는다.
- **입고 완료와 입고확인은 다른 축이다** — `delivered` 전이는 관리자 advance 몫이고
  `receivePcbShipment` 는 상태를 올리지 않고 `receivedAt`·메모만 남긴다(조기 확인 허용).
  둘 다 밟아야 종점이라, 처음엔 receive 만 부르고 `shipping` 에 멈춰 주행이 실패했다.

여기에 1호가 밟지 않은 축 하나를 더 검증한다 — **EQ 반려 왕복**: 고객 반려(사유 저장) →
관리자가 그 사유로 협력사 반려 → **열린 고객 확인 요청이 닫혔는지**(P4.8 회귀 어서션) →
파트너 보완 재요청 → 관리자 재확인 요청이 `ALREADY_OPEN` 없이 통과 → 고객 승인. P4.8 이
없었다면 재요청이 409 로 막히고 고객 화면엔 죽은 폼이 남는다.

협력사는 협력1을 쓰되 **기존 행은 건드리지 않는다** — 주행이 만든 새 견적에 붙는 RFQ·발주·
선적만 생성하고 정리도 그것만 지운다. 검증: 2호 11/11 · 1호와 연속 22/22 green ·
HTTP≥400·pageerror 0 · 생성물 정리 CLEAN.

### P4.10 구현 기록 (2026-08-10 — 국내 입고의 이중 축 해소·EQ 회차 판정)

여정 2호(국내)를 단계별로 훑어 나온 것들. 가장 큰 것은 **국내 종점이 두 축으로 갈라져 있던
문제**였고, 그건 내가 E2E 를 짜다 직접 걸려 넘어진 지점이기도 하다.

- **입고 완료(delivered)와 입고확인(receivedAt)의 결합**: 다음 일을 여는 열쇠는 전부
  `receivedAt` 인데(MD 상위 출고 게이트·고객 배송 큐·Case 배지), 화면에서 최종처럼 보이는 건
  전이 버튼 '입고 완료'였다. 그걸 눌러도 아무것도 안 열리고, 반대로 입고확인만 하면 상태는
  `shipping` 에 멈춘다. **BOM 은 이미 묶여 있었다**(`bom-po.ts:690` `RECEIVE_REQUIRED`) —
  PCB 만 풀려 있던 것이라 같은 모양으로 맞췄다. `advancePcbShipment` 는 `delivered` 진입을
  `RECEIVE_REQUIRED` 로 막고, `receivePcbShipment` 가 국내 `shipping` 에서 상태·completedAt
  까지 함께 닫는다. 화면도 국내에서는 전이 버튼을 감추고 입고 확인을 한 단계 일찍 연다
  (관리자 Case·MD 수취자 상세). 파생으로 워크큐의 "입고·처리 대기 탭에 초록 입고 완료" 같은
  자기모순과 아카이브의 실패하는 되돌리기도 사라진다.
- **EQ 요약의 회차 판정**(P4.9 프리필의 결함 교정): `loadEqReviewRowSummaries` 가
  canceled 아닌 최신 1건을 그대로 요약해, 반려로 발주가 내려갔다 재요청으로 올라온 뒤에도
  **지난 회차의 고객 반려**를 가리켰다. 그 상태로 협력사에 반려하면 옛 회차 고객 문구가 다시
  나간다. `eqHistory` 의 마지막 `→ eq_requested` 시각을 회차 시작으로 삼아 그 이후 생성된
  리뷰만 요약한다(이력 없으면 무제한 — 이관·구데이터).
- **협력사 반려 배너**: 반려 사유가 기본 접힌 `<details>` 안에만 있어, 되돌아온 발주서가
  신규 발주와 화면상 구별되지 않았다. `issued` 이고 마지막 이력이 `eq_requested → issued` 면
  상단에 사유·시각을 펼쳐 고정한다.
- **국내에서 안 쓰는 UI 정리**(PcbShipmentCard): Invoice·AWB 업로드는 국제 전용인데 mode
  게이트가 없어 국내에도 떠 있었다(서버는 `requested` 단계에서만 Invoice 를 본다). 완료
  아카이브는 같은 카드를 그대로 써서 끝난 발송에도 편집 액션이 살아 있었다 — `readonly`
  prop 으로 전이·업로드·되돌리기를 접고 읽기 정보만 남긴다. 되돌리기 노출은
  `bomShipmentActorOf(mode, status) === 'PARTNER'` 로 좁혀 **누르면 반드시 거절되던 버튼**을
  없앴다(BOM 형제 카드가 이미 쓰던 식과 동일). 국내 전이 버튼은 택배사·송장 공백이면 비활성.
- **여정 관찰 교정**: 두 여정 모두 고객 배송 큐를 `/app/admin/pcb/orders?tab=…` 로 열었는데
  그 탭은 주문·결제 화면에 없고(경리 5탭 — `AdminPcbOrders.vue:31`) 두 워크큐 다 URL 쿼리로
  탭을 받지 않는다. 선적·배송 화면을 열도록 고쳤다. 2호 D11 은 이제 **입고확인 없이 전이하면
  409 RECEIVE_REQUIRED** 를 어서션해 이번 결합의 회귀를 지킨다.
- **검증**: typecheck·ESLint 0건 · vitest 737 green · 두 여정 연속 22/22 green · 정리 CLEAN.

### P4.11 구현 기록 (2026-08-10 — 값을 받는 조작을 입력 모달로)

관리자·협력사 화면에서 값을 받던 `window.prompt` 7곳을 공용 입력 모달
(`components/ui/UiPromptModal.vue`)로 옮겼다. prompt 를 걷어낸 이유는 취향이 아니라
**조작이 실제로 막히거나 값이 사라졌기 때문**이다.

- 여러 값을 물으려면 창을 연달아 띄워야 했다 — 국내 발송의 택배사·송장번호가 그랬고,
  **두 번째 창에서 취소하면 첫 입력이 통째로 사라졌다**.
- 줄바꿈이 안 된다. EQ 반려 사유는 협력사에게 메일로 그대로 나가는 대외 문구인데
  한 줄로만 쓸 수 있었고, 미리보기도 형식 검증도 없었다.
- 브라우저의 "추가 대화상자 표시 안 함"을 한 번 체크하면 기능 자체가 죽는다. Case 화면엔
  prompt·confirm 이 여섯 군데라 체크될 확률이 낮지 않다.

모달은 필드 정의(`PromptField[]`)를 받아 한 화면에서 묻고, **필수값이 채워질 때까지 확인
버튼을 잠근다**. Esc·배경 클릭으로 닫히고 여러 줄 입력 중에는 Enter 가 줄바꿈이라 확인은
Ctrl/⌘+Enter 로 받는다. 옮긴 자리는 EQ 반려 사유(고객 반려 사유 프리필·"이 문장이 협력사에게
메일로 갑니다" 안내), 선적 전이 3종(출고예정일 / 택배사+송장 / AWB 트래킹), 입고 확인 메모
(관리자·MD 양쪽 — 국내는 "입고 완료까지 함께 닫힌다"를 설명에 밝힌다).

검증은 `e2e/specs/prompt-modal.e2e.test.ts` 신설 — prompt 였다면 브라우저 대화상자라 DOM 에
흔적이 없으므로, **모달 요소가 보인다는 것 자체가 교체의 증거**다. 사유 없이는 확인이 잠기는지,
Esc 로 닫히는지, 입력이 서버까지 가 `eqHistory` 에 남는지까지 확인한다.
남은 prompt 는 BOM 패널의 클립보드 복사 실패 폴백 1곳뿐이고, 그건 입력이 아니라 표시 용도다.

**확인창(window.confirm)도 함께 옮겼다** — 33곳이라 컴포넌트마다 상태를 두면 코드가 그만큼
불어난다. 그래서 모양만 모달로 바꾸고 쓰는 법은 그대로 두었다:
`if (!(await confirmDialog('…'))) return;` (`lib/confirmDialog.ts` + 앱 루트의
`UiConfirmHost` 하나). 삭제·취소·되돌리기처럼 되돌리기 어려운 조작은 `tone: 'danger'` 와
동작에 맞는 확인 라벨('삭제'·'발주 취소'·'되돌리기')을 준다. 회원 관리 드로어에 이미
"차단/해제 — 인라인 2단계 확인(window.confirm 금지)"라는 주석이 있었으니, 이번 교체는 그
방침을 화면 전체로 넓힌 셈이다. E2E 도 확인창 케이스를 함께 지킨다(취소를 누르면 발주서가
그대로 남는지까지).

### 완주 여정 3호 — 묶음 발송 (2026-08-10)

고객 주문 **두 건**이 한 박스로 묶여 나가고, 입고 뒤 다시 각각의 주문으로 갈라져 배송되는
여정. 협력사 축의 묶음 메커니즘(합류·대표 승계·게이팅·묶음 전이)은 `pcb-ship-board` 스펙이
시드 발주로 이미 지키므로, 3호는 **그 스펙이 시험할 수 없는 것**만 겨냥한다 — 거기엔 주문이
없기 때문이다.

- **한 박스 합류**: 서로 다른 스펙(=서로 다른 주문)의 발주가 받는측·회차·직송지가 같아
  기존 박스에 합류하는지. 화면에서도 "2건 담김 / 합계 $600.00"로 확인된다.
- **묶음 전이**: Invoice 를 **박스에 한 번** 첨부하고 대표로 선적요청하면 동반 건도 함께
  `requested` 로 이동하는지(동반 건 상세에서 `poIds` 2건).
- **cross-spec 판정**(이 여정의 존재 이유): 입고확인은 묶음에 한 번인데, 그 뒤 **두 주문이
  모두** 고객 배송 대기 큐에 올라야 한다. 선적 문서의 `specId` 는 대표 한 건뿐이라 그걸로
  판정하면 동반 주문이 큐에서 사라진다 — 서버는 발주서 축으로 조인해 이를 피하는데
  (`admin-pcb-orders.ts` PCB_SHIP_JOIN 주석), **주문이 둘 있어야 비로소 시험된다**.
- **갈라져 나가기**: 묶어서 받았어도 고객에게는 각자 나간다 — 주문마다 다른 운송장으로
  배송·완료하고 각 주문의 `od_invoice`·미수금까지 확인한다.

협력사는 협력2(CN)라 관리자행이 국제가 되어 Invoice 경로도 함께 지난다(남은 항목이었던
'국제 묶음 E2E'가 이걸로 닫힌다). 검증: 10케이스 첫 주행 통과, 2회 연속 동일 결과(재현성),
HTTP≥400·pageerror 0, 생성물 정리 CLEAN(선적 1건에 링크 2건이 함께 정리되는지도 확인).

### 완주 여정 4호 — MD 경유 2단 (2026-08-10)

관리자가 중개상(MD)에게 맡기고, 중개상이 다시 제조사에 재위탁하는 구조가 끝까지 도는지 본다.
1~3호가 모두 관리자 직수주라 MD 축은 시드 발주로만 부분 검증돼 있었다.

- **2단 견적**: MD 가 하위에 배정 → 하위 회신 → MD 가 마진%만 얹으면 **상위 회신가는 서버가
  계산한다**(하위가 × 환율 × (1+마진%)). 변환점(`selectedChildRfqId`·`marginRate`·`source*`)이
  행에 박제되는지까지 확인한다. 관리자↔MD 는 조직 기본 통화, MD↔하위는 **관계에 박제된 링크
  통화**라는 구분도 함께 지킨다.
- **EQ 위임**: 관계를 가진 조직이 수주한 상위 발주는 자체 EQ 를 못 한다 — 하위 발주 전에는
  `eq.blocked`, 하위 발주가 생기면 `eqDelegatePoId` 로 트랙이 넘어간다. EQ 승인 주체는
  그래도 관리자다(D3).
- **출고 게이팅**(이 여정의 핵심): 하위가 아직 MD 에 도착하지 않았으면 MD 는 상위로 내보낼 수
  없다(`OUTBOUND_BLOCKED`). **그 차단이 풀리는 순간이 하위 입고확인**이라는 것을 전후 대비로
  확인한다 — 막힘 → 입고확인 → 담기 성공.
- **2단 물류**: 하위 → MD 로 한 번, MD → 관리자로 다시 한 번. **받는측이 `md` 인 발송**은
  1~3호가 밟지 못한 조합이고, 구간마다 Invoice 가 따로 붙는다.

MD 는 **진행 중 수주 발주가 없는 조직**만 될 수 있다 — 전환하면 EQ 주체가 위임으로 바뀌므로
서버가 `PARENT_HAS_ACTIVE_POS` 로 막는다(첫 주행이 실제로 여기 걸렸다). 그래서 발주가 비어
있는 협력2를 MD 로 세우고 협력1을 하위로 둔다. 관계는 주행이 만들고 `afterAll` 에서 해제한다
(문서가 종결돼야 해제되므로 순서가 곧 검증이다).

검증: 9케이스, 2회 연속 동일 결과(재현성 — 관계 생성·해제가 매번 깨끗해야 통과한다),
HTTP≥400·pageerror 0, 정리 CLEAN(발주 2단·선적 2구간·관계까지).

### 재작업(중간 변경) 검증 1단계 — 가드 박제 + 무가드 실증 (2026-08-10)

여정 1~4호가 정상 경로만 밟는다는 공백을 채우는 작업의 1단계. 먼저 전 항목을 원본 코드로
재검증해(서브에이전트 조사 → 본 세션이 파일:줄 직접 확인) 확정된 것만 두 갈래로 나눴다.

**① `pcb-guards.e2e.test.ts` — 서버가 막는 것의 박제(회귀).** 코드로 확정된 409 가드 10종:
`NOT_ISSUED`·`HAS_CHILDREN`·`PRICE_LOCKED`·`EQ_LOCKED`·`PO_ISSUED`·`RECEIVE_LOCKED`·
`NOT_EDITABLE`·`ALREADY_ORDERED`(실데이터 read-only)·`IN_CART`·`ORDER_NOT_PAID`(뒤 둘은 대상
실데이터가 없어 skip — 사유 콘솔 출력). 각 테스트에 근거 파일:줄 주석, 409 뒤 "안 바뀌었는지"
재확인까지. 여정 4호에는 `PARENT_HAS_ACTIVE_POS` 어서션을 승격했다(협력1 진행 발주가 있을
때만 — 실측 409 확인).

**② `rework-probe.e2e.test.ts` — 서버가 막지 않는 것의 실증(탐색 주행).** 200 어서션은
**현재 동작의 기록이지 승인이 아니다** — 가드가 생기면 이 스펙이 빨갛게 되는 것이 신호이고,
그때 409 로 뒤집어 회귀로 승격한다. 실증된 조합(전부 재현 성공, findings-rework.md):

- **W2 선정 해제가 발주를 안 본다** — 해제 200, 발주 잔존, 형제 부활. 발주 근거가 사라진다.
- **W3 발주는 RFQ 상태를 안 본다** — 미선정(quoted) 행으로 발주 성립, **같은 견적에 PO 2장**
  공존, 발주 뒤 협력사가 회신가 수정 가능(스냅샷 300 vs 회신 999). 외화는
  `EXCHANGE_RATE_REQUIRED` 가 우연히 한 번 막지만(선정 박제 부재) 환율만 주면 통과 — KRW
  협력사는 그마저 없다.
- **W4 발주 취소가 송금 원장을 지운다** — cascade 소멸(0건), 증빙 sp_file 은 고아 잔존.
- **W5 발주 취소가 선적 멤버십을 고아로 만든다** — FK 부재. 담긴 채 EQ 를 issued 까지
  내리고 삭제하면 대표 없는 선적이 남는다(보드 GET 은 200 — 화면은 안 죽지만 문서가 고아).
- **W6 주문 완료 건 사양 수정 무가드** — 입금 완료 주문에서 200, 확정가·quoted 유지,
  **주문행(ct_option)은 옛값 그대로** — 고객이 결제한 사양과 불일치.
- **W7 Invoice 를 선적요청 진입 후 삭제** — 삭제 200, 이후 단계는 tracking 만 봐서
  **필수 서류 없는 국제 선적**이 진행된다.
- **W8 선적 생성 후 목적지 변경** — 발주는 직송 CN 인데 선적은 박제 그대로(국제·직송지
  null) — 문서와 실물 경로가 갈라진다.

정리 스크립트(`output/cleanup-probe.mts`)는 프로브 특유의 잔재(고아 멤버십·대표 없는 선적·
증빙 고아 파일)를 스펙 축 훑기로 걷는다 — 발주가 이미 삭제돼 poId 링크로는 못 찾는다.

**다음(2단계)**: 위 W 목록의 가드 신설 여부 결정. 권고 — W2·W3(선정↔발주 정합)과
W4(돈 기록 소실 — cascade 를 Restrict 로, 또는 취소 시 원장 이관)는 막는 쪽, W6 은
막을지(409) 경고 강화일지 실무 판단, W5 는 FK 추가(스키마 변경이라 공유 DB 규율 확인),
W7 은 첨부 삭제에 상태 가드, W8 은 선적 존재 시 목적지 잠금.

### 재작업 검증 2단계 — 가드 신설·프로브의 회귀 승격 (2026-08-10)

1단계가 실증한 무가드 조합에 가드를 넣고(전부 앱 가드 — 스키마 무변경, 공유 DB 규율),
`rework-probe.e2e.test.ts` 를 409 회귀로 뒤집었다. 각 가드는 **잠김 → 정리 → 열림** 순환까지
지킨다 — 막기만 하고 출구가 없으면 실무가 멈추기 때문이다.

- **W2 `PO_ISSUED`**(unselectPcbRfq): 같은 트랙(관리자행·회차)에 발주가 있으면 선정 해제 409.
  발주 취소가 먼저다.
- **W3 `RFQ_NOT_SELECTED`**(createAdminPcbPo): 견적행을 근거로 발주하려면 그 행이 selected
  여야 한다. rfq 없이 조건을 직접 넣는 수동 발주 경로는 그대로 — 잠근 것은 "미선정 회신을
  근거로 삼는 것"이지 직접 발주가 아니다.
- **W4 `HAS_REMITTANCE`**(deletePcbPo): 송금 기록이 있으면 취소 409 — cascade 로 돈 기록이
  조용히 사라지는 것을 막는다. 원장 삭제 라우트로 정리하면 열린다(leaf-first).
- **W5 `IN_SHIPMENT`**(deletePcbPo): 발송에 담긴 발주는 취소 409 — FK 없는 멤버십이 고아가
  될 길을 원천 차단. detach(박스에서 꺼내기) 후에만. FK 추가는 스키마 변경이라 보류하고
  앱 가드로 대신했다 — 가드가 있으면 고아 자체가 안 생긴다.
- **W7 `DOC_LOCKED`**(첨부 삭제 라우트 2곳 — 관리자·협력사): 발송이 preparing 이 아니면
  첨부 삭제 409. 되돌리면 교체 가능하고, **재진입은 Invoice 를 다시 요구**한다(순환 검증).
- **W8 `IN_SHIPMENT`**(patchPcbPo): 발송이 있는 발주는 직송지가 **실제로 바뀌는** 변경만 409
  — 같은 값 재전송·메모 등 다른 필드는 통과(잠금 범위를 좁게). detach 후에는 변경 가능.
- **W6 은 보류** — 주문 후 사양 협의(EQ 고객확인으로 합의한 변경을 관리자가 반영)가 실무에
  있어 서버 차단은 그 창구를 없앤다. 프로브는 현재 동작(200·주문행 옛값)을 계속 기록하며,
  정책이 정해지면 뒤집는다. findings 의 bug 표기는 "미해결 결함 후보"라는 뜻으로 유지.
  → **08-10 사용자 결정: 허용(수정 가능 유지)** — 주문행 동기 구현으로 종결(아래 3단계 뒤 기록).

검증: probe 8/8(신설 가드 6종 전부 409+순환) · **여정 4종 41/41**(가드가 정상 경로 무영향 —
전부 selected 발주라 통과) · pcb-guards 8/2skip · vitest 737 · typecheck·lint 0건 · 정리 CLEAN.

### MD 시나리오 1 — 2단 견적 루프, mdtester 상설 픽스처 (2026-08-10)

mdtester 를 주인공으로 한 MD 시나리오 연작의 첫 편(`md-quote-loop.e2e.test.ts`). 가장 간단한
것부터 — 주문·발주·물류 없이 **견적요청이 MD 를 거쳐 내려갔다 마진을 얹고 올라오는 루프**만
본다. RUN 게이트만이라 거버·고객 자격 없이 도는 경량 스펙이다(기본 e2e 에 포함).

- **상설 픽스처**: dev DB 의 mdtester 는 g5 회원(마스터딜러·level 2)만 있었고 조직·연결·관계가
  없었다 — 스펙의 사전 준비가 **없으면 만들고 있으면 재사용**한다(idempotent):
  조직 `마스터딜러상사`(KR·KRW·pcb_rfq) + sp_partner_member 연결 + 관계 →협력2(링크 USD).
  여정 4호처럼 만들고 지우는 게 아니라 이후 MD 시나리오들이 공유할 무대로 남긴다.
  관계 생성은 관리자 API 경유 — MD 전환 가드 검증을 겸한다.
- **루프 검증**: 관리자→MD 배정(통화 KRW=조직 기본 박제) → MD 포털 목록 노출 → 하위 재배정
  (통화 USD=**관계 박제 링크 통화** — 조직 기본과 별개) → 하위 회신 USD 200 → MD 선정+마진
  15% → 상위 회신가 자동 산출(200 × 당일 환율 × 1.15 = 실측 ₩329,889)과 변환점 박제
  (selectedChildRfqId·marginRate·source*) → 관리자 워크큐에 quoted 로 노출.
- **화면 실측**: mdtester 스텁 로그인으로 포털 RFQ 상세 — '하위 협력사 견적 (마스터딜러)'
  섹션에서 선정 라디오·마진 입력·"현재 회신가 ₩329,889" 자동 표기 확인(스크린샷).
- **정리**: 주행이 만든 RFQ 행만 삭제(스펙 무접촉·잔재 0 어서션) — 픽스처는 남는다.
  2회 연속 5/5(재사용 경로 포함).
- **다음 편 후보**: 루프 이후를 주문에 연결(관리자 선정+확정가 → 고객 주문 → MD 발주 →
  EQ 위임 — 여정 4호와 달리 상설 픽스처 기반), MD 하위 재선정(마진 변경·다른 하위로 교체),
  하위 배정 회수. → **2·3편으로 구현 완료(아래)**.

### MD 시나리오 2·3 — 주문 연결 완주, 하위 재선정 (2026-08-10)

**2편 `md-order-relay.e2e.test.ts`**(JOURNEY — `pnpm -F e2e md`): 1편의 견적 루프 뒤를 실제
주문에 붙여 배송 완료까지. 여정 4호(CN MD·관계 임시)와 달리 **국내 MD**(마스터딜러상사·KR)
상설 픽스처 기반이라 물류 모드 조합이 뒤집힌다 — 4호가 못 밟은 조합이 이 편의 차별점:

- 하위(협력2·CN) → MD(KR): **받는측 md 인 국제** 6단계(Invoice 필수·AWB·MD 입고확인)
- MD(KR) → 관리자(KR): **국내 3단계** — `RECEIVE_REQUIRED`(입고확인 없는 delivered 전이 409)
  를 지나 입고확인이 종점을 닫는 P4.10 경로를 MD 구도에서 재확인
- 그 사이 출고 게이팅(하위 입고 전 상위 담기 409 → 입고 후 200)과 EQ 위임·selected 견적행
  발주(2단계 가드 `RFQ_NOT_SELECTED` 의 정상 경로)까지. 6/6 완주, 잔재 정리 CLEAN
  (정리는 cleanup-probe 스타일 스펙 축 훑기 — **관계·조직은 상설이라 건드리지 않는다**.
  여정 4호용 cleanup-md 는 관계를 해제하므로 이 편에는 쓰면 안 된다).

**3편 `md-quote-rework.e2e.test.ts`**(RUN 만 — 기본 e2e 포함): MD 가 마음을 바꾸는 경우들.
픽스처에 관계 하나를 더 얹는다(마스터딜러상사→협력1·**KRW**) — 하위가 둘이어야 교체가 된다.
같은 MD 의 하위라도 **링크 통화가 관계별로 따로 박제**됨(협력1 KRW·협력2 USD)을 배정에서 확인.

- 마진 변경: 같은 하위 재선정(10%→25%)으로 상위 회신가 재계산
- 하위 교체: USD 협력2 → KRW 협력1 — `source*` 가 통화까지 갈아끼워지고 KRW→KRW 는 환율 1
- 선정 해제(childRfqId null): 상위 회신 전면 소거(가격·마진·원가 흔적) → `requested` 복귀
- 배정 회수 diff: 회신 완료 행은 체크를 빼도 **보존**된다(회수는 requested 만 물리 삭제).
  미회신 행의 실제 삭제는 하위 후보가 더 없어 이 스펙에서는 미도달 — 후속 후보.

5/5 · 2회 연속(픽스처 재사용 경로 포함). 정리는 생성 RFQ 만 삭제(스펙 무접촉).

### 재작업 검증 3단계 — 취소 주문의 새 작업 차단 `ORDER_CANCELED` (2026-08-10)

1단계 목록에서 "미확인이라 제외"했던 조합 — **주문을 취소한 뒤에도 협력 트랙이 계속 전진**
— 을 실증하고 가드를 넣었다. 협력 트랙(sp_pcb_*)은 주문(od)을 전혀 참조하지 않아, 취소된
주문의 발주가 EQ 승인·생산·발송까지 그대로 갈 수 있었다.

- **판정 헬퍼 `isPcbOrderCanceled`**(pcb-shipment.ts): spec.ctId → 주문 od_status='취소' 여부.
  '완료'는 제외 — 완료 후 재작업은 A/S 재발주(미구현) 설계와 얽혀 별도 결정.
  ⚠ **2026-08-11 갱신**: 이 od 단위 판정으로는 **부분 취소가 통째로 새어 나갔다**(여정 10호).
  현재 이름·의미는 `isPcbOrderLineCanceled` — od 헤더 '취소' **또는 그 줄 ct_status 취소류**.
  아래 가드 3지점 + A/S 접수/진행이 그 판정을 공유한다. 상세는 '여정 10호 … 교정' 절.
- **가드 3지점** — 새 작업(전진)만 막고 **정리는 연다**(잠김→정리→열림 원칙):
  - `advancePcbPoEq`: EQ 전진(승인요청·승인·생산 전이) 409. **revert 는 통과** — 취소 뒷정리
    (되돌린 뒤 발주 취소)가 막히면 안 된다.
  - `createChildPcbPo`: MD 하위 발주 신설 409 — 취소된 주문 밑으로 새 계약이 자라는 것 차단.
  - `ensurePcbShipment`: 발송 담기 409 — detach(정리)는 ensure 를 안 타므로 자연히 허용.
- **주문 취소의 정식 경로**: force-status 의 target enum 에 '취소'가 없다(의도 — 스톡 앵커
  체인과 별개). 취소는 `PATCH /orders/:odId/items/status`(카트행 취소, 무통장 한정, 재고
  복원·전량이면 od_status='취소')가 정본 — W9 도 이 경로를 쓴다.
- **probe W9**(rework-probe): 발주 → EQ 파일 2종 → 승인요청 → 카트행 전량 취소(orderCancelled
  =true) → eq-approve 409 `ORDER_CANCELED` → revert 200(정리) → 발주 취소 200(순환 완주).
- **여정 1호 S6 보강**: 주문 직후(입금 전) RFQ 재발송이 409 `ORDER_NOT_PAID` — pcb-guards
  에서 실데이터가 없어 skip 이던 가드를 여정의 실상태로 어서션(발주 게이트의 앞단 확인).
- **프로브 함정 교정**: W7·W8 시드가 `pickFreeSpecs`(PO 유무만 봄)로 뽑혀 **이 주행이 방금
  만든 거버 스펙 B**(최신·PO 없음·주문 연결)를 선점 → W9 의 발주와 UK(ALREADY_ISSUED) 충돌.
  시드 선택을 `ctId null`(주문 무관) 필터로 좁혀 해소(`pickSeedSpec`) — md-quote-loop 이
  먼저 밟은 함정과 동형.

검증: probe **9/9**(W9 순환 포함) · 여정 1호 11/11(ORDER_NOT_PAID 어서션 포함) · vitest 737 ·
typecheck·lint 0건 · 정리 CLEAN(취소 주문도 force-status '주문' 복귀 후 삭제 정상).

### 재작업 W6 종결 — 주문 후 사양 수정 허용, 주문행 표기 동기 (2026-08-10)

2단계에서 보류했던 W6 을 사용자 결정("주문완료 되었어도 수정하게")으로 종결 — **차단하지
않고 허용을 유지**하되, 프로브가 결함으로 박제했던 "주문행 옵션 옛값 불일치"를 동기로 없앤다.
주문 후 사양 협의(EQ 고객확인으로 합의한 변경의 반영 창구)는 그대로 살아 있다.

- **`updateOrderedCartOption`**(g5-db.ts): 주문된 행은 **ct_option(사양 표기)만** 갱신.
  결제 검증 링크(io_id·io_price)·금액(ct_price)은 결제 당시 기록이라 불변 — 코어
  before_check_cart_price 대조 축을 건드리지 않는다. od_mod_history 도 append 안 함
  (코어 관례상 취소·수량변경 블록 전용, 사양 감사는 sp_quote revisedBy·reason·quoteId
  체인이 정본).
- **spec 라우트 분기 확장**(admin-pcb-projects.ts): 기존 `cart` 분기(io 교체 3단)에
  `ordered` 분기 추가 — buildOptionSummary(새 사양, 수량)로 표기만 동기. 자동견적 불가
  (rfq) 사양이어도 동기한다(결제는 끝났고 표시 정합이 목적이라 listPrice 무관). 실패 시
  409 `ORDER_SYNC_FAILED`(같은 사양 재시도로 복구 가능). 발주 후는 여전히 `PO_ISSUED`.
- **응답·화면**: AdminSpecReviseResponse 에 `orderRowSynced` 추가, PcbSpecEditModal 결과
  화면에 "주문행 표기도 갱신됨 — 결제 금액 불변" 고지.
- **probe W6 를 회귀로 승격**: [보류] 딱지 제거. **ct_option 요약(재질/층수/크기/수량)에
  silkscreen 은 안 실리므로** 수량 변경(+100)을 함께 보내 `Npcs` 문자열 변화를 확정 증거로
  삼는다(문자열에 안 드러나는 필드만 바꾸면 동기가 되어도 검증이 안 되는 함정). 어서션 =
  orderRowSynced true · ct_option 새 수량 포함 · ct_price/io_id/io_price 불변 · 확정가
  60,000 유지 · quoted 유지. findings bug → obs 전환.

검증: probe 9/9 · vitest 737 · turbo typecheck 8/8 · lint 7/7 · 정리 CLEAN.

### P4.12 구현 기록 (2026-08-10 — A/S 재발주 회차: 케이스·회차 발주·화면)

레거시 sp_pcb_as_case(정본 sp-smartbom-web/doc/pcb-as-reorder.md — 백엔드·프론트 전수
실측 후 이식)를 플랫폼으로 승계. **얇은 접수 헤더 + proceed 시 회차 채번 + 원발주 복사**
모델. 케이스는 합의 기록이고 재생산은 회차 발주서(reorderRound>0)가 기존 EQ·선적
파이프를 그대로 탄다 — MD 하위 발주(회차 상속)·선적 박스(contextKey 에 회차 편입)는
이미 준비돼 있어 무변경.

- **스키마**: `SpPcbAsCase`(마이그 20260810150000) — specId 앵커, UK(specId, reorderRound),
  reorderRound **NULL 시작**(초안이 회차를 점유하지 않음 — proceed 시 케이스 축 MAX+1,
  InnoDB tx 라 레거시 MyISAM 채번 경합 해소). 상태 draft→submitted→accepted|rejected→
  proceeded(D4 영문). caseType admin_fault|product_defect, chargeType paid|free(기본:
  실수=유상/불량=무상 — `defaultPcbAsCharge` 계약 공용).
- **개시 가드**: 대상 협력사의 원주문(round 0) 발주 존재(NO_ORIGIN_PO) + **취소 주문
  차단(ORDER_CANCELED — 사용자 결정: 결제가 사라진 주문의 재생산은 성립 안 함)**.
  완료·선적 상태는 검증하지 않는다(레거시 동형 — 개시 시점은 관리자 재량).
- **proceed**: 최상위 원발주(직거래=대상, MD=관리자→MD A) 복사 — 가격 일체·직송지·
  지불조건·rfq 참조·memo 복사, status=issued·eqHistory=[]·송금 0. **납기는 비운다**
  (레거시 stale 복사 함정 교정). MD 하위 B 는 MD 가 포털에서 발주(회차 자동 상속).
- **레거시 갭 6종 교정**: ① proceed 응답 poId(딥링크) ② 접수 회수(submitted→draft)
  ③ 협력사 회신 첨부 구현+uploadedBy 역할 분리(레거시는 회신이 관리자 첨부를 통째로
  덮어씀) ④ 채번 tx ⑤ 납기 비움 ⑥ 알림(접수→협력사 메일, 회신→관리자 메일 —
  레거시는 전무).
- **화면**: Case 상세 'A/S 재발주' 패널(접수 모달·첨부·회수·대행 회신·진행 — 진행 중
  건 있으면 자동 펼침) + 포털 `/partner/pcb/as`(회신 대기 카드·사진 첨부·이력·MD 중계
  열람) + 홈 배너(회신 대기 있을 때만). 회차 배지 "A/S N차"는 포털 발주 목록·상세
  계약에 reorderRound 추가로 완성(관리자 축은 P2~P3 선반영 확인).
- **스펙 삭제 연동**: quote-delete·pcb-case-delete 가 A/S 첨부(sp_file
  refType 'sp_pcb_as_case')까지 걷는다(실파일 먼저 → DB 불변식·프리뷰 카운트).
- **검증**: 스모크 20/20(`e2e/output/smoke-as-case.mts` — 기본 비용 규칙·역할 격리·
  전송 후 고정·회수 출구·거절 종결(삭제 409)·proceed 회차 발주 복사 필드·중복 진행
  409·EQ 파이프 연결) · vitest 738 · typecheck 8/8 · lint 0건 · Mailpit 실수신.
- **여정 5호 완주(`journey-as-reorder.e2e.test.ts`, `pnpm -F e2e journey:as`)**: 원주문
  압축 완주(주문 '완료'까지) → 접수(불량=무상 기본) → 협력2 수락 → proceed(poId 342 ·
  round 1 · 조건 복사 · 납기 null 실측) → 회차 EQ~생산 재진행 → **회차 발송 분리**
  (원발주 선적과 별개 발송 생성 · 원발주 done 무간섭 — contextKey 회차 편입 실증) →
  화면 실측(Case A/S 패널·'1차' 배지·포털 'A/S 1차' 배지). 9/9 green · findings
  bug 0 · 정리 CLEAN(케이스는 스펙 FK cascade 소멸 확인).

### P4.13 구현 기록 (2026-08-10 — 고객 주문 상세의 제작 진행 상황)

od 는 '입금'에 머무는데 실제 제작은 EQ→생산→발송→입고로 움직인다 — 그 간극을 **od 무접촉**
으로 메운다(D6 "od 동기 1차 수동" 결정 유지). 협력 트랙(sp 축)에서 진행 단계를 파생해 고객
주문내역 상세에 보여줄 뿐, 주문 상태는 바꾸지 않는다.

- **판정**(lib/pcb-customer-progress.ts, 유닛 4): 최상위 발주(parentPartnerId 0)의 **최신
  회차** 기준 — issued·eq_requested·eq_done→'제조 확인(EQ) 진행 중' / producing→'생산
  진행 중' / produced→발송 신호로 세분(없음·preparing→'발송 준비 중', 진행→'입고 운송 중',
  receivedAt→'입고 완료 — 배송 준비 중'). 회차>0 이면 'A/S 재생산 — ' 접두. 발주 전이면
  항목이 없어 섹션 미노출(이관 주문 무해). 협력사명·발주 정보 비노출(P4.1 관례).
- **채널**: P4.1 EQ 고객확인과 같은 브리지 — sp-node `GET /api/pcb-progress?odId=`(회원
  소유 판정) + PHP `sp_pcb_progress()`(sp_pcb_eq.extend.php) + 테마 orderinquiryview
  '제작 진행 상황' 섹션(EQ 섹션 위) + default_shop.css(#sod_fin 스코프, G5_CSS_VER 26081002).
- **실측**: 여정 1호 재주행 11/11 — S9 스크린샷에서 od '입금'(완불) 상태의 주문 상세에
  "제조 확인(EQ) 진행 중 · arduino-uno.zip" 카드 렌더 확인. 정리 CLEAN.

### 국가×물류모드 매트릭스 완성 — MD 4·5편 + 여정 6호 (2026-08-10)

관리자=KR 고정에서 모드는 "발송자국가=수신국가 → 국내 / 다르면 국제"의 이진 파생이라,
실질 등가류는 MD 2×2 + 직송 축뿐이다. 남은 칸 전부를 3편으로 채웠다(17케이스 green,
매 주행 cleanup-probe CLEAN).

- **MD 4편 `md-domestic-relay`(`md:domestic`, 6/6)**: 전 구간 국내(KR MD) — 하위(협력1
  KR)→MD(KR) **receiverKind md 의 domestic 최초**(MD receive 가 delivered 종점을 닫음,
  Invoice 불요), 출고 게이팅이 국내 leg 에서도 동작(담기 전+배송 중 2지점 409 — 해제
  열쇠는 모드가 아니라 receivedAt), MD→관리자 국내(RECEIVE_REQUIRED→입고확인 종점).
- **MD 5편 `md-cn-relay`(`md:cn`, 6/6×2회)**: **상설 픽스처 신설** — 조직 #8
  `mdtester2상사`(CN/USD)+계정 mdtester2(g5_member 미러 INSERT — 연결이
  MEMBER_NOT_FOUND 를 검증함을 실측)+관계 #8→협력2(USD, **다중 상위 공존 실증**).
  협력2(CN)→mdtester2상사(CN) **비KR domestic 최초** + CN→KR 국제 6단계 완주.
- **여정 6호 `journey-direct-ship`(`journey:direct`, 5/5×2회)**: 직송 3종 — CN→직송
  CN(비KR 국내)·CN→직송 VN(양끝 비KR 국제)·신규 조직 #9 `e2e한국협력`(KR)→직송
  CN(국제). 같은 협력2인데 직송지 축으로 **다른 박스**(contextKey admin:0:CN vs VN),
  Invoice 요구는 모드 파생을 따름(국제만 MISSING_INVOICE_FILE).

**발견 결함 2건(서버 무수정 — 스펙은 현재 동작 박제, 후속 수정 대상)**:
① **직송 배송 큐 오판**: 직송(CN→CN) 완료 건이 관리자 고객 배송 큐 to_ship 에 노출
(g5-db.ts PCB_SHIP_JOIN/PCB_TO_SHIP 이 receiverKind='admin'∧receivedAt 만 보고
shipment.destinationCountry 를 구분 안 함) — 관리자가 실물을 안 받았는데 운송장 입력을
요구받는다. 단 직송 주문의 od 종결 경로가 현재 이 큐뿐이라 정책 판단 병기.
② **조직 삭제 API 의 PCB 축 가드 공백**: DELETE /admin/partners/:id 선제 가드가
sp_bom_rfq 만 검사 — PCB PO 보유 조직 삭제 시 FK P2003 **안내 없는 500**(BOM 처럼
409 안내 필요).

### 재점검 확정 결함 11건 수정 (2026-08-10 — 신규 시나리오 4종 화면 전수 재점검의 산출)

여정 5·6호+MD 4·5편을 화면 관찰 중심으로 재주행(발견 20건 리스트업)한 뒤, 원인이 특정된
확실 항목만 엄선 수정. 스키마 무변경(전부 앱 층).

- **돈 축**: ① 무상(free) A/S 회차 발주를 송금·수금 **집계에서 제외**(잔액 0)+'무상 A/S'
  배지(isFreeAs 계약 추가 — proceed 의 조건 복사는 원가 회계용 유지, 유상은 현행) ② 관리자
  송금 워크큐에서 MD 하위 발주 제외(parentPartnerId=0 — 지급 주체는 MD, 이중 지급 유도 차단)
- **안전**: ③ 조직 삭제 — sp_pcb_rfq·po 선제 409 PARTNER_HAS_PCB_DOCS+P2003 catch,
  confirmDialog 선행, Prisma 오류 원문 렌더 제거
- **고객 카드**: ④ od 배송·완료·취소면 진행 카드 숨김(코어 배송정보가 정본) ⑤ 선적요청
  (requested)은 '발송 준비 중'(운송은 shipped 부터) ⑥ 직송 건 어휘 치환('주문지로 직송
  배송 중'/'직송 배송 완료' — '입고' 거짓말 해소)
- **화면**: ⑦ 발주 큐 협력사 셀 nowrap ⑧ 선적 큐에 '직송 {국가}'·'N차' 배지(워크아이템
  계약 확장) ⑨ 포털 A/S proceeded 안내를 회차 발주 딥링크로(**뷰어가 열 수 있는 발주만**
  — MD 경유 대상 협력사는 하위 회차 발주, 없으면 null) ⑩ 보드 완료 발송을 아카이브
  RouterLink 로 ⑪ Case 회차 접힘 카운트 명시+토글 라벨·위치 정제+A/S 접힘 바 진행 중 강조
- **보류(정책)**: 직송 건의 고객 배송 큐 오판(od 종결 창구 대체 설계 필요)·국제 선적
  어휘 전면·A/S 진행 스펙의 진행현황 탭 편입 → **아래 절에서 3건 모두 확정 구현(08-10)**.
- 검증: typecheck 8/8·lint 7/7·vitest 744·여정 as 9/9·direct 6/6(J5 를 409 로 뒤집고
  J6 신규 — 직송 어휘·카드 숨김 실화면)·md:cn 6/6·전부 CLEAN·실데이터 스모크 16 어서션.

### 정책 보류 3건 확정 구현 (2026-08-10 — 직전 절 '보류(정책)' 해소, 스키마 무변경)

- **① 직송 건의 고객 배송 큐 — 제거 대신 전용 종결 동선**: 직송 주문의 od 종결 창구가
  이 큐뿐이므로 **남기되 구분**한다. `AdminPcbOrderItem.directShipCountry`(최상위
  parentPartnerId=0·최신 회차 발주의 destinationCountry) 계약 확장 → 배송 큐 행
  '직송 {국가}' 배지 + [배송 처리]→**[직송 완료]**: 운송장 입력 없이 confirmDialog
  ("고객이 현지({국가})에서 수령…완료로 종결") 후 기존 코어 `PATCH /admin/orders/:odId/
  force-status` target '완료' 재사용(신규 라우트 없음 — 재고 앵커는 완료 진입 차감이라
  보존, 배송 필드 무접촉). Case 헤더 유도 배지도 직송이면 '직송 완료 대기 · 직송 완료 →'
  (같은 동선). 큐 소속 판정(PCB_TO_SHIP)은 불변.
- **② 직송 국제 선적 어휘 — BOM 코드사전 무접촉 표시층 치환**: `apps/web/src/lib/
  pcb-shipment-label.ts` 래퍼 `pcbShipmentStatusLabel(mode, status, {directShip})` —
  직송지가 비KR 인 **국제** 체인의 'arrived' 표시만 '국내도착'→'현지도착'(다음 단계
  버튼 '[현지도착 진행]'·스텝퍼·프롬프트 제목 동일). 판정 헬퍼 `isPcbDirectShipIntl`
  (destinationCountry ≠ null·≠ 'KR'). 소비처: AdminPcbCase 선적 행(하위 발주 포함)·
  AdminPcbShipments 협력사 선적 큐·PcbShipmentCard(포털 보드·아카이브) — 셋 다
  destinationCountry 를 이미 알아 계약 확장 불요. 상태 코드·전이 사전(bom-po.ts §D22)과
  서버 발신 메일(pcb_shipment_turn statusLabel)은 현행 유지(범위 밖).
- **③ 진행현황 step·구간 판정 축 = 최상위 발주의 최신 회차**: `apps/api/src/lib/
  pcb-case-step.ts`(순수 함수 — pcbStepOf 이동+`resolvePcbAsRoundState`+`pcbCaseStepOf`)
  + g5-db `PCB_AS_OPEN_JOIN`(SQL 면 — 탭 소속·counts). od 가 완료·취소여도 최신 회차
  (round>0) 발주가 미종결(선적 done/delivered/입고확인 전)이면 '발주·생산' 탭에 서고
  step 도 그 회차의 신호(EQ·생산·발송)로 계산한다(od 12 고정 해제 —
  lib/pcb-customer-progress 고객 카드와 같은 축). 계약 `asRound`/`asOpen` 확장, 행 배지
  'A/S N차 진행'(종결 회차는 'A/S N차'). **원발주-only(round 0 최신) 판정 불변** —
  DB 전수(스펙 20,941) 구/신 판정식 카운트 비교로 이동분이 A/S 진행 스펙뿐임을 실측
  (0건일 때 198/20,607 동일, A/S 1건 진행 중일 때 정확히 그 1건만 이동).
- 검증: typecheck 8/8·lint 7/7·vitest 756(신규 pcb-case-step 12)·journey direct 6/6
  (J3 오판 박제를 directShipCountry·큐 유지로 뒤집고 J6 를 [직송 완료] UI 실행으로 재구성
  — confirmDialog 문구·완료 도달·운송장 불변·고객 카드 숨김, J2 에 현지도착 실화면 추가)·
  journey as 10/10(R8 신규 — production 편입·closed 제외·step 11·'A/S 1차 진행' 배지)·
  md:cn 6/6·cleanup-probe 각 CLEAN. 함정 메모: g5_shop_order.od_delivery_company 는
  컬럼 기본값이 '0' — "운송장 없이"의 어서션은 빈 문자열 가정이 아니라 **불변 비교**여야
  한다(J6 실측).

### 재점검 '의심' 6건 재검증 — 전부 문제 확정·수정 (2026-08-10)

낮은 확신으로 분류했던 6건을 코드+실측으로 다시 세웠더니 **전부 실제 문제**였다. 판정
근거를 먼저 만들고 확정분만 최소 수정한다는 순서를 지켰다.

- **포털 A/S 이력 진입점**: `partner-pcb-as` 라우트 참조가 전수 2곳(정의+회신 대기 배너)
  뿐 — proceeded 이후엔 URL 직접 입력만 가능했다 → 홈에 "A/S 내역 N건 보기"(케이스가
  있을 때만, '완료된 발송' 링크와 같은 결).
- **무계정 조직의 포털 CTA**: 연결 계정 0인 조직이 받은 EQ 결정 메일의 버튼을 실제로 열어
  보니 로그인 벽 → 가입해도 `requirePartner` 403 = **실행 불가 CTA** → 멤버 유무를 조회해
  버튼 대신 대행 안내(+운영자 문의처). 조회 실패는 기본 true 라 발송을 막지 않는다.
- **원발주→회차 역링크 부재**: 상세가 자기 회차만 알고 형제 회차를 몰랐다 →
  `PartnerPcbPoDetail.asRounds`(내가 볼 수 있는 회차 발주만 — MD 는 수주 문서 우선).
- **MD 하위 발주 행 라벨**: produced 뒤에도 'EQ 진행 →' 하드코드 → '생산 완료 — 보기'.
- **상설 픽스처 협력2 이메일 공백**: pcb_* 메일 474건이 `missing_recipient` 로 skipped 되던
  dev 검증 공백 → 관리자 API 로 `partner2@test.local` 일회 세팅(협력1 은 진행 중 실데이터라
  미세팅), 파트너향 11통 실수신 확인.
- **포털 EQ 파일 '0KB'**: 인라인 나눗셈이 512B 미만을 0 으로 → 공용 `formatBytes`.

검증: vitest 759 · journey:as 10/10 · 포털 스모크 35 · 정리 CLEAN.

### 무계정 조직 대행 안내 — 협력사향 메일 전수 확대 (2026-08-10)

EQ 결정 메일에만 있던 위 분기를 `lib/pcb-portal-cta.ts`(`resolvePcbPortalCta`)로 승격해
협력사향 포털 CTA 메일 전부에 적용: 발주서 도착 · 선적 차례(**협력사/MD 수신분만** —
관리자 수신은 무분기) · 입고 확인 · A/S 검토 요청("관리자 대행 회신으로 처리됩니다").
RFQ 요청은 매직링크가 무계정도 실행 가능하므로 제외하고 **매직링크 없는 폴백 CTA 만**
분기한다(토큰 없을 때만 판정 — 불필요 쿼리 회피). 빌더 파라미터 기본값 true 라 기존
호출부는 무파손. 유닛 14 · vitest 770 · Mailpit 대조(무계정 4통 대행 안내 / 협력2 버튼 유지).

### 여정 7호 A/S 심화 + MD 경유 회차 하위 발주 개방 (2026-08-10)

**여정 7호**(`journey-as-advanced`, `journey:as2`, 14케이스): MD 경유 A/S(proceed 분기의
첫 실검증) · rejected 케이스가 회차를 점유하지 않아 **round 2 로 채번** · 유상/무상 회차의
송금 큐 대조(무상 제외 수정의 대조군) · 회차 EQ 고객확인 · 관점별 딥링크 회귀.

**발견 → 수정**: proceed 는 A(관리자→MD)만 만드는데 하위 발주(`children`)가 **같은 회차의
하위 RFQ 를 필수**로 요구했고, 회차(round>0) 하위 RFQ 를 만들 경로가 서버에 없어 MD 경유
A/S 가 dead-end 였다. 배정(`partner-pcb-rfqs` 는 앵커 회차를 전파)·발주의 회차 상속
메커니즘은 이미 있고 **시작점(회차 앵커 RFQ)만 없던 것** — 시드 직삽입으로 상속 로직의
정상을 분리 실증한 뒤 확정했다.
→ **회차 하위 발주는 childRfqId 없이 원회차(round 0) 하위 발주의 조건을 복사해 발행**
(납기는 비움 — proceed 의 A 복사와 대칭, 레거시 동형: 레거시도 하위 RFQ 없이 회차 직발주).
round 0 은 `CHILD_RFQ_REQUIRED` 로 서버가 되막아 기존 규율 불변(계약 완화가 규율을 약화하지
않는다). 계약: `childRfqId` optional + `partnerId`, `PartnerPcbPoDetail.originChildPos`
(additive). 포털 A 상세에 **[원발주 조건으로 하위 발주]** 버튼(기발주 대상 제외 후보).
Case 발주 패널의 하위 서브테이블도 같은 회차만 부착(childCount 와 동일 규칙).

검증: as2 14/14(**시드 우회 제거** 후 신경로+화면 버튼 실발행·가드 4종 회귀) · md:cn 6/6
(round 0 규율 회귀 2건 추가) · journey:as 10/10 · vitest 770 · CLEAN.

### 견적관리 rfq 행 레이아웃 붕괴 교정 (2026-08-10 — P4.9 문구의 뒤늦은 부작용)

P4.9 에서 넣은 rfq 안내 문구가 고객 견적관리(`/shop/quotes`)에서 **사양 텍스트를 한 글자씩
세로로 쪼개는** 붕괴를 일으켰다. 카드 우측 열(`.sp-cart-calc`)이 `flex: 0 0 auto` 라 **줄
하나가 길면 그 줄의 max-content 만큼 열이 통째로 넓어지고**, 남은 폭을 받는 사양 열
(`.sp-cart-info`)이 0 까지 밀린다 — 브라우저 실측으로 문구 474px → 열 490px → 사양 열
**0px**(높이 645px)를 확인했다(9행 중 rfq 4행). 옆줄 `tax-detail` 이 같은 이유로 이미
`max-width: 280px` 를 쓰고 있어 대기 문구도 같은 폭으로 묶었다(`G5_CSS_VER` 26081003).
**이 열에 문장을 넣을 때는 폭을 묶어야 한다**는 규칙을 CSS 주석에 못박았고, 여정 공용부가
매 주행 사양 열 폭을 재 회귀를 잡는다(아래).

**회귀 가드**: `helpers/journey.ts` 가 거버 제출 직후(=rfq 행이 뜨는 시점) 견적관리 행의
사양 열 폭을 재서 0 이면 findings 에 bug 로 남기고, 여정 1호는 그것을 어서션으로 굳힌다 —
같은 열이 무너진 것이 tax-detail 에 이어 **두 번째**라 사람 눈이 아니라 주행이 잡게 했다.

### 여정 9호 — 다중 고객 × 묶음 발송 (2026-08-10)

그전까지 모든 여정은 **고객이 하나**였다. 주문이 둘인 3호도 주인이 같아 "남의 것이 안
보인다"가 한 번도 시험되지 않았는데, 정작 박스 합류 키(`받는측:조직:직송지:회차`)에는
**고객 축이 없어** 서로 다른 고객의 물건이 한 상자에 섞이는 것이 **정상 동작**이다.
격리를 가정이 아니라 검증 대상으로 끌어온 여정이다(`journey:multi`, 10케이스).

- **2번 고객 픽스처**: `ensureSecondCustomer()`(helpers/seed.ts)가 1번 고객의 **회원 행을
  통째로 복제**해 `e2e-customer2` 를 만든다(idempotent·상설). 행 복제인 이유가 둘 —
  ① 비밀번호 해시를 그대로 가져오므로 자격이 아이디 하나만 다르고 **원문이 코드·문서·
  .env 어디에도 늘지 않는다** ② 주소·등급·수신동의까지 같아 주문서 자동 채움 조건이 1번
  고객과 동일하다(두 고객의 차이가 '누구냐' 하나로 좁혀져야 격리 대조가 성립한다).
  `newPhpSession` 이 호출마다 새 BrowserContext 라 두 세션이 동시에 살아 있어도 쿠키가
  섞이지 않는 것까지 실증했다. g5 `mdtester2` 에 같은 방식의 선례가 있다.
- **검증 3축**: ① 주인이 다른 두 발주가 **한 박스에 합류**(contextKey `admin:0:-:r0`) —
  키에 고객 축이 없다는 설계의 실증 ② **정보 격리** — 화면(주문내역·상세·진행 카드·
  **남의 상세 URL 직접 접근**)과 API(`pcb-progress`·`pcb-eq-reviews` 교차 조회 0건, 남의
  EQ decide 404 + 상태 불변)를 **자기 것 양성 대조와 함께** 확인(빈 배열이 '라우트 사망'이
  아님을 보증) ③ **cross-member 배송 큐** — 한 번의 묶음 입고로 **회원이 다른** 두 주문이
  함께 to_ship 에 오르고 개별 운송장으로 각자 완료(3호가 같은 회원이라 못 밟던 칸).
- 결과: **10/10 green(2회) · 격리 위반 0 · 서버 결함 0** · 정리 CLEAN(회원 픽스처는 유지).
  1차 주행의 실패는 테스트 기대값 오류였다 — contextKey 의 직송지 null 은 `-` 로 렌더된다.
- **함정**: 같은 픽스처 zip 을 쓰면 두 고객의 projectName 이 같아져 "남의 프로젝트명 부재"
  검사가 무의미해진다 → 제출 직후 프로젝트명을 고객별로 갈라 두는 것이 격리 검증의 전제.
  정리도 두 고객 축을 함께 걷어야 한다(`cleanup-probe.mts` 의 CUSTOMERS 목록).
- 번호의 빈칸: **8호는 송금 원장 완주(돈 축)** 자리로 비워 뒀다 — 미착수.

### 여정 9호 재점검 — 확정 발견 전량 수정 (2026-08-10)

여정은 10/10 green 인데, **여정이 열지 않는 화면**에서 결함이 나왔다. 완주 스펙은 상태를
끝까지 밀어 버려 "한 박스에 두 주인"이 화면에 남지 않으므로, 같은 절차를 재현하며 국면마다
멈추는 관찰 러너로 34개 화면(스크린샷+innerText+원 API 응답)을 떠서 대조했다. 확실성이
'확정'인 것만 골라 전량 고쳤다.

- **동반 건 Case 의 선적 패널 실종**(가장 컸다): 묶음의 대표가 아닌 쪽 Case 에는 운송장·
  입고일·[입고 확인]이 하나도 안 떴다 — **서버는 shipments 를 정상적으로 내려주는데**
  프런트가 `s.poId === poId` 로만 행을 냈고, 묶음은 Case(고객) 경계를 넘으므로 동반 Case 엔
  대표 행 자체가 없었다. `caseAnchorPoOf` 로 **대표가 남의 Case 면 이 Case 의 최상위 발주가
  대표를 대신 맡게** 했다(서버는 구성원 어느 poId 로도 발송을 찾으므로 전이·입고 버튼도
  그대로 동작한다).
- **선적 큐가 대표만 보여 동반 건이 막다른 길**: 워크아이템 계약에 `members[]`(poId·specId·
  projectName·mbId)를 실어, 행에서 `+ Q… · 고객` 을 **각자의 Case 로** 열게 했다.
- **박스·선반·발송 카드에 PO 번호 병기**: 프로젝트명은 업로드 파일명이라 서로 다른 발주가
  같은 이름일 수 있다(한 박스 두 고객이면 두 줄이 완전히 같아진다). 같은 보드의
  `PcbShipmentCard` 는 이미 PO 링크를 걸고 있어 규칙 불일치이기도 했다.
- **[입고 확인] 파급 고지**: 이 한 번이 **다른 고객의 주문까지** 배송 대기로 넘기는데 경고가
  '묶음 N건' 배지뿐이었다 → 구성원을 열거(내 Case / 남의 Case 색 구분)하고 확인 문구에
  파급을 적었다.
- **묶음 메일이 대표 건만 지칭**: 제목 `… 외 N건` + 본문에 "발주 N건이 함께 담긴 묶음".
  **동반 건의 프로젝트명은 일부러 넣지 않는다** — 남의 고객 것일 수 있어 건수만 밝힌다.
- **고객 열이 로그인 아이디뿐**: 큐에 `od_name`(주문자명)을 실어 `이름 (아이디)` 로. 송장을
  붙이는 사람이 읽는 열이다.
- **배송 처리 모달 제목이 주문번호 20자리뿐** → 고객명 + 주문번호·프로젝트명 부제.
- **"알림 메일은 발송되지 않습니다" 가 막다른 문장** → 통합 주문내역으로 가는 실제 링크.
- **관리자 EQ 승인이 고객의 열린 확인 요청을 조용히 취소**하는데 고객 화면은 여전히 "승인
  또는 반려해 주세요"였다(완료 주문에도 잔존) → 열린 요청이 없으면 제목·안내를 **이력**으로
  바꾸고, 취소 건에 "담당자가 확인을 마쳐 요청이 취소되었습니다" 사유를 붙였다.
- **완료 아카이브 카드 구별 불가** → 헤더에 `SH-{id}`.
- **큐 API 가 `deliveryCompany:"0"`(코어 기본값)을 그대로 흘림** → 서버에서 `''` 로 정규화.
- **테스트 결함**: 여정 3편이 EQ 회신 기한을 `dueDate` 로 보냈는데 계약은 `dueOn` 이라
  **전 여정에서 기한이 한 번도 저장되지 않았다**(DB `dueOn=null` 실측) → 키 교정.

**보류했던 2건의 종결(같은 날)**: ① **상업송장 품목 description 도 PO 번호를 앞세웠다** —
`PO-{id} {projectName}`. 묶음 송장은 **다른 고객의 건까지** 한 장에 담기는데 프로젝트명이
업로드 파일명이라 두 줄이 통관 서류에서 구별되지 않을 수 있었다(수량·단가·합계는 원래
정확했다). 초안값이라 협력사가 수정할 수 있다. ② 견적관리 `NEW` 배지는 **결함이 아님이
확정**됐다 — `_account_nav.php` 에 하드코딩된 **신규 기능 태그**(CSS 주석도 "신규 메뉴
(견적관리) NEW 태그")라 견적이 0건이어도 뜨는 것이 정상이다(카운트 배지로 오독했던 것).

**정책 확인(결함 아님)**: 협력사 포털·협력사향 메일 전문을 훑어 **고객 식별 정보 유출 0건**.
"협력사 메일에 다른 고객 정보가 새는가"는 아니오이며, 공급망 차단의 의도된 결과다.

검증: typecheck 8/8 · lint 7/7 · vitest 771 · journey:multi 10/10 · intl 11/11 ·
domestic 11/11 · 정리 CLEAN.

### 여정 4호 픽스처 드리프트 해소 (2026-08-10)

`journey:md` 가 red 였다(이번 화면 수정과 무관한 사전 상태). **MD 픽스처가 자라면서 여정의
전제가 무너진** 경우다 — MD 1·5편이 협력2 를 두 MD 의 하위로 만들어 두면서(상설 관계 #11·#13)
**협력2 는 더 이상 상위가 될 수 없게** 됐는데(2단 제한), 여정 4호는 협력2 를 MD 로 쓰고 있었다.
관계 생성이 `PARENT_IS_CHILD`(400) 로 막혀 beforeAll 에서 전 케이스가 skip 됐다.

- **MD 를 `mdtester2상사`(CN)로 옮겼다** — 이미 하위(협력2)를 거느린 조직이라 KR 하위를 하나
  더 붙여도 2단 제한에 안 걸리고, 여정의 조합(하위 KR → MD CN → 관리자 KR, **양쪽 국제**)은
  그대로 보존된다. 임시 관계는 종전처럼 afterAll 에서 해제한다(상설 #13 은 무접촉).
- **역전 전환 가드 어서션을 서버의 판정 순서로 계산하게** 바꿨다 — 어느 가드가 먼저 막는지는
  픽스처 상태에 달렸으므로, 상태를 읽어 기대값을 세운다:
  `CHILD_IS_MD(400) → PARENT_IS_CHILD(400) → 첫 하위일 때만 PARENT_HAS_ACTIVE_POS(409)`.
  드리프트에 깨지지 않으면서 **가드 순서 자체를 계약으로 박제**한다(전보다 강해졌다).
- 결과 9/9 green. 정리 후 상설 관계는 3건 그대로(임시 관계 잔재 0).

### 여정 8호 — 송금 원장 완주(돈 축) (2026-08-10)

다른 여정은 발주가 서면 그 금액을 그대로 "낼 돈"으로 보지만, 실제 돈은 **발주 뒤에 여러 번
나뉘어 다른 환율로** 나가고 증빙이 붙는다. 8호는 그 축만 끝까지 민다(`journey:money`, 10케이스).
협력2(CN·USD)로만 성립한다 — 외화라야 ①발주 회계 환율 ②1차 송금 실환율 ③잔금 실환율이 셋 다
달라질 수 있고, 그때 **원장 KRW 합계 ≠ 발주 krwAmount**(=환차손익)라는 부등식이 참이 된다.

- **환차 실측**: 발주 회계 ₩414,000(USD 300 @1,380) vs 원장 실지급 ₩412,500(@1,340 ₩201,000 +
  @1,410 ₩211,500) → **₩−1,500**(실효 1,375.00). USD 합계는 300 으로 발주가와 일치하고 원화만
  갈린다 — 이 수치를 박아 "KRW 환산을 발주 환율로 뭉개는" 회귀를 막는다.
- 잔액·상태(unpaid→partial→paid)와 워크큐 탭·counts 가 같은 계산기에서 나오는지 · `remittedAt`
  이 원장 파생 캐시로 KST 앵커를 지키며 따라오는지(원장이 비면 null 복귀) · 관리자 집계·**협력사
  포털**·Case 패널 **세 화면의 금액이 갈라지지 않는지**(창구는 여럿, 원장은 하나) · 증빙 업로드→
  다운로드 바이트 동일성과 **포털 비노출** · 무상 A/S 회차가 **양쪽 모수 모두**에서 빠지는지
  (7호는 큐 소속만 봤고 포털은 안 봤다).
- **가드 순환을 끝까지**: `HAS_REMITTANCE` 409 → 원장·증빙 정리 → 발주 취소 200
  (`rework-probe` W4 는 원장 정리에서 멈춘다). 그래서 이 여정만 스크린샷을 가드 순환보다
  **먼저** 찍는다 — 순환의 종착이 원장과 발주의 소멸이라 순서를 지키면 빈 화면이 남는다.

**발견 2건(서버 무수정 — 현재 동작을 스펙에 박제)**: ① **외화 송금에 환율 누락 가드가 없다**
(`pcb-remittance.ts:141-144`·계약도 optional) — 200 으로 기록되고 `exchangeRate/krwAmount` 가
null 이라 **그 건만 KRW 회계 합계에서 조용히 빠진다**(잔액·통화 계산은 정상). ② **협력사별 집계의
KRW 환산이 원장이 아니라 비례배분**(`admin-pcb-remittances.ts:206-210`: `krwPo × paid/po`)이라
그 화면의 '지급 ₩'는 실지급이 아니라 발주 회계를 되쓴다 — **환차가 집계 화면에는 안 드러난다**
(P3.11 '남은 것'과 같은 사안이라 어서션으로 못 박아 두었다).

→ **두 건 모두 해소**: ②는 2026-08-11 P3.11 보강의 원장 실합 전환으로, ①은
2026-08-12 P3.11 후속의 당일 자동 환율+과거일 명시 가드로 닫았다. 여정 M7도 더 이상
`krwAmount=null`을 기대하지 않고 자동 박제와 400 가드를 기대한다.

검증: 10/10 green(연속 3회) · e2e typecheck · 게이트 없이 전량 skip · 정리 CLEAN.

### 여정 10호 — 주문 취소·부분 취소(고객 축) (2026-08-11)

미검증 영역 둘을 한 번에 열었다. ① 그때까지 **모든 여정이 "1주문 = 1스펙"** 이라 견적관리에서
여러 건을 함께 담아 **한 주문서에 두 줄**을 만드는 경로가 한 번도 안 밟혔다(3·9호는 주문을
둘로 나눴다). ② 그 위에서 **부분 취소**를 걸면 협력 트랙이 어떻게 되는지 아무도 몰랐다.

**핵심 결론(주행 시점) — 부분 취소는 협력 트랙을 전혀 막지 않았다.** 같은 프로브 3종을 두
상황에 나란히 쳐서 대조했다:

| 프로브 | 부분 취소(od='입금') | 전량 취소(od='취소') | 교정 후 |
|---|---|---|---|
| 발송 담기 | **200 통과** | 409 `ORDER_CANCELED` | 409 `ORDER_CANCELED` |
| EQ 전진(생산완료) | **200 통과** | 409 `ORDER_CANCELED` | 409 `ORDER_CANCELED` |
| A/S 접수 | **200 통과** | 409 `ORDER_CANCELED` | 409 `ORDER_CANCELED` |
| EQ 되돌리기(정리) | 200 | 200 | 200 (그대로 열림) |

원인은 판정 축이었다 — `isPcbOrderCanceled`가 `spec.ctId → od_status`만 보고 **줄 상태
(ct_status)를 보지 않았다**. 부분 취소면 od 는 '입금'이라 가드 소비처 4곳이 통째로 비활성이고,
**취소된 보드가 계속 생산되어 박스에 담겨 해외로 나갈 수 있었다.**

**그 밖의 발견(전부 부분 취소에서만 드러난다)**: ② 취소 줄이 **배송 처리 한 번에 되살아난다**
(PCB 고객 배송의 유일한 경로인 force-status '배송'의 대상 집합이 취소류를 포함 — 실측:
ct_status 취소→배송, `od_cancel_price` 51,000→0 으로 취소 이력·금액이 조용히 소멸) ③ 과입금이
**음수 미수**로만 남고 환불 원장·경로가 없다(미수 경고는 양수 기준이라 재촉 목록에도 안 뜬다)
④ 취소된 줄이 고객 상세 **'제작 진행 상황' 카드에 살아 진행**된다("주문취소"와 "생산 완료 —
발송 준비 중"이 한 화면에) ⑤ 한 주문서 두 줄이 **같은 상품명**으로 표시된다(그룹 행 이름을
찍는다 — 줄별 이름을 조회해 두고 안 쓴다. 1주문 1스펙에서는 드러날 수 없던 결함) ⑥ 상태 칸이
표 영역 밖으로 잘려 '주문취소' 배지가 가로 스크롤 없이는 안 보인다.

관찰: 관리자 주문·결제 큐·배송 대기 큐는 **줄 단위 취소를 표시하지 않고**(탭 SQL 이 od_status
만 본다) 취소 탭에도 안 잡힌다 · 협력사 포털엔 취소된 발주가 무표식 노출 · 취소 견적은
견적관리로 미복귀이자 보관함에도 안 간다(견적관리는 ctId null 만 낸다), 재주문은 409.

12/12 green(3회) · 정리 CLEAN(취소·전량취소 주문 모두 force-status '주문' 복귀로 재고 점유
해제됨을 실증 — 같은 '취소류 포함' 규칙이 여기서는 정확히 필요한 동작이다).

#### 교정 — 부분 취소를 줄 축으로 전달한다 (2026-08-11)

발견 ①·②·④·⑤·⑥을 고쳤다. 스키마 무변경, 판정 축만 바뀐다.

1. **가드에 줄 축을 더했다** — `isPcbOrderCanceled` → **`isPcbOrderLineCanceled`**
   (`lib/pcb-shipment.ts`). `od_status='취소'` **또는** 그 스펙의 카트행 `ct_status` 가 취소류
   (`취소`·`반품`·`품절`)면 취소로 본다. 줄 상태는 `getOrderInfoByCtId` 가 이미 `rowCtStatus`
   로 함께 주므로(카탈로그 ⑲) g5 신규 접근이 없다. 취소류 상수는 `g5-db.ts` `CANCEL_STATUSES`
   를 export 해 SSOT 로 쓰고(`isCanceledCartStatus` 헬퍼), 마이그레이션 미러(`status-map.ts`)의
   중복 정의도 그 export 재사용으로 접었다. 소비처 4곳(담기·EQ 전진·하위 발주·A/S 접수/진행)이
   함께 잠기고, **정리 동작(revert·detach·발주 취소)은 그대로 열려 있다**.
2. **전진 전이가 취소 줄을 되살리지 못하게 했다** — `setOrderForceStatus` 의 대상 라인 집합을
   target 방향으로 갈랐다(`resolveForceStatusLineStatuses`): 역방향 `'주문'` 만 **취소류 포함**
   (= un-cancel · 재고 점유 해제 — 정리 경로가 쓰는 정확한 동작, X12), 전진(입금·준비·제작 8·
   배송·완료)은 **취소류 제외**. 전량 취소 주문에 전진 target 을 걸면 대상이 0이므로 아무것도
   쓰지 않고 **409 `NO_ACTIVE_LINES`**("되살리려면 상태를 [주문]으로 되돌린 뒤 다시 진행하세요")
   로 끊는다 — od_status 만 올라가 카트행과 어긋나는 것을 막는다.
3. **고객 진행 카드에서 취소 줄 제외** — `listCustomerPcbProgress` 가 `{ctId, ctStatus}` 줄을
   받아 취소류를 걸러낸다(`progressTargetCtIds` 순수 함수 + 유닛). PHP 브리지도 같은
   `/api/pcb-progress` 를 쓰므로 고객 화면이 함께 낫는다.
4. **주문 상세가 줄별 상품명을 찍는다** — `theme/sp-lite/shop/orderinquiryview.php` 가 그룹 행
   `$row['it_name']` 대신 이미 조회해 둔 줄별 `$opt['it_name']` 을 출력(`get_text` 이스케이프).
5. **상태 칸이 화면 안에 들어온다** — `#sod_fin` 그리드의 상품표를 `#sod_frm`(주문서)과 같은
   **전폭**(`"prd prd"`)으로 되돌리고 열 여백·`.td_prd` 최소 폭을 줄였다(`default_shop.css`,
   `G5_CSS_VER` 26081004). 실측 표 폭 594→958px, 상태 칸 우측이 표 안(1335 = wrapRight).

**여정 10호 스펙은 이제 회귀선이다** — X6 이 다시 200 이 되거나 X10 에서 취소 줄이 '배송'으로
올라가면 그 자리가 먼저 빨개진다(X11 에 전량 취소 주문의 전진 전이 409 프로브도 추가).

**미해결(정책 결정 대기) — 과입금 환불.** 발견 ③ 은 손대지 않았다. 이미 전액을 받은 뒤 한 줄을
취소하면 `recomputeOrderMoneyOnItemChange` → `computeOrderMoney` 가 `od_misu` 를 **음수**로 낸다
(실측 −51,000). 그 값이 "돌려줄 돈"의 유일한 흔적이다: `od_refund_price` 는 0 그대로고(코어는
환불 처리 시 관리자가 채우는 칸인데 그 화면·경로가 우리 쪽에 없다), 관리자 미수 경고·재촉
목록은 **양수 기준**이라 이 건은 어디에도 안 뜬다. 교정 후에도 그대로다(X10: 완주 뒤에도
`od_misu=-51,000`·`od_cancel_price=51,000` 보존 — 취소 이력이 남는 만큼 오히려 더 또렷하다).
환불은 결제수단(무통장 계좌 반환 / PG 부분취소)과 회계가 걸려 **코드가 아니라 정책이 먼저**다.
최소 대응안(구현 안 함, 결정용): ① 관리자 주문·결제 큐/주문 상세에 `od_misu < 0` 을 "과입금
₩x — 환불 필요" 배지로 노출(읽기 전용, 원장 무변경)해 최소한 눈에 띄게 한다 · ② 환불 실행은
`od_refund_price` 를 채우는 수기 기록 한 칸부터(코어 컬럼 재사용, 자동 이체·PG 취소 없음) ·
③ PG 부분취소 연동은 별도 과제. ①만으로도 "돈이 조용히 묶이는" 현재 상태는 끝난다.

검증: 12/12 green(2회) · `probe` 9/9 · `journey:intl` 11/11 · `journey:multi` 10/10 ·
`journey:money` 10/10 · turbo typecheck·lint · apps/api vitest 773 · 정리 CLEAN(spec=0 고아=0).

### 여정 11호 — 조합 스트레스(묶음 × A/S 회차 × 직송) (2026-08-11)

각 축을 따로만 검증해 왔다(묶음 3·9호 · A/S 회차 5·7호 · 직송 6호 · 돈 8호). 그런데 박스 합류
키 `받는측:조직:직송지:회차` 는 **직송지와 회차를 동시에** 품고, 최근 수정 대부분이 그 키 위에
서 있다. 축이 **교차**할 때도 판정이 유지되는지를 본다(`journey:combo`, 9케이스).

협력2 한 조직 안에서 조직 축을 고정하고 나머지 두 축만 흔들어 **박스 세 칸**을 만들었다:

| 박스 | contextKey | 구성 | 모드 |
|---|---|---|---|
| #245 | `admin:0:-:r0` | 원발주 A+B(묶음 2) | international |
| #246 | `admin:0:-:r1` | 회차 A′(대표 승계 후) | international |
| #247 | `admin:0:CN:r1` | 회차 C′ 직송 | **domestic**(CN→CN) |

- **회차가 가른다**: 받는측·직송지가 같아도 `:r0` ≠ `:r1` — 회차 발주는 원발주 박스에 못 든다.
- **회차가 묶기도 한다**: 서로 **다른 스펙**의 같은 회차 발주 둘이 한 박스로 합류 — "키에 고객·
  스펙 축이 없다"는 9호의 발견이 회차 축에도 그대로 성립한다.
- **직송지가 가른다**: 같은 `r1`·같은 받는측인데 `:-` 와 `:CN` 이 갈렸다.
- **대표 승계는 문서까지 옮긴다**: 대표를 detach 하니 남은 발주가 대표를 승계하며 **발송 문서의
  specId 까지** 함께 옮겨갔다.
- **W8 순환 완주**: 담긴 채 직송지 변경 409 `IN_SHIPMENT` → detach → 변경 200 → 재담기 → 별도 박스.
  (A/S proceed 가 직송지를 **복사**하므로 직송 회차는 "복사 후 수정"으로만 만들어진다 — 어서션.)
- **돈 축은 박스와 무관**: 유상 A′(묶음 박스)와 무상 C′(직송 박스)가 **박스 소속이 정반대인데**
  송금 큐·협력사별 집계·포털 총계에서 chargeType 하나로만 갈렸다(무상은 pending·partial·done
  전부 제외·잔액 0, 유상은 +1건/+$300/+₩420,000 델타).

**발견 2건(첫 주행은 서버 무수정 — 현재 동작 박제)**: ① **회차의 직송지가 원주문 종결 동선을
뒤집는다** — 고객 배송 큐의 직송 판정이 "최상위·**최신 회차** 발주의 직송지"라
(`admin-pcb-orders.ts:56`), 원발주가 **KR 로 실제 입고 완료된** 주문인데도 뒤에 선 A/S 회차에
직송지를 주면 행이 `직송 CN` 으로 바뀌고 종결이 [배송 처리]→**[직송 완료]**(운송장 없이 종결)가
된다 — 실물은 자사 창고에 있는데 "현지 수령"으로 닫히는 경로다(같은 화면 두 행이 입고 1/2 동일
상태로 갈린 스크린샷). ② 포털 보드의 **박스 헤더에 회차가 안 실린다**(직송지는 실린다) — r0·r1
박스 헤더가 글자까지 같아 왜 갈렸는지 읽을 수 없다(회차 배지는 선반 항목에만).

9/9 green · 정리 CLEAN(상설 픽스처 3조직 무접촉).

#### 교정 — 발견 2건을 닫다 (2026-08-11)

1. **종결 동선의 판정 축을 "입고된 발주"로 바꿨다.** `routes/admin-pcb-orders.ts` 의
   `directShipPoBySpec`(최상위·최신 회차)을 걷고, **큐 소속 판정과 같은 조인**(`PCB_SHIP_JOIN`/
   `PCB_TO_SHIP` 의 근거 = 관리자 수신 선적 `receiverKind='admin'` 의 `receivedAt`)이 고른 발주들의
   `destinationCountry` 로 판정한다 — 이 큐의 **종결 대상이 곧 그 발주**이기 때문이다(입고 수
   `receivedPoCount` 와 같은 링크를 한 번만 읽어 같이 낸다). 규칙 본문은 계약의 순수 함수
   `resolvePcbDirectShipCountry`(`packages/api-contract/.../pcb-po.ts`): 입고분 없음 → null ·
   전부 같은 직송지 → 그 나라 · **섞이면 보수적으로 null**(원발주 KR 입고 + 회차 CN 입고 같은
   교차에서, 운송장 없이 닫는 것보다 [배송 처리]로 한 번 더 확인받는 쪽이 안전하다).
   Case 헤더의 '직송 완료 대기' 유도 배지(`AdminPcbCase.vue` `caseDirectShipCountry`)도 같은
   함수를 쓴다(입고된 발주 = `shipmentByPo` 가 admin 수신·`receivedAt` 인 것).
2. **박스 헤더가 회차를 싣는다.** 계약 `PcbShipmentView` 에 대표 발주의 `reorderRound` 를 더하고
   (`toPcbShipmentView` — 보드가 컨텍스트 키용으로 따로 읽던 조회는 이 값으로 접었다), 포털 보드
   박스 헤더와 진행 중 발송 카드(`PcbShipmentCard.vue`)에 `A/S N차` 배지를 세웠다(선반의 'N회차'
   표기도 포털 공통 'N차'로 통일). r0 박스와 r1 박스의 헤더가 이제 다르다.

**X7·X9 는 어서션이 뒤집혀 회귀선이 됐다.** X9 는 갈리는 두 경우를 함께 못 박는다 — 회차에만
직송지를 줘도 원주문은 `directShipCountry=null`([배송 처리] 유지, 행에 '직송' 문자 없음) · 회차
발주 **자체가 직송으로 입고**되면 그 주문은 '직송 CN'([직송 완료]) · 원발주 KR 입고와 회차 CN
입고가 **섞이면** 보수적으로 null. 유닛(`pcb-direct-ship-policy.test.ts` 4케이스)이 규칙을 잠근다.

검증: `journey:combo` 9/9 green(발견 0건 — 전 항목 obs) · 회귀 `journey:direct` 6/6 ·
`journey:as` 10/10 · `journey:multi` 10/10 · `journey:money` 10/10 · `pnpm -r typecheck`·`lint` ·
apps/api vitest 777 · 정리 CLEAN(spec=0 고아=0, 상설 픽스처 무접촉). 화면 실측 스크린샷 —
`X07-portal-three-boxes.png`(박스 셋의 헤더가 각각 다르다) · `X09-order-ship-kept-row.png`
(회차 직송 지정 후에도 [배송 처리]) · `X09-direct-round-received-row.png`(직송 입고 건만 [직송 완료]).

### 여정 12호 — 관리자 대행 완주(포털 없는 협력사) (2026-08-11)

앞의 열한 편은 전부 **협력사 토큰으로 포털을 두드렸다**. 그런데 실무 협력사 상당수는 포털 계정이
없다 — 메일과 전화로 일한다. 그래서 D11 이 "관리자 만능 대행"을, 재점검 #15 가 무계정 조직용
**대행 안내 메일**을 두었는데 **대행만으로 완주한 여정은 하나도 없었다**. 주인공은 상설 픽스처
`e2e한국협력`(#9·KR/KRW·**연결 계정 0**)이고, 계정이 없으니 협력사 토큰을 만들 방법 자체가
없다(`getPartner().mbId === null` 이 전제이자 첫 어서션). 전 구간을 관리자 토큰 하나로만 민다
(`journey:proxy`, 8케이스).

- **대행 이력이 남는다(DB 실측 둘)**: 대행 업로드 `sp_file.uploadedBy='ADMIN'`(eq·working 2/2) ·
  대행 전이 `sp_pcb_po.eqHistory[].byRole='ADMIN'`(`issued→eq_requested→eq_done→producing→
  produced` **4/4, PARTNER 0건**). 누가 밀었는지가 회차 전체에 박제된다.
- **대행이라고 규율이 느슨해지지 않는다**: 승인요청 뒤 첨부 교체는 포털과 같은 409 `EQ_LOCKED`,
  국내 종점은 같은 409 `RECEIVE_REQUIRED` → [입고 확인] 1회로 `delivered`+`receivedAt`.
- **메일이 조직마다 갈린다**: **같은 스펙·같은 순간에 발주서를 두 장 발행**해 무계정 조직과
  협력2(계정 有)를 나란히 세웠다. 무계정 4종(발주서 도착·EQ 결정·선적 차례·입고 확인) 전부
  `담당자가 대행합니다`+`mailto:` 를 담고 `/app/partner` 링크가 **0개** · 대조군은 포털 버튼 유지.
  **예외까지 박제한다** — 견적요청 메일만은 무계정에도 매직링크(`가입 없이 바로 회신하기`)가
  그대로 간다. 로그인 없이 실행되는 CTA 라 대행 치환 대상이 아니기 때문이다.
- 고객 축은 대행 여부를 알 필요가 없다 — 진행 카드가 EQ→생산→생산완료→운송→입고로 그대로 따라온다.

**발견 1건(첫 주행은 무수정 — 현재 동작 박제)**: **무계정 조직의 발송을 화면만으로 시작할 수
없다.** 선적 큐 발송 대기 탭은 "관리자는 Case 상세에서 대행할 수 있습니다"
(`AdminPcbShipments.vue:200`)라고 보내지만, Case 상세의 선적 줄은 **발송 문서가 이미 있을 때만**
렌더된다(`AdminPcbCase.vue:1635` `shipRowsOf`). 담기(박스 생성) 라우트는 협력사 전용
(`POST /api/partner/pcb-shipments/box`)뿐이고 관리자는 `shipment/advance` 가 겸하는
`ensurePcbShipment` 로만 열 수 있어, **계정이 영영 없는 조직은 UI 로 발송을 시작할 수 없다**
(D11 "만능 대행" 약속의 구멍). P5 가 "Case 상세의 발송 시작 버튼 = 0개"로 현재 동작을 박제한다.

8/8 green · HTTP ≥400 0건 · pageerror 0건 · 정리 CLEAN(상설 픽스처 5조직 무접촉, Mailpit 은
이번 주행분 6통만 삭제). 스크린샷 21장(접두사 `P` — 여정 공용 폴더라 편마다 글자를 전용한다).

#### 교정 — 대행에 발송 시작점을 주다 (2026-08-11)

**담기(박스 확보)만 하는 관리자 라우트를 신설했다** — `POST /pcb-projects/:id/pos/:poId/
shipment/box`(`admin-pcb-pos.ts`, `ensurePcbShipment` 직결 · 협력사 `POST /partner/
pcb-shipments/box` 의 대응물). Case 상세 발주 행에는 생산완료·미편성일 때만 서는 **[발송 시작]**
을 달았다(`AdminPcbCase.vue` `canStartShipment`/`startShipment` — D11 대행 버튼 옆, 확인 대화
포함). 화면 훅은 기존 `shipmentAction` 에 `'box'` 를 더해 재사용한다(`useAdminPcbShipmentBox`).

**담기까지만 하고 멈추는 것이 설계의 핵심이다.** 첫 전이의 필수값은 모드마다 다른데(국내=운송장 ·
국제=출고예정일+Invoice) 그 **모드는 담아 봐야 정해진다**(발송자국가 vs 수신국가 파생 —
`resolvePcbShipContext`). 그래서 박스를 먼저 열고, 이후 전이는 **기존 [~ 진행]** 이 모드를 알고
정확한 입력을 묻는 자리로 넘긴다. 화면이 모드를 미리 추측할 필요가 없어진다.

이로써 선적 큐의 안내문("관리자는 Case 상세에서 대행할 수 있습니다" — `AdminPcbShipments.vue:200`)
이 **참이 됐다**. **P5 는 어서션이 뒤집혀 회귀선이 됐다** — "발송 시작 버튼 = 0개"에서 "버튼을
눌러(확인 대화 승인) 선적 줄이 서고 박스가 `preparing`·`domestic` 으로 열린다"로. 화면 클릭만으로
발송이 시작되는지를 DB 실측까지 이어 본다.

검증: `journey:proxy` 8/8 green · 회귀 `journey:combo` 9/9 · `journey:direct` 6/6 ·
`journey:batch` 10/10 · `pnpm -r typecheck`(8/8)·`lint`(6/6) · apps/api vitest 777 · 정리 CLEAN.

#### 재점검 — 대행이 필요한 줄을 화면에서 가르다 (2026-08-11)

12호가 대행 동선을 완성하자 곧바로 따라오는 물음이 있었다 — **관리자가 "이 줄은 대행해야
한다"를 어디서 아는가.** 화면 관찰(`obs-screens.mts proxy-recheck`)이 답을 확증했다: 연결 계정
수는 **파트너 관리 목록에만** 있고(`AdminPartners.vue` '계정' 열 — `e2e한국협력`=0), Case 상세와
발주·EQ 큐에는 오지 않는다.

방향을 뒤집어 잡는 것이 중요했다. **대행 버튼이 모든 조직에 뜨는 것 자체는 결함이 아니다**
(D11 — 담당자 부재 등 어떤 사정이든 대신 밀 수 있어야 한다). 위험한 쪽은 반대다: 계정이 없는
조직 건을 "협력사가 하겠지" 하고 큐에 두면 **그 건은 영영 오지 않는다**. 12호 이전엔 발송을 아예
시작할 수 없어 드러나지 않던 문제다.

계약 `AdminPcbPoView`·`AdminPcbPoWorkItem` 에 `partnerHasPortal` 파생을 더했다(직렬화는
`loadPartnersWithPortal` 배치 조회 — 조직 축이라 발주 수와 무관하게 1쿼리). 화면은 Case 상세
협력사명 아래 `포털 계정 없음 — 대행 필요`, 발주·EQ 큐 협력사 열에 `대행 필요` 배지.

**적용 범위를 발주 이후로 한정한 것이 요점이다.** 견적 회신은 매직링크라 계정이 없어도 협력사가
직접 한다(12호가 박제한 예외) — RFQ 표까지 배지를 붙였다면 "대행해야 한다"는 **거짓 신호**가
됐을 것이다. 이 배지가 가르는 것은 포털이 있어야만 굴러가는 EQ·생산·선적이다.

함께 고친 것: Case 상세 RFQ 게이트 문구 `closed` 가 **"재작업은 A/S 재발주(예정)로 진행합니다"**
로 남아 있었다(`AdminPcbCase.vue`). A/S 재발주는 P4.12 에서 구현을 끝냈고 **같은 화면 아래
[A/S 재발주] 섹션이 실제로 뜬다** — "(예정)"은 관리자를 우회로로 보내는 stale 문구였다. "아래
[A/S 재발주] 섹션에서 회차를 열어 진행합니다"로 바꿔 목적지를 가리키게 했다.

P3·P4 가 두 배지를 어서션으로 물어 회귀선이 됐다. ⚠ 큐 화면 검증의 함정: `/app/admin/pcb/pos`
**기본 탭은 '발주 대기'**(결제됐는데 발주서가 없는 건 = 다른 모수)라 진행 중 발주는 거기 없다 —
탭을 옮기지 않고 배지를 찾으면 실패한다(첫 시도가 이 함정에 걸렸고, P4 가 멈추면서 그 아래
승인·생산 전이가 실행되지 않아 P5·P6·P8 이 연쇄로 무너졌다).

#### 재점검 — 관리자 주문 목록이 "돌려줄 돈"과 "취소된 줄"을 말하게 하다 (2026-08-11)

여정 10호가 남겨 둔 관찰 둘을 닫았다. 둘 다 **목록이 서버·고객과 다른 것을 보고 있던** 문제다.

1. **과입금(음수 미수)의 이름이 뒤집혀 있었다.** 상세 드로어는 조건이 `misu !== 0` 이라 음수도
   **"미수금"** 라벨로 렌더했다 — 과입금 55,000원이 빨간 글씨 "미수금 −55,000원"으로 나온다.
   목록 배지들은 `misu > 0` 가드라 **과입금 주문이 아무 표시 없이** 정상 건과 섞였다. 이름을
   갈라(`overpaid` 키 ko/en) 절댓값으로 보이고, PCB·SmartBOM 목록에 반대 방향 배지를 세웠다
   (취소 주문에도 남는 돈이라 상태로 거르지 않는다). `OrderForceStatusModal` 의 `misu <= 0`
   컷은 **그대로 둔다** — 그 경고는 "미수 남은 채 완료 처리" 방지라 음수는 애초에 대상이 아니다.
   ⚠ **환불 실행 경로는 여전히 미구현**(결제수단·회계가 걸린 PG 도메인 별건) — 표시만 바로잡았다.
2. **관리자만 취소된 줄을 못 보고 있었다.** 영카트는 줄 단위로 취소하고 전량일 때만 od 를
   내린다. 08-11 교정(`isPcbOrderLineCanceled`)으로 서버 가드 4곳과 고객 진행 카드는 줄 축을
   보게 됐는데 **관리자 주문·결제 큐만 그대로였다** — 취소된 줄이 살아 있는 줄과 똑같이 '입금'
   으로 서서, 관리자는 진행 중인 줄로 알고 작업하다 이유 모를 409 를 만난다. 목록 SQL 이 이미
   `g5_shop_cart` 를 조인하므로 `ct_status` 한 칸만 더 뽑아(추가 조회 없음) **가드와 같은 사전**
   (`isCanceledCartStatus`)으로 판정한 `lineCanceled` 를 싣고, 상태 배지 옆에 `줄 취소` 를
   세웠다(od 전량 취소면 기존 배지와 겹치니 띄우지 않는다). **탭 분류는 손대지 않았다** —
   모수 정의가 바뀌는 별건이라 X7 관찰 문구에 "탭은 여전히 od 축"으로 남겼다.

10호가 두 배지를 문다. X5 는 **취소·정상 두 줄이 갈리는지 함께** 검사한다(한쪽만 보면 상수
반환도 통과한다). 화면 실측 `X05-admin-orders-overpaid.png` — A 줄에만 '줄 취소', 양쪽에
'과입금 ₩51,000'. 검증: `journey:cancel` 12/12 · typecheck 9/9 · lint · 정리 CLEAN.

### 여정 13호 — 협력사 정지(운영 배제) 중의 진행 건 (2026-08-11)

12호가 "포털 계정이 **없는** 조직"이었다면 이 편은 "계정이 **있었는데 막힌** 조직"이다. 조직
삭제는 문서 이력이 있으면 거부되고(`PARTNER_HAS_PCB_DOCS`) 라우트 주석이 **"운영 배제는
suspended"** 라고 못 박는다 — 정지가 **정식 배제 경로**다. 계약 종료·분쟁·휴업처럼 흔한 일인데
**정지 시점에 진행 중이던 발주가 어떻게 마무리되는지**는 검증된 적이 없었다(`journey:suspend`,
9케이스). 주인공은 **이 편 전용 상설 조직** `e2e정지협력`(KR/KRW)+계정 `e2e-partner-susp` —
협력2 를 정지시켰다가 복구에 실패하면 다른 여정이 전부 깨지므로 절대 쓰지 않는다(afterAll·다음
주행 beforeAll 양쪽에서 승인 복구).

- **정지는 진행 건을 가로막지 않는다**: 발주 #N 이 진행 중이어도 정지 200(삭제는 같은 조건에서
  409). 사유는 필수(계약 refine — 감사 기록이 목적).
- **포털은 즉시 닫힌다**: 같은 토큰으로 4경로+쓰기 전부 403(`requirePartner` 가 요청마다 상태를
  조회하므로 토큰 재발급이 필요 없다). 해제하면 같은 토큰이 다시 통한다.
- **일은 관리자 대행으로 끝난다**: 생산·발송(12호가 연 `shipment/box`)·입고까지 완주,
  `eqHistory` 전 구간 `ADMIN`.

**발견 3건 — 뿌리가 하나였다.** 12호가 세운 판정 축 **'멤버 존재'**(`resolvePcbPortalCta`·
`loadPartnersWithPortal`)가 "포털을 쓸 수 있는가"를 대변하지 못한다. `requirePartner` 는
**승인된 조직**의 멤버만 통과시키므로 정지 조직은 멤버가 있어도 403 이다 — **계정이 없어서 못
쓰는 것과 배제돼서 못 쓰는 것은 협력사가 보는 결과가 같다.**

1. **매직링크 우회(권한 경계)** — 정지 **전에** 나간 링크로 견적 회신이 성공했다(PUT 200 →
   `quoted`). 신규 배정은 `INVALID_PARTNER`, 포털은 403 인데 **이미 메일함에 있는 링크만** 그
   판정을 타지 않았다(`pcb-rfq-reply` 는 무인증 토큰 경로). 배제한 조직의 견적이 관리자 화면에
   정상 회신으로 서고 선정까지 갈 수 있었다.
2. **포털 CTA 메일** — 정지 조직에 `/app/partner` 링크가 계속 나갔다(누르면 403).
3. **Case 화면 정지 미표시** — `partnerHasPortal=true` 라 12호의 '대행 필요' 배지가 안 서서,
   관리자는 협력사를 기다리게 된다(영영 오지 않는다).

#### 교정 — 판정 축을 '승인된 조직의 멤버'로 옮기다

- `resolvePcbPortalCta`·`loadPartnersWithPortal` 이 **`멤버 존재 ∧ partner.status='approved'`**
  로 판정한다(둘 다 같은 규칙). 정지 조직도 무계정과 같은 대행 안내·'대행 필요' 배지를 받는다.
- `pcb-rfq-reply` **GET·PUT 모두** 조직 승인을 확인해 409 `PARTNER_SUSPENDED`. 토큰은 회수할 수
  없으니(메일은 되돌릴 수 없다) 쓰는 순간 보는 수밖에 없다. **열람까지 막는 이유**는 이 링크가
  고객 도면·사양을 여는 통로이기 때문 — 배제한 조직에 정보가 열려 있으면 배제가 아니다.
  404('유효하지 않은 링크')로 뭉개지 않고 사유를 밝혀 문의로 유도한다.
- `PartnerLayout` 이 미승인·배제 계정에는 **어느 경로로 들어와도** 사유를 그린다. 안내가
  `/partner` 진입 리졸버에만 있어서, 메일 딥링크로 하위 화면(발주 상세·A/S)에 바로 온 협력사는
  셸만 뜬 화면을 봤다.

이제 세 경로(포털 `requirePartner` 403 · 신규 배정 `INVALID_PARTNER` · 매직링크
`PARTNER_SUSPENDED`)가 **같은 판정**을 쓴다. S4~S7 이 어서션으로 회귀선이 됐다.

⚠ **검증 함정 3종(이 편에서 실제로 걸린 것)**: ① 포털에는 `pcb/pos`(목록) 라우트가 **없다**
(상세 `pcb/pos/:id`·홈 `pcb` 뿐 — `/admin/pcb/pos` 는 관리자 쪽). 없는 경로는 Vue Router 가
아무것도 안 그려 **빈 화면**이 되는데 이는 정지와 무관한 404 다(첫 주행이 이를 결함으로 오독).
② **픽스처 이름·시드 메모에 검사 키워드를 쓰면 자기가 심은 글자를 자기가 찾는다** — 조직명
`e2e정지협력`과 메모 "협력사 정지 검증"이 화면 '정지' 검사에 걸려 두 번 연속 오탐이었다(실제
화면엔 표시가 없었고 스크린샷으로 갈렸다). ③ 포털 회신은 `PUT /partner/pcb-rfqs/:rfqId`(`/reply`
없음), 보드는 `/partner/pcb-shipments`(`/board` 없음).

9/9 green · HTTP ≥400 0건 · 정리 CLEAN · 회귀 `journey:proxy` 8/8 · `journey:intl` 11/11 ·
apps/api vitest 777.

### 여정 14호 — 기한 초과(납기·EQ 확인·매직링크 TTL) (2026-08-11)

앞의 열세 편은 전부 "제때 진행되는 건"을 밟았다. 실무에서 손이 가는 쪽은 **멈춰 있는 건**이다 —
고객이 EQ 확인을 안 하고, 협력사가 납기를 넘기고, 메일 링크는 만료된다. 시계를 뒤로 돌려(DB 의
날짜 필드를 과거로 밀어) 그 셋이 판정·화면에서 어떻게 드러나는지 본다(`journey:overdue`,
5케이스). 대조는 **한 Case 안에** 세운다 — 같은 스펙에 발주 두 장(납기 어제 / +30일)을 나란히
두면 상태가 같고 납기만 다르므로, 갈리는 신호가 있다면 그건 납기 축뿐이다.

**발견 1건 — 납기가 지났는지 아무도 말해 주지 않는다.** 발주 뷰 계약의 날짜 키가
`deliveryDate` 하나뿐이고, Case 상세·발주 큐 모두 납기를 **회색 날짜로만** 찍었다. 관리자는
목록에서 날짜를 하나하나 오늘과 비교해야 하고, 생산 진행 탭이 수십 건이면 넘긴 건이 묻힌다.

#### 교정 — 납기 경과를 두 화면이 같은 규칙으로 말한다

계약에 순수 함수 `isPcbDeliveryOverdue(status, deliveryYmd, todayYmd)` 를 두고 Case 상세·발주
큐가 함께 쓴다(11호 `resolvePcbDirectShipCountry` 와 같은 SSOT 방식). 판단 둘:

- **생산완료(produced)부터는 지연이 아니다** — 납기는 "언제까지 만드는가"의 약속이고 그 뒤
  (발송·입고)는 선적 축이 따로 기한을 가진다. 만들어 놓은 건을 계속 빨간 줄로 두면 **진짜 늦은
  건이 묻힌다**. 납기 미지정(null)도 지연이 아니다(약속 자체가 없다).
- **서버 파생을 늘리지 않았다** — 상태·납기 둘 다 이미 응답에 있어 계산이 곧 규칙이다.

⚠ **KST 함정**: 납기는 KST 자정에 앵커해 저장되므로 ISO 를 그냥 자르면 **하루 앞당겨진다**
(`packages/utils/kst-date.test.ts` 의 실측 회귀 — 2026-08-20 납기가 '2026-08-19' 로 보였다).
호출부는 반드시 `kstDateOnly`·`kstToday` 를 거친다. 유닛 6케이스가 경계 하루를 잠근다
(`pcb-delivery-overdue.test.ts`).

**설계가 이미 옳았던 둘(검증만)**: ① **EQ 기한 초과 왕복** — `dueOn` 을 -2일로 밀면
`overdue=true` 가 되고 `awaitingCustomer` 가 풀려 발주가 **관리자 차례로 복귀**한다("답이 올
때까지 공은 고객에게, 기한이 지나면 재촉은 관리자 몫" — `pcb-po.ts` 주석이 판정으로 구현돼
있다). 화면 배지도 '고객 기한초과'(P4.4 팔레트 red)로 선다. ② **매직링크 TTL(30일)** — 만료는
404(링크 없음 취급)라 13호의 정지 차단(409 `PARTNER_SUSPENDED`)과 **응답이 갈린다** — 협력사가
"만료"와 "배제"를 구분해 문의할 수 있다.

T2 는 **대조군 오염까지** 센다(초과 표기가 정확히 1건). 한쪽만 보면 "전부 빨갛게"도 통과한다.

5/5 green · 정리 CLEAN · apps/api vitest **783**(+6) · typecheck 9/9 · lint.

### 여정 15호 — 되돌리기 전 구간 순환 (2026-08-11)

가드 체계는 **"못 하게 막는"** 절반만 검증돼 왔다(`pcb-guards`·`rework-probe` 의 409 목록).
반대편이 이 편이다 — 오조작은 반드시 생기고 **출구 없는 잠금은 일을 멈춘다**. 재작업 2단계가
가드를 세울 때 "잠김 → 정리 → 열림"을 함께 못 박았지만, **한 주행에서 끝까지 되돌렸다가 다시
진행하는** 경로는 아무도 밟지 않았다(`journey:rewind`, 8케이스). 협력2(CN·계정 있음)를 쓴다 —
협력사와 관리자가 **번갈아 밀어야** 주체 규칙이 시험되고, 국제 체인이라 선적 단계도 길다.

- **주체 규칙은 비대칭이다**: 관리자는 협력사가 민 전이도 되돌린다(`revertPcbPoEq` 의
  `actor.kind !== 'admin'` 예외 = D11 만능 대행이 advance 와 똑같이 걸려 있다 — 협력사가 연락이
  끊긴 채 잘못 밀어 놓은 건을 못 물리면 트랙이 멈춘다). 반대로 **협력사는 관리자의 EQ 승인을
  못 되돌린다**(409) — 이 방향이 열리면 관리자 결정을 조용히 물릴 수 있다.
- **체인 되돌리기**: `produced → producing → eq_done → eq_requested → issued` 완주, **EQ 첨부
  2건 유지**. 되돌린 뒤 첨부 교체가 다시 열리고(EQ_LOCKED 는 승인요청 뒤 규칙) 같은 길로
  `produced` 재도달.
- **이력은 누적된다**: 앞 4칸 + 되돌림 4칸 + 재진행 4칸 = **12칸**, 되돌림은 `note='되돌리기'`
  로 구별. 왕복이 통째로 남아야 "왜 두 번 만들었나"를 나중에 설명할 수 있다.
- **선적 왕복**: `preparing → requested → (revert) preparing → requested`. **Invoice·출고예정일이
  유지된다** — 되돌린 뒤 다시 올리라고 하면 아무도 되돌리기를 쓰지 않는다(되돌리기의 값어치가
  여기서 판가름 난다). 첨부 없이 선적 요청은 `MISSING_INVOICE_FILE` 로 막힌다.
- **선적 취소는 막다른 길이 아니다**: 진행 중 409 `NOT_PREPARING` → 되돌리기 → 취소 200(문서
  소멸) → **재담기**.
- **선정 해제 순환 완주**: `PO_ISSUED` 409 → (EQ 를 issued 까지 되돌림) → `IN_SHIPMENT` 409 →
  선적 취소 → 발주 취소 → `unselect` 200(quoted) → **재선정** 200(selected).

⚠ **잠금은 겹겹이고 검사 순서가 곧 명세다** — 발주 취소는 상태(`NOT_ISSUED`)를 선적 소속
(`IN_SHIPMENT`)보다 **먼저** 본다. EQ 를 발주접수까지 되돌려야 비로소 "담겨 있어서 못 지운다"는
진짜 이유가 드러난다(첫 주행이 순서를 뒤집어 걸렸다).

**발견 1건 — 안내가 일어날 수 없는 이유를 댄다.** `eq-revert`(관리자) 라우트가 409 마다
"되돌릴 단계가 없거나 **관리자 차례의 전이가 아닙니다**"를 붙였는데, 관리자는 차례와 무관하므로
**뒤쪽 이유는 발생할 수 없다** — 진짜 원인(`NOTHING_TO_REVERT` = 이미 첫 단계 · `DELEGATED` =
MD 경유라 하위에서 진행)이 가려졌다. 코드별 문구로 갈랐다.

8/8 green · HTTP ≥400 0건 · 정리 CLEAN · typecheck 9/9 · lint · apps/api vitest 783.

### 여정 16호 — 동시 조작 경합 (2026-08-11)

앞의 열다섯 편은 전부 **한 번에 한 사람**이 조작했다. 실무는 그렇지 않다 — 관리자 둘이 같은
큐를 보고, 관리자와 협력사가 같은 발주를 동시에 민다. 낙관적 잠금(버전 컬럼)이 없는 자리에서
같은 요청이 겹치면 무슨 일이 생기는지 아무도 확인하지 않았다(`journey:concurrency`, 5케이스).

**어서션은 불변식이다.** "둘 다 200 이어야 한다"가 아니라 **끝난 뒤 세상이 성립하는가**를 본다 —
한쪽이 지든 둘 다 이기든 경합 해소 방식은 구현의 자유이고, 결과가 하나면 통과다.

- 동시 선정 → 확정가 **한 값** · 동시 입금확인 → **수납액이 두 번 더해지지 않는다**(돈이 겹치는
  것이 진짜 위험) · 동시 전이 → 상태 **한 칸**(두 번 먹으면 승인도 없이 `eq_done` 까지 간다),
  **이력도 한 줄**(상태는 하나인데 기록만 겹쳐도 사실과 다르다) · 동시 선적 전이 → 한 칸.

**발견 2건 — 제약은 지키는데 그 방어가 500 으로 샜다.** 동시 발행·동시 담기 응답이 `[200, 500]`
이었다. 데이터는 UK 가 정확히 막았지만(발주 1장·박스 1개·멤버십 1행) 진 쪽은 **안내 없는 서버
오류**를 본다 — 두 창을 연 관리자가 겪는 자리다. 12호가 닫은 것과 같은 계열(조직 삭제 FK 500 →
409 안내)이고, **제약이 데이터를 지키는 일과 그 방어를 사람에게 설명하는 일은 별개**다.

#### 교정 — 유니크 위반을 도메인 언어로 옮기다

성격이 달라 처리도 갈렸다.

- **담기(`ensurePcbShipment`)** — 합류 의미론에서 "이미 담겼다"는 **실패가 아니라 성공**이다.
  P2002 면 `findPcbShipmentByPo` 로 재조회해 **이긴 쪽의 박스를 돌려준다**(호출자에겐 순서만
  다를 뿐 결과가 같다). 합류 경로·생성 경로 양쪽에 건다. → `[200, 200]`
- **발행(`createAdminPcbPo`)** — 여기는 중복이라 성공이라 말하면 거짓이다. 사전 검사와 **같은
  코드**로 되돌린다(409 `ALREADY_ISSUED`). → `[200, 409]`

판정 헬퍼는 `isPcbUniqueViolation`(pcb-shipment.ts, P2002) 하나를 공유한다. C1·C3 이 "500 이
없다"를 어서션으로 물어 회귀선이 됐다.

5/5 green · 회귀 `journey:batch` 10/10 · `journey:combo` 9/9 · `journey:rewind` 8/8 ·
`journey:proxy` 8/8(담기 경로는 모든 여정이 지난다) · 정리 CLEAN · apps/api vitest 783.

### 여정 17호 — 레거시 이관분 접합(read-only) (2026-08-11)

앞의 열여섯 편은 전부 **이 주행이 방금 만든 건**을 밟았다. 그런데 실제 DB 는 이관분이
압도적이다(협력 기록 없이 '완료'인 레거시 19,665건). 신규 경로가 아무리 튼튼해도 관리자가
매일 여는 화면에는 그 이관분이 함께 뜬다. **이 편은 쓰기를 하지 않는다** — 실데이터를 건드리지
않고 "이관분이 신규 트랙의 화면·판정에 얹혔을 때 깨지지 않는가"만 본다(`journey:legacy`, 5케이스).

- **`_legacy` 메타 방어가 실데이터에서 동작한다**(핵심): 이관 `specJson` 엔 내부 id·고객 PII
  (`memberContact`)가 섞여 있다. 발주 패널 응답 8건 전부 200 이고 `_legacy`·`memberContact` 가
  **0건** — `stripInternalSpecKeys` 가 실제로 막고 있다. 이 응답은 **협력사 화면의 재료이기도
  해서**, 여기서 새면 직렬화 500 이전에 PII 유출이다.
- **대기 큐는 이관분을 세지 않는다**: `todo_rfq` 에 이관분 0건(`NOT_LEGACY` 조건이 산다).
  제외하지 않으면 레거시에서 이미 끝난 수백 건이 눌러앉아 **진짜 할 일이 묻힌다**(사용자 결정
  2026-08-05). 검사는 표본이 아니라 **큐에 실제로 뜬 것 전부**를 대조한다.
- **조감에는 보인다**: 같은 이관 스펙이 `all` 탭에 존재 — 제외는 "재촉 목록에서만"이고, 안 보이면
  D10 의 "필요하면 언제든 소싱 시작"이 불가능해진다.
- **화면이 그려진다**: 이관 Case 상세가 빈 화면이 아니고(975자 렌더) 내부 메타 비노출.

모수 실측: 이관 스펙 표본 200건 중 주문 연결 139건, `_legacy.stage` 는 `quote` 와 미표기 혼재.

**결함 0건.** 그 자체가 결과다 — 이관분 위에서 신규 트랙이 깨지지 않는다는 **근거가 처음
생겼고**, 앞으로 spec 을 응답에 싣는 라우트를 늘릴 때 이 편이 회귀선이 된다. ⚠ 이관분이 0건인
환경(초기화된 dev)에서는 검증 대상이 없으므로 조용히 green 이 되지 않도록 리포트에 그 사실을
남긴다(다음 사람이 "왜 통과했는지"를 알아야 한다).

5/5 green · 쓰기 0 · 정리 불필요.

### 여정 18호 — 고객 축 셀프 루프 (2026-08-11)

열일곱 편이 협력 트랙을 훑는 동안 고객은 대체로 **한 번 주문하고 기다리는 사람**이었다. 실제로는
고객도 계속 손을 댄다 — EQ 를 반려하고, 사양을 고쳐 달라 하고, 견적을 지우려 한다. 그 조작들이
여러 편에 조각으로 흩어져 있어(2호 반려 1회 · W6 사양 수정 · D13 삭제 가드) **한 주행에서 이어
본 적이 없다**(`journey:customer`, 7케이스).

**네 약속이 모두 지켜진다(결함 0건)**:

1. **주문 뒤 사양 수정 = 허용 + 주문행 동기**(W6 결론) — `ct_option` 이
   `"TG130-140 / 2L / 68.580x53.340mm / **5pcs**"` → `"… **10pcs**"` 로 갱신되고 재질·층수·크기
   표기는 살아 있다. **`io_id`·`ct_price` 는 불변** — 결제 당시 기록이 사후에 흔들리면
   "결제한 금액"이 달라진다.
2. **발주 뒤에는 잠긴다** — 같은 수정이 409 `PO_ISSUED`(협력사가 그 사양으로 이미 움직인다).
   허용과 차단의 경계가 한 편에 함께 선다.
3. **EQ 반려 왕복 2회차의 격리** — 1회차 반려(#77) → 협력사 재작업 → 2회차 요청(#78)에 **옛
   사유가 유입되지 않는다**(P4.10 교정이 산다). 되살아나면 고객에게 지난 사유를 다시 보내는
   사고다. 2회차 진입 시점에 **열린 고객 확인 요약이 null** 인 것까지 함께 못 박는다.
4. **주문 묶인 견적은 못 지운다** — 고객 경로 409 `ALREADY_ORDERED`, 견적 존속. 지워지면 주문만
   남고 근거가 사라진다.

⚠ **API 계약 함정 3종(이 편에서 실제로 걸린 것)**: ① `PATCH …/spec` 의 `spec` 은 **필수이고
전체 교체**다(부분 병합 아님) — 바꿀 키만 보내면 나머지 사양이 통째로 날아가 요약이 수량만
남는다. 어서션이 재질·층수 표기 유지까지 본다. ② 고객 EQ 결정 enum 은 `approve`|`reject`
(`approved`/`rejected` 아님). ③ 반려 사유 필드는 `note`(`reason` 아님).

7/7 green · 정리 CLEAN.

### 여정 19호 — 대량 묶음(한 박스 다섯 건) (2026-08-11)

지금까지 박스는 최대 2~3건이었다(3호·9호·11호). 실무에서 협력사는 **한 주치를 모아** 보낸다 —
그때 송장 품목 줄이 늘고, 입고확인 한 번이 다섯 건에 파급되고, 화면은 구성원을 열거해야 한다.
**"2건에서 되니 5건도 되겠지"는 검증이 아니다** — 대표 승계·게이팅·송장은 모두 **개수에 따라
코드 경로가 갈리는** 자리다(`journey:bulk`, 6케이스).

**고객 축을 뺀 것이 설계 판단이다** — 거버 제출 다섯 번이면 주행이 몇 배로 길어지는데 묶음의
스케일 성질은 주문 축과 무관하다(고객 축 접합은 3·9호가 지킨다). 대신 시드 발주라 **정리를
레지스트리로 정확히** 한다(스펙 무접촉, 잔재 0 검증).

실증(결함 0건):

- **합류는 개수와 무관하다** — 같은 컨텍스트 발주 5장이 박스 하나(#331)로, 구성원 5건.
- **송장 품목이 다섯 줄이고 줄마다 PO 번호가 붙는다** — 묶음 송장은 **통관 서류**라 한 줄만
  빠져도 수량이 안 맞고, 프로젝트명(=업로드 파일명)은 겹칠 수 있어 번호가 없으면 두 줄을
  구별할 수 없다(9호 교정이 5건에서도 산다).
- **전이는 박스 단위다** — 대표가 밀면 구성원 5건이 함께 `requested`. 대표만 움직이면 **네 건이
  유실**된다. 비대표 발주 상세로 조회해도 **같은 박스**가 나온다(서버는 발주서 축으로 찾는다).
- **입고확인 1회가 다섯 건을 닫는다** — `receivedAt` 기록이 구성원 전체의 신호가 된다.
- 협력사 완료 아카이브·관리자 선적 큐 렌더 정상.

6/6 green · 시드 정리 잔재 pos=0 shipments=0 memberships=0.

### 여정 20호 — 환율·통화 축(어느 시점 값이 어디에 박히는가) (2026-08-11)

8호가 다룬 것은 **지급 환율**(송금 시점, 원장)이었다. 이 편은 그 앞이다 — 배정·회신·선정·발주
각 시점에 환율이 어떻게 정해지고 **박제**되는가. 통화가 섞인 트랙에서 값이 나중에 흔들리면 원가
회계가 통째로 틀어지므로, **"언제 값이 굳는가"가 곧 신뢰의 근거**다(`journey:currency`, 5케이스).

- **KRW 는 환율이 없다**(`exchangeRate=null`, `krwAmount`=회신가) — 있는 척하면 1.0 을 곱하는
  코드가 생기고 그게 버그의 씨앗이다.
- **환율은 회신이 아니라 선정에서 정해진다** — 계약 `PcbRfqReplyBody` 에 그 키가 **아예 없다**.
  협력사는 자기 통화의 금액만 말한다. **회신은 며칠 전일 수 있어서**, 그때 환율을 박으면 "언제
  정한 값인가"가 흐려지고 선정(=원가를 확정하는 순간)과 어긋난 숫자가 회계에 남는다. 선정에
  명시하면 그 값이 박히고(@1400 → 원가 ₩140,000), 생략하면 당일 고시가 채운다(P4.7).
- **회신 근거 없는 수동 발주는 환율이 필수**(400 `EXCHANGE_RATE_REQUIRED` — body 검증 단계라
  409 가 아니다). 명시하면 @1350 박제(₩270,000).
- **발주 뒤에는 박제다**(이 편의 핵심): 조직 기본통화를 **실제로 USD→CNY 로 흔들어도** 기존
  발주는 `USD @1350 ₩270,000` 그대로다. 흔들렸다면 지난 원가가 오늘 환율로 다시 계산되는
  셈이다. 협력2 는 다른 여정이 USD 로 쓰는 상설 픽스처라 **원상복구까지 어서션**에 넣었다.

⚠ 함정: 발주는 **결제된 주문**이 있어야 선다(`NOT_ORDERED`·`NOT_PAID`) — 시드 스펙으로는 RFQ
까지가 한계다. `pickFreeSpecs` 는 PO 유무만 보므로 **비활성 스펙도 고른다**(`NOT_ACTIVE`).
이 편은 거버 1회로 주문을 만들고 **그 한 스펙에 두 조직**(KRW·USD)을 배정해 양쪽 축을 함께 본다.

5/5 green · 정리 CLEAN · 상설 픽스처 통화 원복 확인.

### 여정 21호 — MD 다중 상위·단수 제한 (2026-08-11)

MD 연작 다섯 편은 전부 **상위 하나 : 하위 하나**였다. 그런데 관계 설계는 다중 상위를 허용하고
(2단 강제만 있고 상위 수 제한은 없다) 실제로 상설 픽스처가 그 모양이다 — 협력2 가
`마스터딜러상사`(KR)와 `mdtester2상사`(CN) **양쪽의 하위**다. 그 상태에서 두 MD 가 같은 하위에게
각각 배정하면 무엇이 갈리는지 미검증이었다(`journey:mdmulti`, 4케이스).

**관계를 만들지 않는다** — 상설 픽스처 3건이 여러 편의 무대라 기존 관계로만 읽고 RFQ 만 만들었다
지운다(조직·관계 무접촉).

- **다중 상위가 성립한다**: 협력2 의 상위 2곳, 양쪽 하위 목록에서 **대칭** 확인.
- **배정은 관계별로 갈린다**: `마스터딜러상사`=KRW · `mdtester2상사`=USD(조직 기본통화 박제),
  둘 다 `parentPartnerId=0` — 관리자 트랙에서 MD 는 아직 **수주자**이지 중개자가 아니다.
- **2단은 강제다**: 하위를 상위로 세우려는 시도·MD 를 남의 하위로 넣으려는 3단 시도 모두 거절,
  **거절 후 관계 불변**(부분 적용되면 공유 픽스처가 조용히 오염된다).

⚠ **상태 코드가 가드마다 다르고 그 구분이 의도다**: `CHILD_IS_MD`·`PARENT_IS_CHILD` 는 **400**
(구조적으로 불가능 — 언제 다시 시도해도 안 된다), `PARENT_HAS_ACTIVE_POS` 는 **409**(지금만
충돌 — 발주가 끝나면 된다). "다시 해 보면 될 일"과 "영영 안 될 일"을 코드로 갈라 주고, 실제로
409 쪽 메시지만 다음 행동을 알려 준다("발주 종결 후 연결하세요").

⚠ **판정 순서를 계산할 때는 인자 방향까지 옮겨야 한다**(9호 교훈의 심화): `CHILD_IS_MD` 는
**`childPartnerId` 로 넘긴 조직**이 상위인지를 보고, `PARENT_IS_CHILD` 는 **경로의 조직**이 남의
하위인지를 본다. 첫 주행이 이 방향을 헷갈려 기대값이 뒤집혔다.

부수 교정: `pickFreeSpecs` 가 PO 유무만 보고 **비활성 스펙도 골라** 20·21호가 연달아
`NOT_ACTIVE` 로 튕겼다 → 헬퍼에 `status='active'` 필터를 넣어 근본에서 없앴다(19호 회귀 6/6).

4/4 green · 관계·조직 무접촉.

### 여정 22호 — 파일·첨부 권한 축 (2026-08-11)

파일은 트랙 전체에 흩어져 있다(거버 스펙·EQ 첨부·선적 서류·송금 증빙·A/S 첨부). 9호가 다룬
정보 격리는 **화면·목록 축**이었고 **다운로드 경계**는 얕게 봤다. 파일은 한 번 새면 되돌릴 수
없다 — 고객 도면이 남의 협력사에게 가면 그것으로 끝이다(`journey:files`, 6케이스).

**경계는 지켜진다(실측)**:

| 요청 | 결과 |
|---|---|
| 주인 조직이 자기 EQ 첨부 | 200 |
| **무관한 조직이 같은 URL 로** EQ 첨부 | **404** |
| 무관한 조직이 스펙 파일(고객 도면) | **404** |
| 고객 토큰으로 협력사 경로 | **403**(역할로 막힌다) |
| 승인요청 뒤 업로드·삭제 | **409** `EQ_LOCKED` |
| 고객이 **미공유** 첨부 요청 | **404**(같은 발주여도 `sharedFileIds` 밖이면 못 받는다) |

목록에서 안 보이는 것과 **URL 을 알아도 못 받는 것**은 다른 문제다 — 파일 id 는 순번이라 추측
가능하므로 직접 두드려 확인했다(주인의 200 이 있어야 그 404 가 "권한 때문"임이 증명된다).

**발견 1건 → [33호에서 해소]**: **EQ 첨부는 같은 종류를 다시 올려도 이전 것이 남는다**
(`uploadPcbEqFile` 이 create 만 한다). 선적 첨부(invoice/airwaybill)는 **종류별 1건 교체**인데
EQ 만 규칙이 다르다. 협력사가 잘못 올린 파일을 지우지 않고 새로 올리면 둘 다 남고, 관리자
화면은 나열만 하므로 **옛 도면을 보고 승인**할 수 있다 — 그러면 잘못된 도면으로 생산이 진행된다
(EQ 는 생산의 근거 서류라 파급이 크다). **다만 다층 보드처럼 도면을 여러 장 올려야 하는 실무가
있을 수 있어 교체로 바꾸면 그 경로를 막는다.**

→ 결정(2026-08-11): **누적을 유지하고 화면이 최신을 갈라 준다**(§9 여정 33호 ①). 파일은
지우지 않으므로 여러 장 올리는 경로가 살아 있고, 계약 `orderPcbEqFiles` 가 종류별 최신을
`isLatest` 로 표시하며 최신을 목록 앞에 세운다. 이 편의 V3 도 그 명세를 지키도록 갱신됐다
(누적 확인 + 최신 판정 확인).

6/6 green · 정리 CLEAN.

### 여정 23호 — 집계·카운트 정합 (2026-08-11)

관리자가 **매일 처음 보는 것**이 사이드바 배지 숫자다. 그런데 네 큐 모두 응답에 `counts`(탭별
합계)와 `total`(현재 탭 합계)이 **따로** 오고 서로 다른 SQL 로 계산된다 — 어긋날 수 있는
구조다. 한 번이라도 "3건이라는데 열면 없다"를 겪으면 **화면 전체를 믿지 않게 된다**
(`journey:counts`, 6케이스, **read-only**).

**대규모 실데이터에서 정합이 확인됐다**(시드로는 못 얻는 결과 — 이관분이 있어야 20건 경계가
실제로 생긴다):

| 큐 | 모수 | 결과 |
|---|---|---|
| Case | **20,942** | `all` = 부분 합(137+0+198+20,607) |
| 주문·결제 | **20,805** | `all` = 부분 합(0+198+19,665+942) |
| 발주·EQ | 8 | 전수 일치 |
| 선적 | 4 | 전수 일치 |

탭마다 `total == counts[tab]`, 첫 페이지 건수 = `min(total, 20)`, **페이지 경계에서 빠지거나
겹치는 건 없음**(3페이지까지 훑어 id 중복 0·중간 페이지 채움 확인), 부분 탭이 전체를 **정확히
분할**(같은 건이 여러 탭에 중복 계상되지 않는다). 고객 배송 탭(`to_ship`·`shipping`)은 진행 중
주문의 부분집합이라 합에 들지 않고 전체를 넘지만 않으면 된다.

⚠ **counts 키 규약이 큐마다 다르다**: PO 는 탭 이름 그대로 snake_case(`eq_pending`·`to_ship`),
Case 는 camelCase(`todoRfq`·`todoPo`), Order 는 `toShip`. 계약 타입이 화면 오타는 컴파일에서
막아 주므로 제품 결함은 아니지만, **큐를 오가며 코드를 쓰는 쪽은 매번 확인해야 한다**(이 편의
첫 주행이 그것에 걸렸다).

6/6 green · 쓰기 0 · 정리 불필요.

### 여정 24호 — 검색 정확성 + LIKE escape 누락 교정 (2026-08-11)

23호가 "숫자가 맞는가"였다면 이 편은 **"검색이 맞는 것을 찾는가"**다. 관리자가 주문번호로
검색했는데 안 나오면 그 건을 영영 못 찾고, 엉뚱한 게 섞이면 목록을 믿을 수 없다
(`journey:search`, 4케이스, **read-only** — 실데이터 2만여 건 위에서만 의미가 있다).

**발견 1건 — 검색창에 `%` 한 글자를 넣으면 전체 20,805건이 나왔다.** `g5-db.ts` 안에
`escapeLike` 가 있고 회원·주문 검색은 쓰는데 **PCB 큐 검색 두 곳만 빠져 있었다**
(`listPcbOrderSpecs`·`listPcbCaseSpecs`). 검색이 아무 일도 하지 않은 것과 같은데 화면은 "검색
결과"로 보여주므로 관리자는 **필터가 걸린 줄 알고** 목록을 읽는다.

`_` 쪽이 더 조용히 틀린다: 이 트랙의 `projectName` 은 **업로드 파일명**이라 `_` 가 흔하고
(표본으로 잡힌 것도 `DDC_ESP32.zip`), escape 하지 않으면 "임의의 한 글자"가 되어 엉뚱한 건이
섞이는데 **결과가 나오므로 틀린 줄도 모른다**. 교정 후 실측: `%`=13건 · `_`=16,577건(전체
20,805 대비 — `_` 가 파일명에 그만큼 흔하다는 증거이기도 하다).

함께 확인된 것: 세 키(프로젝트명·회원ID·주문번호) 모두 적중하고 전체보다 좁다 · 없는 검색어는
0건(조용히 전체를 돌려주지 않는다) · **검색 × 탭은 교집합**(탭 결과가 전부 검색어와 맞고,
탭별 합 == 전체 탭 결과 — 중복 계상 없음).

4/4 green · 쓰기 0.

### 여정 25호 — 역할 경계 매트릭스 (2026-08-11)

22호가 본 것은 **파일 다운로드** 경계였다. 이 편은 그 위 층 — **엔드포인트 전반**이다. 개별
라우트는 각 여정이 정상 경로로 지나가지만, **"권한 없는 쪽에서 두드리면"** 은 라우트를 추가할
때마다 빠지기 쉬운 검사다(`preHandler` 를 안 붙이면 조용히 열린다). 네 주체 × 열 경로를 한 판에
세운다(`journey:authz`, 5케이스, **read-only** — GET 만 두드린다).

| 주체 | 관리자 경로(5) | 협력사 경로(5) |
|---|---|---|
| 무인증 | **401** | **401** |
| 일반 회원 | **403** | **403** |
| 협력사 | **403** | **200**(양성 대조) |
| 관리자 | **200**(양성 대조) | **403** |

**양성 대조가 핵심이다** — 협력사가 자기 포털에서 200 을 받는 것을 함께 확인하지 않으면, 위의
거절들이 "권한 때문"인지 "라우트가 아예 없어서"인지 구별되지 않는다. 관리자가 협력사 포털
경로에서 403 인 것도 옳다: **대행은 관리자 경로로 한다**(12호가 그 동선을 세웠다).

**남의 문서 id 직접 접근도 막힌다**(po·rfq 실데이터로 확인) — 22호가 파일에서 본 것과 같은
논리다: 목록에 안 보이는 것과 **id 로 직접 두드리는 것**은 다른 검사이고, id 는 순번이라 추측된다.

5/5 green · 쓰기 0.

### 여정 26호 — 재고 축(정리 관례의 근거) (2026-08-11)

이 편에는 다른 동기가 있다. **스물다섯 편의 정리 관례가 전부** "주문을 `force-status '주문'` 으로
되돌려 **재고를 복원**한다"에 기대는데, 그게 맞는지 검증한 적이 없었다 — 근거가 틀렸다면 지금까지
주행이 조용히 재고를 갉아먹고 있었다는 뜻이다(`journey:stock`, 4케이스).

영카트 구조: 재고 차감은 **'준비' → '배송'** 전이에서만 일어나고 그때 `ct_stock_use=1` 이 찍힌다.
복원은 **그 표시가 있는 행만** 대상이라, 입금까지만 가는 대부분의 편은 애초에 복원할 것이 없고
배송까지 민 편만 실제 복원이 필요하다. PCB 견적은 **견적마다 자기 옵션 행**을 가져
(`io_id=quoteId`, 초기 9,999,999) 다른 건과 섞이지 않는다 — 그 행 하나를 추적하면 관찰이 깨끗하다.

실측(결함 0건):

| 단계 | io_stock_qty | ct_stock_use |
|---|---|---|
| 주문 직후 | 9,999,999 | 0 |
| 입금확인 | 9,999,999 | 0 |
| 준비 | 9,999,999 | 0 |
| **배송 전이** | **9,999,998**(-1) | **1** |
| **'주문' 복귀** | **9,999,999**(+1) | **0** |
| 재복귀 시도 | 9,999,999(불변) | 0 |

**K3 가 정리 관례의 근거이고, K4 가 그 안전성이다** — 복원이 차감 표시와 무관하게 동작한다면
되돌릴 때마다 재고가 늘어난다(claim-first 설계로 막혀 있다).

4/4 green · 정리 CLEAN.

### 여정 27호 — 삭제의 위계 (2026-08-11)

15호가 "되돌리기"였다면 이 편은 **"지우기"** 다. 삭제는 되돌릴 수 없어 가드가 겹겹인데, 그 위계에는
실측으로 얻은 이유가 있다 — `pcb-projects.ts` 주석의 사고 기록: **"고객이 보관함에서 한 번 더
지우면 협력사에 메일이 나간 견적요청이 통째로 cascade 로 사라졌다"**(2026-08-06). RFQ 는 주문 전
스펙에도 보낼 수 있어(D10 게이트) 고객 손이 닿는 자리였다. 규칙은 그래서 생겼다 — **상대가 있는
기록은 고객 단독으로 없앨 수 없다**(`journey:delete`, 5케이스).

**삭제는 2단계다**(이 편이 처음 명시): 첫 `DELETE` 는 **보관함**(soft, `status='deleted'`)이고,
보관함에서 한 번 더 지르는 것이 **영구 삭제**다. 협력 트랙 가드는 **되돌릴 수 없는 쪽에만** 걸린다
— 고객의 "목록에서 치우고 싶다"와 "완전히 없애겠다"는 다른 의도이기 때문이다.

- 1단계 보관함 200(`deleted`) · **2단계 영구 삭제 409 `PARTNER_TRACK_ACTIVE`** · 스펙·RFQ 모두
  존속(**부분 삭제가 없다** — 한쪽만 사라지면 그게 더 나쁘다).
- **가드가 풀리면 지워진다**: RFQ 를 정리하면 영구 삭제 200 — 잠김 → 정리 → 열림 순환이 삭제에도
  성립한다(출구 없는 잠금이 아니다).
- **지운 뒤 잔재 없음**: 물리 삭제 후 관리자 큐 비노출 · **고아 스펙 파일 0**(파일서버에 쓰레기가
  쌓이지 않는다).
- 대조군: 조직은 이력이 있으면 409 `PARTNER_HAS_RFQS` — **배제는 삭제가 아니라 정지**(13호).

5/5 green · 자기가 만든 스펙만 다루고 직접 지운다(실데이터 무접촉).

### 여정 28호 — 발송 이력 원장 (2026-08-11)

스물일곱 편이 메일을 보내는 동안 그 발송이 **`sp_mail_log` 에 남는지**는 검증된 적이 없었다.
Mailpit 으로 "도착했다"는 여러 번 봤지만 그건 개발 환경의 수신함이고, **운영에서 유일한 증거는
원장**이다 — 협력사가 "못 받았다"고 할 때 관리자가 댈 근거가 이것뿐이다(`journey:maillog`, 5케이스).

실측(결함 0건): 견적요청·발주서 발행·EQ 결정이 각각 기록되고 **종류가 갈린다**
(`pcb_rfq_request` · `pcb_po_issued` · `pcb_eq_decision`) · `status` 전부 `sent`(비정상 0) ·
`recipient` 기록(수신처 없으면 증거로 못 쓴다) · **`sentBy=e2e-admin`**(관리자가 눌러 나간 메일과
시스템 자동이 구별된다).

**컨텍스트가 이 편의 핵심이다** — `refType='pcb_spec'`/`refId` 가 그 건을 가리켜야 Case 상세에서
되찾을 수 있고, 틀리면 **원장에는 있는데 아무 화면에서도 안 보인다**(있으나 마나). API
(`/admin/mail-logs?refType=&refId=`)와 Case 상세 '보낸 메일' 섹션 양쪽에서 연결을 확인했다.

⚠ 관찰: EQ **승인요청**과 **승인**을 각각 했는데 기록은 `pcb_eq_decision` 하나였다. 승인요청은
협력사→관리자 방향이라 대행 시 자기에게 보내는 셈이 되어 스킵됐을 수 있고, 애초에 메일을 안
보내는 설계일 수도 있다 — **"기록이 없다"가 아니라 "발송 자체가 없다"** 일 가능성이 있어 결함으로
단정하지 않는다(다음에 이 자리를 볼 때의 출발점).

5/5 green · 정리 CLEAN.
### 여정 29호 — A/S 다회차(3차까지) (2026-08-11)

5호가 1차를, 7호가 2차(거절→재접수 포함)를 밟았다. **회차가 더 늘면**? 재발주는 실무에서 두세
번이 흔하고, 회차는 **박스 합류 키의 한 축**(`받는측:조직:직송지:회차`)이라 채번이 어긋나면
**3차 물건이 1차 박스에 섞이고 1차 송장에 실린다**(`journey:asrounds`, 4케이스 · 시드 발주).

실측(결함 0건):

- **채번이 MAX+1 로 이어진다** — 1 → 2 → 3(건너뜀·겹침 없음).
- **회차마다 발주가 따로 서고 공존한다** — 같은 스펙·같은 조직인데 UK 에 `reorderRound` 가 있어
  `#740(r0) · #741(r1) · #742(r2) · #743(r3)` 네 건이 함께 산다.
- **원발주는 그대로다** — 회차를 아무리 쌓아도 round 0 의 id·상태가 불변.
- **박스가 회차로 갈린다** — 세 회차를 각각 담으면 **박스 3개**, 대표 회차 1·2·3, **각 박스 구성원
  1건**(합류 0).

⚠ **검증 함정**: 회차는 **발주에 있는 값**이고 `sp_pcb_shipment` 에는 저장되지 않는다(계약 뷰의
`reorderRound` 는 대표 발주에서 파생). 첫 주행이 없는 필드를 읽어 `-1·-1·-1` 을 찍었는데
**어서션은 통과했다** — "박스가 갈렸다"는 알지만 "회차대로 갈렸다"는 증명하지 못한 상태였다.
없는 필드는 조용히 기본값이 되므로 **리포트 문자열을 눈으로 확인**해야 잡힌다.

4/4 green · 시드 정리 잔재 0.
### 여정 30호 — 송금 다회·증빙 (2026-08-11)

8호가 부분 송금 2회와 환차를 봤다. 실무는 더 잘게 나뉜다 — 계약금·중도금·잔금처럼 세 번, 네 번이
흔하고 각 회차에 이체 확인증이 붙는다. **잔액이 한 번이라도 틀리면** 과지급·미지급이 생기고,
원장이 정본이라 화면·큐·포털이 **모두 같이 틀린다**(`journey:remitmulti`, 5케이스 · 시드 발주).

실측(결함 0건, $300 을 100/100/100 으로):

- **다회 누적이 정확하다** — 회차마다 지급액·잔액이 따라오고 원장 3건으로 갈린다(뭉치지 않는다).
- **완납이 큐를 가른다** — 잔액 0 이면 지급 대기에서 빠지고 완료에 든다. *잔액 0 인데 대기에
  남으면 관리자가 또 보낸다 — 과지급은 거기서 시작된다.*
- **증빙이 회차마다 매달린다** — 1·2회차 각 1건, 증빙 없는 3회차는 0건(한 곳에 몰리지 않는다).
- **정정·삭제가 즉시 반영된다** — 100→50 정정 시 지급 250/잔액 50, 삭제 후 지급 200/잔액 100.
  원장은 **정정되는 기록**이라(8호가 "행마다 통지하면 알림이 사실보다 앞선다"고 판단한 근거)
  합계가 항상 원장에서 다시 계산돼야 한다.

⚠ 계약 함정: `PcbRemittanceCreateBody` 는 `remittedOn`(`paidAt` 아님)을 받고 **`currency` 를 받지
않는다** — 발주 통화를 따른다. 송금마다 통화를 지정할 수 있으면 한 발주에 USD·KRW 가 섞여 합계가
무의미해지므로, **아예 안 받는 것**이 그걸 구조적으로 막는다. 응답은 `{summary, remittances}`.

5/5 green · 시드 정리 잔재 0.
### 여정 31호 — 알림 게이트 (2026-08-11)

28호가 "보낸 것이 원장에 남는가"였다면 이 편은 그 앞 — **보낼지 말지를 무엇이 정하는가**다.
설정이 무시되면 **고객에게 원치 않는 알림이 나가고**, 반대면 "연락을 못 받았다"가 된다. 둘 다
되돌릴 수 없다(`journey:notify`, 5케이스).

게이트는 두 층(`getNotifyConfig`) 위에 요청 스위치(`sendMail`/`sendSms`)가 얹힌다:
**메일**=`cf_email_use` · **SMS**=`cf_sms_use='icode'` **그리고** 전이별 `de_sms_use4`(입금)/
`de_sms_use5`(배송). SMS 조건이 코어 상세(truthy)보다 좁은 것은 **실발송 조건과 같게 맞춘**
것이다 — 관리자가 체크박스를 눌렀는데 안 나가면 헛수고이기 때문(노출-발송 정합).

실측(결함 0건): API `notify-config` 가 DB 실값과 일치(`mailAvailable=true`/`cf_email_use=1`,
SMS 는 icode 가 아니라 false) · **요청이 끄면 기록조차 없다**(`sendMail:false` → 0건, 시도 자체가
없다) · **설정이 상위다**(`cf_email_use=0` 에서 `sendMail:true` 로 전이해도 `sent` 0건) ·
되돌리면 게이트가 즉시 따라온다.

어서션을 "기록이 없어야 한다"가 아니라 **"`sent` 가 없어야 한다"** 로 잡았다 — `skipped` 로 남는
것은 오히려 좋다(**왜 안 갔는지가 남는다**).

⚠ 이 편은 **전역 설정**을 잠깐 끈다. `afterAll` 에서 반드시 되돌리고 원복을 리포트에 남긴다
(안 되돌리면 이후 모든 주행의 메일이 막힌다). 주행 후 DB 직접 확인: `cf_email_use=1` 원복 완료.
**순차 주행 전제**다 — 병렬이면 다른 편의 메일을 막는다.

5/5 green · 전역 설정 원복 확인.
### 여정 32호 — 화면 렌더 회귀 (2026-08-11)

앞의 서른한 편은 각자 **필요한 화면만** 열었다. 그래서 "어느 여정도 열지 않는 화면"이 남고
(부품 검색·발송 이력·회원 관리 등), 거기가 깨지면 **아무 테스트도 빨개지지 않은 채** 관리자가
클릭한 순간에야 발견된다. 계약 필드를 늘리거나 라우트를 손볼 때 가장 조용히 무너지는 자리다.

**넓고 얕게** 본다 — 세 역할 16화면에서 `pageerror 0` · `5xx 0` · **내용이 있는가**만.
각 화면의 의미는 해당 여정이 지키므로 여기서는 "열리는가"만 확인한다(`journey:screens`,
4케이스, **read-only**).

실측(결함 0건): 관리자 10화면 평균 1,288자 · 협력사 포털 5화면 · 고객 주문내역 1화면 —
**전수 pageerror 0 · 5xx 0**.

설계 두 가지에 13호 교훈을 반영했다: ① 포털 경로는 **실재하는 것만**(`pcb/pos` 목록은 없다 —
없는 URL 은 흰 화면이 되어 결함처럼 보인다) ② **빈 껍데기 검사**(라우트 매칭 실패가 정확히 그렇게
나타난다). 그리고 **실패해도 계속 돌아 전수 목록을 만든다** — 첫 실패에서 멈추면 나머지 화면
상태를 모르고 고칠 순서를 못 정한다.

4/4 green · 쓰기 0.

### 여정 33호 — 미결 판단 3건의 구현 (2026-08-11)

앞선 여정들이 "여기가 문제다"까지 밝혀 놓고 **사람의 결정을 기다리던** 항목이 셋 있었다.
셋 다 기술이 아니라 실무를 아는 사람만 답할 수 있는 물음이었고, 2026-08-11 결정이 내려졌다.
이 편은 그 결정을 구현하고 실제로 그렇게 도는지 확인한다(`journey:decisions`, 12케이스).

**① EQ 첨부 — 누적 유지 + 최신 표시**(22호 결함의 결정판). 교체(선적 첨부 규칙과 통일)도
후보였으나 **다층 보드처럼 여러 장 올리는 실무를 막고, 덮어쓰기는 되돌릴 수 없다**는 이유로
누적을 유지했다. 대신 계약에 순수 함수 `orderPcbEqFiles`를 두어 **종류별 최신 1건**을
`isLatest` 로 표시하고 **최신을 목록 앞에** 세운다. 관리자 Case 는 최신만 펼쳐 두고 이전은
`[이전 N]` 뒤에 접으며, 협력사 포털은 '최신'/'이전' 배지와 함께 *"이전 파일도 그대로 남아
담당자에게 보입니다"* 를 알린다 — 협력사가 "덮어썼겠지"라고 여기는 것이 이 결함의 뿌리였다.
'가장 나중'은 `writeDate` 가 아니라 **fileId** 로 정한다(같은 초에 두 건이 들어오면 시각은
갈리지 않는다).

**①-b 반려 뒤 보완 표시**(이월했던 'EQ 파일 회차 표기'의 실질). 회차 번호를 붙이는 것보다
관리자가 실제로 알아야 할 것은 **"반려했는데 새 파일이 올라오긴 했나"** 였다. EQ 첨부는
승인요청 뒤 잠기므로(`EQ_LOCKED`) 보완 파일은 **반드시 반려와 재요청 사이**에 올라온다 —
그 구간이 비어 있는데 승인요청이 와 있으면 협력사가 같은 도면으로 재요청한 것이고, 관리자는
그것을 모른 채 승인한다. 계약 `lastPcbEqRejectedAt` 이 직전 반려 시각을 찾고
`orderPcbEqFiles` 가 그 뒤 파일에 `afterReject` 를 찍는다. 관리자 Case 는 보완분에 '· 보완'
배지를, **승인 버튼 옆에는 '반려 후 새 파일 없음' 경고**를 세운다(그 정보는 승인하려는 순간이
아니면 볼 이유가 없다). 협력사 포털은 반려 배너 안에서 보완 여부를 알린다 — 파일 없이
재요청하면 왕복이 한 번 더 늘 뿐이다.

⚠ 반려와 '요청 취소'는 **같은 전이**(`eq_requested → issued`)라 상태로는 갈리지 않는다.
가르는 것은 **사유(note)** 다 — 전진·되돌리기는 note 를 남기지 않고 반려만 남긴다. 역할로도
갈리지 않는다(관리자 대행이 협력사 몫의 취소를 하면 byRole 도 ADMIN 이다).

**② 과입금 환불 — 기록 창구 신설**(10호 X5). 실행은 여전히 결제사·계좌에서 사람이 하고,
시스템에는 **"돌려줬다"는 사실만** 남긴다(`PATCH /admin/orders/:odId/refund`). 기록이
없으면 같은 건을 두 번 돌려주거나 영영 안 돌려준다. `od_refund_price` 는 **이미 미수 산식에
들어 있어**(`- (receipt + point - refund)`) 적는 순간 과입금이 스스로 0 으로 닫힌다 —
새 컬럼이 필요 없었다. 컬럼·의미가 코어 `orderform.php` '결제취소/환불 금액' 입력란과 같아
`/adm` 과 같은 값을 본다. 금액은 **누계**이고, 누가·언제·얼마는 `od_mod_history` 에
append 한다(⑮ 취소 블록 관례). 입금 조정과 달리 **결제수단 가드는 없다** — 과입금은 수단을
가리지 않고 생기며 여기 쓰는 것은 PG 취소 실행이 아니다.

**③ 송금 완납 통지 — 잔액 0 달성 1회**(8호 유보). 회차마다 보내면 알림이 사실보다 앞선다
(30호 실측: 100→50 정정·행 삭제). 잔액 0 은 워크큐를 가르는 경계이자 협력사가 실제로 알고
싶은 유일한 지점이다. "1회"는 **발주서당 1회** — `sp_mail_log(kind='pcb_remit_settled',
refType='pcb_po')` 에 `sent` 기록이 있으면 다시 보내지 않는다. 그래서 완납 뒤 정정으로 잔액이
되살아나 다시 0 이 되어도 재통지하지 않는다(이미 나간 메일은 되돌릴 수 없고, 같은 문구를 두 번
보내면 두 번 받았다고 여긴다). 송금이 0건이면 보내지 않으므로 **무상 A/S 회차**(잔액을 0 으로
눕히는 표시 규칙)가 통지로 새지 않는다.

실측(14/14 green): EQ 3건 보존하며 `isLatest` 는 `eq-v2:true · working-v1:true · eq-v1:false`
— 첫 항목이 최신. 화면은 접힘 상태에서 '이전' 0개 → `[이전 1]` 클릭 후 1개. 반려 뒤 보완 없이
재요청하면 `afterReject` 파일 **0건**이고 승인 버튼 옆에 경고가 서며, 보완 파일을 올리면
`eq-fixed.zip` **하나만** `afterReject=true`(이전 3건은 false — 지워지지 않는다)이고 경고는
걷힌다. 부분 송금(150/300 USD) 통지 **0건** → 완납 시 **1건 sent**("PCB 대금 지급 완료",
총액 300 USD 2회 분할) → 과지급 전이·행 삭제로 재-완납까지 겪어도 **1건 그대로**. 부분 취소
과입금 `od_misu=-500,000` → 환불 기록 후 **0**, 이력에
`2026-08-11 18:38:17 e2e-admin 환불 500,000원 기록 ([여정 33호] 계좌 이체 확인)`.

세 항목의 어서션이 모두 **전달 경로**(응답 필드·화면 텍스트·발송 원장)에 걸린 것은 우연이
아니다 — 셋 다 "서버는 옳게 판단하는데 사람에게 전달되지 않는다"는 같은 뿌리에서 나왔다.

14/14 green · 순수 함수 단위 14케이스(`pcb-eq-files.test.ts`).

### 여정 34~43호 — 네 번째 열 편 (2026-08-11)

앞의 서른세 편이 **흐름·경계·횡단면**을 봤다면 이 열 편은 **발이 빠지는 자리**다 — 앵커가
끊기고, 화면이 비고, 값이 험하고, 창이 좁고, 두 손이 같은 순간 움직이는 국면. 확정 결함
**5건 전부 교정**.

- **34호 앵커 정합**(`journey:orphan`) — **결함 1(교정)**. 관리자가 미입금 주문을 지우면
  고객 견적이 **어느 목록에도 없어졌다**. 코어는 주문 헤더만 지우고 카트 행은
  `ct_status='삭제'` 로 남기는데, `getCartStates` 가 상태를 안 가려 "주문됨"으로 세던 탓이다
  (견적관리는 빼고, 보관함은 안 보내고, 담기는 ALREADY_ORDERED). 교정 두 층: '삭제' 행을
  없는 것으로 보고, 목록이 **"주문이 지워진 건"과 "장바구니에서 뺀 건"을 갈라** 전자는
  앵커를 비워 견적관리로 되돌린다. 결제 흔적이 있는 주문은 그대로 삭제가 막혀 협력 트랙이
  고아가 되지 않는 것도 함께 실측(NOT_ORDER_STATUS skip).
- **35호 빈 상태**(`journey:empty`, read-only) — 결함 0. 다섯 큐의 검색 0건·포털 네 화면·
  발주 0건 Case 가 모두 "없습니다"를 말한다. ⚠ RFQ·발주 큐는 **기본 탭에 검색창이 없다**
  (그 탭은 계약 탭이 아니라 별도 데이터 소스라 검색을 지원하지 않는다).
- **36호 입력 경계**(`journey:input`) — **결함 2(둘 다 교정)**. ① 295자 공백 없는 파일명이
  협력사 보드를 **가로로 터뜨렸다**(1503>1440px) — grid item 의 `min-width:auto` 라
  안쪽 truncate 가 걸려도 카드가 넓어진다. 카드에 `min-w-0`(일곱 곳). ② 191자를 넘는
  프로젝트명이 **조용히 잘렸다**(에러도 경고도 없다). 프로젝트명은 고객이 올린 거버
  파일명이라 길이를 우리가 정할 수 없는데, MySQL 이 strict mode 가 아니면 초과분을 버리고
  성공으로 답한다 — **운영이 strict 면 같은 입력이 500 으로 터진다**(환경에 따라 동작이
  갈리는 것 자체가 위험이다). 계약 `clampPcbProjectName` 이 저장 전에 자르고 말줄임표를
  붙인다(업로드를 거부하지는 않는다 — 파일명이 길다고 견적을 못 내게 하는 것은 과하다).
  특수문자·따옴표·백슬래시·이모지는 무손실.
- **37호 금액 정밀도**(`journey:precision`) — 결함 0. USD 100.03 을 셋으로 나눠 보내도
  지급 합계가 발주가와 같고 잔액이 **정확히 0**·'paid'. 1센트를 덜 보내면 'partial' 로
  갈리고 되돌리면 'paid' — EPSILON(0.005)은 부동소수 잡음만 흡수한다. 회차별 KRW 반올림
  합과 총액 일괄 환산의 차이는 **1원**.
- **38호 수신자 없는 알림**(`journey:recipient`) — 결함 0. 담당자 메일이 비면 발송이
  **조용히 사라지지 않고** `skipped/missing_recipient` 로 남고 이력 화면이 '건너뜀'으로
  보여 준다. 메일 실패가 API 를 무너뜨리지도 않는다. ⚠ 상설 픽스처를 만지므로 31호 관례대로
  원복 어서션을 걸었다.
- **39호 좁은 화면**(`journey:narrow`, read-only) — **결함 1(교정)**. 1280·1024·768 에서
  관리자 큐 여섯과 Case 상세는 멀쩡했고 **협력사 발송 화면만 768 에서 1203px** 로 터졌다
  (36호와 같은 뿌리 — 2열 grid 칸에 `min-w-0`).
- **40호 되살리기**(`journey:revive`) — 결함 0. 전량 취소 → od 헤더 '취소' + 협력 트랙
  잠금(ORDER_CANCELED) → force-status '주문' 으로 **줄·헤더가 함께 복귀**(재고 점유 해제·
  취소액 소멸) → 재입금·EQ 전진 성공. **전량 취소는 되돌릴 수 있는 종결**이다.
- **41호 동시 조작 2탄(돈 축)**(`journey:moneyrace`) — **결함 1(교정)**. 잔액을 0 으로
  만드는 두 송금이 동시에 오면 **완납 통지가 두 번 나갔다** — 33호가 주석으로 "레이스는
  막지 않는다"고 밝혀 둔 자리가 실제로 터진 것이다. 발주서별로 통지 시도를 프로세스 안에서
  직렬화해 조회-발송 사이의 틈을 없앴다(⚠ 다중 인스턴스에서는 여전히 벌어진다 — 근본책은
  원자적 claim 컬럼, 스키마 변경이라 이월). 동시 송금 두 건은 요약이 실제와 어긋나지 않고,
  동시 환불은 **누계 덮어쓰기**라 금액이 부풀지 않는다.
- **42호 내 차례**(`journey:myturn`, read-only) — 결함 0. 보드의 '진행할 발주' 9건 = DB
  수주 발주 9건 = RECEIVER 차례 상태 합 9건이고, 열어 보니 실제 행동 버튼이 있다.
- **43호 고객이 보는 것**(`journey:customerview`, read-only) — 결함 0. 주문내역 목록·상세
  **텍스트와 DOM 양쪽**에 협력사명·발주가가 없고(공급망 미노출), 진행 상태 낱말은 보인다.

⚠ 이 루프의 자기 실수: raw SQL 컬럼명 추측 2회(`s.ct_id` — Prisma 필드로 가야 한다),
응답 키 오독 1회(`data.items`), 발주에 `rfqId` 누락(200 인데 pos 가 비어 뒤가 조용히 무너짐),
placeholder 를 '검색'으로 가정(여섯 중 다섯이 안 맞아 검증이 통째로 비었다), 그리고
**같은 견적으로 같은 협력사에 RFQ 를 다시 보내면 중복이라 시도조차 없다**(발송 경로를 여러 번
태우려면 견적을 나눠야 한다).

## 10. 조사 자료 색인

- 레거시 백엔드 근거: `samplepcb_xpse/src/main/java/kr/co/samplepcb/xpse/` — resource 7종(SpPcbPartnerOrder/Doc/AsCase/ShipmentGroup/Shipment/ShipmentInvoice/PcbMyTurn) · service 동명 + ExchangeRate 3종 · `resources/db/migration/*.sql` 12종(수동 적용, DDL 헤더 주석이 설계 정본).
- 레거시 프론트 근거: `sp-smartbom-web/src/` — views/Pcb*.vue 11종, `types/pcbEqWorkflow.ts`(EQ 전이표), `views/Shipment.types.ts`(선적 전이·필드·택배사), `services/{shipmentService,asCaseService}.ts`, `utils/currency.ts`, `components/pcb/*`·`components/shipment/*`.
- 레거시 문서: `sp-smartbom-web/doc/` — pcb-as-reorder(06-24)·pcb-delivery-date(06-23)·pcb-destination-shipping(06-22)·master-dealer-pcb-estimate(06-18)·shipment-group·invoice-generator(06-20). + **docs/legacy-smartbom/**(회수본 3종).
- 플랫폼 근거: `apps/api/src/routes/admin-pcb-projects.ts`(확정가 409 가드), `apps/api/src/lib/g5-db.ts`(주문 체인·force-status), `apps/api/prisma/schema.prisma`(48모델), BOM 트랙 lib/routes 일습, `apps/web/src/admin/menu.ts`(모듈 스위처), docs/GERBER_ORDER_FLOW.md·GERBER_PRICE_MODE.md·SMARTBOM_PARTNER_RFQ.md.
- DB 실측: 플랫폼 `samplepcb`(sp_pcb_* 없음·앵커 상품 6종·spec/quote 20,537) vs `samplepcb_legacy_full`(PCB 상품 38,766·워크플로 데이터 소량) — DDL 덤프 `docs/legacy-smartbom/legacy-pcb-ddl.sql`.




