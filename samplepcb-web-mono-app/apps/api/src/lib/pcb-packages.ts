import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  PCB_PACKAGE_EVENT_TYPES,
  PCB_PACKAGE_STATUSES,
  bomShipmentStatusesOf,
  type AdminPcbPackageDetailType,
  type PcbPackageEventTypeType,
  type PcbPackageEventTypeView,
  type PcbPackageStatusType,
  type PcbShipmentPackageListType,
  type PcbShipmentPackageType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { loadHousePartnerName } from './pcb-rfq';
import { loadPcbCustomerNames } from './pcb-customer';

// ── PCB Case QR ──────────────────────────────────────────────────────────────
// BOM QR은 부품의 실제 포장(릴·트레이 등)이 원장이다. PCB는 완성 보드 한 건이므로
// 합배송 박스 안 PO마다 라벨 1개를 만든다. token은 식별자일 뿐 권한이 아니다.

export type PcbPackageActorType = 'ADMIN' | 'PARTNER' | 'SYSTEM';
export interface PcbPackageActor {
  type: PcbPackageActorType;
  mbId: string | null;
}

export type PcbPackageErrorCode = 'PACKAGE_SHIPMENT_NOT_FOUND' | 'PACKAGE_LABELS_MISSING';

export class PcbPackageError extends Error {
  readonly code: PcbPackageErrorCode;

  constructor(code: PcbPackageErrorCode) {
    super(code);
    this.name = 'PcbPackageError';
    this.code = code;
  }
}

type PackageDb = Pick<
  Prisma.TransactionClient,
  'spPcbShipment' | 'spPcbPackage' | 'spPcbPackageEvent'
>;

const newToken = (): string => randomBytes(32).toString('hex');
const newLabelCode = (): string => `PCB-${randomBytes(8).toString('hex').toUpperCase()}`;

const packageStatus = (value: string): PcbPackageStatusType => {
  if ((PCB_PACKAGE_STATUSES as readonly string[]).includes(value)) {
    return value as PcbPackageStatusType;
  }
  throw new Error(`Unknown PCB package status: ${value}`);
};

const packageStatusOrNull = (value: string | null): PcbPackageStatusType | null =>
  value !== null && (PCB_PACKAGE_STATUSES as readonly string[]).includes(value)
    ? (value as PcbPackageStatusType)
    : null;

const packageEventType = (value: string): PcbPackageEventTypeType => {
  if ((PCB_PACKAGE_EVENT_TYPES as readonly string[]).includes(value)) {
    return value as PcbPackageEventTypeType;
  }
  throw new Error(`Unknown PCB package event type: ${value}`);
};

interface PackageEventRow {
  id: bigint;
  eventType: string;
  actorType: string;
  actorMbId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  occurredAt: Date;
}

const toEvent = (row: PackageEventRow): PcbPackageEventTypeView => ({
  eventId: Number(row.id),
  eventType: packageEventType(row.eventType),
  actorType:
    row.actorType === 'ADMIN' || row.actorType === 'PARTNER' ? row.actorType : 'SYSTEM',
  actorMbId: row.actorMbId,
  fromStatus: packageStatusOrNull(row.fromStatus),
  toStatus: packageStatusOrNull(row.toStatus),
  note: row.note,
  occurredAt: row.occurredAt.toISOString(),
});

/** 현재 박스 구성원 전부에 QR을 보장한다. upsert의 nested create로 동시 호출에도 생성
 * 이벤트가 한 번만 생긴다. preparing에서 뺐다가 같은 박스에 다시 담은 건은 동일한 물리
 * 식별 건이므로 기존 token을 되살리고 재생성 이력을 남긴다. */
