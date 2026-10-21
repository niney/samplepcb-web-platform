---
concept: 나란히 짓고 한 번에 넘긴다 (Parallel Build, Then Cutover)
last_compiled: 2026-10-12
topics_connected: [sp-vue-web, testing, sp-develop-web, infrastructure, gnuboard-integration, sp-node-api, docs-knowledge]
status: active
---

# 나란히 짓고 한 번에 넘긴다 (Parallel Build, Then Cutover)

## Pattern
쓰이고 있는 것을 바꿀 때 **제자리에서 고치지 않는다.** 옆에 새 것을 짓고, 둘이 같은 답을 내는지 기계로 확인하고, 넘기는 순간은 이름·경로 한 곳만 바꾸고, 옛 것은 한동안 남겨 둔다. 네 걸음이 반복된다:

1. **나란히** — 새 것은 별도 자리(`src/next/`, 프로토타입 경로, 새 테이블)에만 짓고 옛 것은 한 줄도 고치지 않는다. 데이터·계약은 같이 쓴다.
2. **동치 확인** — 같은 시나리오를 양쪽에서 돌린다(옛·새 화면 양쪽 e2e, 레거시↔플랫폼 가격 패리티 골든, 이관 verify). 옛 쪽이 통과하면 시나리오가 맞는 것이고, 새 쪽이 통과하면 동작이 같은 것이다.
3. **한 점 전환** — 라우트 이름 상수, nginx 경로, `--final` 한 번. 바깥에서 들어오는 링크(메일 딥링크·QR·북마크)는 고치지 않는다.
4. **물림** — 옛 것은 지우지 않고 뒤로 물리거나 되돌릴 지점(태그·스냅샷)을 남긴다.

## Instances
- **2026-10-10** in [sp-vue-web](../topics/sp-vue-web.md) / [sp-develop-web](../topics/sp-develop-web.md): **관리자 컷오버** — 리뉴얼 `/app/admin/next/*`·`admin-next-*` 를 정식 `/app/admin/*`·`admin-*` 로, 옛 화면은 `/app/admin/legacy/*`·`admin-legacy-*` 로. `NEXT_*_ROUTES` 값을 옛 이름으로 바꾸는 방식이라 메일 딥링크·QR·e2e URL 은 그대로 새 화면이 받는다. 당초 계획 "옛 파일을 지운다" → **지우지 않고 물림**('이전 화면'·'새 화면' 버튼이 같은 params·query 로 오간다). 견적관리·재능마켓은 리뉴얼 없이 옛 셸 그대로
- **2026-10-06~07** in [sp-vue-web](../topics/sp-vue-web.md): **shadcn-vue 리뉴얼을 `src/next` 에만** — 옛 화면 무수정, 레이아웃(배치·정보 순서)은 옛 화면과 같게·디자인만 새로, 데이터 훅·계약 재사용. PCB → SmartBOM → 통합 11화면 → 개발 순. 탭 모양·헤더 크기·사이드바 간격은 사용자 결정으로 옛 모양에 다시 맞췄다 — "같게 짓는다"가 기준이라 다른 것이 곧 검토 대상이 된다
- **2026-10-07** in [testing](../topics/testing.md) / [sp-develop-web](../topics/sp-develop-web.md): **같은 스펙을 옛·새 화면 양쪽에서** — `admin-develop-journey` 를 `DEVELOP_ADMIN_UI=old|next` 로 두 번(둘 다 9/9). 구조 차이(탭 버튼↔`role=tab`, 네이티브 체크박스↔`role=checkbox`, 인라인 확인↔포털 대화상자)는 어댑터 `helpers/develop-admin.ts` 가 가리고 선택자는 role·문구 중심. 접수→완료를 끝까지 몬 이 주행이 화면이 아니라 **프로세스** 결함 23건을 찾았다([DEVELOP_FLOW](../../docs/DEVELOP_FLOW.md) §15, 고치지 않고 등록)
- **2026-09-09~11** in [sp-develop-web](../topics/sp-develop-web.md) / [infrastructure](../topics/infrastructure.md): **프로토타입 G/C 공존 → C 승격·G 제거** — 두 안을 경로를 달리해 나란히 올려 실사용으로 고른 뒤 C 를 정식 경로로 원복했다. 되돌릴 지점은 태그 `proto-gc-coexist-20260910` + 스냅샷이고, 정리는 `prod-develop-cleanup.sh` 한 본(스냅샷 먼저)
- **2026-08-07** in [sp-node-api](../topics/sp-node-api.md): 가격 엔진 — `POST /api/pcb-pricing`(P4.5)이 레거시 body·응답과 동형이라 거버 뷰어가 **가격 API 대상 토글(legacy|platform)** 로 같은 입력을 양쪽에 보내 비교한다. 운영 거버의 담기는 아직 레거시 `cart_api` 가 기본이고 신규 `/api/pcb-projects` 가 그 옆에 서 있다
- **2026-07-06~07** in [gnuboard-integration](../topics/gnuboard-integration.md): 레거시 DB 전량 이관 — 컷오버 전까지 `migrate:sync` 가 레거시를 정본으로 델타를 단방향 반복 반영하고 T-0 의 `--final` 한 번으로 넘긴다. 그 사이 신규 플랫폼에서 바꾼 데이터는 다음 sync 가 레거시 기준으로 되돌린다(정본이 둘일 수 없다)

