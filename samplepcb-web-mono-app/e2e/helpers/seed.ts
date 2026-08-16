// 직삽입 시드/정리 프리미티브(스모크 관례 일반화) — 자족 시드→검증→무잔재 정리.
// 시나리오 전용 시드(BOM RFQ 등)는 getPrisma() 로 직접 작성하되, 여기 패턴(등록된
// id 만 정리·잔재 카운트 검증)을 따를 것.
// ⚠ 협력1 에는 진행 중 실데이터가 있다(HANDOFF §5) — 쓰기 시드는 협력2 또는 신규로.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from './api';
import { getPrisma } from './db';
// 2번 고객 아이디는 requireCustomerCreds(2) 가 SECOND_CUSTOMER_ID 로 폴백해 돌려준다.
import { requireCustomerCreds } from './env';
import { signJwt } from './jwt';

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

  // 복제 소스 — 1번 고객이 기본이지만, DB 복구본에는 그 계정도 없을 수 있다(2026-08-13
  // 실측). 그때는 dev 상비 계정 tester 로 폴백한다(demo 러너 로컬판과 같은 우회 —
  // 해시 승계 원칙은 동일하고, JWT 직서명 스펙은 비밀번호를 쓰지 않으므로 무해하다).
  let source = primary;
  const src: any[] = await prisma.$queryRawUnsafe(
    `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
    primary,
  );
  if (src.length === 0) {
    const fallback: any[] = await prisma.$queryRawUnsafe(
      `SELECT mb_id FROM g5_member WHERE mb_id = 'tester'`,
    );
    if (fallback.length === 0) {
      throw new Error(`복제 소스가 없습니다(${primary}·tester 모두 부재) — dev DB 확인`);
    }
    source = 'tester';
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
    source,
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

// ── MD 무대(계정·조직·연결·관계) 자기창조 — md-* 스펙 공용 ──────────────────
// DB 복구·초기화로 픽스처가 사라지면 md e2e 전체가 getPartner throw 로 눕고, 그렇다고
// 실계정(mdtester)에 조직을 **직삽입으로 덧연결**하면 1계정=1조직 운영 가드를 우회해
// 사용자 무대를 오염시킨다(2026-08-13 실측 — 복구 DB 에서 mdtester 는 이미 다른 조직
// 소속이었다). 그래서 ① 계정은 e2e 전용(e2e-* 복제)만 쓰고 ② 기존 멤버십이 있으면
// 그 조직을 무대로 재사용하며(두 번째 연결을 절대 만들지 않는다) ③ 없을 때만 조직을
// 만들어 연결한다. 관계는 관리자 API 로 걸어 전환 가드 검증을 겸한다. 전부 멱등 —
// 무대(계정·조직·관계)는 상설 픽스처로 남긴다.
export interface MdStagePartnerSpec {
  /** e2e 전용 계정만 쓸 것(e2e-* 접두) — 실계정을 주면 그 계정의 기존 소속을 재사용한다. */
  mbId: string;
  orgName: string;
  country: string;
  currency: string;
}

export async function ensureStagePartner(spec: MdStagePartnerSpec): Promise<PartnerFixture> {
  const prisma = getPrisma();
  await cloneG5Member(spec.mbId, spec.orgName);

  // 1계정=1조직 — 기존 소속이 있으면 그 조직이 곧 무대다(연결을 늘리지 않는다).
  const membership = await prisma.spPartnerMember.findFirst({
    where: { mbId: spec.mbId },
    include: { partner: true },
    orderBy: { id: 'asc' },
  });
  if (membership !== null) {
    if (membership.partner.status !== 'approved') {
      await prisma.spPartner.update({
        where: { id: membership.partnerId },
        data: { status: 'approved' },
      });
    }
    return getPartner(membership.partner.name);
  }

  let org = await prisma.spPartner.findFirst({ where: { name: spec.orgName } });
  if (org === null) {
    org = await prisma.spPartner.create({
      data: {
        type: 'partner',
        name: spec.orgName,
        status: 'approved',
        country: spec.country,
        defaultCurrency: spec.currency,
        capabilities: ['pcb_rfq'],
        contactName: spec.orgName,
        contactEmail: `${spec.mbId}@test.local`,
      },
    });
  }
  await prisma.spPartnerMember.create({
    data: { partnerId: org.id, mbId: spec.mbId, role: 'owner' },
  });
  return getPartner(org.name);
}

/** MD 관계(parent→child) 멱등 확보 — 없을 때만 관리자 API 로 건다(전환 가드 검증 겸). */
export async function ensureMdRelation(
  parent: PartnerFixture,
  child: PartnerFixture,
  settlementCurrency: string,
): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.spPartnerRelation.findFirst({
    where: { parentPartnerId: parent.id, childPartnerId: child.id },
  });
  if (existing !== null) return;
  const admin = signJwt({ mbId: 'e2e-admin', isAdmin: true });
  const res = await api(admin, 'POST', `/api/admin/partners/${String(Number(parent.id))}/relations`, {
    childPartnerId: Number(child.id),
    settlementCurrency,
  });
  if (res.status !== 200) {
    throw new Error(`MD 관계 생성 실패(${String(res.status)}): ${JSON.stringify(res.json)}`);
  }
}

// ── g5 주문 픽스처 직삽입 — "열린 주문"이 필요한 주행용 ──────────────────────
// 고객 주문내역 축(진행 카드·확인 요청·좌표파일)은 **od 가 배송·완료·취소가 아닐 때만**
// 뜬다. 그런데 실데이터에서 그 조건을 만족하는 건은 제품군에 따라 아예 없을 수 있다
// (실측 2026-08-16: metalMask 1,275건이 전부 완료·취소 — 협력 트랙 자체가 신규라 당연하다).
// 실주문의 상태를 잠깐 바꿔 쓰는 건 공유 DB 에서 할 짓이 아니므로, **주문·카트·스펙을
// 통째로 e2e 소유로 만들어** 쓰고 지운다. 컬럼은 기존 행에서 복사한다(코어가 컬럼을 늘려도
// 따라가고, NOT NULL 기본값을 하나씩 채울 필요가 없다 — cloneG5Member 와 같은 수법).

export interface G5OrderFixture {
  odId: string;
  ctId: number;
}

/**
 * 주문 1건 + 카트 행 1줄을 만든다(둘 다 '입금' = 열린 상태). 정리는 [[deleteOrderHard]].
 *
 * od_id 는 **14자리 9-접두 합성값**이다 — 코어가 쓰는 YmdHis+2 는 16자리라, 자릿수만으로
 * 실주문과 갈리고 `ORDER BY od_id DESC` 의 '최신 주문' 조회를 가리지 않는다.
 */
export async function createG5OrderFixture(mbId: string, name: string): Promise<G5OrderFixture> {
  const prisma = getPrisma();
  const odId = `9${String(Date.now())}`; // 14자리 — 코어 16자리와 자릿수로 갈린다

  const copyRow = async (
    table: string,
    pk: string,
    overrides: Record<string, string>,
    sourceWhere: string,
  ): Promise<void> => {
    const cols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME <> ?`,
      table,
      pk,
    );
    const names = cols.map((c) => String(c.COLUMN_NAME));
    const insertList = names.map((n) => `\`${n}\``).join(', ');
    const selectList = names.map((n) => overrides[n] ?? `\`${n}\``).join(', ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (${insertList}) SELECT ${selectList} FROM ${table} ${sourceWhere} LIMIT 1`,
    );
  };

  // 주문 — od_id 는 PK 라 복사 목록에서 빼고 명시 컬럼으로 따로 싣는다.
  const orderCols: any[] = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_order'`,
  );
  const oNames = orderCols.map((c) => String(c.COLUMN_NAME));
  const oOverrides: Record<string, string> = {
    od_id: odId,
    mb_id: `'${mbId}'`,
    od_name: `'${name}'`,
    od_status: `'입금'`,
    od_time: 'NOW()',
  };
  await prisma.$executeRawUnsafe(
    `INSERT INTO g5_shop_order (${oNames.map((n) => `\`${n}\``).join(', ')})
       SELECT ${oNames.map((n) => oOverrides[n] ?? `\`${n}\``).join(', ')}
         FROM g5_shop_order ORDER BY od_id DESC LIMIT 1`,
  );

  // 카트 행 — ct_id 는 auto_increment 라 빼고 복사한다.
  await copyRow(
    'g5_shop_cart',
    'ct_id',
    {
      od_id: odId,
      mb_id: `'${mbId}'`,
      ct_status: `'입금'`,
      ct_time: 'NOW()',
    },
    'ORDER BY ct_id DESC',
  );
  const made: any[] = await prisma.$queryRawUnsafe(
    `SELECT ct_id FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id DESC LIMIT 1`,
    odId,
  );
  const ctId = Number(made[0]?.ct_id ?? 0);
  if (ctId === 0) throw new Error('카트 행 픽스처 생성 실패');
  return { odId, ctId };
}

export interface OrderSpecSeed {
  mbId: string;
  ctId: number;
  projectName: string;
  category: string;
  orderCategory?: string;
  qty?: number;
  specJson?: unknown;
}

/** sp_order_spec 직삽입 — 실데이터에 없는 제품군×상태 조합을 만들 때. 정리는 호출부 몫. */
export async function createOrderSpec(seed: OrderSpecSeed): Promise<any> {
  return getPrisma().spOrderSpec.create({
    data: {
      mbId: seed.mbId,
      quoteId: `e2e-${String(Date.now())}`,
      ctId: seed.ctId,
      projectName: seed.projectName,
      category: seed.category,
      orderCategory: seed.orderCategory ?? 'sample',
      qty: seed.qty ?? 1,
      specJson: (seed.specJson ?? {}) as never,
      status: 'active',
      quoteStatus: 'quoted',
    },
  });
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