export const ensurePcbShipmentPackagesInTransaction = async (
  db: PackageDb,
  shipmentId: bigint,
  actor: PcbPackageActor,
): Promise<void> => {
  const shipment = await db.spPcbShipment.findUnique({
    where: { id: shipmentId },
    include: { pos: { orderBy: { id: 'asc' } } },
  });
  if (shipment === null) throw new PcbPackageError('PACKAGE_SHIPMENT_NOT_FOUND');

  const targetStatus: PcbPackageStatusType =
    shipment.receivedAt === null ? 'prepared' : 'received';
  for (const link of shipment.pos) {
    const row = await db.spPcbPackage.upsert({
      where: { shipmentId_poId: { shipmentId, poId: link.poId } },
      create: {
        shipmentId,
        poId: link.poId,
        token: newToken(),
        labelCode: newLabelCode(),
        status: targetStatus,
        receivedAt: targetStatus === 'received' ? shipment.receivedAt : null,
        events: {
          create: {
            eventType: 'created',
            actorType: actor.type,
            actorMbId: actor.mbId,
            fromStatus: null,
            toStatus: targetStatus,
            note:
              targetStatus === 'received' ? '기존 입고 발송에 PCB QR을 보강함' : null,
          },
        },
      },
      update: {},
    });

    if (packageStatus(row.status) !== 'voided') continue;
    await db.spPcbPackage.update({
      where: { id: row.id },
      data: {
        status: targetStatus,
        receivedAt: targetStatus === 'received' ? shipment.receivedAt : null,
        voidedAt: null,
      },
    });
    await db.spPcbPackageEvent.create({
      data: {
        packageId: row.id,
        eventType: 'created',
        actorType: actor.type,
        actorMbId: actor.mbId,
        fromStatus: 'voided',
        toStatus: targetStatus,
        note: '동일 발송 박스에 PO가 다시 합류함',
      },
    });
  }
};

