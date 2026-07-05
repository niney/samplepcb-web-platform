# 거버 가격 해석 모드 (Gerber Price Mode)

거버(자동견적)가 산출하는 가격을 **주문가(부가세 포함 총액)** 로 볼지 **공급가(부가세 별도)** 로
볼지 선택하는 관리자 설정. 공급가로 선택하면 서버가 담기·주문 전에 부가세 10%를 얹어
결제 금액에 반영한다.

---

## 1. 배경 — 영카트/그누보드의 부가세 처리

이 플랫폼의 주문 금액은 그누보드5/영카트 코어가 계산한다. 부가세 처리의 핵심 사실:

- **부가세 "포함가 역산" 방식이 유일하다.** 상품 판매가는 언제나 VAT 포함가(공급대가)로
  간주되고, 공급가액 = `round(총액 / 1.1)`, 부가세 = `총액 − 공급가액`으로 역산한다.
  - 원본: `samplepcb-web/lib/shop.lib.php` `get_order_info()` (약 1745~1795행)
  - 주문 생성: `samplepcb-web/shop/orderformupdate.php:557` (`round($i_price / 1.1)`)
- **세율 10%는 코어 곳곳에 `1.1`(또는 `*10/11`) 리터럴로 하드코딩**되어 있다. 세율 상수도,
  세율 설정 필드도 없다. 한국 표준세율이 10% 단일이라 실무 문제는 없다.
- **`de_tax_flag_use`("복합과세 결제")는 부가세 on/off 스위치가 아니다.** 과세+면세가 한
  주문에 섞일 때 이를 분리 집계·표시·PG 전달할지 정하는 플래그다. 값이 `0`이어도 부가세는
  항상 계산·저장된다(코어가 무조건 역산). `orderformupdate.php:556-564` 참고 — 역산은 `if`
  문 밖(무조건)이고, `de_tax_flag_use`가 켜졌을 때만 프론트 분리값(`comm_*`)으로 덮어쓴다.
- **상품별 세금 구분은 과세/면세(`it_notax`)뿐**이다. 담을 때 `ct_notax`로 복사되어 주문
  집계 시 과세/비과세 금액으로 나뉜다. 임의 세율 개념은 없다.
- **세금계산서(사업자 tax invoice)는 표준 미지원.** `taxsave`는 현금영수증 전용이며
  무통장/계좌이체/가상계좌에서만 동작한다(`shop_is_taxsave()`).

### 이 프로젝트(PCB)의 실측 상태 (2026-07-05 기준)

- 판매 상품 4종(`sp-pcb-std`, `sp-pcb-adv`, `sp-pcb-flex`, `sp-mask`) **전부 과세**
  (`it_notax = 0`). PCB·메탈마스크는 공산품 제조·판매라 부가세법상 100% 과세.
- `de_tax_flag_use = 0`, `de_taxsave_use = 0`. **전 상품 과세라 복합과세는 켤 필요가 없고**
  (과세+면세 분리가 불필요), PG 복합과세 계약도 불필요하다.
- 실제 주문은 `od_tax_flag = 0`인데도 공급가/부가세가 정확히 저장되고 있다. 예: 결제
  93,000원 → 공급가 84,545 + 부가세 8,455. **부가세는 이미 코어가 처리 중이며 sp-node와
  무관하다**(sp-node에는 주문 생성 `INSERT INTO g5_shop_order`가 없다).

> ⚠️ **면세 품목을 추가한다면** 반드시 `de_tax_flag_use`(복합과세 결제)를 켜야 한다. 끄면
> 코어가 면세분까지 과세로 밀어 부가세를 과다 계상한다(`shop.lib.php:1756-1760`,
> `orderformupdate.php:559`). 현재는 전 상품 과세라 무해.

---

## 2. 왜 이 기능이 필요한가

거버/견적 엔진이 주는 가격이 소스에 따라 두 종류일 수 있다.

| 거버 출력 | 의미 | 필요한 처리 |
|---|---|---|
| **주문가** | 공급가 + 부가세 (포함 총액) | 그대로 사용 |
| **공급가** | 부가세 별도 | ×1.1 해서 포함 총액으로 정규화 |

하류(카트·주문·견적서·PG)는 **전부 "받은 값 = 부가세 포함 총액"으로 역산**한다. 따라서
거버가 공급가를 주는 경우, 진입 지점에서 ×1.1로 정규화해 넘겨야 정합이 맞는다. 이를 관리자가
전역 스위치로 선택할 수 있게 한 것이 이 기능이다.

### 결제 금액 예시

