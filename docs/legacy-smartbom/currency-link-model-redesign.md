# PCB 다중통화 — "링크별 결제 통화" 전면 재설계 계획서

> 이 문서는 **무맥락(컨텍스트 비움) 상태에서 그대로 실행**할 수 있도록 작성되었다.
> 읽는 순서: §0 환경 → §1 배경/결정 → §2 목표 모델 → §3 데이터 모델 → §4 설정 → §5 백엔드 → §6 프론트 → §7 DDL/마이그레이션 → §8 빌드순서/검증 → §9 부록(현재 코드 인벤토리).
> 작성: 2026-06-20. 대상: `sp-smartbom-web`(프론트) + `samplepcb_xpse`(백엔드).

---

## §0. 환경 / 실행 정보 (필수 선행지식)

- **프론트 repo**: `D:\work\workspace_other\sp-smartbom-web` (Vue 3 + TS + Vite + Tailwind v4). 브랜치 `feat/pcb-shipment-group`.
- **백엔드 repo**: `D:\work\workspace_other\samplepcb_xpse` (Spring Boot + JPA, coolib `CCResult`/`CCObjectResult`/`CCPagingResult`). 브랜치 `feat/pcb-shipment-group`.
- **DB**: 그누보드 기반 구버전 MySQL. `sp_pcb_partner_order(_document)` 등은 **MyISAM**(트랜잭션/롤백 없음, `ADD COLUMN(+DEFAULT)`만 안전). DDL은 **사용자가 수동 적용** (코드가 마이그레이션 자동 실행 안 함).
- **인증**: 프론트 `authFetch`(`src/services/fetchService.ts`)가 `sessionStorage['smartbom_token']` Bearer 사용. 백엔드 `@JwtAuth` + `@AuthenticationPrincipal JwtUserPrincipal`(`getMbLevel()==10` 관리자, `getMbNo()`).
- **API base**: 프론트 `import.meta.env.VITE_SEARCH_SERVER_URL` = `http://localhost:8081` (xpse). 레거시 PHP는 `VITE_SAMPLEPCB_URL`.
- **검증 명령**:
  - 백엔드: `cd /d/work/workspace_other/samplepcb_xpse && ./gradlew.bat compileJava -q` (경고 3개는 기존 MapStruct, 무시).
  - 프론트: `cd /d/work/workspace_other/sp-smartbom-web && npx vue-tsc -b --force --pretty false` (EXIT=0 이면 통과).
- **브라우저 점검**: 로컬 앱 `https://local.samplepcb.co.kr/smartbom/...` (Vite dev, HMR). 직접 URL 진입은 인증 타이밍으로 기본 페이지 리다이렉트 → **메뉴 클릭(SPA)으로 진입**. 관리자 전용 화면은 관리자 계정 로그인 필요(설정 톱니바퀴/‘PCB 검토’ 메뉴 유무로 관리자 여부 판별).
- **관련 정본 문서/메모리**: doc/master-dealer*.md, doc/shipment-group.md, 메모리 `project_pcb_usd_currency`, `pcb-partner-order-3-project-flow`, `project_pcb_shipment_group`, 스킬 `master-dealer-context`.

### ⚠️ 이 재설계가 대체하는 것 (중요)
직전 커밋 **프론트 `b287490` / 백엔드 `1019394`** = "USD 정본 + 부화폐(위안화 CNY) 보조" 기능. 이 재설계는 그 **"USD 단일 정본 / 주·부화폐(멤버 속성)" 프레임을 폐기**한다. 단, 그때 만든 **입력 보조(¥ 입력→환산) 로직과 `utils/currency.ts` 표시 헬퍼는 "입력 통화" 조각으로 재활용**한다. (전부 버리는 게 아니라 의미 재배치.)

---

## §1. 배경 · 문제 · 확정 결정

### 1.1 문제
기존 모델은 **"체인 전역 단일 정본 = USD"**를 가정했다. 그런데 실제 거래 구조는:

| 링크(인접 두 당사자) | 결제 통화 |
|---|---|
| 고객 ↔ 관리자 | KRW |
| 관리자 ↔ 협력사(직속) | USD |
| 관리자 ↔ 마스터딜러(MD) | USD |
| **마스터딜러 ↔ 협력사** | **CNY(위안화)** |

→ **같은 협력사라도 관리자와는 USD, MD와는 CNY로 결제.** 즉 결제 통화는 "협력사(멤버) 속성"이 아니라 **"관계(링크) 속성"**이다. USD 단일 정본은 MD↔협력사 CNY 결제(시나리오 3)에서 ¥ 금액이 USD 역산 반올림으로 **드리프트**되는 문제를 낳는다.

### 1.2 현업 원칙 (이 설계의 근거)
1. **한 링크 = 한 통화.** 그 링크의 견적/발주/인보이스/결제가 모두 그 통화. 각 당사자는 자기 통화만 보고 **환율을 직접 보지 않는다.**
2. **환율은 링크와 링크의 "변환점"에만 등장하고 그 시점에 박제**된다. 변환을 하는 중개자의 내부 회계·의사결정용 숫자.
3. **변환 시 마진을 얹는다 = 이익 + 환변동 버퍼.** 통화 미스매치(살 때≠팔 때 통화)를 가진 중개자가 환위험 보유.
4. 결제는 견적 통화로 → 공급자는 견적한 금액을 그대로 받는다(드리프트 0).

