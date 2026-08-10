// MD 시나리오 1 — **2단 견적 루프**(가장 간단한 것부터). 주문·발주·물류 없이, 견적요청이
// 마스터딜러를 거쳐 내려갔다가 마진을 얹고 올라오는 것만 본다:
//
//   관리자 → [마스터딜러] 배정 → MD 가 하위(협력2)에 재배정 → 하위 회신(USD)
//   → MD 하위 선정 + 마진% → 상위 회신가 = 하위가 × 환율 × (1+마진%) 자동 산출
//
// mdtester 는 dev DB 의 영속 MD 픽스처다 — g5 회원은 이미 있고(마스터딜러·level 2),
// 조직 연결·MD 관계는 이 스펙의 사전 준비가 **없으면 만들고 있으면 그대로 쓴다**
// (여정 4호처럼 매번 만들고 지우는 게 아니라, 이후 MD 시나리오들이 공유할 상설 무대).
// 조직: '마스터딜러상사'(KR·KRW) — mdtester 연결, 하위: 협력2(링크 통화 USD).
//
// 실행: pnpm -F e2e e2e md-quote-loop  (RUN 게이트만 — 거버·고객 자격 불필요)
// 정리: 이 주행이 만든 RFQ 행만 삭제(스펙 무접촉). 조직·관계·회원 연결은 남긴다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newSession,
  num,
  signJwt,
  snap,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const MD_MB_ID = 'mdtester';
const MD_ORG_NAME = '마스터딜러상사';
const CHILD_NAME = '협력2'; // CN·USD — "국내 중개상이 해외 제조사에 재위탁" 구도
const MARGIN_RATE = 15;

