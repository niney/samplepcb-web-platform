# 연호전자 공식품번 Rev2 분석

## 결론

Rev2는 이전 820개 생성형 데이터의 단순 증분이 아니라 공식 승인도 근거를 다시 해석한 교체 정본이다.
기존 JSON 산출물은 제거하고 워크북 자체를 유일한 입력으로 사용한다.

| 항목 | 구 데이터 | Rev2 |
|---|---:|---:|
| 원본 기준일 | 2026-07-17 | 2026-07-26 |
| 고유 MPN | 820 | 1,606 |
| 직접 확인 MPN | 0 | 1,239 |
| 승인도 주문코드 전개 | 820 | 367 |
| 공식 시리즈 | 기존 분석 90 | 91 |
| 구/신 공통 정규키 | - | 520 |
| 구 데이터에만 존재 | - | 300 |
| Rev2에만 존재 | - | 1,086 |

구 데이터의 모든 MPN은 `generatedMpn=true`였고 일부 시리즈에서 실제 공식 주문코드가 아닌 값을
만들었다. 워크북 `12505_검증`은 대표 오류인 `12505-08`을 명시적으로 제외하고
`12505WS-08`, `12505HS-08`, `12505WR-08`, `12505TS-1` 등 승인도 근거 품번을 보존한다.

## Rev2 불변식

- `OFFICIAL_MPN_DB`: 1,606행, 정규 MPN 중복 0
- `정식품번_직접확인`: 1,239행
- `주문코드_승인도전개`: 367행
- 두 검증 시트는 서로 겹치지 않고 합집합이 `OFFICIAL_MPN_DB`와 정확히 동일
- `시리즈_카탈로그`: 91행, 모든 `SERIES_IDS` 참조 유효
- 모든 부품은 참조 시리즈 중 하나와 카테고리·피치·family pattern이 일치
- 공식 이미지·PDF·분류 URL은 구조적으로 유효
- 핀 수 공백 32건은 오류가 아니라 Terminal 30건, Connector 2건의 원본 사실

카테고리:

| 카테고리 | 수량 |
|---|---:|
| Board to Board | 138 |
| FFC/BOARD | 20 |
| FFC/FPC | 457 |
| I/O Connector | 6 |
| Wire to Board | 917 |
| Wire to Wire | 68 |

구성 유형:

| 유형 | 수량 |
|---|---:|
| Housing | 843 |
| Wafer | 613 |
| Terminal | 30 |
| Connector | 113 |
| Receptacle | 7 |

## 적용 모델

워크북 파서는 MPN을 하나의 supplier-search 후보 product로 변환한다. 전체 검색 축은
`part_type=connector`로 유지하고, 세부 구성 유형은 별도 `connector_component_type`에 둔다.
`OFFICIAL_DERIVED` 367건만 `generatedMpn=true`와
`orderCodeConfirmationRecommended=true`를 갖는다.

원본에는 판매 가격·재고·MOQ가 없으므로 `yeonho` 구매 조건은 제조사 카탈로그 정체성 근거일 뿐
실제 판매 조건이 아니다. 같은 원본에 SamplePCB 문의 견적 채널을 별도로 두어 자체 취급 품목으로
선정하고, 가격 기반 견적에는 exact MPN+제조사로 한 번 확인한 별도 실공급사 구매 조건만 사용한다.
실공급사 가격을 찾으면 그중 한 구매 조건의 전체 가격곡선과 출처를 SamplePCB 구매 조건에 복사하되,
외부 재고는 SamplePCB 보유 재고로 간주하지 않는다.

## 교체 안전성

제거 조건은 supplier 이름만이 아니라 구 source SHA-256과 `catalogOnly=true`까지 모두 요구한다.
새 정본 적용·검증이 먼저 끝난 뒤 남아 있는 구 source만 제거하므로 공통 520개 part ID가 보존된다.
다른 공급사 구매 조건과 견적 참조를 각각 검사하며, 견적이 참조하는 고립 part가 하나라도 있으면 적용 전에
중단한다. 제거는 재실행 가능하고 ES는 대상 문서만 갱신·삭제한 뒤 refresh한다.

로컬 DB 읽기 전용 dry-run:

```text
inputParts                 1606
existingParts               520
newParts                   1086
oldSourceOffers              820
overlappingReplacementParts  520
retireOnlyParts              300
retainedByOtherSupplier        0
blockedQuoteReferences         0
```

실제 운영 값은 운영 DB 상태에 따라 달라질 수 있으므로 `README.md`의 dry-run과 완료 불변식을
배포 시 다시 확인한다.