### 1.3 확정 결정
- **방향: A (클린 한방 전면 재설계).** 단계적(B) 아님. 한 번에 링크별 통화 모델로.
- **#2 입력 통화 ≠ 결제 통화: 지원한다(추천 확정).**
  - **결제 통화가 정본(구속력).** 입력 통화는 **멤버별 입력/표시 편의**.
  - 입력 통화 ≠ 결제 통화면 **제출 시점에 박제 환율로 결제 통화 금액으로 환산**하고, 입력 원본(통화·금액·환율)은 **메모로 보존**.
  - 입력 통화 == 결제 통화면 변환 없이 그대로.
  - 근거: 협력사 ¥ 입력 습관 수용 + 계약은 결제통화로 명확 + 입력 환율 박제로 투명.

---

## §2. 목표 모델 (개념 + 용어집)

### 2.1 용어집
- **링크(link)**: 인접한 두 당사자(고객-관리자, 관리자-협력사, 관리자-MD, MD-협력사).
- **결제 통화(settlement currency)**: 링크가 실제 결제되는 통화. **링크 속성.** 가격의 정본 통화.
- **입력 통화(input/display currency)**: 당사자가 화면에서 입력·표시에 쓰는 통화. **멤버 속성.** 결제 통화와 다르면 입력 시 박제 환산.
- **노드(node)**: 한 당사자의 가격(견적가/발주가). 항상 그 링크의 **결제 통화 + 금액**으로 저장.
- **변환점(conversion/edge)**: 선정(견적 확정)·발주에서 하위 통화 → 상위 통화로 넘어가는 지점. **환율 + 마진 + 결과를 박제.**
- **마진(margin)**: 중개자가 변환 시 얹는 비율. MD 마진, 관리자 마진.

### 2.2 모델 한 장 요약
```
[노드]  (결제통화, 금액)               ← USD 고정 아님. 링크별로 KRW/USD/CNY
[변환점] from(통화,금액) → 박제환율 → 마진 → to(통화,금액)   ← 선정/발주에서만
```
- 견적/발주 행의 결제 통화는 **그 행의 상위(parent_mb_no)로 링크를 식별해 설정에서 결정**한다.
  - `parent_mb_no == 0` → 관리자↔협력사 링크 → 결제통화 = 협력사의 `관리자 거래 통화`.
  - `parent_mb_no == MD` → MD↔협력사 링크 → 결제통화 = `sp_master_dealer_partner` 매핑의 결제통화.
- 고객 KRW는 **관리자의 최종 선정 1지점에서만** 박제(USD/그 상위통화 → KRW + 관리자 마진) 후 g5_shop_*로 전파.

### 2.3 시나리오별 흐름

**시나리오 1 — 고객↔관리자 직접 가격설정 (RFQ 없음)**
- 전부 KRW. 변환 없음. (현행 `byItId/{itId}/sellPrice` 유지. 통화 무관.)

**시나리오 2 — 고객↔관리자↔협력사 (협력사 입력 ¥, 관리자↔협력사 결제 USD)**
```
협력사 입력 ¥7,200  ──(입력≠결제: ¥→USD 박제)──▶  [협력사 노드] 결제 USD, $1,000.80
                                                     input: CNY ¥7,200 @rate (메모)
   │ 관리자 선정: USD→KRW 박제 + 관리자 마진(=관리자가 입력하는 최종 판매가)
   ▼
[고객] ₩  (g5_shop_item/cart/order에 박제 전파)
```
→ 여기선 ¥가 진짜 "입력 보조". 결제통화=USD. (직전 부화폐 구현과 사실상 동일 동작.)

**시나리오 3 — 고객↔관리자↔MD↔협력사 (MD↔협력사 결제 CNY)**
```
협력사 입력 ¥7,200  ──(입력==결제 CNY: 변환 없음)──▶  [협력사 노드] 결제 CNY, ¥7,200
   │ MD 선정: CNY→USD 박제 + MD 마진(예 8%)
   ▼
[MD 노드] 결제 USD, $1,050  (source: CNY ¥7,200 @0.1389, margin 8%)
   │ 관리자 선정: USD→KRW 박제 + 관리자 마진
   ▼
[고객] ₩1,500,000
```
→ 협력사는 ¥7,200을 그대로 받는다(드리프트 0). 환위험: CNY/USD는 MD, USD/KRW는 관리자.

### 2.4 환율/마진/환위험 규칙
- 노드 안에는 환율 없음(단일 통화). 환율은 변환점에만, **선정/발주 시점 박제**.
- 변환점마다 마진(MD 마진 / 관리자 마진). 관리자 마진은 현행처럼 "최종 판매가 직접 입력"으로 흡수 가능(명시 비율 아님).
- 통화 미스매치를 가진 중개자가 환위험 보유 → 마진이 버퍼. 시스템은 **박제 환율·마진·원본을 기록**(감사 추적)만.
- (선택) 견적 유효기간 개념은 범위 외(추후).