export const ensurePcbShipmentPackages = async (
  shipmentId: bigint,
  actor: PcbPackageActor,
): Promise<void> => {
  await prisma.$transaction(
    (tx) => ensurePcbShipmentPackagesInTransaction(tx, shipmentId, actor),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
};

const loadShipmentSource = (shipmentId: bigint) =>
  prisma.spPcbShipment.findUnique({
    where: { id: shipmentId },
    include: {
      pos: { orderBy: { id: 'asc' } },
      packages: {
        include: {
          po: { include: { spec: true, partner: { select: { name: true } } } },
          events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        },
        orderBy: [{ poId: 'asc' }, { id: 'asc' }],
      },
    },
  });

type ShipmentPackageSource = NonNullable<Awaited<ReturnType<typeof loadShipmentSource>>>;
type ShipmentPackageRow = ShipmentPackageSource['packages'][number];

const shipmentMode = (value: string): PcbShipmentPackageListType['mode'] =>
  value === 'domestic' ? 'domestic' : 'international';

const shipmentStatus = (
  mode: PcbShipmentPackageListType['mode'],
  value: string,
): PcbShipmentPackageListType['shipmentStatus'] =>
  (bomShipmentStatusesOf(mode) as readonly string[]).includes(value)
    ? (value as PcbShipmentPackageListType['shipmentStatus'])
    : 'preparing';

const toPackage = (
  row: ShipmentPackageRow,
  includeActorIdentity: boolean,
): PcbShipmentPackageType => ({
  packageId: Number(row.id),
  token: row.token,
  labelCode: row.labelCode,
  status: packageStatus(row.status),
  printedAt: row.printedAt?.toISOString() ?? null,
  receivedAt: row.receivedAt?.toISOString() ?? null,
  voidedAt: row.voidedAt?.toISOString() ?? null,
  poId: Number(row.poId),
  specId: Number(row.po.specId),
  projectName: row.po.spec.projectName,
  qty: row.po.spec.qty,
  reorderRound: row.po.reorderRound,
  events: row.events.map((event) => {
    const view = toEvent(event);
    // 파트너 라벨 API에는 고객 정보뿐 아니라 관리자 계정 식별자도 싣지 않는다.
    return includeActorIdentity ? view : { ...view, actorMbId: null };
  }),
});

const receiverNameOf = async (source: ShipmentPackageSource): Promise<string> => {
  if (source.receiverKind !== 'md') return loadHousePartnerName();
  const receiver = await prisma.spPartner.findUnique({
    where: { id: source.receiverPartnerId ?? 0n },
    select: { name: true },
  });
  return receiver?.name ?? '중개 조직';
};

export const loadPcbShipmentPackageList = async (
  shipmentId: bigint,
  actor: PcbPackageActor,
): Promise<PcbShipmentPackageListType | null> => {
  try {
    await ensurePcbShipmentPackages(shipmentId, actor);
  } catch (error) {
    if (error instanceof PcbPackageError && error.code === 'PACKAGE_SHIPMENT_NOT_FOUND') {
      return null;
    }
    throw error;
  }
  const source = await loadShipmentSource(shipmentId);
  if (source === null) return null;
  const memberPoIds = new Set(source.pos.map((link) => link.poId.toString()));
  const packages = source.packages.filter(
    (pkg) =>
      memberPoIds.has(pkg.poId.toString()) &&
      pkg.voidedAt === null &&
      packageStatus(pkg.status) !== 'voided',
  );
  const mode = shipmentMode(source.mode);
  const representative = packages.find((pkg) => pkg.poId === source.poId) ?? packages[0];
  return {
    shipmentId: Number(source.id),
    labelNo: `PCB-LBL-${source.id.toString()}`,
    mode,
    shipmentStatus: shipmentStatus(mode, source.status),
    senderName: representative?.po.partner.name ?? '',
    receiverName: await receiverNameOf(source),
    shipDate: source.shipDate?.toISOString() ?? null,
    carrier: source.carrier,
    trackingNumber: source.trackingNumber,
    totalLabels: packages.length,
    packages: packages.map((pkg) => toPackage(pkg, actor.type === 'ADMIN')),
  };
};

/** 묶음은 같은 보내는 조직만 허용되므로 대표 PO의 수주 조직으로 파트너 접근을 판정한다. */
export const partnerCanAccessPcbPackages = async (
  shipmentId: bigint,
  partnerId: bigint,
): Promise<boolean> => {
  const shipment = await prisma.spPcbShipment.findUnique({
    where: { id: shipmentId },
    select: { poId: true },
  });
  if (shipment === null) return false;
  return (
    (await prisma.spPcbPo.count({ where: { id: shipment.poId, partnerId } })) === 1
  );
};

/** 인쇄/재인쇄는 token을 바꾸지 않고 마지막 인쇄 시각과 append-only 이벤트만 남긴다. */
export const markPcbShipmentPackagesPrinted = async (
  shipmentId: bigint,
  actor: PcbPackageActor,
): Promise<PcbShipmentPackageListType> => {
  await prisma.$transaction(async (tx) => {
    await ensurePcbShipmentPackagesInTransaction(tx, shipmentId, actor);
    const links = await tx.spPcbShipment.findUnique({
      where: { id: shipmentId },
      select: { pos: { select: { poId: true } } },
    });
    if (links === null) throw new PcbPackageError('PACKAGE_SHIPMENT_NOT_FOUND');
    const packages = await tx.spPcbPackage.findMany({
      where: {
        shipmentId,
        poId: { in: links.pos.map((link) => link.poId) },
        voidedAt: null,
        status: { not: 'voided' },
      },
    });
    if (packages.length === 0) throw new PcbPackageError('PACKAGE_LABELS_MISSING');
    const printedAt = new Date();
    await tx.spPcbPackage.updateMany({
      where: { id: { in: packages.map((pkg) => pkg.id) } },
      data: { printedAt },
    });
    await tx.spPcbPackageEvent.createMany({
      data: packages.map((pkg) => ({
        packageId: pkg.id,
        eventType: 'printed',
        actorType: actor.type,
        actorMbId: actor.mbId,
        fromStatus: pkg.status,
        toStatus: pkg.status,
        note: `PCB 라벨 ${packages.length.toString()}장 인쇄`,
      })),
    });
  });
  const list = await loadPcbShipmentPackageList(shipmentId, actor);
  if (list === null) throw new PcbPackageError('PACKAGE_SHIPMENT_NOT_FOUND');
  return list;
};

/** 준비 박스에서 PO를 뺄 때 이미 출력됐을 수 있는 QR을 즉시 무효화한다. */
export const voidPcbShipmentPackageForPo = async (
  shipmentId: bigint,
  poId: bigint,
  actor: PcbPackageActor,
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const row = await tx.spPcbPackage.findUnique({
      where: { shipmentId_poId: { shipmentId, poId } },
    });
    if (row?.voidedAt !== null) return;
    if (packageStatus(row.status) === 'voided') return;
    const updated = await tx.spPcbPackage.updateMany({
      where: { id: row.id, status: row.status, voidedAt: null },
      data: { status: 'voided', voidedAt: new Date() },
    });
    if (updated.count !== 1) return;
    await tx.spPcbPackageEvent.create({
      data: {
        packageId: row.id,
        eventType: 'voided',
        actorType: actor.type,
        actorMbId: actor.mbId,
        fromStatus: row.status,
        toStatus: 'voided',
        note: '발송 박스에서 PO가 제외됨',
      },
    });
  });
};

