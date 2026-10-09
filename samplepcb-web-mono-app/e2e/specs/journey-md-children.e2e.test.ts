// 여정 — **하위 협력사 직접 관리**(마스터딜러가 포털에서 자기 하위를 등록·수정·삭제한다).
//
// 그동안 하위 협력사는 관리자만 연결할 수 있었다(파트너 관리 → 마스터딜러 소속). 이 편은 그 일을
// 협력사가 포털에서 직접 하는 경로와, 그 곁에 선 장치들을 한 번에 밟는다(docs/PARTNER_PORTAL.md
// "하위 협력사 직접 관리"):
//   ① 등록은 자동 승인이고 회원은 만들지 않는다 — 조직·소속 링크·소유 표시가 한 번에 선다.
//   ② 소유 경계 — 내가 등록한 조직만 고친다. 관리자가 연결해 준 하위는 읽기 전용이고,
//      다른 조직의 하위는 보이지도 않는다. 남의 하위는 2단 제한으로 하위를 둘 수 없다.
//   ③ 초대 — 1회용 링크를 받은 사람이 **자기 계정으로** 수락해야 포털 계정이 연결된다.
//   ④ 삭제는 이력이 없을 때만 진짜 삭제이고, 이력이 있으면 사용 중지로 남는다. 마스터딜러는
//      자기가 중지한 것만 되살린다(관리자 정지는 못 되살린다).
//   ⑤ 첫 등록 = 마스터딜러 전환 — 진행 중 직속 발주가 있으면 막히고 미리 알린다. 관리자만
//      사유를 남겨 강제로 넘는다(파트너 관리 화면에서도, 포털 대리 접속에서도).
//   ⑥ 관리자 대리 접속 — 관리자가 그 조직의 자리에서 포털을 쓴다. 관리자가 아니면 403,
//      쓰기는 원장에 남고 EQ 이력은 관리자 대행(ADMIN)으로 찍힌다.
//
// 무대는 이 편 전용 조직 3곳(상설 픽스처) — 조직명에 화면 검사 문구를 넣지 않는다(오탐 방지).
// 등록한 하위·관계·시드 발주는 매 주행 앞뒤로 지운다.
//
// 실행: pnpm -F e2e journey:children  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
// 스크린샷 접두사는 **CH** 전용.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  createJourneyReport,
  createPcbPo,
  disconnectPrisma,
  ensureStagePartner,
  getPrisma,
  newSession,
  num,
  pickFreeSpecs,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const ACT_AS = 'x-sp-act-as-partner';
const MD_ACCOUNT = 'e2e-selfmd';
const SUB_ACCOUNT = 'e2e-selfsub';
const BUSY_ACCOUNT = 'e2e-selfbusy';
const INVITEE = 'e2e-selfinvitee';

/** 대리 접속 호출 — 공용 api() 는 헤더를 못 싣는다. */
async function actAs(
  token: string,
  partnerId: bigint | number | string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [ACT_AS]: String(partnerId),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없는 응답 */
  }
  return { status: res.status, json };
}

