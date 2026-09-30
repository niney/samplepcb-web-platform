// 결제 후 부품 확인 요청(D43) — 발주·배송 게이트 판정. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39 D43-9·D43-14.
// bom-po·bom-order-shipping 이 부른다. bom-confirm.ts(요청 본체)와 분리한 이유: 본체는 bom-case-delete 를
// 거쳐 bom-po 를 가져오므로, 게이트까지 거기 두면 bom-po ↔ bom-confirm 순환이 생긴다.
import { z } from 'zod';
import { BomConfirmOption, type BomConfirmOptionType } from '@sp/api-contract';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const OptionList = z.array(BomConfirmOption);

export function parseConfirmOptions(value: Prisma.JsonValue): BomConfirmOptionType[] {
  return OptionList.parse(value);
}

export function chosenConfirmOption(
  options: BomConfirmOptionType[],
  code: string | null,
): BomConfirmOptionType | null {
  if (code === null) return null;
  return options.find((option) => option.code === code) ?? null;
}

/** 열린 이슈(고객 대기·결정됨 미적용)가 걸린 품목 id — 발주 게이트가 본다(D43-9). */
export async function loadOpenConfirmItemIds(quoteId: bigint): Promise<Set<string>> {
  const issues = await prisma.spBomConfirmIssue.findMany({
    where: { status: { in: ['pending', 'decided'] }, request: { quoteId } },
    select: { quoteItemId: true },
  });
  return new Set(issues.map((issue) => String(issue.quoteItemId)));
}

export interface ConfirmShippingState {
  openIssueCount: number;
  /** '먼저 온 것 먼저' 입고 대기 품목이 든 발주서(id → 입고 여부) — 첫 배송의 입고 계산에서 뺀다. */
  deferredPos: Map<string, boolean>;
  /** '모아서 한 번에' 입고 대기 품목 중 아직 받은 발주서에 없는 수 — 배송을 막는다. */
  blockingBackorderCount: number;
}

/** 배송 게이트가 쓰는 Case 별 확인 요청 수치(bom-order-shipping BomOrderReceiptCase 확장 필드). */
export function confirmReceiptFields(state: ConfirmShippingState | undefined): {
  openConfirmIssueCount: number;
  deferredPoCount: number;
  deferredPoReceivedCount: number;
  blockingBackorderCount: number;
} {
  if (state === undefined) {
    return { openConfirmIssueCount: 0, deferredPoCount: 0, deferredPoReceivedCount: 0, blockingBackorderCount: 0 };
  }
  return {
    openConfirmIssueCount: state.openIssueCount,
    deferredPoCount: state.deferredPos.size,
    deferredPoReceivedCount: [...state.deferredPos.values()].filter(Boolean).length,
    blockingBackorderCount: state.blockingBackorderCount,
  };
}

/** 배송 게이트 확장(D43-14) — Case 별 확인 요청 상태를 발주·입고와 엮어 판정한다. */
export async function loadConfirmShippingStates(quoteIds: bigint[]): Promise<Map<string, ConfirmShippingState>> {
  const states = new Map<string, ConfirmShippingState>();
  if (quoteIds.length === 0) return states;
  const issues = await prisma.spBomConfirmIssue.findMany({
    where: { request: { quoteId: { in: quoteIds } }, status: { in: ['pending', 'decided', 'applied'] } },
    select: {
      quoteItemId: true,
      status: true,
      options: true,
      chosenCode: true,
      shipPreference: true,
      followupShippedAt: true,
      request: { select: { quoteId: true, status: true } },
    },
  });
  if (issues.length === 0) return states;
  const poItems = await prisma.spBomPoItem.findMany({
    where: { quoteItemId: { in: [...new Set(issues.map((issue) => issue.quoteItemId))] } },
    select: {
      quoteItemId: true,
      po: { select: { id: true, shipmentLink: { select: { shipment: { select: { receivedAt: true } } } } } },
    },
  });
  const poByItem = new Map<string, { poId: string; received: boolean }[]>();
  for (const poItem of poItems) {
    const list = poByItem.get(String(poItem.quoteItemId)) ?? [];
    list.push({ poId: String(poItem.po.id), received: poItem.po.shipmentLink?.shipment.receivedAt != null });
    poByItem.set(String(poItem.quoteItemId), list);
  }
  for (const issue of issues) {
    if (issue.request.status === 'canceled') continue;
    const key = String(issue.request.quoteId);
    const state = states.get(key) ?? { openIssueCount: 0, deferredPos: new Map<string, boolean>(), blockingBackorderCount: 0 };
    if (issue.status === 'pending' || issue.status === 'decided') {
      state.openIssueCount += 1;
    } else {
      const option = chosenConfirmOption(parseConfirmOptions(issue.options), issue.chosenCode);
      if (option?.kind === 'wait_restock') {
        const pos = poByItem.get(String(issue.quoteItemId)) ?? [];
        if (issue.shipPreference === 'split') {
          if (issue.followupShippedAt === null) for (const po of pos) state.deferredPos.set(po.poId, po.received);
        } else if (!pos.some((po) => po.received)) {
          state.blockingBackorderCount += 1;
        }
      }
    }
    states.set(key, state);
  }
  return states;
}
