import { inject, provide, type InjectionKey } from 'vue';
import { useCaseCore } from './case-core';
import { useCaseRfq } from './case-rfq';
import { useCaseItems } from './case-items';
import { useCasePo } from './case-po';
import { useCaseReview } from './case-review';

// SmartBOM Case 상세의 상태·조작 묶음 — 페이지가 한 번 만들고(provideSmartbomCase) 섹션 컴포넌트가 꺼내
// 쓴다(useSmartbomCaseContext). PCB Case 와 같은 구조: 옛 화면은 3,100줄 한 파일이었는데, 섹션을 나누면서
// 상태를 props 로 실어 나르면 같은 값이 여러 겹으로 흘러 다녀 오히려 읽기 어려워진다 — 상태는 한 곳,
// 그리기만 나눈다.

function createSmartbomCase() {
  const core = useCaseCore();
  const rfq = useCaseRfq(core);
  const items = useCaseItems(core);
  const po = useCasePo(core);
  const review = useCaseReview(core, rfq, items);
  return { ...core, ...rfq, ...items, ...po, ...review };
}

export type SmartbomCaseContext = ReturnType<typeof createSmartbomCase>;

const SMARTBOM_CASE_KEY: InjectionKey<SmartbomCaseContext> = Symbol('smartbom-case');

export function provideSmartbomCase(): SmartbomCaseContext {
  const ctx = createSmartbomCase();
  provide(SMARTBOM_CASE_KEY, ctx);
  return ctx;
}

export function useSmartbomCaseContext(): SmartbomCaseContext {
  const ctx = inject(SMARTBOM_CASE_KEY);
  if (ctx === undefined) throw new Error('SmartbomCase 컨텍스트가 없습니다 — SmartbomCasePage 안에서만 쓰세요.');
  return ctx;
}
