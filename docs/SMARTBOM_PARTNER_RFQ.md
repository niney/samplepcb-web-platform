# 스마트 BOM — 파트너 모델 · 협력사 RFQ · 관리자 모듈 (정본)

작성 2026-07-29. 레거시 SmartBOM(sp-smartbom-web + samplepcb_xpse)의 BOM 트랙 프로세스를
본 플랫폼으로 마이그레이션하기 위한 설계 정본. **레거시 설계를 따르지 않는다 — 돌아가는
프로세스가 정본이고, 구조는 이 프로젝트의 기존 척추와 관례로 재구성한다.**

- 선행 정본: [BOM_QUOTE.md](./BOM_QUOTE.md) (고객 스마트 BOM 견적 — 본 문서는 그 후속 단계)
- 레거시 분석: `D:\work\workspace_other\sp-smartbom-web\sp-smartbom-web-wiki\` · `D:\work\workspace_other\samplepcb_xpse\xpse-wiki\` · 각 `doc/`
- 화면 시안: `.tmp/Sample PCB 관리자 화면 260729.html` (통합 관리자 프로토타입 — §8 채택/조정 기록)

---

## 0. 결정 기록 (2026-07-29 확정)

| # | 결정 | 내용 |
|---|------|------|
| D1 | 문서 척추 | **`sp_bom_quote` 단일 척추.** 별도 "견적서" 엔티티 복제 없음 — 협력사 RFQ·선정·주문 연결을 전부 기존 quote에 얹는다. 레거시의 이중 기록자(qty 의미 분화) 함정 원천 차단 |
| D2 | 수량 의미 | 기존 `bomQty`(1세트당) + `orderQty`(주문수량) 분리가 이미 있으므로 **추가 작업 없음**. orderQty가 정본 |
| D3 | 1차 범위 | **견적 성립까지**: 관리자 검토 → 협력사 RFQ → 비교·선정 → 고객 회신(answered). 2차=주문·결제·발주, 3차=물류 |
| D4 | 파트너 모델 | **`sp_partner` 조직 단일 테이블**(type: partner\|supplier\|house) + `sp_partner_member` 계정 연결(스키마 1:N, 1차 구현은 owner 1계정) + `sp_partner_relation`(마스터딜러 — **스키마만 선반영, 구현 후속**) |
| D5 | partnerAuth | 레거시 등급(A/B/C/부품판매)은 **capabilities**(bom_rfq·pcb_rfq·part_sale)로 재해석 |
| D6 | 공급사 참여 | **RFQ 행으로 물질화하지 않는다.** 공급사 시세는 기존 후보(SpBomQuoteCandidate)·오퍼 원장(SpPartOffer)에서 파생 표시. 갱신은 stale-while-revalidate 백그라운드 잡(sp-engine). `source='manual'` 행은 자동 동기화가 건드리지 않음 |
| D7 | 통화 | 1차 **KRW 단일**. RFQ 스키마에 currency 컬럼만 선반영(외화 회신은 후속) |
| D8 | 정보 노출 | 협력사에게 **목표단가(현재 선정 오퍼가) 미노출** — 부품행(MPN·제조사·수량)만 |
| D9 | 고객 회신가 | 기존 `confirmed*` **관리자 수동 확정 유지** + 행별 선정가 합계 참고 표시. 마진 자동 계산은 후속 |
| D10 | 상태 모델 | 한글 리터럴 금지 — **`@sp/api-contract` 코드 사전**. g5 미러(it_24류) 없음. `quote.status`는 굵은 단계 유지, RFQ는 자체 status 계층(레거시 '상태 3종 혼동' 해소) |
| D11 | 알림·회신 | 1차 **메일 알림만**(order-notify 브리지·로컬 Mailpit), 회신은 로그인 포털. **관리자 대리 입력 유지**. 매직링크 무로그인 회신은 후속 |
| D12 | 견적서 발행 | **브라우저 인쇄만**(`@media print`) — PDF 파일 생성 없음 |
| D13 | 물류 방향 | 3차 구현 시 **선적 그룹 모델**(레거시 PCB 최종형)로 — 지금은 방향 선언만, 2차 스키마에 선적 참조 금지 |
| D14 | 주문·결제(2차) | 레거시(it_price 전파+영카트) 추종 아님 — **이 프로젝트에 맞게 재구성, BOM 현업 구매 방식 기준**. 거버 주문 패턴(주문 스펙 스냅샷+g5 결제 브리지) 실측 후 2차 진입 전 확정 |
| D15 | 관리자 IA | **모듈 스위처 1차 도입.** 명칭 기반 = **smartbom**. 기존 메뉴는 무수정('통합 관리' 모듈로 래핑) |
| D16 | 주문·결제(2차 확정) | 확정가(confirmedTotal) 있는 answered 견적만, 견적은 통째 1카트행(품목 부분 주문 없음), 카트 금액 = 확정가×1.1(부가세 포함 총액 — 거버 방식). 상세 §6 |
| D17 | 배치 주문·통합 목록(2026-07-30) | **여러 BOM 견적을 한 주문으로 배치 가능**(각 견적은 여전히 통째 — D16-3 유지, 거버와 동일 패턴). 단 **같은 트랙끼리만** — PCB+BOM 혼합 결제 금지(이행·정산 분리). 견적관리는 탭 대신 **단일 통합 목록**(유형 배지+필터) |

---

## 1. 파트너(조직) 모델 — 계정·조직·자동화 3축 분리

레거시 문제: 협력사=g5_member 여분컬럼(mb_1/2/13/14 + 통화/국가), 공급사=가짜 회원 행
(6035/6036/6045/6253 하드코딩). 조직·계정·자동화가 한 덩어리라 공급사 추가=코드 배포,
1계정=1회사 강제, 하이브리드(사람+API) 불가.

신규: **로그인 능력과 자동화 능력을 독립 축으로.**

| 능력 | 판정 근거 | 부여 |
|------|-----------|------|
| 로그인·수동 회신 | `sp_partner_member` 연결 계정 존재 | 정상 가입한 g5_member 계정을 조직에 연결 1행 — 가짜 회원 없음 |
| API 자동화(시세·발주) | `supplierCode` 존재 | 코드값 + env 자격증명 — 공급사 추가=데이터 1행 |

조합: 일반 협력사(계정만) / 순수 공급사(코드만 — 현 Digikey) / **하이브리드**(둘 다 — 예:
UniKeyIC 한국 담당자 로그인) / 자사 house(자체 카탈로그 `offer_kind` 연동).

### 1.1 스키마 (prisma 스케치 — 기존 sp_* 관례: String status + 앱단 유니온, mbId FK 금지)

```prisma
// 협력사·공급사·자사의 조직 정본 — 견적/발주/물류 전 프로세스가 partnerId 하나만 참조.
model SpPartner {
  id              BigInt   @id @default(autoincrement())
  type            String   @db.VarChar(12)        // partner|supplier|house
  name            String   @db.VarChar(191)       // 회사명
  supplierCode    String?  @unique @db.VarChar(32) // supplier·house만 — SpPartOffer.supplier와 동일 사전
  country         String?  @db.VarChar(2)         // ISO alpha-2
  defaultCurrency String   @default("KRW") @db.VarChar(8)
  capabilities    Json     // ["bom_rfq","pcb_rfq","part_sale"] — partnerAuth 재해석(D5)
  status          String   @default("pending") @db.VarChar(20) // pending|approved|suspended (마켓 어휘)
  contactName     String?  @db.VarChar(100)
  contactPhone    String?  @db.VarChar(50)
  contactEmail    String?  @db.VarChar(255)       // RFQ 알림 수신처
  memo            String?  @db.Text
  legacyJson      Json?    // 이관 원본 보존(SpMemberProfile 관례)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([type, status])
  @@map("sp_partner")
}

// 계정 연결 — 로그인 가능 주체. 공급사는 연결 0명이 자연 표현. 1차 운영은 owner 1행.
model SpPartnerMember {
  id        BigInt   @id @default(autoincrement())
  partnerId BigInt
  mbId      String   @db.VarChar(191) // 공유 DB 조인 키 — FK 금지 관례
  role      String   @default("owner") @db.VarChar(12) // owner|staff
  createdAt DateTime @default(now())
  @@unique([partnerId, mbId])
  @@index([mbId])
  @@map("sp_partner_member")
}

// 마스터딜러 2단 중개 — 스키마만 선반영(D4), 구현 후속. 레거시 parent 0-센티넬 척추 승계 예정.
model SpPartnerRelation {
  id                 BigInt  @id @default(autoincrement())
  parentPartnerId    BigInt
  childPartnerId     BigInt
  settlementCurrency String? @db.VarChar(8) // 링크별 결제통화(레거시 최종형)
  createdAt DateTime @default(now())
  @@unique([parentPartnerId, childPartnerId])
  @@map("sp_partner_relation")
}
```

### 1.2 코드 사전·인증

- `supplierCode` 사전은 **`@sp/api-contract` 단일 정본**(예: `PARTNER_SUPPLIER_CODES`) —
  `SpPartOffer.supplier`와 같은 문자열 어휘. 오퍼↔견적 도메인 이중 식별 금지.
- 인증: `requirePartner` — mbId → `SpPartnerMember` → `status='approved'` **서버 매 요청 판정**
  (JWT에 조직 클레임 없음 — server-single-truth 관례. 연결 변경 시 토큰 재발급 불필요).
- 관리자는 기존 `requireAdmin` 그대로.

### 1.3 마이그레이션·시드

1. `SpMemberProfile.partnerAuth > 0` 회원 → `SpPartner(type='partner')` 생성 +
   `SpPartnerMember(owner)` 연결. companyName/partnerKind/legacyJson 승계, capabilities는
   partnerAuth 재해석 매핑.
2. 공급사·자사 시드 4행: `digikey`·`unikeyic`·`mouser`(type=supplier) + `samplepcb`(type=house).
   1차 RFQ엔 등장하지 않지만 2차 발주 라우팅·설정의 정본 자리(레거시 하드코딩 mbNo의 대체).

---

## 2. RFQ 레이어 (1차 슬라이스)

### 2.1 스키마

레거시 PED/PEI 2계층(문서=조직당 1건 + 부품행)은 비교·선정 FK가 검증된 형태라 유지하되,
참조·상태·source를 개선한다.

```prisma
// 협력사 견적요청 문서 — (quote × 조직 × 트랙) 1건. diff 발송으로 갱신.
model SpBomRfq {
  id              BigInt    @id @default(autoincrement())
  quoteId         BigInt    // → SpBomQuote (단일 척추 D1)
  partnerId       BigInt    // → SpPartner (mb_no 참조 금지)
  parentPartnerId BigInt    @default(0) // 0=관리자 직접(센티넬) — MD 후속 대비 자리만(D4)
  status          String    @db.VarChar(16) // BOM_RFQ_STATUS: requested|quoted|closed
  totalAmount     Int?      // 회신 합계(KRW) — 회신 저장 시 박제
  currency        String    @default("KRW") @db.VarChar(8) // D7 — 1차 KRW 단일
  deliveryDate    DateTime? // 협력사 회신 납기
  memo            String?   @db.Text
  requestedAt     DateTime  @default(now())
  respondedAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@unique([quoteId, partnerId, parentPartnerId])
  @@index([partnerId, status])   // 협력사 포털 워크큐
  @@map("sp_bom_rfq")
}

// 협력사 견적 회신 행 — 부품행(quoteItemId) 단위.
model SpBomRfqItem {
  id          BigInt   @id @default(autoincrement())
  rfqId       BigInt
  quoteItemId BigInt   // → SpBomQuoteItem (안정 ID — rowIdx 아님)
  source      String   @default("manual") @db.VarChar(8) // manual|api — api는 하이브리드 대비(D6)
  unitPrice   Decimal? @db.Decimal(14, 4)
  currency    String   @default("KRW") @db.VarChar(8)
  replyQty    Int?     // 회신 수량(요청수량과 다르게 회신 가능)
  moq         Int?
  stock       Int?
  dateCode    String?  @db.VarChar(100)
  leadTime    String?  @db.VarChar(64)
  memo        String?  @db.VarChar(500)
  offerId     BigInt?  // source=api일 때 근거 SpPartOffer (하이브리드 대비)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([rfqId, quoteItemId])
  @@index([quoteItemId])         // 행별 비교 조회
  @@map("sp_bom_rfq_item")
}
```

### 2.2 SpBomQuoteItem 변경 (최소 2필드)

- `selectionSource` 유니온에 **`partner`** 추가 (기존 none|auto|customer|catalog|admin|legacy).
- **`selectedRfqItemId BigInt?`** — 협력사 선정 FK(onDelete SetNull). 선정 확정 시
  `selectedOffer` JSON에 회신 스냅샷 박제(기존 snapshot-freeze 관례 그대로) + 합계는 기존
  서버 재계산 경로.
- 감사는 기존 `SpBomQuoteSelectionEvent` 재사용(source='admin', offerKey 자리에 rfqItem 키).

### 2.3 상태·전이 (코드 사전 — `@sp/api-contract`)

```
BOM_RFQ_STATUS: requested ─(협력사 회신 저장)→ quoted ─(quote answered/closed)→ closed
```
- quote.status(draft|requested|reviewing|answered|closed|canceled)는 **불변** — RFQ는
  reviewing 동안 도는 하위 계층(D10). "선정해야 함" 같은 워크큐 판정은 파생(lazy-derived).

### 2.4 프로세스 (1차 end-to-end)

```
고객 requested → 관리자 reviewing (기존 그대로)
  → [협력사 견적요청] 부품행 선택 × 승인 협력사 선택 → SpBomRfq diff upsert
      (빠진 협력사만 삭제·유지분 보존 — 레거시 PCB 검증 방식) + 메일 알림(신규 추가분만)
  → 협력사 /partner 포털 회신 (행별 단가·재고·D/C·납기, source=manual)
      │ 관리자 대리 입력 가능(같은 저장 경로, actor 기록)
  → [비교·선정] 행별: 현재 선정 오퍼(후보·원장 파생) vs 협력사 회신들
      → selectionSource='partner' + 스냅샷 박제  또는  기존 오퍼 유지
  → confirmed* 수동 확정(선정가 합계 참고 표시, D9) + answerNote → answered (기존)
