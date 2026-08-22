// ── 입고 스캔으로 입고 완료(D42 2단계, docs/SMARTBOM_PARTNER_RFQ.md §6.35) ──────────────────
// 공급사 발주는 관리자가 협력사 역할까지 대행하므로, 봉투 스캔이 발주 수량을 정확히 채우면 선적 6단계를
// 손으로 넘기지 않고 한 번에 닫는다: (구매 확인 대기면 구매 완료) → 선적 보장(preparing) → 패킹 리스트를
// 스캔 행 그대로 포장(수량·lot·date code, QR 토큰)으로 저장·확정 → 최종 상태 + receivedAt + 포장 received.
// "생략"이 아니라 "스캔으로 자동 채움" — QR 포장 원장·입고일·워크큐 집계가 그대로 살아 있다.
import { prisma } from './prisma';
import { shipmentModeFromCountry } from './bom-shipment-policy';
import {
  BomPackingError,
  finalizeShipmentPackingList,
  loadShipmentPackingList,
  saveShipmentPackingList,
  type BomPackingActor,
} from './bom-packing';
import { receiveShipment } from './bom-po';

export interface ScanPackageSource {
  quantity: number;
  lotCode: string | null;
  dateCode: string | null;
}
export interface ScanPackage {
  quantity: number;
  lotNo: string | null;
  dateCode: string | null;
}

const MAX_PACKAGES_PER_ITEM = 20; // D24-1 — 발주 품목당 포장 최대 20개

/** 스캔 행 → 포장 행. 기본은 스캔 1건 = 포장 1개(봉투 하나가 실물 단위). 20개를 넘으면 같은 lot/date code 끼리
 *  합치고, 그래도 넘치면 꼬리를 마지막 포장에 합친다(총수량 보존). 순수 함수 — 단위 테스트 대상. */
export const packagesFromScans = (scans: readonly ScanPackageSource[]): ScanPackage[] => {
  let packages: ScanPackage[] = scans
    .filter((scan) => scan.quantity > 0)
    .map((scan) => ({ quantity: scan.quantity, lotNo: scan.lotCode, dateCode: scan.dateCode }));
  if (packages.length > MAX_PACKAGES_PER_ITEM) {
    const merged = new Map<string, ScanPackage>();
    for (const pkg of packages) {
      const key = `${pkg.lotNo ?? ''}|${pkg.dateCode ?? ''}`;
      const prev = merged.get(key);
      if (prev === undefined) merged.set(key, { ...pkg });
      else prev.quantity += pkg.quantity;
    }
    packages = [...merged.values()];
  }
  if (packages.length > MAX_PACKAGES_PER_ITEM) {
    const head = packages.slice(0, MAX_PACKAGES_PER_ITEM - 1);
    const tail = packages.slice(MAX_PACKAGES_PER_ITEM - 1);
    head.push({
      quantity: tail.reduce((sum, pkg) => sum + pkg.quantity, 0),
      lotNo: tail[0]?.lotNo ?? null,
      dateCode: tail[0]?.dateCode ?? null,
    });
    packages = head;
  }
  return packages;
};

export type CompleteReceivingError =
  | 'PO_NOT_FOUND'
  | 'NOT_SUPPLIER_PO'
  | 'PO_CLOSED'
  | 'ALREADY_RECEIVED'
  | 'NOT_COMPLETE'
  | 'OVER_RECEIVED'
  | 'PARTNER_COUNTRY_REQUIRED'
  | 'PACKING_FAILED'
  | 'RECEIVE_FAILED';

export type CompleteReceivingResult =
  | {
      ok: true;
      data: {
        poId: number;
        shipmentId: number;
        packages: number; // 이번에 스캔으로 만든 포장 수(이미 사람이 저장한 패킹 리스트가 있으면 0)
        scans: number;
        poConfirmedNow: boolean;
        receivedAt: string;
      };
    }
  | { ok: false; error: CompleteReceivingError; detail?: string };