---

## §3. 데이터 모델 (old → new)

> 원칙: 기존 컬럼은 **의미 재정의 + 신규 컬럼 추가**로 간다(MyISAM ADD COLUMN). KRW 환산 정수 컬럼(`price`/`order_price`)은 **고객 전파/회계 보조**로만 의미 축소.

### 3.1 멤버 `g5_member`
| 컬럼 | old 의미 | new 의미 |
|---|---|---|
| `mb_currency` (VARCHAR3) | 'KRW'\|'USD' (거래 통화) | **관리자와의 결제 통화** 'KRW'\|'USD'\|'CNY' (값 CNY 허용으로 확장) |
| `mb_sub_currency` (VARCHAR3) | 부화폐 'CNY' | **입력/표시 통화** `mb_input_currency`로 의미 전환(또는 신규 컬럼 추가, §7 택1) 'KRW'\|'USD'\|'CNY', NULL=결제통화와 동일 |
| `@DynamicUpdate` | 적용됨 | **유지 필수** (zero-date 컬럼 NOT NULL 위반 방지) |

권장: 혼동 방지 위해 **신규 컬럼 `mb_input_currency` 추가**하고 `mb_sub_currency`는 deprecate(미사용). (마이그레이션에서 기존 mb_sub_currency='CNY' → mb_input_currency='CNY' 복사.)

### 3.2 MD-협력사 매핑 `sp_master_dealer_partner` (신규 컬럼)
| 컬럼 | 의미 |
|---|---|
| `settlement_currency` (VARCHAR3, NULL=기본 USD 또는 협력사 mb_currency 상속) | **MD↔이 협력사 링크의 결제 통화** 'USD'\|'CNY'\|'KRW' |

### 3.3 견적행 `sp_pcb_partner_order`
| 컬럼 | old | new |
|---|---|---|
| `currency` (VARCHAR3) | 'KRW'\|'USD' 견적통화 | **결제 통화**(=링크 통화, 박제) 'KRW'\|'USD'\|'CNY' |
| `price_original` (DECIMAL15,2) | 원본통화 금액(USD면 달러) | **결제 통화 금액(정본)** |
| `price` (INT) | KRW 환산가 | **KRW 환산 보조**(표시/회계용, 정본 아님). 결제통화가 KRW면 동일, 아니면 참고치/NULL 허용 |
| `exchange_rate` (DECIMAL10,2) | 선정 시 USD→KRW 박제 | **변환점 환율**: 이 노드를 만든 변환(하위→이 노드)의 환율. 관리자 직속 협력사는 NULL(변환 없음). |
| `sub_currency`/`sub_price_original`/`sub_exchange_rate` | 부화폐(¥) 원본·환율 | **입력 원본 메모**로 의미 전환: `input_currency`/`input_amount`/`input_rate` (입력≠결제 시 기록). 권장 신규 컬럼명 사용(§7). |
| `selected_sub_partner_order_id` (BIGINT) | MD 선정 하위 행 | 유지 (변환점의 source 노드 = 하위 견적행) |
| `margin_rate` (INT) | MD 마진% | 유지 (변환점 마진) |
| `parent_mb_no` (INT) | 0=관리자/그외=MD | 유지 (링크 식별의 핵심) |

신규 권장 컬럼(감사용, 변환 source 명시): `source_currency`, `source_amount`, `source_rate`(= exchange_rate와 통합 가능). MD 노드일 때 "¥7,200 @0.1389 ×(1+8%) = $1,050"를 복원 가능하게.

### 3.4 발주서 `sp_pcb_partner_order_document`
| 컬럼 | new 의미 |
|---|---|
| `order_currency` | **결제 통화**(링크 통화) 'KRW'\|'USD'\|'CNY' |
| `order_price_original` | **결제 통화 발주가(정본)** |
| `order_price` (INT) | KRW 환산 보조(회계, 정본 아님; 필요 없으면 NULL 허용) |
| `order_exchange_rate` | 변환점 환율(필요 시). MD↔협력사 동일통화 발주면 불요 |
| `order_sub_*` | `order_input_*`로 전환(입력≠결제 메모) |
| `parent_mb_no` | 유지 |

### 3.5 환율/설정 `g5_shop_default`
| 컬럼 | 의미 |
|---|---|
| `de_usd_exchange_rate` (DECIMAL10,2) | USD→KRW fallback |
| `de_cny_usd_exchange_rate` (DECIMAL12,6) | CNY→USD fallback |
| (신규 선택) `de_cny_krw_exchange_rate` | CNY→KRW fallback (MD↔협력사 CNY 발주의 KRW 회계 환산이 필요할 때만) |

