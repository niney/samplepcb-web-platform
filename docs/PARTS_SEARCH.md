# 부품 카탈로그 — 저장(DB) · 색인(ES) · 상세 검색 (정본)

BOM 공급사 검색(sp-engine: Mouser/DigiKey/UniKeyIC)으로 발견된 부품을 **sp-node가 DB에
저장하고 ES에 색인**해, 단위·표기 다양성을 흡수하는 검색을 제공한다. 2026-07-18 구축.

```
sp-engine(Python)                sp-node                              ES 9.x (127.0.0.1:9200)
  공급사 검색·정규화      →   자동 인제스트(upsert DB + 색인)   →   sp-parts-v1 (alias sp-parts)
  SupplierProduct/Offer        Prisma sp_part* (진실원본)            검색 요약 문서(재구축 가능)
                               /api/admin/parts/search (ES)     ←   sp-vue /app/admin/parts
                               /api/admin/parts/:id (DB 상세)
```

- **DB = 진실원본, ES = 파생물** — `pnpm --filter api parts:reindex` 로 언제든 전량 재구축.
- 로컬 ES 는 **xpse 와 공유하는 단일 노드**(zip 설치, security off). 기존 인덱스(pcbparts 등)
  절대 불변 — 신규는 `sp-` prefix, `replicas: 0`. 운영 ES 는 보류(로컬만).
- 카탈로그는 사실 데이터 — BOM 매칭 상태(VERIFIED 등 문맥)는 저장하지 않는다.

## BOM 유형별 로컬 카탈로그 우선 조회와 fallback