describe.skipIf(!RUN || !JOURNEY)('여정 — 하위 협력사 직접 관리', () => {
  const rp = createJourneyReport('findings-md-children', '하위 협력사 직접 관리 여정 리포트');
  const { F, ledger } = rp;

  let md: PartnerFixture; // 하위를 직접 등록하는 조직
  let sub: PartnerFixture; // 관리자가 연결해 주는 하위(읽기 전용 대조군)
  let busy: PartnerFixture; // 진행 중 직속 발주가 있는 조직(전환 가드)
  let A = ''; // 관리자
  let M = ''; // md 계정
  let S = ''; // sub 계정
  let B = ''; // busy 계정
  let mdView: E2eSession;
  let adminView: E2eSession;

  const poIds: bigint[] = [];
  let childId = 0; // 주인공 하위(이력을 갖게 되는 쪽)
  let busyPoId = 0;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const children = async (token: string): Promise<any> => {
    const res = await api(token, 'GET', '/api/partner/children');
    expect(res.status, `하위 목록: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json?.data ?? {};
  };
  const itemOf = (data: any, id: number): any =>
    (data.items ?? []).find((i: any) => i.partnerId === id);

  /** 이 편이 만든 것 전부 — 등록 하위(문서·계정 연결 포함)·관계·시드 발주·대리 접속 기록. */
  const purge = async (): Promise<void> => {
    const prisma = getPrisma();
    const stageIds = [md.id, sub.id, busy.id];
    const owned = await prisma.spPartner.findMany({
      where: { ownerPartnerId: { in: stageIds } },
      select: { id: true },
    });
    const ownedIds = owned.map((o: any) => o.id);
    await cleanupPcbPos(poIds.splice(0));
    if (ownedIds.length > 0) {
      const leftPos = await prisma.spPcbPo.findMany({
        where: { partnerId: { in: ownedIds } },
        select: { id: true },
      });
      await cleanupPcbPos(leftPos.map((p: any) => p.id));
      await prisma.spPcbRfq.deleteMany({ where: { partnerId: { in: ownedIds } } });
      await prisma.spPartner.deleteMany({ where: { id: { in: ownedIds } } });
    }
    const leftBusyPos = await prisma.spPcbPo.findMany({
      where: { partnerId: busy.id, parentPartnerId: 0n },
      select: { id: true },
    });
    await cleanupPcbPos(leftBusyPos.map((p: any) => p.id));
    await prisma.spPartnerRelation.deleteMany({
      where: { OR: [{ parentPartnerId: { in: stageIds } }, { childPartnerId: { in: stageIds } }] },
    });
    await prisma.spPartnerMember.deleteMany({ where: { mbId: INVITEE } });
    await prisma.spPartnerActLog.deleteMany({ where: { partnerId: { in: stageIds } } });
    await prisma.spPartner.updateMany({
      where: { id: { in: stageIds } },
      data: { status: 'approved', statusReason: null, ownerSuspendedAt: null },
    });
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    md = await ensureStagePartner({ mbId: MD_ACCOUNT, orgName: 'e2e한빛중개', country: 'KR', currency: 'KRW' });
    sub = await ensureStagePartner({ mbId: SUB_ACCOUNT, orgName: 'e2e별빛제작', country: 'CN', currency: 'USD' });
    busy = await ensureStagePartner({ mbId: BUSY_ACCOUNT, orgName: 'e2e은빛기판', country: 'KR', currency: 'KRW' });
    await purge();
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_ACCOUNT });
    S = signJwt({ mbId: SUB_ACCOUNT });
    B = signJwt({ mbId: BUSY_ACCOUNT });
    mdView = await newSession({ mbId: MD_ACCOUNT }, { partnerModule: 'pcb' });
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(mdView, '마스터딜러');
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    await purge();
    F('CH9', 'obs', '정리 — 등록 하위·관계·시드 발주·대리 접속 기록 삭제(무대 조직 3곳은 상설)');
    rp.write({ 마스터딜러: mdView, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 180_000);

  test('CH1. 등록 — 자동 승인, 회원 없이 조직·링크·소유가 한 번에 선다', async () => {
    const prisma = getPrisma();
    const access = await api(M, 'GET', '/api/partner/access');
    expect(access.json?.data?.canManageChildren, '하위 협력사 메뉴 노출 근거').toBe(true);
    expect(access.json?.data?.actingAdmin, '본인 계정 접속').toBe(false);

    const before = await children(M);
    expect(before.eligibility, '등록 가능').toMatchObject({ allowed: true, reason: null });
    expect(before.items, '시작은 빈 목록').toHaveLength(0);

    const created = await api(M, 'POST', '/api/partner/children', {
      name: ' e2e하위가람 ',
      country: 'cn',
      settlementCurrency: 'CNY',
      contactName: '가람 담당',
      contactEmail: 'garam@test.local',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const item = (created.json?.data?.items ?? [])[0];
    expect(item, '등록된 하위').toMatchObject({
      name: 'e2e하위가람',
      country: 'CN',
      status: 'approved',
      settlementCurrency: 'CNY',
      owned: true,
      hasPortalAccount: false,
      hasHistory: false,
      activeCount: 0,
      invite: null,
    });
    childId = Number(item.partnerId);
    ledger.push(`sp_partner #${String(childId)} (e2e하위가람 — ${md.name} 소유)`);

    const row = await prisma.spPartner.findUnique({ where: { id: BigInt(childId) } });
    expect(num(row.ownerPartnerId), '소유 조직').toBe(num(md.id));
    expect(row.createdBy, '등록 계정').toBe(MD_ACCOUNT);
    expect(row.capabilities, 'PCB 견적 능력 고정').toEqual(['pcb_rfq']);
    expect(row.defaultCurrency, '결제 통화가 조직 기본 통화로').toBe('CNY');
    const members = await prisma.spPartnerMember.count({ where: { partnerId: BigInt(childId) } });
    expect(members, '회원 계정은 만들지 않는다').toBe(0);
    const rel = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: md.id, childPartnerId: BigInt(childId) },
    });
    expect(rel, '소속 링크').toMatchObject({ settlementCurrency: 'CNY', createdBy: MD_ACCOUNT, forceNote: null });

    // 관리자 감독 — 목록 필터·배지 근거, 그리고 운영자 통지 기록.
    const mdOnly = await api(A, 'GET', '/api/admin/partners?origin=md&q=e2e하위가람');
    const listed = (mdOnly.json?.data?.items ?? []).find((p: any) => p.partnerId === childId);
    expect(listed, '마스터딜러 등록 필터에 뜬다').toMatchObject({ ownerPartnerId: num(md.id), ownerPartnerName: md.name });
    const adminOnly = await api(A, 'GET', '/api/admin/partners?origin=admin&q=e2e하위가람');
    expect(
      (adminOnly.json?.data?.items ?? []).some((p: any) => p.partnerId === childId),
      '관리자 등록 필터(직접 배정 후보)에는 안 섞인다',
    ).toBe(false);
    await expect
      .poll(
        () =>
          prisma.spMailLog.count({
            where: { kind: 'partner_child_registered', refType: 'partner', refId: String(childId) },
          }),
        { timeout: 15_000, message: '운영자 통지 메일 기록' },
      )
      .toBe(1);
    F('CH1', 'obs', `등록 실측 — #${String(childId)} 자동 승인·회원 0·소유 ${md.name}·링크 CNY·운영자 통지 1건`);
  }, 120_000);

  test('CH2. 소유 경계 — 내 것만 고치고, 관리자 연결분은 읽기 전용이다', async () => {
    const prisma = getPrisma();
    const updated = await api(M, 'PUT', `/api/partner/children/${String(childId)}`, {
      name: 'e2e하위가람전자',
      settlementCurrency: 'USD',
    });
    expect(updated.status, JSON.stringify(updated.json)).toBe(200);
    expect(itemOf(updated.json?.data, childId)).toMatchObject({ name: 'e2e하위가람전자', settlementCurrency: 'USD' });
    const rel = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: md.id, childPartnerId: BigInt(childId) },
    });
    expect(rel.settlementCurrency, '링크 통화도 함께 바뀐다').toBe('USD');

    // 다른 조직은 내 하위를 볼 수도 고칠 수도 없다.
    const foreign = await api(S, 'PUT', `/api/partner/children/${String(childId)}`, { name: '가로채기' });
    expect(foreign.status, '남의 하위 수정').toBe(404);
    expect((await children(S)).items, '남의 하위는 목록에 없다').toHaveLength(0);

    // 관리자가 연결해 준 하위 — 목록에는 보이지만 포털에서 못 바꾼다.
    const link = await api(A, 'POST', `/api/admin/partners/${String(md.id)}/relations`, {
      childPartnerId: num(sub.id),
      settlementCurrency: 'USD',
    });
    expect(link.status, JSON.stringify(link.json)).toBe(200);
    const mine = await children(M);
    expect(itemOf(mine, num(sub.id)), '관리자 연결 하위는 읽기 전용으로 보인다').toMatchObject({ owned: false });
    for (const [method, body] of [
      ['PUT', { name: '바꾸기' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await api(M, method, `/api/partner/children/${String(sub.id)}`, body);
      expect(res.status, `관리자 연결 하위 ${method}`).toBe(409);
      expect(res.json?.error).toBe('NOT_OWNED');
    }

    // 남의 하위가 된 조직은 하위를 둘 수 없다(2단 제한) — 메뉴도 등록도 닫힌다.
    const subAccess = await api(S, 'GET', '/api/partner/access');
    expect(subAccess.json?.data?.canManageChildren, '하위 조직의 메뉴').toBe(false);
    expect((await children(S)).eligibility).toMatchObject({ allowed: false, reason: 'PARENT_IS_CHILD' });
    const blocked = await api(S, 'POST', '/api/partner/children', {
      name: '3단 시도',
      country: 'KR',
      settlementCurrency: 'KRW',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json?.error).toBe('PARENT_IS_CHILD');
    F('CH2', 'obs', '소유 경계 실측 — 내 하위 수정 200 · 남의 하위 404 · 관리자 연결분 NOT_OWNED · 하위의 하위 PARENT_IS_CHILD');
  }, 120_000);

  test('CH3. 초대 — 받은 사람이 자기 계정으로 수락해야 연결된다(1회용)', async () => {
    const prisma = getPrisma();
    const sent = await api(M, 'POST', `/api/partner/children/${String(childId)}/invite`, {});
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(itemOf(sent.json?.data, childId).invite, '초대 대기').toMatchObject({ email: 'garam@test.local', pending: true });
    const invite = await prisma.spPartnerInvite.findFirst({
      where: { partnerId: BigInt(childId) },
      orderBy: { id: 'desc' },
    });
    const token = String(invite.token);

    // 공개 조회 — 로그인 없이 조직명과 초대한 곳만 본다.
    const info = await api(null, 'GET', `/api/partner-invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.json?.data).toMatchObject({ partnerName: 'e2e하위가람전자', inviterName: md.name, state: 'valid' });
    expect((await api(null, 'POST', `/api/partner-invite/${token}/accept`)).status, '비로그인 수락').toBe(401);

    // 이미 다른 조직에 속한 계정은 수락할 수 없다(1계정=1조직).
    const taken = await api(M, 'POST', `/api/partner-invite/${token}/accept`);
    expect(taken.status).toBe(409);
    expect(taken.json?.error).toBe('MEMBER_ALREADY_LINKED');

    const I = signJwt({ mbId: INVITEE });
    const accepted = await api(I, 'POST', `/api/partner-invite/${token}/accept`);
    expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
    const again = await api(I, 'POST', `/api/partner-invite/${token}/accept`);
    expect(again.status, '두 번째 수락').toBe(409);
    expect(again.json?.error).toBe('INVITE_ACCEPTED');

    const inviteeAccess = await api(I, 'GET', '/api/partner/access');
    expect(inviteeAccess.json?.data, '수락한 계정이 그 조직의 포털에 들어간다').toMatchObject({
      isPartner: true,
      partnerName: 'e2e하위가람전자',
      canManageChildren: false,
    });
    expect(itemOf(await children(M), childId).hasPortalAccount, '마스터딜러 목록에 계정 연결 표시').toBe(true);
    const reinvite = await api(M, 'POST', `/api/partner/children/${String(childId)}/invite`, {});
    expect(reinvite.status).toBe(409);
    expect(reinvite.json?.error).toBe('ALREADY_HAS_ACCOUNT');
    F('CH3', 'obs', '초대 실측 — 공개 조회 valid · 비로그인 401 · 타 조직 계정 MEMBER_ALREADY_LINKED · 수락 200 · 재수락 INVITE_ACCEPTED');
  }, 120_000);

  test('CH4. 삭제 — 이력이 없으면 지우고, 있으면 사용 중지로 남긴다', async () => {
    const prisma = getPrisma();
    // 이력 없는 하위 — 진짜 삭제.
    const temp = await api(M, 'POST', '/api/partner/children', {
      name: 'e2e하위나래',
      country: 'KR',
      settlementCurrency: 'KRW',
    });
    const tempId = Number((temp.json?.data?.items ?? []).find((i: any) => i.name === 'e2e하위나래')?.partnerId);
    const gone = await api(M, 'DELETE', `/api/partner/children/${String(tempId)}`);
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(gone.json?.data?.outcome).toBe('deleted');
    expect(await prisma.spPartner.count({ where: { id: BigInt(tempId) } }), '조직 행이 사라진다').toBe(0);

    // 이력 있는 하위 — 진행 중이면 막히고, 끝난 뒤에는 사용 중지로 남는다.
    const [spec] = await pickFreeSpecs(1);
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: BigInt(childId),
      parentPartnerId: md.id,
      status: 'issued',
      currency: 'USD',
    });
    poIds.push(po.id);
    ledger.push(`sp_pcb_po #${String(po.id)} (${md.name} → e2e하위가람전자 시드)`);
    expect(itemOf(await children(M), childId), '진행 중 1건').toMatchObject({ activeCount: 1, hasHistory: true });
    const active = await api(M, 'DELETE', `/api/partner/children/${String(childId)}`);
    expect(active.status).toBe(409);
    expect(active.json?.error).toBe('RELATION_ACTIVE');

    await prisma.spPcbPo.update({ where: { id: po.id }, data: { status: 'produced' } });
    const kept = await api(M, 'DELETE', `/api/partner/children/${String(childId)}`);
    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(kept.json?.data?.outcome, '이력이 있어 삭제 대신 사용 중지').toBe('suspended');
    expect(itemOf(kept.json?.data, childId)).toMatchObject({ status: 'suspended', ownerSuspended: true });
    // 사용 중지는 정식 배제와 같은 판정을 탄다 — 연결된 계정의 포털이 닫힌다.
    const closed = await api(signJwt({ mbId: INVITEE }), 'GET', '/api/partner/children');
    expect(closed.status, '중지된 조직 계정의 포털').toBe(403);

    // 내가 중지한 것은 되살린다. 관리자가 정지한 것은 못 되살린다.
    const back = await api(M, 'POST', `/api/partner/children/${String(childId)}/reactivate`);
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    expect(itemOf(back.json?.data, childId)).toMatchObject({ status: 'approved', ownerSuspended: false });
    const byAdmin = await api(A, 'POST', `/api/admin/partners/${String(childId)}/status`, {
      status: 'suspended',
      reason: '운영 판단',
    });
    expect(byAdmin.status, JSON.stringify(byAdmin.json)).toBe(200);
    const denied = await api(M, 'POST', `/api/partner/children/${String(childId)}/reactivate`);
    expect(denied.status).toBe(409);
    expect(denied.json?.error).toBe('NOT_OWNER_SUSPENDED');
    F('CH4', 'obs', '삭제 실측 — 무이력 deleted · 진행 중 RELATION_ACTIVE · 유이력 suspended · 소유자 재사용 200 · 관리자 정지분 NOT_OWNER_SUSPENDED');
  }, 180_000);

  test('CH5. 전환 가드 — 진행 중 발주가 있으면 막고, 관리자만 사유를 남겨 넘는다', async () => {
    const prisma = getPrisma();
    const [spec] = await pickFreeSpecs(1);
    const po = await createPcbPo({ specId: spec.id, partnerId: busy.id, status: 'issued' });
    poIds.push(po.id);
    busyPoId = Number(po.id);
    ledger.push(`sp_pcb_po #${String(po.id)} (${busy.name} 직속 시드)`);

    // 협력사 본인 — 폼을 열기 전에 알 수 있고, 눌러도 막힌다.
    const mine = await children(B);
    expect(mine.eligibility, '사전 안내').toMatchObject({ allowed: false, reason: 'ACTIVE_POS', canForce: false });
    expect(mine.eligibility.activePoCount).toBeGreaterThanOrEqual(1);
    expect((mine.eligibility.activePos ?? []).some((p: any) => p.poId === busyPoId), '어느 발주인지').toBe(true);
    const body = { name: 'e2e하위다솜', country: 'KR', settlementCurrency: 'KRW' };
    const blocked = await api(B, 'POST', '/api/partner/children', body);
    expect(blocked.status).toBe(409);
    expect(blocked.json?.error).toBe('PARENT_HAS_ACTIVE_POS');
    // 사유를 보내도 본인은 못 넘는다 — 강제는 관리자 전용이다.
    const selfForce = await api(B, 'POST', '/api/partner/children', { ...body, forceReason: '급함' });
    expect(selfForce.status, '본인 강제 시도').toBe(409);

    // 관리자 대리 접속 — 사유를 남기면 등록된다. 진행 중 발주는 그대로다.
    const acting = await actAs(A, busy.id, 'GET', '/api/partner/children');
    expect(acting.json?.data?.eligibility, '대리 접속은 강제 가능').toMatchObject({ reason: 'ACTIVE_POS', canForce: true });
    const noReason = await actAs(A, busy.id, 'POST', '/api/partner/children', body);
    expect(noReason.status, '사유 없는 대리 등록').toBe(409);
    const forced = await actAs(A, busy.id, 'POST', '/api/partner/children', {
      ...body,
      forceReason: '발주가 끊이지 않아 종결을 기다릴 수 없음',
    });
    expect(forced.status, JSON.stringify(forced.json)).toBe(200);
    const forcedId = Number((forced.json?.data?.items ?? [])[0]?.partnerId);
    const rel = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: busy.id, childPartnerId: BigInt(forcedId) },
    });
    expect(rel, '강제 사유·계정이 링크에 남는다').toMatchObject({
      createdBy: 'e2e-admin',
      forceNote: '발주가 끊이지 않아 종결을 기다릴 수 없음',
    });
    const untouched = await prisma.spPcbPo.findUnique({ where: { id: po.id } });
    expect(untouched.fulfillmentMode, '진행 중 발주는 직접 제작 그대로').toBe('self');

    // 대리 접속의 쓰기는 원장에 남는다(거절된 것도).
    const logs = await api(A, 'GET', `/api/admin/partners/${String(busy.id)}/act-logs`);
    const items: any[] = logs.json?.data?.items ?? [];
    expect(
      items.some((l) => l.method === 'POST' && l.path === '/api/partner/children' && l.statusCode === 200 && l.adminMbId === 'e2e-admin'),
      '성공한 등록 기록',
    ).toBe(true);
    expect(items.some((l) => l.path === '/api/partner/children' && l.statusCode === 409), '거절된 시도 기록').toBe(true);

    // 파트너 관리 화면 경로 — 미리 알리고(conversionBlock), force+사유로만 넘는다.
    const removed = await actAs(A, busy.id, 'DELETE', `/api/partner/children/${String(forcedId)}`);
    expect(removed.json?.data?.outcome, '무이력 하위 정리').toBe('deleted');
    const relations = await api(A, 'GET', `/api/admin/partners/${String(busy.id)}/relations`);
    expect(relations.json?.data?.conversionBlock?.activePoCount, '화면 사전 안내').toBeGreaterThanOrEqual(1);
    const target = { childPartnerId: num(sub.id), settlementCurrency: 'USD' };
    const plain = await api(A, 'POST', `/api/admin/partners/${String(busy.id)}/relations`, target);
    expect(plain.status).toBe(409);
    expect(plain.json?.error).toBe('PARENT_HAS_ACTIVE_POS');
    const forceNoReason = await api(A, 'POST', `/api/admin/partners/${String(busy.id)}/relations`, { ...target, force: true });
    expect(forceNoReason.status, '사유 없는 강제').toBe(400);
    const adminForced = await api(A, 'POST', `/api/admin/partners/${String(busy.id)}/relations`, {
      ...target,
      force: true,
      forceReason: '관리자 판단',
    });
    expect(adminForced.status, JSON.stringify(adminForced.json)).toBe(200);
    expect(
      (adminForced.json?.data?.children ?? []).find((c: any) => c.partnerId === num(sub.id)),
      '강제 전환 표시',
    ).toMatchObject({ forceNote: '관리자 판단', createdBy: 'e2e-admin' });
    F('CH5', 'obs', '전환 가드 실측 — 본인 409(사유 무시) · 대리 접속 강제 200·링크에 사유 · 원장 기록 · 관리자 화면 force 사유 필수');
  }, 180_000);

  test('CH6. 대리 접속 — 관리자만, 정지 조직에도, EQ 이력은 관리자 대행으로', async () => {
    const prisma = getPrisma();
    // 관리자가 아니면 헤더를 실어도 못 들어간다.
    for (const path of ['/api/partner/access', '/api/partner/children']) {
      expect((await actAs(M, busy.id, 'GET', path)).status, `비관리자 ${path}`).toBe(403);
    }
    expect((await actAs(A, 999_999_999, 'GET', '/api/partner/children')).status, '없는 조직').toBe(404);
    expect((await actAs(A, 'abc', 'GET', '/api/partner/children')).status, '형식이 틀린 조직 id').toBe(404);

    const access = await actAs(A, busy.id, 'GET', '/api/partner/access');
    expect(access.json?.data, '그 조직의 판정이 온다').toMatchObject({
      isPartner: true,
      partnerName: busy.name,
      actingAdmin: true,
    });

    // 정지된 조직 — 본인 계정은 닫히고, 관리자는 대행으로 마무리하러 들어간다.
    await api(A, 'POST', `/api/admin/partners/${String(busy.id)}/status`, { status: 'suspended', reason: '운영 판단' });
    expect((await api(B, 'GET', '/api/partner/pcb-pos')).status, '정지 조직 본인').toBe(403);
    expect((await actAs(A, busy.id, 'GET', '/api/partner/pcb-pos')).status, '정지 조직 대리 접속').toBe(200);
    await api(A, 'POST', `/api/admin/partners/${String(busy.id)}/status`, { status: 'approved' });

    // EQ 전이 — 대리 접속이면 이력 주체가 ADMIN 이다(스펙 상태에 따라 전이 자체가 막힐 수 있다).
    const eq = await actAs(A, busy.id, 'POST', `/api/partner/pcb-pos/${String(busyPoId)}/eq-request`, {});
    if (eq.status === 200) {
      const row = await prisma.spPcbPo.findUnique({ where: { id: BigInt(busyPoId) } });
      const history: any[] = Array.isArray(row.eqHistory) ? row.eqHistory : [];
      expect(history.at(-1)?.byRole, 'EQ 이력 주체').toBe('ADMIN');
      F('CH6', 'obs', `EQ 대리 전이 실측 — ${String(row.status)} · byRole=${String(history.at(-1)?.byRole)}`);
    } else {
      F('CH6', 'obs', `EQ 대리 전이는 이 스펙에서 막혔다(${String(eq.json?.error)}) — byRole 대조 생략`);
    }
  }, 180_000);

  test('CH7. 화면 — 포털 하위 협력사 화면과 대리 접속 띠', async () => {
    // 포털 메뉴·목록(마스터딜러 본인).
    await rp.assertView(mdView, '/app/partner/children', 'CH7-portal-children', [
      '하위 협력사',
      'e2e하위가람전자',
      'e2e별빛제작',
      '관리자 연결',
    ]);
    expect(await mdView.page.getByTestId('partner-act-as-banner').count(), '본인 접속엔 띠가 없다').toBe(0);
    expect(await mdView.page.getByTestId('partner-child-row').count(), '하위 행').toBeGreaterThanOrEqual(2);

    // 등록 폼 — 열리고 필수 검증이 선다(등록은 API 편이 이미 밟았다).
    await mdView.page.getByTestId('partner-child-create').click();
    const form = mdView.page.getByTestId('partner-child-form');
    await form.waitFor({ state: 'visible', timeout: 15_000 });
    await form.locator('button[type="submit"]').click();
    await form.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 });
    await rp.shot(mdView, 'CH7-portal-form-validation');

    // 관리자 대리 접속 — 주소의 표식이 걷히고 띠가 선다.
    await adminView.page.goto(`${BASE_URL}/app/partner/children?actAs=${String(md.id)}`, {
      waitUntil: 'domcontentloaded',
    });
    const banner = adminView.page.getByTestId('partner-act-as-banner');
    await banner.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await banner.innerText(), '누구의 자리인지').toContain(md.name);
    expect(adminView.page.url(), '진입 표식은 주소에서 걷힌다').not.toContain('actAs=');
    await adminView.page.getByTestId('partner-child-row').first().waitFor({ state: 'visible', timeout: 30_000 });
    await rp.shot(adminView, 'CH7-act-as-banner');

    // 파트너 관리 — 등록 주체 표시와 포털로 보기.
    await adminView.page.goto(`${BASE_URL}/app/admin/next/partners`, { waitUntil: 'domcontentloaded' });
    await adminView.page.getByTestId('partner-origin-md').click();
    await adminView.page.getByText('e2e하위가람전자').first().click();
    await adminView.page.getByTestId('partner-owner-note').waitFor({ state: 'visible', timeout: 30_000 });
    expect(await adminView.page.getByTestId('partner-act-as').getAttribute('href'), '포털로 보기').toContain('actAs=');
    await rp.shot(adminView, 'CH7-admin-oversight');
    F('CH7', 'obs', '화면 실측 — 포털 목록·등록 폼 검증 · 대리 접속 띠(조직명·주소 정리) · 파트너 관리 등록 주체·포털로 보기');
  }, 240_000);
});
