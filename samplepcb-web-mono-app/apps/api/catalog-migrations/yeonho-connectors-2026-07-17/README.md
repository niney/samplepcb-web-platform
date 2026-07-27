# 연호전자 커넥터 Rev2 교체 마이그레이션

정본은 `연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx` 한 파일이다.
sp-node가 실행 시 워크북을 검증하고 기존 supplier-search ingest envelope로 결정적으로 변환하므로,
대용량 JSON·DB/ES 미리보기·HTML 복제본은 더 이상 함께 관리하지 않는다.

## 데이터 계약

- 기준일: `2026-07-26`
- 원본 SHA-256: `8612d52bb7858f3a994d9fed0e1d7e1bb706bdf233a9794e231600d9a103a9e6`
- 공식 MPN: 1,606개
  - 승인도 표에 직접 기재: 1,239개 (`OFFICIAL_MPN`)
  - 주문코드와 핀 표로 전개: 367개 (`OFFICIAL_DERIVED`)
- 공식 시리즈: 91개
- 제조사 정규키: `yeonho`
- 가격·재고·MOQ: 원본 근거가 없어 모두 없음
- `normalized_specs.part_type`: 전체 `connector`
- 세부 구성 유형은 `connector_component_type`에 Housing/Wafer/Terminal/Connector/Receptacle로 보존
- 핀 수가 원본에 없는 32개는 `pin_count`를 만들지 않는다.
- 모든 공식 MPN은 제조사 원천 오퍼와 `samplepcb` 문의 오퍼를 함께 가지며,
  공급사 가격 스냅샷이 있으면 SamplePCB 오퍼에만 검증된 가격곡선을 덧붙인다.

파서는 파일 해시, 필수 시트·헤더, MPN 정규화와 유일성, 직접/전개 두 시트의 합집합,
시리즈 참조, 카테고리·피치, URL, 12505 공식 품번 검증을 모두 통과해야만 입력을 만든다.
워크북이 바뀌면 승인된 해시와 달라져 적용 전에 중단된다.

## 구 데이터 교체

구 데이터는 생성 규칙이 잘못된 820개 카탈로그이며 다음 source hash로만 식별한다.

```text
35167e82504b04a569edaabd0ab0793ff57d3f8e3f0e6e8f4ca086a13ff7b9b4
```

교체는 전체 인덱스나 공급사 이름으로 지우지 않는다. `supplier=yeonho`,
`catalog_metadata.catalogOnly=true`, 위 source hash가 모두 일치하는 오퍼만 대상으로 한다.

1. Rev2 1,606개를 먼저 upsert하고 DB·ES·검색을 검증한다.
2. 공통 520개는 같은 `(mpnNorm, manufacturerNorm)` part를 재사용한다.
3. Rev2 적용 뒤에도 구 source hash가 남은 오퍼만 제거한다.
4. 다른 실공급사 오퍼가 있는 part는 facts를 재계산하고 재색인한다.
5. 다른 실공급사 오퍼가 없는 part는 견적 참조가 0건일 때만 DB·ES에서 제거한다.
6. 견적 참조가 있으면 새 데이터 적용 전 안전 검사에서 전체 교체를 거부한다.
7. 마지막에 구 source 오퍼 0건, Rev2 DB·ES 1,606건, 색인 큐 0건을 다시 검증한다.

로컬 기준 dry-run 결과는 공통 520개, 신규 1,086개, Rev2에서 제외되는 구 part 300개이며
견적 참조 차단은 0건이었다. 운영 DB에서는 반드시 아래 dry-run 결과를 다시 확인한다.

## 운영 실행

리포 루트에서 최신 코드를 받은 뒤 실행한다. Git pull만으로 DB·ES 데이터는 바뀌지 않는다.

```bash
cd samplepcb-web-mono-app
pnpm install --frozen-lockfile

pnpm --filter api parts:catalog -- \
  --dry-run \
  --retire-source-sha 35167e82504b04a569edaabd0ab0793ff57d3f8e3f0e6e8f4ca086a13ff7b9b4

pnpm --filter api parts:catalog -- \
  --replace \
  --retire-source-sha 35167e82504b04a569edaabd0ab0793ff57d3f8e3f0e6e8f4ca086a13ff7b9b4
```

