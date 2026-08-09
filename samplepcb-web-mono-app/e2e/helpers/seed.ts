// 직삽입 시드/정리 프리미티브(스모크 관례 일반화) — 자족 시드→검증→무잔재 정리.
// 시나리오 전용 시드(BOM RFQ 등)는 getPrisma() 로 직접 작성하되, 여기 패턴(등록된
// id 만 정리·잔재 카운트 검증)을 따를 것.
// ⚠ 협력1 에는 진행 중 실데이터가 있다(HANDOFF §5) — 쓰기 시드는 협력2 또는 신규로.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPrisma } from './db';

export interface PartnerFixture {
  id: bigint;
  name: string;
  country: string | null;
  capabilities: unknown;
  /** 첫 연결 계정(mb_id) — 없으면 null */
  mbId: string | null;
}

/** 협력사 조직 조회(연결 계정 포함) — 예: getPartner('협력2') */
export async function getPartner(name: string): Promise<PartnerFixture> {
  const prisma = getPrisma();
  const p = await prisma.spPartner.findFirst({
    where: { name },
    include: { members: { orderBy: { id: 'asc' } } },
  });
  if (p === null) {
    throw new Error(`협력사 '${name}' 조직이 없습니다 — dev DB 시드 상태 확인(HANDOFF §4)`);
  }
  return {
    id: p.id,
    name: p.name,
    country: p.country ?? null,
    capabilities: p.capabilities,
    mbId: p.members[0]?.mbId ?? null,
  };
}

/**
 * sp_pcb_po 에 아직 안 쓰인 sp_order_spec 을 최신순으로 n건 고른다 — 발주서 UK
 * (specId, partnerId, parentPartnerId, reorderRound) 충돌 함정 회피(HANDOFF §5).
 */
export async function pickFreeSpecs(count: number): Promise<any[]> {
  const prisma = getPrisma();
  const used = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
    (r: any) => r.specId,
  );
  const specs = await prisma.spOrderSpec.findMany({
    where: { id: { notIn: used } },
    orderBy: { id: 'desc' },
    take: count,
  });
  if (specs.length < count) {
    throw new Error(`여유 스펙 부족: ${String(specs.length)}/${String(count)}`);
  }
  return specs;
}

export interface PcbPoSeed {
  specId: bigint;
  partnerId: bigint;
  /** 기본 0n(최상위 발주) — MD 하위 발주는 상위 조직 id */
  parentPartnerId?: bigint;
  /** 기본 'produced'(보내기 보드 선반 진입 상태) */
  status?: string;
  /** null=관리자행(샘플피씨비 수신), 국가코드=고객 직송 — 모드 파생 입력 */
  destinationCountry?: string | null;
  currency?: string;
  priceOriginal?: number;
  reorderRound?: number;
}

/** PCB 발주서 직삽입 — 반환된 행의 id 는 반드시 정리 레지스트리에 등록할 것. */
export async function createPcbPo(seed: PcbPoSeed): Promise<any> {
  const prisma = getPrisma();
  return prisma.spPcbPo.create({
    data: {
      parentPartnerId: 0n,
      reorderRound: 0,
      status: 'produced',
      currency: 'KRW',
      priceOriginal: 100000,
      destinationCountry: null,
      eqHistory: [],
      ...seed,
    },
  });
}

/** 시드 PO 일괄 정리 — 파생 선적(대표행·멤버십) 먼저, PO 마지막. 재호출 멱등. */
export async function cleanupPcbPos(poIds: bigint[]): Promise<void> {
  if (poIds.length === 0) return;
  const prisma = getPrisma();
  await prisma.spPcbShipment.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.spPcbShipmentPo.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.spPcbPo.deleteMany({ where: { id: { in: poIds } } });
}

/** 무잔재 검증용 카운트 — 정리 후 전부 0 이어야 정상. */
export async function countPcbResidue(
  poIds: bigint[],
): Promise<{ pos: number; shipments: number; memberships: number }> {
  if (poIds.length === 0) return { pos: 0, shipments: 0, memberships: 0 };
  const prisma = getPrisma();
  const [pos, shipments, memberships] = await Promise.all([
    prisma.spPcbPo.count({ where: { id: { in: poIds } } }),
    prisma.spPcbShipment.count({ where: { poId: { in: poIds } } }),
    prisma.spPcbShipmentPo.count({ where: { poId: { in: poIds } } }),
  ]);
  return { pos, shipments, memberships };
}
