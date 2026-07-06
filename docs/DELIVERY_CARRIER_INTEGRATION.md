# 택배(CJ대한통운) 연동 조사 노트

- **상태**: 조사 완료 · **미결정(보류)** — 구현 착수 전 결정 사항 대기
- **조사일**: 2026-07-06
- **목적**: CJ택배 사용을 전제로, 관리자 배송처리 UX를 자동화할 수 있는 API/서비스 옵션을 기록. 나중에 재검토·의사결정용.

> ⚠️ 이 문서는 **조사 결과만** 담는다. 아직 어떤 솔루션도 채택하지 않았고 코드도 붙이지 않았다.

---

## 1. 배경 — 현재 배송처리 방식

지금은 관리자가 운송장 정보를 **수동으로** 다룬다.

- **드로어 단건 처리**: `samplepcb-web-mono-app/apps/web/src/components/admin/OrderDetailDrawer.vue`
  - `생산완료` 주문의 [배송 처리] 시 `배송회사·운송장번호·배송일시` 3필드를 손으로 입력.
- **엑셀 일괄 처리**: `samplepcb-web-mono-app/apps/api/src/lib/delivery-excel.ts`
  - `od_status='생산완료' AND od_misu=0` 주문을 엑셀로 내려받아 운송장 채워 업로드 → 일괄 배송처리.
- **서버 전이**: `samplepcb-web-mono-app/apps/api/src/lib/g5-db.ts` `setOrdersDelivery()`
  - 운송장 3필드 UPDATE(`WHERE od_status='생산완료'`) + 카트 재고차감 + `changeStatus('생산완료' → '배송')` + 미수금 재계산.
- **운송장 계약**: `packages/api-contract/src/schemas/orders.ts` `AdminOrderDeliveryRow`
  - `odId · deliveryCompany · invoiceNo · invoiceTime`(KST native 문자열).

**개선 목표**: 위 수동 입력/엑셀 왕복을 택배사 API로 자동화 — 운송장번호 자동 채번 + 라벨 출력 + 배송추적 + 자동 완료처리.

---

## 2. 니즈는 두 갈래로 나뉜다

| 니즈 | 하는 일 | 대표 솔루션 | 우리 코드 접점 |
|---|---|---|---|
| **① 송장 발급·출력** | 물건 부칠 때 CJ 운송장번호 **자동 채번** + 라벨 출력 | 굿스플로 / CJ 직접연동 | `setOrdersDelivery`의 3필드를 API가 채움 |
| **② 배송 추적·자동완료** | 고객 배송조회 + `배송→완료` 자동 전이 | 스마트택배 / 딜리버리트래커 | `배송→완료`(`setOrdersComplete`) 자동화 |

---

## 3. ① 송장 발급·출력

### 굿스플로 (GoodsFLOW) — 국내 이커머스 사실상 표준
- 네이버 스마트스토어·쿠팡 등이 채택. **셀러 Open API** 제공(`goodsflow.io`, 테스트 `test-api.goodsflow.io`).
- **흐름**: 관리자가 `[송장출력]` 클릭 → CJ로 송장 이관 + **운송장번호가 즉시 콜백으로 쇼핑몰에 자동 등록** → 주문상태 자동 '배송중'. 감열 프린터로 라벨 동시 출력.
- 지원 택배사: **CJ대한통운** + 우체국·한진·롯데·로젠·일양.
- **전제**: CJ 택배 계약(계약코드) 필수 · 라벨(감열) 프린터 필요.
- **비용**: 자동송장출력 베타 무료 안내, 향후 유료 전환 가능(건당 과금 관례) → 견적 문의 필요.
- **평가**: 우리의 3필드 수동입력·엑셀 왕복을 **버튼 하나로 대체**하는 가장 직접적인 상위호환. 소량 쇼핑몰에 현실적.

### CJ 직접연동 (CNPLUS / 오네 계약)
- CJ 계약 후 **주관고객번호(8자리)** 로 연동. 송장번호 발급 시 자동 매칭, 예약정보 자동 전송.
- **공개 셀프서비스 API 문서가 빈약** — 카페24·고도몰·NHN 등도 솔루션 레벨로 감싼다. 직접연동은 개발 공수 큼(위시켓 외주 프로젝트 다수가 방증).
- **평가**: 소량 쇼핑몰엔 과함. 굿스플로 경유 권장. 대량이면 재검토.