sp-engine이 `resistor`·`capacitor`·`connector`로 판정한 행은 외부 공급사보다 자체
카탈로그를 먼저 조회한다. R/C는 값·패키지를 포함한 엔진 정규 스펙 또는 exact MPN으로
SamplePCB 카탈로그를 찾고, connector는 exact MPN으로 자체 커넥터 카탈로그를 찾는다.
`catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 먼저 반영하고 나머지만 외부
검색으로 보낸다. 정책은 공급사명이 아니라 부품 유형 기반이므로 현재 연호 원장 외에 다른
커넥터 원장이 추가돼도 같은 경로를 사용한다.

외부 공급사 검색 결과의 후보가 비었을 때는 다음 후속 fallback도 유지해 DB에 사전 적재한
제조사 카탈로그 후보를 복구한다.

1. **sp-engine**이 BOM의 대표 MPN·제조사·기술 사양을 정규화한다. `PINS`·`PITCH_mm`는
   구매 수량이 아니라 각각 `pin_count`·`pitch_mm`로 해석하고, 자리표시자 MPN(`NN`/`HNN`)과
   같은 행에 구체 MPN이 있으면 구체 MPN을 검색 정체성으로 사용한다.
2. 외부 검색 후보가 0건인 `not_found`·`supplier_error` 행만 **sp-node**가 로컬 DB에서
   exact `mpnNorm+manufacturerNorm`으로 배치 조회한다. 제조사 미상은 같은 MPN이 한 제조사에만
   존재할 때만 허용하며 prefix·infix 또는 제조사 교차 연결은 하지 않는다.
3. 조회 결과 중 `catalog_metadata.catalogOnly=true`인 제품을 최대 200행씩
   `POST /supplier-search/catalog-evaluate-batch`로 **sp-engine**에 돌려보낸다. 이 API는 외부
   공급사를 호출하지 않고 기존 matcher·후보 결정·조달 정책을 그대로 적용한다.
4. 카탈로그 원천 정보는 가격·재고가 확인되지 않았으므로 평가 API가 가격·재고·MOQ 필드를
   제거하고 가상 구매 조건을 만들지 않는다. 대신 정확 MPN·제조사와 엔진 자동선정 안전등급을
   모두 통과한 기술 1순위는 `catalog_selected`로 **부품만 선정**한다. 이때 candidate/partId는
   저장하지만 offerKey·selectedOffer·가격·재고는 비워 두고 `catalog_inquiry`를 함께 반환한다.
   화면은 **`선정됨 · 재고/가격 문의` / `문의 견적`**으로 표시하며 견적 합계에는 금액을 넣지
   않는다. 충돌·수동검토·비정확 후보는 기존처럼 선정하지 않는다.

따라서 로컬 조회·저장은 sp-node, 정규화·호환성·후보/조달 판정은 sp-engine이라는 역할 경계를
유지한다. `insufficient_input`·`input_conflict`·`excluded` 및 이미 외부 후보가 있는 행은 fallback
대상이 아니다.

## 설계 3원칙

1. **단위 지능은 ES 애널라이저가 아니라 TS 코드에** — 색인·검색이 같은 파서
   (`@sp/utils` `spec-units.ts`)를 쓴다. ES 애널라이저는 lowercase·ngram·edge_ngram 기본만.
   (xpse 는 커스텀 토크나이저에 로직을 넣었으나, 코드 쪽이 유닛테스트 가능하고 양쪽 불일치가
   원천 차단된다.)
2. **스펙 검색 2트랙**
   - Track A(수치): 모든 표기를 SI 기본단위 double(유효 6자리)로 정준화 → range ±0.1% 매칭.
     **접두 환산(4k7 = 4700 = 0.0047M, 2.2nF = 2200pF)이 구조적으로 해소**된다.
   - Track B(표기): 사람이 실제 치는 관행 표기만 `specVariants` 로 색인(2n2·472·104·0.1uf…),
     edge_ngram prefix 서브필드가 `2p`→`2p2` 부분 입력을 커버.
3. **해석은 should(가산점)만** — m/M(밀리/메가), 바닥 숫자(MPN?/Ω?/pF?), EIA 코드 vs MPN 조각
   등 모호성은 다중 해석 should 로 병렬 생성하고 실데이터가 랭킹으로 결정한다. 배타 필터는
   구조화 입력(패싯 클릭·범위)과 **알려진 패키지 코드**(메트릭 대응이 있는 0402↔1005 등)만.
   ("4700" 같은 값-토큰이 패키지 필터로 오승격되는 사고 방지 — `packageVariants(c).length > 1` 게이트.)

## 파일 지도

| 계층 | 파일 | 역할 |
|---|---|---|
| 정규화 코어 | `packages/utils/src/spec-units.ts` | kind-aware 파서(`parseSpecToken`/`parseQuery`)·변형 생성(`variantsFor`)·패키지(`normalizePackageCode`)·`SPEC_SI_FIELD`·`siRange` |
| 골든 벡터 | `packages/utils/src/spec-units.cases.json` | **요구사항 명세** — 함정 케이스 전건(104K 톨러런스 문자, 5mΩ/4.7MΩ, µ/μ/u, 콤마, R47, 1/8W…) |
| 계약 | `packages/api-contract/src/schemas/parts.ts` | PartSearchQuery/Response·PartDetail (Zod, `routes.adminParts`) |
| DB | `apps/api/prisma` `SpPart`·`SpPartOffer`·`SpPartPriceBreak`·`SpPartIndexQueue`·`SpPartIngestRun`·`SpBomSupplierResultArtifact` | upsert 키 part=(mpnNorm,manufacturerNorm)·offer=(partId,supplier,sku), 공급사 결과 fingerprint와 gzip 원본 복구 원장. 마이그레이션 `20260718110000_add_sp_parts_catalog` + `20260721120000_add_part_ingest_dedup` + `20260723090000_add_bom_supplier_result_artifact` (추가형, `migrate deploy` 전용) |
| ES | `apps/api/src/es/client.ts`·`sp-parts-index.ts` | 클라이언트(`ES_NODE_URL`, 기본 127.0.0.1:9200)·매핑(`satisfies estypes`)·필드 상수 `F`·부트스트랩(기동 시 인덱스+alias 생성) |
| 인제스트 | `apps/api/src/lib/parts-ingest.ts`·`parts-es.ts`·`bom-part-data.ts`·`manufacturer-alias.ts` | envelope→gzip 영속 원본→fingerprint singleflight→그룹핑(별칭 해소)→증분 upsert(tx)→ES bulk. 실패는 영속 작업과 `SpPartIndexQueue`로 자동 재시도 |
| 자동 훅 | `apps/api/src/lib/bom-engine-jobs.ts`·`routes/admin-bom.ts`·`routes/bom-quotes.ts` | 폴러가 결과를 한 번 읽고 견적 스냅샷을 먼저 반영한다. 카탈로그는 백그라운드 동기화하며 결과 GET이 백업 훅이다. |
| BOM 로컬 fallback | `apps/api/src/lib/bom-local-catalog.ts`·sp-engine `routes.py`/`service.py` | 외부 후보 0건의 exact 로컬 카탈로그를 배치 조회하고 엔진의 기존 판정기로 재평가한다. |
| 제조사 카탈로그 | `apps/api/src/scripts/import-parts-catalog.ts`·`lib/catalog-workbook-xlsx.ts`·`lib/yeonho-catalog-workbook.ts`·`lib/walsin-rlc-catalog-workbook.ts` | 워크북(xlsx)을 실행 시 검증·변환해 ingest envelope로 만든다. `CATALOG_SOURCES` 레지스트리에 원본별 파서를 등록하고 `--source`로 고른다(기본 `yeonho`). 원본별 계약은 `apps/api/catalog-migrations/*/README.md` |
| 검색 API | `apps/api/src/routes/admin-parts.ts` | `GET /api/admin/parts/search`(다중해석 쿼리 빌더+패싯+정렬, ES 다운 시 503 SEARCH_UNAVAILABLE)·`GET /:id`(DB 상세) |
| UI | `apps/web/src/pages/admin/AdminParts.vue`·`admin/useAdminParts.ts` | `/app/admin/parts` — 검색창+패싯+테이블+구매 조건 확장 |
| 재색인 | `apps/api/src/scripts/parts-reindex.ts` | `pnpm --filter api parts:reindex [--recreate]` — DB 전량→ES. 매핑 변경 시 `--recreate`(로컬) 또는 v2+alias 스왑(운영) |

## ES 매핑 요지 (`sp-parts-v1`)

- `mpnNorm`: text(edge_ngram 2..16, 프리픽스) + `.ngram`(4-gram — **쿼리도 같은 애널라이저 +
  operator AND = 인픽스 포함 의미**) + `.keyword`(정확)
- `specVariants`: keyword(lowercase normalizer) + `.prefix`(edge_ngram 1..12)
- SI 필드 8종: `resistanceOhm`·`capacitanceF`·`inductanceH`·`voltageV`·`currentA`·`powerW`·`frequencyHz`·`tolerancePct` (double)
- `packageVariants`: 임페리얼+메트릭 양코드(0402·1005) / `manufacturerName` keyword+`.norm`
- 요약 비정규화: `suppliers[]`·`offerCount`·`minPrice`(최소수량 구간 최저)·`totalStock`
- 구매 조건 상세는 ES 에 없음 — 상세 API 가 DB 에서 제공(문서 슬림 유지)

## 파싱 관례 (엔진 정합)

- 저항 무단위 `m` 은 관례상 **메가**(bom-extraction-engine `normalize_values` 정합).
  명시적 `Ω/ohm` 접미가 있으면 케이스 존중: `5mΩ`=밀리 high / `5MΩ`=메가 high(반대 해석 low 동반).
- 커패시턴스 무단위 `p/n/u`("100n")는 F 생략 관용. EIA 3자리 코드(104=100nF)는 엔진 미지원
  확장 — 검색 전용 low(+톨러런스 문자 104K 는 high).
- 패키지 메트릭↔임페리얼 표는 엔진 `_pkg_size_canon` 이식(무접두 4자리 = 임페리얼 우선).

## 운영 절차

- **ES 다운**: 앱은 뜬다 — 검색만 503, 인제스트는 DB 저장 + 큐 적재, 기동 시와 이후 1분마다
  `drainIndexQueue`를 중복 실행 없이 호출한다. 공급사 결과 영속 작업도 30초마다 재청구하므로 ES가
  복구되면 색인·견적 partId 연결·후보 화면 `ready`까지 사용자 조작 없이 자동 수렴한다.
- **중복·동시 실행(2026-07-21)**: 파일 해시가 아니라 실제 공급사 product/offer와
  ingest/facts/index 정책 버전으로 `sp_part_ingest_run.fingerprint`를 만든다. 같은 결과는 서버
  재시작·다중 인스턴스에서도 한 실행을 기다린 뒤 재사용한다. 서로 다른 결과가 같은 part에
  동시에 들어오면 part 행 잠금으로 직렬화하고, stale 구매 조건은 버리며 완전 동일 구매 조건은 쓰지 않는다.
  MySQL Prisma upsert의 최초 create 경합(`P2002`)은 unique key로 승자 행을 재조회해 이어가고,
  deadlock(`P2034`)과 연결 종료·접속/트랜잭션 시간초과(`P1001`·`P1002`·`P1017`·`P2028`)는
  `READ COMMITTED` 트랜잭션에서 최대 8회 지수 재시도한다. 운영 DB의 잠금 경합을 줄이기 위해
  DB 쓰기는 `PART_INGEST_DB_CONCURRENCY`(1~8)로 제한하며 미설정 기본은 운영 2·그 외 4다. 공급사 수집 시각만 새로우면 가격구간
  replace-all을 생략한다.
- **증분 파생물**: 정본 fingerprint가 바뀐 부품만 facts/samplepcb 구매 조건을 재계산하고, ES 문서
  fingerprint가 바뀐 부품만 200건 단위 bulk 색인한다. 색인 도중 DB가 다시 바뀌면 성공 시각을
  확정하지 않고 재시도 큐로 보낸다. 큐 행 자체를 ES 상태 불신 신호로 취급해 드레인 때는 DB의
  fingerprint 일치 여부와 무관하게 현재 DB 문서를 강제 색인하므로, 늦게 도착한 stale bulk도 복구한다.
  재시도 큐는 `attempts` 오름차순으로 드레인해(신규 행이 늘 우선) 기아를 구조적으로 없애고,
  연속 실패가 상한(20회≈20분)에 닿은 poison 행은 dead-letter로 제외한다. dead-letter는 그 부품에
  새 변경이 인제스트되면(`queuePartIndex`) `attempts`가 0으로 복귀해 자동 부활하고, 그 외엔 드레인
  경고 로그로만 남으므로 상한 상습 도달은 운영 점검 신호다.
- **백그라운드 무인 복구(2026-07-23)**: 폴러가 공급사 결과를 처음 읽을 때 원문을 gzip `LONGBLOB`
  (`sp_bom_supplier_result_artifact`)으로 먼저 보존한다. 서버 기동 시와 이후 30초마다 queued·failed 및
  lease가 만료된 running 작업을 최대 10건씩 직렬 재청구한다. 실패는 5초→최대 1분 지수 간격으로
  최대 20회 재시도하고, 그 전에는 고객 상태를 `preparing`으로 유지한다. 한도 소진·원본 손상만
  `dead/failed`로 끝나며 고객의 [다시 준비]가 시도 횟수를 초기화한다. 따라서 sp-node·sp-engine이
  재시작돼도 이미 한 번 수신한 공급사 결과는 재검색·재업로드 없이 DB·ES·견적 연결을 이어간다.
  영속 원장 도입 전에 생성돼 원문이 없는 기존 견적은 [다시 준비] 시 저장된 분석 스냅샷으로 공급사
  검색부터 강제 재개하므로 BOM 파일을 다시 올릴 필요가 없다.
- **제조사 카탈로그 적재(2026-07-26 walsin 추가)**: `pnpm --filter api parts:catalog -- --dry-run|--apply
  [--source <key>]`. 원본은 워크북 자체이고 SHA-256과 원본별 불변식(행 수·부품 수·중복 교정 건수 등)을
  전부 통과해야 입력이 만들어지므로, 파일이 바뀌면 적용 전에 멈춘다. 현재 `yeonho`(커넥터 1,606) ·
  `walsin-rlc`(저항·캐패시터 2,628)를 등록했다. **가격 근거가 없는 카탈로그 데이터는
  `offer_kind='manufacturer_catalog'` + `catalogOnly=true`로 실제 구매 조건과 분리한다.** Walsin 원본은
  제조사 원천 정보와 `samplepcb` 문의 견적 채널을 함께 저장한다. sp-node는 엔진 preflight가 돌려준
  정규화 R/C 쿼리 또는 connector exact MPN으로 유형별 로컬 ES 후보를 먼저 찾고, sp-engine
  `catalog-evaluate-batch`가 `automatic_selected`로 확정한 행만 문의 견적으로 선정한다.
  나머지만 외부 공급사 검색으로 보낸다.
  제조사 원천 정보는 기술 정본·원본 해시·교체/롤백 추적용이며 구매 채널이 아니다. 따라서
  `PartHit.suppliers`·공급사 패싯·`PartDetail.offers`에서는 숨기고, 같은 원본의 `samplepcb`
  문의 견적 채널만 구매 채널로 노출한다. 제조사/카탈로그 원천은 제조사 필드와 삭제 미리보기에 남는다.
  제조사 카탈로그 가격은 DB 적재 뒤 실시간 갱신하지 않는다. 초기화 전에
  `parts:catalog-prices -- --source <walsin-rlc|yeonho> --prepare [--resume]`로
  exact MPN+제조사를 전수 조회해 검증된 압축 스냅샷을 만들고,
  `parts:catalog -- --apply --source <key> --price-snapshot <file>` 한 번으로 원장과 함께
  적용한다. 원본별 작업 상태·스냅샷·manifest는 서로 다른 폴더를 사용하며, 공급사별
  분할 수집은 이미 확보한 다른 공급사 결과를 보존한 채 병합한다. 실제 공급사 구매 조건은 원본 가격·재고로
  저장·색인하고, 그중 가격곡선 한 개를 출처와 함께 SamplePCB 구매 조건에 복사한다. 외부 유통사 재고는
  자체 재고로 오인하지 않게 SamplePCB에서는 null로 둔다.
- **제조사 키 병합(2026-07-26 추가)**: `manufacturer-alias.ts`에 별칭을 추가해도 **이후 인제스트만**
  정규 키로 모이고 이미 저장된 행의 `manufacturerNorm`은 남는다(같은 품번이 둘로 보임). 과거 행 정리는
  `pnpm --filter api parts:merge-mfr -- --supplier <a,b,c> [--apply]`. 기준 공급사 구매 조건을 가진 정규 키
  부품과 **같은 MPN**이면서 표시명 별칭 해소 결과가 같은 회사인 행만 대상으로, 구매 조건·견적 `partId`를
  옮기고 과거 행을 지운 뒤 facts 재계산·ES 재색인/삭제까지 한다. 되돌릴 수 없으므로 운영은 백업 후
  dry-run 확인이 필수다. 적용 전 병합 계획과 삭제할 ES ID를 `.tmp` manifest에 기록하므로 중간 실패 뒤
  같은 명령을 재실행하면 DB 병합·재색인·과거 문서 삭제를 이어간다. **DB 전반은 아직 갈라져 있다** —
  `Vishay` 28갈래·`Murata` 5갈래 등, 전면 통합은 별칭 표 검토가 선행돼야 하는 미착수 과제다.
- **매핑 변경**: 로컬 `parts:reindex --recreate`. 운영(추후)은 `sp-parts-v2` 생성→재색인→
  alias(`sp-parts`/`sp-parts-write`) 스왑으로 무중단.
- **공급사 추가 체크리스트**: ① sp-engine 에 `SupplierClient` 구현 1개 ② (필요시) 계약의
  supplier 표시 문자열 — **DB/ES 스키마 변경 없음**(supplier 는 행 값).
- **하드 삭제·초기화(관리자, 2026-07-19, 2026-07-26 보호 강화)**: 부품 상세 [삭제] = 단건,
  검색 결과의 [필터 결과 전체 삭제] = 현재 페이지가 아닌 필터 일치 전건, 페이지 헤더
  [카탈로그 초기화] = 전체(`POST /parts/reset`, `confirm:'RESET_WITH_QUOTES'` 리터럴).
  단건은 견적 연결 시 `409 PART_IN_USE`, 전체 초기화는 `partId` 직접 연결 또는 카탈로그
  매칭·구매 조건 스냅샷이 남은 BOM 견적을 상태와 무관하게 견적 단위로 강제 삭제한 뒤
  카탈로그를 비운다(`sp_file` 메타데이터는 동기 삭제, 파일서버 원본은 응답을 막지 않는
  best-effort로 정리).
  필터 삭제는 서버가 ES 전건 ID+DB 구매 조건+견적 참조를 미리보기하고 hash·`DELETE N` 확인 후 실행하며,
  연결 부품만 보호하고 나머지를 삭제한다. **어떤 삭제 경로도 견적 partId를 임의 해제하지 않는다.**
  DB 구매 조건·가격구간 cascade 뒤 ES 대상 문서를 bulk 삭제하고 refresh 1회 수행하며, ES 실패분은 같은
  필터 삭제를 다시 실행해 정리한다. 카탈로그는 이후 BOM 공급사 검색 자동 인제스트로 재성장한다.

## 검증 (게이트 통과 기록, 2026-07-21)

- A: `pnpm --filter @sp/utils test` — 골든 벡터 **74/74** (4k7=0.0047M, 2p2=2.2pF=2200fF, 104K→100nF±10%, 16MHz, uF·µF·μF·㎌·공백 변형, Ω 변형, 콤마, 바닥숫자 다중해석)
- B: 실 DB+ES 통합(`PARTS_IT=1 vitest run parts-ingest.int`) — **2/2**: 잘못된 envelope 무저장, 제조사 별칭·다중 공급사 병합, 완전 동일 replay no-op, 영속 fingerprint 재사용, 가격구간 replace-all, stale 결과 역전 방지, Track A/B 히트
- B-1: DB `indexFingerprint`는 최신으로 둔 채 ES 문서만 stale 값으로 강제 덮고 큐를 적재한
  회귀 케이스에서, 드레인이 fingerprint 단락 없이 최신 DB 문서를 재색인하고 큐를 제거함을 실증했다.
- C: 실 ES 검색(`PARTS_IT=1 vitest run admin-parts.search.int`) — **27/27**: 저항·커패시터·인덕터 단위/관행 표기, uF·uf·µF·μF·㎌·공백 마이크로 표기, MPN prefix/infix, 0402↔1005·0603↔1608, 제조사·공급사·재고·SI 범위 필터, 가격·재고 정렬, 페이지네이션, 음성 케이스
- D: 견적 #109 영속 후보 2,424건(76 component에서 복원한 카탈로그 부품 2,228종)을 재생해
  최초 증분 DB 6.89s + ES bulk 4.05s = 10.97s, 동일 fingerprint 재호출 0.19s를 확인했다.
  InnoDB `P2034` 재현과 운영 재시도 소진을 반영해 현재는 4-worker·`READ COMMITTED`·최대 8회
  지수 백오프로 수렴한다.
- 통합 테스트는 `PARTS_IT=1` 옵트인 — turbo test/CI 에서 자동 skip.

## 다음 단계(미착수)

운영 ES 설치+deploy.sh 케이스 · xpse pcbparts 2,677건 이관 · EIA-96 코드 · nori ·
dense_vector 시맨틱 · 공급사 검색 결과 백그라운드 인제스트 관측 화면.

## 부품 정본·자체(samplepcb) 구매 조건 (2026-07-19 추가 — 커밋 참조)

부품 정본과 자체 구매 조건은 **"그 부품의 전체 실공급사 구매 조건"의 함수**다(`lib/parts-facts.ts`,
인제스트·수동 갱신·백필 `parts:refacts` 전 경로 끝에서 `applyPartFacts` 가 재생성 —
영속은 캐시, 소유권은 함수).

- **`resolvePartFacts`**: union 보강 + SI 상대오차 0.5% 게이트(표기·정밀도 차이≠충돌) +
  실충돌은 **다수결 → 공급사 신뢰순위(digikey>mouser>unikeyic) → 최신** 채택,
  전체 그룹을 `sp_part.specConflicts` 에 기록(관리자 목록 배지+상세 패널, ES `hasSpecConflict`).
  스펙 판정과 구매 조건 선정(상업 조건)은 분리 축 — 최저가 공급사의 오타 스펙이 정본을 오염 못 함.
  구 mergeSpecs 의 무감지 덮어쓰기·봉투 단위 병합(과거 공급사 스펙 유실) 결함 교정.
- **`deriveSamplepcbOffer`**: `supplier='samplepcb'` 영속 구매 조건 — 재고>0·KRW 우선·최소구간
  단가 최저 원천 **1개에서 통째 복사**(브레이크 혼합 금지), `rawJson.derivedFrom` 추적,
  fetchedAt=원천 시각(데이터 나이 정직). 향후 판매가/마진 정책의 유일한 적용 지점.
- **집계 규칙**: totalStock·minPrice 는 실공급사만(파생 이중 계산 방지), offerCount는
  실공급사와 SamplePCB 문의 견적 채널을 세고 제조사 카탈로그 원천은 제외한다. suppliers 패싯에는
  samplepcb를 포함하되 제조사 원천은 포함하지 않는다. BOM 견적 `pickDefaultOffer` 후보에서
  samplepcb 파생 구매 조건은 제외한다(순환 방지).
- **이미지(2026-07-20)**: 공급사 제품 사진 직링크를 정본으로 승격 — 엔진 `SupplierProduct.image_url`
  (Mouser `ImagePath`·DigiKey `PhotoUrl`·UniKeyIC `image_url|img`) → rawJson 경유
  `resolvePartFacts` 가 `sp_part.imageUrl`(신뢰순위→최신, 충돌 게이트 비대상) 채움 →
  ES `imageUrl`(index:false 표시 전용) → PartHit/PartDetail. **기존 적재분은 백필 불가**
  (도입 전 rawJson 에 이미지 없음) — 재검색·수동 갱신 시 점진 채움. 1차는 CDN 직링크
  (`referrerpolicy=no-referrer`+onerror 축퇴), 핫링크 차단 실측 시 파일서버 캐시 프록시 2차.
- 백필 실측: 6,469건 재계산 — 실충돌 298건(예: SD05T1G 3사 전압 9.8/5/14.5V — TVS 전압
  파라미터 해석차 포착), samplepcb 구매 조건 6,257건. 골든 15/15 + 통합 29/29(픽스처 prefix
  SPINGEST/SPTEST 분리로 병렬 레이스 교정).
