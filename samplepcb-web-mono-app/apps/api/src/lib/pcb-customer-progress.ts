import type { CustomerPcbProgressItemType, PcbProgressStageType } from '@sp/api-contract';
import { prisma } from './prisma';
import { isCanceledCartStatus } from './g5-db';

// ── 고객 주문 상세의 PCB 진행 단계(P4.13) — 협력 트랙 파생, od 무접촉 ─────────
// od 상태는 D6(1차 수동) 결정대로 두고, 실제 제작 진행(EQ→생산→발송→입고)을 sp 축
// 에서 파생해 보여준다. 판정 축은 **최상위 발주(parentPartnerId 0)의 최신 회차** —
// MD 경유는 상위(A)가 하위 상태를 미러하므로 그대로 고객 관점이 된다.
// 협력사명·발주 정보는 싣지 않는다(P4.1 관례 — 공급망 비노출).

interface ShipmentSignal {
  status: string;
  receivedAt: Date | null;
}

/** 순수 판정 — 발주 상태+관리자향 발송 신호 → 고객 단계. 발주 전(null 발주)은 카드 없음.
 *  선적요청(requested)은 아직 실물이 안 움직인 서류 단계라 '발송 준비 중'으로 묶는다 —
 *  운송(shipping)은 shipped 부터다(재점검 확정 08-10). */
export const resolvePcbProgressStage = (
  poStatus: string,
  shipment: ShipmentSignal | null,
): PcbProgressStageType => {
  if (poStatus !== 'produced') {
    return poStatus === 'producing' ? 'producing' : 'eq';
  }
  if (shipment === null || shipment.status === 'preparing' || shipment.status === 'requested') {
    return 'produced';
  }
  if (shipment.receivedAt !== null) return 'received';
  return 'shipping';
};

const STAGE_LABELS: Record<PcbProgressStageType, string> = {
  eq: '제조 확인(EQ) 진행 중',
  producing: '생산 진행 중',
  produced: '생산 완료 — 발송 준비 중',
  shipping: '입고 운송 중',
  received: '입고 완료 — 배송 준비 중',
};

/** 직송(발주 destinationCountry non-null) — 실물이 자사를 거치지 않으므로 '입고' 어휘가
 *  거짓말이 된다: 운송·도착 두 단계만 직송 어휘로 치환한다(재점검 확정 08-10). */
const DIRECT_SHIP_LABELS: Partial<Record<PcbProgressStageType, string>> = {
  shipping: '주문지로 직송 배송 중',
  received: '직송 배송 완료',
};

export const pcbProgressLabel = (
  stage: PcbProgressStageType,
  reorderRound: number,
  directShip = false,
): string =>
  (reorderRound > 0 ? 'A/S 재생산 — ' : '') +
  ((directShip ? DIRECT_SHIP_LABELS[stage] : undefined) ?? STAGE_LABELS[stage]);

/** 진행 카드를 낼 카트행 — **취소류(취소·반품·품절) 줄은 뺀다**(여정 10호 X7 교정). 부분 취소면
 *  주문 헤더는 '입금' 그대로라 라우트의 od 단위 접힘(PROGRESS_CLOSED_OD)에 안 걸린다. 걸러 내지
 *  않으면 고객 상세에 "주문취소"라고 쓰인 줄이 동시에 "생산 완료 — 발송 준비 중"으로 진행된다. */
export const progressTargetCtIds = (
  lines: readonly { ctId: number; ctStatus: string }[],
): number[] => lines.filter((l) => !isCanceledCartStatus(l.ctStatus)).map((l) => l.ctId);

/** 주문의 카트행들 → 소유 스펙별 진행 카드. 발주(최상위) 없는 스펙·취소된 줄은 항목을 내지 않는다. */
export const listCustomerPcbProgress = async (
  lines: readonly { ctId: number; ctStatus: string }[],
  mbId: string,
): Promise<CustomerPcbProgressItemType[]> => {
  const ctIds = progressTargetCtIds(lines);
  if (ctIds.length === 0) return [];
  const specs = await prisma.spOrderSpec.findMany({
    where: { ctId: { in: ctIds }, mbId, status: 'active' },
    select: { id: true, projectName: true },
  });
  const out: CustomerPcbProgressItemType[] = [];
  for (const spec of specs) {
    // 최상위 발주의 최신 회차 — A/S 진행 중이면 그 회차가 고객이 기다리는 물건이다.
    const po = await prisma.spPcbPo.findFirst({
      where: { specId: spec.id, parentPartnerId: 0n },
      orderBy: { reorderRound: 'desc' },
    });
    if (po === null) continue;
    // 관리자향(고객 배송으로 이어지는) 발송 신호 — 회차 발주의 소속 발송에서 찾는다.
    const link = await prisma.spPcbShipmentPo.findFirst({
      where: { poId: po.id },
      orderBy: { id: 'desc' },
    });
    let shipment: ShipmentSignal | null = null;
    if (link !== null) {
      const row = await prisma.spPcbShipment.findFirst({
        where: { id: link.shipmentId, receiverKind: 'admin' },
        select: { status: true, receivedAt: true },
      });
      if (row !== null) shipment = { status: row.status, receivedAt: row.receivedAt };
    }
    const stage = resolvePcbProgressStage(po.status, shipment);
    out.push({
      specId: Number(spec.id),
      projectName: spec.projectName,
      reorderRound: po.reorderRound,
      stage,
      label: pcbProgressLabel(stage, po.reorderRound, po.destinationCountry !== null),
    });
  }
  return out;
};
