# 협력사 보유 부품 (Partner Parts) — 정본

> 설계·구현 2026-08-23. 협력사가 올린 재고 목록을 저장하고, 고객 BOM 분석에서
> **기존 공급사와 같은 자리에서 뒤순위 후보로** 경쟁시켜 관리자가 견적요청을 걸기 쉽게 한다.
> 관련 정본: [BOM_QUOTE.md](./BOM_QUOTE.md) · [PARTS_SEARCH.md](./PARTS_SEARCH.md) ·
> [SMARTBOM_PARTNER_RFQ.md](./SMARTBOM_PARTNER_RFQ.md) · [PARTNER_PORTAL.md](./PARTNER_PORTAL.md)

## 한눈에

```
협력사 포털 · 관리자 대행
  재고표 업로드 ─▶ sp-engine `inventory` 프로필 ─▶ 미리보기(열 역할 교정) ─▶ 원장 sp_partner_part
                    (열 역할·품번 정리·플래그, 유실 0)      role_overrides 재실행     전체 교체 기본

고객 BOM 분석 (/app/bom)
  preflight ─▶ sp-node 가 정규 품번으로 원장 exact 조회 ─▶ 검색 잡 옵션 `local_products` 로 주입
            ─▶ 엔진이 외부 3사 결과와 **같은 매처·조달 정책**으로 한 번에 판정
            ─▶ 동률이면 소스 순위가 협력사를 뒤로 (실공급사 0 · 로컬 카탈로그 1 · 협력사 2)
            ─▶ 가격이 없으므로 자동 선정 불가 → 행에 "협력사 보유" 배지 → 관리자가 RFQ 발송
```

## 0. 결정 기록 (2026-08-23 확정)

| # | 결정 | 근거 |
|---|------|------|
| P1 | **저장은 부품 카탈로그(`sp_part`)와 분리** — `sp_partner_part` 별도 원장 | 카탈로그 편입은 로컬-우선 검색·ES 패싯·고객 단일검색·`pickDefaultOffer` 기본 선정까지 다섯 갈래로 새고, 그때마다 "협력사 제외" 분기를 공급사 하드코딩 목록 10여 곳에 심어야 한다. `lib/partner.ts validateSupplierCode` 가 `type='partner'` 조직의 supplierCode 를 금지한 규칙과도 정면 충돌 |
| P2 | **최하위 폴백 티어가 아니라 "같은 자리 · 뒤순위"** | 사용자 결정. 별도 티어(`applyLocalCatalogFallback` 형제)는 트리거 범위 결정·합류 복잡도를 낳는다. 같은 판정에 태우면 "외부에 있지만 재고 0" 같은 실제 유스케이스도 결정 없이 얻는다 |
| P3 | **견적요청 제한 없음** | 사용자 결정. 매칭 협력사에게만 RFQ 를 강제하면 D32(미응답 회수·재배정)와 충돌하고 인센티브 왜곡(품번 대량 업로드로 RFQ 선점)이 생긴다. 대신 표시로 돕는다 |
| P4 | **만료 없음** | 사용자 결정. 값이 판단에 쓰이지 않고(가격 없음·구매 불가·자동 적용 불가) 진짜 검증은 RFQ 회신이 한다. 만료는 조용히 사라지는 실패(13·34호 교훈)라 더 나쁘다. 대신 **나이를 늘 보이게** 하고 관리자 뒤처리 도구를 갖춘다 |
| P5 | 고객에게는 **부분 노출** — 곳 수·기준일까지, 조직 이름·정확 재고는 관리자만 | PCB 여정 43호 "고객 화면에 공급망 미노출"과 같은 결. 중개 이탈 위험 완충 |
| P6 | 브랜드 없는 행은 **자동 선정 금지**(`autoQuoteEligible=false`) | 실측 표본의 57%가 제조사 누락. 품번만으로 자동 선정하면 오매칭이 금액을 만든다 |
| P7 | 단일검색·부품 추가에서도 **검색된다** | 사용자 결정(제한 없음). 단, 저장은 분리 원장이므로 별도 질의·별도 결과 그룹으로 붙인다 |
| P8 | 업로드 기본 모드 = **전체 교체** | 협력사가 올린 표가 그 시점 보유 전량이라는 실무 의미 |
| P9 | capability 는 기존 **`part_sale`** 재사용 | 정의·라벨·관리자 체크박스·시드가 이미 있는데 **어디서도 검사되지 않던** 죽은 능력이었다. 새 어휘 불필요 |

