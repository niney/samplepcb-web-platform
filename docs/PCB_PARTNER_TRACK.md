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
| 웹 | 모듈 스위처(adminModules)+워크큐+배지 시스템+Case `?from=` 접힘, **진짜 공유 컴포넌트 5종**(RfqReplyForm·BomEstimateSheet·InvoiceEditorModal·ShipmentPackingModal·TradeDocumentModal — 관리자/파트너/매직링크 3자 공용), UiPagination | 참조 아키텍처=2세대 smartbom 모듈 |
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

**D13 (2026-08-06) — 견적 영구 삭제의 협력 트랙 차단 + 감사 원장 공용화.** BOM Case 삭제(§bom-case-delete)를 복제하지 않고 PCB 실정에 맞게 이식한다. ① **차단 확장** — 기존 `PAID_ORDER` 에 `PO_ISSUED`·`SHIPMENT_EXISTS`·`SHARED_ORDER` 추가. **우회(강제) 체크는 `PAID_ORDER` 하나뿐** — 결제는 우리 DB 안의 문제지만 발주·선적은 협력사와 합의된 기록이라 관리자 체크 하나로 넘길 수 없고, Case 상세에서 발주 취소·선적 정리를 먼저 해야 한다(사용자 결정). ② **경고 4종**(`RFQ_EMAILS_REMAIN`·`PCB_ATTACHMENTS_DELETED`·`UNPAID_ORDER_DELETED`·`LEGACY_CASE`) + 사유 필수 + 최종확인 체크. PCB 는 모수가 2만 건이라 BOM 의 단건 2단계 모달이 아니라 **배치 프리뷰를 강화**하는 형태다. ③ **감사 원장 공용화** — `sp_bom_case_delete_audit` → **`sp_delete_audit`**(트랙 접두사 없음 = 횡단 관례) + `quoteId` → `subjectType`+`subjectId` 중립화. 범위는 테이블 이름이 아니라 `subjectType` 이 말한다(이름만 공용이고 `quoteId` 에 묶인 `sp_mail_log` 가 반면교사).

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
- **서버**: 신설 `lib/pcb-case-delete.ts` — `loadPcbTrackFacts`(배치 집계, N+1 회피)·`judgePcbCaseDelete`
  ·`remainingBlockers`. **프리뷰와 실행이 같은 함수로 판정**한다(둘이 갈라지지 않게 + 프리뷰를
  거치지 않은 직접 호출도 막게). 실행은 건별로 `sp_delete_audit`(subjectType='pcb_case') 에
  스냅샷·사유·행위자·IP 를 남긴 뒤 삭제한다(로그 warn 대체). `purgeQuoteData` 는 PCB 첨부
  (`sp_pcb_po_eq`·`sp_pcb_shipment`)를 실파일→DB 순서로 함께 정리 — 차단 덕에 API 경로로는
  도달하지 않는 **방어선**이라 단위테스트로 검증한다. 고객 라우트에 `PARTNER_TRACK_ACTIVE` 409.
- **웹**: `DeleteQuoteModal` 에 차단 사유별 안내·경고 레이어·협력 집계 배지(`협력 R/P/S`)·이관
  배지·**사유 입력·최종확인 체크**·결제 강제 해제 체크(있을 때만). 강제 체크를 켜면 "결제만
  걸린 건"이 삭제 대상으로 옮겨오는 계산까지 서버 규칙과 동일하게 미러.
- **검증**: **E2E 31 ALL PASS**(실DB 시드 3건 — 차단 판정·협력 집계·경고·바디 검증 400·강제
  체크로 발주 차단 우회 불가·감사행 기록·**고객 경로 409**·선적 FK cascade·차단 해제 후 삭제),
  단위 4(`quote-delete.test.ts` — 첨부 수집 순서·트랜잭션 포함·불필요 쿼리 없음·파일서버 실패 시
  DB 무변경). vitest 648+117 · typecheck · ESLint 0건.
- **후속**: 선적 문서 자체를 지우는 경로는 아직 없다(SHIPMENT_EXISTS 를 풀려면 필요) — A/S
  회차(P4)와 함께 설계. BOM 삭제도 같은 감사 테이블을 쓰지만 차단·경고 세트는 트랙별로 다르다.

## 10. 조사 자료 색인

- 레거시 백엔드 근거: `samplepcb_xpse/src/main/java/kr/co/samplepcb/xpse/` — resource 7종(SpPcbPartnerOrder/Doc/AsCase/ShipmentGroup/Shipment/ShipmentInvoice/PcbMyTurn) · service 동명 + ExchangeRate 3종 · `resources/db/migration/*.sql` 12종(수동 적용, DDL 헤더 주석이 설계 정본).
- 레거시 프론트 근거: `sp-smartbom-web/src/` — views/Pcb*.vue 11종, `types/pcbEqWorkflow.ts`(EQ 전이표), `views/Shipment.types.ts`(선적 전이·필드·택배사), `services/{shipmentService,asCaseService}.ts`, `utils/currency.ts`, `components/pcb/*`·`components/shipment/*`.
- 레거시 문서: `sp-smartbom-web/doc/` — pcb-as-reorder(06-24)·pcb-delivery-date(06-23)·pcb-destination-shipping(06-22)·master-dealer-pcb-estimate(06-18)·shipment-group·invoice-generator(06-20). + **docs/legacy-smartbom/**(회수본 3종).
- 플랫폼 근거: `apps/api/src/routes/admin-pcb-projects.ts`(확정가 409 가드), `apps/api/src/lib/g5-db.ts`(주문 체인·force-status), `apps/api/prisma/schema.prisma`(48모델), BOM 트랙 lib/routes 일습, `apps/web/src/admin/menu.ts`(모듈 스위처), docs/GERBER_ORDER_FLOW.md·GERBER_PRICE_MODE.md·SMARTBOM_PARTNER_RFQ.md.
- DB 실측: 플랫폼 `samplepcb`(sp_pcb_* 없음·앵커 상품 6종·spec/quote 20,537) vs `samplepcb_legacy_full`(PCB 상품 38,766·워크플로 데이터 소량) — DDL 덤프 `docs/legacy-smartbom/legacy-pcb-ddl.sql`.
