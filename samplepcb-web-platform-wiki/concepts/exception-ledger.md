---
concept: 예외·편차는 원장에 등록한다 (Exception Ledger)
last_compiled: 2026-09-19
topics_connected: [gnuboard-integration, theme-sp-lite, docs-knowledge, infrastructure, partner-tracks, sp-develop-web, sp-node-api]
status: active
---

# 예외·편차는 원장에 등록한다 (Exception Ledger)

## Pattern
이 코드베이스는 정본(그누보드 코어·피그마 시안·정본 문서·레거시 DB)에서 **말없이 벗어나지도, 말없이 고치지도 않는다.** 벗어나야 할 때는 사용자 결정으로만 벗어나고, **어디서 왜 벗어났는지를 원장에 적고, 가능하면 가드로 검사한다.** 원장은 네 종류로 반복된다:

1. **코어 수정 예외** — `docs/GERBER_ORDER_FLOW.md` 4장 무수정 기법 카탈로그 11종 + 5장 g5 접근 카탈로그 ①~㉑, 그리고 도저히 못 피한 한 줄 수정은 `// [samplepcb]` 주석 + `check-core-patches.sh` 한 줄 등록이 규칙이다([core-nonmodification](core-nonmodification.md)).
2. **디자인 편차** — `docs/FIGMA_PAGES.md`: 피그마와 동일 구현하되 **피그마 쪽 오류는 고치지 않고 대장에 적는다**. 페이지별 "다르게 둔 것·이상 징후·미결" 절이 표준 형식이 됐다.
3. **명세 정정** — 정본 문서 안의 우선순위 문장(`§5.1 정정이 본문보다 우선`·`§9 구현 기록이 §5 설계안보다 우선`·`§13.6`·`§1.5`·`§12 → §13`)과, 폐기 문서의 `⚠ 대체됨 + 정본 링크 + 살아남은 조각` 헤더.
4. **이관·정리 예외** — 분류 못 한 테이블이면 삭제하지 않고 **중단**하는 초기화 정책 파일, 수정 금지 스냅샷으로 회수한 레거시 자료, 태그로 보존하고 main 은 한 줄로 재작성한 프로토타입.

공통 구조는 같다 — **편차 + 이유 + (가능하면) 검사**. 세 번째가 없으면 원장은 낡고, 원장이 낡으면 편차는 추적 가능한 부채가 아니라 조용한 회귀가 된다([manual-sync-drift](manual-sync-drift.md)).