## 1. 왜 별도 원장인가 (A안 vs B안)

| | A. 카탈로그 편입 | B. 별도 원장 (채택) |
|---|---|---|
| 읽는 곳 | 로컬-우선 R/C·커넥터 · ES 패싯·관리자 검색 · 고객 단일검색 · `pickDefaultOffer` · exact 폴백 = **5** | BOM 검색 주입 1곳 (+ 관리자 조회) |
| "뒤순위" 보장 | 필터 10여 곳의 약속(`ENGINE_SUPPLIER_IDENTITIES`·`SUPPLIER_TRUST_ORDER`·`SAMPLEPCB_PRICE_SOURCE_ORDER`…) | 구조 — 다른 경로가 원장을 안 본다 |
| 규칙 충돌 | `validateSupplierCode`(partner 조직에 supplierCode 금지) | 없음 |
| 교체·정지·삭제 | supplier 키 스윕 + ES 유령문서 위험 | `partnerId` 한 컬럼 |
| 잃는 것 | — | `partId`(이미지·상세) — 협력사 데이터엔 원래 없다 |

## 2. 데이터 모델

마이그레이션 `20260823100000_add_partner_parts` (추가 전용).

- **`sp_partner_part_upload`** — 업로드 회차 1건. `status(parsing→preview→applied|failed|superseded)` ·
  `mode(replace|merge)` · `mappingJson`(시트·열 역할 스냅샷 + 사람 교정 `engineOverrides`) ·
  `statsJson` · `previewJson`(**표본 200행만**, 반영 후 비움) · `uploadedBy(PARTNER|ADMIN)` ·
  `uploadedById`. 원본 파일은 파일서버 + `sp_file(refType='sp_partner_part_upload')` — **보관은 필수**다.

  ⚠ **`previewJson` 에 엔진 결과 원문을 통째로 넣으면 안 된다**(2026-08-23 실사용 실패):
  12,175행 재고표의 결과 JSON 이 6.36MB 라 MySQL 패킷 한도에서 **연결이 끊긴다**
  (`Server has closed the connection` → 화면엔 `BOM_ENGINE_ERROR`). BOM 견적의
  "대형 후보 저장 내성"과 같은 계열이며, 표본 크기 픽스처로는 절대 안 잡힌다.
  그래서 미리보기는 표본만 들고, **커밋에 필요한 전량은 보관 원본을 같은 교정으로 다시 돌려**
  얻는다(`rerunUploadFromArchive`). 추출은 결정론적 규칙 엔진이라 결과가 같다.
  원본 보관을 best-effort 로 두면 커밋이 막다른 길이 되므로 실패 시 업로드 자체를 실패시킨다.
- **`sp_partner_part`** — 재고표 1행. `mpn`·**`mpnRaw`(원문 항상 보존)**·`mpnNorm` ·
  `manufacturer`/`manufacturerNorm` · `stockQty`·`dateCode`·`leadTime`·`unitPrice`/`currency`·`moq` ·
  `rawFields`(미분류 열 원문)·`flags`(엔진 검토 플래그) · `isActive`(관리자 수동 스위치) ·
  **`editedAt`/`editedBy`**(마이그레이션 `20260823170000_add_partner_part_edit` — 사람이 고친 행).
- **`sp_partner_part_key`** — 한 행이 만드는 **조회 키 여럿**. `kind=canonical|alternative`.
  "진짜 품번" 하나를 고르면 반드시 틀리기 때문에(`PCA9575PW2, 118` 의 `118` 은 수량이 아니라
  NXP 포장 코드) 고르지 않고 전부 건다. FK 를 두지 않는다 — 전체 교체가 잦아 대량 삭제를
  청크로 돌기 때문(견적 삭제에서 배운 P2028 함정).