### 3.6 환율 페어 매트릭스 (필요한 변환)
| 변환점 | 환율 페어 | 소스 |
|---|---|---|
| 협력사(¥ 입력) → 협력사 결제(USD) | CNY→USD | 한국수출입은행 AP01 CNH/USD 교차 + fallback |
| MD 선정: 협력사(CNY) → MD(USD) | CNY→USD | 동일 |
| 관리자 선정: MD/협력사(USD) → 고객(KRW) | USD→KRW | AP01 USD tts |
| (드묾) 협력사(CNY) → 고객(KRW) 직접 | CNY→KRW | 교차 or fallback |
- **환율 추상화는 "from→to" 일반화** 권장: `getRate(from, to)` 형태로 ExchangeRateService 확장(§5.2).

---

## §4. 설정 기능 재구성 (UI/저장)

"주/부 토글" 폐기 → **"관계별 결제 통화" + "당사자별 입력 통화"**로 분리. 링크가 관리되는 곳에 통화를 붙인다.

### 4.1 페이지 ① "거래 통화" (기존 `PartnerCurrencySetting.vue` 진화, `/settings/partner-currency`)
관리자 기준 직거래 통화 + 입력 통화를, 협력사·MD 한 목록에서.
| 컬럼 | 설명 | API |
|---|---|---|
| 대상(협력사/MD, 배지) | PHP `/api/partner?w=rpl` + `masterDealerPartners/masterDealers` 병합(현행 방식) | — |
| **관리자와 결제 통화** [KRW\|USD\|CNY] | `mb_currency` | `POST /partner/{mbNo}/currency {currency}` (CNY 허용 확장) |
| **입력 통화** [KRW\|USD\|CNY] | `mb_input_currency`(미설정=결제통화) | 신규 `POST /partner/{mbNo}/inputCurrency {currency}` |
- 배치 조회: `POST /partnerCurrencies {mbNos}` → `{mbNo: currency}` (CNY 포함하도록 확장), 입력통화는 `POST /partnerInputCurrencies` 신규 or 응답 enrich.

### 4.2 페이지 ② "마스터딜러 소속" (기존 `MasterDealerPartners.vue`에 컬럼 추가, `/settings/master-dealer-partners`)
각 MD의 하위 협력사 매핑마다 **MD와 결제 통화**.
| 컬럼 | 설명 | API |
|---|---|---|
| 하위 협력사명 | 기존 | — |
| **MD와 결제 통화** [KRW\|USD\|CNY] | `sp_master_dealer_partner.settlement_currency` | 신규 `POST /api/masterDealerPartners/{mdMbNo}/partner/{partnerMbNo}/currency {currency}` (관리자 전용) |
- 매핑 조회 API에 `settlementCurrency` 노출.

### 4.3 환율 설정 (기존 `ExchangeRateSetting.vue`, `/settings/exchange-rate`)
- USD→KRW + CNY→USD 카드 유지. (필요 시 CNY→KRW 카드 추가.)

### 4.4 SideNav/라우터
- 기존 설정 그룹 유지. "협력사 통화"는 "거래 통화"로 라벨/의미 갱신(라우트 동일 `/settings/partner-currency`).

---

## §5. 백엔드 변경 상세 (samplepcb_xpse, 파일별)

> 패키지 루트: `kr.co.samplepcb.xpse`. 모든 경로 `src/main/java/kr/co/samplepcb/xpse/...`.

### 5.1 엔티티
- `domain/entity/G5Member.java`: `mbCurrency` 값에 CNY 허용(코드상 자유, 검증만). 신규 `mbInputCurrency`(@Column `mb_input_currency`, length 3) + getter/setter. `@DynamicUpdate` 유지.
- `domain/entity/SpPcbPartnerOrder.java`: 컬럼 의미 재정의(주석). 신규(권장) `inputCurrency`/`inputAmount`/`inputRate`(또는 기존 sub_* 재사용), `sourceCurrency`/`sourceAmount`(감사). `currency`=결제통화, `priceOriginal`=결제금액.
- `domain/entity/SpPcbPartnerOrderDocument.java`: 동일하게 `orderCurrency`=결제통화, `orderInput*` 추가/전환.
- (신규) MD 매핑 엔티티에 `settlementCurrency` 추가 — 매핑 테이블 엔티티 찾을 것(`sp_master_dealer_partner`; 엔티티명 확인 필요, §9 부록).
- `domain/entity/G5ShopDefault.java`: 매핑 미생성(Repository native). 신규 CNY→KRW 컬럼 쓰면 Repository 쿼리만 추가.

### 5.2 환율 인프라
- `service/ExchangeRateService.java`: **from→to 일반화** 권장.
  - 추가: `BigDecimal getRate(String from, String to)` (KRW/USD/CNY 조합). 기존 `getUsdToKrwRate`/`getCnyToUsdRate`는 위임 유지(하위호환).
  - 교차: CNY→KRW = CNY→USD × USD→KRW.
- `service/ConfigExchangeRateService.java`: getRate fallback 구현 (g5_shop_default 값 조합).
- `service/KoreaEximExchangeRateService.java`(@Primary): AP01 1회 호출에서 USD·CNH tts 추출(이미 `fetchAp01Rows`/`extractTts` 있음) → getRate 구현. 당일 캐시(통화쌍별).
- `repository/G5ShopDefaultRepository.java`: 필요 시 CNY→KRW find/update 추가.
- `resource/ExchangeRateResource.java`: `GET /api/exchangeRate/rate?from=CNY&to=KRW` 일반 엔드포인트(관리자/로그인). 기존 `/usd`,`/cny` 유지.

