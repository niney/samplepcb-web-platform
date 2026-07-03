---
topic: docs-knowledge
last_compiled: 2026-07-03
sources_count: 5
status: active
---

# docs-knowledge

## Purpose [coverage: high — 5 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 크게 세 층으로 나뉜다:
**설계 서사**(GERBER_ORDER_FLOW — 코어 무수정으로 동적 주문을 구현한 기법 카탈로그),
**운영 절차**(pricing-engine-parity, UPSTREAM_SYNC — "표가 바뀌면 / 패치가 나오면 이렇게 한다"),
**참조 스냅샷**(samplepcb-pricing-api-body-cases — 레거시 실캡처, LEGACY_SITE — 프로덕션 원본 사이트 정보).
이 문서는 각 문서가 무엇을 다루고 언제 읽어야 하는지의 안내 지도다.

## Architecture — 문서 지도 [coverage: high — 5 sources]

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니까지 전체 프로세스. **코어 무수정 기법 카탈로그 10종**(4장)이 핵심 가치. 인증 브리지(JWT cartId 클레임), sp-node 담기 파이프라인, 견적관리/보관함 독립 모델, 데이터 소유권 지도, 관련 파일 색인 | 2026-07-03 (견적관리·보관함 반영) | 주문 플로우·cart 연동·`sp_*` 테이블·spcb 페이지를 건드리기 전 필독. "왜 코어를 안 고치고 이렇게 했나"가 궁금할 때 |
| [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 가격 API 의 계산 일치 유지 방법. 가격표 드리프트 대응 절차(`pnpm pricing:sync` → PRICE_VERSION bump → `pricing:capture` → test), differentDesign/diffDesign 통일 결정, 레거시 실동작(eta·panel·rfq) 정리 | 2026-07-03 (통일 결정 확정) | 가격이 라이브와 어긋날 때 1순위. `engine.ts`·가격표·spec 키를 수정하기 전. 패리티 테스트가 "sha 불일치"로 실패할 때 |
| [samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 `samplepcb_pricing_api.php` request body 실캡처(fetch 몽키패치, 2보드 재검증). 메뉴 7종(standard~metalMask)별 baseline body + 옵션 변경 케이스 매트릭스. hidden 필드 포함·panel 대소문자·qty 올림 규칙 등 실동작 | 2026-07-03 (활용 절 추가) | 레거시 body 포맷·옵션 동작이 궁금할 때. 패리티 fixture(`capture-legacy-pricing-goldens.ts`) 케이스의 근거 문서 — 캡처 케이스 추가·수정 시 |
| [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) | 프로덕션 원본(`www.samplepcb.co.kr`) 구조·콘텐츠 스냅샷(2026-07-02): 네비게이션 URL, 제품·가격표, 주요 기능, 회사 정보 | 2026-07-02 조사 | 현대화 작업의 기준점이 필요할 때 — 레거시 URL·메뉴·제품 구성 확인. 게시판/견적 상세는 미포함 |
| [UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) | 그누보드5/영카트 코어(`samplepcb-web/`) subtree 최신화 절차. 리모트 구조, `git subtree pull --squash`, 절대 규칙(gnuboard push 금지·config.php 수정 금지), 충돌/롤백, 새 클론 셋업 | (절차 문서, 안정) | 그누보드 보안 패치를 받을 때. 새 클론 셋업 시. `samplepcb-web/` 내 파일을 수정하고 싶어질 때(먼저 절대 규칙 확인) |

## Talks To — 문서 간 참조 관계 [coverage: high — 5 sources]

- **GERBER_ORDER_FLOW → pricing-engine-parity**: 기법 #6(가격 로직 이식)과 7장 갱신 노트가 가격표 동기화·differentDesign 사고를 상세 문서로 위임한다.
- **pricing-engine-parity → samplepcb-pricing-api-body-cases**: "레거시 body 케이스 근거" 로 지목 — body-cases 의 케이스 매트릭스가 패리티 fixture 47케이스의 원천.
- **samplepcb-pricing-api-body-cases → pricing-engine-parity**: "활용" 절이 역방향으로 운영 절차를 가리킨다 (순환 참조 쌍).
- **GERBER_ORDER_FLOW → HANDOFF.md / AGENTS.md**: 결정 이력(폐기안 포함)은 HANDOFF 6장, 플랫폼 전반은 AGENTS.md 로 위임. 단 HANDOFF 는 gitignore 된 로컬 메모(커밋 금지).
- **LEGACY_SITE / UPSTREAM_SYNC**: 다른 docs 를 직접 참조하지 않는 독립 참조 문서. UPSTREAM_SYNC 의 "코어 비수정" 원칙이 GERBER_ORDER_FLOW 1장 제약의 전제가 된다.
- 레거시 소스 참조 시 크롤링 대신 로컬 `D:\work\workspace_other\samplepcb_php` 직접 읽기 (레거시 가격 API: `gerber_api/samplepcb_pricing_api.php`).

## API Surface [coverage: medium — 2 sources]

문서군 자체는 API 를 노출하지 않는다. 다만 문서가 계약을 정의·기록하는 지점:

- **GERBER_ORDER_FLOW 2·3장**: sp-node REST 표면(`POST/GET/PATCH/DELETE /api/pcb-projects`, `POST /api/pcb-projects/order`)과 `spcb/api/me.php` JWT 브리지 계약(mbId·cartId 클레임, 10분 TTL)의 정본 서술.
- **body-cases**: 레거시 가격 API 의 사실상 요청 스키마 문서 — 공통 필드(ShipType·Country 등 고정값), 메뉴별 key 세트, `gb_type: "MetalMask"` 특례.
- 신규 spec 계약은 `@sp/api-contract` KNOWN_SPEC_KEYS (39종) — 레거시 body ↔ 신규 spec 별칭 표(mixTrace→minTraceSpacing, goldfingers→goldFingers, frame→framework 등)는 pricing-engine-parity 가 정본.

## Data [coverage: medium — 3 sources]

- **데이터 소유권 지도** (GERBER_ORDER_FLOW 5장): `sp_quote`/`sp_order_spec`/`sp_file` = sp-node(Prisma) 소유, `g5_shop_cart` 는 INSERT+파생 SELECT 만(한정 예외 `lib/g5-db.ts`), cart↔spec 관계는 저장하지 않고 조회 시점 파생.
- **가격표 데이터**: 정본은 레거시 서버 라이브 `gerber_api/pricing_data.json`(관리자가 수시 조정) — 엔진의 `src/pricing/pricing-data.json` 은 스냅샷이며 동기화 대상. 라이브 표에는 유효한 `differentDesign` 표와 사어 `diffDesign` 표가 공존하고, sync 시 사어 표를 삭제하는 것이 유일한 정규화.
- **sp_ 테이블은 그누보드 DB(samplepcb) 동거** — `prisma migrate reset` 실행 시 `g5_*` 전체 드랍 위험 (MEMORY 경고).
- LEGACY_SITE 의 제품·시작가 표(Standard 31,000원~ 등)는 2026-07-02 스냅샷 — 라이브 가격은 계속 변한다.

## Key Decisions [coverage: high — 5 sources]

- **코어 비수정 + 스냅샷 모델**: 상품은 템플릿 4종 앵커, 주문 실체는 `sp_*` 소유, 영카트에는 cart 행 스냅샷만 INSERT. 견적가는 `ct_price` 가 아닌 옵션가 `io_price`(io_id=quoteId 실등록)에 실어 코어 재검증을 정당 통과 (GERBER_ORDER_FLOW 기법 #1~#3).
- **가격은 서버 재계산만이 진실** — 클라이언트는 가격을 보내지 않는다 (위변조 차단).
- **differentDesign 통일 (2026-07-03)**: 신규 플랫폼 spec 키는 `differentDesign`. `diffDesign` 은 구주문 마이그레이션 경계 별칭으로만 존재, 서버는 구키를 흡수하지 않는다 (통일성 우선).
- **한 건은 한 화면에만 (독립 모델)**: 견적관리(순수 견적) / 장바구니·주문내역(담긴 이후) / 보관함(삭제분) — 소속 배타 분리. cart 삭제는 훅 없이 lazy reconcile 로 흡수.
- **견적관리는 sp-php**(`spcb/pages/`) — sp-vue 안 폐기. 결제 연계가 있는 페이지는 PHP 영역이 자연스럽고, 레거시 `estimate_*` 는 EAV 전제라 이식 가치 없음.
- **subtree pull 단방향**: 그누보드 갱신은 `git subtree pull --squash` 만, gnuboard 리모트 push 는 3중 차단. `config.php` 수정 금지(https 는 `proxy_fix.php`).
- **eta 는 레거시 실동작 기준**: 주말 카운트 코드는 레거시에서 주석 처리 — 실제는 달력일 + 종료일 주말 보정(토+2/일+1)으로 이식.

## Gotchas — 기록된 실사고·함정 [coverage: high — 5 sources]

- **differentDesign 누락 → rfq 실사고**: 클라이언트가 spec 에 `differentDesign` 을 안 보내면(오탈자·구키 `diffDesign` 포함) 엔진이 "파일 개수 부재 → 0원 → rfq" 처리 — 화면에 '견적 대기'가 뜨고 주문하기가 견적관리로 빠진다. 2026-07-03 거버 어댑터 구키 전송으로 실제 발생.
- **가격표 스냅샷 드리프트**: 알고리즘이 같아도 스냅샷이 낡으면 가격이 통째로 어긋난다 (2026-07 사례: 61,000 vs 66,000원 — `cutting` 표 누락·마진 브래킷 상이). 패리티 테스트 첫 케이스 "sha 불일치" 실패 = sync 절차 누락 신호.
- **[선택사항수정] 선형 곱 버그**: 견적 행은 `io_price` 가 총액이라 코어 팝업의 `io_price`×수량 재계산이 오류 — 테마 cart 스킨 분기로 버튼 자체를 숨겨 차단 (기법 #8).
- **같은 it_id 재담기 시 기존 행 전멸**: `cartupdate.php:276` — 템플릿 상품을 일반 목록/상세에 노출 금지로 표준 담기 경로 차단 (기법 #5).
- **파일 삭제 API 보안 미처리 과제**: `GET /api/delete/:pathToken` 은 인증 없이 pathToken 만으로 삭제 — 유출 시 임의 파일 삭제 가능. 접근 제한은 인프라 트랙 후속 (2026-07 결정).
- **impedance "없음" 값 불일치**: FR-4/METAL 은 `"none"`, ROGERS 는 `"no"` — 레거시 프론트 자체 불일치. METAL/ROGERS 는 `differentDesign` 을 개수가 아닌 `"no"/"yes"` 로 보낸다 (advance 계열은 어차피 rfq 라 현재 실영향 없음).
- **hidden 필드도 body 에 실린다**: 화면에서 숨겨진 옵션(`finishedCopperAdvance`, Advance 의 `cutting` 등)도 마지막 값 그대로 매 요청에 포함 — 레거시 body 재현 시 빠뜨리기 쉬운 함정.
- **panel 과도기 값**: `"yes"`, `"2x0"` 같은 UI 과도기 body 는 레거시가 수량 0(무게 0kg)으로 계산 — 버그가 아니라 실동작.
- **초기 관찰 오기 정정 사례**: "메뉴 탭 전환 시 보드가 풀린다"는 최초 기록은 오기 — 재검증에서 보드 유지 확인 (body-cases 재검증 로그). 실캡처 문서도 재검증 없이는 믿지 말 것.
- **HANDOFF.md 는 커밋 금지**: GERBER_ORDER_FLOW 가 여러 곳에서 참조하지만 gitignore 된 로컬 메모 — 영속 기록은 `docs/` 로.

## Sources [coverage: high — 5 sources]

- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md)
- [../../docs/samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md)
- [../../docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md)
- [../../docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md)