## 3. 엔진 — `inventory` 추출 프로필

BOM 추출기(`rule_extractor`)와 **별도 모듈**(`bom_extraction_engine/inventory.py`)이다.
BOM 경로는 의미가 정반대라 모드 분기를 넣으면 회귀 위험만 커진다:

| | BOM 추출기 | inventory 프로필 |
|---|---|---|
| price·단가·재고·stock | `_IGNORE_PAT` 로 **명시 폐기** | `unit_price`·`stock_qty` 역할 |
| 재고 수량 | `_QTY_NEG` 로 강등, 다른 수량 열 없으면 **보드당 수량으로 승격** | 재고 의미 |
| date code·납기 | 개념 없음 | `date_code`·`lead_time` |
| 재고 시트 | `non_bom_sheet_reason` 이 fail-closed 기각 | 정상 입력 |
| 품번 위생 | `DS1307Z+T&R` 를 **플래그 없이 null** (실측 결함) | 원문 항상 보존 + 플래그 |

- **무유실**: `part_number`(정리본) + `part_number_raw`(원문) + `part_number_alternatives`(잡음 제거
  후보) + `raw_fields`(역할 못 정한 열 전부) + `flags`. 품번 없는 행도 검토 대상으로 남긴다.
- **하나를 고르지 않는다**: 브랜드·수량·포장 접미가 섞인 셀은 정본을 원문으로 두고 후보를 함께
  낸다. 두 낱말 브랜드(`ACS725LLCTR-20AB-T Allegro MicroSystems`)까지 회수한다.
- **교정 루프**: 미리보기에서 사람이 열 역할을 바꾸면 `inventory_options.role_overrides` 로
  **엔진을 같은 파일로 다시 돌린다**(응용 계층이 셀을 재해석하지 않는다).
- **로더 교정(BOM 경로도 함께 이득)**: 시트 XML 50MB 초과면 calamine 으로 우회한다.
  서식만 남은 빈 열 잔재(12,176행 × 16,384열, 시트 XML 279MB)에서 openpyxl 은
  **17분 CPU·1.7GB 후에도 미완**이었고 calamine 은 **1.8초에 (12176, 7)** 로 읽었다.
  styles.xml 은 24KB 라 기존 비대 판정에 안 걸리던 구멍.

### 실측 (`.tmp/EUREKA-stock parts 8.6.xlsx`, 12,175행)

1.9초 · 열 역할 7/7 정확 · 고유 품번 10,096 · 제조사 있음 5,239(43%) ·
확인 권장 421행(플래그 `mpn_comma_suffix_alternative` 178 · `mpn_brand_suffix_stripped` 58 ·
`mpn_needs_review` 250 · `mpn_quantity_suffix_stripped` 20).
API 왕복 실측: 업로드+미리보기 4.8초 · 커밋 6.0초(원장 12,175행 + 조회 키 12,432건).

### ⚠ CSV `attrs` deepcopy — pandas 셀 접근의 숨은 2차 비용 (2026-08-23 실측)

CSV 로더는 ragged 행 복구를 위해 원본 행 폭을 `frame.attrs["source_row_widths"]` 에 담는다.
그런데 **pandas 는 거의 모든 연산에서 `__finalize__` 로 `attrs` 를 deepcopy** 한다 —
행 수만큼 긴 리스트가 들어 있으면 `df.iat[r, c]` **한 번이 리스트 전체 복사**가 된다.

- 실측: 12,000행 CSV 에서 `iat` 18,246회 → deepcopy **5,480만 회 = 84초**.
  같은 크기 xlsx 는 attrs 가 없어 2.3초였다(원인이 형식이 아니라 attrs 라는 증거).
- 교정 ①: `bom_loader._SharedRowWidths`(list 상속 + `__deepcopy__` 가 self 반환) —
  값이 로드 시점에 확정돼 변하지 않으므로 공유해도 안전하다. 84초 → **0.6초**.
  ⚠ 이건 **BOM 경로의 기존 결함이기도 하다** — `workbook.py`·`serialize.py` 가 `.iat` 를
  다수 쓰므로 **모든 CSV BOM 업로드가 같은 세금을 내고 있었다**. 같은 수정으로 함께 풀린다.