/** 선적 입고 확인을 QR 원장과 같은 transaction에서 동기화한다. */
export const receiveAllPcbPackagesInTransaction = async (
  tx: Prisma.TransactionClient,
  shipmentId: bigint,
  actor: PcbPackageActor,
  note: string | null,
  receivedAt = new Date(),
): Promise<void> => {
  await ensurePcbShipmentPackagesInTransaction(tx, shipmentId, actor);
  const packages = await tx.spPcbPackage.findMany({
    where: { shipmentId, status: 'prepared', voidedAt: null },
  });
  for (const pkg of packages) {
    const updated = await tx.spPcbPackage.updateMany({
      where: { id: pkg.id, status: 'prepared', voidedAt: null },
      data: { status: 'received', receivedAt },
    });
    if (updated.count !== 1) continue;
    await tx.spPcbPackageEvent.create({
      data: {
        packageId: pkg.id,
        eventType: 'received',
        actorType: actor.type,
        actorMbId: actor.mbId,
        fromStatus: 'prepared',
        toStatus: 'received',
        note,
      },
    });
  }
};

const loadPackageRow = (code: string) => {
  const normalized = code.trim();
  const isToken = /^[a-f0-9]{64}$/i.test(normalized);
  return prisma.spPcbPackage.findFirst({
    where: isToken ? { token: normalized.toLowerCase() } : { labelCode: normalized.toUpperCase() },
    include: {
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      po: { include: { spec: true, partner: { select: { name: true } } } },
      shipment: true,
    },
  });
};

export const loadAdminPcbPackage = async (
  code: string,
): Promise<AdminPcbPackageDetailType | null> => {
  const row = await loadPackageRow(code);
  if (row === null) return null;
  const mode = shipmentMode(row.shipment.mode);
  const names = await loadPcbCustomerNames([
    { specId: row.po.specId, mbId: row.po.spec.mbId, ctId: row.po.spec.ctId },
  ]);
  const base: PcbShipmentPackageType = {
    packageId: Number(row.id),
    token: row.token,
    labelCode: row.labelCode,
    status: packageStatus(row.status),
    printedAt: row.printedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    poId: Number(row.poId),
    specId: Number(row.po.specId),
    projectName: row.po.spec.projectName,
    qty: row.po.spec.qty,
    reorderRound: row.po.reorderRound,
    events: row.events.map(toEvent),
  };
  return {
    ...base,
    mbId: row.po.spec.mbId,
    customerName: names.get(row.po.specId.toString()) ?? '',
    partnerName: row.po.partner.name,
    shipment: {
      shipmentId: Number(row.shipment.id),
      mode,
      status: shipmentStatus(mode, row.shipment.status),
      receiverName: await receiverNameOf({
        ...row.shipment,
        pos: [],
        packages: [],
      }),
      carrier: row.shipment.carrier,
      trackingNumber: row.shipment.trackingNumber,
      shippedAt: row.shipment.shippedAt?.toISOString() ?? null,
      receivedAt: row.shipment.receivedAt?.toISOString() ?? null,
    },
  };
};