## Instances
- **2026-09-19** in [gnuboard-integration](../topics/gnuboard-integration.md): 스캔 실측 — sp 심(seam) 마커가 있는 코어 파일은 **7개**인데 `check-core-patches.sh` 의 `assert_contains` 는 **5건**. `mobile/shop/orderform.sub.php` 와 `shop/ordermail1.inc.php` 의 `sp_custom_row_it_ids_in` 심이 **미등록**이라 subtree pull 한 번이면 모바일 주문서·주문 메일이 조용히 순정으로 돌아간다. **원장이 비면 가드도 비는 것** — 이 패턴의 실패 모드가 그대로 드러난 자리다(⚠ 커밋 이력상 실제 pull 은 아직 0회라 가드도 실전 검증 전)
- **2026-09-18** in [theme-sp-lite](../topics/theme-sp-lite.md): 피그마 대장이 **운영 배포 전 체크리스트**로 굳었다 — 자리표시 수치(홈 통계 3칸·연혁 4칸)·로고 20여 종 사용 허락·Unsplash+ 워터마크 프리뷰·Flaticon 출처 표기·4.7MB GIF·히어로 05 의 스크린샷 확대. **코드는 피그마 그대로라 이 목록을 읽지 않으면 그대로 나간다** — 원장이 유일한 방어선인 사례
- **2026-09-16** in [infrastructure](../topics/infrastructure.md) / [sp-node-api](../topics/sp-node-api.md): 운영 재이관 보존 정책의 정본이 **문서가 아니라 파일 하나** — `apps/api/src/scripts/migrate/lib/reset-data-policy.ts`. 보존/삭제/부분 보존(고정 결제 상품 7종)을 여기서만 판정하고 **분류되지 않은 테이블은 삭제하지 않고 중단한다**. 원장이 실행 가능한 형태가 되면 가드가 따로 필요 없다는 최선형([judgment-single-owner](judgment-single-owner.md))
- **2026-09-15** in [theme-sp-lite](../topics/theme-sp-lite.md): 계정 사이드바 카드형 통일에서 피그마의 **불균일한 메뉴 간격을 사용자 요청으로 통일**(행 36px·간격 4px) — "피그마 그대로" 원칙의 **명시적 예외**로 기록됐다. 같은 문서가 08-25 사이드바를 09-15 판이 대체한다는 우선순위도 적는다
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md) / [docs-knowledge](../topics/docs-knowledge.md): 프로토타입 비교는 **태그로 보존하고 main 은 한 줄로 재작성** — G/C 공존 비교 커밋 6개를 `17a966dbe` 하나로 접고, 되돌릴 지점은 `proto-gc-coexist-20260910`·`proto-c-original-20260910` 두 태그 + DB 스냅샷이 붙든다. 채택 안 된 쪽의 규칙 7건은 **먼저 이식하고 지웠다**. ⚠ 원장의 값: `DEVELOP_FLOW §14` 가 가리키는 `develop-workflow-c-module.md` 는 main 에 없고 태그에서만 볼 수 있다
- **2026-09-06** in [theme-sp-lite](../topics/theme-sp-lite.md) / [docs-knowledge](../topics/docs-knowledge.md): 원칙의 선언 — **"피그마와 동일 구현, 피그마 쪽 오류는 고치지 않고 [FIGMA_PAGES](../../docs/FIGMA_PAGES.md) 에 적어 한 번에 손본다"**(사용자 결정). 회사소개/연혁/위치 3종에서 배너 부제 미완성 문장·Customer 카드 숫자 충돌·같은 특허증 7장 복제·타사 스크린샷 통계가 그대로 구현되고 대장에 올랐다. 같은 날 [CONTACT_INQUIRY](../../docs/CONTACT_INQUIRY.md) 가 **"결정 대기" 문서 형식**(후보 비교표+추천+결정할 것+구현 순서)의 첫 사례가 됐다
- **2026-08-28** in [docs-knowledge](../topics/docs-knowledge.md): 폐기 문서는 **삭제하지 않고 헤더에 `⚠ 대체됨 + 정본 링크 + 살아남은 조각`** — `AI_DIAGRAM.md` 는 4산출물·80문항 인터뷰·provenance 체계가 폐기됐음을 적고 `AI_DEV_REVIEW` 로 넘기되, `DiagramSpec`·결정적 렌더러·첨부 추출기가 새 체계에서 계속 산다는 것도 함께 남긴다. `bom-quote-code-review-2026-07-19` 도 같은 방식으로 자리를 넘겼다
- **2026-08-17** in [gnuboard-integration](../topics/gnuboard-integration.md) / [infrastructure](../topics/infrastructure.md): 배송방법 작업의 **독립 검토가 미등록 코어 수정 4건을 발견**해 가드가 1→5건이 됐다(`ea2916b98`). 같은 작업 자체는 원장 덕에 코어를 안 고쳤다 — 신설 컬럼 `od_delivery_method` + `od_delivery_company` 한글 라벨 **병용**으로 `/adm`·메일·고객 조회가 PHP 0줄 호환(⚠ 이 DDL 은 `migrate:sync` 가 나르지 않아 **운영 수동 실행**이라는 예외가 또 문서에 등록돼 있다)
- **2026-08-05** in [gnuboard-integration](../topics/gnuboard-integration.md) / [docs-knowledge](../topics/docs-knowledge.md): 가드의 탄생 이유가 패턴의 논거 그 자체 — **subtree pull 은 그누보드가 그 줄 근처를 안 건드리면 충돌 경고 없이 조용히 원본으로 덮어쓴다.** 첫 등록은 `get_member()` 이메일 아이디 필터(함수 선두 가드라 extend 로 추출 불가), 유실되면 이관 회원 3,224명이 전원 로그인 불가. ⚠ 가드는 CI·pre-commit 에 없어 **사람이 pull 직후 돌려야 한다**
- **2026-08-04** in [docs-knowledge](../topics/docs-knowledge.md) / [partner-tracks](../topics/partner-tracks.md): 유실 위험 레거시 자료를 **리포에 스냅샷 회수(수정 금지)** — `docs/legacy-smartbom/`(통화 설계서·UML Atlas·실 DB DDL 덤프)에 README 가 "왜 회수했나·무엇이 정본인가"를 적는다. 같은 문서가 우선순위를 처음 명문화했다: **코드·DDL 헤더 주석 > doc > 위키**(레거시 위키엔 "USD 단일 정본" 같은 정반대 서술이 남아 있다). 회수 자료 자체도 §7 DDL 일부가 미구현이라 **"코드가 정본"**이 덧붙는다
- **2026-07-29** in [docs-knowledge](../topics/docs-knowledge.md) / [partner-tracks](../topics/partner-tracks.md): 정정 원장의 원형 — `SMARTBOM_PARTNER_RFQ` 가 첫 줄에 "레거시 설계를 따르지 않는다, 돌아가는 프로세스가 정본"을 두고 §0 결정표(D번호) + **§5.1 "본문보다 이 절이 우선"** + §6.x 구현 기록 누적 구조를 세웠다. 이후 모든 트랙 문서의 골격이 됐고, §5.1 을 건너뛰면 부적합 판정된 옛 설계를 구현하게 된다