- 교정 ②: inventory 는 시트를 `_to_grid` 로 한 번에 문자열 격자로 바꿔 핫 루프에서 pandas 를
  아예 뺐다. 0.6초 → **0.1초**.

## 4. BOM 검색 주입

- sp-node 가 preflight 응답의 검색 정체성(품번)을 모아 `normalizeMpn` 으로 정규화 →
  `sp_partner_part_key` exact 배치 조회 → 검색 잡 옵션 `local_products`(키 = 정규 품번)로 주입.
  키가 component_id 가 아닌 이유: 엔진이 **같은 질의를 캐시 키로 묶어 한 번만 실행**하므로
  검색 정체성이 올바른 단위다.
- 엔진은 `extra_products` 로 받아 `supplier_results` 에 섞지 않는다 — 호출 수·캐시 상태·trace 를
  오염시키지 않는다. 매처·후보 결정·조달 정책은 외부 후보와 **완전히 같은 것**을 탄다.
- **뒤순위는 정렬 키가 낸다**: `_source_rank`(실공급사 0 · 로컬 카탈로그 1 · 협력사 2)를
  lifecycle 뒤·제조사 앞에 넣었다. 기술 판정이 동률일 때만 발동한다.
  ⚠ 공급사 문자열 알파벳순(`supplier.value`)에 기대면 `'partner' < 'unikeyic'` 이라 앞서 버린다.
- **가격을 만들지 않는다**: 주입 product 는 `offers: []`. 따라서 구매 조건이 없어 어떤 자동
  선정도 금액을 만들 수 없고, 협력사 후보는 검토 후보로만 남는다(가격은 RFQ 회신이 정본).
  재고·D/C·납기는 `catalog_metadata` 에 **표시용 사실**로만 싣는다.
- **exact 품번만**: 품번 없는 파라메트릭 질의에는 주입하지 않는다(스펙 호환 판정을 협력사
  주장에 기대지 않는다).
- **카탈로그 인제스트 제외**: `parts-ingest.parsedGroups` 가 `supplier==='partner'` 를 걸러 낸다.
  안 막으면 `sp_part`·ES 로 편입돼 원장을 분리한 이유가 통째로 무너지는 뒷문이다.
- **즉시 반영되는 배제**: 조직 정지·`part_sale` 회수·`isActive=false` 는 다음 검색부터 바로 빠진다
  (조회가 매번 서버 판정).

## 5. 노출 정책

| | 고객(`/app/bom`) | 관리자 |
|---|---|---|
| 있다는 사실 | 행 배지 `협력사 보유` / `협력사 N곳 보유` | 같음 |
| 보유 곳 수·기준일 | 툴팁으로 노출 | 노출 |
| 조직 이름·정확 재고 | **비노출** (`toItemDto` 가 `partnerIds` 를 지운다 — 기본이 안전한 쪽) | 협력사 보유 부품 화면에서 품번으로 조회 |
| 선정 후 | 기존대로 `selectedOffer.supplier` 에 협력사명 노출 | 같음 |

`matchEvidence.partnerStock = { partnerCount, totalStockQty, latestUploadedAt, partnerIds }` —
`partnerIds` 는 DTO 경계에서 비워 내보낸다.

## 6. 화면

**협력사 포털(공통 영역 — 수금과 같은 자리, 모듈 아님)**
- `/partner/parts` `PartnerParts.vue` — 현황(등록 수·마지막 업로드 나이·신선도) · 드래그&드롭
  업로드 · 원장 검색·삭제 · 최근 업로드 이력. 확인 대기 회차가 있으면 새 업로드 대신 이어서
  확인하도록 유도(서버도 409).
- `/partner/parts/uploads/:uploadId` `PartnerPartUpload.vue` — 읽은 결과 요약 · **열 역할 교정 +
  [다시 분석]** · 표본 200행 미리보기 · 전체 교체/추가 선택 후 반영.
