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
 → EQ 5단계: 발주접수 → EQ승인요청(수주자, EQ/Working 파일) → EQ완료(관리자 승인/반려)
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
- **계약**: `schemas/pcb-po.ts` — 상태 5종(issued→eq_requested→eq_done→producing→produced) + **정방향/역방향 전이 사전(PCB_EQ_FORWARD/REVERT)이 FE 라벨과 서버 검증의 단일 정본**(레거시 pcbEqWorkflow.ts 대응). EQ 파일 2종(eq/working)·이벤트·관리자/포털 뷰·워크큐.
- **lib `pcb-po.ts`**: 발주 생성(paid 게이트=`getOrderInfoByCtId.isPaid`, 선정 견적행 스냅샷 프리필, 외화 관리자 발주 환율 필수→krwAmount 박제, **MD 하위 발주는 KRW 회계 없음** — 레거시 승계), PATCH(금액은 issued에서만)·삭제(issued+하위 잔존 거부, 첨부 leaf-first 정리), **EQ 전이 서버 강제**(expectedFrom 고정 — 오발 방지, 주체 검증, eq-request는 eq+working 파일 존재 필수, 반려 사유·되돌리기=직전 주체 1칸, eqHistory 누적), **MD 위임**(관계 보유 조직 수주 상위=자체 EQ 차단→blocked/delegatePoId, 하위 전이 시 상위 상태 미러, MD가 하위 RECEIVER를 fallback 대행 — byRole MASTER_DEALER), EQ 첨부(sp_file refType `sp_pcb_po_eq`, 업로드 대행·issued에서만 편집·프록시 다운로드).
- **라우트**: `admin-pcb-pos.ts`(횡단 워크큐 /admin/pcb-pos — 경유 상위 제외 실작업 단위, 발행/수정/삭제, eq-approve/reject/revert — **승인은 관리자만(D3)**, 첨부 열람) / `partner-pcb-pos.ts`(목록 수주·발주 양방향+myTurn, 상세, 스펙·EQ 파일 프록시, multipart 업로드, 전이 4종, MD 하위 발주). 메일 4종(발행/EQ요청→관리자/승인·반려→수주자/생산완료→발주 주체).
- **웹**: AdminPcbCase에 **발주 패널**(발행 모달=선정 회신 승계 프리필+조건, PO 표=EQ 승인/반려/승인취소/발주취소+첨부+MD 하위 블록) · `AdminPcbPos.vue` 워크큐(메뉴 '발주·EQ'+배지=EQ 승인 대기) · 포털 `PartnerPcbPoDetail.vue`(5단계 스텝퍼+파일 업로드(잠금 규칙)+전이/되돌리기+MD 하위 발주+위임 안내·fallback 보조 스타일) · 홈 '진행할 PCB 발주' 카드.
- **검증**: **풀 E2E 44 ALL PASS**(실서버 — 결제 완료 실주문 스펙 Q20584: paid 게이트 409, 금액/환율 필수 400, 파일 없이 요청 409, 요청 후 파일 잠금, 순서 위반 409, 반려(사유 이력)→재요청→승인→승인취소→재승인, 생산 완주, 워크큐, 이력 8이벤트, MD blocked→하위 발주→위임/미러/fallback(byRole 검증), 타 조직 404, **다단 revert로 원상복구 후 삭제**(HAS_CHILDREN 가드 포함), Mailpit 11통). vitest 635·`pnpm -r typecheck`·ESLint 신규분 0건.
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
- **제작 사양 라벨 정합(08-04 추가)**: 상세 4화면(Case·포털 RFQ/PO·매직링크)이 specJson 원키를 그대로 노출하던 것을 **레거시 정본 명칭·순서**(sp-smartbom-web `types/pcbCart.ts` SPEC_ROWS = PHP `estimate_form_ca10.php` 원문 — '보광판'·'기준점표시' 등 표기 그대로)로 교체 — 공용 `lib/pcb-spec.ts`(`pcbSpecEntries`: PCB크기=width X length 합성, 미지 키 후미 보존). 코어 i18n specKeys 도 동일 정합 — **material=PCB선택(TG)·kindPcb=PCB재료(FR-4) 라벨이 뒤바뀌어 있던 결함 교정**(+패널/최소트랙공간/표면처리/임피던스제어/기준점표시/커팅 등 정정).

