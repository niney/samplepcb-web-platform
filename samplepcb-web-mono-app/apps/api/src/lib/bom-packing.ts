import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  BOM_PART_EVENT_TYPES,
  BOM_PART_PACKAGE_STATUSES,
  type AdminBomPartPackageActionBodyType,
  type AdminBomPartPackageDetailType,
  type BomPartEventTypeType,
  type BomPartPackageEventType,
  type BomPartPackageStatusType,
  type BomShipmentPackingListSaveBodyType,
  type BomShipmentPackingListType,
  type BomShipmentPackingPackageType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { getBusinessInfo } from './g5-db';

// ── 선적 리스트·실물 포장 QR 추적(D24) ─────────────────────────────────────
// invoiceData 는 통관 문서 편집본이라 행 추가·삭제·정렬이 자유롭다. 추적 원장은 그 JSON과
// 결합하지 않고 불변 발주 품목(SpBomPoItem)을 선적별로 투영한 뒤 실물 포장 단위에 token을
// 발급한다. token은 식별자일 뿐 권한이 아니며 모든 조회·변경 라우트는 별도 인증을 거친다.

export type BomPackingActorType = 'ADMIN' | 'PARTNER' | 'SYSTEM';
export interface BomPackingActor {
  type: BomPackingActorType;
  mbId: string | null;
}

export type BomPackingErrorCode =
  | 'PACKING_NOT_FOUND'
  | 'PACKING_NOT_PREPARING'
  | 'PACKING_INVALID_ITEMS'
  | 'PACKING_INVALID_QUANTITY'
  | 'PACKING_INVALID_PACKAGE'
  | 'PACKING_TRACKING_LOCKED'
  | 'PACKING_LIST_MISSING'
  | 'PACKAGE_INVALID_ACTION'
  | 'PACKAGE_LOCATION_REQUIRED';

export class BomPackingError extends Error {
  readonly code: BomPackingErrorCode;

  constructor(code: BomPackingErrorCode) {
    super(code);
    this.name = 'BomPackingError';
    this.code = code;
  }
}

type PackingDb = Pick<
  Prisma.TransactionClient,
  'spBomShipment' | 'spBomQuoteItem' | 'spBomShipmentItem' | 'spBomPartPackage' | 'spBomPartEvent'
>;

