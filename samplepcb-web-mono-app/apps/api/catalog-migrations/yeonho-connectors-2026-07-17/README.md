# 연호전자 커넥터 카탈로그 마이그레이션

기준일 2026-07-17 연호전자 공식 카탈로그를 프로젝트 부품 저장 계약으로 정규화한 결과다.
원본 823행에서 완전히 동일한 `YW396-10B`·`YW396-11B`·`YW396-12B` 중복 3행을 접어
`(mpnNorm, manufacturerNorm)` 기준 820개 부품으로 구성했다.

## 파일

- `catalog-envelope.json`: `ingestSupplierSearchResultOnce()` 입력 계약. DB 저장과 ES 색인의 원본이다.
- `catalog-review.html`: 브라우저에서 바로 여는 검색·필터 검토 화면. DB·ES를 변경하지 않는다.
- `catalog-db-preview.json`: 적용 후 예상되는 `sp_part`·오퍼 행 820건의 읽기 전용 미리보기다.
- `catalog-es-preview.ndjson`: `buildPartDoc()` 기준 예상 ES 문서 820줄의 읽기 전용 미리보기다.
- `ANALYSIS.md`: 1차·v2 결과 교차검증과 채택·제외 판단을 기록한다.
- `migration-state.json`: `--apply` 직전에 운영 DB 상태를 기록하는 롤백 manifest. 실행 시 생성되며 Git에서 제외된다.

MPN은 공식 시리즈 패턴과 적용 핀 수로 전개한 값이다. 가격·재고·MOQ는 원본에 없으며,
실제 발주 전 suffix와 도면을 확인해야 한다. `IMAGE_STATUS=수집완료`가 아닌 26건은
정본 `image_url`을 `null`로 두었다.

## 운영 적용 — 배포 선행 필수

연호전자 부품을 운영의 DB·ES에서 검색하거나 BOM 후보와 연결하려면 이 마이그레이션을 먼저
적용해야 한다. **Git으로 코드를 받는 것만으로 데이터가 반영되지는 않으며**, 최소
`0051bce26` 커밋을 포함한 코드를 배포한 뒤 운영 서버에서 `--apply`를 별도로 실행해야 한다.

이 마이그레이션의 범위는 연호전자 카탈로그 부품 820개와 `supplier=yeonho` 오퍼를 DB에
저장하고 ES에 색인하는 것이다. 원본에 가격·재고가 없으므로 BOM 업로드에서 구매 가능한
오퍼를 만들거나 자동선정까지 보장하지 않는다. 적용 후 실제 MPN 검색과 카탈로그 연결은
가능하지만 가격이 필요한 견적 선정에는 별도의 공급사 오퍼가 필요하다.

리포 루트에서 최신 코드를 받은 뒤 모노레포 폴더에서 실행한다.

```bash
git pull origin main
cd samplepcb-web-mono-app
pnpm install --frozen-lockfile
pnpm --filter api parts:catalog -- --dry-run
pnpm --filter api parts:catalog -- --apply
```

`--dry-run`은 파일 검증과 운영 DB의 신규·기존 부품 수량 비교만 수행한다. `--apply`는 다음 순서로
실행되며 중간 실패 후 같은 명령을 다시 실행해도 fingerprint 원장과 upsert 키로 수렴한다.

1. 현재 대상 부품·동일 공급사 오퍼를 `migration-state.json`에 저장
2. 기존 카탈로그 인제스트 경로로 DB upsert
3. 변경 부품 ES bulk 색인 후 refresh 1회
4. DB 820개 키·연호 오퍼·ES 문서·색인 큐 검증
5. 6개 카테고리 대표 MPN의 하이픈 포함/제거 검색과 공급사 필터 검증

`--dry-run`에서 `inputParts=820`을 확인하고, `--apply` 결과의 `result`와
`verification.result`가 모두 `true`여야 완료다. 운영에 이미 일부 또는 전부 적용된 경우
`existingParts`와 `newParts`의 값은 달라질 수 있지만 합계는 820이어야 한다. 생성된
`migration-state.json`은 롤백에 필요하므로 서버 교체·재배포 전에 별도로 보관한다.
별도 재검증도 가능하다.

```bash
pnpm --filter api parts:catalog -- --verify
pnpm --filter api parts:catalog -- --verify-search
```

예상 불변식:

- 입력 부품 키 820개가 DB에 전부 존재
- 각 입력에 `supplier=yeonho` 카탈로그 오퍼 존재
- 카탈로그 가격구간 0개
- 대상 ES 문서 820개 존재
- 대상 `sp_part_index_queue` 잔여 0개
- Board to Board, FFC/BOARD, FFC/FPC, I/O Connector, Wire to Board, Wire to Wire 검색 통과

전체 카탈로그 초기화, `prisma migrate/reset`, ES 인덱스 삭제·재생성은 필요하지 않으며 실행하지 않는다.
운영 sp-node 프로세스는 이 커밋의 코드가 실제 서비스에 반영되도록 기존 배포 절차에 따라 재시작한다.

## 롤백

운영 적용 직전에 만들어진 `migration-state.json`을 사용한다.

```bash
pnpm --filter api parts:catalog -- --rollback
```

- 기존 부품에 있던 동일 오퍼는 가격구간과 원본 JSON까지 복원한다.
- 적용 도중 실패했더라도 manifest가 생성됐다면 부분 저장분을 롤백할 수 있다.
- 이번 실행으로 생성된 오퍼만 제거하고 다른 공급사 오퍼는 보존한다.
- 이번 실행으로 새로 만들어졌고 다른 실공급사 오퍼가 없는 부품만 삭제한다.
- 신규 부품이 이미 견적에서 참조되고 있으면 삭제를 거부하고 아무것도 롤백하지 않는다.
- 적용 뒤 동일 연호 오퍼가 다른 작업에서 변경됐다면 덮어쓰지 않고 롤백 전체를 거부한다.
- 남은 부품은 facts를 재계산하고 ES를 다시 색인한다.
- 인제스트 원장은 감사 이력을 남긴 채 `failed/reverted` 상태로 전환해 재적용할 수 있게 한다.

롤백 manifest는 적용 서버의 로컬 파일이므로 배포나 서버 교체 전에 별도 보관한다.

## 현재 검색 범위

현재 ES는 MPN prefix/infix, 제조사, 설명, 카테고리 텍스트를 검색한다. `pin_count`와 `pitch_mm`는
DB `specsJson`에 저장되지만 아직 ES의 구조화 필터 필드는 아니다. “1.25mm 8핀” 같은 조건 필터는
별도 추가형 ES 매핑과 검색 계약 확장이 필요하며, 이 데이터 마이그레이션에는 포함하지 않는다.