### 5.3 핵심 서비스 — `service/SpPcbPartnerOrderService.java`
- **링크 통화 해석 헬퍼(신규)**: `resolveSettlementCurrency(parentMbNo, partnerMbNo)`:
  - parent==0 → member(partner).mbCurrency
  - parent!=0 → sp_master_dealer_partner(parent, partner).settlementCurrency (없으면 USD 기본)
- `updateQuote(...)`(현 ~362): 입력 통화로 받은 값을 **결제 통화로 환산(입력≠결제면 박제)** 후 `currency`=결제통화, `priceOriginal`=결제금액 저장. `price`(KRW)는 결제통화가 KRW일 때만 채우고 아니면 NULL/참고. 입력 원본은 input_* 보존.
- `select(...)`(현 ~451-481): 관리자 최종 선정. 상위 통화(보통 USD) → KRW 박제 + 관리자 판매가. `applySellPrice`는 KRW만 전파(현행 유지). 단 **소스 통화가 USD가 아닐 수도**(직속 CNY 협력사) 있으니 from=노드결제통화, to=KRW로 일반화.
- `saveMasterDealerSelection(...)`(현 ~850-932): **통화 일치 가드(`masterUsd==subUsd`) 폐기**. 대신:
  - 하위 노드 결제통화(=MD↔협력사 링크 통화, 보통 CNY) → MD 노드 결제통화(=관리자↔MD 링크 통화, 보통 USD)로 **변환 박제 + 마진**. `getRate(subCcy, mdCcy)` 사용.
  - MD 노드: `currency`=mdCcy, `priceOriginal`= subAmount × rate × (1+margin), source_* 기록.
- `getPartnerCurrencies`/`setPartnerCurrency`(현 ~785): CNY 허용. 신규 `getPartnerInputCurrencies`/`setPartnerInputCurrency`. (부화폐 전용 `getPartnerSubCurrencies`/`setPartnerSubCurrency`는 입력통화로 의미 전환 or 대체.)
- `resolveCurrency`(현 ~942)/`toDto`(현 ~952): 결제통화·결제금액·입력원본·partner 입력통화 노출로 갱신.

### 5.4 발주 서비스 — `service/SpPcbPartnerOrderDocumentService.java`
- `create(...)`(현 ~100-181): 발주가를 **링크 결제 통화**로 저장(`resolveSettlementCurrency(parentMbNo, mbNo)`). 입력≠결제면 환산 박제. KRW(order_price)는 회계 보조(필요 없으면 NULL). **USD 강제 환율 요구 가드 제거/완화** — 결제통화가 KRW가 아닐 때만 KRW 회계가 필요하고, 그건 선택. (MD↔협력사 CNY 발주는 환율 입력 불요.)
- `toDto`(현 ~798): order 결제통화·금액·입력원본 노출.
- SelectedSubPrep 매핑(현 ~641-654): 하위 결제통화/금액 + 하위 입력통화 노출(MD 재발주 화면용).

### 5.5 리소스 — `resource/SpPcbPartnerOrderResource.java`
- partnerCurrencies(CNY 허용)/partner/{mbNo}/currency. 신규 inputCurrency 배치/설정. (기존 subCurrency 엔드포인트 → inputCurrency로 전환 or 유지하며 의미 매핑.)

### 5.6 MD 매핑 리소스/서비스
- `resource`/`service` masterDealerPartners: 매핑에 settlementCurrency CRUD. `myPartnerSummaries`/`masterDealers` 응답에 settlementCurrency 포함.

### 5.7 DTO (pojo/) — 통화-인지로 전면 갱신
- `SpPcbPartnerOrderQuoteDTO`: 입력 통화/금액으로 받기(`inputCurrency`,`amount`) + 결제통화는 서버가 링크로 결정. (또는 프론트가 결제통화로 환산해 보내되 입력원본 동봉.)
- `SpPcbPartnerOrderDTO`/`ListDTO`: 결제통화/금액/입력원본/입력통화/partner입력통화/마진/source.
- `SpPcbPartnerOrderSelectDTO`: exchangeRate(상위통화→KRW)는 from/to 일반화.
- `SpPcbMasterDealerSelectDTO`: marginRate 유지, 통화 일치 전제 제거.
- `SpPcbPartnerOrderDocCreateDTO`/`DocDTO`: 결제통화/금액/입력원본.
- `SpPcbPartnerOrderDocDetailDTO.SelectedSubPrep`: 하위 결제통화/금액 + 하위 입력통화.

---

## §6. 프론트 변경 상세 (sp-smartbom-web, 파일별)

> 모든 경로 `src/...`. 공용 표시 헬퍼 `utils/currency.ts`는 **다통화 일반화**로 확장.

