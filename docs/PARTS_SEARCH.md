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
| DB | `apps/api/prisma` `SpPart`·`SpPartOffer`·`SpPartPriceBreak`·`SpPartIndexQueue` | upsert 키 part=(mpnNorm,manufacturerNorm)·offer=(partId,supplier,sku). 마이그레이션 `20260718110000_add_sp_parts_catalog` (추가형, `migrate deploy` 전용) |
| ES | `apps/api/src/es/client.ts`·`sp-parts-index.ts` | 클라이언트(`ES_NODE_URL`, 기본 127.0.0.1:9200)·매핑(`satisfies estypes`)·필드 상수 `F`·부트스트랩(기동 시 인덱스+alias 생성) |
| 인제스트 | `apps/api/src/lib/parts-ingest.ts`·`parts-es.ts`·`manufacturer-alias.ts` | envelope→그룹핑(별칭 해소)→upsert(tx)→색인. 실패는 `SpPartIndexQueue` 적재, 기동 시 드레인 |
| 자동 훅 | `apps/api/src/routes/admin-bom.ts` | ① 공급사 검색 시작 202 → 서버측 폴러(5s·최대 10분) ② 결과 GET 200 → fire-and-forget 백업. 인제스트는 idempotent — 중복 안전 |
| 검색 API | `apps/api/src/routes/admin-parts.ts` | `GET /api/admin/parts/search`(다중해석 쿼리 빌더+패싯+정렬, ES 다운 시 503 SEARCH_UNAVAILABLE)·`GET /:id`(DB 상세) |
| UI | `apps/web/src/pages/admin/AdminParts.vue`·`admin/useAdminParts.ts` | `/app/admin/parts` — 검색창+패싯+테이블+오퍼 확장 |
| 재색인 | `apps/api/src/scripts/parts-reindex.ts` | `pnpm --filter api parts:reindex [--recreate]` — DB 전량→ES. 매핑 변경 시 `--recreate`(로컬) 또는 v2+alias 스왑(운영) |

## ES 매핑 요지 (`sp-parts-v1`)

- `mpnNorm`: text(edge_ngram 2..16, 프리픽스) + `.ngram`(4-gram — **쿼리도 같은 애널라이저 +
  operator AND = 인픽스 포함 의미**) + `.keyword`(정확)
- `specVariants`: keyword(lowercase normalizer) + `.prefix`(edge_ngram 1..12)
- SI 필드 8종: `resistanceOhm`·`capacitanceF`·`inductanceH`·`voltageV`·`currentA`·`powerW`·`frequencyHz`·`tolerancePct` (double)
- `packageVariants`: 임페리얼+메트릭 양코드(0402·1005) / `manufacturerName` keyword+`.norm`
- 요약 비정규화: `suppliers[]`·`offerCount`·`minPrice`(최소수량 구간 최저)·`totalStock`
- 오퍼 상세는 ES 에 없음 — 상세 API 가 DB 에서 제공(문서 슬림 유지)

## 파싱 관례 (엔진 정합)

- 저항 무단위 `m` 은 관례상 **메가**(bom-extraction-engine `normalize_values` 정합).
  명시적 `Ω/ohm` 접미가 있으면 케이스 존중: `5mΩ`=밀리 high / `5MΩ`=메가 high(반대 해석 low 동반).
- 커패시턴스 무단위 `p/n/u`("100n")는 F 생략 관용. EIA 3자리 코드(104=100nF)는 엔진 미지원
  확장 — 검색 전용 low(+톨러런스 문자 104K 는 high).
- 패키지 메트릭↔임페리얼 표는 엔진 `_pkg_size_canon` 이식(무접두 4자리 = 임페리얼 우선).

## 운영 절차

- **ES 다운**: 앱은 뜬다 — 검색만 503, 인제스트는 DB 저장 + 큐 적재, 기동 시 `drainIndexQueue`.
- **매핑 변경**: 로컬 `parts:reindex --recreate`. 운영(추후)은 `sp-parts-v2` 생성→재색인→
  alias(`sp-parts`/`sp-parts-write`) 스왑으로 무중단.
- **공급사 추가 체크리스트**: ① sp-engine 에 `SupplierClient` 구현 1개 ② (필요시) 계약의
  supplier 표시 문자열 — **DB/ES 스키마 변경 없음**(supplier 는 행 값).
- **하드 삭제·초기화(관리자, 2026-07-19)**: 부품 상세 [삭제] = 단건, 페이지 헤더
  [카탈로그 초기화] = 전체(`POST /parts/reset`, `confirm:'RESET'` 리터럴). 둘 다 오퍼·가격구간
  DB cascade + ES 문서 삭제, **견적 라인은 partId 만 해제**(오퍼 스냅샷·합계 보존 — 박제 원칙).
  되돌릴 수 없어 UI 는 2단계 인라인 확인(5초 자동 해제). 카탈로그는 자동 인제스트로 재성장.

