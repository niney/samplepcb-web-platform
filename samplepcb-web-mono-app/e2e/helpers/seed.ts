// 직삽입 시드/정리 프리미티브(스모크 관례 일반화) — 자족 시드→검증→무잔재 정리.
// 시나리오 전용 시드(BOM RFQ 등)는 getPrisma() 로 직접 작성하되, 여기 패턴(등록된
// id 만 정리·잔재 카운트 검증)을 따를 것.
// ⚠ 협력1 에는 진행 중 실데이터가 있다(HANDOFF §5) — 쓰기 시드는 협력2 또는 신규로.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPrisma } from './db';
// 2번 고객 아이디는 requireCustomerCreds(2) 가 SECOND_CUSTOMER_ID 로 폴백해 돌려준다.
import { requireCustomerCreds } from './env';

/**
 * 다중 사용자 여정용 2번째 고객 — 1번 고객의 **회원 행을 통째로 복제**해 만든다
 * (idempotent: 있으면 그대로 쓴다). 상설 픽스처라 주행 뒤에도 남긴다.
 *
 * 행 복제인 이유가 둘이다. ① 비밀번호 해시를 그대로 가져오므로 **원문이 코드·문서·
 * .env 어디에도 늘지 않는다**(자격은 1번과 동일). ② 주소·회원등급·수신동의까지 같아
 * 주문서 자동 채움 조건이 1번 고객과 100% 같다 — 두 고객의 차이가 '누구냐' 하나로
 * 좁혀져야 격리 검증의 대조가 성립한다. 같은 방식이 g5 mdtester2 에 선례가 있다.
 */
export async function ensureSecondCustomer(): Promise<{ mbId: string; created: boolean }> {
  return cloneG5Member(requireCustomerCreds(2).id, 'e2e고객2');
}

/**
 * g5 회원을 **1번 고객 행의 복제로** 만든다(idempotent). 협력사 계정처럼 "로그인은 되어야
 * 하는데 자격을 새로 만들 수는 없는" 자리에 쓴다 — [[ensureSecondCustomer]] 와 같은 이유로
 * 행 복제다: 비밀번호 해시를 그대로 가져오므로 **원문이 코드·문서·.env 어디에도 늘지 않고**
 * (자격은 1번 고객과 동일), 회원등급·수신동의가 같아 메일 수신 조건이 흔들리지 않는다.
 * 조직 연결은 별개다 — 관리자 API `POST /partners/:id/members` 로 붙인다.
 */
export async function cloneG5Member(
  mbId: string,
  name: string,
): Promise<{ mbId: string; created: boolean }> {
  const prisma = getPrisma();
  const primary = requireCustomerCreds(1).id;
  const found: any[] = await prisma.$queryRawUnsafe(
    `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
    mbId,
  );
  if (found.length > 0) return { mbId, created: false };

  const src: any[] = await prisma.$queryRawUnsafe(
    `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
    primary,
  );
  if (src.length === 0) {
    throw new Error(`1번 고객(${primary}) 회원이 없어 복제할 수 없습니다 — .env.e2e 확인`);
  }
  // 컬럼 목록을 스키마에서 읽어 그대로 복사한다(코어가 컬럼을 늘려도 따라간다).
  // mb_no 는 auto_increment 라 제외하고, 신원 4가지만 갈아끼운다.
  const cols: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_member' AND COLUMN_NAME <> 'mb_no'`,
  );
  const overrides: Record<string, string> = {
    mb_id: `'${mbId}'`,
    mb_name: `'${name}'`,
    mb_nick: `'${name}'`,
    mb_email: `'${mbId}@test.local'`,
    mb_datetime: 'NOW()',
  };
  const names = cols.map((c) => String(c.COLUMN_NAME));
  const insertList = names.map((n) => `\`${n}\``).join(', ');
  const selectList = names.map((n) => overrides[n] ?? `\`${n}\``).join(', ');
  await prisma.$executeRawUnsafe(
    `INSERT INTO g5_member (${insertList}) SELECT ${selectList} FROM g5_member WHERE mb_id = ?`,
    primary,
  );
  return { mbId, created: true };
}

export interface PartnerFixture {
  id: bigint;
  name: string;
  country: string | null;
  capabilities: unknown;
  /** 알림 메일 수신처 — Mailpit 검증(포털 CTA·대행 안내 대조)의 검색 키 */
  contactEmail: string | null;
  /** 첫 연결 계정(mb_id) — 없으면 null. **null = 포털 토큰을 만들 수 없는 조직**(대행 전용) */
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
    contactEmail: p.contactEmail ?? null,
    mbId: p.members[0]?.mbId ?? null,
  };
}

/**
 * sp_pcb_po 에 아직 안 쓰인 sp_order_spec 을 최신순으로 n건 고른다 — 발주서 UK
 * (specId, partnerId, parentPartnerId, reorderRound) 충돌 함정 회피(HANDOFF §5).
 *
 * ⚠ **status='active' 만** 고른다(2026-08-11 추가). PO 유무만 보던 시절엔 삭제·만료된
 * 스펙이 섞여 RFQ 배정이 409 `NOT_ACTIVE` 로 튕겼다(여정 20·21호가 연달아 걸렸다).
 * 비활성 스펙에 견적요청·발주를 붙이는 것은 어차피 의미가 없으므로 여기서 거른다.
 */
export async function pickFreeSpecs(count: number): Promise<any[]> {
  const prisma = getPrisma();
  const used = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
    (r: any) => r.specId,
  );
  const specs = await prisma.spOrderSpec.findMany({
    where: { id: { notIn: used }, status: 'active' },
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