```

공급사 열(파생)의 갱신: 검토 진입 시 TTL(기본 24h, `SpConfig` 설정화) 지난 부품이 있으면
**백그라운드 동기화 잡 자동 킥**(sp-engine, 기존 `SpBomSupplierSearchRun` 원장·trace·
`SpBomSupplierDailyUsage` 캡 재사용) — 화면은 즉시 렌더 + 신선도 배지. 수량 변경은
프라이스브레이크 원장 보유로 **로컬 재계산**(외부 재호출 없음 — 레거시 대비 핵심 개선).

### 2.5 API 표면 (sp-node — 경로는 구현 시 apiRoutes 관례 확정)

```
POST /api/admin/bom-quotes/:id/rfqs            RFQ diff 발송 (+메일)
GET  /api/admin/bom-quotes/:id/rfqs            회신 현황(문서+행)
POST /api/admin/bom-quotes/:id/select-partner  행별 선정/해제 (+스냅샷·재계산)
POST /api/admin/bom-quotes/:id/refresh-offers  공급사 시세 백그라운드 갱신 킥

GET  /api/partner/rfqs                         포털 워크큐 (requirePartner)
GET  /api/partner/rfqs/:id                     상세(부품행 — 목표단가 미노출 D8)
PUT  /api/partner/rfqs/:id                     회신 저장(행 일괄) → quoted
GET  /api/partner/access                       상단 메뉴용 승인 파트너 접근 여부·조직명

GET/POST/PUT /api/admin/partners(...)          파트너 CRUD·승인·계정 연결
```

---

## 3. 관리자 화면 — 모듈 스위처 + smartbom 모듈 (D15)

### 3.1 모듈 스위처

```
헤더:  [ 통합 관리 ]  [ 스마트 BOM ]        ← 1차 (2모듈)
       (확장 자리: PCB주문 · PCBA주문 · 기술개발 — 시안의 4영역. placeholder 노출 금지)
```

- **통합 관리 모듈** = 현행 `adminMenu` 전체를 무수정 래핑('core'). 기존 메뉴·라우트 냅둠.
- `admin/menu.ts` → 모듈 인지형: `adminModules = [{ key, labelKey, menu }]`, AdminLayout이
  활성 모듈 menu만 렌더.
- 활성 모듈: localStorage + **라우트 prefix→모듈 자동 동기화(afterEach)** — 레거시
  useAppMode의 "북마크 진입 시 메뉴 어긋남" gotcha를 처음부터 회수.
- 배지: 기존 badge 시스템을 모듈 단위 다중 소스로 확장(스마트 BOM: '선정해야 함' 수,
  파트너 승인 대기 수). 헤더 스위처에도 알림 점.
- 관례: 라우트·메뉴·i18n 동시 추가.

### 3.2 smartbom 모듈 라우트·메뉴 로드맵

```
/admin/smartbom                → 진행현황 (모듈 홈, 신규)          — 1차
/admin/smartbom/cases/:id      → Case 상세 = 기존 AdminBomQuote 재사용(+확장) — 1차
/admin/smartbom/partners       → 기준정보·파트너 (신규)            — 1차
(2차) + 주문·결제   (3차) + 입고·배송, 완료·클레임                — 등장 시점에 메뉴 추가
```

- 기존 `/admin/bom`·`/admin/bom-quotes`는 통합 관리 모듈에 그대로 병존(같은 상세 컴포넌트
  공유). smartbom 모듈 안정 후 정리 여부만 후속 결정.
- Case 표시 번호: `CASE-P-YYMMDD-NNN` 형태의 **표시용 파생 채번**(시안 채택 — 저장 키 아님).

### 3.3 진행현황 (신규 — 시안 형식 채택)

- 요약 카드(전체/진행/예외·보류/견적합계) + 검색 + **단계 필터 탭** + Case 목록:
  현재단계(**12단계 파생 타임라인** n/12 프로그레스 — §8 조정 1) · 최근 진행정보 · 상태칩 ·
  **행 인라인 "다음 액션" 버튼**(견적접수/회신확인/견적서 발송…).
- 1차엔 단계가 ①~⑤뿐이므로 시안의 '진행현황'과 '견적관리'를 **이 한 화면에 통합**(요약=관제,
  탭=작업 큐). 2차에 주문·결제 메뉴가 생길 때 분리 재검토.

### 3.4 Case 상세 — AdminBomQuote 확장 4지점

| 지점 | 내용 |
|------|------|
| RFQ 현황 패널 | 기존 요약 패널(quote/order/nostock/ai) 옆 5번째: "협력사 N · 회신 M · 미회신 K" + [협력사 견적요청] |
| 발송 모달 `BomRfqSendModal` | 좌=부품행 선택(included 행), 우=승인 협력사(capability=bom_rfq) 선택. diff 안내 + 메일 |
| 행 Drawer 3번째 뷰 | `CandidateDrawerView = 'candidates'\|'search'\|'rfq'` — 현재 선정 오퍼 위에 협력사 회신 나열 + 선정 라디오 + 대리 입력 인라인 폼. 행에는 "회신 n · 최저 ₩x" 배지 |
| 매트릭스 비교 모드 | 기존 `BomCompareModal` 확장 — 행=품목 × 열=[현재 선정 오퍼]+[협력사별 회신가], 품목별 선정 드롭다운 + **[품목별 최저가 일괄 선정]** + 합계 요약(단일 협력사 최저합계 vs 품목별 선정합계). 시안 채택 |

- 부가: 연결 문서 레지스트리(견적서/주문서/발주서/INVOICE/TRACKING — 2·3차 진가, 1차는 자리),
  12단계 타임라인 사이드, 고객 회신·인쇄는 기존 `EstimateModal`/`EstimateSendControl`/
  `EstimateSheet` 재사용(인쇄 `@media print`, D12).

### 3.5 기준정보 › 파트너 (신규 AdminPartners)

- `AdminMarketExperts`(심사) + `MemberStatusTabs·MembersTable·MemberDetailDrawer`(회원) 패턴 조합.
- 상태 탭(승인 대기/승인/정지) × 유형 필터(협력사/공급사·자사). 컬럼: 이름·유형·통화·상태
  (+시안의 **RFQ 응답률**은 파생 지표로 후속).
- 상세 Drawer: 조직 정보(국가·통화·capabilities), **계정 연결**(mbId 검색 — useAdminMembers
  재사용 → owner 지정), supplierCode 읽기 표시.

---

## 4. 협력사 포털 (같은 web 앱, 신규 라우트 그룹)

```
/partner            → 받은 견적요청 워크큐 (회신할 것 / 회신한 것 섹션)
/partner/rfqs/:id   → 상세 회신 폼 (행별 단가·재고·D/C·납기·메모, KRW)
```

- `PartnerLayout`(BomLayout급 경량 셸) + `requiresPartner` 가드(기존 requiresMember 패턴 확장).
- 승인된 파트너 계정만 공통 프로필 메뉴와 `/app` 일반 홈 상단에 `파트너 포탈` 링크를
  표시하며, 노출 여부는 `/api/partner/access`가 `sp_partner_member`와 조직 승인 상태를
  서버에서 판정한다. PHP 사이트 홈의 공용 GNB도 같은 승인 상태를 조회해 링크를 표시한다.
- 노출: MPN·제조사·설명·필요수량만(D8). 목표단가·고객정보 미노출.
- 회신 저장 → `quoted` 전환 + 관리자 배지 반영. 재회신 허용(선정 전까지).

---

## 5. 구현 순서 (1차) — ✅ 2026-07-29 전 단계 구현 완료

1. ✅ **스키마 + 계약 사전** — migration `20260729150000_add_smartbom_partner_rfq`(deploy 적용),
   `@sp/api-contract` `partner.ts`·`bom-rfq.ts`(+`BomQuoteSelectionSource`에 'partner').
2. ✅ **파트너 관리** — `admin-partners.ts`(CRUD·상태·계정 연결·1계정=1조직 가드),
   `AdminPartners.vue`, `smartbom:seed-partners` 스크립트(시드 4 + 승격 7 + **가짜 공급사
   계정 4 제외** — 멱등·--dry 지원).
3. ✅ **모듈 스위처 + 진행현황** — `admin/menu.ts` 모듈화(`adminModules`+`resolveAdminModuleKey`
   라우트 파생), AdminLayout 헤더 스위처, `AdminSmartbomCases.vue`(counts 카드·12단계 미니
   타임라인·인라인 검토 시작).
4. ✅ **RFQ 발송** — `admin-bom-rfqs.ts` diff API(+메일 `rfq-email.ts`), `BomRfqSendModal`.
5. ✅ **협력사 포털** — `requirePartner`(auth 플러그인·매 요청 서버 판정), `partner-rfqs.ts`,
   `/partner` 2화면, 대리 입력 = `saveRfqReply` 코어 공유.
6. ✅ **비교·선정** — `rfq-selection` API(`applyPartnerRfqSelection` — computeQuote/
   persistQuoteComputed/SelectionEvent 기존 경로 재사용), `BomRfqCompareModal` 매트릭스
   (+품목별 최저가 일괄 선정).
7. ✅ **회신 연결** — Case 상세 검토 폼에 선정 반영 합계 참고 표시(D9), quote answered/
   closed/canceled 시 `closeRfqsForQuote` 일괄 마감 + 포털 회신 409.

검증(2026-07-29): typecheck·lint 전체 green, api vitest 557 passed, **API E2E 22 케이스
ALL PASS**(diff 발송·공급사 거부·미회신 삭제·회신 보존·포털 노출 제한·타조직 차단·합계
재계산·선정 박제/해제/재선정·Mailpit 메일 수신·answered→RFQ 마감), 브라우저 실탐방
(진행현황·Case 상세·파트너 관리·모듈 스위처 왕복).

### 5.1 구현 중 확정된 정정(실측 반영 — 본문보다 이 절이 우선)

- **Case 상세 = 신규 `AdminSmartbomCase.vue`** (admin API 기반). §3.4 의 "AdminBomQuote
  재사용"은 실측 결과 부적합 — 그 컴포넌트는 관리자 **자체 업로드** 워크벤치(member API
  `/api/bom` 사용)였다. 확장 4지점의 취지(RFQ 패널·발송 모달·대리 입력·매트릭스)는 신규
  페이지에서 실현. Drawer 'rfq' 뷰는 패널+회신 모달로 대체(후속 여지).
- **RFQ 요청 범위 = included 행 전체 파생**(서버 `loadRfqScopeItems`) — 행 부분 선택
  발송은 후속(§3.4 발송 모달의 "좌=부품행 선택" 조정). 저장하지 않는 파생이라 스키마 무변경.
- **diff 삭제 정책 개선** — 빠진 협력사 중 **미회신(requested)만 삭제**, 회신(quoted)
  문서는 보존(레거시 "빠지면 삭제"의 회신 데이터 유실 방지). UI 도 회신분 해제를 잠근다.
- **SpPartner 에 statusReason·decidedBy·decidedAt 추가**(SpMarketExpert 감사 관례).
- **비교 모달 = 전용 `BomRfqCompareModal` 신규** — BomCompareModal(후보 비교)과 데이터
  소스·선정 API 가 달라 확장 대신 분리.
- **Case 표시 번호 = `CASE-B-YYMMDD-{id}`** (표시용 파생 — B=BOM 트랙, 저장 키 아님).
- 선정 박제 시 `selectedOffer.supplier = 협력사명`(사람 협력사는 공급사 코드 사전과 분리),
  `offerKey = rfq:{rfqItemId}`, 단일가 사다리(`priceBreaks=[{qty:1}]`)로 수량 변경에도
  회신 단가 유지, `pinned=true`.
- **확정가 입력은 토글식**(사용자 피드백 반영) — 검토 폼 기본은 예상 자동값(부품 합계 +
  설정 기본 운송료·관리비, VAT 포함 참고 환산) 읽기 전용 표시. "확정가 직접 입력" 토글을
  켠 경우에만 confirmed* 입력(켜는 순간 예상값 프리필), **끈 채 저장 = 확정 해제(null,
  고객에겐 예상 안내)**. 부가세는 여전히 미저장(전 금액 VAT 별도, 참고 표시만).
- **확정가 게이트(D16-1)의 인지 장치** — 확정가 없이 answered 가 되면 [주문하기]가 원천
  숨김이라, 화면이 스스로 이유·필수성을 설명한다: ① 토글 라벨을 "확정가 등록 — 등록해야
  고객 [주문하기]가 열립니다"로(선택적 '직접 입력' 표현 폐기 — 사용자 피드백), 미등록
  상태는 경고 박스 상시 표시 ② 관리자 [회신 완료] 클릭 시 확정 총액 없으면 confirm 경고
  (두 검토 화면 공통) ③ 진행현황 목록에 "확정가 미등록" 배지(answered·미주문 건)
  ④ 고객 /app/bom 회신 박스·견적관리 BOM 탭에 "확정가 안내 후 주문 가능" 안내.

## 6. 2차 — 주문·결제 (2026-07-29 확정, D14 이행)

**D16 확정 결정** (사용자 승인):
1. **주문 게이트 = 확정가 필수** — `status='answered'` + `confirmedTotal` 존재 견적만 주문
   가능(예상가 결제 사고 방지 — 확정 없이 주문하려면 관리자가 확정만 찍으면 된다).
2. **VAT = 거버 방식** — 카트/주문서 금액은 **부가세 포함 총액**. 확정 총액은 VAT 별도
   입력이므로 담기 금액 = `round(confirmedTotal × 1.1)`(거버 supply 모드 정규화와 동일 산식).
3. **주문 단위 = 견적 전체 1건**(품목 부분 주문 없음 — 부분 제외는 견적 단계에서).

**거버 주문 패턴 실측 요약(그대로 재사용)** — `pcb-projects.ts`/`g5-db.ts`:
- 템플릿 상품 = 카테고리 앵커(`TEMPLATE_ITEMS` 사전 + `seed-template-items.ts`,
  it_price 0·ca_id 10 — 가격/사양은 안 읽는 스냅샷 모델). **BOM 은 `bom: 'sp-bom-parts'`
  ("부품 BOM 주문") 1종 추가**(SpConfig 등록 대신 기존 사전 관례 유지).
- 담기 = 옵션 행 실등록(io_id=견적 식별자, io_price=총액) → cart INSERT(**ct_qty=1 고정**
  — 총액이 이미 전체 금액, 사양·수량은 sp_* 가 정본) → `sp_bom_quote.ctId` 저장.
  BOM 의 io_id 는 `bom-{quoteId}`.
- 주문 = 담기(기존 ctId 있으면 상태 검사: ordered→거부·cart→재사용·삭제→재담기) →
  `ct_select` 세팅 → `/shop/orderform.php` 직행. 이후 결제·주문 관리는 영카트 표준.
- 주문·결제 상태는 저장하지 않고 **ct/od 조인 파생**(거버 sp_order_spec 패턴·g5 미러
  금지 D10 유지) — Case 타임라인 ⑥(주문서 접수)·⑧(결제)이 여기서 계산된다.

**구현 항목 — ✅ 전부 구현 완료(2026-07-29)**:
① `sp_bom_quote.ctId`(migration `20260729210000`) ② 템플릿 상품 `sp-bom-parts` 시드
③ `POST /api/bom/quotes/:id/order`(`lib/bom-order.ts` — 게이트·재담기 시 금액/옵션 행
동기화·`ct_qty=1`) ④ 고객 [주문하기](/app/bom 상세 회신 박스 + 견적관리 BOM 탭)
⑤ 파생 표시 — `orderState`(none|cart|ordered)를 `BomQuoteSummary` 로 승격(고객·관리자
목록 batch 파생) + 관리자 상세 `orderInfo`(od 헤더 — ⑧ 결제 판정) + 타임라인
`smartbomStepOf(status, orderState, isPaid)` ⑥ 검증 — **주문 API E2E 17케이스 ALL PASS**
(게이트 NOT_CONFIRMED/NOT_ANSWERED·비소유 404·g5 카트 행 실검증(ct_qty=1·66,000=60,000×1.1)·
재사용·확정가 변경 동기화·ordered 파생·ALREADY_ORDERED), vitest 557 회귀 green.

**견적관리 통합(D17, 2026-07-30 — 탭안을 단일 통합 목록으로 대체)**: `/shop/quotes` 는
PCB·부품 BOM 을 **한 리스트**에 유형 배지로 섞어 보여주고 상단 필터([전체]·[PCB]·
[부품 BOM])로 거른다. 체크 선택 → [바로 주문]은 **같은 유형끼리만**(혼합 선택 시 안내) —
PCB 는 기존 `/api/pcb-projects/order`, BOM 은 **배치 API `POST /api/bom/quotes/order`**
(거버 미러: 견적별 카트 1행 담기·재사용, 실패 건은 failed 로 보고하고 진행, ct_select
일괄 → orderform 직행). 삭제 툴바는 PCB 전용(BOM 삭제는 /app/bom 담당). `#bom` 해시 =
부품 필터 딥링크. BOM 행 단건 [주문하기]는 체크+바로 주문 문법으로 통일하며 제거
(/app/bom 상세의 단건 주문은 유지).

