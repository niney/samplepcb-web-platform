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
| D16 | 주문·결제(2차 확정) | 확정가(confirmedTotal) 있는 answered 견적만, 견적 전체 1건 = 영카트 주문 1건, 카트 금액 = 확정가×1.1(부가세 포함 총액 — 거버 방식). 상세 §6 |

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

**견적관리 통합(Phase A — ✅ 구현 완료)**: `/shop/quotes`(quotes.php)에 [PCB 견적]·
[부품 BOM 견적] 탭 — BOM 탭은 같은 셸 패턴(JS→sp-node `/api/bom`)으로 목록 렌더 +
[견적 보기]=`/app/bom/:id` 이동, answered+확정가 건 [주문하기]. `#bom` 해시 딥링크 지원.
CSS 는 default_shop.css 견적관리 섹션 + `G5_CSS_VER=26072901` 범프.

**후속(범위 밖)**: ⑦ 협력사 발주서 + 외부공급사 자동화(Mouser=카트 담기 CartKey,
DigiKey=third-party 리스트 URL — supplierCode 라우팅, 하드코딩 mbNo 없음) · **3차 물류**
= 선적 그룹 모델(D13, 발주 스키마에 선적 참조 금지가 유일한 선행 제약).

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
