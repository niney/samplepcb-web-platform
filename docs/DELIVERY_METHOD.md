# 배송방법 (택배 / 퀵서비스 / 방문수령 / 직배송) — 정본

작성 2026-08-17. 고객 주문(g5_shop_order)의 **배송방법 축** 도입 기록 — 설계 결정·P1 구현·운영 반영 절차·P2/P3 로드맵.

## 1. 배경 — 왜 필요한가

- **영카트 코어에는 배송방법 개념이 없다.** g5_shop_order 의 배송 필드는 `od_delivery_company`(자유 텍스트)·`od_invoice`·`od_invoice_time`·`od_send_cost(+2)`·`od_hope_date` 가 전부다(그누보드 5.6.31, 업스트림 `gnuboard/master` 대조 완료). 코어가 제공하는 인접 기능은 ① 배송비 지불방식 착불(`it_sc_method`→`ct_send_cost`, 상품 상세에서 고객 선택 — 배송 *수단*이 아니라 배송비 *지불* 방식) ② 희망배송일(`de_hope_date_use`, 현재 미사용) 뿐.
- **운영 실무는 수년째 퀵·방문수령·직배송을 해 왔다.** 이관 데이터 실측: 퀵 계열 284건 · 방문/내방 계열 163건 · 직배송 계열 140건, 2026-07 까지 진행형. 전부 순정 관리자의 배송회사 **자유 텍스트 칸에 수기**(레거시 소스에 관련 기능·문자열 0건)이고 **송장번호는 공란**(1건 예외).
- **새 sp-vue 콘솔은 이 관행을 정식 지원하지 못했다.** 정상 배송 전이가 회사·송장·일시 3필드 필수(`MISSING_INVOICE`)라, 퀵·방문수령은 가드 없는 force-status 로 우회해야 했다.
- **비용 문제 실재**: 방문수령 주문 97건 중 26건이 차등 배송비를 그대로 결제(방법을 주문 시점에 못 받는 구조적 결과 — P2 에서 해소).

결정 과정: 세션 조사 → 동급(Fable) 독립 검토(`REVIEW_REQUEST/RESULT_delivery-method.md`, 미커밋 로컬 문서) → 사용자 승인 "권장으로 진행"(직배송 포함).

## 2. 설계 결정

### 2.1 저장 = 신설 컬럼 + 한글 라벨 병용 (B안)

```sql
ALTER TABLE g5_shop_order
  ADD COLUMN od_delivery_method varchar(20) NOT NULL DEFAULT '' AFTER od_delivery_company;
```

- **DB ENUM 금지**, varchar 코드값. `''` = 미지정(구주문·P2 전 주문서) = **택배로 간주**.
- 값: `parcel`(택배) · `quick_cod`(퀵 착불) · `pickup`(방문수령) · `direct`(직배송) · `quick_prepaid`(**예약** — 거리별 요금이라 금액 확정 불가, 선택지 미노출).
- **`od_delivery_company` 는 폐기하지 않고 병용**: 택배 = 입력한 택배사명, 비택배 = 서버가 표준 한글 라벨 강제 기록 — `퀵배송(착불)` / `방문수령` / `직배송`. 이 병용 덕에 영카트 /adm 주문상세·배송 안내 메일의 `{택배회사}` 치환(spcb/api/order-notify.php)·고객 주문조회 화면이 **0줄 수정으로 호환**된다.
- 비택배는 `od_invoice = ''` 강제(송장이 존재하지 않는 방법 — 운영 관행 미러). `od_invoice_time` 은 모든 방법에서 필수(배송/수령 시각).
- 근거: 코어 스스로 g5_shop_order 에 런타임 ALTER 를 하는 전례(`od_other_pay_type`, shop/orderformupdate.php:44-51). 여정 33호(과입금)에서 "코어 필드 공유" 노선을 택한 전례와 동일한 결.

### 2.2 어휘의 단일 원천 = api-contract

`packages/api-contract/src/schemas/orders.ts`:
- `DeliveryMethod`(zod enum) · `SELECTABLE_DELIVERY_METHODS`(선택지 4종, 예약값 제외) · `isParcelDeliveryMethod('' | 'parcel' → true)` · `DELIVERY_METHOD_COMPANY_LABEL` + `deliveryCompanyForMethod`(병용 기록 규칙).
- `AdminOrderDeliveryRow`/`AdminOrderDeliveryFields`(force-status 용) — **method 기본 `parcel`(하위호환)**, refine: 택배만 회사·송장 필수, 비택배는 일시만.
- 읽기 계약 `AdminOrderCore.deliveryMethod`(string 패스스루).

### 2.3 가드 — 데이터 품질이 새지 않게

- 택배(`''`/`parcel`)는 **기존 3필드 필수 그대로**(계약 refine + `matchDeliveryRows` 서버 이중 방어). "방법만 바꿔 송장 생략" 꼼수는 비택배 라벨이 배송정보에 그대로 남아 화면에 드러난다.
- 정상 전이는 `setOrdersDelivery` 단일 경로 재사용(원자 가드 `od_status='생산완료'`·재고차감 멱등 anchor 복제 없음). force-status 의 delivery 반영도 같은 병용 규칙.
- 배송 엑셀은 **택배 전용**: 다운로드 WHERE 에 `od_delivery_method IN ('', 'parcel')` 1줄, **열 추가 금지**(업로드 파서가 A/I/J 인덱스 고정 — delivery-excel.ts). 업로드 경로는 `method='parcel'` 고정.