### P3.6 구현 기록 (2026-08-05 — 역할별 대기 큐·진행 단계 조감)

배경: "입금이 끝났는데 발주·EQ 메뉴에 그 건이 안 보인다"(사용자). 조사해 보니 **워크큐 5개 중 3개가 같은 병**이었다 — 견적요청은 `sp_pcb_rfq` 행, 발주·EQ는 `sp_pcb_po` 행, 선적·배송은 `sp_pcb_shipment` 행이 있어야만 모수에 들어와, 각 역할이 **아직 시작하지 않은 일**이 어느 화면에도 없었다(진행현황으로 되돌아가야만 진입 가능). SmartBOM 은 각 워크큐 첫 탭을 "대기"로 두어 이미 해결한 문제다(SMARTBOM_PARTNER_RFQ.md §6.12) — 같은 골격, 구현은 PCB 전용(D9).

- **결정 추가**: **D12** 대기 큐 원칙 + 이관분 제외(§6 표 아래).
- **계약**: 신설 `schemas/pcb-cases.ts` — 구간 탭(quoting/unpaid/production/closed/all) + 대기 탭(todo_rfq/todo_po), `PCB_STEPS` 12단계 라벨, `AdminPcbCaseItem`(스펙+od+RFQ·PO·선적 파생 + `step`·`isLegacy`). `pcb-po.ts` — `ADMIN_PCB_PO_TABS`에 **to_ship**(생산완료·발송 미편성) 추가 + `awaitingShipment` 필드 + counts 확장. **회수**: 코어 `AdminQuoteListQuery.tab` 의 PCB 전용 `preorder` 와 `counts.preorder`(→ pcb-cases 로 이관, 코어 계약에 PCB 개념을 남기지 않는다).
- **서버**: g5-db **`listPcbCaseSpecs`**(한정 예외 ⑳ 연장 — 스펙 축 **LEFT JOIN** 판이라 주문 전·유령까지 모수, counts 는 SUM(CASE) 1쿼리, 검색에 견적번호 정확일치 추가). 신설 `routes/admin-pcb-cases.ts` — 페이지 행만 RFQ·PO·선적으로 enrich 해 `step` 을 서버에서 계산(판정 원장이 전부 서버에 있으므로 FE 는 라벨만). `lib/pcb-po.ts` `loadAdminPcbPoWorkItems` 의 소속 탭을 **배열**로 전환(to_ship 은 produced 의 부분집합이라 배타적이지 않다) + 선적 배정 링크 1쿼리 선조회. `listGhostActiveSpecIds` 제거(유일 소비처였던 preorder 소멸 — 유령 판정은 LEFT JOIN 이 대신한다).
- **웹**: `PcbTodoQueue.vue` 신설(요청 대기·발주 대기 공용 큐 — 인라인 [견적요청 →]·[발주하기 →]) · `AdminPcbRfqs`/`AdminPcbPos`/`AdminPcbShipments` 첫 탭에 대기 큐 편입 · `AdminPcbCases.vue` 재작성(구간 탭 + **12단계 칩**·이관 배지, 기본 탭=발주·생산 — 완료 2만 건이 모수를 덮지 않게) · 배지 3종 합산 재정의(pcbRfqPending=요청 대기+선정 대기, **pcbPosPending**=발주 대기+EQ 승인 대기, pcbShipmentPending=발송 대기+관리자 차례) · **AdminLayout `CASE_FROM_MENU` 를 라우트별 2단 사전으로 교정**(SmartBOM 전용이라 PCB Case 는 어디서 들어와도 진행현황이 켜지던 결함 — 워크큐는 이미 `?from=` 을 넘기고 있었다) · `AdminPcbCase.vue` 에 §6.12 방식 **섹션 접힘**(rfqs→발주 접힘 / orders·pos·shipments→RFQ 접힘, 제작 사양은 발주·선적 때 확인이 잦아 접지 않음).
- **검증**: **E2E 47 ALL PASS**(실DB — 구간 counts {136,0,195,20607}·합=전체 20938 대조, todo {6,5} 대조 + **이관 포함 시 {330,195}** 로 제외 효과 확인, 대기 큐 행 불변식 4종(이관 0·RFQ 0건·발주 0건·결제 완료·완료/취소 아님), 단계 파생 6종, 마지막 페이지(1031p) 정합, 견적번호·주문번호 검색, to_ship counts·행 불변식, preorder 400 회수 확인). vitest 644+109·`pnpm -r typecheck`·ESLint 0건. 브라우저 실탐방으로 4화면·Case 진입(활성 메뉴·접힘) 확인.
- **흐름 실검(08-06)**: Q20984(주문 2026080522133120·입금)로 발주 대기 → **발주서 발행**(선정 RFQ 승계 ₩50,000·납기) → EQ/Working 대행 업로드 → EQ 요청·승인 → 생산 시작·완료 → **발송 대기 자동 편입** → 국내 발송(택배·송장) → 입고확인까지 완주. 게이트 정상(파일 없이 EQ 요청 409, 순서 건너뛴 승인·생산 409), 이력 4건 전부 `byRole ADMIN`, 배지가 역할 간에 넘어감(발주·EQ 5→4 · 선적·배송 0→1→0), 진행현황 단계 7→8→10→11.
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
Esc 로 닫히는지, 입력이 서버까지 가 `eqHistory` 에 남는지까지 확인한다(3케이스).
남은 prompt 는 BOM 패널의 클립보드 복사 실패 폴백 1곳뿐이고, 그건 입력이 아니라 표시 용도다.

