import { inject, provide, type InjectionKey } from 'vue';
import { useCaseCore } from './case-core';
import { useCaseRfq } from './case-rfq';
import { useCasePo } from './case-po';
import { useCaseShipment } from './case-shipment';

// PCB Case 상세의 상태·조작 묶음 — 페이지가 한 번 만들고(providePcbCase) 섹션 컴포넌트가 꺼내 쓴다
// (usePcbCaseContext). 옛 화면은 3,400줄 한 파일이었는데, 섹션을 나누면서 상태를 props 로 실어 나르면
// 같은 값이 여러 겹으로 흘러 다녀 오히려 읽기 어려워진다 — 상태는 한 곳, 그리기만 나눈다.

function createPcbCase() {
  const core = useCaseCore();
  const rfq = useCaseRfq(core);
  const po = useCasePo(core, rfq);
  const ship = useCaseShipment(core);
  return { ...core, ...rfq, ...po, ...ship };
}

export type PcbCaseContext = ReturnType<typeof createPcbCase>;

const PCB_CASE_KEY: InjectionKey<PcbCaseContext> = Symbol('pcb-case');

export function providePcbCase(): PcbCaseContext {
  const ctx = createPcbCase();
  provide(PCB_CASE_KEY, ctx);
  return ctx;
}

export function usePcbCaseContext(): PcbCaseContext {
  const ctx = inject(PCB_CASE_KEY);
  if (ctx === undefined) throw new Error('PcbCase 컨텍스트가 없습니다 — PcbCasePage 안에서만 쓰세요.');
  return ctx;
}
