---
concept: 렌더는 추출해 공유, 도메인 어휘는 격리 (Share Render, Mirror Domain)
last_compiled: 2026-09-19
topics_connected: [shared-packages, sp-market-web, sp-develop-web, api-contract, sp-node-api, partner-tracks]
status: active
---

# 렌더는 추출해 공유, 도메인 어휘는 격리 (Share Render, Mirror Domain)

## Pattern
같은 리포가 한쪽에서는 **"복사하지 말고 추출하라"**(2026-09-05 `@sp/ui` 신설의 문장이 그대로 "복사가 아니라 추출")고 하고, 다른 쪽에서는 **"값이 같아도 따로 두라"**(`pcb-claim.ts` 헤더: "BOM 사전은 불변 — PCB 계약은 여기 따로 선다")고 한다. 모순이 아니라 경계가 그어져 있는 것이다.

**추출해 공유하는 것 = 같은 픽셀·같은 계산**. 화면 부품, 파일 미리보기 판정, 에러 문구 골격, 순수 산식, AI 러너 배관. 복사하면 3앱이 각자 갈리고, 한쪽에서 고친 결함이 다른 쪽에 남는다.

**일부러 격리하는 것 = 같은 업무 어휘**. 상태 사전, 라벨, 가드 코드, 라우트 경로, 테이블. 값이 같아 보여도 각자 진화하므로, 공유하면 한 트랙의 요구가 다른 트랙의 상태 기계를 흔든다.

[judgment-single-owner](judgment-single-owner.md)와 짝이되 **방향이 반대**다 — 그쪽은 "같은 판단을 두 번 구현하지 말라", 이쪽은 "다른 도메인의 어휘를 한 벌로 합치지 말라". 두 규율이 만나는 자리가 계약 패키지다: 판정 함수는 한 곳, 트랙 사전은 파일별로 따로.

## Instances
- **2026-09-11** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 문서·업무표가 마켓과 무관한 자체 사전(`DEVELOP_DOC_*`·업무 단계 6)으로 서고, 달성도 산식만 계약 순수 함수로 공유. 같은 "문서"라는 낱말이 두 트랙에서 다른 것을 가리킨다
- **2026-09-08** in [api-contract](../topics/api-contract.md) / [sp-market-web](../topics/sp-market-web.md): **팩토리는 공유, 내용물은 분리** — `area-registry.ts`의 `createAreaRegistry()` 하나에서 `MARKET_REGISTRY`/`DEVELOP_REGISTRY`가 갈라진다. 마켓 export 이름·시그니처·프롬프트·JSON 스키마는 **바이트 동일**(회귀 e2e-market 148/0이 그 가드)이고, 개발의뢰는 `mech` 분야·`kind:'text'` 서술 문항을 자기 쪽에만 더한다. `DEVELOP_BUDGET_RANGES`는 마켓 것과 **단위 자체가 달라** 교차 import 금지
- **2026-09-05** in [shared-packages](../topics/shared-packages.md) / [sp-market-web](../topics/sp-market-web.md): **`@sp/ui` 신설이 이 개념의 정의 사건** — 관리자가 고객과 같은 렌더러로 검토서를 미리 봐야 하는데 복사하면 3앱이 갈린다. 마켓에서 i18n 미사용·`@sp/*` 의존만인 7컴포넌트를 옮기고 `copper-*`→`brand-*`. 추출의 조건 넷이 패키지 헤더에 명문화됐다 — **i18n 미사용**(도메인 라벨은 계약 상수) · **시맨틱 토큰 이름만**(`brand-*`·`ink-*`·`--color-area-*`, 값은 각 앱 `@theme`이 정함 — 마켓은 카퍼 별칭, develop 은 일렉트릭 블루) · **API 경로 비하드코딩**(`filesPath` prop) · **레지스트리는 인자**(`DevReviewView :registry`)
- **2026-09-05** in [sp-develop-web](../topics/sp-develop-web.md) / [sp-market-web](../topics/sp-market-web.md): 개발의뢰는 마켓 위저드를 **재사용하지 않는다** — 별도 앱·별도 테이블. `sp_market_project`에 `channel` 컬럼을 더하는 안을 기각한 이유가 어휘 격리의 가장 선명한 근거다: **공개 목록 쿼리에서 필터 하나가 빠지면 비공개 의뢰가 마켓에 샌다**. 공유한 것은 셋뿐 — `@sp/ui` 렌더러, 계약 레지스트리, 서버 AI 러너의 타깃 어댑터(`{kind:'market'}|{kind:'develop'}`, `features.schedule`은 develop 일 때만)
- **2026-09-04** in [api-contract](../topics/api-contract.md) / [shared-packages](../topics/shared-packages.md): `file-preview.ts` — "무엇을 보여줄 수 있는가"의 판정(`fileViewKind`·`needsServerPreview`)과 응답 모양은 **도메인 중립 한 파일**, 도메인마다 다른 것은 라우트·권한뿐. `apiErrorMessage`도 같은 결 — 401/404 폴백만 공통이고 **코드 사전은 앱이 주입**(마켓 `REVIEW_STALE`… vs 개발의뢰 23종)
- **2026-08~09** in [sp-node-api](../topics/sp-node-api.md) / [partner-tracks](../topics/partner-tracks.md): **PCB 트랙 코어는 BOM 코어와 함수를 공유하지 않는 미러**(`pcb-po`·`pcb-shipment`·`pcb-claim` ↔ `bom-*`, `bom-po.ts` 무접촉). 공유하는 것은 계약 코드 사전뿐(`BOM_SHIPMENT_*`·`SHIPMENT_TRANSPORTS` air|sea). 포털 라우트도 `/api/partner/rfqs` vs `/pcb-rfqs`로 갈리고, PHP 브리지의 `sp_bom_claim.extend.php`는 `sp_pcb_claim`과 "모양이 같지만 **함수를 나눈다**"
- **2026-08-27** in [sp-node-api](../topics/sp-node-api.md): 사내 서비스 BOM API 는 **라우트를 복제하지 않고** 같은 플러그인을 `/api/svc`에 서비스 액터로 재등록 — 배관(라우트·검증·소유 검사)은 공유, 액터만 갈아끼운다. 추출 가능한 것을 끝까지 추출한 반대편 극단
- **2026-07~08** in [shared-packages](../topics/shared-packages.md): `@sp/utils`의 FE/BE 동시 소비 — `spec-units`(색인·검색이 **같은 파서**, xpse 커스텀 토크나이저 기각) · `bom-pricing` 27파일 · `kst-date` 41파일 · `vat`. 순수 계산이므로 어느 쪽에서 불러도 같은 답이 나오고, 골든 벡터가 명세 노릇을 한다([golden-as-spec](golden-as-spec.md))

