# Walsin R/C 워크북 분석

## 결론

이 워크북은 저항·캐패시터의 **AVL(승인 대체품 목록)** 표다. 한 행이 같은 사양을 만족하는
제조사 5곳의 품번을 나란히 담는다. 연호 Rev2와 달리 근거가 승인도가 아니라 **제조사 품번
생성 규칙**이므로, 정체성 근거가 아닌 후보로 격리 적재한다.

- 원본 SHA-256: `7aa0c323e02e11ec67086546f5dae47d38f83748732dea0eb463b3ef19433e6c`
- 기준일: `2026-07-06`
- 시트 46개 = 메타 6 + `R_*` 13 + `C_*` 13 + `LFB_*` 13

## 적재 범위

| 그룹 | 시트 | 행 | 부품 | 적재 |
|---|---:|---:|---:|---|
| R (Thick Film Chip Resistor) | 13 | 364 | 1,120 | 포함 |
| C (MLCC) | 13 | 377 | 1,508 | 포함 |
| LFB (Inductor / Ferrite Bead) | 13 | 78 | 0 | 제외 |

**총 2,628 부품.**

LFB 제외는 사이즈 선택이 아니라 데이터 사실이다. LFB 시트의 MPN 열은
`Walsin_FB_0603_600Ω@100MHz_VERIFY` 형태의 자리표시자 문자열이며 품번이 아니다
(`verification_status=VERIFY_REQUIRED`, `auto_quote_level=MANUAL`).

## 제조사

| 제조사 | 부품 | 역할 |
|---|---:|---|
| Walsin | 572 | primary (R·C 공통) |
| Yageo | 572 | alt1 (R·C 공통) |
| Samsung | 456 | alt2 |
| TDK | 348 | alt4 (C) |
| Murata | 232 | alt3 (C) |
| Vishay | 224 | alt3 (R) |
| KOA | 224 | alt4 (R) |

`Samsung Electro-Mechanics`·`Vishay Dale`·`KOA Speer` 같은 유통사 표기는 법인 접미 제거만으로는
워크북의 `Samsung`·`Vishay`·`KOA`와 같은 키가 되지 않는다. `manufacturer-alias.ts`에 별칭을 넣어
카탈로그 품번과 실공급사 오퍼가 같은 `(mpnNorm, manufacturerNorm)`으로 모이게 했다.

## 사양 축

| 그룹 | 축 | 값 |
|---|---|---|
| R | `value` × `tolerance` | 0Ω~1MΩ 14종 × 1%·5% |
| C | `capacitance` × `tolerance` × `voltage` × `dielectric` | 10pF~22uF 15종 × ±5/±10/±20% × 6.3~50V × C0G/NP0·X5R·X7R·X5R/X7R |

SI 정규화는 기존 `ENGINE_SPEC_FIELD` 축을 그대로 쓴다 — `resistance_ohm`, `capacitance_f`,
`tolerance_percent`, `voltage_v`. 새 스펙 축을 만들지 않았다.

`C0G/NP0`는 같은 유전체 동의어이므로 `C0G`로 정규화한다. 반면 `X5R/X7R`는 서로 다른
온도 등급 후보라 624개 제품의 exact `dielectric`에서는 제외하고, `sourceDielectric` 원문과
`dielectricAmbiguous=true`로만 보존한다.

`C_*` 시트에는 `description` 열이 없어 사양에서 결정적으로 만든다
(`Multilayer Ceramic Capacitor {dielectric} {voltage}`).

## 중복 해소

원본의 시트 분할 기준은 `input_size_code`이고 이는 EIA와 1:1이 아니다. 세 유형이 나왔다.

| 유형 | 건수 | 처리 |
|---|---:|---|
| `1005`+`402` (둘 다 EIA 0402) | 285 | **병합** — 같은 부품, 원본 표기를 `inputSizeCodes`에 보존 |
| C `1808` vs `1812` (Samsung·Murata) | 58 | **잘못된 배정 폐기** |
| C `2010` vs `2220` (Samsung·Murata) | 58 | **잘못된 배정 폐기** |

사양 자체가 어긋나는 중복은 0건이라 병합이 안전하다.

