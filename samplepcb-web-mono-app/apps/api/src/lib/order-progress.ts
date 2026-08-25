import type { CustomerOrderProgressItemType } from '@sp/api-contract';
import { BOM_PROGRESS_STAGES, PCB_PROGRESS_STAGES } from '@sp/api-contract';
import { listBomProgressForLines } from './bom-customer-progress';
import { getCartRowByCtId, getOrderRow } from './g5-db';
import { listPcbProgressForLines } from './pcb-customer-progress';

// ── 트랙 공용 주문 진행 — PCB(협력 트랙) + BOM(조달·물류) 파생을 한 목록으로 ───────────
// 주문내역(PHP)·/app/bom·관리자 드로어가 이 하나를 읽는다. 한 주문에 두 트랙이 섞이는
// 일은 없지만(D17) 함수는 섞여도 동작한다 — 느린 줄 판정은 트랙별 순서표를 쓴다.

/** 주문이 배송·완료·취소면 파생 카드를 접는다 — 그 뒤엔 코어 배송정보가 정본(재점검 08-10 #4). */
export const PROGRESS_CLOSED_OD = new Set(['배송', '완료', '취소']);

const RANK: Record<string, number> = {
  ...Object.fromEntries(PCB_PROGRESS_STAGES.map((s, i) => [s, i])),
  ...Object.fromEntries(BOM_PROGRESS_STAGES.map((s, i) => [s, i])),
};

export const listOrderProgressForLines = async (
  lines: readonly { ctId: number; ctStatus: string }[],
  mbId: string | null,
  odStatus: string | null = null,
): Promise<CustomerOrderProgressItemType[]> => {
  const [pcb, bomAll] = await Promise.all([
    listPcbProgressForLines(lines, mbId),
    listBomProgressForLines(lines, mbId),
  ]);
  // 미입금('주문')인데 발주 전이면 "조달 준비 중"은 거짓말이다 — 돈이 먼저(PCB 는 발주가 있어야 항목이 생겨 같은 문제가 없다).
  const bom = odStatus === '주문' ? bomAll.filter((b) => b.stage !== 'procure_pending') : bomAll;
  return [
    ...pcb.map((p) => ({
      track: 'pcb' as const,
      refId: String(p.specId),
      ctId: p.ctId,
      projectName: p.projectName,
      reorderRound: p.reorderRound,
      stage: p.stage,
      label: p.label,
      shortLabel: p.shortLabel,
      partial: false,
      coordFile: p.coordFile,
    })),
    ...bom,
  ];
};

/** 여러 줄 중 가장 느린 진행 — 주문 하나의 배지는 그 주문이 못 넘은 단계를 말해야 한다. */
export const slowestOrderProgress = <T extends { stage: string }>(items: readonly T[]): T | null => {
  let out: T | null = null;
  for (const it of items) {
    if (out === null || (RANK[it.stage] ?? 0) < (RANK[out.stage] ?? 0)) out = it;
  }
  return out;
};

export interface QuoteOrderProgress {
  odId: string;
  odStatus: string;
  stage: string | null;
  label: string | null;
  shortLabel: string | null;
}

/**
 * BOM 견적(ctId 연결)의 주문 진행 — /app/bom 상세·히스토리가 "주문내역에서 확인하세요" 대신
 * 실제 단계를 말하게 한다. 배송·완료·취소 뒤엔 od 만 돌려준다(진행 null → 화면은 od 라벨).
 */
export const deriveBomQuoteOrderProgress = async (
  ctId: number | null,
  mbId: string,
): Promise<QuoteOrderProgress | null> => {
  if (ctId === null) return null;
  const cart = await getCartRowByCtId(ctId);
  if (cart === null || cart.odId === '') return null;
  const order = await getOrderRow(cart.odId);
  if (order === null) return null;
  const base = { odId: cart.odId, odStatus: order.status, stage: null, label: null, shortLabel: null };
  if (PROGRESS_CLOSED_OD.has(order.status)) return base;
  const items = await listOrderProgressForLines([{ ctId, ctStatus: cart.ctStatus }], mbId, order.status);
  const it = items.find((i) => i.track === 'bom');
  if (it === undefined) return base;
  return { ...base, stage: it.stage, label: it.label, shortLabel: it.shortLabel };
};
