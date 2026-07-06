---
topic: docs-knowledge
last_compiled: 2026-07-06
sources_count: 9
status: active
---

# docs-knowledge

## Purpose [coverage: high — 6 sources]

`docs/` 는 이 플랫폼의 설계·운영 기록 문서군이다. 2026-07-03 시점의 5개 문서에서 **4개가 추가**(작업 방식·배송 연동 조사·로컬 메일·알림 게이트)돼 9개로 늘었고, 마스터 문서 GERBER_ORDER_FLOW 는 관리자 관리 기능 이관으로 대폭 확장됐다. 네 층으로 나뉜다:
- **설계 서사** — GERBER_ORDER_FLOW(코어 무수정 기법 카탈로그 + g5 접근 카탈로그 ⑤–⑱ + 관리자 관리 이관 서사)
- **운영 절차** — pricing-engine-parity·UPSTREAM_SYNC·LOCAL_MAIL_TESTING("표가 바뀌면 / 패치가 나오면 / 메일을 테스트하려면 이렇게 한다")
- **정책·작업 방식** — order-notify-gating(알림 게이트 결정)·AI_WORKFLOW_PLAYBOOK(AI 작업 방식 선택 기준)
- **참조 스냅샷·조사** — samplepcb-pricing-api-body-cases·LEGACY_SITE·DELIVERY_CARRIER_INTEGRATION(택배 연동 미결정 조사)

이 문서는 각 문서가 무엇을 다루고 언제 읽어야 하는지의 안내 지도다.

## Architecture — 문서 지도 [coverage: high — 6 sources]