const loadPackingSource = (db: PackingDb, shipmentId: bigint) =>
  db.spBomShipment.findUnique({
    where: { id: shipmentId },
    include: {
      po: { select: { partnerId: true, partner: { select: { name: true } } } },
      pos: {
        orderBy: { id: 'asc' },
        include: {
          po: {
            select: {
              id: true,
              quoteId: true,
              quote: { select: { title: true } },
              items: { orderBy: { id: 'asc' } },
            },
          },
        },
      },
      packingItems: {
        include: {
          packages: {
            include: { events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } },
            orderBy: [{ packageNo: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
  });

type PackingSource = NonNullable<Awaited<ReturnType<typeof loadPackingSource>>>;
type PackingSourceItem = PackingSource['packingItems'][number];
type PackingSourcePackage = PackingSourceItem['packages'][number];
type PackingSourceEvent = PackingSourcePackage['events'][number];

const packageStatus = (value: string): BomPartPackageStatusType =>
  (BOM_PART_PACKAGE_STATUSES as readonly string[]).includes(value)
    ? (value as BomPartPackageStatusType)
    : (() => {
        throw new Error(`Unknown BOM package status: ${value}`);
      })();

const packageStatusOrNull = (value: string | null): BomPartPackageStatusType | null =>
  value !== null && (BOM_PART_PACKAGE_STATUSES as readonly string[]).includes(value)
    ? (value as BomPartPackageStatusType)
    : null;

const eventType = (value: string): BomPartEventTypeType =>
  (BOM_PART_EVENT_TYPES as readonly string[]).includes(value)
    ? (value as BomPartEventTypeType)
    : (() => {
        throw new Error(`Unknown BOM package event type: ${value}`);
      })();

const toEvent = (event: PackingSourceEvent): BomPartPackageEventType => ({
  eventId: Number(event.id),
  eventType: eventType(event.eventType),
  actorType:
    event.actorType === 'ADMIN' || event.actorType === 'PARTNER' ? event.actorType : 'SYSTEM',
  actorMbId: event.actorMbId,
  fromStatus: packageStatusOrNull(event.fromStatus),
  toStatus: packageStatusOrNull(event.toStatus),
  quantity: event.quantity,
  location: event.location,
  note: event.note,
  occurredAt: event.occurredAt.toISOString(),
});

const toPackage = (pkg: PackingSourcePackage): BomShipmentPackingPackageType => ({
  packageId: Number(pkg.id),
  token: pkg.token,
  labelCode: pkg.labelCode,
  packageNo: pkg.packageNo,
  quantity: pkg.quantity,
  lotNo: pkg.lotNo,
  dateCode: pkg.dateCode,
  status: packageStatus(pkg.status),
  storageLocation: pkg.storageLocation,
  receivedAt: pkg.receivedAt?.toISOString() ?? null,
  inspectedAt: pkg.inspectedAt?.toISOString() ?? null,
  issuedAt: pkg.issuedAt?.toISOString() ?? null,
  events: pkg.events.map(toEvent),
});

const virtualPackage = (quantity: number): BomShipmentPackingPackageType => ({
  packageId: null,
  token: null,
  labelCode: null,
  packageNo: 1,
  quantity,
  lotNo: null,
  dateCode: null,
  status: 'prepared',
  storageLocation: null,
  receivedAt: null,
  inspectedAt: null,
  issuedAt: null,
  events: [],
});

const activePackages = (item: PackingSourceItem): PackingSourcePackage[] =>
  item.packages.filter((pkg) => pkg.voidedAt === null && pkg.status !== 'voided');

/** 협력사 라우트의 서버 단일 소유권 판정. 묶음은 같은 협력사만 허용되므로 대표 PO로 충분. */
export const partnerCanAccessPacking = async (
  shipmentId: bigint,
  partnerId: bigint,
): Promise<boolean> =>
  (await prisma.spBomShipment.count({
    where: { id: shipmentId, po: { partnerId } },
  })) === 1;

export const loadShipmentPackingList = async (
  shipmentId: bigint,
): Promise<BomShipmentPackingListType | null> => {
  const [source, business] = await Promise.all([
    loadPackingSource(prisma, shipmentId),
    getBusinessInfo(),
  ]);
  if (source === null) return null;

  const sourcePoItems = source.pos.flatMap((link) =>
    link.po.items.map((item) => ({
      poId: link.po.id,
      quoteId: link.po.quoteId,
      quoteTitle: link.po.quote.title,
      item,
    })),
  );
  const quoteItemIds = sourcePoItems.map((entry) => entry.item.quoteItemId);
  const quoteItems =
    quoteItemIds.length === 0
      ? []
      : await prisma.spBomQuoteItem.findMany({
          where: { id: { in: quoteItemIds } },
          select: { id: true, partId: true },
        });
  const partIdByQuoteItem = new Map(quoteItems.map((item) => [item.id, item.partId]));
  const savedByPoItem = new Map(source.packingItems.map((item) => [item.poItemId, item]));

  const items = sourcePoItems.map((entry) => {
    const saved = savedByPoItem.get(entry.item.id);
    const packages = saved === undefined ? [] : activePackages(saved).map(toPackage);
    return {
      shipmentItemId: saved === undefined ? null : Number(saved.id),
      poItemId: Number(entry.item.id),
      poId: Number(entry.poId),
      quoteId: String(entry.quoteId),
      quoteTitle: entry.quoteTitle,
      partId:
        saved === undefined
          ? (partIdByQuoteItem.get(entry.item.quoteItemId)?.toString() ?? null)
          : (saved.partId?.toString() ?? null),
      mpn: entry.item.mpn,
      manufacturerName: entry.item.manufacturerName,
      description: entry.item.description,
      expectedQty: entry.item.qty,
      packages: packages.length > 0 ? packages : [virtualPackage(entry.item.qty)],
    };
  });
  const allPackages = items.flatMap((item) => item.packages);
  const mode = source.mode === 'domestic' ? 'domestic' : 'international';
  const allowedStatus =
    mode === 'domestic'
      ? ['preparing', 'shipping', 'delivered']
      : ['preparing', 'requested', 'shipped', 'arrived', 'customs', 'done'];
  const shipmentStatus = (allowedStatus as readonly string[]).includes(source.status)
    ? (source.status as BomShipmentPackingListType['shipmentStatus'])
    : 'preparing';
  return {
    shipmentId: Number(source.id),
    packingNo: `PL-SPB-${String(source.id)}`,
    revision: source.packingRevision,
    editable:
      source.status === 'preparing' &&
      allPackages.every((pkg) => pkg.packageId === null || pkg.status === 'prepared'),
    partnerName: source.po.partner.name,
    mode,
    shipmentStatus,
    shipDate: source.shipDate?.toISOString().slice(0, 10) ?? null,
    consigneeCompany: business?.companyName ?? '',
    consigneeAddress: business?.addr ?? '',
    updatedAt: source.packingUpdatedAt?.toISOString() ?? null,
    finalizedAt: source.packingFinalizedAt?.toISOString() ?? null,
    totalItems: items.length,
    totalPackages: allPackages.length,
    totalQuantity: allPackages.reduce((sum, pkg) => sum + pkg.quantity, 0),
    items,
  };
};

export interface PackingExpectedItem {
  poItemId: number;
  expectedQty: number;
}

/** 입력의 행 집합·중복·포장 수량을 DB 작업 전에 검증하는 순수 코어(단위 테스트 대상). */
export const validatePackingSaveItems = (
  expected: readonly PackingExpectedItem[],
  body: BomShipmentPackingListSaveBodyType,
): BomPackingErrorCode | null => {
  const expectedById = new Map(expected.map((item) => [item.poItemId, item.expectedQty]));
  if (expectedById.size !== expected.length || body.items.length !== expectedById.size) {
    return 'PACKING_INVALID_ITEMS';
  }
  const seenItems = new Set<number>();
  const seenPackages = new Set<number>();
  for (const item of body.items) {
    if (seenItems.has(item.poItemId) || !expectedById.has(item.poItemId)) {
      return 'PACKING_INVALID_ITEMS';
    }
    seenItems.add(item.poItemId);
    const total = item.packages.reduce((sum, pkg) => sum + pkg.quantity, 0);
    if (total !== expectedById.get(item.poItemId)) return 'PACKING_INVALID_QUANTITY';
    for (const pkg of item.packages) {
      if (pkg.packageId === null) continue;
      if (seenPackages.has(pkg.packageId)) return 'PACKING_INVALID_PACKAGE';
      seenPackages.add(pkg.packageId);
    }
  }
  return seenItems.size === expectedById.size ? null : 'PACKING_INVALID_ITEMS';
};

const nullableText = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value.trim();

const newToken = (): string => randomBytes(32).toString('hex');
const newLabelCode = (): string => `PKG-${randomBytes(8).toString('hex').toUpperCase()}`;

const createEvent = (
  db: PackingDb,
  input: {
    packageId: bigint;
    eventType: BomPartEventTypeType;
    actor: BomPackingActor;
    fromStatus: BomPartPackageStatusType | null;
    toStatus: BomPartPackageStatusType | null;
    quantity: number | null;
    location?: string | null;
    note?: string | null;
  },
) =>
  db.spBomPartEvent.create({
    data: {
      packageId: input.packageId,
      eventType: input.eventType,
      actorType: input.actor.type,
      actorMbId: input.actor.mbId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      quantity: input.quantity,
      location: input.location ?? null,
      note: input.note ?? null,
    },
  });

/** preparing 상태에서만 저장. 보존된 packageId는 token을 유지하고 제거된 라벨은 soft-void. */
export const saveShipmentPackingList = async (
  shipmentId: bigint,
  body: BomShipmentPackingListSaveBodyType,
  actor: BomPackingActor,
): Promise<BomShipmentPackingListType> => {
  await prisma.$transaction(
    async (tx) => {
      const source = await loadPackingSource(tx, shipmentId);
      if (source === null) throw new BomPackingError('PACKING_NOT_FOUND');
      if (source.status !== 'preparing') {
        throw new BomPackingError('PACKING_NOT_PREPARING');
      }

      const sourcePoItems = source.pos.flatMap((link) => link.po.items);
      const validation = validatePackingSaveItems(
        sourcePoItems.map((item) => ({ poItemId: Number(item.id), expectedQty: item.qty })),
        body,
      );
      if (validation !== null) throw new BomPackingError(validation);

      const quoteItems = await tx.spBomQuoteItem.findMany({
        where: { id: { in: sourcePoItems.map((item) => item.quoteItemId) } },
        select: { id: true, partId: true },
      });
      const partIdByQuoteItem = new Map(quoteItems.map((item) => [item.id, item.partId]));
      const sourceById = new Map(sourcePoItems.map((item) => [Number(item.id), item]));
      const savedByPoItem = new Map(source.packingItems.map((item) => [item.poItemId, item]));
      const currentPoItemIds = new Set(sourcePoItems.map((item) => item.id));

      // 박스에서 빠진 발주서의 과거 포장은 삭제하지 않고 무효 처리해 이미 인쇄된 QR가
      // 다른 품목으로 재사용되지 않게 한다.
      for (const staleItem of source.packingItems) {
        if (currentPoItemIds.has(staleItem.poItemId)) continue;
        for (const pkg of activePackages(staleItem)) {
          await tx.spBomPartPackage.update({
            where: { id: pkg.id },
            data: { status: 'voided', voidedAt: new Date() },
          });
          await createEvent(tx, {
            packageId: pkg.id,
            eventType: 'voided',
            actor,
            fromStatus: packageStatus(pkg.status),
            toStatus: 'voided',
            quantity: pkg.quantity,
            note: '발송 박스에서 발주서가 제외됨',
          });
        }
      }

      for (const inputItem of body.items) {
        const poItem = sourceById.get(inputItem.poItemId);
        if (poItem === undefined) throw new BomPackingError('PACKING_INVALID_ITEMS');
        const oldItem = savedByPoItem.get(poItem.id);
        const shipmentItem = await tx.spBomShipmentItem.upsert({
          where: { shipmentId_poItemId: { shipmentId, poItemId: poItem.id } },
          create: {
            shipmentId,
            poItemId: poItem.id,
            partId: partIdByQuoteItem.get(poItem.quoteItemId) ?? null,
            expectedQty: poItem.qty,
          },
          update: {
            expectedQty: poItem.qty,
          },
        });
        const oldActive = oldItem === undefined ? [] : activePackages(oldItem);
        const oldById = new Map(oldActive.map((pkg) => [Number(pkg.id), pkg]));
        const keptIds = new Set<number>();

        for (const [index, inputPackage] of inputItem.packages.entries()) {
          const packageNo = index + 1;
          const lotNo = nullableText(inputPackage.lotNo);
          const dateCode = nullableText(inputPackage.dateCode);
          if (inputPackage.packageId === null) {
            const created = await tx.spBomPartPackage.create({
              data: {
                shipmentItemId: shipmentItem.id,
                token: newToken(),
                labelCode: newLabelCode(),
                packageNo,
                quantity: inputPackage.quantity,
                lotNo,
                dateCode,
              },
            });
            await createEvent(tx, {
              packageId: created.id,
              eventType: 'created',
              actor,
              fromStatus: null,
              toStatus: 'prepared',
              quantity: created.quantity,
            });
            continue;
          }

          const old = oldById.get(inputPackage.packageId);
          if (old?.shipmentItemId !== shipmentItem.id) {
            throw new BomPackingError('PACKING_INVALID_PACKAGE');
          }
          if (packageStatus(old.status) !== 'prepared') {
            throw new BomPackingError('PACKING_TRACKING_LOCKED');
          }
          keptIds.add(inputPackage.packageId);
          const changed =
            old.packageNo !== packageNo ||
            old.quantity !== inputPackage.quantity ||
            old.lotNo !== lotNo ||
            old.dateCode !== dateCode;
          if (!changed) continue;
          const changes = [
            old.packageNo === packageNo
              ? null
              : `포장 순번 ${String(old.packageNo)}→${String(packageNo)}`,
            old.quantity === inputPackage.quantity
              ? null
              : `수량 ${String(old.quantity)}→${String(inputPackage.quantity)}`,
            old.lotNo === lotNo ? null : `LOT ${old.lotNo ?? '없음'}→${lotNo ?? '없음'}`,
            old.dateCode === dateCode
              ? null
              : `DATE CODE ${old.dateCode ?? '없음'}→${dateCode ?? '없음'}`,
          ].filter((value): value is string => value !== null);
          await tx.spBomPartPackage.update({
            where: { id: old.id },
            data: { packageNo, quantity: inputPackage.quantity, lotNo, dateCode },
          });
          await createEvent(tx, {
            packageId: old.id,
            eventType: 'updated',
            actor,
            fromStatus: 'prepared',
            toStatus: 'prepared',
            quantity: inputPackage.quantity,
            note: changes.join(' · '),
          });
        }

        for (const old of oldActive) {
          if (keptIds.has(Number(old.id))) continue;
          await tx.spBomPartPackage.update({
            where: { id: old.id },
            data: { status: 'voided', voidedAt: new Date() },
          });
          await createEvent(tx, {
            packageId: old.id,
            eventType: 'voided',
            actor,
            fromStatus: packageStatus(old.status),
            toStatus: 'voided',
            quantity: old.quantity,
            note: '선적 리스트에서 포장 제거',
          });
        }
      }

      const header = await tx.spBomShipment.updateMany({
        where: { id: shipmentId, status: 'preparing', packingRevision: source.packingRevision },
        data: {
          packingRevision: { increment: 1 },
          packingUpdatedAt: new Date(),
          packingFinalizedAt: null,
        },
      });
      if (header.count !== 1) throw new BomPackingError('PACKING_NOT_PREPARING');
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const saved = await loadShipmentPackingList(shipmentId);
  if (saved === null) throw new BomPackingError('PACKING_NOT_FOUND');
  return saved;
};

/** 현재 선적 소속 전 품목이 저장돼 있고 각 포장 합계가 발주 수량과 같은지 재검증. */
export const shipmentPackingListIsComplete = async (shipmentId: bigint): Promise<boolean> => {
  const source = await loadPackingSource(prisma, shipmentId);
  if (source === null || source.packingRevision < 1) return false;
  const sourceItems = source.pos.flatMap((link) => link.po.items);
  if (sourceItems.length === 0) return false;
  const savedByPoItem = new Map(source.packingItems.map((item) => [item.poItemId, item]));
  return sourceItems.every((poItem) => {
    const saved = savedByPoItem.get(poItem.id);
    if (saved === undefined) return false;
    const packages = activePackages(saved);
    return (
      packages.length > 0 &&
      packages.every((pkg) => packageStatus(pkg.status) === 'prepared') &&
      packages.reduce((sum, pkg) => sum + pkg.quantity, 0) === poItem.qty
    );
  });
};

export const finalizeShipmentPackingList = async (shipmentId: bigint): Promise<void> => {
  await prisma.spBomShipment.updateMany({
    where: { id: shipmentId, packingRevision: { gt: 0 } },
    data: { packingFinalizedAt: new Date() },
  });
};

export const reopenShipmentPackingList = async (shipmentId: bigint): Promise<void> => {
  await prisma.spBomShipment.updateMany({
    where: { id: shipmentId, status: 'preparing' },
    data: { packingFinalizedAt: null },
  });
};

/** 인쇄 시도 이력 — reprint는 token/revision을 바꾸지 않고 이벤트만 추가한다. */
export const markShipmentPackingListPrinted = async (
  shipmentId: bigint,
  actor: BomPackingActor,
): Promise<BomShipmentPackingListType> => {
  const source = await loadPackingSource(prisma, shipmentId);
  if (source === null) throw new BomPackingError('PACKING_NOT_FOUND');
  if (source.packingRevision < 1) throw new BomPackingError('PACKING_LIST_MISSING');
  const packages = source.packingItems.flatMap(activePackages);
  if (packages.length === 0) throw new BomPackingError('PACKING_LIST_MISSING');
  await prisma.spBomPartEvent.createMany({
    data: packages.map((pkg) => ({
      packageId: pkg.id,
      eventType: 'printed',
      actorType: actor.type,
      actorMbId: actor.mbId,
      fromStatus: pkg.status,
      toStatus: pkg.status,
      quantity: pkg.quantity,
      note: `선적 리스트 revision ${String(source.packingRevision)} 인쇄`,
    })),
  });
  const list = await loadShipmentPackingList(shipmentId);
  if (list === null) throw new BomPackingError('PACKING_NOT_FOUND');
  return list;
};

/** 준비 중 박스에서 PO를 뺄 때 해당 발주 품목의 이미 발급된 QR을 즉시 무효화. */
export const voidShipmentPackagesForPo = async (
  shipmentId: bigint,
  poId: bigint,
  actor: BomPackingActor,
): Promise<void> => {
  const items = await prisma.spBomShipmentItem.findMany({
    where: { shipmentId, poItem: { poId } },
    include: { packages: { where: { voidedAt: null, status: { not: 'voided' } } } },
  });
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      for (const pkg of item.packages) {
        const updated = await tx.spBomPartPackage.updateMany({
          where: { id: pkg.id, status: pkg.status, voidedAt: null },
          data: { status: 'voided', voidedAt: new Date() },
        });
        if (updated.count !== 1) continue;
        await createEvent(tx, {
          packageId: pkg.id,
          eventType: 'voided',
          actor,
          fromStatus: packageStatus(pkg.status),
          toStatus: 'voided',
          quantity: pkg.quantity,
          note: '발송 박스에서 발주서가 제외됨',
        });
      }
    }
  });
};

/** 기존 선적 전체 입고 액션과 QR 원장을 동기화(이미 입고 이후 상태는 내리지 않음). */
export const receiveAllShipmentPackages = async (
  shipmentId: bigint,
  actor: BomPackingActor,
  note: string | null,
): Promise<void> => {
  const packages = await prisma.spBomPartPackage.findMany({
    where: {
      shipmentItem: { shipmentId },
      voidedAt: null,
      status: 'prepared',
    },
  });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const pkg of packages) {
      const updated = await tx.spBomPartPackage.updateMany({
        where: { id: pkg.id, status: 'prepared', voidedAt: null },
        data: { status: 'received', receivedAt: pkg.receivedAt ?? now },
      });
      if (updated.count !== 1) continue;
      await createEvent(tx, {
        packageId: pkg.id,
        eventType: 'received',
        actor,
        fromStatus: 'prepared',
        toStatus: 'received',
        quantity: pkg.quantity,
        note,
      });
    }
  });
};

export interface PackageTransition {
  status: BomPartPackageStatusType;
  location: string | null;
}

/** 관리자 QR 액션의 허용 전이 순수 코어(단위 테스트 대상). */
export const nextPackageTransition = (
  current: BomPartPackageStatusType,
  body: AdminBomPartPackageActionBodyType,
): PackageTransition | BomPackingErrorCode => {
  if (body.action === 'receive') {
    return current === 'prepared'
      ? { status: 'received', location: null }
      : 'PACKAGE_INVALID_ACTION';
  }
  if (body.action === 'inspect') {
    return current === 'received'
      ? { status: 'inspected', location: null }
      : 'PACKAGE_INVALID_ACTION';
  }
  if (body.action === 'store') {
    if (body.location === null || body.location.trim() === '') return 'PACKAGE_LOCATION_REQUIRED';
    return current === 'received' || current === 'inspected' || current === 'stored'
      ? { status: 'stored', location: body.location.trim() }
      : 'PACKAGE_INVALID_ACTION';
  }
  return current === 'received' || current === 'inspected' || current === 'stored'
    ? { status: 'issued', location: null }
    : 'PACKAGE_INVALID_ACTION';
};

const loadPackageRow = (code: string) => {
  const normalized = code.trim();
  const isToken = /^[a-f0-9]{64}$/i.test(normalized);
  return prisma.spBomPartPackage.findFirst({
    where: isToken ? { token: normalized.toLowerCase() } : { labelCode: normalized.toUpperCase() },
    include: {
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      shipmentItem: {
        include: {
          poItem: { include: { po: { include: { quote: { select: { title: true } } } } } },
          shipment: {
            include: {
              po: { include: { partner: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
};

type PackageRow = NonNullable<Awaited<ReturnType<typeof loadPackageRow>>>;

const toPackageDetail = (row: PackageRow): AdminBomPartPackageDetailType => {
  const shipment = row.shipmentItem.shipment;
  const po = row.shipmentItem.poItem.po;
  const mode = shipment.mode === 'domestic' ? 'domestic' : 'international';
  const allowedStatus =
    mode === 'domestic'
      ? ['preparing', 'shipping', 'delivered']
      : ['preparing', 'requested', 'shipped', 'arrived', 'customs', 'done'];
  const shipmentStatus = (allowedStatus as readonly string[]).includes(shipment.status)
    ? (shipment.status as AdminBomPartPackageDetailType['shipment']['status'])
    : 'preparing';
  return {
    packageId: Number(row.id),
    labelCode: row.labelCode,
    status: packageStatus(row.status),
    quantity: row.quantity,
    lotNo: row.lotNo,
    dateCode: row.dateCode,
    storageLocation: row.storageLocation,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    inspectedAt: row.inspectedAt?.toISOString() ?? null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    item: {
      shipmentItemId: Number(row.shipmentItem.id),
      poItemId: Number(row.shipmentItem.poItemId),
      partId: row.shipmentItem.partId?.toString() ?? null,
      mpn: row.shipmentItem.poItem.mpn,
      manufacturerName: row.shipmentItem.poItem.manufacturerName,
      description: row.shipmentItem.poItem.description,
      expectedQty: row.shipmentItem.expectedQty,
    },
    po: {
      poId: Number(po.id),
      quoteId: String(po.quoteId),
      quoteTitle: po.quote.title,
    },
    shipment: {
      shipmentId: Number(shipment.id),
      packingNo: `PL-SPB-${String(shipment.id)}`,
      mode,
      status: shipmentStatus,
      partnerName: shipment.po.partner.name,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      receivedAt: shipment.receivedAt?.toISOString() ?? null,
    },
    events: row.events.map(toEvent),
  };
};

export const loadPartPackage = async (
  code: string,
): Promise<AdminBomPartPackageDetailType | null> => {
  const row = await loadPackageRow(code);
  return row === null ? null : toPackageDetail(row);
};

export const updatePartPackage = async (
  code: string,
  body: AdminBomPartPackageActionBodyType,
  actor: BomPackingActor,
): Promise<AdminBomPartPackageDetailType | null> => {
  const row = await loadPackageRow(code);
  if (row === null) return null;
  const current = packageStatus(row.status);
  const transition = nextPackageTransition(current, body);
  if (typeof transition === 'string') throw new BomPackingError(transition);
  const now = new Date();
  const note = nullableText(body.note);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.spBomPartPackage.updateMany({
      where: { id: row.id, status: row.status, voidedAt: row.voidedAt },
      data: {
        status: transition.status,
        ...(body.action === 'receive' ? { receivedAt: row.receivedAt ?? now } : {}),
        ...(body.action === 'inspect' ? { inspectedAt: row.inspectedAt ?? now } : {}),
        ...(body.action === 'store' ? { storageLocation: transition.location } : {}),
        ...(body.action === 'issue' ? { issuedAt: row.issuedAt ?? now } : {}),
      },
    });
    if (updated.count !== 1) throw new BomPackingError('PACKAGE_INVALID_ACTION');
    await createEvent(tx, {
      packageId: row.id,
      eventType:
        body.action === 'inspect'
          ? 'inspected'
          : body.action === 'store'
            ? 'stored'
            : body.action === 'issue'
              ? 'issued'
              : 'received',
      actor,
      fromStatus: current,
      toStatus: transition.status,
      quantity: row.quantity,
      location: transition.location,
      note,
    });
  });
  return loadPartPackage(code);
};
