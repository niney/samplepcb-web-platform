import type { PcbProjectPayloadType } from '@sp/api-contract';

// cart 화면(ct_option)·사용자 견적 목록·관리자 견적 목록 공용 사양 요약.
// ct_qty=1 고정이라 수량은 이 문자열에 담아 보여준다(HANDOFF 3장).
// routes/pcb-projects.ts 의 파일-로컬 함수를 이동 — 관리자 목록과 표기를 통일한다.
export const buildOptionSummary = (spec: PcbProjectPayloadType['spec'], qty: number): string =>
  [
    String(spec.material ?? spec.kindPcb ?? ''),
    spec.layers !== undefined ? `${String(spec.layers)}L` : '',
    spec.width !== undefined && spec.length !== undefined
      ? `${String(spec.width)}x${String(spec.length)}mm`
      : '',
    `${String(qty)}pcs`,
  ]
    .filter((s) => s !== '')
    .join(' / ');