- 노출 조건 `tracks.parts`(= `part_sale`). `PartnerAccessResponse.tracks` 에 필드 추가,
  공통 메뉴 항목이 `requiresTrack` 을 들고 셸이 건다.

**관리자 — SmartBOM Case 상세 (견적요청을 누구에게 보낼지)**

RFQ 제한을 두지 않기로 했으므로(P3) 강제하지 않고 **고르기 쉽게만** 한다:
- 품목 표 행에 `협력사 보유 · <이름들>` — hover 시 재고·D/C·트랙 여부
- 품목 툴바 퀵액션 **`[협력사 보유 N]`** — 보유 행만 한 번에 선택(§6.13 부분 발송과 결합)
- 발송 모달: 보유한 협력사를 **맨 위로 정렬** + `보유 n행` 배지(n = 이번 발송 범위 기준)
- 근거는 `GET /api/admin/bom-quotes/:id/partner-stock` 하나 — 품목 표와 모달이 같은 캐시를 본다

**협력사 포털 — RFQ 회신 폼 프리필**

내가 올려 둔 보유 부품과 같은 품번이면 **재고·D/C·납기·MOQ 를 미리 채운다**(`myStock`).
- **아직 회신하지 않은 행에만** 채우고 이미 쓴 값은 절대 덮지 않는다.
- **단가는 채우지 않는다** — 재고표 단가는 견적가가 아니고, 프리필이 곧 제시가로 굳어지면
  협력사가 손해를 본다(수량·환율·시점이 다르다).
- 채운 행에 `보유 목록에서 채움` 배지를 달아 사람이 확인·수정하게 한다.
- 포털·매직링크 둘 다(토큰이 조직을 특정한다). 관리자 대리 입력에는 넘기지 않는다.

**관리자 — 통합 관리 › 협력사 보유 부품 (`/app/admin/partner-parts`)**

만료·제한을 두지 않기로 한 대신 품질 비용이 전부 관리자에게 온다. 그래서 뒤처리가 1~2클릭:
- 협력사별 요약(사용 중·꺼짐·마지막 업로드 나이) — **낡은 것이 위로**
- 원장 통째 **끄기/켜기**(만료 대신 사람이 끄는 스위치 — 목록은 남고 검색 주입에서만 빠진다)
- 행 검색·선택 일괄 끄기/켜기·행 삭제·**원장 비우기**(청크 삭제)
- **대행 업로드** — 포털 계정 없는 협력사를 대신해 올리고 바로 반영(12호 교훈)

### 원장 목록 정렬 (2026-08-23)

포털·관리자 두 원장 목록 모두 `[{ uploadId: 'desc' }, { sourceRow: 'asc' }, { id: 'asc' }]` —
**최신 회차가 위로, 회차 안에서는 파일 순서 그대로**. 처음엔 품번 사전순이었으나 두 가지를 놓쳤다:

1. 재고표는 **회차 단위로 사는 문서**다. `merge` 로 여러 회차가 섞이면 방금 올린 분이 사전순
   사이에 흩어져 "내가 올린 게 반영됐나"를 확인할 수가 없다.
2. 회차 안까지 사전순으로 흩으면 협력사가 **자기 엑셀과 대조할 수 없다** — `sourceRow` 를 이미
   갖고 있으므로 파일 순서를 그대로 돌려주는 편이 대조 비용이 0 이다.

⚠ **정렬 키 셋은 전부 '수정으로 안 바뀌는 값'이어야 한다.** 사전순일 때는 품번을 고치는 순간
행이 목록의 다른 자리로 튀어(저장 → invalidate → 재조회) 방금 무엇을 고쳤는지 확인할 수 없었다.
`uploadId`·`sourceRow`·`id` 는 수정이 건드리지 않으므로 행이 **제자리에 남는다**. 그 위에
저장 직후 2.5초 배경 하이라이트(`justSaved`)만 얹어 "이 줄이 반영됐다"를 보인다 — 행이 움직이지
않으니 스크롤·포커스 복원 같은 장치가 필요 없다.