### 6.1 `utils/currency.ts`
- `formatAmount(amount, currency)`: USD/CNY 소수 2자리, KRW 정수.
- `moneyText(currency, amount)`: "$1,000.00" / "¥7,200" / "1,350원".
- `withInputMemo(settlementText, inputCurrency, inputAmount)`: 입력≠결제면 "$1,000.80 (입력 ¥7,200)" 병기.
- 기존 mainMoneyText/subMoneySuffix/moneyWithSub는 위로 흡수/대체.

### 6.2 입력 컴포넌트
- `views/PcbRfqDetail.vue`(협력사 견적입력): **입력 통화 = 협력사 input_currency**로 입력. 결제 통화(링크)와 다르면 환산 미리보기("≈ $1,000.80, 환율 ¥1=$0.139"). detail DTO에서 link 결제통화 + 협력사 입력통화 받음. 제출: 입력원본 + (서버가 결제통화 환산 or 프론트 환산값+원본 동봉).
- `components/pcb/PcbOrderModal.vue`(발주 공용): props를 **`settlementCurrency` + `inputCurrency`**로 재정의. 입력 통화로 입력, 결제 통화로 환산·박제. (기존 `currency`/`subCurrency`/`collapsibleRate` 정리: 적용환율 토글은 "상위 KRW 회계 환율"이 필요한 관리자 직접 발주에서만; MD↔협력사 동일통화 발주는 환율 자체가 없음.)
- `views/PcbReviewDetail.vue`(관리자): 견적현황/선정/발주. 선정 모달=상위통화→KRW 환율 + 판매가. 발주 모달에 settlement/input 통화 전달. `resolveOrderCurrency`는 링크 통화 조회로.
- `views/PcbPurchaseOrderDetail.vue`(MD 재발주): reorder 통화 = MD↔협력사 링크 통화(보통 CNY) → **CNY 발주 기본**, 하위가 ¥로 견적했으면 그 ¥ 금액 prefill. 상위(관리자↔MD) USD 회계 환율은 MD에 비표시(이미 collapsible 방향). SelectedSubPrep의 하위 결제통화/금액 사용.

### 6.3 표시 지점 (전 지점 링크 통화로)
- `types/pcbPartnerOrderDoc.ts`(`orderPriceText`), `views/PcbRfqHistory.vue`/`PcbPurchaseOrderHistory.vue`/`PcbRfqDetailMaster.vue` 의 가격 헬퍼를 `moneyText(settlementCurrency, amount)` + 입력원본 병기로 통일. (MD 그룹 KRW 1단계 한계 재검토.)
- `components/shipment/InvoiceEditorModal.vue`: 자유 입력 상업송장 — 결제통화 default를 링크 통화로 제안(자유 편집 유지).

### 6.4 설정 화면
- `views/PartnerCurrencySetting.vue` → "거래 통화"(§4.1): 관리자 결제통화(CNY 추가) + 입력통화 컬럼. (현 USD/KRW·부 CNY 토글 → 결제통화 3택 + 입력통화 3택.)
  - **다크모드 테이블 행 구분선은 `border-b ... dark:border-gray-700` 사용**(divide-y 다크변형 JIT 갭 있었음 — 교훈).
- `views/MasterDealerPartners.vue` → MD↔협력사 결제통화 컬럼(§4.2).
- `views/ExchangeRateSetting.vue`: 필요 시 CNY→KRW 카드.
- `components/SideNav.vue`: "협력사 통화"→"거래 통화" 라벨. (아이콘 `coins` 이미 main.ts 등록됨.)

---

## §7. DDL / 데이터 마이그레이션

> 신규 SQL: `samplepcb_xpse/src/main/resources/db/migration/alter_pcb_link_currency.sql`. MyISAM 안전(ADD COLUMN). 사용자 수동 적용.

### 7.1 스키마
```sql
-- 멤버: 입력 통화 분리 (결제는 기존 mb_currency 의미 확장)
ALTER TABLE g5_member ADD COLUMN mb_input_currency VARCHAR(3) NULL DEFAULT NULL;
-- (선택) mb_currency 'CNY' 허용은 코드 검증만, 컬럼 변경 불요

-- MD-협력사 매핑: 링크 결제 통화
ALTER TABLE sp_master_dealer_partner ADD COLUMN settlement_currency VARCHAR(3) NULL DEFAULT NULL;

-- 견적행: 입력 원본 + 감사(이미 sub_* 있으면 의미전환, 아니면 신규)
ALTER TABLE sp_pcb_partner_order
  ADD COLUMN input_currency VARCHAR(3) NULL,
  ADD COLUMN input_amount DECIMAL(15,2) NULL,
  ADD COLUMN input_rate DECIMAL(12,6) NULL,
  ADD COLUMN source_currency VARCHAR(3) NULL,
  ADD COLUMN source_amount DECIMAL(15,2) NULL;

-- 발주서: 동일
ALTER TABLE sp_pcb_partner_order_document
  ADD COLUMN order_input_currency VARCHAR(3) NULL,
  ADD COLUMN order_input_amount DECIMAL(15,2) NULL,
  ADD COLUMN order_input_rate DECIMAL(12,6) NULL;

-- (선택) CNY→KRW fallback
ALTER TABLE g5_shop_default ADD COLUMN de_cny_krw_exchange_rate DECIMAL(12,2) NOT NULL DEFAULT 190.00;
```
> 직전 부화폐 컬럼(`sub_currency`/`sub_price_original`/`sub_exchange_rate`, `order_sub_*`, `mb_sub_currency`, `de_cny_usd_exchange_rate`)은 **재사용 가능**. 신규 input_* 대신 sub_*를 의미전환해 써도 됨(컬럼 추가 최소화). 택1해서 일관되게.