### 6.1 협력사 발주 — D18 (2026-07-30 확정)

| # | 결정 | 근거 |
|---|------|------|
| D18-1 | 발주서 단위 = **Case × 협력사 1건**(`sp_bom_po`+`sp_bom_po_item`, UK(quoteId,partnerId)) | RFQ 와 동일 문법 — 협력사가 받는 문서 축이 같다 |
| D18-2 | 발주서 = **박제 문서**(생성 시점의 MPN·수량·단가 스냅샷, 이후 견적 변경과 무관·불변) | snapshot-freeze — 정산·감사 근거 |
| D18-3 | 대상 = included 행 중 **협력사 회신 선정 행**(selectedRfqItemId 보유)만 협력사별 집계. 공급사/카탈로그 선정 행은 발주서 미생성 — 생성 모달에 "외부 구매 목록"으로 요약만(자동화 후속) | 공급사 발주 자동화(Mouser 카트·DigiKey 리스트)는 별도 단계 |
| D18-4 | 게이트 = **결제 확인(od isPaid) 후 발주** | 미결제 선발주 실수 방지 — 급하면 입금확인 먼저 |
| D18-5 | 상태 = `issued → confirmed(협력사 확인) → closed(관리자 마감)`. **issued(미확인)만 삭제 가능**, confirmed 는 불가(협력사가 이미 봄) | 상태 최소 + 재발행 = 미확인 삭제 후 재생성 |
| D18-6 | 단가 = 선정 박제 단가(회신가) × orderQty, KRW 정수 합계, **VAT 별도**(협력사 B2B) | 선정 스냅샷이 단일 진실 |
| D18-7 | **타임라인 순서 조정: ⑦ 결제 → ⑧ 파트너 발주**(시안은 발주→결제였으나 우리 프로세스는 결제 확인 후 발주 — 파생 표시라 라벨 스왑) | stepOf: isPaid→7, 발주 존재→8 |
| D18-8 | 포털에 "받은 발주" 추가(목록·상세·[발주 확인]) + 발행 시 메일 알림 | RFQ 포털과 같은 문법 |

**✅ 구현 완료(2026-07-30)**: migration `20260730100000_add_bom_po`, 계약 `bom-po.ts`
(+`AdminBomQuoteSummary.poCount`), `lib/bom-po.ts`(집계 `collectPoDraftGroups`·생성
`createBomPos` all-or-nothing tx), `admin-bom-pos.ts`(목록/생성+메일/발행 취소/마감),
`partner-pos.ts`(포털 목록/상세/확인), Case 상세 `BomPoPanel`+`BomPoCreateModal`(협력사
그룹 미리보기+외부 구매 요약), 진행현황 "발주 전" 배지·⑧ 파생, 포털 "받은 발주" 섹션
+`PartnerPoDetail`. 검증: **발주 E2E 17케이스 ALL PASS**(NOT_PAID 게이트·NO_ELIGIBLE_ROWS·
스냅샷 금액·중복 발행 거부·poCount·메일·포털 확인·confirmed 삭제 거부·마감·타조직 404),
vitest 557 green.

### 6.2 스마트 BOM 주문·결제 메뉴 — D19 (2026-07-30 확정)

- **주문 축 화면 신설**(`/admin/smartbom/orders`, 메뉴명 "주문·결제" — 시안 명칭): D17 배치
  주문으로 **주문:Case = 1:N** 이 되어 Case 축(진행현황)과 별도의 주문 축 워크큐가 필요하다.
  입금확인 같은 주문 단위 업무를 Case 축 화면에 얹으면 배치 주문에서 파탄.
- **데이터 = 전부 파생**: `sp_bom_quote.ctId → g5_shop_cart(od_id) → g5_shop_order 헤더`
  batch 조회로 BOM 주문만 수집, Case 칩(연결 견적 N개)·poCount 와 결합. 저장 없음.
- **워크큐 탭**: 전체 · 입금 대기(od_status='주문') · 발주 대기(결제완료 + 발주서 없는
  Case 존재) · 완료(그 외). 메뉴 배지 = 입금 대기 수.
- **액션 최소주의(1차)**: [입금확인]은 기존 `PATCH /api/admin/orders/status`(target='입금',
  코어 미러 전이 + 알림 브리지)를 **그대로 재사용** — 화면은 두 곳(통합 주문내역·여기)이지만
  조작 경로는 하나라 정합 안전. 주문 편집·취소·배송 처리는 통합 관리 위임(취소는 "취소 후
  재주문 갭" 수정과 세트로 후속, 배송은 3차 물류에서 결정).

**✅ 구현 완료(2026-07-30)**: g5 batch 헬퍼(`getCartOrderLinks`·`getOrderHeadersLite` —
read-only, ⑫ 연장), 계약 `bom-orders.ts`, `admin-bom-orders.ts` 파생 목록(메모리 페이지
네이션 — 규모 커지면 커서 재설계 주석), `AdminSmartbomOrders.vue`(워크큐 4탭·Case 칩·
[입금확인]=기존 전이 API·[통합 주문내역 →] 위임 링크), 메뉴 "주문·결제"+**입금 대기
배지**(60s 갱신, badge 시스템 다중 소스화). 검증: **E2E 10케이스 ALL PASS**(배치 주문
그룹핑=주문 1건·Case 칩 2개·poCount 파생·입금 대기 counts/탭·입금확인 전이 후 수납/미수
반전·발주 대기 탭 이동·Case isPaid 파생), vitest 557 green.

### 6.3 외부공급사 발주 자동화 — D20 (2026-07-30 확정)

- **범위 = "카트/리스트까지"**(레거시 최종형 승계 — Mouser 실주문 코드는 레거시도 보존만·
  미호출): Mouser = 카트 담기(`POST /api/v1/cart/items/insert`, **주문 API 키는 검색 키와
  별개** — 레거시 xpse yaml 에서 승계, `.env MOUSER_ORDER_API_KEY`), DigiKey = third-party
  리스트(`POST digikey.com/mylists/api/thirdparty` — **무인증**, single-use URL). 실결제는
  구매담당이 공급사 사이트에서.
- **실행 주체 = sp-node 직접**: 두 API 모두 판단 없는 실행 1콜이고 Mouser 주문 키가 검색
  키와 별개라 sp-engine 재사용 이점이 없음(판단=엔진 경계 무관, 형제 리포 수정 회피).
- **공급사 발주도 발주서(sp_bom_po)로 기록**: 시드 조직(digikey/mouser 파트너 행)에 발행,
  `externalRef Json`(실행 결과 박제 — cartKey/singleUseUrl/실패)과 행 `supplierSku` 추가.
  같은 워크큐·감사·타임라인에 자동 합류. 공급사 확인(confirmed)은 구매담당 내부 액션.
- **발주서 생성(tx)과 외부 실행을 분리**: 생성 직후 자동 실행하되 실패해도 발주서는 유효 —
  패널에서 [재시도]. DigiKey single-use URL 은 1회용이라 [재발급] 제공.
- 1차 자동 대상 = mouser·digikey 만. 기타 공급사(unikeyic 등)는 발주서만 생성(수동 진행),
  파트너 조직에 매핑 안 되는 supplier(제조사 카탈로그 등)는 대상 외로 안내.

**✅ 구현 완료(2026-07-30)**: migration `20260730150000_add_bom_po_external`
(`externalRef Json`·행 `supplierSku`), `lib/supplier-order.ts`(Mouser cart insert /
DigiKey third-party), 집계 확장(`collectPoDraftGroups` — 공급사 오퍼 선정 행을
supplierCode→파트너 조직으로 그룹, house·미매핑 제외, 단가=unitPriceKrw 박제),
`executeExternalPo`(생성 직후 자동 실행 + `POST …/pos/:poId/external` 재시도/재발급),
생성 모달 공급사 그룹("발행 시 자동 실행"/"수동 진행" 뱃지·SKU 없음 표시), 패널
externalRef 표시(Mouser 카트 확인 링크·DigiKey 1회용 리스트 열기+재발급·실패 재시도).
검증: **E2E 8케이스 ALL PASS — 실 API 포함**(Mouser 실카트 담김 cartKey·KRW 합계
1,498 정확, DigiKey single-use URL 실발급, 재실행 갱신, 협력사 발주 NOT_AUTOMATED
가드), vitest 557 green. Mouser 주문 키는 레거시 xpse yaml 에서 `.env` 로 승계(미커밋).

### 6.4 3차 물류 — D21 (2026-07-30 확정, 사용자 결정 4건 반영)

| # | 결정 | 근거 |
|---|------|------|
| D21-1 | **경량 선적 모델로 시작**: `sp_bom_shipment` 별도 테이블, 1차는 발주서당 1건(poId UNIQUE) | 사용자: "지금은 발주서 단위, 나중에 부분 입고·발송 가능한지 검토" — **확장 경로 검증됨**: D13(발주 스키마에 선적 참조 금지) 덕에 ①부분 입고 = poId UNIQUE 해제 + 발주 행 배정(레거시 ship_qty 방식)으로 발주서 무변경 확장 ②선적 그룹 = shipmentGroupId 추가(레거시 동일) ③부분 고객 발송 = 영카트 주문이 1건이라 자체 배송 문서 신설이 필요(가장 큰 확장 — 그때 결정) |
| D21-2 | 검수(⑩) = **[입고 확인] + 편차 메모**(receivedAt·receivedNote) — 행별 수량 대사는 안 함 | 실무 부담 최소 |
| D21-3 | 고객 배송(⑪)·완료(⑫) = **영카트 재사용** — 주문·결제 화면에 [배송 처리(송장)]·[완료] 추가(기존 전이 API·알림), 상태는 od 파생 | 추가 모델 없음, 고객은 주문내역 조회 |
| D21-4 | 해외 구간 = **국제 6단계 풀 추적**(레거시 명칭 승계: 선적 준비→선적 요청→선적→국내도착→통관→완료), 국내 3단계(배송 준비→배송 중→입고 완료). 모드는 생성 시 협력사 국가에서 서버가 결정해 박제(D28 정정) | 사용자 선택(권장 2이벤트 대신 풀 추적) |
| D21-5 | 상태는 영문 코드 사전 + 한글 라벨(D10 관례 — 레거시 한글 리터럴 승계 안 함) | preparing→requested→shipped→arrived→customs→done / preparing→shipping→delivered |
| D21-6 | 협력사 포털에 **[발송 처리]**(carrier·송장 입력 — 선적 생성·발송 단계 진입)만 1차 제공, 중간 단계 전이·입고 확인은 관리자 | 송장의 원 주인은 협력사 — 최소로 열고 나머지는 후속 |
| D21-7 | 타임라인: ⑨ 선적 = 선적 존재, ⑩ 검수 = 전 발주 입고 확인, ⑪ 배송 = od '배송', ⑫ 완료 = od '완료' — 전부 파생. 별도 "입고·배송" 메뉴는 물량 생기면 후속(1차는 Case 상세+주문·결제로 커버) | 파생 표시 원칙 유지 |

**후속(범위 밖)**: 부분 입고·선적 그룹·부분 고객 발송(D21-1 확장 경로), 협력사 포털
중간 단계 전이(→ **D22 로 구현됨**, §6.5), 상업송장 생성기(레거시 invoice_data).

**✅ 구현 완료 (2026-07-30)**

- 모델: `sp_bom_shipment`(poId UNIQUE·quoteId 인덱스, mode/status/carrier/trackingNumber/
  trackingUrl/shippedAt/receivedAt/receivedNote/completedAt) — migration `20260730180000`.
- 계약(bom-po.ts): 모드·상태 사전(INTL 6/DOMESTIC 3, 국내 preparing 라벨='배송 준비'),
  `BomShipmentView`, 관리자 upsert/receive body, 포털 `PartnerPoShipBody`;
  `AdminBomPoView.shipment`·`PartnerPoDetail.shipment`(pick)·quote/orders 요약에 `poReceivedCount`.
- 서버(lib/bom-po.ts): `upsertShipment`(mode 생성 시 박제 — 기존 선적>협력사 국가(KR=국내),
  상태 모드 정합 409 INVALID_STATUS, shippedAt 최초 발송 진입 박제·completedAt 최종 단계
  이탈 시 해제), `receiveShipment`(선적 없어도 생성 — 시스템 밖 수령, 최종 단계 마감+
  receivedAt+편차 메모), `partnerShipPo`(소유 검증 → 발송 단계 진입).
  라우트: 관리자 `PUT …/pos/:poId/shipment`·`POST …/shipment/receive`, 포털 `POST /partner/pos/:poId/ship`.
- 화면: Case 상세 발주 패널에 "선적·입고" 열+[선적 관리] 모달(모드 잠금 표시·입고 확인 섹션),
  포털 발주 상세에 발송 정보+발송 처리 폼, 주문·결제에 [배송 처리(송장 다이얼로그·미입고 경고)]
  ·[구매확정]·Case 칩 "입고 완료 / 입고 n/m" 배지. 타임라인 ⑨~⑫ 파생(`smartbomStepOf` derived).
- **D21-3 구현 정정**: 고객 배송·완료 전이는 일괄 전이 API가 아니라 **임의 상태 변경
  (`PATCH /orders/:odId/force-status`)** 사용 — 주문 전이가 PCB 제작 7단계 선형 체인
  (준비→가격확인→…→생산완료→배송)으로 강제되어 있어 부품 주문은 제작 단계를 밟지 않고
  배송으로 직행해야 하기 때문(운송장 반영·재고 앵커는 force-status 가 코어 정상 분기 그대로
  수행). 이 경로는 코어 관례상 **알림 미발송** — 다이얼로그에 명시, 배송 안내가 필요하면
  통합 주문내역(선형 전이+알림 브리지)에서.
- 검증: contract/api/web typecheck·lint green, vitest 557 green, E2E 18케이스 ALL PASS
  (기본 모드·모드 정합 409·mode 박제·shippedAt 유지·completedAt 해제·포털 발송·소유권 404·
  입고 확인(메모/선적 無 생성)·목록 poReceivedCount 집계·bom-orders 케이스 집계·
  force-status 배송(송장 g5 박제)·완료·주문 축 반영).

### 6.5 선적 핑퐁 워크플로우 — D22 (2026-07-31 확정·구현, 레거시 절차 승계)

사용자 결정: "레거시했던 절차대로" + 4건(핑퐁 알림=메일 추가 / 관리자 수신처=영카트
운영자 메일(de_admin_info_email) 승격 / 상업송장 생성기=후속 분리 / 협력사 참여 범위=
레거시 그대로). 레거시 실측 정본: sp-smartbom-web `Shipment.types.ts`(fieldsForTransition·
actorForStatus)·`ShipmentPanel.vue`·doc/shipment*.md.

| # | 결정 | 근거 |
|---|------|------|
| D22-1 | **단계별 진입 주체 승계**(actorForStatus 미러): 국제 — 선적요청=협력사(출고예정일+Invoice 필수)·선적=관리자(AWB+송장)·국내도착=~~협력사(클릭만)~~ **관리자(08-02 정정 ↓)**·통관/완료=관리자 / 국내 — 배송 중=협력사(택배사+송장 필수)·입고 완료=관리자 전용 입고 확인(D28 정정). 사전은 api-contract `BOM_SHIPMENT_ACTORS`+`bomShipmentNextStatus/PrevStatus/ActorOf/StatusLabel`(서버·프론트 공용) | 레거시 절차를 국내 실무에 맞게 정정 |
| D22-2 | **서버 인가 신설**(레거시 취약점 교정 — 레거시는 프론트만 검증, 자기 doc에 "우회 취약점" 명기): 협력사 advance=다음 단계 주체 PARTNER 검증+단계별 필수(MISSING_SHIP_DATE/MISSING_INVOICE_FILE/MISSING_TRACKING), revert=현 단계 진입 주체 PARTNER(직전에 자기가 진행)만 1단계(입력값·첨부 유지). 관리자는 upsert 로 전 단계 임의 조작 유지(레거시도 사실상 동일) — AWB 필수는 관리자에겐 모달 경고로만 | 절차는 승계, 결함은 교정 |
| D22-3 | **첨부 = 기존 sp_file 폴리모픽 재사용**: refType='sp_bom_shipment'·fileType invoice/airwaybill·uploadedBy ADMIN/PARTNER(예약 컬럼 첫 사용)·종류별 1건(재업로드=교체, 새 실파일 성공 후 구 파일 정리)·파일서버 serviceType 'bom_shipment'(env BOM_SHIPMENT_FILE_SERVICE_TYPE, 레거시 버킷명 승계). 다운로드=권한 프록시 스트림(관리자·소유 협력사만 — 레거시 익명 pathToken 노출 교정). **D28에서 Invoice/AWB는 국외 전용으로 정정** | 인프라 관례 재사용 |
| D22-4 | **알림 메일 양방향 신설**(레거시엔 없음 — 폴링 배지뿐이라 멈춤): 협력사 전이→관리자(de_admin_info_email, Case CTA), 관리자 전이로 협력사 차례 도래→협력사(contactEmail, 포털 CTA), 입고 확인→협력사 통지(편차 메모 동봉). rfq-email.ts 셸 재사용, 비차단 | 핑퐁은 상대가 알아야 흐른다 |
| D22-5 | Case ID 미승계(선적이 Case 강결합이라 구조적 불필요), 상업송장 생성기(자동 초안+PDF/엑셀)·파일 교체 이력·국내 거점주소 안내는 후속 | 범위 통제 |
| D22-6 | sp_bom_shipment += `shipDate`(출고예정일, UTC 자정 저장 — KST 자정 저장 시 ISO 직렬화에서 하루 밀리는 함정 실측) — migration `20260731090000` | 최소 스키마 |

**D22-1 정정(2026-08-02) — 국내도착 주체 협력사→관리자**: "협력사가 계속 (도착
추적을) 확인해야 하는 게 부자연스럽다"(사용자). 국제 운송 계약 주체=샘플피씨비
(운송 수배·AWB 발급 모두 관리자)라 도착 정보도 관리자에게 먼저 오는데, 손 떠난
화물의 추적 의무를 협력사에게 지우던 레거시 절차는 승계 가치가 없었다.
`BOM_SHIPMENT_ACTORS.international.arrived: 'ADMIN'` 한 줄 정정 — 서버 인가·내
차례(myTurn)·adminPending 배지·메일 방향·양쪽 화면이 전부 사전 파생이라 자동
반영. 효과: 협력사의 국제 핑퐁은 **선적 요청 한 번으로 끝**(이후 지켜보기만),
관리자는 선적→도착→통관→완료 연속 차례(임의 조작 우회 대신 정식 차례). 운송사
API 도착 자동 감지는 후속 백로그.