관리자 **협력사별 요약**은 다른 목적이라 그대로 `ageDays` 내림차순(**낡은 원장이 위로**) —
행 목록은 "내가 올린 것을 확인하는" 화면이고, 요약은 "뒤처리할 것을 찾는" 화면이다.

⚠ `(partnerId, uploadId, sourceRow)` 복합 인덱스는 두지 않았다(원장 1개가 1만 행대라 filesort 로
충분). 협력사당 수십만 행이 되면 그때 재검토.

### 행 수정 (2026-08-23)

오타 품번·빠진 제조사·바뀐 재고 하나 때문에 재고표 전체를 다시 올리게 하지 않는다.
포털·관리자 **공용 모달** `PartnerPartEditModal.vue` 로 한 줄만 고친다.

- 고치는 것은 **원장 값**뿐이고 **파일 원문 `mpnRaw` 는 절대 안 건드린다** — 둘이 다르면
  화면이 원문을 함께 보여 준다(무유실 원칙이 수정에도 그대로).
- **품번을 고치면 `sp_partner_part_key` 를 갈아 끼운다**(옛 키 전부 삭제 → 새 canonical 1건).
  안 그러면 화면에 보이는 품번과 BOM 검색에 걸리는 키가 어긋나 조용히 틀린다.
  같은 이유로 엔진이 옛 품번에 붙였던 검토 플래그(`mpn_*`)도 함께 지운다 — 더는 그 값이 아니다.
- **빈 문자열은 '지움'(null)** 이다. `??` 로는 빈 문자열이 통과하므로 서버가 `blank()` 로 접는다.
  품번만은 비울 수 없다(400) — 조회 키가 사라진 행은 원장의 유령이 된다.
- 고친 행에 `manually_edited` 플래그와 `수정됨` 배지. 플래그 칩은 배지와 겹치므로
  `partnerPartVisibleFlags()` 가 화면에서만 접는다(데이터에는 남는다).
- 포털은 **자기 조직 행만**(남의 행은 404 — 존재조차 알리지 않는다), 관리자는 아무 행이나.
- ⚠ 모달이 명시적으로 알린다: **다음 전체 교체 업로드는 수정본도 함께 지운다.** 오래 갈 교정은
  원본 파일을 고쳐 다시 올리는 쪽이다.

## 7. API

```
GET    /api/partner/parts/summary                     보유 수·마지막 업로드 나이
GET    /api/partner/parts?q&page&pageSize             내 원장
GET    /api/partner/parts/uploads                     업로드 이력
POST   /api/partner/parts/uploads          (multipart) 업로드 → 미리보기
GET    /api/partner/parts/uploads/:id                 미리보기 상세
POST   /api/partner/parts/uploads/:id/remap           열 역할 교정 → 엔진 재실행
POST   /api/partner/parts/uploads/:id/commit          원장 반영(replace|merge)
DELETE /api/partner/parts/uploads/:id                 확인 대기 회차 취소
PATCH  /api/partner/parts/:partId                     내 원장 행 수정(품번 바꾸면 조회 키 재생성)
DELETE /api/partner/parts/:partId                     내 원장 행 삭제

GET    /api/admin/bom-quotes/:id/partner-stock        품목 × 보유 협력사(발송 대상 근거)
GET    /api/admin/partner-parts/summary               협력사별 요약(낡은 순)
GET    /api/admin/partner-parts?partnerId&q&…         전체 원장 검색
GET    /api/admin/partner-parts/:partnerId/uploads    협력사 업로드 이력
PATCH  /api/admin/partner-parts/:partnerId/active     원장 통째 활성/비활성
PATCH  /api/admin/partner-parts/rows                  행 단위 일괄 활성/비활성
PATCH  /api/admin/partner-parts/row/:partId           행 수정(협력사가 못 고칠 때 대신)
DELETE /api/admin/partner-parts/row/:partId           행 삭제
DELETE /api/admin/partner-parts/:partnerId            원장 비우기
POST   /api/admin/partner-parts/:partnerId/uploads    대행 업로드
POST   /api/admin/partner-parts/uploads/:id/commit    대행 회차 반영
```

