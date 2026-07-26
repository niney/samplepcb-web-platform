# Walsin R/C 카탈로그 마이그레이션

정본은 `Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx` 한 파일이다.
sp-node가 실행 시 워크북을 검증하고 기존 supplier-search ingest envelope로 결정적으로 변환하므로
중간 JSON·DB/ES 미리보기를 따로 관리하지 않는다.

데이터 근거와 판단은 [ANALYSIS.md](ANALYSIS.md)에 있다.

## 데이터 계약

- 기준일: `2026-07-06`
- 원본 SHA-256: `7aa0c323e02e11ec67086546f5dae47d38f83748732dea0eb463b3ef19433e6c`
- 부품: 2,628개 (저항 1,120 · 캐패시터 1,508)
- 제조사 7사: Walsin 572 · Yageo 572 · Samsung 456 · TDK 348 · Murata 232 · Vishay 224 · KOA 224
- 인덕터·페라이트(`LFB_*`) 13시트는 품번이 아니라 자리표시자라 적재하지 않는다
- 가격·재고·MOQ: 원본 근거가 없어 모두 없음
- `normalized_specs.part_type`: `resistor` | `capacitor`

파서는 파일 해시, 대시보드 버전, 26개 시트의 필수 헤더, 행 수(R 364 · C 377), 부품 수 2,628,
사이즈 표기 병합 285, 교차 사이즈 교정 116, 빈 벤더 셀 676, 빈 행 112, 표본 검증 행 4,
검증 등급·자동견적 등급 화이트리스트를 모두 통과해야만 입력을 만든다.
워크북이 바뀌면 승인된 해시와 달라져 적용 전에 중단된다.

## SamplePCB 판매 카탈로그 적재

전 품번의 규칙 생성 여부는 감사 정보로 보존하되, 이 승인본은 SamplePCB가 취급하는
R/C 카탈로그로 사용한다. 가격과 재고는 워크북에서 만들지 않는다.

- `catalog_metadata.catalogOnly=true`, `commercialDataAvailable=false`,
  `autoQuoteEligible=true`, `samplepcbPreferred=true`
- 부품마다 제조사 사실 오퍼 + `samplepcb` 판매 오퍼 2개를 저장한다. 둘 다
  `offer_kind='manufacturer_catalog'`이며 최초 가격대·재고는 없다.
- 제조사 사실 오퍼는 DB의 기술 사실·원본 추적에만 사용한다. 검색 API의 `suppliers`와
  구매 오퍼 상세에는 `samplepcb`만 노출하고, 제조사는 기존 제조사 필드와 삭제 미리보기의
  카탈로그 원본 영역에서 확인한다.
- sp-node는 BOM 외부 검색 전에 엔진이 정규화한 R/C 조건으로 SamplePCB ES 후보를 찾고,
  sp-engine의 `catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 문의 견적으로 선정한다.
- 미해결 행만 기존 DigiKey·Mouser·UniKeyIC 검색으로 넘긴다.
- AVL 역할은 `samplepcbPreferenceRank`(`primary=0`, `alt1=1`…)로 엔진 정렬에만 반영한다.
- `X5R/X7R` 복합 표기는 어느 한 유전체로 추정하지 않고 원문만 보존한다

## 실행

리포 루트에서 최신 코드를 받은 뒤 실행한다. Git pull만으로 DB·ES 데이터는 바뀌지 않는다.

```bash
cd samplepcb-web-mono-app
pnpm install --frozen-lockfile

