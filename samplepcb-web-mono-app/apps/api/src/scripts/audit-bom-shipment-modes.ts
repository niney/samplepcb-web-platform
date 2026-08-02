// 협력사 국가(실제 발송 출발국)와 생성 시 박제된 선적 mode 정합 감사.
// 기본은 읽기 전용. --apply는 아직 발송 전이고 문서·Packing List가 전혀 없는 안전한
// preparing 불일치만 고친다. 국가 미입력·진행 중 선적은 추측하거나 자동 변경하지 않는다.
// 실행: pnpm --filter api run smartbom:audit-shipment-modes [-- --apply]

import { Prisma, PrismaClient } from '@prisma/client';
import { shipmentModeFromCountry } from '../lib/bom-shipment-policy';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

try {
  const [partners, shipments] = await Promise.all([
    prisma.spPartner.findMany({
      where: { type: 'partner', status: 'approved' },
      orderBy: { id: 'asc' },
    }),
    prisma.spBomShipment.findMany({
      include: {
        po: { include: { partner: true } },
        _count: { select: { packingItems: true } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  const partnersMissingCountry = partners.filter(
    (partner) => shipmentModeFromCountry(partner.country) === null,
  );
  for (const partner of partnersMissingCountry) {
    console.log(
      `[partner country required] #${String(partner.id)} · ${partner.name} · status=${partner.status}`,
    );
  }
  const shipmentIds = shipments.map((shipment) => shipment.id);
  const files =
    shipmentIds.length === 0
      ? []
      : await prisma.spFile.findMany({
          where: { refType: 'sp_bom_shipment', refId: { in: shipmentIds } },
          select: { refId: true },
        });
  const fileShipmentIds = new Set(files.map((file) => file.refId.toString()));

  let unknownCountry = 0;
  let mismatch = 0;
  let safeMismatch = 0;
  let updated = 0;

  for (const shipment of shipments) {
    const expectedMode = shipmentModeFromCountry(shipment.po.partner.country);
    if (expectedMode === null) {
      unknownCountry += 1;
      console.log(
        `[country required] shipment #${String(shipment.id)} · ${shipment.po.partner.name} · current=${shipment.mode}`,
      );
      continue;
    }
    if (expectedMode === shipment.mode) continue;
    mismatch += 1;
    const safe =
      shipment.status === 'preparing' &&
      shipment.shippedAt === null &&
      shipment.receivedAt === null &&
      shipment.completedAt === null &&
      shipment.invoiceData === null &&
      shipment.packingRevision === 0 &&
      shipment.packingFinalizedAt === null &&
      shipment._count.packingItems === 0 &&
      !fileShipmentIds.has(shipment.id.toString());
    if (safe) safeMismatch += 1;
    console.log(
      `[mode mismatch${safe ? ' · safe' : ' · manual review'}] shipment #${String(shipment.id)} · ${shipment.po.partner.name}(${shipment.po.partner.country ?? '-'}) · ${shipment.mode} -> ${expectedMode}`,
    );
    if (!apply || !safe) continue;
    const result = await prisma.spBomShipment.updateMany({
      where: {
        id: shipment.id,
        mode: shipment.mode,
        status: 'preparing',
        shippedAt: null,
        receivedAt: null,
        completedAt: null,
        invoiceData: { equals: Prisma.DbNull },
        packingRevision: 0,
        packingFinalizedAt: null,
        packingItems: { none: {} },
      },
      data: { mode: expectedMode },
    });
    updated += result.count;
  }

  console.log(
    `${apply ? 'apply' : 'audit'} complete — approved partners missing country ${String(partnersMissingCountry.length)}, shipments ${String(shipments.length)}, shipment country required ${String(unknownCountry)}, mismatch ${String(mismatch)}, safe ${String(safeMismatch)}, updated ${String(updated)}`,
  );
} finally {
  await prisma.$disconnect();
}
