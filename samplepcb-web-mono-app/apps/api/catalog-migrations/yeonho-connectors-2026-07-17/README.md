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