pnpm --filter api parts:catalog -- --dry-run --source walsin-rlc
pnpm --filter api parts:catalog -- --apply   --source walsin-rlc
```

`--source`를 생략하면 기존 연호 카탈로그가 대상이다.

dry-run에서 확인할 값:

- `inputParts=2628`
- `generatedMpnParts=2618` (표본 검증 10개 제외)
- `commercialOffers=0`
- `catalogSuppliers`에 `samplepcb` 포함
- `existingParts`: 이미 실공급사 오퍼로 존재하는 부품 수 — 그만큼이 승격 대상

`--apply` 완료 조건:

- 최상위 `result=true`
- `verification.result=true`
- `inputParts=dbParts=esDocuments=2628`
- `engineCatalogChecks`가 supplier×category 표본을 모두 반환하고 선정 가능 후보가
  `catalog_selected`임
- `failures=[]`

동일 명령 재실행은 안전하다(fingerprint/upsert 재사용).

검증만 따로:

```bash
pnpm --filter api parts:catalog -- --verify        --source walsin-rlc
pnpm --filter api parts:catalog -- --verify-search --source walsin-rlc
```

## 운영 적용 순서

운영 서버에서는 코드와 데이터 적용을 분리한다. 이 변경은 DB 스키마 마이그레이션이 없으며
`prisma migrate reset/dev`를 실행하지 않는다.

```bash
cd /home/samplepcb/samplepcb-web-platform

# 1. 적용 전 공유 DB 백업
mysqldump --default-character-set=utf8 samplepcb > ~/backup-walsin-$(date +%F-%H%M).sql

# 2. sp-engine 먼저, 이어서 sp-node+sp-vue 배포
./deploy.sh 10
./deploy.sh 5

# 3. 배포 확인
curl -fsS http://127.0.0.1:8400/health
curl -fsS https://centrafab.co.kr/api/health

# 4. 원본 검증 후 DB·ES 적재
cd samplepcb-web-mono-app
pnpm --filter api parts:catalog -- --dry-run --source walsin-rlc
pnpm --filter api parts:catalog -- --apply   --source walsin-rlc
pnpm --filter api parts:catalog -- --verify-search --source walsin-rlc
```

`deploy.sh 5`의 마이그레이션 질문에는 이번 변경이 추가·삭제하는 스키마가 없으므로 파괴적
중단이 필요 없다는 의미로 기본값 `N`을 선택한다. 이미 Walsin 카탈로그가 적재된 운영 DB에
코드만 갱신하는 경우에는 공급사 투영 변경을 기존 ES 문서에 반영한다.

```bash
pnpm --filter api parts:reindex
```

관리자 `/app/admin/parts`에서 Walsin 제조사 필터 결과의 공급사 패싯·행·상세가
`SamplePCB`만 표시되고, 가격과 재고가 각각 `문의 견적`·`재고 확인`인지 확인한다.

## 공급사 가격 1회 갱신

적재 뒤 MPN별 실제 공급사 가격을 한 번 조회해 SamplePCB 오퍼의 참고 가격으로 보존할 수 있다.
외부 유통사 재고는 SamplePCB 보유 재고가 아니므로 **가격만 복사하고 자체 재고는 계속 null**이다.
정확 MPN+제조사 후보만 인제스트하여 파라메트릭 대체 후보가 카탈로그를 불리는 일도 막는다.

```bash
# DB 대상 수만 확인 — 외부 API 호출 없음
pnpm --filter api parts:catalog-prices

# 처음 실행
pnpm --filter api parts:catalog-prices -- --apply

# 중단·오류 뒤 재개
pnpm --filter api parts:catalog-prices -- --apply --resume