폐기 근거: Samsung `CL43`·Murata `GRM43`은 metric 4532(=EIA 1812), `CL55`·`GRM55`는
5750(=EIA 2220) 품번이다. 두 회사가 1808·2010 규격 MLCC를 표준 라인업에 두지 않아 워크북이
그 시트를 한 치수 큰 품번으로 채웠다. 품번 자체는 1812·2220 시트에 정상적으로 있으므로
**잘못된 사이즈 배정 116셀만 버리며 MPN 손실은 0이다.**

교정 규칙은 그룹·EIA·제조사를 모두 지정한다. 사이즈만으로 버리면 정상 데이터인 `R_2010`의
Samsung 저항 28건까지 함께 사라진다(실제로 한 번 그렇게 잘못 걸렸다).

## 원본이 비워 둔 셀

빈 MPN 셀 676개는 오류가 아니라 사실이다.

- `R_1808`·`R_1812`·`R_2220`·`R_3025`: 5벤더 전부 공백인 행 112개.
  `risk_note`가 "일반 칩저항 표준 사이즈가 아님"이라 품번을 만들지 않았다.
- `C_2512`·`C_3025`의 Samsung·Murata 열 116셀: 두 회사가 해당 사이즈 MLCC를 만들지 않는다.

## 검증 등급

| 등급 | 행 | 부품 | 의미 |
|---|---:|---:|---|
| `PATTERN_CANDIDATE` | 737 | 2,618 | 품번 생성 규칙으로 만든 후보. 실존·수명주기 미확인 |
| `SAMPLE_VERIFIED_FOR_ALT_VENDOR_SET` | 4 | 10 | `03_Source_Refs`에 제조사 스펙시트 근거가 있는 표본 |

표본 검증은 0402 10kΩ 1%와 0402 100nF X7R 50V 두 사양뿐이다(사이즈 표기 중복 포함 4행).
이 10개만 `generatedMpn=false`다.

## 저장·판매 정책

워크북 대시보드가 "운영 전 DigiKey/Mouser/LCSC/제조사 API로 Active·재고·가격 검증 필요"라고
명시하므로 생성 품번 여부와 검증 상태는 원문 그대로 보존한다. 별도로 SamplePCB가 이 승인본을
자체 R/C 취급 카탈로그로 사용하기로 한 업무 정책에 따라, 문의 견적 선정은 허용하되 가격·재고를
워크북에서 추정하지 않는다.

- `catalog_metadata.catalogOnly=true`, `commercialDataAvailable=false`
- `generatedMpn=true`(표본 10개 제외), `verificationStatus`는 감사 정보
- `autoQuoteEligible=true`, `samplepcbPreferred=true`, AVL 역할 기반 우선순위
- 제조사 사실 오퍼와 SamplePCB 문의 오퍼를 함께 저장하고, 최초 가격대·재고·MOQ는 비운다

sp-node는 엔진 preflight의 정규화 쿼리로 로컬 후보만 검색하고, sp-engine이 사양·카테고리를
완전히 검증해 `automatic_selected`로 판정한 경우만 `catalog_selected`로 공개한다. 미해결 행은
기존 외부 공급사 검색으로 간다. 공급사 가격을 일회성 갱신하더라도 SamplePCB 오퍼에는 가격만
복사하며 외부 재고를 자체 재고로 표시하지 않는다. `parts-facts`에서는 실공급사 사실이
카탈로그 값을 우선한다.

로컬 적용 시점에 이미 **253개 부품이 digikey·mouser·unikeyic·samplepcb 오퍼와 공존**했다.
그만큼은 실존이 확인된 품번이며 가격 견적이 정상 동작한다.

## AVL 축

이 워크북의 고유 자산은 "같은 사양의 대체 5종" 관계다. 별도 축이 없으면 인제스트 과정에서
사라지므로 `catalog_metadata`에 보존한다.

- `avlGroupId`: `walsin-rlc:R:0402:10kΩ:1%` / `walsin-rlc:C:0402:100nF:±10%:50V:X7R`
- `avlRole`: `primary` | `alt1`~`alt4`
- `avlSiblings`: 같은 행의 나머지 제조사·품번

부품이 하나라도 있는 행 기준 **572개 그룹**이다.