describe.skipIf(!RUN)('MD 시나리오 1 — 2단 견적 루프(mdtester)', () => {
  let child: PartnerFixture;
  let mdPartnerId: bigint | null = null;
  let mdView: E2eSession;
  let A = '';
  let M = ''; // mdtester
  let C = ''; // 협력2

  let specId: number | null = null;
  let topRfqId: number | null = null;
  let childRfqId: number | null = null;
  const createdRfqIds: bigint[] = [];

  beforeAll(async () => {
    const prisma = getPrisma();
    child = await getPartner(CHILD_NAME);
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

    // ── 사전 준비(idempotent) — mdtester 의 조직·연결·관계를 확보한다 ──────────
    // g5 회원은 이미 있다(마스터딜러·level 2). 없는 것은 플랫폼 쪽 세 가지였다:
    // 조직, sp_partner_member 연결, sp_partner_relation. 있으면 재사용한다.
    let org = await prisma.spPartner.findFirst({ where: { name: MD_ORG_NAME } });
    if (org === null) {
      org = await prisma.spPartner.create({
        data: {
          type: 'partner',
          name: MD_ORG_NAME,
          status: 'approved',
          country: 'KR',
          defaultCurrency: 'KRW',
          capabilities: ['pcb_rfq'],
          contactName: '마스터딜러',
          contactEmail: 'mdtester@test.local',
        },
      });
      console.log(`  [setup] 조직 신설: #${String(org.id)} ${MD_ORG_NAME}`);
    }
    mdPartnerId = org.id;

    const link = await prisma.spPartnerMember.findFirst({
      where: { partnerId: org.id, mbId: MD_MB_ID },
    });
    if (link === null) {
      await prisma.spPartnerMember.create({
        data: { partnerId: org.id, mbId: MD_MB_ID, role: 'owner' },
      });
      console.log(`  [setup] ${MD_MB_ID} → ${MD_ORG_NAME} 연결`);
    }

    const relation = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: org.id, childPartnerId: child.id },
    });
    if (relation === null) {
      // 관계는 관리자 API 로 — 2단 강제·MD 전환 가드 검증을 겸한다(신규 조직이라 통과).
      const rel = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/relations`, {
        childPartnerId: num(child.id),
        settlementCurrency: 'USD',
      });
      if (rel.status !== 200) {
        throw new Error(`MD 관계 생성 실패(${String(rel.status)}): ${JSON.stringify(rel.json)}`);
      }
      console.log(`  [setup] 관계 신설: ${MD_ORG_NAME} → ${CHILD_NAME} (USD)`);
    }

    mdView = await newSession({ mbId: MD_MB_ID }, { partnerModule: 'pcb' });
  }, 120_000);

  afterAll(async () => {
    // 이 주행이 만든 RFQ 행만 걷는다 — 스펙은 빌려 쓴 것(무접촉), 조직·관계는 상설 픽스처.
    const prisma = getPrisma();
    if (createdRfqIds.length > 0) {
      await prisma.spPcbRfq.deleteMany({ where: { id: { in: createdRfqIds } } });
    }
    const residue = specId === null ? 0 : await prisma.spPcbRfq.count({ where: { specId: BigInt(specId) } });
    expect(residue, 'RFQ 잔재').toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('M1. 관리자: 마스터딜러상사에 견적요청 — 결제통화는 조직 기본(KRW)으로 박제', async () => {
    // RFQ 게이트(비담김·미주문)를 통과하는 자유 스펙 — pickFreeSpecs 는 발주 사용 여부만
    // 보므로, 담김·주문 연결이 없는(ctId null) 스펙을 직접 고른다(가드 스펙과 같은 이유).
    const prisma = getPrisma();
    const usedSpecIds = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
      (r: { specId: bigint }) => r.specId,
    );
    const spec = await prisma.spOrderSpec.findFirst({
      where: {
        status: 'active',
        ctId: null,
        id: { notIn: usedSpecIds },
        pcbRfqs: { none: {} },
      },
      orderBy: { id: 'desc' },
    });
    if (spec === null) throw new Error('게이트 통과 자유 스펙이 없습니다');
    specId = num(spec.id);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(mdPartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const row = (send.json?.data?.rfqs ?? []).find(
      (v: any) => v.partnerId === num(mdPartnerId ?? 0n),
    );
    expect(row, 'MD RFQ 행').toBeTruthy();
    topRfqId = row.rfqId;
    createdRfqIds.push(BigInt(topRfqId ?? 0));
    expect(row.currency, '관리자↔MD 통화(조직 기본)').toBe('KRW');
  });

  test('M2. MD 포털: 받은 요청이 보이고, 하위(협력2)에 재배정한다', async (ctx) => {
    if (topRfqId === null) return ctx.skip();
    // mdtester 로그인 관점 — 포털 목록에 방금 요청이 뜬다.
    const list = await api(M, 'GET', '/api/partner/pcb-rfqs');
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const mine = (list.json?.data?.items ?? []).find((r: any) => r.rfqId === topRfqId);
    expect(mine, 'MD 포털 목록에 요청 노출').toBeTruthy();

    await mdView.page.goto(`${BASE_URL}/app/partner/pcb/rfqs/${String(topRfqId)}`);
    await mdView.page.waitForLoadState('networkidle').catch(() => undefined);
    await snap(mdView.page, 'md-loop/M02-md-rfq-detail');

    // 하위 배정 — 소속(관계) 조직만 허용된다.
    const assign = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(child.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 배정: ${JSON.stringify(assign.json)}`).toBe(200);

    const prisma = getPrisma();
    const childRfq = await prisma.spPcbRfq.findFirst({
      where: {
        specId: BigInt(specId ?? 0),
        partnerId: child.id,
        parentPartnerId: mdPartnerId ?? 0n,
      },
      orderBy: { id: 'desc' },
    });
    expect(childRfq, '하위 RFQ 생성').not.toBeNull();
    childRfqId = num(childRfq.id);
    createdRfqIds.push(childRfq.id);
    // MD↔하위 통화는 조직 기본이 아니라 **관계에 박제된 링크 통화**다.
    expect(childRfq.currency, 'MD↔하위 링크 통화').toBe('USD');
  });

  test('M3. 하위(협력2): USD 로 회신한다', async (ctx) => {
    if (childRfqId === null) return ctx.skip();
    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: 200,
      quotedDeliveryDate: '2026-08-22',
      memo: '[MD 루프] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);
  });

  test('M4. MD: 하위 선정 + 마진 → 상위 회신가가 서버에서 자동 산출된다', async (ctx) => {
    if (topRfqId === null || childRfqId === null) return ctx.skip();
    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);

    const prisma = getPrisma();
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    // 변환점 박제 — 어디서 온 값인지(원가·환율·마진)가 행에 남아야 나중에 추적이 된다.
    expect(top?.selectedChildRfqId, '선정 하위 박제').toBe(BigInt(childRfqId));
    expect(Number(top?.marginRate ?? 0), '마진%').toBe(MARGIN_RATE);
    expect(Number(top?.sourceAmount ?? 0), '원가(하위 회신가)').toBe(200);
    expect(top?.sourceCurrency, '원가 통화').toBe('USD');
    const rate = Number(top?.sourceRate ?? 0);
    expect(rate, '변환 환율(USD→KRW) 박제').toBeGreaterThan(0);
    // 상위 회신가 = 200 × 환율 × 1.15, KRW 반올림 — 서버 계산과 동형이어야 한다.
    expect(Number(top?.priceOriginal ?? 0), 'MD 회신가 자동 산출').toBe(
      Math.round(200 * rate * (1 + MARGIN_RATE / 100)),
    );
    expect(top?.status, '상위는 회신 완료 상태').toBe('quoted');
    console.log(
      `  [loop] 하위 USD 200 × ${String(rate)} × ${String(1 + MARGIN_RATE / 100)} = KRW ${String(Number(top?.priceOriginal))}`,
    );

    await mdView.page.goto(`${BASE_URL}/app/partner/pcb/rfqs/${String(topRfqId)}`);
    await mdView.page.waitForLoadState('networkidle').catch(() => undefined);
    await snap(mdView.page, 'md-loop/M04-md-selected-margin');
  });

  test('M5. 관리자: MD 회신이 워크큐에 올라온다 — 선정 없이 정리(다음 시나리오 몫)', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    const rfqs = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/rfqs`);
    expect(rfqs.status, JSON.stringify(rfqs.json)).toBe(200);
    const top = (rfqs.json?.data?.rfqs ?? []).find((r: any) => r.rfqId === topRfqId);
    expect(top?.status, '관리자 화면에서 회신 완료').toBe('quoted');
    expect(top?.priceOriginal, '관리자가 보는 MD 회신가').toBeGreaterThan(0);
    // 여기서 멈춘다 — 관리자 선정·확정가·주문·발주는 다음 시나리오(주문 연결)에서.
  });
});