### 7.2 기존 데이터 변환(데이터 마이그레이션 SQL, 1회)
- `mb_sub_currency='CNY'` → `mb_input_currency='CNY'` 복사(부화폐를 입력통화로).
- 기존 행 `currency`/`price_original`(USD 정본) → 그대로 결제통화로 유효(관리자↔협력사 USD 링크엔 정확). MD 하위 CNY 링크 과거 데이터는 사실상 없음(신규 기능). 손실 없음.
- MD 매핑 `settlement_currency`: NULL → 런타임에 USD 기본 처리.

---

## §8. 빌드 순서(A 한방 내부) · 검증

### 8.1 권장 빌드 순서
1. **DDL 작성**(`alter_pcb_link_currency.sql`) + 사용자 적용 안내.
2. **환율 from→to 일반화**(ExchangeRateService/Config/KoreaExim/Repository/Resource).
3. **엔티티**(G5Member input, MD매핑 settlement, 견적/발주 input/source).
4. **링크 통화 해석 헬퍼** + **서비스**(updateQuote/select/saveMasterDealerSelection/doc create) 통화-인지 전환, **통화 일치 가드 제거**.
5. **DTO + 리소스 + 설정 API**(거래통화/입력통화/MD매핑통화).
6. **compileJava 통과**.
7. **프론트 utils/currency 일반화** → 입력 컴포넌트(RfqDetail/OrderModal) → 관리자/MD 화면 → 표시 지점 → 설정 페이지(거래통화/MD소속).
8. **vue-tsc 통과**.
9. **브라우저 시나리오 점검**(§8.2).

### 8.2 브라우저 검증 시나리오 (관리자 + 협력사 + MD 계정 필요)
- 시나리오 2: 협력사(관리자 결제 USD, 입력 CNY) → ¥ 입력 → $ 환산 박제 확인 → 관리자 선정(USD→KRW) → 고객 KRW.
- 시나리오 3: MD↔협력사 매핑 결제 CNY 설정 → 협력사 ¥ 견적(변환 없음, ¥ 그대로) → MD 선정(CNY→USD+마진) → MD 발주 ¥ 기본 + ¥ 금액 일치 → 관리자 선정(USD→KRW).
- 설정: 거래통화 페이지 CNY 선택/입력통화 분리, MD소속 페이지 링크 통화.
- 표시: 전 지점 링크 통화 + 입력원본 병기, 다크모드 테이블 선.

---

## §9. 부록 — 현재 코드 인벤토리(무맥락 복구용)

### 9.1 백엔드 현재 통화 파일/심볼 (직전 커밋 1019394 기준)
- 환율: `service/ExchangeRateService.java`(getUsd/setUsd/getCny/setCny ToUsdRate), `ConfigExchangeRateService.java`(DEFAULT_RATE 1350, DEFAULT_CNY_USD_RATE 0.139, g5_shop_default), `KoreaEximExchangeRateService.java`(@Primary, AP01, `fetchAp01Rows`/`extractTts`, USD·CNH 교차, 당일 캐시 cachedDate/cachedCnyDate), `resource/ExchangeRateResource.java`(/usd,/cny GET·POST, POST 관리자), `repository/G5ShopDefaultRepository.java`(findUsd/updateUsd/findCny/updateCny ExchangeRate).
- 엔티티: `G5Member`(mbCurrency, mbSubCurrency, @DynamicUpdate), `SpPcbPartnerOrder`(price,currency,priceOriginal,exchangeRate,subCurrency,subPriceOriginal,subExchangeRate,selectedSubPartnerOrderId,marginRate,parentMbNo), `SpPcbPartnerOrderDocument`(orderPrice,orderCurrency,orderPriceOriginal,orderExchangeRate,orderSubCurrency,orderSubPriceOriginal,orderSubExchangeRate,parentMbNo).
- 서비스: `SpPcbPartnerOrderService`(updateQuote ~362, select ~451-481, getPartnerCurrencies/setPartnerCurrency ~785, getPartnerSubCurrencies/setPartnerSubCurrency, resolveCurrency ~942, toDto ~952, saveMasterDealerSelection ~850-932[가드 ~894/마진 ~916], isUsdPartner), `SpPcbPartnerOrderDocumentService`(create ~100-181, toDto ~798, SelectedSubPrep ~641-654).
- 리소스: `SpPcbPartnerOrderResource`(partnerCurrencies ~193, partner/{mbNo}/currency ~204, partnerSubCurrencies, partner/{mbNo}/subCurrency).
- DTO: `pojo/`의 SpPcbPartnerOrderDTO, ListDTO, QuoteDTO, SelectDTO, DocCreateDTO, DocDTO, DocDetailDTO(SelectedSubPrep: subCurrency/subPriceOriginal/subSubCurrency/subSubPriceOriginal/subPartnerSubCurrency), MasterDealerSelectDTO.
- MD 매핑: 테이블 `sp_master_dealer_partner`, API `masterDealerPartners`(myPartnerSummaries/masterDealers/myPartners). **엔티티명·리소스/서비스 파일명 확인 필요**(grep `master_dealer_partner` / `MasterDealerPartner`).
- DDL 기존: alter_pcb_usd_support.sql, alter_pcb_sub_currency.sql, alter_sp_pcb_partner_order_masterdealer.sql, create_sp_pcb_partner_order_document.sql.