## 검증 (게이트 통과 기록, 2026-07-19)

- A: `pnpm --filter @sp/utils test` — 골든 벡터 **74/74** (4k7=0.0047M, 2p2=2.2pF=2200fF, 104K→100nF±10%, 16MHz, uF·µF·μF·㎌·공백 변형, Ω 변형, 콤마, 바닥숫자 다중해석)
- B: 실 DB+ES 통합(`PARTS_IT=1 vitest run parts-ingest.int`) — **2/2**: 잘못된 envelope 무저장, 제조사 별칭·다중 공급사 병합, 동일 오퍼 최신 스냅샷 선택, 가격구간 replace-all, stale 결과 역전 방지, Track A/B 히트
- C: 실 ES 검색(`PARTS_IT=1 vitest run admin-parts.search.int`) — **27/27**: 저항·커패시터·인덕터 단위/관행 표기, uF·uf·µF·μF·㎌·공백 마이크로 표기, MPN prefix/infix, 0402↔1005·0603↔1608, 제조사·공급사·재고·SI 범위 필터, 가격·재고 정렬, 페이지네이션, 음성 케이스
- 통합 테스트는 `PARTS_IT=1` 옵트인 — turbo test/CI 에서 자동 skip.

## 다음 단계(미착수)

운영 ES 설치+deploy.sh 케이스 · xpse pcbparts 2,677건 이관 · EIA-96 코드 · nori ·
dense_vector 시맨틱 · 재고/가격 라이브 갱신 · 공개(비관리자) 검색+rate limit.

## 부품 정본·자체(samplepcb) 오퍼 (2026-07-19 추가 — 커밋 참조)

부품 정본과 자체 오퍼는 **"그 부품의 전체 실공급사 오퍼"의 함수**다(`lib/parts-facts.ts`,
인제스트·수동 갱신·백필 `parts:refacts` 전 경로 끝에서 `applyPartFacts` 가 재생성 —
영속은 캐시, 소유권은 함수).

- **`resolvePartFacts`**: union 보강 + SI 상대오차 0.5% 게이트(표기·정밀도 차이≠충돌) +
  실충돌은 **다수결 → 공급사 신뢰순위(digikey>mouser>unikeyic) → 최신** 채택,
  전체 그룹을 `sp_part.specConflicts` 에 기록(관리자 목록 배지+상세 패널, ES `hasSpecConflict`).
  스펙 판정과 오퍼 선정(상업 조건)은 분리 축 — 최저가 공급사의 오타 스펙이 정본을 오염 못 함.
  구 mergeSpecs 의 무감지 덮어쓰기·봉투 단위 병합(과거 공급사 스펙 유실) 결함 교정.
- **`deriveSamplepcbOffer`**: `supplier='samplepcb'` 영속 오퍼 — 재고>0·KRW 우선·최소구간
  단가 최저 원천 **1개에서 통째 복사**(브레이크 혼합 금지), `rawJson.derivedFrom` 추적,
  fetchedAt=원천 시각(데이터 나이 정직). 향후 판매가/마진 정책의 유일한 적용 지점.
- **집계 규칙**: totalStock·offerCount·minPrice 는 실공급사만(파생 이중 계산 방지),
  suppliers 패싯에는 samplepcb 포함. BOM 견적 `pickDefaultOffer` 후보에서 제외(순환 방지).
- **이미지(2026-07-20)**: 공급사 제품 사진 직링크를 정본으로 승격 — 엔진 `SupplierProduct.image_url`
  (Mouser `ImagePath`·DigiKey `PhotoUrl`·UniKeyIC `image_url|img`) → rawJson 경유
  `resolvePartFacts` 가 `sp_part.imageUrl`(신뢰순위→최신, 충돌 게이트 비대상) 채움 →
  ES `imageUrl`(index:false 표시 전용) → PartHit/PartDetail. **기존 적재분은 백필 불가**
  (도입 전 rawJson 에 이미지 없음) — 재검색·수동 갱신 시 점진 채움. 1차는 CDN 직링크
  (`referrerpolicy=no-referrer`+onerror 축퇴), 핫링크 차단 실측 시 파일서버 캐시 프록시 2차.
- 백필 실측: 6,469건 재계산 — 실충돌 298건(예: SD05T1G 3사 전압 9.8/5/14.5V — TVS 전압
  파라미터 해석차 포착), samplepcb 오퍼 6,257건. 골든 15/15 + 통합 29/29(픽스처 prefix
  SPINGEST/SPTEST 분리로 병렬 레이스 교정).