**✅ 구현 완료 (2026-07-31)**: 계약(ACTORS 사전·헬퍼·파일 메타·advance body·뷰 확장) /
서버 lib(advance/revert/ensure/파일 save·delete·download·배치 로드) / 라우트(포털
advance·revert·files 3종 + 관리자 files 3종·PUT 알림·receive 통지) / 프론트(포털 상세 =
선적 진행 카드: 스텝 바·내 차례 폼·첨부·되돌리기, 관리자 모달 += 출고예정일·서류 섹션·AWB
경고). 구 `POST /partner/pos/:poId/ship` 은 advance 로 대체(제거). 검증: typecheck·lint·
vitest 557 green, D22 E2E 25케이스 ALL PASS(필수 게이트 2·실 파일서버 업로드/다운로드/
권한 404/삭제·Mailpit 실메일 3종·되돌리기 주체 규칙·국내 흐름), D21 E2E 재정렬 후 회귀 green.

**D22 후속 개선(같은 날) — 관리자 인지 장치 + 모달 핑퐁 위계**: ①메뉴 배지 — 진행현황
메뉴에 "관리자 차례 선적 수"(counts.shipmentPending, badge 소스 `bomShipmentPending` —
D19 입금 대기 배지와 같은 다중 소스 구조) ②Case 목록 행 "선적 처리 필요" 칩
(summary.shipmentAdminPending) — 판정=`isShipmentAdminPending`(다음 단계 주체 ADMIN ∧
검수 전, lib/bom-po `loadShipmentAdminPending` 전역 1스캔) ③선적 모달 — 상단에 "다음
단계: {라벨} — 누구 차례" 안내 + 관리자 차례면 [진행] 주 버튼(선적 진입 시 AWB 부재
confirm), 협력사 차례면 대기 안내 ④입고 확인 위계 — 도착 단계(국제 arrived·국내
shipping) 전엔 흐림+amber 경고("시스템 밖 수령 예외용")+confirm 경고문(조기 입고 확인
기능 자체는 D21-2 유스케이스로 보존). 배지 파생 E2E 5케이스 ALL PASS(없음/requested=
관리자 차례/shipped=협력사 차례 제외/customs/입고 후 제외).

**D22 후속 개선 2 — 협력사 인지 장치(같은 날)**: 갭 = 포털 발주 목록에 선적 정보가 없어
"선적 요청해야 하는 발주"가 구분 안 됨 + **선적 첫 단계(선적 요청)는 협력사가 시작하는
것이라 트리거할 관리자 전이가 없어 메일도 안 옴**. 반영: ①`PartnerPoListItem` +=
shipmentMode/Status(문서 없으면 국가 기본 모드+preparing)·shipmentReceived·
**shipmentMyTurn**(판정 = 발주 확인(issued 아님) ∧ 검수 전 ∧ 다음 단계 주체 PARTNER —
관리자 배지 판정의 협력사 미러, 선적 문서 없어도 첫 전이는 협력사 몫으로 true)
②포털 목록 — "받은 발주 (n · 처리 필요 m)" 헤더, 내 차례 행 상단 정렬+파란 테두리+
"{다음 단계} 필요" 칩+[진행하기] 버튼, 진행 중 선적 요약("선적 {단계}"/"입고 완료")
③발주 발행 메일에 "확인 후 선적 진행(해외는 Invoice 첨부+선적 요청)까지" 안내 한 줄
(첫 단계 메일 갭 보완). 협력사 인지 E2E 5케이스 ALL PASS(issued=확인 우선 false/
confirmed+문서 없음 true/shipped→국내도착 차례 true/customs false/입고 후 false).
④Case 상세 발주 패널(BomPoPanel)에도 동일 판정 적용 — 관리자 차례 행은 상태 파란
볼드+"{다음 단계} 처리 필요" 칩+[선적 관리] solid 버튼, 협력사 차례 행은 "협력사 차례"
회색 힌트, 헤더에 "선적 처리 필요 k" 카운트(사용자 실화면 검수 피드백 — 목록·배지·모달만
있고 정작 상세 패널 행에 신호가 없던 갭).

### 6.6 상업송장 생성기 — D23 (2026-07-31 확정·구현)

사용자 결정 3건: 생성 형식=**PDF+엑셀 둘 다**(레거시 동일) / 사용 주체=**협력사+관리자**
(레거시는 협력사 전용 — 관리자 대리 작성 운영 패턴에 맞게 확대) / 금액·통화=**자유 편집**
(초안은 KRW 발주가 그대로, 통화·단가 수동 — 자동 환산 안 함).

| # | 결정 | 근거 |
|---|------|------|
| D23-1 | 편집본 영속 = `sp_bom_shipment.invoiceData Json`(레거시 invoice_data 미러) — 다음 열기 프리필, 협력사·관리자가 같은 편집본 공유 | migration `20260731150000` |
| D23-2 | 자동 초안: 품목=발주 스냅샷 행(MPN+제조사·수량·단가 — 레거시 PCB 1행과 달리 다행), 수하인=영카트 사업자정보(레거시 거점 하드코딩 제거), 발송인=협력사 기준정보(주소는 직접 입력→저장본 재활용), Invoice No=`SPB-{poId}-{shipmentId}`, 날짜=오늘 KST | 레거시보다 자동화 폭 확대 |
| D23-3 | **fresh 재조립** — `GET …/invoice?fresh=true` 로 저장본 무시하고 발주 데이터 재조립(모달 [발주 데이터로 다시 채우기]). 레거시 "저장본이 자동조립을 영원히 가림" 함정 교정 | 레거시 doc 명기 함정 |
| D23-4 | PDF=프론트 html2canvas-pro+jspdf(레거시 방식 — 미리보기 DOM 캡처·A4 분할·지연 로딩 청크) → **Invoice 자동 첨부**(D22 파일 라우트 재사용) / 엑셀=서버 exceljs(레거시 POI 레이아웃 이식 — 영·简中 병기 통관 양식) → **다운로드**(첨부 슬롯은 PDF 몫 — 레거시는 둘 다 첨부였으나 종류별 1건 모델에 맞게 단순화) | 스택 재사용 |
| D23-5 | 국제 모드 전용 노출(국내 거래명세서는 별개 서식 — §6.18 D27로 구현), HS CODE·중량·주소는 직접 입력(레거시 동일), qty 는 문자열("1 SET" 표기 허용) | 레거시 승계 |
| D23-6 | 엑셀 POST 는 편집본 저장을 겸한다(레거시 POST xlsx 미러) — shared 에 `apiSendBlob`(JSON→Blob) 신설 | 관례 확장 |

**✅ 구현 완료 (2026-07-31)**: 계약 BomInvoiceItem/Data·Draft 응답 / lib/bom-invoice.ts
(초안 조립·저장·exceljs 렌더) / 라우트 — 포털·관리자 각 3종(GET draft(fresh)/PUT save/
POST xlsx) / 프론트 — 공용 InvoiceEditorModal(편집 폼+흰 문서 미리보기+PDF 생성·첨부+
엑셀 다운로드+다시 채우기, API 콜백 주입) + 포털 선적 카드·관리자 선적 모달의 Invoice
행 [🧾 생성](국제만). 검증: typecheck·lint·vitest 557 green, E2E 11케이스 ALL PASS
(초안 자동 채움 3·저장/프리필·fresh 재조립·저장본 보존·관리자 공유·xlsx 바이너리(PK
매직·8KB)·저장 겸행·타 조직 404). PDF 생성은 브라우저 산물이라 화면 검수로 확인.