dry-run에서 확인할 값:

- `inputParts=1606`
- `replacement.oldSourceOffers`: 현재 운영에 남은 구 원본 오퍼 수
- `replacement.overlappingReplacementParts`: 구/신 공통 키
- `replacement.retireOnlyParts`: Rev2에서 폐기될 구 키
- `replacement.blockedQuoteReferences=[]`

`--replace` 완료 조건:

- 최상위 `result=true`
- `verification.result=true`
- `retiredSourceRemainingOffers=0`
- `finalVerification.result=true`
- `finalVerification.inputParts=dbParts=esDocuments=1606`
- `finalVerification.failures=[]`

동일 명령 재실행은 안전하다. 새 ingest는 fingerprint/upsert로 재사용되고, 이미 제거된 구 source는
0건 제거 성공으로 처리된다. 중간 실패가 나면 원인을 해결한 뒤 같은 `--replace` 명령을 다시 실행한다.

별도 검증:

```bash
pnpm --filter api parts:catalog -- --verify
pnpm --filter api parts:catalog -- --verify-search
```

## 공급사 가격 사전 데이터

연호 원본에는 가격·재고가 없으므로 운영 요청마다 공급사 API를 호출하지 않는다. 배포 전에
공식 MPN 1,606개를 `MPN 정확 일치 + manufacturerNorm=yeonho`로 한 번 전수 조회하고,
검증된 `prepared-prices/yeonho-price-snapshot-v1.json.gz`를 기초 산출물로 보존하고,
Eleparts·ICBanQ 가격을 합친 현재 적용본은
`prepared-prices/v2/yeonho-price-snapshot-v2.json.gz`로 보존한다.
동일 MPN의 다른 제조사와 유사 커넥터는 가격 근거에서 제외한다.

로컬 생성과 재개:

```bash
cd samplepcb-web-mono-app

pnpm --filter api parts:catalog-prices -- --source yeonho
pnpm --filter api parts:catalog-prices -- \
  --prepare --source yeonho --suppliers mouser,unikeyic
pnpm --filter api parts:catalog-prices -- \
  --prepare --resume --retry-supplier-errors --source yeonho --suppliers digikey
pnpm --filter api parts:catalog-prices -- \
  --verify --source yeonho
```

공급사별 분할 수집은 이전 공급사의 상품·오퍼를 보존하고 재조회한 공급사 결과만 교체한다.
작업 중 `work-state.json`은 Git에서 제외하며, 확정 스냅샷은 원본 SHA·coverage·가격구간을
manifest와 함께 검증한다. 모든 공급사가 오류 없이 조회된 산출물만 요구할 때는 검증 명령에
`--require-all-suppliers`를 추가한다.

2026-07-27 생성본은 1,606개 전체 coverage와 파일 해시 검증을 통과했다. Mouser·UniKeyIC
조회에서 exact MPN+연호 제조사 가격 3개(`SMH200-04`, `SMH250-02`, `YST200`)를 확보했고,
나머지 1,603개는 문의 견적으로 유지한다. 당시 DigiKey는 HTTP 429로 전수 조회가 불가능했고
Mouser 279건은 HTTP 403을 반환했다. 따라서 현재 manifest의 `supplierErrorRecords=1606`은
인제스트 실패가 아니라 공급사 미조회·오류 감사 표시이며, 표준 `--verify`는 통과하지만
`--require-all-suppliers`는 1,885개 경고를 정확히 거부한다.

국내 판매처 가격은 Walsin과 같은 공용 수집기로 별도 전수 확인한다. 스크립트는 연호
워크북과 가격 스냅샷 정의를 `--source yeonho`로 선택하며, 사이트별 요청은 500ms 이상
간격으로 직렬 실행한다. 정확 MPN과 `manufacturerNorm=yeonho`가 모두 맞아야 가격으로
인정하고 재고·MOQ·주문배수는 추정하지 않는다.