## 3. P1 구현 내역 (2026-08-17)

| 영역 | 파일 | 내용 |
|---|---|---|
| DB | (DDL §2.1) | 로컬 적용 완료. **운영 반영 절차 §4** |
| 계약 | packages/api-contract/src/schemas/orders.ts | §2.2 전부 |
| 서버 | apps/api/src/lib/g5-db.ts | 목록/상세 SELECT+매핑에 `od_delivery_method` · `DeliveryInput.method` · `matchDeliveryRows` 방법별 필수 · `setOrdersDelivery` 병용 기록 · `ForceStatusDelivery.method`+force-status 반영 · 엑셀 WHERE |
| 서버 | apps/api/src/routes/admin-orders.ts | DTO `deliveryMethod` · 엑셀 업로드 `method:'parcel'` · stale 주석('준비'→'생산완료') 교정 |
| 서버 | apps/api/src/lib/delivery-excel.ts | 헤더 주석 stale 교정(열 구조 무변경) |
| FE | apps/web/src/admin/useAdminOrders.ts | `DeliveryInput.method` · 어휘 재노출 · `deliveryMethodSlug` · `isDeliveryInputComplete` |
| FE | AdminOrders.vue / OrdersTable.vue / OrderActionBar.vue / OrderDetailDrawer.vue | 생산완료 탭 인라인·드로어 처리 폼·고급(force) 폼에 방법 셀렉트(비택배는 회사·송장 입력 접힘), 읽기 화면 방법 라벨, 수집·검증 방법별 분기 |
| FE(PCB/BOM) | PcbCustomerShipModal.vue / AdminSmartbomLogistics.vue | 배송 모달에 방법 셀렉트+검증 분기 — **force-status 우회 제거 완성** |
| i18n | ko.ts / en.ts | `admin.orders.deliveryMethod.*` · 안내/에러 문구 방법 인지화 · 엑셀 힌트 stale 교정 |
| 테스트 | apps/api/src/lib/delivery-method.test.ts (신규) · g5-db.test.ts | 계약 refine·라벨 병용·`matchDeliveryRows` 방법 분기 |
| 가드 | ops/scripts/check-core-patches.sh | (이번 작업과 별개 발견) 기존 미등록이던 주문서 코어 수정 4건 등록 — orderform pc 폼 통일 · orderform.sub sp 커스텀 · orderformupdate seam(pc/mobile) |

**P1 에서 안 한 것(의도)**: 주문서(고객) 수집 — P2. 상태 라벨('배송완료'→'수령완료') — P3. PHP 쪽은 0줄(병용 설계 덕).

## 4. 운영 반영 절차 (스키마는 sync 가 나르지 않는다)

`migrate:sync` 는 데이터 diff 전용이므로 §2.1 DDL 을 **운영 DB에 수동 실행**해야 한다(가산적·즉시 완료, 다운타임 없음). 실행 전 `SET SESSION sql_mode='';` 필요(기존 zero-date 기본값 재검증에 걸린다). 미적용 상태에서 새 코드가 배포되면 목록/상세 SELECT 가 `Unknown column` 으로 실패하므로 **DDL 먼저, 배포 나중**. sync 도구는 교집합 복사(buildCopyPlan)라 신규 컬럼을 비교·복사하지 않는다 — 추가 조치 불요.

## 5. 로드맵

- **P2 — 주문서 수집**: orderform.sub.php 방법 선택 UI + 방법별 배송비 0 규칙(방문수령·퀵착불). ⚠ 명세 확정 사항: ① 배송비 0 처리는 `get_sendcost()` 직후·배송쿠폰 블록 **앞**(orderformupdate.php:231→234 — 쿠폰 게이트 `$send_cost>0`+캡 덕에 이중 차감 불가) ② **`od_send_cost2`(도서산간, zip 자동 계산+별도 die :274-288) 도 서버·JS(calculate_sendcost :1380) 양쪽 동시 0 처리** — 안 하면 방문수령+도서산간 zip 주문이 죽는다 ③ 방법 전환 JS 는 배송쿠폰 리셋(:1120-1127 패턴) ④ 저장은 INSERT 직후 seam 1줄+가드 등록 ⑤ KCP 테스트 결제로 금액 정합 확인. 이때 방법의 출처(고객 선택 vs 관리자 처리 시 변경)는 컬럼=현재값 + `od_mod_history` append 로 기록.
- **P3 — 다듬기**: 고객 주문상세 수령 안내(방문수령 주소·시간 — 현재 배송정보 블록은 od_invoice 게이트라 비택배가 빈 상태), 방법별 상태 라벨('수령완료' — sp_order_status.extend.php+i18n 양쪽에 방법 파라미터), 알림 문구 방법별, 퀵 선불(quick_prepaid) 활성 여부 재검토.