**§6.6 정정(2026-08-02) — 초안 품목=선적(묶음) 단위**: D23 이 선적 그룹(§6.10)보다
먼저 구현돼 buildInvoiceDraft 가 발주서 1건의 items 만 조립 — 묶음 발송에서 나머지
발주서 품목·금액이 통째로 빠지던 결함(실측: 4건 묶음 28행 중 1행만). 교정: 선적이
있으면 조인(sp_bom_shipment_po) 소속 발주서 전체의 스냅샷을 합산(담은 순, 같은
협력사 묶음이라 발송인 정보는 그대로). 저장 편집본 우선 규칙은 불변 — 기존 저장본
선적은 [다시 채우기](fresh)로 재조립해야 전체 품목이 반영된다. E2E 4케이스(묶음
fresh=전체 28행·합계/비-fresh=저장본 유지) ALL PASS.

### 6.7 고객 회신 알림 메일 (2026-07-31 — 백로그 회수)

인지 장치의 마지막 조각: 관리자(배지·칩)·협력사(칩·메일)는 있는데 **고객만 접속해야
회신 여부를 알 수 있었다**. 견적이 `answered` 로 **전이되는 순간 1회** 발송(재저장·
확정가만 수정 시엔 안 보냄 — 전이 감지), 수신처 = `g5_member.mb_email`, 게이트 =
코어 회원 알림 설정(`cf_email_use` — 운영이 메일을 꺼두면 존중, `getNotifyConfig()`).
내용은 확정가 유무로 분기: 있으면 금액+[견적 확인하고 주문하기](D16 게이트와 정합),
없으면 [회신 내용 확인하기]. CTA `/app/bom/{quoteId}`. E2E 5케이스 ALL PASS
(Mailpit 실수신·재저장 미발송·확정가 분기·게이트 미발송).

### 6.8 견적서 열람·인쇄 (2026-07-31 — 백로그 회수)

거버 견적서 관례(EstimateSheet/EstimateModal — A4·직인 stamp.jpg·`window.print()`+인쇄
전역 스타일 주입, 브라우저 인쇄에서 PDF 저장 가능) **동형**의 BOM판. 유효기간은 표기
안 함(사용자 결정 — 대신 "시세 변동" 일반 안내문 한 줄).

- 문서: 견적번호=CASE-B 파생 채번·발행일=answeredAt, 수신(고객명 수기 초기화)/공급자
  (영카트 사업자정보+직인), 품목표=included·활성 시트 행(선정 오퍼 KRW 단가 스냅샷,
  미선정 '—'), 합계=부품 합계+운송료+관리비=**공급가액→부가세(10%)→합계**(D16 주문
  결제액 확정가×1.1 과 일치 — "견적서 합계=실결제액"), 회신 메모·결제계좌.
- 서버: 공용 `toBomQuotePrintDto`(합계는 저장 스냅샷 그대로 — 화면·문서 일치),
  관리자 `GET /api/admin/bom-quotes/:id/print`(상태 무관 — 확정 전이면 예상값+**"가안"
  표기**), 고객 `GET /api/bom/quotes/:id/print`(**회신 완료+확정가 시만** — 주문 게이트와
  동일 조건, 미충족·타인은 404 은닉).
- 화면: 공용 BomEstimateSheet/BomEstimateModal(components/smartbom, 로더 콜백 주입) —
  관리자 Case 상세 헤더 [🧾 견적서], 고객 /app/bom/:id 회신 박스 [🧾 견적서 보기·인쇄]
  (canViewEstimate 조건부).
- 검증: typecheck·lint·vitest 557 green, E2E 9케이스 ALL PASS(관리자 DTO 정합·고객
  200·타인 404·확정가 해제 시 고객 404/관리자 가안·회신 전 상태 게이트).

### 6.9 매직링크 무로그인 회신 (2026-07-31 — D11 후속 회수)

개념: **메일함 소유 = 신원**(RFQ 를 그 조직의 공식 이메일로 보내는 신뢰를 인증에 재사용),
권한은 **그 RFQ 1건의 회신 스코프**로 축소한 교환. 회원가입·계정 연결·로그인이 전부
불필요해져 신규(해외) 협력사도 메일만으로 회신한다 — [대리 입력]으로 우회하던 갭 해소.
범위 결정: 매직링크만(외화 회신은 별도), 메일 주 버튼 = 매직링크(포털은 보조 링크).

- 토큰: `sp_bom_rfq.magicToken`(256bit 랜덤 hex, UNIQUE) + `magicTokenAt` — **발송 시
  자동 발급**(diffSendRfqs), 무효 = 불일치 · 재발급 회전 · 발급 30일 경과. 저장형인
  이유 = 유출 시 [재발급]으로 즉시 끊기 위함(서명형은 회수 불가).
- 무인증 라우트 `GET/PUT /api/rfq-reply/:token` — GET 은 마감돼도 열람 허용(상태를
  화면이 설명), PUT 만 RFQ_CLOSED 409. 상세 DTO 는 포털 것 재사용(고객 정보 없음 보장).
- 공개 페이지 `/app/rfq-reply/:token`(가드 없는 라우트, 독립 경량 셸) — 회신 폼은
  포털·대리 입력과 같은 RfqReplyForm(저장 경로 saveRfqReply 까지 단일). 저장 후에도
  마감 전까지 같은 링크로 재수정.
- 관리자: RFQ 패널 행 [링크 복사](origin 기준 조립·clipboard)/[재발급](confirm — 구
  토큰 즉시 무효, 발급 전 구 데이터 소급 발급 겸용). 메일 CTA: [가입 없이 바로
  회신하기] 주 버튼 + 30일 유효·외부 공유 자제 안내 + 포털 로그인 보조 링크.
- 검증: typecheck·lint·vitest 557 green, E2E 12케이스 ALL PASS(발급 64hex·Mailpit
  메일 CTA·무인증 GET/PUT·관리자 파생 반영·마감 GET 허용/PUT 409·재발급 회전(구 404/
  신 200)·30일 만료 404·무작위 404).

### 6.10 선적 그룹 — 여러 발주서 한 물류 묶기 (2026-08-01 — D21-1 확장 회수)

문제: 한 협력사가 **여러 Case 의 발주서**를 받아 실물은 한 박스로 보내는데(같은 Case
안에서는 협력사당 발주서 1장이라 묶음 수요는 반드시 Case 를 가로지른다), 시스템은
발주서마다 선적을 따로 요구했다(서류 N번·핑퐁 N번·검수 N번). 레거시는 전용 "선적
그룹 보드"(그룹/선적/배정 3층)로 풀었지만 협력사 학습 부담이 컸다 — 사용자 우려에
대한 답으로 **보드 자체를 없애고 발송 시점에 묶는다**.

- UX: 발주서 상세의 최초 발송 전이(선적 요청/배송 중) 폼에 **"함께 발송할 발주서"
  체크 리스트**(같은 협력사·미소속·발주 확인된 것) — 체크하고 진행하면 선적 1건에
  N건 연결. 이후 서류·핑퐁·입고 확인 전부 1번. 새 화면 0개.
- 모델: `sp_bom_shipment_po` 조인(선적:발주서=1:N, poId UNIQUE=발주서는 최대 1선적,
  발주서 스키마에 선적 참조를 넣지 않는 D13 은 조인이라 유지). 기존 `sp_bom_shipment.
  poId/quoteId` 는 **대표(생성 발주서) 의미로 잔존**(migration 이 기존 1:1 을 조인으로
  백필). 소속의 진실 = 조인 — 선적 해석(포털·관리자·파일·인보이스)을 전부 조인
  경유로 통일해 묶음의 어느 발주서로 접근해도 같은 선적을 조작한다.
- 파생 재작성(quoteId 단일 참조 해체): 관리자 차례 배지 byQuote = 소속 발주서들의
  quoteId 전부, 입고 발주서 수(quote 목록·주문 축 poReceivedCount) = 조인 기반
  `loadReceivedPoCounts`, 포털 목록 += `shipmentAttached`(후보 필터).
- 규칙: 묶기 = 최초 발송 전이에서만(`withPoIds` — 소유·미소속 서버 검증, 위반
  INVALID_GROUP_PO 409) / 제외 = 대표 불가(PRIMARY_PO)·발송 준비 단계만
  (NOT_PREPARING) — 협력사·관리자 동일 규칙 / 입고 확인 = 선적 단위(묶음 전체 일괄,
  발주서별 부분 입고는 D21-1 잔여 확장).
- 화면: 포털 상세 — 묶음 카드(목록·기준 표시·[묶음에서 제외])+체크 리스트+버튼에
  "(N건 묶음)" / 관리자 — 발주 패널 "📦 묶음 N건" 배지(hover 목록)·선적 모달 묶음
  목록+[제외].
- 검증: typecheck·lint·vitest 557 green, E2E 13케이스 ALL PASS(타 조직 묶기 409·
  3건 다중 Case 묶음·대표 표시·비대표 상세 공유(파일 포함)·선적 단위 입고→3개 Case
  poReceivedCount 동시 반영·NOT_PREPARING/PRIMARY_PO·비대표 제외·목록 attached·
  preparing 은 관리자 대기 아님), D22 핑퐁 25케이스 회귀 green(조인 전환 무결).

### 6.11 파트너 포털 재구성 — 작업 중심 홈 + [보내기] (2026-08-01, 사용자 피드백)

피드백: "포털을 완전히 바꾸는 게 좋겠다, '함께 발송할' 개념도 쓰기 어렵다". 진단 —
포털이 **문서(발주서) 중심**이라 발주서 상세에 확인·선적 6단계·서류·인보이스·묶음이
전부 쌓였고, 발송(박스 단위 행위)을 발주서 안에서 시키니 "함께 발송할"이라는 역방향
개념이 필요해진 것이 어색함의 뿌리. 재구성 원칙: **작업 중심 + 발송을 1급 개념으로**.

- 홈(/partner) = 오늘 할 일 카드 4개: 회신할 견적 / 확인할 발주 / **📦 보낼 물건**
  ([보내기]로) / 진행 중 발송(**내 차례 n건!** 강조). 아래에 해당 섹션들, 발주서·회신
  완료·완료 발송은 접힘(details) 보조 목록으로 강등.
- **[📦 보내기](/partner/ship)** — 순방향 플로우: ①담기(확인 완료·미담김 발주서를
  박스에 담듯 체크 — 1건이든 N건이든 같은 흐름, "묶음"은 특수 기능이 아니라 자연
  결과. **"함께 발송할" 역방향 개념 소멸**) ②만들어진 발송 카드에서 서류(인보이스
  🧾 만들기/첨부)+출고예정일 ③'선적 요청' 진행. 발송 준비 중(preparing) 박스는
  재진입 시 이어서.
- **PartnerShipmentCard**(공용) — 발송(박스) 단위 진행 카드: 담긴 발주서(빼기 포함)·
  단계 스텝·서류·내 차례 폼·되돌리기·검수 결과. 홈(진행 중/완료)과 [보내기] 공용.
- 발주서 상세 = **문서 열람 전용으로 축소**(품목·금액·[발주 확인]) + 발송 소속 안내
  링크만. 선적 UI 전부 제거(§6.10 의 "함께 발송" 체크 UI 는 이 재구성에서 폐기·흡수).
- 서버 신규 2개뿐(§6.10 모델 전부 재사용): `POST /partner/shipments`(담기 —
  preparing 선적+조인 생성, 첫 선택이 대표, 소유·미담김·확인 완료 검증) +
  `GET /partner/shipments`(발송 목록 — files·groupPos·**myTurn** 포함). 조작은 대표
  poId 경유로 기존 라우트 재사용(신규 표면 최소).
- 검증: typecheck·lint·vitest 557 green, E2E 7케이스 ALL PASS(담기 생성·타 조직/
  중복 409·목록 myTurn·서류 첨부 연동·선적 요청 진행·진행 후 차례 전환).

**§6.11 개정(같은 날) — 두 칸(선반↔박스) 이동 UI**: "여전히 묶고 빼기가 인지되지
않는다"는 피드백. 진단 — 체크박스는 "옮긴다"는 물리 감각이 없고, "기준(대표) 발주서는
못 뺌"이라는 시스템 내부 사정이 규칙으로 노출됐다. 개정:

- [보내기] = **좌(선반: 보낼 물건) ↔ 우(📦 박스: 이번 발송)** 두 칸. [담기 →]를
  누르면 카드가 실제로 오른쪽으로 이동, [← 꺼내기]로 복귀 — 공간이 상태를 말한다.
  박스 = preparing 발송 그 자체(서버 실시간 반영·재진입 유지, 첫 담기=생성·이후=
  attach). 박스 푸터에 담긴 수·합계 + [이 박스로 발송 준비 →](서류 단계로 전환).
- **"기준(대표)" 개념 사용자 은닉**: 어느 발주서든 꺼낼 수 있다 — 대표를 꺼내면
  서버가 남은 발주서로 자동 승계(shipment.poId/quoteId 갱신), 마지막을 꺼내면 발송
  자체를 정리(첨부 실파일 → sp_file → 선적 순 — 고아 방지). 남는 규칙은 **"발송
  누르기 전엔 자유"** 하나. PRIMARY_PO 에러 코드·"기준" 배지·제외 제한 전부 제거
  (관리자 모달 동일).
- 서버 추가: `POST /partner/shipments/:shipmentId/pos`(담기 attach — preparing·소유·
  미담김 검증), detachShipmentPo 개정(승계·소멸). E2E 9케이스 ALL PASS(생성+attach·
  중복 409·대표 꺼내기→승계 실측·마지막 꺼내기→발송 소멸+파일 0건·발송 후 attach/
  detach 409).