## What This Means
**"일단 고쳐 두고 나중에 설명하자"가 이 코드베이스에서 가장 비싼 선택이다.** 정본에서 벗어날 때는 세 가지를 같이 만들어라 — ① 편차를 적을 자리(어느 원장인가) ② 이유(무엇을 얻고 무엇을 포기했나) ③ **검사**(가드 스크립트 한 줄·미분류 시 중단·배포 전 체크리스트). 셋째가 없으면 원장은 반드시 낡는다.

원장별 실무 규칙:
- **코어를 고쳤다면 `check-core-patches.sh` 에 `assert_contains` 를 같은 커밋에서 추가**하고, subtree pull 직후 손으로 돌린다. 지금 2건이 미등록이니 새 심을 넣기 전에 그것부터 등록하는 편이 낫다.
- **피그마가 틀렸어도 고치지 말고 [FIGMA_PAGES](../../docs/FIGMA_PAGES.md) 에 적는다.** 단, 대장이 배포 게이트가 되려면 "운영 전 교체 목록"을 배포 절차에서 실제로 읽어야 한다 — 지금은 문서에만 있다.
- **정본을 갱신할 땐 새 문서를 만들지 말고 같은 문서에 절을 덧붙이고 우선순위 문장을 헤더에 박는다.** 커밋 메시지에 절 번호가 들어가므로 **절 재번호는 이력을 끊는다**(같은 번호가 두 번 쓰인 곳도 있어 절 번호 + 제목을 함께 적는다).
- **지우지 말고 표시하라** — 폐기 문서는 `⚠ 대체됨` 헤더로, 프로토타입은 태그로, 레거시 자료는 수정 금지 스냅샷으로 남긴다. 되돌릴 지점이 없는 정리는 정리가 아니다([destructive-op-guardrails](destructive-op-guardrails.md)).

## Sources
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [docs-knowledge](../topics/docs-knowledge.md)
- [infrastructure](../topics/infrastructure.md)
- [partner-tracks](../topics/partner-tracks.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [sp-node-api](../topics/sp-node-api.md)
