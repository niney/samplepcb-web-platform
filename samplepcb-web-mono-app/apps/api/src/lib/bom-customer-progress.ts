import type { BomProgressStageType, CustomerOrderProgressItemType } from '@sp/api-contract';
import { BOM_PROGRESS_STAGES } from '@sp/api-contract';
import { prisma } from './prisma';
import { isCanceledCartStatus } from './g5-db';

// ── 고객 주문의 BOM 조달·물류 진행 — sp_bom_po/sp_bom_shipment 파생, od 무접촉 ───────
// PCB 의 pcb-customer-progress 와 같은 자리. 실측(2026-08-25 §6.35)에서 고객은 입금→입고
// 다섯 단계를 전부 '입금완료'로 봤다 — 관리자 타임라인 ⑦~⑩ 을 고객 어휘로 옮긴다.
// 협력사명·발주가·협력사 수는 싣지 않는다(공급망 비노출, 여정 43호). '일부 앞서감' 만 알린다.

export interface BomPoSignal {
  status: string; // issued|confirmed|closed
  shipment: { status: string; mode: string; receivedAt: Date | null } | null;
}

const STAGE_ORDER: Record<BomProgressStageType, number> = Object.fromEntries(
  BOM_PROGRESS_STAGES.map((s, i) => [s, i]),
) as Record<BomProgressStageType, number>;

/** 발주서 하나의 단계 — 선적이 붙으면 선적이, 아니면 발주 상태가 말한다. */
export const resolveBomPoStage = (po: BomPoSignal): BomProgressStageType => {
  const s = po.shipment;
  if (s !== null) {
    if (s.receivedAt !== null || s.status === 'delivered' || s.status === 'done') return 'received';
    // 선적요청(requested)은 아직 실물이 안 움직인 서류 단계 — 발송 준비로 묶는다(PCB 와 같은 규칙).
    if (s.status === 'preparing' || s.status === 'requested') return 'packing';
    return 'inbound'; // shipping · shipped · arrived · customs
  }
  if (po.status === 'confirmed' || po.status === 'closed') return 'procure_confirmed';
  return 'procuring';
};

export interface BomProgressResolved {
  stage: BomProgressStageType;
  /** 발주 여러 건 중 일부가 더 앞서 있다. */
  partial: boolean;
  /** 국제 선적이 섞여 있다(운송 어휘를 '해외'로). */
  international: boolean;
  /** 통관 단계인 선적이 있다. */
  customs: boolean;
}

/** Case 의 발주서 전체 → 고객 단계. 발주 전이면 '조달 준비'. 여러 건이면 **가장 느린** 것. */
export const resolveBomProgress = (pos: readonly BomPoSignal[]): BomProgressResolved => {
  if (pos.length === 0) return { stage: 'procure_pending', partial: false, international: false, customs: false };
  const stages = pos.map(resolveBomPoStage);
  // 가장 늦은 칸에서 시작해 내려간다 — 배열이 비지 않았으니 실제 최소로 수렴한다(non-null 단언 회피).
  let min: BomProgressStageType = 'received';
  for (const s of stages) if (STAGE_ORDER[s] < STAGE_ORDER[min]) min = s;
  return {
    stage: min,
    partial: stages.some((s) => s !== min),
    international: pos.some((p) => p.shipment?.mode === 'international'),
    customs: pos.some((p) => p.shipment?.status === 'customs'),
  };
};

const STAGE_LABELS: Record<BomProgressStageType, string> = {
  procure_pending: '부품 조달 준비 중',
  procuring: '부품 조달 중',
  procure_confirmed: '부품 조달 확정 — 발송 대기',
  packing: '부품 발송 준비 중',
  inbound: '부품 입고 운송 중',
  received: '부품 입고 완료 — 검수·배송 준비 중',
};
const SHORT_LABELS: Record<BomProgressStageType, string> = {
  procure_pending: '조달 준비',
  procuring: '조달 중',
  procure_confirmed: '조달 확정',
  packing: '발송 준비',
  inbound: '입고 중',
  received: '입고 완료',
};

export const bomProgressLabel = (r: BomProgressResolved): string => {
  let base = STAGE_LABELS[r.stage];
  if (r.stage === 'inbound' && r.international) base = r.customs ? '해외 운송·통관 중' : '해외 부품 운송 중';
  return r.partial ? `${base} (일부 앞서 진행 중)` : base;
};
export const bomProgressShortLabel = (r: BomProgressResolved): string => {
  if (r.stage === 'inbound' && r.international) return r.customs ? '통관 중' : '해외 운송';
  return SHORT_LABELS[r.stage];
};

/**
 * 카트행들 → BOM Case 별 진행 항목. `mbId` null 은 소유 판정 생략(관리자 전용).
 * 취소류 줄은 항목을 내지 않는다(PCB 와 같은 규칙 — 부분 취소는 od 가 활성이라 여기서만 걸린다).
 */
export const listBomProgressForLines = async (
  lines: readonly { ctId: number; ctStatus: string }[],
  mbId: string | null,
): Promise<CustomerOrderProgressItemType[]> => {
  const ctIds = lines.filter((l) => !isCanceledCartStatus(l.ctStatus)).map((l) => l.ctId);
  if (ctIds.length === 0) return [];
  const quotes = await prisma.spBomQuote.findMany({
    where: { ctId: { in: ctIds }, ...(mbId === null ? {} : { mbId }) },
    select: {
      id: true,
      ctId: true,
      title: true,
      pos: {
        select: {
          status: true,
          shipmentLink: {
            select: { shipment: { select: { status: true, mode: true, receivedAt: true } } },
          },
        },
      },
    },
  });
  return quotes.map((q) => {
    const resolved = resolveBomProgress(
      q.pos.map((po) => ({
        status: po.status,
        shipment: po.shipmentLink === null ? null : po.shipmentLink.shipment,
      })),
    );
    return {
      track: 'bom' as const,
      refId: String(q.id),
      ctId: q.ctId,
      projectName: q.title,
      reorderRound: 0,
      stage: resolved.stage,
      label: bomProgressLabel(resolved),
      shortLabel: bomProgressShortLabel(resolved),
      partial: resolved.partial,
      coordFile: null,
    };
  });
};