export const completeReceivingByScans = async (
  poId: bigint,
  actor: BomPackingActor,
): Promise<CompleteReceivingResult> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: {
      partner: true,
      items: { orderBy: { id: 'asc' }, include: { shortage: true } },
      shipmentLink: { include: { shipment: true } },
    },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  if (po.partner.supplierCode === null) return { ok: false, error: 'NOT_SUPPLIER_PO' };
  if (po.status === 'closed') return { ok: false, error: 'PO_CLOSED' };
  if (po.shipmentLink?.shipment.receivedAt != null) return { ok: false, error: 'ALREADY_RECEIVED' };

  const scans = await prisma.spBomReceivingScan.findMany({
    where: { poItemId: { in: po.items.map((item) => item.id) }, voidedAt: null },
    orderBy: { id: 'asc' },
  });
  const scansByItem = new Map<string, typeof scans>();
  for (const scan of scans) {
    const key = scan.poItemId?.toString() ?? '';
    scansByItem.set(key, [...(scansByItem.get(key) ?? []), scan]);
  }
  const shortItems: string[] = [];
  const overItems: string[] = [];
  for (const item of po.items) {
    const expected = Math.max(0, item.qty - (item.shortage?.shortageQty ?? 0));
    if (expected === 0) continue;
    const scanned = (scansByItem.get(item.id.toString()) ?? []).reduce((sum, s) => sum + s.quantity, 0);
    if (scanned > expected) overItems.push(`${item.mpn} ${String(scanned)}/${String(expected)}`);
    else if (scanned < expected) shortItems.push(`${item.mpn} ${String(scanned)}/${String(expected)}`);
  }
  if (overItems.length > 0) return { ok: false, error: 'OVER_RECEIVED', detail: overItems.join(', ') };
  if (shortItems.length > 0) return { ok: false, error: 'NOT_COMPLETE', detail: shortItems.join(', ') };

  // 구매 확인 대기면 구매 완료 처리(공급사 PO 의 issued → confirmed 는 관리자 내부 액션)
  const confirmed = await prisma.spBomPo.updateMany({
    where: { id: po.id, status: 'issued' },
    data: { status: 'confirmed', confirmedAt: new Date() },
  });
  const poConfirmedNow = confirmed.count === 1;

  // 선적 보장(preparing) — 없으면 파트너 국가로 모드 파생
  let shipmentId = po.shipmentLink?.shipment.id ?? null;
  if (shipmentId === null) {
    const mode = shipmentModeFromCountry(po.partner.country);
    if (mode === null) return { ok: false, error: 'PARTNER_COUNTRY_REQUIRED' };
    const created = await prisma.spBomShipment.create({
      data: { poId: po.id, quoteId: po.quoteId, mode, status: 'preparing' },
    });
    await prisma.spBomShipmentPo.create({ data: { shipmentId: created.id, poId: po.id } });
    shipmentId = created.id;
  }

  // 패킹 리스트 — 아직 아무도 저장하지 않았고(revision 0) 이 발주서만의 선적일 때 스캔 행으로 채운다
  let packagesCreated = 0;
  const list = await loadShipmentPackingList(shipmentId);
  if (list !== null && list.editable && list.revision === 0) {
    const foreign = list.items.some((item) => item.poId !== Number(po.id));
    if (!foreign) {
      const body = {
        items: list.items.map((item) => ({
          poItemId: item.poItemId,
          packages: packagesFromScans(scansByItem.get(String(item.poItemId)) ?? []).map((pkg) => ({
            packageId: null,
            quantity: pkg.quantity,
            lotNo: pkg.lotNo,
            dateCode: pkg.dateCode,
          })),
        })),
      };
      try {
        await saveShipmentPackingList(shipmentId, body, actor);
        packagesCreated = body.items.reduce((sum, item) => sum + item.packages.length, 0);
        await finalizeShipmentPackingList(shipmentId);
      } catch (err) {
        if (err instanceof BomPackingError) return { ok: false, error: 'PACKING_FAILED', detail: err.code };
        throw err;
      }
    }
  }

  const note = `입고 스캔 ${String(scans.length)}건으로 완료(선적 단계 생략)`;
  const received = await receiveShipment(po.id, note, actor);
  if (!received.ok) return { ok: false, error: 'RECEIVE_FAILED', detail: received.error };
  return {
    ok: true,
    data: {
      poId: Number(po.id),
      shipmentId: Number(shipmentId),
      packages: packagesCreated,
      scans: scans.length,
      poConfirmedNow,
      receivedAt: new Date().toISOString(),
    },
  };
};