```bash
pnpm --filter api parts:catalog-market-prices -- --source yeonho --site eleparts
pnpm --filter api parts:catalog-market-prices -- --source yeonho --site icbanq

pnpm --filter api parts:catalog-market-prices -- \
  --source yeonho --run --site eleparts --delay-ms 500
pnpm --filter api parts:catalog-market-prices -- \
  --source yeonho --run --site icbanq --delay-ms 500

pnpm --filter api parts:catalog-market-prices -- \
  --source yeonho --verify --site eleparts
pnpm --filter api parts:catalog-market-prices -- \
  --source yeonho --verify --site icbanq
pnpm --filter api parts:catalog-market-prices -- --source yeonho --merge
```

2026-07-27 전수 결과:

- Eleparts: 가격 101개, 미발견 1,505개, 오류 0개, 요청 1,606회
- ICBanQ: 가격 101개, 제조사 충돌 54개, 미발견 1,451개, 오류 0개,
  요청 1,843회
- 국내 판매처 합집합: 162개(공통 40 · Eleparts 전용 61 · ICBanQ 전용 61)
- 공통 40개 가격 비교: Eleparts 저가 39개 · 동가 1개 · ICBanQ 저가 0개
- 공식 직접 품번 160개, 공식 전개 품번 2개
- v1 대비 가격 보유: 3개 → 162개(+159)

ICBanQ 제조사 충돌은 동일 MPN 자동완성 결과의 상세 페이지 제조사가 연호가 아닌 경우며,
전부 가격에서 제외했다. 두 국내 판매처 오퍼는 각각 보존하고 SamplePCB 가격 파생에서는
부가세 포함 KRW 단가가 낮은 쪽을 사용하며 동가면 Eleparts를 우선한다.

카탈로그가 비어 있는 운영 환경에는 다음 순서로 적용한다.

```bash
cd samplepcb-web-mono-app

pnpm --filter api parts:catalog -- --dry-run --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz

pnpm --filter api parts:catalog -- --apply --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz

pnpm --filter api parts:catalog -- --verify-search --source yeonho \
  --price-snapshot catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices/v2/yeonho-price-snapshot-v2.json.gz
```

구 원본 교체가 필요한 운영 환경에서는 위 `--replace`를 먼저 완료한 다음, 별도 `--apply
--source yeonho --price-snapshot ...` 실행으로 가격을 추가한다. `--replace`와
`--price-snapshot`은 한 명령에서 섞지 않는다.

외부 공급사 오퍼에는 조회 시점의 가격·재고를 그대로 저장한다. SamplePCB 오퍼는 선택된
외부 오퍼 한 개의 전체 가격곡선과 출처만 복사하며 외부 재고는 자체 재고로 복사하지 않는다.
외부 가격이 없는 연호 품목도 SamplePCB `문의 견적`으로 유지된다.

`--apply`는 입력만 추가·갱신하고 구 source를 제거하지 않으므로 최초 운영 교체에는 사용하지 않는다.
전체 카탈로그 초기화, `prisma migrate/reset`, ES 인덱스 삭제·재생성은 필요하지 않으며 실행하지 않는다.

## manifest와 복구 범위

적용 직전 상태는 기본적으로
`migration-state-연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.json`에 기록되고 Git에서 제외된다.
이 파일은 중단된 교체가 DB에서 이미 사라진 part의 ES 문서까지 다음 실행에서 제거하는 데 필요하므로
서버 교체 전에 별도로 보관한다.

`--replace`는 Rev2 미포함 구 품번까지 제거하는 일방향 교체라 CLI의 부분 `--rollback`을 허용하지 않는다.
부분 복원은 DB·ES 정합성을 더 나쁘게 만들 수 있기 때문이다. 운영 교체 전 DB 백업을 유지하고, 정상적인
중간 실패는 같은 `--replace` 명령으로 수렴시킨다. 교체 자체를 되돌려야 할 때만 DB 백업을 복원하고
부품 인덱스를 DB에서 재구축한다. 기존 `--apply` 전용 manifest에는 종전 `--rollback` 기능을 계속 사용할 수 있다.
