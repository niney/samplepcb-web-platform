import type { SpOrderSpec } from '@prisma/client';
import type { AdminDeleteBlockReasonType, AdminDeleteWarningType } from '@sp/api-contract';
import type { CartState, OrderInfo } from './g5-db';
import { prisma } from './prisma';

// PCB 견적(Case) 영구 삭제의 판정 코어 — 프리뷰와 실행이 **같은 함수**를 쓴다.
// (프리뷰에서만 판정하고 실행이 다시 세면 둘이 갈라진다 — BOM 삭제의 교훈.)
//
// 위계: 차단(blocker)은 거래·협력 무결성이라 견적 상태보다 우선한다. 우회는
// PAID_ORDER 하나뿐 — 결제는 우리 DB 안의 문제지만 발주·선적은 협력사와 합의된
// 기록이라 관리자 체크 하나로 넘길 수 없다(사용자 결정 2026-08-06).

const PCB_EQ_REF_TYPE = 'sp_pcb_po_eq';
const PCB_SHIPMENT_REF_TYPE = 'sp_pcb_shipment';

export interface PcbTrackFacts {
  rfqs: number;
  pos: number;
  shipments: number;
  attachments: number;
  /** 협력사에 실제로 나간 견적요청(매직링크 발급분) — 경고 판정용. */
  sentRfqs: number;
}

/** 선택 스펙들의 협력 트랙 사실을 한 번에 집계한다(건별 N+1 회피). */
export const loadPcbTrackFacts = async (
  specIds: readonly bigint[],
): Promise<Map<string, PcbTrackFacts>> => {
  const empty = new Map<string, PcbTrackFacts>();
  if (specIds.length === 0) return empty;
  const ids = [...specIds];
  const [rfqs, pos, shipments] = await Promise.all([
    prisma.spPcbRfq.findMany({
      where: { specId: { in: ids } },
      select: { specId: true, magicToken: true },
    }),
    prisma.spPcbPo.findMany({ where: { specId: { in: ids } }, select: { id: true, specId: true } }),
    prisma.spPcbShipment.findMany({
      where: { specId: { in: ids } },
      select: { id: true, specId: true },
    }),
  ]);
  // 첨부는 refType/refId 규약(FK 없음) — 원장 id 를 모아 한 번에 센다.
  const fileGroups =
    pos.length === 0 && shipments.length === 0
      ? []
      : await prisma.spFile.findMany({
          where: {
            OR: [
              ...(pos.length > 0
                ? [{ refType: PCB_EQ_REF_TYPE, refId: { in: pos.map((p) => p.id) } }]
                : []),
              ...(shipments.length > 0
                ? [{ refType: PCB_SHIPMENT_REF_TYPE, refId: { in: shipments.map((s) => s.id) } }]
                : []),
            ],
          },
          select: { refType: true, refId: true },
        });
  const specOfPo = new Map(pos.map((p) => [p.id.toString(), p.specId.toString()]));
  const specOfShipment = new Map(shipments.map((s) => [s.id.toString(), s.specId.toString()]));

  const get = (specId: string): PcbTrackFacts => {
    const cur = empty.get(specId) ?? { rfqs: 0, pos: 0, shipments: 0, attachments: 0, sentRfqs: 0 };
    empty.set(specId, cur);
    return cur;
  };
  for (const id of ids) get(id.toString());
  for (const r of rfqs) {
    const f = get(r.specId.toString());
    f.rfqs += 1;
    if (r.magicToken !== null) f.sentRfqs += 1;
  }
  for (const p of pos) get(p.specId.toString()).pos += 1;
  for (const s of shipments) get(s.specId.toString()).shipments += 1;
  for (const file of fileGroups) {
    const specId =
      file.refType === PCB_EQ_REF_TYPE
        ? specOfPo.get(file.refId.toString())
        : specOfShipment.get(file.refId.toString());
    if (specId !== undefined) get(specId).attachments += 1;
  }
  return empty;
};

export interface PcbCaseDeleteJudgeInput {
  spec: Pick<SpOrderSpec, 'specJson'>;
  cartState: CartState;
  order: OrderInfo | null;
  track: PcbTrackFacts;
  /** 같은 주문에 묶였는데 이번 선택에 없는 형제 견적 수. */
  unselectedSiblingCount: number;
}

export interface PcbCaseDeleteJudgement {
  blockReasons: AdminDeleteBlockReasonType[];
  warnings: AdminDeleteWarningType[];
  isLegacy: boolean;
  deletesOrder: boolean;
  removesCartRow: boolean;
}

const isLegacySpec = (spec: Pick<SpOrderSpec, 'specJson'>): boolean => {
  const json = spec.specJson;
  return typeof json === 'object' && json !== null && '_legacy' in json;
};

export const judgePcbCaseDelete = (input: PcbCaseDeleteJudgeInput): PcbCaseDeleteJudgement => {
  const blockReasons: AdminDeleteBlockReasonType[] = [];
  const warnings: AdminDeleteWarningType[] = [];

  if (input.order?.isPaid === true) blockReasons.push('PAID_ORDER');
  if (input.track.pos > 0) blockReasons.push('PO_ISSUED');
  if (input.track.shipments > 0) blockReasons.push('SHIPMENT_EXISTS');
  if (input.order !== null && input.unselectedSiblingCount > 0) blockReasons.push('SHARED_ORDER');

  const deletesOrder =
    input.cartState === 'ordered' && input.order !== null && !input.order.isPaid;
  const removesCartRow = input.cartState === 'cart';

  if (input.track.sentRfqs > 0) warnings.push('RFQ_EMAILS_REMAIN');
  if (input.track.attachments > 0) warnings.push('PCB_ATTACHMENTS_DELETED');
  if (deletesOrder) warnings.push('UNPAID_ORDER_DELETED');
  const isLegacy = isLegacySpec(input.spec);
  if (isLegacy) warnings.push('LEGACY_CASE');

  return { blockReasons, warnings, isLegacy, deletesOrder, removesCartRow };
};

/** 강제 해제(forceDeletePaidOrder)를 적용한 뒤 남는 차단. 비어 있어야 삭제된다. */
export const remainingBlockers = (
  blockReasons: readonly AdminDeleteBlockReasonType[],
  forceDeletePaidOrder: boolean,
): AdminDeleteBlockReasonType[] =>
  blockReasons.filter((reason) => !(reason === 'PAID_ORDER' && forceDeletePaidOrder));