- **작업 공간 단일화**(피드백 3건 누적: 카드에 담기가 없다 → 인라인 담기 → "보내기
  화면으로 유도" → "바로 보내기로 가게") — 최종형: **준비 중(preparing) 박스는 홈에
  카드로 노출하지 않는다.** 홈 "진행 중 발송" = 발송된 것(requested~)만, 준비 중
  박스는 할 일 카드 "📦 보낼 물건"에 **"준비 중인 박스 n건 — 계속하기 →"** 로 바로
  [보내기] 화면 유도. 담기·꺼내기·서류·발송은 두 칸 화면 한 곳이 전담하고, 발송
  카드는 편집 UI 없이 진행·핑퐁만(카드 prop showBoxLink 는 보내기 화면 밖 안전판).
- **협력사 관점 상태 번역**(2026-08-02, "마감인데 담기 가능해 헷갈린다" 피드백):
  혼란의 뿌리는 담기 로직이 아니라 관리자 문서 상태(발행됨/협력사 확인/**마감**)를
  협력사에게 그대로 보여준 것. closed=문서 종결≠물류 종료(D22)라 담기 후보 유지가
  맞고, 대신 협력사 화면 배지를 "내가 뭘 해야 하나"로 번역한다 —
  `partnerPoDisplayStatus`(apps/web/src/partner/partnerPoStatus.ts, 홈 목록·상세 공용):
  입고됨=**입고 완료** / issued=**확인 필요** / 미담김=**발송 대기** / 박스 담김
  (preparing)=**발송 준비 중** / 그 외=**발송 중**. '마감'이라는 단어는 협력사
  화면에서 사라지고(마감 발주서는 "발송 대기"로 보임 — 후보인 게 자연), 관리자
  화면은 문서 상태 그대로. 목록의 📦 아이콘은 배지와 중복이라 제거.

### 6.12 관리자 메뉴 재편 — 역할별 워크큐 (2026-08-02, 시안 §8 "업무영역 단순화"의 완성)

"각 파트에 집중하는 메뉴"(사용자 요청) — 시안의 부품 모듈 4메뉴(견적관리/주문·결제/
입고·배송/완료·클레임)를 구체화하되 **발주를 주문·결제에서 분리**(실무 분업: 경리는
돈, 구매는 발주). 원칙: **목록 = 역할별 워크큐(파트 전용 탭·인라인 액션), 상세 =
단일 Case 척추 유지** — 파트별 상세 4벌 금지, 대신 워크큐→Case 진입 시 `?focus=
rfq|po` 로 해당 섹션 자동 스크롤+2.5초 강조(AdminSmartbomCase).

smartbom 모듈 메뉴 6개와 배지(= 각 역할이 "지금 움직여야 하는 수" 하나):

| 메뉴 | 담당 | 워크큐 탭 | 배지 |
|---|---|---|---|
| 진행현황 | 총괄 | 전체 조감(유지 — 액션도 유지, 결정) | — |
| 견적관리 | 견적 | 검토 대기→RFQ 진행→회신 완료→종료 | requested 수 |
| 주문·결제 | 경리 | 입금 대기→결제 완료→완료(입금확인만) | 입금 대기 수 |
| 발주 | 구매 | 발주 대기→확인 대기→진행 중→마감 | 발주 대기 수 |
| 선적·배송 | 물류 | 내 차례→진행 중→입고 완료 + 고객 배송 큐 | 관리자 차례 선적 수(이동) |

- **데이터 = 기존 원장의 새 절단면**(스키마 무변경): `GET /admin/bom-pos`(PO 횡단,
  탭 issued/confirmed/closed — loadAdminPoCrossList), `GET /admin/bom-shipments`
  (선적 횡단, 탭 admin_pending/active/received — loadAdminShipmentCrossList, 대표
  po 경유 협력사·Case 표시+adminPending 파생). 메모리 페이지네이션(admin-bom-orders
  관례). **"발주 대기"는 PO 가 없어 주문 축이 담당** — bom-orders 탭 확장:
  `paid|to_ship|shipping|completed` 추가·`done` 제거(counts 동일 확장).
- **이동 2건**: ①주문·결제의 배송 처리·구매확정(D21-3 force-status)+미입고 경고 →
  선적·배송 하단 "고객 배송" 큐(to_ship/shipping 탭) — 물류가 입고 확인→고객 발송→
  확정을 한 화면에서. ②"발주 대기"(paid_unissued) 탭 → 발주 메뉴 첫 탭.
- **견적관리의 실황**: AdminBomQuoteSummary 에 `rfqTotal/rfqReplied`(spBomRfq
  groupBy 배치) — reviewing 인데 rfqTotal=0 이면 "RFQ 미발송" amber 강조(다음 액션
  가시화), 회신 m/n 표시. 선적·배송의 선적 처리는 BomShipmentModal 재사용(행 →
  대표 poId 를 groupPos.isPrimary 로 찾아 useAdminBomPos(quoteId)에서 매칭).
- **결정 3건**(AskUserQuestion): 발주 대기=발주 메뉴로 이동 / 진행현황=유지+액션도
  유지(전체 조감+급하면 바로 처리, 파트와 중복 허용) / **역할 권한(계정별 메뉴
  제한)은 후속** — 지금은 전 메뉴가 최고관리자에게 보이고, 담당자 계정 허용은
  신뢰 화이트리스트+역할 필드로 별도 작업. 완료·클레임 메뉴(시안 4번)는 백로그.
- E2E 24케이스(PO 횡단 counts=DB 실측·탭 필터/선적 횡단 adminPending·입고 정합/
  주문 신 탭 7counts·구 done 400/RFQ 카운트 DB 대조) ALL PASS, vitest 557 유지.

**§6.11 개정(2026-08-02) — 완료 발송 분리**: 상태가 완료(done|delivered)여도 입고
확인 전이면 "진행 중 발송"에 남던 틈("완료가 왜 진행 중에?") + 완료는 누적되므로
홈 접힘 목록이 부적합. **협력사 관점 완료 = 최종 상태 도달 ∨ 입고 확인**(서버
isShipmentDoneForPartner)으로 정의하고, GET /partner/shipments 에 tab=active|done+
페이지네이션+counts 를 얹어 홈=active 만(진행 중 발송·보내기 박스), 완료=별도
페이지 /partner/shipments/done(조회 전용 아카이브, 10건 페이지). 홈 하단 접힘
목록은 "완료된 발송 n건 보기 →" 링크로 대체. 발주서 배지(partnerPoDisplayStatus)도
최종 상태 발송 소속이면 '발송 중' 대신 **'완료'**. E2E 7케이스 ALL PASS.

**§6.12 개정(2026-08-02) — 진입 파트별 상세 섹션 접힘**: "견적관리로 들어오면 발주
섹션은 안 보여도 된다"(사용자). 완전 숨김은 ①인접 단계 참조(발주↔RFQ 근거 확인)가
잦고 ②같은 URL이 경로 따라 달라 버그로 오인되므로, **무관 섹션 = 한 줄 접힘 바**
(`▸ 협력사 발주 (n건) — 펼치기`, 존재 신호+한 클릭 복원)로 확정. `?focus=` 를
`?from=quotes|orders|pos|logistics` 로 교체 — 초기 접힘: quotes→발주 / orders·pos·
logistics→RFQ+**품목·검토**(가장 큰 몸통도 접음, 결정) / from 없음(진행현황·북마크)
=전체 표시. 초기의 스크롤+2.5초 강조(focus)는 **제거**(사용자 결정) — 접힘만으로
관련 섹션이 상단에 오므로 과잉이었다. 상세는 여전히 단일 척추 — 렌더만 다르다.

### 6.13 RFQ 부분 행 선택 발송 (2026-08-02, 레거시 승계 — 백로그 회수)

협력사 전문 분야만 골라 견적요청(IC는 A사, 수동소자는 B사) — 회신율↑·협력사 부담↓·
고객 BOM 전체 노출 최소화. §5.1 에서 "부분 선택 후속"으로 미뤄뒀던 항목의 회수.

- **저장**: `sp_bom_rfq.requestedItemIds Json`(행 id 문자열 배열, **null=전체** — 기존
  RFQ 하위호환, migration `20260802090000` 추가 전용). 표시·검증 범위 = scope 파생 ∩
  이 집합(`filterScopeForRfq` — 견적 행이 나중에 빠져도 자연 방어).
- **발송(같은 날 개정 — "행 선택은 품목 테이블에서")**: 행 체크는 판단 근거(선정
  오퍼·매칭·후보)가 있는 **Case 상세 품목 테이블**에서 한다 — 체크 컬럼+툴바(선택
  n행 표시·엔진 `componentType` 기준 [저항]/[캐패시터]/[저항+캐패시터]·[오퍼 없음]
  퀵 액션·해제), **선택 없음=전체 발송**. 유형 판정은 Vue 문자열 추측 없이 sp-engine
  정규화 결과만 소비하고 미분류 행은 자동 선택에서 제외한다. 0건 퀵 액션은 비활성화+
  기존 선택 유지로 빈 집합이 전체 발송으로 뒤집히는 것을 막는다. 발송 모달은
  요약·확인만(편집 창구 단일 — 모달 내 행 목록은 제거). 부분 선택은 **이번에 새로
  생성되는 RFQ 에만** 적용(유지분 세트 불변 — diff 보존 규칙 동일). 협력사별 다른
  세트 = 발송을 나눠서(행 골라 A사 → 행 바꿔 B사). 전체 선택은 서버가 null 로
  정규화 — "이후 행 추가 자동 포함"이라는 전체 발송의 성질 유지. scope 밖 id 는 400.
- **회신 3경로**(포털·매직링크·관리자 대리)는 saveRfqReply 코어의 범위 검증 하나로
  통제 — 요청하지 않은 행 회신은 ITEM_OUT_OF_SCOPE 400. 포털 목록 품목 수·상세·
  메일 품목 수도 요청 범위 기준.
- **표시**: 품목 테이블에 요청 협력사와 행별 상태(요청중/회신/행 미회신/마감)를 칩으로
  표시하고 클릭하면 해당 회신 창을 연다(발송 체크박스는 **다음 발송 선택**으로 구분).
  RFQ 패널 회신 행 = "m/n + 부분 배지", 비교 매트릭스는 미요청 칸을 "미요청"으로
  구분(미회신 —와 다름 — 회신율 오독 방지).
- **0곳 발송 허용**(같은 날): partnerIds 빈 배열 = diff 수렴으로 **미회신(requested)
  RFQ 전부 회수**(quoted 는 해제 자체가 잠겨 있어 0곳 상황에 없음). confirm 없이
  버튼 라벨 "미회신 요청 회수"가 의미를 말한다 — "1곳 이상" 제한 제거(사용자 요청).
- 행×협력사 매트릭스 발송 UI(레거시식)는 채택 안 함 — 다회 발송으로 충분(범위 통제).
- E2E 11케이스(scope 밖 400/부분 발송 저장·유지분 불변/포털·매직링크 2행 필터/범위
  밖 회신 400·범위 내 200/하위호환 전체/전체 선택 null 정규화/정리) ALL PASS.

### 6.14 관리자 Case 영구 삭제 · 무감사 초기화 (2026-08-02)

잘못 만든 Case를 주문·발주·선적까지 포함해 하드 삭제한다. 타 주문·타 Case 데이터까지
번지지 않도록 Case 상세 위험 구역 또는 관리자 목록의 명시적 체크 선택으로만 진입하며,
서버가 삭제 직전에 각 Case 관계를 다시 읽는다.

- **2단계 레이어**: ① `GET /admin/bom-quotes/:id/force-delete-preview`가 품목·시트·후보·
  선택 이벤트·분석/검색 원장·sp-engine 잡·RFQ/회신·PO/품목·주문·선적·실파일 수와
  차단/경고를 계산한다. ② 복구 불가 확인 체크 후 `POST /admin/bom-quotes/:id/force-delete`를
  호출한다. 확인 문구 직접 입력은 요구하지 않는다. 응답의
  SHA-256 `previewToken`은 Case 수정시각뿐 아니라 PO/선적 소속·주문 수납·영카트
  상품/옵션 연결·엔진 상태를 묶으며 실행 시 서버가 전부 재조회해 달라지면 409로 되돌린다.
- **목록 일괄 삭제**: 진행현황과 견적관리 목록에서 현재 페이지의 Case를 개별/전체 체크한 뒤
  같은 2단계 레이어로 진입한다. 영향 조회는 DB 연결을 몰아치지 않도록 최대 4건씩 수행하고,
  삭제 가능·결제 강제 가능·보호·조회 실패를 Case별로 먼저 보여준다. 결제 외 차단이 있는 Case는
  목록에 남기고, 일반 삭제 대상과 관리자가 결제 강제 체크한 Case만 단건 API로 순차 실행하므로,
  한 Case가 실행 직전 결제·상태 변경으로 409가 되어도 나머지
  삭제를 계속한다. 일반 모드는 공통 삭제 사유, 초기화 모드는 공통 `reset` 선택을 적용하며 완료
  레이어가 삭제/유지 및 Case별 실패 결과를 보고한다. 필터나 페이지를 바꾸면 선택은 초기화된다.
- **일반 영구 삭제(`audited`)**: 사유 필수. 삭제 대상 Case와 FK를 맺지 않은
  `sp_bom_case_delete_audit`에 Case 번호·제목·회원·삭제자/IP·사유·영향 스냅샷만 같은
  DB 트랜잭션으로 보존한다(migration `20260802120000_add_bom_case_delete_audit`).
  단독 미입금 주문은 영카트 코어 호환 복원 백업 후 주문 헤더와 정확한 Case cart 행을
  물리 삭제한다.
- **감사기록 없이 초기화(`reset`)**: 체크를 별도로 켜면 같은 하드 삭제 그래프를 실행하되
  SmartBOM 삭제 감사행과 영카트 `g5_shop_order_delete` 복원행을 만들지 않는다. PO·선적·
  외부 PO 실행 존재는 이 모드를 막지 않고 모두 Case 소유 데이터로 정리한다.
  이 표현은 접속 로그·DB/서버 백업·이미 발송한 메일·외부 공급사 흔적의 소거를 보장하지
  않으며 화면에도 그대로 고지한다.
- **결제 주문 별도 강제 삭제**: 주문 상태 전이 또는 수납액·사용 포인트/쿠폰·PG 거래번호가
  있으면 기본 `PAID_ORDER` 차단으로 두되, 이것이 유일한 차단 사유인 배타 주문은 2차 레이어의
  **`결제 이력·주문까지 강제 삭제`** 체크로만 해제한다. 실행 시 주문·정확한 단일 cart 행을
  다시 `FOR UPDATE`로 잠그고 `g5_shop_order_data`·`g5_shop_coupon_log`·`g5_shop_coupon`·
  `g5_shop_personalpay`·`g5_shop_order_post_log`·`g5_shop_inicis_log`의 주문 연결 행과
  주문 결제/취소/배송 적립 `g5_point` 원장을 같은 InnoDB 트랜잭션에서 삭제한다. 포인트
  사용분을 남은 원장에 재배분하고 `po_mb_point`/`g5_member.mb_point`를 재계산하며,
  `ct_stock_use=1`이면 상품/옵션 재고를 복원하고 `it_sum_qty`도 다시 맞춘다. `audited`는 최신
  `g5_shop_order_delete` 백업 1건을, `reset`은 0건을 남긴다. **로컬 PG 로그만 삭제하며 외부
  결제사의 승인 취소·환불 API는 호출하지 않는다**는 점을 두 경고 레이어와 완료 결과에 표시한다.
- **강제로도 유지되는 공통 차단**: 같은 주문의 다른 cart 행,
  Case의 `ctId`가 기대한 BOM 템플릿/`bom-{quoteId}` 옵션을 가리키지 않는 연결,
  실행 중 분석/검색·결과 반영, 대표 PO/Case와 조인 소속이 어긋난 선적을 차단한다.
  선적은 `preparing`·진행·완료 상태와 관계없이 삭제 대상이다. 영카트 주문 DELETE 자체에도
  같은 수납 조건과 단독 ct/상품/옵션 조건을 넣어 프리뷰 직후 결제/합류/연결변경 레이스를
  다시 막는다. 장바구니는 기대한 ct/상품/옵션과 영카트 주문 여부 정본인 `ct_status='쇼핑'`이
  그대로인 행만 물리삭제한다(임시 `od_id`와 과거 주문번호의 우연한 충돌은 주문으로 보지 않음).
- **정리 그래프**: 영카트 배타 주문(결제 주문은 별도 강제 체크)·장바구니와
  `bom-{quoteId}` 옵션 → sp-engine
  잡(완료/실패만, 업로드 임시 원본 포함; sp-node 결과 폴러/카탈로그 반영 중이면 409) → 상태와
  관계없이 선적의 대상 PO 소속 강제 분리(공유 선적은
  남은 PO로 대표 자동 승계, 마지막 소속이면 첨부 실파일과 선적 삭제) → Case 원본 실파일 →
  느슨한 `sp_file` 행 + `sp_bom_quote` 삭제 순이다. 최종 DB 트랜잭션은 Case 부모 행을
  `FOR UPDATE`로 잠그고 선적 대표/소속이 없는 PO만 먼저 지운 수가 프리뷰와 정확히 같을 때
  감사행(일반 모드)·파일행·Case 삭제를 확정한다. 이 잠금 직전 다른 선적 소속이 끼면 409로
  전체 DB 구간을 롤백하므로 다른 Case의 공유 선적을 cascade하지 않는다. Quote FK cascade가 분석·검색 artifact/
  trace·품목/후보/선택·RFQ/회신을 제거한다. 엔진/파일 404와 앞선 부분 성공은
  멱등 재시도로 취급한다. 공유 파트너·부품 카탈로그·공급사 오퍼는 Case 소유가 아니므로
  삭제하지 않는다.
- **외부 행위**: 발송 이메일은 회수할 수 없고 외부 공급사 장바구니/단일사용 링크도 외부에
  남을 수 있다. 프리뷰가 `SENT_EMAILS_REMAIN`/`EXTERNAL_ACTIONS_REMAIN`을 명시하며,
  어느 삭제 모드도 외부 시스템의 기록 소거까지 보장하지 않는다.

### 6.15 선적 리스트 · 실물 포장 QR 추적 — D24 (2026-08-02)

협력사가 보내는 부품을 문서에서 끝내지 않고 입고·검수·보관·자재 출고까지 같은 식별자로
추적한다. Commercial Invoice는 통관·금액 문서이고 품목 행을 자유롭게 편집할 수 있으므로,
QR 정본은 Invoice JSON이 아니라 선적에 담긴 불변 발주 품목(`sp_bom_po_item`)이다.

| 결정  | 내용                                                                                                                                                                                                      | 이유                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D24-1 | QR 1개 = 저항 한 알이 아니라 **릴·트레이·튜브·봉투·박스 등 실물 취급 단위 1개**. 발주 품목은 최대 20개 포장으로 나누며 각 포장 수량 합계는 발주 수량과 정확히 같아야 한다.                                | 소형 부품 낱알 라벨은 현실적으로 인쇄·스캔할 수 없고 실제 창고 이동 단위와도 다름 |
| D24-2 | 식별 정본 = `sp_bom_shipment_item`(선적×PO 품목 UNIQUE) + `sp_bom_part_package`. 최초 저장 때 256-bit 불투명 token과 수기 조회용 `PKG-…` labelCode를 발급하고 재인쇄해도 바꾸지 않는다.                   | QR 재인쇄·문서 revision과 실물의 동일성을 유지하고 순번/MPN 재사용 충돌을 제거    |
| D24-3 | `partId`는 최초 선적 리스트 저장 시 명시적으로 연결된 견적 부품 ID만 스냅샷한다. 없으면 MPN으로 추측해 채우지 않는다.                                                                                     | BOM 역할 경계와 잘못된 카탈로그 품목 연결 방지                                    |
| D24-4 | 상태 = `prepared → received → inspected → stored → issued`, 포장 제거는 `voided`. `sp_bom_part_event`에 created/updated/printed/received/inspected/stored/issued/voided를 append-only로 기록한다.         | 현재 위치뿐 아니라 누가 언제 무엇을 처리했는지 추적                               |
| D24-5 | QR URL은 `/app/admin/smartbom/packages/:token`으로 가지만 token은 권한이 아니다. 조회·상태 변경 API는 관리자 JWT를 요구하고, 협력사 Packing List API는 매 요청 서버에서 자기 조직 선적 소유권을 판정한다. | 인쇄물·사진으로 QR이 유출돼도 익명 재고 조회/변조를 허용하지 않음                 |
| D24-6 | 국제·국내 모두 최초 발송 전이 전에 **저장 완료된 Packing List가 필수**다. 선적 소속 전 품목과 수량을 다시 검증한 뒤 진행하며, 진행 후 편집은 잠그고 같은 QR 재인쇄만 허용한다.                            | 문서 누락·부분 저장·발송 후 QR 바꿔치기 방지                                      |

- **데이터**: migration `20260802150000_add_bom_part_package_tracking`이
  `sp_bom_shipment`에 packing revision/수정·확정시각을 추가하고
  `sp_bom_shipment_item` → `sp_bom_part_package` → `sp_bom_part_event` 3단계를 만든다.
  선적 또는 PO 품목 삭제 시 FK cascade로 QR와 이벤트가 함께 제거된다.
- **파트너 흐름**: `/partner/ship` 발송 카드의 [선적 리스트]에서 포장 수량·LOT·DATE CODE를
  나누어 저장 → QR이 포함된 A4 Packing List와 별도 부착 라벨 시트를 인쇄 → 국제는
  Invoice와 출고예정일, 국내는 택배사·송장번호와 함께 다음 단계 진행. 포털은 자기 선적만
  `GET/PUT/POST …/partner/shipments/:shipmentId/packing-list[/print]`로 접근한다.
- **관리자 흐름**: 선적 모달에서 대리 작성·재인쇄할 수 있고, `/app/admin/smartbom/logistics`
  상단에 QR 리더기 키보드 입력 또는 `PKG-…` 수기 조회 진입점을 둔다. 휴대폰 카메라는 QR의
  관리자 상세 URL로 곧바로 이동한다. 상세 화면에서 부품/PO/Case/협력사/LOT/DATE/수량을
  대조하고 입고→검수→위치 저장→자재 출고를 기록한다.
- **기존 입고와 정합**: 선적 단위 [입고 확인]은 아직 `prepared`인 해당 선적 QR 포장만
  `received`로 함께 올리고 이미 검수·보관·출고된 포장은 내리지 않는다. PO를 준비 중 박스에서
  빼면 이미 인쇄한 QR을 `voided` 처리한다.
- **Case 하드 삭제 정합**: §6.14 프리뷰·완료 결과가 선적 품목/QR 포장/추적 이벤트 수를
  별도로 표시하고 이를 previewToken revision에 묶는다. 공유 선적에서 대상 PO만 하드 삭제할
  때는 중간 `voided` 이력을 만들지 않고 PO 품목 cascade로 완전히 제거해 `reset` 의미를 지킨다.

### 6.16 관리자 견적 품목 교체 — D25 (2026-08-02)

관리자 Case 상세의 품목 표에서 엔진 추천 후보와 전체 부품 카탈로그를 검색해 견적 품목을
교체한다. 협력사에 이미 보낸 RFQ가 현재 견적 품목을 ID로 참조하므로 일반 변경은 업무가 갈라지기
전으로 제한하되, 관리자는 영향 범위를 확인하고 기존 회신을 명시적으로 무효화하는 강제 변경을 할 수 있다.

| 결정  | 내용 | 이유 |
| ----- | ---- | ---- |
| D25-1 | 일반 교체는 `requested|reviewing` + build `ready` + enrich 비실행이며 RFQ·장바구니·주문·PO가 없는 품목이다. 관리자는 업무 영향 체크 후 `force=true`로 상태·RFQ·주문·PO 제한을 넘을 수 있다. | 정상 경로는 단순하게, 예외 교정 권한은 관리자에게 제공 |
| D25-2 | 강제 변경은 대상 품목의 `sp_bom_rfq_item` 회신을 무효화하고 영향 RFQ를 `requested`로 되돌린다. RFQ ID·요청 범위·매직링크는 유지해 협력사가 같은 링크에서 새 부품으로 재회신한다. | 옛 회신 가격을 새 부품 가격으로 오인하지 않으면서 요청 연속성 유지 |
| D25-3 | 서버가 견적→품목→RFQ 순서로 잠그고 상태·RFQ·주문·PO·낙관적 버전(`expectedQuoteUpdatedAt`)을 다시 검사한다. stale 화면과 build/enrich 실행 중 상태는 강제로도 우회하지 않는다. RFQ 발송·회신도 같은 부모 견적 잠금으로 직렬화한다. | 새 RFQ/회신과 강제 변경의 경쟁 조건 방지 |
| D25-4 | 요청은 후보 키 또는 영속 `partId`와 공급사·SKU만 받는다. 가격·재고·주문수량·합계는 서버의 후보/카탈로그 원장에서 다시 계산한다. | 클라이언트 표시값 신뢰 금지 |
| D25-5 | 성공 시 `selectionSource=admin`, 선택 이벤트 `source=admin`, 일반 이유 `admin-choice` 또는 강제 이유 `admin-force-choice`를 남긴다. 기존 확정가를 해제하고 완료·고객회신 상태는 `reviewing`으로 되돌린다. 주문·PO 문서는 생성 당시 스냅샷을 보존한다. | 변경 감사·재확정과 과거 거래 문서 불변을 동시에 보장 |

- **화면**: `/app/admin/smartbom/cases/:id` 품목 행의 [부품 검색·변경]은 모든 행에서 검색
  패널을 열며, RFQ·주문·PO가 있어도 추천 후보·전체 카탈로그·구매조건 비교까지 허용한다. 적용
  가능 행은 기존/신규 품번·구매조건·행 금액 차이를 2차 레이어로 확인한다. 업무 진행 행도 적용
  CTA를 제공하되 RFQ 수·무효화 회신 수·주문·PO 스냅샷·상태 회귀 영향을 붉은 경고와 체크로 확인한
  뒤 [강제 변경 적용]을 누른다.
- **API**: `POST /api/admin/bom-quotes/:id/items/:itemId/selection`. 후보 선택과 카탈로그
  선택을 판별한 명령 계약이며 성공 시 재계산된 관리자 견적 상세를 반환한다.
- **데이터**: 기존 `sp_bom_quote_item`, `sp_bom_quote_selection_event`와 JSON 근거를 재사용한다.
  신규 테이블·컬럼이 없어 DB 마이그레이션은 없다.
- **검증**: 상태·버전·강제 우회·RFQ 범위·요청 계약 정책 6케이스와 API 전체 601건 통과(통합환경 29건 제외),
  8개 워크스페이스 typecheck/lint 및 sp-node·sp-vue production build 통과. 로컬 Case #537의 RFQ
  포함 `12pF` 행에서 카탈로그 검색→구매조건→강제 변경 확인 레이어까지 확인했다. 영향 RFQ 2건이
  표시되고 영향 확인 체크 전에는 [강제 변경 적용]이 비활성, 체크 후 활성화됨을 검증했으며 실제
  변경 요청은 전송하지 않았다.

### 6.17 관리자 견적 품목 추가·수동 행 제거 — D26 (2026-08-02)

관리자는 업로드를 다시 하지 않고 Case에 카탈로그 부품을 보충할 수 있다. 원본 BOM 감사성을
유지하기 위해 추가 행은 원본 분석 행과 분리하고, 제거도 관리자가 수동 추가한 행에만 허용한다.

| 결정 | 내용 | 이유 |
| ---- | ---- | ---- |
| D26-1 | 추가 명령은 영속 `partId`, 공급사·SKU, 세트당 `bomQty`, `expectedQuoteUpdatedAt`, `force`만 받는다. 서버가 현재 세트·예비 수량, 오퍼, MOQ·주문배수, 환율을 다시 읽어 주문수량·가격·합계를 계산한다. | 클라이언트 계산값 변조·오래된 가격 적용 방지 |
| D26-2 | 추가 행은 `sourceSheetIndex/sourceSheetName/analysisComponentId=null`, `selectionSource=admin`, 이유 `admin-add`로 저장한다. 원본 분석 행은 제거할 수 없고 수동 행만 하드 제거한다. | 업로드 원본과 운영 보충 행을 명확히 분리 |
| D26-3 | 일반 추가·제거는 D25와 같은 `requested|reviewing`, build ready, enrich 비실행, RFQ·주문·PO 무영향 조건을 사용한다. 관리자는 영향 체크 후 `force=true`로 업무 상태를 우회할 수 있지만 stale 버전과 build/enrich 실행 중 상태는 우회하지 못한다. | 변경 정책·경쟁 조건을 하나의 서버 가드로 유지 |
| D26-4 | 강제 추가 시 `requestedItemIds=null`인 동적 전체 RFQ만 새 행을 자동 포함하고 `requested`로 되돌린다. 기존 행별 회신은 유지하되 문서 합계·납기·메모를 해제한다. ID 배열인 부분 RFQ는 새 행을 자동 포함하지 않는다. | 전체 요청의 의미는 유지하면서 명시적 부분 요청 범위를 몰래 확대하지 않음 |
| D26-5 | 강제 제거 시 영향 RFQ의 해당 `sp_bom_rfq_item`과 부분 범위 ID를 제거한다. 남은 유효 범위가 있으면 `requested`, 없으면 `closed`로 두며 합계·납기·메모를 해제한다. 주문·PO는 발행 당시 스냅샷을 보존한다. | 삭제된 부품의 회신 재사용 방지와 과거 거래 문서 불변 보장 |

- **화면**: `/app/admin/smartbom/cases/:id` 품목 툴바의 [부품 추가]에서 세트당 BOM 수량을
  입력하면 필요수량이 즉시 바뀌고, 기존 카탈로그 검색·포장·공급사 오퍼 비교가 같은 수량을 쓴다.
  적용 전 2차 레이어가 부품·필요/주문수량·금액과 전체/부분 RFQ 영향을 구분해 보여준다. 수동 행에는
  [수동 행 제거]가 나타나며 영향 RFQ 회신 삭제·주문·PO 스냅샷 보존을 다시 확인한다. 관리자
  카탈로그 검색은 명시 검색마다 정확 MPN도 공급사 추가 확인까지 자동 수행하고 완료 전 선택을
  잠근다. 결과는 해당 검색 전 화면에 있던 부품, 그중 공급사에서 다시 확인된 부품, 새로 노출된
  공급사 후보를 각각 `기존 카탈로그 / 공급사 최신 확인 / 공급사 신규 발견`으로 그룹화한다. 수량
  편집은 외부 검색을 재호출하지 않으며 공급사 실패 시 로컬 결과를 사용할 수 있다.
- **API**: `POST /api/admin/bom-quotes/:id/items`,
  `DELETE /api/admin/bom-quotes/:id/items/:itemId`. 성공 시 모두 재계산된 관리자 견적 상세를 반환한다.
- **데이터**: 기존 nullable `sp_bom_quote_item` 원본 연결 필드와 선택 이벤트·RFQ 관계를 재사용한다.
  신규 테이블·컬럼이 없어 DB 마이그레이션은 없다.
- **검증**: 추가·제거 strict 계약, force 기본값, 동적 전체/부분 RFQ 범위 정책을 포함한 sp-node
  전체 604건 통과(통합환경 29건 제외), 8개 워크스페이스 typecheck/lint와 sp-node·sp-vue
  production build 통과. 공유 로컬 Case 데이터를 보존하기 위해 실제 추가·삭제 요청은 전송하지
  않았으며 브라우저 실화면 E2E는 후속 검증 대상으로 남겼다.

### 6.18 협력사 견적서 · 선적 거래명세서 — D27 (2026-08-02)

파트너 포탈과 관리자 선적·배송이 서로 다른 문서를 만들지 않고 같은 서버 문서 원본을
조회·인쇄한다. 고객에게 SamplePCB가 발행하는 BOM 견적서와 달리 두 문서는 **협력사가 공급자,
SamplePCB가 공급받는 자**다.

| 결정 | 내용 | 이유 |
| ---- | ---- | ---- |
| D27-1 | 협력사 견적서는 `PO 1건당 1건`(`PQT-SPB-{poId}`)이다. 묶음 선적도 포함 PO마다 견적서를 각각 제공하며 선적 기준으로 재합산하지 않는다. | 견적은 선적 전에 수락된 거래 조건이고 PO가 그 불변 경계 |
| D27-2 | 거래명세서는 `선적 1건당 1건`(`STMT-SPB-{shipmentId}-R{packingRevision}`)이다. 묶인 PO·Case를 한 문서에 표시하되 행마다 PO와 Case를 남긴다. | 실제 한 박스에 들어간 물품과 문서 범위를 일치 |
| D27-3 | 견적서 품목·가격·납기·MOQ·재고·Date Code·리드타임·회신 메모는 PO 발행 순간 `sp_bom_po*`에 복사하고 `quotationData` JSON에 발행자·수신자까지 스냅샷한다. 기능 도입 전에 발행된 PO는 GET에서 DB를 바꾸지 않고 불변 PO 거래조건과 현재 조직 사업자정보로 렌더링한다. | 신규 문서는 재회신·기준정보 변경의 소급 영향을 막고, 기존 문서 조회도 무부작용 원칙 유지 |
| D27-4 | 거래명세서 수량은 저장된 Packing List의 활성 포장 수량 합계이며, 없으면 발주수량을 쓰되 `초안`으로 표시한다. Packing List가 확정되면 그 revision·포장·PO 스냅샷이 불변 원본이므로 별도 중복 원장을 만들지 않는다. | QR 추적 원장과 거래 문서 수량 불일치 방지 |
| D27-5 | 협력사 견적서·거래명세서는 국내 협력사(`country=KR`)의 국내 거래 문서이며 공급가액과 VAT 10%를 분리한다. 국제 통관 문서는 D23 Commercial Invoice를 사용한다. | 국내·국제 세금/통관 문서 의미 분리 |
| D27-6 | `sp_partner`에 사업자번호·대표자·우편번호·사업장주소·업태·종목·팩스를 조직 단위로 저장한다. 계정별 회원 프로필에서 임의 추론하지 않는다. | 다계정 조직에서도 공식 발행자정보가 하나여야 함 |

- **화면**: **국내 발송에서만** 파트너 발송 카드와 관리자 선적 모달의 [거래 문서]가
  나타나고 묶음 PO별 [견적서]와 선적별 [거래명세서]를 연다. 공용 A4 컴포넌트를 사용하므로
  양쪽 내용·인쇄 결과가 같다. 두 문서의 인쇄 여부는 발송 필수 조건이 아니다.
- **API**: 다음 조회 API도 국내 거래만 허용한다. 파트너는 소유권을 재검증하는
  `GET /partner/pos/:poId/quotation`, `GET /partner/shipments/:shipmentId/statement`, 관리자는
  `GET /admin/bom-pos/:poId/quotation`, `GET /admin/bom-shipments/:shipmentId/statement`를 쓴다.
- **데이터**: migration `20260802190000_add_bom_trade_documents`. 고객 BOM 견적서 모델·API와
  기존 Commercial Invoice JSON/첨부는 삭제하지 않으며 국외 발송에서만 사용한다.
- **검증**: 로컬 migration 적용, sp-node 608건 통과(통합환경 29건 제외), 공용 계약·sp-node·
  sp-vue typecheck/lint와 production build 통과. 관리자 파트너 사업자정보 모달을 실제 Chrome에서
  확인했고 콘솔 오류가 없었다. 로컬 DB에 선적 fixture가 없어 문서 버튼 실데이터 E2E는 수행하지 않았다.

### 6.19 빠른 메일 보내기 (2026-08-02, 사용자 제안)

진행현황·견적관리 리스트에서 Case 맥락의 수동 CS 메일 — 자동 알림(전이 트리거)만
있던 갭을 메운다. 결정 2건: **발송 이력 저장**(sp_mail_log — CS 기록, Case 상세
'보낸 메일' 표시는 후속) / 수신 대상=**고객만**(mb_email 프리필, 자유 수정 —
협력사 연락은 기존 자동 메일·매직링크가 담당).

- **진입점 3곳**: 진행현황·견적관리 행 [✉] + Case 상세 헤더 [✉ 메일] → **우하단
  도킹 컴포즈 레이어**(Gmail 감성, 화면 이동 없음). 1차는 페이지 내(라우트 이동 시
  닫힘) — 전역 유지·최소화는 후속.
- **템플릿**: sp_mail_template(migration `20260802120000` 추가 전용) — 컴포즈 안에서
  선택 적용·[현재 내용 저장]·삭제(별도 관리 화면 없음). **변수 치환은 클라 몫**:
  {고객명}(mb_name, 없으면 mbId) {Case번호} {Case제목} {확정금액} — 서버는 받은
  그대로 발송.
- **발송**: POST /admin/bom-quotes/:id/quick-mail(multipart: to·subject·body+files)
  — 본문 플레인 텍스트를 기존 알림 메일과 같은 HTML 카드 셸에 담아 SMTP(sendMail
  attachments 확장). 첨부 = 이미지+PDF 화이트리스트, 개당 10MB·합계 20MB(클라 선검증
  +서버 재검증). 프리필 = GET …/quick-mail-context(mb_email·mb_name).
- **이력**: sp_mail_log(quoteId·수신자·제목·본문·첨부 메타·sentBy) — FK 없는 참조
  (Case 삭제 후에도 로그 보존), 실파일은 보관하지 않음(메일로만), 발송 성공 시에만
  기록.
- E2E 11케이스(템플릿 생성·목록·삭제/컨텍스트/발송 200+Mailpit 실수신·첨부·HTML 셸/
  이력 정합/비허용 형식 400/수신자 형식 400) ALL PASS.

### 6.20 국내·국외 발송 프로세스 분리 — D28 (2026-08-02)

파트너 조직의 `country`를 실제 발송 출발국과 같은 개념으로 확정했다. 별도 출발국 필드나
관리자 수동 모드 선택을 두지 않으며, 국내 거래 문서와 국제 통관 문서가 한 화면·API에서
섞이던 D22/D27 초기 구현을 바로잡는다.

| 결정 | 내용 | 이유 |
| ---- | ---- | ---- |
| D28-1 | 서버가 협력사 국가를 정규화해 `KR=domestic`, 그 외 등록 국가=`international`로 결정하고 선적 생성 시 박제한다. 국가 미입력은 국제로 추측하지 않는다. 관리자 요청 계약에서 `mode`를 제거하고 화면은 국가·파생 구분을 읽기 전용으로 표시한다. | 화면 기본값이 서버 결정을 덮던 결함 제거, 서버 단일 진실 유지 |
| D28-2 | 승인된 사람 협력사에는 ISO 2자리 국가가 필수다. 관리자 생성·수정·승인과 PO 발행·신규 발송이 각각 서버에서 재검증한다. 레거시 승격 시드는 국가를 추측하지 않고 `pending`으로 생성한다. | 다음 초기 운영 세팅과 직접 API 호출에서도 누락 차단 |
| D28-3 | 국내는 `배송 준비 → 배송 중 → 입고 완료` 3단계다. 최초 진행에 Packing List·QR, 택배사, 송장번호가 필수이고 견적서·거래명세서는 국내에서만 선택적으로 인쇄한다. Invoice·AWB·출고예정일은 노출하거나 새로 저장하지 않는다. | 국내 택배 실무에 필요한 최소 절차 |
| D28-4 | 국외는 기존 `선적 준비 → 선적 요청 → 선적 → 국내도착 → 통관 → 완료` 6단계를 유지한다. Packing List·QR, 출고예정일, Commercial Invoice, AWB 흐름도 유지하며 국내 견적서·거래명세서는 제공하지 않는다. | 기존 국제 통관 프로세스 회귀 방지 |
| D28-5 | 국내 최종 상태는 일반 상태 저장으로 진입할 수 없고 관리자 [입고 확인] 전용 API만 사용한다. 선적 `delivered`·`receivedAt`과 아직 `prepared`인 QR 포장의 `received` 이벤트를 한 DB 트랜잭션으로 커밋한다. | 파트너 화면 완료와 관리자 입고 큐·실물 추적 원장 불일치 방지 |
| D28-6 | 기존 선적은 기록 보존을 위해 자동 재분류하지 않는다. 감사 스크립트의 `--apply`도 국가가 등록돼 있고, `preparing`이며 발송·Invoice·첨부·Packing List·QR 기록이 전혀 없는 모드 불일치만 변경한다. | 진행 중·완료 물류 기록의 의미를 소급 변경하지 않음 |

- **업무 화면**: 파트너 [보내기]는 국내에 `QR·택배 정보`, 국외에
  `QR·Invoice·출고예정일`을 안내한다. 발송 카드와 관리자 모달은 Packing List를 공통으로,
  국내 거래 문서 또는 국외 Invoice/AWB를 상호 배타적으로 표시한다. 관리자 국내 최종 CTA는
  일반 [진행]이 아니라 [입고 확인]으로 연결된다.
- **API 방어**: 국내 선적의 Invoice/AWB 업로드 및 Commercial Invoice 초안·저장·엑셀을
  거부하고, 국외 PO/선적의 협력사 견적서·거래명세서 조회는 제공하지 않는다. 과거 잘못 첨부된
  실파일·JSON은 하드 삭제하지 않고 현재 응답에서만 숨긴다.
- **기존 데이터 감사**:

  ```bash
  pnpm --filter api run smartbom:audit-shipment-modes
  pnpm --filter api run smartbom:audit-shipment-modes -- --apply
  ```

  첫 명령은 항상 읽기 전용이다. 두 번째도 위 안전 조건을 만족한 불일치만 보정하며 국가 미입력과
  진행 중 선적은 보고만 한다. 2026-08-02 로컬 감사에서는 승인 협력사 국가 누락 7건, 그 조직의
  기존 선적 3건을 확인했고 국가를 추측할 수 없어 **변경 0건**으로 보존했다.
- **데이터 모델**: 기존 `sp_partner.country`, `sp_bom_shipment.mode/receivedAt`, QR 원장을
  재사용하므로 신규 DB 스키마 마이그레이션은 없다.

## 7. 레거시 교훈 승계 가드

- 수동값 보호: `source='manual'` 행은 자동 동기화 불가침(레거시는 24h sync가 대리 입력을 덮음).
- 조회 무부작용: GET이 행 생성/UPDATE를 유발하지 않는다(레거시 비교탭 gotcha). ensure류는 명시 POST.
- 파생 표시 vs 박제 확정 분리(snapshot-freeze): 후보·회신 표시는 원장 파생, 선정 시에만 박제.
- 상태 계층 분리: quote.status ↔ RFQ status ↔ (2차) 발주 status — 같은 문자열 겹침 금지.
- mbId는 문자열 조인 키(FK 금지), 코드 사전은 api-contract 단일 정본, 라우트·메뉴·i18n 동시 추가.

## 8. 시안(.tmp/Sample PCB 관리자 화면 260729.html) 채택/조정 기록

**채택**: Case 단일 척추·12단계 타임라인 표시·운영 메뉴 단순화(업무영역별) — 기존 결정과 동형 /
진행현황 목록 형식(요약 카드+필터 탭+현재단계+인라인 액션) / 품목×파트너 매트릭스 비교 +
[품목별 최저가 일괄 선정] / 파트너 기준정보(유형·통화·상태, 공급사·사람 동거 = sp_partner와 일치) /
연결 문서 레지스트리 / RFQ 응답률 지표(후속) / Case 표시 채번.

**조정**: ① 12단계는 고정 상태머신이 아니라 **파생 표시 타임라인**(상태 계층에서 계산 — 경직 회피)
② 공급사 "회신 등록"은 수동이 아니라 **오퍼 원장 자동 파생 + [전체 회신 업데이트]=백그라운드 잡**
③ 모듈 스위처는 **2모듈(통합 관리·스마트 BOM)로 시작**, 4영역(PCB·PCBA·기술개발)은 자리만 —
기존 메뉴 재배치는 각 모듈이 실제로 생길 때.