## What This Means
**회귀를 막는 가장 싼 방법은 옛 것을 건드리지 않는 것**이라는 판단이 석 달 동안 네 번 같은 꼴로 나왔다. 제자리 리팩터링이었다면 리뉴얼 화면 543파일이 매 커밋마다 운영 화면을 흔들었을 것이다. 나란히 지으면 "같아야 한다"가 검증 가능한 문장이 되고(양쪽 주행), 넘기는 날의 위험이 상수 몇 개로 줄어든다.

값은 **두 벌이 사는 기간**에 치른다. ① 새 기능이 한쪽에만 붙는다 — 10-11 의 EQ 줄·선적 스트립은 리뉴얼 화면에만 있다. ② 문서가 계획 절로 남는다 — [ADMIN_NEXT_UI](../../docs/ADMIN_NEXT_UI.md) §1·§10~§12 는 컷오버 전 경로 그대로라 §0 이 우선한다([manual-sync-drift](manual-sync-drift.md)). ③ 물린 옛 화면이 번들에 남고(정적 import 12개 중 7개가 legacy), 옛 선택자 e2e 를 새 화면에 맞추는 일이 컷오버 뒤 숙제로 남는다. ④ "나중에 지운다"는 약속은 잘 지켜지지 않는다 — `LegacyScreenLink` 주석은 아직 "컷오버 때 지운다"이고, 로그인 배경 실험실도 "검토 끝나면 폴더째 삭제"라 적힌 채 남아 있다.

그래서 넘긴 뒤의 **철거 조건을 넘기기 전에 정해 두는 것**이 이 패턴의 빠진 다섯 번째 걸음이다. 프로토타입 G 는 스크립트 한 본으로 철거까지 갔고, 관리자 옛 화면과 거버 레거시 경로는 아직 가지 못했다.

## Sources
- [sp-vue-web](../topics/sp-vue-web.md)
- [testing](../topics/testing.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [infrastructure](../topics/infrastructure.md)
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [sp-node-api](../topics/sp-node-api.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [docs/ADMIN_NEXT_UI.md](../../docs/ADMIN_NEXT_UI.md) — §0 컷오버·"나란히 짓고 한 번에 넘긴다"
- [docs/develop-prototypes.md](../../docs/develop-prototypes.md) — G 제거·C 승격, 원복 태그
- [docs/LEGACY_DB_MIGRATION.md](../../docs/LEGACY_DB_MIGRATION.md) — sync 쿡북·컷오버 런북
- [docs/pricing-engine-parity.md](../../docs/pricing-engine-parity.md) — 레거시↔플랫폼 가격 패리티
