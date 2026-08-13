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
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  newSession,
  num,
  signJwt,
  snap,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

// 계정은 e2e 전용(e2e-*)만 쓴다 — 실계정(mdtester)에 조직을 직삽입으로 덧연결하면
// 1계정=1조직 가드를 우회해 사용자 무대를 오염시킨다(2026-08-13 복구 DB 실측).
const MD_MB_ID = 'e2e-mdtester';
const MD_ORG_NAME = '마스터딜러상사';
const CHILD_NAME = '협력2'; // CN·USD — "국내 중개상이 해외 제조사에 재위탁" 구도
const CHILD_MB_ID = 'e2e-mdsub2';
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
    // ── 무대 자기창조(idempotent) — 계정·조직·연결·관계 전부 e2e 전용으로 확보한다.
    // DB 복구로 픽스처가 사라져도 다시 세우고, 실계정 소속은 절대 건드리지 않는다.
    const mdOrg = await ensureStagePartner({
      mbId: MD_MB_ID,
      orgName: MD_ORG_NAME,
      country: 'KR',
      currency: 'KRW',
    });
    child = await ensureStagePartner({
      mbId: CHILD_MB_ID,
      orgName: CHILD_NAME,
      country: 'CN',
      currency: 'USD',
    });
    await ensureMdRelation(mdOrg, child, 'USD');
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    mdPartnerId = mdOrg.id;
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

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