## What This Means
새 코드를 앞에 두고 물을 것은 "중복인가"가 아니라 **"같은 픽셀/같은 계산인가, 같은 업무 어휘인가"**다.

- **같은 픽셀·계산이면 추출한다.** 다만 추출 가능한 형태로 만드는 값이 있다 — i18n 을 빼고, 색은 토큰 이름만 읽고, 경로·사전·레지스트리는 **인자로 받는다**. 이 네 조건을 못 맞추는 컴포넌트는 아직 공유 대상이 아니다.
- **같은 업무 어휘면 미러한다.** 파일을 나누고, 사전을 각자 세우고, 라우트를 갈라 둔다. 대가는 코드 중복이지만 얻는 것은 **한쪽 변경이 다른 쪽을 못 건드린다는 보장**이다. 미러가 정당한지는 "이 상태값의 의미가 두 트랙에서 정말 같은가"로 검사한다 — `resolved` 하나가 PCB 와 부품에서 다른 말이라 A/S 화면에 '전체' 탭조차 두지 않았다.
- **중간 지대는 팩토리·어댑터로 푼다.** `createAreaRegistry`·AI 러너 타깃 어댑터·`/api/svc` 재등록이 그 예다. 공통 뼈대를 함수로 뽑고 도메인은 인자로 넣으면, 기존 트랙의 산출물을 **바이트 동일**로 유지한 채 새 트랙을 얹을 수 있다. 그 동일성을 지키는 것은 기존 트랙의 회귀 하네스다.
- ⚠ 추출에는 **소비 조건**이 따라온다. `@sp/ui`를 쓰는 앱은 `style.css`에 `@source "../../../packages/ui/src"`와 토큰 이름 전부가 있어야 한다 — 없으면 에러 없이 스타일만 사라진다.

## Sources
- [shared-packages](../topics/shared-packages.md)
- [sp-market-web](../topics/sp-market-web.md)
- [sp-develop-web](../topics/sp-develop-web.md)
- [api-contract](../topics/api-contract.md)
- [sp-node-api](../topics/sp-node-api.md)
- [partner-tracks](../topics/partner-tracks.md)