| 문서 | 요지 | 최종 갱신 | 언제 읽나 |
|---|---|---|---|
| [GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md) | 거버 업로드→장바구니→**관리자 관리**까지 전체. 코어 무수정 기법 카탈로그 11종(4장, #11 코어 최소 수정 예외 포함), 인증·알림 브리지, sp-node 담기·관리 파이프라인, **g5 접근 카탈로그 ⑤–⑱**(5장), 데이터 소유권, 관련 파일 색인 | 2026-07-05 (제작 8단계 선형 전이·사업자정보) | 주문 플로우·cart·`sp_*`·관리 API·g5 접근·spcb 를 건드리기 전 필독. "왜 코어를 안 고치고 이렇게 했나" |
| [pricing-engine-parity.md](../../docs/pricing-engine-parity.md) | TS 가격 엔진 ↔ 레거시 PHP 가격 API 계산 일치. 드리프트 대응 절차(`pnpm pricing:sync`→PRICE_VERSION→`pricing:capture`→test), differentDesign 통일, 레거시 실동작(eta·panel·rfq) | 2026-07-03 | 가격이 라이브와 어긋날 때 1순위. `engine.ts`·가격표·spec 키 수정 전. 패리티 "sha 불일치" 실패 시 |
| [order-notify-gating.md](../../docs/order-notify-gating.md) | 주문 처리 메일/SMS 체크박스 **노출 게이트** sp-vue 정책. 코어 목록(무조건 노출=결함)↔상세(설정 게이트) 불일치를 하나로 통일, 실발송과 정합(`cf_email_use`/`cf_sms_use==='icode'`+de_sms_use4/5). 구현 지점(getNotifyConfig·AdminNotifyConfigResponse) | 2026-07-05 (신규) | 관리자 주문 알림 체크박스를 만질 때. "체크했는데 안 나감" 조사 시 |
| [LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md) | 주문 메일(입금/배송)을 **로컬에서 실발송 없이** 확인 — Mailpit 을 `127.0.0.1:25` 에. config.php `G5_SMTP` SMTP 모드라 XAMPP mailtodisk 는 안 됨. nssm 서비스 등록, 발송 조건, 발송 경로(sp-node→order-notify.php→ordermail→Mailpit), 트러블슈팅 | 2026-07-05 (신규) | 주문 알림을 로컬에서 확인할 때. 메일이 안 올 때 |
| [DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md) | 택배(CJ대한통운) 연동 **조사 노트 — 미결정(보류)**. 송장 발급·출력(굿스플로/CJ직접)·배송추적·자동완료(스마트택배/딜리버리트래커) 옵션, 현재 수동 3필드/엑셀 왕복 접점, 통합 시나리오 제안, 결정 대기 질문 | 2026-07-06 (신규·조사만) | 배송처리 자동화를 검토할 때. CJ 계약 확정/배송 물량이 수동 한계 초과 시 |
| [AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md) | 메인 세션이 작업마다 진행 방식(직접/Opus 위임+전수 감사/병렬 agent)을 **자율 결정**하는 실증 기반 기준. 원칙(퀄리티>비용·Fable 결정+사용자 원-체크), 방식별 특성, 유형→기본값, 위임 품질 게이트, 실증 로그 | 2026-07-05 (신규) | 규모 있는 작업의 진행 방식을 정할 때. 위임 지시서를 쓸 때 |
| [samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md) | 레거시 `samplepcb_pricing_api.php` request body 실캡처. 메뉴 7종 baseline + 옵션 케이스 매트릭스, hidden 필드·panel 대소문자·qty 올림 규칙 | 2026-07-03 | 레거시 body 포맷·옵션 동작. 패리티 fixture 케이스 근거 |
| [LEGACY_SITE.md](../../docs/LEGACY_SITE.md) | 프로덕션 원본(`www.samplepcb.co.kr`) 구조·콘텐츠 스냅샷(2026-07-02): 네비게이션·제품·가격표·회사정보 | 2026-07-02 조사 | 현대화 기준점(레거시 URL·메뉴·제품) 확인 |
| [UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md) | 그누보드5/영카트 코어(`samplepcb-web/`) subtree 최신화 절차. 리모트, `git subtree pull --squash`, 절대 규칙(push 금지·config.php 금지), 충돌/롤백, 새 클론 셋업 | (절차, 안정) | 보안 패치 수신·새 클론 셋업·`samplepcb-web/` 수정하고 싶을 때 |

## Talks To — 문서 간 참조 관계 [coverage: high — 5 sources]

- **GERBER_ORDER_FLOW → pricing-engine-parity**: 기법 #6(가격 이식)이 가격표 동기화·differentDesign 을 상세 문서로 위임.
- **GERBER_ORDER_FLOW ↔ order-notify-gating / LOCAL_MAIL_TESTING**: 5장 ⑬ 상태 전이의 알림이 게이트 정책·로컬 테스트를 두 문서로 위임(신규 연결).
- **DELIVERY_CARRIER_INTEGRATION → GERBER_ORDER_FLOW / order-notify-gating**: 배송 전이 코드(`setOrdersDelivery`·`delivery-excel.ts`)·알림 게이트를 연관 문서로 지목.
- **pricing-engine-parity ↔ samplepcb-pricing-api-body-cases**: 순환 참조 쌍(패리티 fixture 근거 ↔ 운영 절차).
- **AI_WORKFLOW_PLAYBOOK → HANDOFF.md / AGENTS.md**: 실증 로그가 HANDOFF 결정·플랫폼 규율을 참조. HANDOFF 는 gitignore 된 로컬 메모(커밋 금지) — 영속 기록은 docs/.
- **LEGACY_SITE / UPSTREAM_SYNC**: 독립 참조 문서. UPSTREAM_SYNC 의 "코어 비수정" 이 GERBER 1장 제약의 전제.
- 레거시 소스 참조 시 크롤링 대신 로컬 `D:\work\workspace_other\samplepcb_php` 직접 읽기.

## API Surface [coverage: medium — 3 sources]

문서군 자체는 API 를 노출하지 않지만 계약을 정의·기록한다:

- **GERBER_ORDER_FLOW 2·3·5장**: sp-node REST 표면(담기 `/api/pcb-projects` + 관리 `/api/admin/*`)과 브리지 계약(`me.php` mbId·cartId·isAdmin, `order-notify.php` 서비스 JWT)의 정본 서술.
- **order-notify-gating**: `AdminNotifyConfigResponse`(mailAvailable·smsDepositAvailable·smsShippingAvailable) 계약·라우트(`GET /api/admin/orders/notify-config`) 근거.
- **body-cases**: 레거시 가격 API 의 사실상 요청 스키마 문서.
- 신규 spec 계약은 `@sp/api-contract` KNOWN_SPEC_KEYS(39종) — 별칭 표는 pricing-engine-parity 정본.

## Data [coverage: medium — 3 sources]

- **데이터 소유권 / g5 접근 카탈로그** (GERBER 5장): `sp_quote`/`sp_order_spec`/`sp_file`/`sp_member_profile` = sp-node(Prisma) 소유, g5_* 는 접근 카탈로그 ⑤–⑱(민감 컬럼 SELECT 배제, cart↔spec 관계 미저장·조회 파생).
- **가격표 데이터**: 정본은 레거시 라이브 `pricing_data.json`(관리자 수시 조정), 엔진의 스냅샷은 동기화 대상.
- **로컬 메일 데이터**: Mailpit 인메모리(재시작 시 비움), `--database` 로 영속. 발송 조건은 `g5_config`/`g5_shop_default`/`g5_shop_order` 값에 걸림.
- **sp_ 테이블은 그누보드 DB(samplepcb) 동거** — `prisma migrate reset`/`migrate dev` 금지(g5_* 드랍/전체 reset).
- LEGACY_SITE 의 제품·시작가 표는 2026-07-02 스냅샷 — 라이브 가격은 계속 변한다.

## Key Decisions [coverage: high — 5 sources]

- **코어 비수정 + 스냅샷 모델** + **io_price 기법** — 상품은 템플릿 4종 앵커, 주문 실체는 `sp_*`, 견적가는 옵션가 `io_price` 에.
- **가격은 서버 재계산만이 진실** · **differentDesign 통일**(2026-07-03) · **한 건은 한 화면에만**(독립 모델).
- **관리 기능은 모노레포로 점진 마이그레이션 + g5 접근 카탈로그**(2026-07-04) — "금지+예외"를 규율된 접근 카탈로그로 재정의.
- **알림은 PHP 브리지 재사용 + 게이트는 서버 계산**(2026-07-05) — 메일/SMS 를 Node 재구현 대신 `order-notify.php` 로 위임, 체크박스 노출은 코어 결함(무조건 노출)을 교정해 실발송과 정합.
- **제작 8단계는 od_status 재사용·선형 전이**(2026-07-05) — 신규 컬럼·Prisma 마이그레이션 없이 공유 DB reset 제약 회피.
- **AI 작업 방식은 Fable 자율 결정 + 사용자 원-체크**(2026-07-04) — 퀄리티>비용, 위임 시 전수 감사·독립 실측·UI 육안 게이트.
- **택배 연동은 조사만·미결정**(2026-07-06) — 굿스플로/딜리버리트래커 후보, CJ 계약 확정 후 재검토.
- **subtree pull 단방향** · **config.php 수정 금지** · **eta 는 레거시 실동작 기준**.

## Gotchas — 기록된 실사고·함정 [coverage: high — 5 sources]

- **differentDesign 누락 → rfq 실사고**(2026-07-03): 키 누락 시 "0원 → 견적 대기".
- **가격표 스냅샷 드리프트**: 알고리즘 같아도 스냅샷 낡으면 가격 통째로 어긋남. 패리티 "sha 불일치" = sync 절차 누락.
- **로컬 메일은 Mailpit 필수**: `G5_SMTP` SMTP 모드라 XAMPP mailtodisk 안 통함. 브리지가 `sent` 라도 실발송 실패 가능(error.log 로만 확인).
- **알림 "노출됐는데 안 나감"**: 코어 목록(orderlist.php)은 설정 무시 노출 → 조용히 skip. sp-vue 게이트가 이를 교정하되 코어 목록과 의도적으로 다름(패리티 이탈).
- **[선택사항수정] 선형 곱 버그** · **같은 it_id 재담기 시 기존 행 전멸** — 테마 스킨·노출 금지로 차단(기법 #8·#5).
- **파일 삭제 API 무인증** · **impedance "없음" 값 불일치** · **hidden 필드도 body 에 실린다** · **panel 과도기 값**.
- **HANDOFF.md 는 커밋 금지** — gitignore 된 로컬 메모, 영속 기록은 `docs/`.
- **위임 지시서 허점은 그대로 구현된다**(AI_WORKFLOW_PLAYBOOK) — validUntil 결함·주석-코드 모순 등 감사에서 회수. 실브라우저·픽셀 마감은 육안 필수.

## Sources [coverage: high — 9 sources]

- [../../docs/GERBER_ORDER_FLOW.md](../../docs/GERBER_ORDER_FLOW.md)
- [../../docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md)
- [../../docs/order-notify-gating.md](../../docs/order-notify-gating.md)
- [../../docs/LOCAL_MAIL_TESTING.md](../../docs/LOCAL_MAIL_TESTING.md)
- [../../docs/DELIVERY_CARRIER_INTEGRATION.md](../../docs/DELIVERY_CARRIER_INTEGRATION.md)
- [../../docs/AI_WORKFLOW_PLAYBOOK.md](../../docs/AI_WORKFLOW_PLAYBOOK.md)
- [../../docs/samplepcb-pricing-api-body-cases.md](../../docs/samplepcb-pricing-api-body-cases.md)
- [../../docs/LEGACY_SITE.md](../../docs/LEGACY_SITE.md)
- [../../docs/UPSTREAM_SYNC.md](../../docs/UPSTREAM_SYNC.md)