# not_found/가격 없음도 다시 조회할 때만
pnpm --filter api parts:catalog-prices -- --apply --resume --retry-misses
```

기본 동시성은 2, MPN당 호출 상한은 12다. 운영 상황에 따라 `--concurrency 1..8`,
`--max-calls 1..100`, 부분 검증은 `--limit N`을 쓴다. 진행 상태
`price-refresh-state-walsin-rlc.json`은 매 배치 저장되고 Git에서 제외된다.
따라서 운영 서버에서 시작한 상태 파일은 해당 서버에 보관하고 같은 서버에서 `--resume`한다.
카탈로그를 다시 초기화했다면 이전 가격 상태 파일을 재사용하지 말고 별도 보관 후 새 실행을 시작한다.

## 제조사 키 병합 (적재 후 1회)

이 워크북은 `Samsung`·`KOA`·`Vishay`·`Walsin`처럼 짧은 표기를 쓴다. DB에는 유통사 표기로 들어온
`Samsung Electro-Mechanics`·`KOA Speer`·`Vishay Dale`·`Walsin Technology Corporation` 행이 이미
있어 같은 품번이 둘로 보인다. `manufacturer-alias.ts`에 별칭을 넣어도 **이후 인제스트만** 정규 키로
모이고 기존 행은 그대로 남으므로, 적재 뒤 한 번 병합한다.

```bash
pnpm --filter api parts:merge-mfr -- --supplier walsin,yageo,samsung,murata,tdk,vishay,koa
pnpm --filter api parts:merge-mfr -- --supplier walsin,yageo,samsung,murata,tdk,vishay,koa --apply
```

기준 공급사 오퍼를 가진 **정규 키 부품과 같은 MPN**이면서 표시명을 별칭 해소하면 같은 회사가 되는
과거 행만 대상이다. 오퍼와 견적 `partId`를 정규 키 행으로 옮기고 과거 행을 지운 뒤 facts 재계산과
ES 재색인·삭제까지 한다. 같은 `(supplier, sku)`가 양쪽에 있으면 목적지 값을 정본으로 두고 과거 행
것을 버린다(같은 공급사이므로 다음 수집에서 갱신된다).

`--apply`는 DB 변경 전에 전체 병합 계획과 삭제할 source part ID를
`.tmp/manufacturer-key-merge-*.json`에 기록한다. 중간에 DB·ES·프로세스 오류가 나면 **같은 명령을
다시 실행**한다. 이미 삭제된 DB source도 manifest의 ID로 ES 정리를 재개한다. 다른 경로를 쓰려면
`--manifest <path>`를 명시한다.

2026-07-26 로컬 실행 결과: 부품 60 병합(`walsintechnology→walsin` 10 · `vishaydale→vishay` 20 ·
`vishayintertechnology→vishay` 13 · `samsungelectromechanics→samsung` 9 · `koaspeer→koa` 8),
오퍼 190 이전, 중복 오퍼 24 폐기, 견적 라인 8 재연결, 잔여 0.

**이 병합은 되돌릴 수 없다.** 운영에서는 DB 백업 후 dry-run 결과를 확인하고 실행한다.

## 되돌리기

이 원본은 교체할 구 데이터가 없어 `--apply` 경로로 적용한다. 따라서 manifest 기반
`--rollback`을 그대로 쓸 수 있다.

```bash
pnpm --filter api parts:catalog -- --rollback --source walsin-rlc
```

적용 직전 상태는 `migration-state-Parts_Eyes_RLC_Size_Split_Expanded_AVL.json`에 기록되며
Git에서 제외된다. 롤백이 필요할 수 있는 동안에는 이 파일을 보관한다.

다음 개정판에서는 7개 제조사 supplier를 함께 지원하는 교체 경로를 사용한다.

```bash
pnpm --filter api parts:catalog -- --replace --source walsin-rlc \
  --retire-source-sha <이전-원본-SHA256>
```

## 남은 일

- 가격 1회 갱신은 공급사에서 정확 MPN을 반환한 품목만 채운다. `not_found`와
  `found_without_price`는 상태 파일에 남으므로 제조사 원장 확인 대상으로 활용한다.
- 관리자 부품 검색·BOM 후보 화면에서 `verificationStatus=PATTERN_CANDIDATE`를 시각적으로
  구분하는 일은 아직 하지 않았다. 데이터 계약(`catalog_metadata`)에는 값이 들어 있다.
- AVL 축(`avlGroupId`·`avlRole`·`avlSiblings`)은 DB에만 있고 API 응답 스키마에는 없어 화면에
  노출되지 않는다. 대체품 추천에 쓰려면 계약과 라우트에 필드를 추가해야 한다.
- 제조사 키 갈라짐은 이 워크북과 무관한 부품에도 널리 있다(`Vishay` 28갈래, `Murata` 5갈래,
  `Samsung`·`KOA`·`TDK` 각 3갈래). 위 병합은 이 워크북과 같은 MPN인 60건만 처리했다.
  카탈로그 전반 통합은 별칭 표 정확성 검토가 선행돼야 하는 별도 과제다.