### 9.2 프론트 현재 통화 파일 (직전 커밋 b287490 기준)
- `utils/currency.ts`(mainMoneyText/subMoneySuffix/moneyWithSub/formatUsd/formatCny/formatKrw/currencySymbol).
- `types/pcbPartnerOrderDoc.ts`(PcbPartnerOrderDoc + orderSub*, `orderPriceText`).
- `components/bom/PartnerQuoteModal.vue`(showCurrency, currency 토글 USD/KRW, subCurrency 토글 CNY; 협력사 목록=PHP+MD 병합).
- `components/pcb/PcbOrderModal.vue`(props currency/subCurrency/collapsibleRate, $⇄¥ 입력 토글, exchangeRate 입력 collapsible, fetchCnyRate/fetchExchangeRate).
- `views/PcbRfqDetail.vue`(협력사 입력, $⇄¥, fetchCnyRate, 미리보기 h-4 예약), `PcbReviewDetail.vue`(partnerOrders/partnerPriceText/선정모달/발주모달/resolveOrderCurrency+orderModalSubCurrency), `PcbRfqDetailMaster.vue`(sub quotePriceText/finalPrice), `PcbPurchaseOrderDetail.vue`(reorderModalCurrency/SubCurrency, selectedSubPrep+subSub*, collapsible-rate), `PcbRfqHistory.vue`/`PcbPurchaseOrderHistory.vue`(목록), `ExchangeRateSetting.vue`(USD+CNY 카드), `PartnerCurrencySetting.vue`(협력사 통화 페이지), `MasterDealerPartners.vue`(소속 매핑).
- `components/SideNav.vue`(설정 그룹: 환율 설정/협력사 통화/마스터딜러 소속), `router/index.ts`(/settings/* 라우트), `main.ts`(faCoins 등록).

### 9.3 핵심 함정/교훈 (세션 누적)
- 그누보드 zero-date 컬럼 → JPA 전체 UPDATE 시 NOT NULL 위반. `@DynamicUpdate` 필수(G5Member 포함).
- Tailwind v4: 새 파일의 `divide-y dark:divide-*` JIT 다크변형 누락 사례 → 행 구분은 `border-b ... dark:border-gray-700`(검증된 클래스) 사용.
- 직접 URL 진입은 인증 타이밍으로 리다이렉트 → 메뉴 SPA 진입.
- "환율 조회 중…" 류 메시지는 "로딩"과 "입력 0/미입력"을 분리해서 표시(로딩=환율 null일 때만).
- 가격 표시는 목록까지 전부 통화 헬퍼로 — USD/CNY 정본은 선정 전 KRW가 null이라 누락 시 '-'로 사라짐.
- MD 트랙 권한 2자×2트랙(수주자/발주자), 선적 forcedRole, 두 트랙(OR) 격리 — master-dealer-context 스킬/doc 참고.

### 9.4 미해결/가정/리스크
- 관리자 마진을 명시 비율로 둘지 vs "최종 판매가 직접 입력"으로 흡수할지 → **현행 직접 입력 유지** 가정(변경 시 별도).
- CNY→KRW 직접 변환(직속 CNY 협력사 → 고객) 필요 빈도 낮음 → 교차계산으로 충분 가정.
- 견적 유효기간/환율 스냅샷 정책 범위 외.
- 마이그레이션: 과거 USD 정본 데이터는 관리자↔협력사 USD 링크와 호환(손실 없음). MD↔협력사 CNY는 신규라 과거 데이터 영향 없음.
- 입력 원본 컬럼은 신규(input_*) vs 기존(sub_*) 재사용 — **택1 후 문서/코드 일관**.

---

## §10. 시작 트리거 (다음 세션 첫 액션)
1. 이 문서 통독.
2. `grep -ri "master_dealer_partner" samplepcb_xpse/src` 로 MD 매핑 엔티티/리소스/서비스 정확 파일명 확인(§9.1 TODO).
3. §8.1 빌드 순서대로 진행. 각 단계 끝 compileJava / vue-tsc.
4. DDL은 작성 후 **사용자에게 수동 적용 요청**(자동 실행 금지).
5. 통화 일치 가드(`masterUsd==subUsd`) 제거가 MD 핵심 — 빠뜨리지 말 것.