| 모드 | 거버 값 해석 | 고객 결제액 | 내부 저장 (공급가 / 부가세) |
|---|---|---|---|
| **order** (주문가) | 100,000 = 포함 총액 | **100,000** | 90,909 / 9,091 |
| **supply** (공급가) | 100,000 = 공급가 | **110,000** | 100,000 / 10,000 |

---

## 3. 설계 / 구현

### 정규화 지점 — 견적 엔진 "밖"

견적 엔진 `apps/api/src/pricing/engine.ts`는 레거시 충실 이식(골든테스트 고정)이라 **손대지
않는다.** 대신 그 결과 `listPrice`를 순수함수가 후처리한다.

```
calculateQuote() → listPrice ── applyGerberPriceMode(listPrice, mode) ──┬─→ autoPrice 저장
  (engine.ts, 불변)                (pricing/gerber-price-mode.ts)        ├─→ 카트 io_price
                                                                        └─→ 견적서 total
```

`applyGerberPriceMode(listPrice, mode)`:
- `supply` → `Math.round(listPrice * 1.1)` (부가세 10% 부가)
- `order` → 그대로
- `null`(rfq) → 그대로 (가격 없음)

적용 위치: `apps/api/src/routes/pcb-projects.ts`의 `calculateQuote` 호출 2곳
(프로젝트 생성 `POST /pcb-projects`, 수량 재견적). `listPrice`를 정규화값으로 교체하므로
하류(autoPrice·카트·견적서)가 자동으로 정합한다.

### 저장소 — sp 소유 `sp_config`

코어 `g5_config`/`g5_shop_default`를 건드리지 않기 위해 sp-node 소유의 key-value 설정
테이블 `sp_config`를 신설했다(`prisma/schema.prisma`의 `SpConfig`). 키
`gerber_price_mode`에 `order|supply` 저장. **미설정 기본은 `order`**(현행 동작 보존).

- 접근: `apps/api/src/lib/sp-config.ts` (`getGerberPriceMode` / `setGerberPriceMode`)
- migration: `prisma/migrations/20260705000000_add_sp_config/migration.sql` (CREATE TABLE
  추가전용). 공유 DB이므로 `migrate reset`/`migrate dev` 금지 — 수기 migration.sql →
  `migrate deploy` → `generate` 절차(스키마 파일 상단 규율 참조).

### API / UI

- 계약: `packages/api-contract/src/schemas/settings.ts` (`GerberPriceMode`,
  `GerberPricingResponse`, `GerberPricingUpdate`)
- 라우트: `GET`/`PATCH /api/admin/settings/gerber-pricing` (`routes/admin-settings.ts`, requireAdmin)
- 화면: `/app/admin/settings` → **"거버 가격"** 탭 (`components/admin/GerberPricingForm.vue`,
  라디오 2모드). 훅 `useGerberPricing`/`useSaveGerberPricing`.

---

## 4. 사용법

1. 관리자 → `/app/admin/settings` → **거버 가격** 탭.
2. **주문가(부가세 포함)** 또는 **공급가(부가세 별도)** 선택 후 저장.
3. `공급가` 선택 시, **저장 이후 발급되는 견적부터** `listPrice`에 부가세 10%가 얹혀 담기·
   주문에 반영된다.

### 주의

- **기존 견적에는 소급되지 않는다.** 모드는 견적 산출 시점에 적용되며, 이미 발급된
  `sp_quote.autoPrice`/`sp_order_spec.finalPrice`는 그대로다.
- 세율 10%는 코어와 동일하게 고정(`×1.1`). 세율 자체를 바꾸는 기능이 아니다.
- 이 스위치는 **부가세 계산 on/off가 아니다.** 부가세는 어느 모드든 계산·저장된다. 이
  스위치는 "거버 값을 공급가로 볼지 주문가로 볼지"만 정한다.

---

## 5. 관련 파일

| 레이어 | 파일 |
|---|---|
| 계약 | `packages/api-contract/src/schemas/settings.ts` |
| DB | `apps/api/prisma/schema.prisma` (SpConfig), `prisma/migrations/20260705000000_add_sp_config/` |
| 정규화 | `apps/api/src/pricing/gerber-price-mode.ts` (+ `.test.ts`) |
| 설정 저장 | `apps/api/src/lib/sp-config.ts` |
| API | `apps/api/src/routes/admin-settings.ts` |
| 견적 적용 | `apps/api/src/routes/pcb-projects.ts` |
| UI | `apps/web/src/admin/useAdminSettings.ts`, `components/admin/{SettingsTabs,GerberPricingForm}.vue`, `pages/admin/AdminSettings.vue`, `i18n/locales/{ko,en}.ts` |