**권한 축이 둘**: `requirePartner`(멤버 ∧ 조직 승인)는 auth 플러그인이 보고,
capability `part_sale` 은 **라우트가 매 요청 DB 로 재확인**한다 —
`partnerContext` 에 capabilities 가 없고(13호 교훈: 판정 축은 '멤버 존재 ∧ 조직 승인'),
관리자가 트랙을 회수하면 다음 요청부터 즉시 막혀야 하기 때문.

## 8. 검증

- **엔진**: `pytest` 622 passed / 1 skipped · ruff clean.
  신규 `test_inventory_profile.py` 9케이스(상업 열 보존 · `+T&R` 무유실 · 대체 후보 ·
  미분류 열 보존 · 품번 없는 행 · role_overrides 재실행 · 헤더 없는 표 · 부품 목록 아님 · 행 상한),
  `test_partner_local_products.py` 5케이스(소스 순위 · 주입 키 = `normalizeMpn` · exact 질의만 ·
  같은 매처 + 동률이면 실공급사 우선 · 구매 조건 미생성).
- **sp-node**: `pnpm --filter api test` 960 passed / 29 skipped · typecheck·lint clean.
- **E2E 대형** `e2e/specs/partner-parts-large.e2e.test.ts` — 12,000행 업로드→미리보기→반영.
  **크기 자체가 검사 대상**이다: 미리보기 스냅샷 < 1MB, 표본 행 < 전체, 조회 키 12,120건,
  반영 후 스냅샷 null. 실사용 실패를 표본 픽스처가 못 잡았기에 세운 회귀선(4.0초).
- **E2E** `e2e/specs/partner-parts.e2e.test.ts` 14케이스 ALL PASS(품목×보유 협력사·회신 프리필 포함) —
  tracks 파생 · `part_sale` 없으면 403 · 업로드→미리보기(열 역할·원문 보존·대체 후보·통화 기호) ·
  확인 대기 중 409 · 반영 후 조회 키 색인 · 열 교정 재실행 · 전체 교체(유령 키 0) ·
  관리자 끄기/켜기/행 삭제 · 대행 업로드 · 원장 비우기 ·
  **행 수정**(품번 교체 시 조회 키 재생성·옛 키 0 · `mpnRaw` 불변 · 빈 문자열=지움 ·
  빈 품번 400 · 남의 행 404 · 관리자 대행 수정).
- **실 DB 프로브**: 원장 → 주입 페이로드에서 canonical·alternative 키 모두 매칭,
  브랜드 없는 행 `autoQuoteEligible=false`, `part_sale` 회수 시 즉시 0건 확인.
- **화면 관찰** `e2e/specs/partner-parts-observe.e2e.test.ts` 6케이스 — 포털 목록·**행 수정 모달**·업로드 확인·
  관리자 뒤처리·**Case 보유 퀵액션/행 표시/발송 모달 배지**를 실제로 띄워 pageerror 0 확인,
  캡처는 `e2e/output/`(사람 육안 1회 — 플레이북 "실브라우저 사각").
- **sp-vue**: typecheck(vue-tsc)·lint clean.

## 9. 남은 것 (미착수)

- 단일검색(`/bom/search`)·[부품 추가]에 `협력사 보유` 결과 그룹 (결정 P7 — 서버 조회는 있고
  화면 붙이기만 남음). ⚠ prefix 검색이면 `escapeLike` 필수(24호: `%` 한 글자가 2만 건 반환).
- 후보 드로어에 협력사 후보 전용 표기(현재는 offers 가 비어 카드가 밋밋하다).
- 관리자 설정에 `오래된 재고표 경고 일수` 노출(현재 env `PARTNER_PART_STALE_AFTER_DAYS`, 기본 90).
- 협력사 파일 2~3본을 더 받아 `local-corpus` 회귀 코퍼스 구성 — **한 파일로 설계한 추출기는
  다음 파일에서 깨진다**. 교정 루프가 1급 기능인 이유이기도 하다.
- 선택: RFQ 회신에 "내 원장도 이 값으로 갱신" 체크(회신이 가장 정확한 최신 정보).