---

## 4. ② 배송 추적·자동완료

### 스마트택배 (스윗트래커)
- 네이버·카카오 배송조회가 쓰는 서비스. 조회 API(실시간) + 추적 API(주기적 **콜백/웹훅**).
- 파라미터: `t_key`(API키) · `t_code`(택배사코드) · `t_invoice`(송장번호). 전 택배사(CJ 포함) 지원.
- **그누보드/영카트용 '배송 자동완료 플러그인'이 이 추적 API 기반으로 이미 존재** → `배송→완료` 자동 전이를 바로 붙일 수 있음.
- 무료 테스트 서버, 실서비스 유료.

### 딜리버리트래커 (tracker.delivery) — 개발자 친화적
- **V2 GraphQL**, Tracking API + **Webhook API**, CJ Logistics 지원, 셀프호스팅/클라우드 선택.
- 웹훅: 운송장 변화 감지 시 콜백, 캐시로 저지연, `expirationTime`(48h) 권장·24h 주기 갱신.
- **평가**: 우리 **Node/TS 스택에 가장 잘 맞음**. 가격은 콘솔에서 확인 필요.

---

## 5. 이 프로젝트 통합 시나리오 (제안, 미확정)

1. **1단계 — 관리자 UX**: 굿스플로 셀러 API 연동. 배송처리 화면에 `[송장출력]` 버튼 →
   콜백으로 `setOrdersDelivery`의 `deliveryCompany·invoiceNo·invoiceTime` 자동 채움 + `배송` 전이.
   → **현재 수동 3필드/엑셀 왕복 제거.**
2. **2단계 — 고객·자동화**: 딜리버리트래커(또는 스마트택배) 웹훅 →
   고객 주문내역 실시간 배송추적 표시 + `배송→완료` 자동 전이(`setOrdersComplete`).

---

## 6. 결정 대기 (Open Questions) — 재검토 시 먼저 확정할 것

- [ ] **CJ와 이미 계약(주관고객번호)이 있는가?** — 굿스플로·직접연동 모두 계약이 전제.
- [ ] **감열 라벨 프린터 도입 의향?** — 있으면 굿스플로 완결형, 없으면 번호 채번만.
- [ ] **월 배송 물량 규모?** — 소량이면 굿스플로 건당수수료가 경제적, 대량이면 직접연동 검토.
- [ ] 굿스플로 셀러 API 실제 엔드포인트·인증·콜백 스펙 심층 조사(PoC) 필요 여부.

---

## 7. 출처

**CJ대한통운**
- 택배연동 (NHN커머스): https://www.nhn-commerce.com/echost/power/add/design/cjlogistics-intro.gd
- 택배연동 방법 (플토): https://www.plto.com/customer/HelpDesc/gmp/13787/
- 오네계약 문의: https://www.cjlogistics.com/ko/support/inquiry/agreement

**굿스플로**
- 송장출력: https://www.goodsflow.com/invoice
- 셀러스: https://goodsflow.io/
- 셀러 Open API(테스트): https://test-api.goodsflow.io/

**배송추적**
- 스마트택배 API: https://tracking.sweettracker.co.kr/ · API Doc: https://info.sweettracker.co.kr/apidoc
- 배송 자동완료 플러그인(sir.kr): https://sir.kr/cmall/1718343140
- Delivery Tracker — Tracking API: https://tracker.delivery/en/docs/tracking-api · Webhook API: https://tracker.delivery/en/docs/tracking-webhook-api

**참고**
- 영카트5 엑셀배송처리 매뉴얼: https://sir.kr/manual/yc5/115

---

## 재검토 메모

- 트리거: CJ 계약 상태 확정 시 / 배송 물량이 수동처리 한계를 넘을 때.
- 연관 문서: [GERBER_ORDER_FLOW.md](GERBER_ORDER_FLOW.md)(주문 상태 흐름), [order-notify-gating.md](order-notify-gating.md)(알림 게이트).
- 현재 배송 전이 코드: `g5-db.ts` `setOrdersDelivery` / `setOrdersComplete`, `delivery-excel.ts`.