## 10. 조사 자료 색인

- 레거시 백엔드 근거: `samplepcb_xpse/src/main/java/kr/co/samplepcb/xpse/` — resource 7종(SpPcbPartnerOrder/Doc/AsCase/ShipmentGroup/Shipment/ShipmentInvoice/PcbMyTurn) · service 동명 + ExchangeRate 3종 · `resources/db/migration/*.sql` 12종(수동 적용, DDL 헤더 주석이 설계 정본).
- 레거시 프론트 근거: `sp-smartbom-web/src/` — views/Pcb*.vue 11종, `types/pcbEqWorkflow.ts`(EQ 전이표), `views/Shipment.types.ts`(선적 전이·필드·택배사), `services/{shipmentService,asCaseService}.ts`, `utils/currency.ts`, `components/pcb/*`·`components/shipment/*`.
- 레거시 문서: `sp-smartbom-web/doc/` — pcb-as-reorder(06-24)·pcb-delivery-date(06-23)·pcb-destination-shipping(06-22)·master-dealer-pcb-estimate(06-18)·shipment-group·invoice-generator(06-20). + **docs/legacy-smartbom/**(회수본 3종).
- 플랫폼 근거: `apps/api/src/routes/admin-pcb-projects.ts`(확정가 409 가드), `apps/api/src/lib/g5-db.ts`(주문 체인·force-status), `apps/api/prisma/schema.prisma`(48모델), BOM 트랙 lib/routes 일습, `apps/web/src/admin/menu.ts`(모듈 스위처), docs/GERBER_ORDER_FLOW.md·GERBER_PRICE_MODE.md·SMARTBOM_PARTNER_RFQ.md.
- DB 실측: 플랫폼 `samplepcb`(sp_pcb_* 없음·앵커 상품 6종·spec/quote 20,537) vs `samplepcb_legacy_full`(PCB 상품 38,766·워크플로 데이터 소량) — DDL 덤프 `docs/legacy-smartbom/legacy-pcb-ddl.sql`.
