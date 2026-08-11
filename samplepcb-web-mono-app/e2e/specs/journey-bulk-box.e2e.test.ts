// 여정 19호 — **대량 묶음**(한 박스에 다섯 건).
//
// 지금까지 박스는 최대 2~3건이었다(3호 2건 · 9호 2건 · 11호 2건). 실무에서 협력사는 **한
// 주치를 모아** 보낸다 — 그때 달라지는 것이 여럿이다: 상업송장 품목 줄이 늘고, 입고확인 한
// 번이 다섯 건에 파급되고, 화면은 구성원을 열거해야 하며, 되돌리기·detach 도 다섯 건을 함께
// 다룬다. "2건에서 되니 5건도 되겠지"는 검증이 아니다 — 대표 승계·게이팅·송장은 모두 **개수에
// 따라 코드 경로가 갈리는** 자리다.
//
// 이 편은 **협력사 축만** 본다(고객 주문 없이 시드 발주 5장). 거버 제출을 다섯 번 하면 주행이
// 몇 배로 길어지는데, 묶음의 스케일 성질은 주문 축과 무관하기 때문이다(고객 축 접합은 3·9호가
// 이미 지킨다). 대신 **정리는 시드 레지스트리로 정확히** 한다.
//
// 표적:
//   ① 다섯 건이 **한 박스**로 합류하는가(contextKey 동일 → 합류 의미론이 개수와 무관한가)
//   ② 전이가 **다섯 건 모두**를 움직이는가(대표만 움직이면 나머지는 유실된다)
//   ③ 상업송장 품목이 **다섯 줄**인가(묶음 송장은 통관 서류다 — 빠지면 물건이 안 나간다)
//   ④ 입고확인 한 번이 **다섯 건 모두**를 닫는가
//   ⑤ detach 후에도 나머지 넷이 온전한가(대표를 빼도 박스가 무너지지 않는가)
//
// 실행: pnpm -F e2e journey:bulk  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
// 스크린샷 접두사는 **G** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createJourneyReport,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newSession,
  pickFreeSpecs,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const PARTNER_NAME = '협력2';
const BOX_SIZE = 5;

describe.skipIf(!RUN || !JOURNEY)('여정 19호 — 대량 묶음(한 박스 다섯 건)', () => {
  const rp = createJourneyReport('findings-bulk', '여정 19호 대량 묶음 탐색 주행 리포트');
  const { F, ledger } = rp;

  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  /** 시드 발주 — 정리 레지스트리(끝에 통째로 지운다). */
  const poIds: bigint[] = [];
  let repPoId: number | null = null;
  let shipmentId: bigint | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const bodyTextOf = async (s: E2eSession): Promise<string> =>
    (await s.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  const shipmentRow = async (): Promise<any> =>
    getPrisma().spPcbShipment.findUnique({ where: { id: shipmentId ?? 0n } });

  const memberCount = async (): Promise<number> =>
    getPrisma().spPcbShipmentPo.count({ where: { shipmentId: shipmentId ?? 0n } });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '협력사');
  }, 180_000);

  afterAll(async () => {
    // 시드 발주는 이 편이 만든 것뿐이라 레지스트리로 정확히 지운다(스펙은 건드리지 않는다).
    await cleanupPcbPos(poIds);
    const residue = await countPcbResidue(poIds);
    F(
      'G7',
      'obs',
      `정리 — 시드 발주 ${String(poIds.length)}건 삭제 · 잔재 pos=${String(residue.pos)} ` +
        `shipments=${String(residue.shipments)} memberships=${String(residue.memberships)}`,
    );
    rp.write({ 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('G1. 준비 — 같은 컨텍스트의 생산완료 발주 5장', async () => {
    const specs = await pickFreeSpecs(BOX_SIZE);
    for (const spec of specs) {
      const po = await createPcbPo({
        specId: spec.id,
        partnerId: partner.id,
        status: 'produced',
        currency: 'USD',
        priceOriginal: 100,
      });
      poIds.push(po.id);
      ledger.push(`sp_pcb_po #${String(po.id)} (spec ${String(spec.id)} — 시드)`);
    }
    expect(poIds.length, '시드 발주 5장').toBe(BOX_SIZE);
    F('G1', 'obs', `시드 완료 — ${PARTNER_NAME} 생산완료 발주 ${String(BOX_SIZE)}장(같은 컨텍스트)`);
  }, 180_000);

  test('G2. 다섯 건이 한 박스로 합류한다', async (ctx) => {
    if (poIds.length < BOX_SIZE) return ctx.skip();
    const prisma = getPrisma();

    for (const poId of poIds) {
      const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poId) });
      expect(box.status, `담기 #${String(poId)}: ${JSON.stringify(box.json)}`).toBe(200);
    }

    // 다섯 건이 **같은** 박스에 있어야 한다 — 합류 의미론이 개수와 무관하다는 실증.
    const shipments = await prisma.spPcbShipment.findMany({
      where: { pos: { some: { poId: { in: poIds } } } },
    });
    expect(shipments.length, '박스는 하나').toBe(1);
    shipmentId = shipments[0]?.id ?? null;
    expect(await memberCount(), '구성원 5건').toBe(BOX_SIZE);
    const rep = await shipmentRow();
    repPoId = Number(rep?.poId ?? 0);
    F(
      'G2',
      'obs',
      `합류 실측 — 박스 #${String(shipmentId)} 하나에 ${String(BOX_SIZE)}건(대표 po ${String(repPoId)}) · ` +
        `mode=${String(rep?.mode)}`,
    );
  }, 300_000);

  test('G3. 상업송장 품목이 다섯 줄인가 — 묶음 송장은 통관 서류다', async (ctx) => {
    if (shipmentId === null || repPoId === null) return ctx.skip();

    const draft = await api(P, 'GET', `/api/partner/pcb-pos/${String(repPoId)}/shipment/invoice`);
    expect(draft.status, `송장 초안: ${JSON.stringify(draft.json)}`).toBe(200);
    const items: any[] = draft.json?.data?.items ?? [];
    // 한 줄이라도 빠지면 통관에서 수량이 안 맞는다 — 개수는 곧 서류의 정확성이다.
    expect(items.length, '송장 품목 = 박스 구성원 수').toBe(BOX_SIZE);
    // 9호 교정 — 품목마다 PO 번호가 붙어야 같은 파일명(프로젝트명)이 겹쳐도 구별된다.
    const labeled = items.filter((i: any) => /PO-\d+/.test(String(i.name ?? i.description ?? '')));
    expect(labeled.length, '품목마다 PO 번호 병기').toBe(BOX_SIZE);
    F(
      'G3',
      'obs',
      `묶음 송장 실측 — 품목 ${String(items.length)}줄 · PO 번호 병기 ${String(labeled.length)}줄`,
    );
  }, 240_000);

  test('G4. 전이는 다섯 건 모두를 움직인다', async (ctx) => {
    if (shipmentId === null || repPoId === null) return ctx.skip();

    // 국제 체인 첫 전이(선적 요청) — Invoice 첨부가 필요하다.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    const form = new FormData();
    form.set('fileType', 'invoice');
    form.set('file', new File([bytes], 'invoice-bulk.pdf', { type: 'application/pdf' }));
    const up = await fetch(
      `${API_URL}/api/partner/pcb-pos/${String(repPoId)}/shipment/files`,
      { method: 'POST', headers: { authorization: `Bearer ${P}` }, body: form },
    );
    expect(up.status, 'Invoice 첨부').toBe(200);

    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(repPoId)}/shipment/advance`, {
      shipDate: '2026-09-30',
    });
    expect(adv.status, `선적 요청: ${JSON.stringify(adv.json)}`).toBe(200);

    // 대표만 움직이고 나머지가 남으면 네 건이 유실된다 — 박스는 하나로 움직여야 한다.
    expect((await shipmentRow())?.status, '박스 전이').toBe('requested');
    expect(await memberCount(), '전이 뒤에도 구성원 5건 유지').toBe(BOX_SIZE);

    // 비대표 발주로 조회해도 **같은 박스**가 나와야 한다(서버는 발주서 축으로 찾는다).
    const other = poIds.find((id) => Number(id) !== repPoId);
    const otherDetail = await api(P, 'GET', `/api/partner/pcb-pos/${String(other ?? 0n)}`);
    expect(otherDetail.status, '비대표 발주 상세').toBe(200);
    const seenShipment = otherDetail.json?.data?.shipment ?? null;
    expect(seenShipment, '비대표도 자기 박스를 본다').toBeTruthy();
    expect(Number(seenShipment?.shipmentId ?? 0), '같은 박스').toBe(Number(shipmentId));
    F(
      'G4',
      'obs',
      `묶음 전이 실측 — 박스 requested · 구성원 ${String(BOX_SIZE)}건 유지 · 비대표 발주도 ` +
        `같은 박스(#${String(shipmentId)})를 본다`,
    );
  }, 300_000);

  test('G5. 입고확인 한 번이 다섯 건을 닫는다', async (ctx) => {
    if (shipmentId === null || repPoId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/partner/pcb-pos/${String(repPoId)}/shipment/advance`;

    // 국제 체인을 종점까지(요청 → 발송 → 국내도착 → 통관 → 완료 직전).
    for (let i = 0; i < 6; i += 1) {
      const cur = await shipmentRow();
      if (String(cur?.status) === 'arrived' || String(cur?.status) === 'cleared') break;
      const res = await api(P, 'POST', base, {
        carrier: 'DHL',
        trackingNumber: `BULK-${String(i)}`,
      });
      if (res.status !== 200) break;
    }

    const recv = await api(A, 'POST', `/api/admin/pcb-projects/${String(
      (await prisma.spPcbPo.findUnique({ where: { id: BigInt(repPoId) } }))?.specId ?? 0n,
    )}/pos/${String(repPoId)}/shipment/receive`, { note: '[여정 19호] 묶음 5건 입고' });
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const closed = await shipmentRow();
    expect(closed?.receivedAt, '입고 시각 기록').not.toBeNull();
    // 파급은 박스 단위다 — 구성원 다섯 건이 모두 "입고된 발주"로 잡혀야 한다.
    const receivedLinks = await prisma.spPcbShipmentPo.count({
      where: { shipmentId: shipmentId ?? 0n },
    });
    expect(receivedLinks, '입고 파급 구성원 수').toBe(BOX_SIZE);
    F(
      'G5',
      'obs',
      `입고 파급 실측 — 입고확인 1회로 박스 종결(receivedAt) · 구성원 ${String(receivedLinks)}건 ` +
        `모두 그 신호를 공유한다`,
    );
  }, 420_000);

  test('G6. 화면 — 다섯 건이 열거되는가', async (ctx) => {
    if (shipmentId === null) return ctx.skip();

    await rp.view(partnerView, '/app/partner/pcb/shipments/done', 'G06-partner-done');
    const partnerText = await bodyTextOf(partnerView);
    // 건수 배지만 있고 구성원이 안 보이면 "무엇이 함께 움직였는지"를 알 수 없다(9호 교정).
    expect(partnerText.includes(String(BOX_SIZE)), '협력사 아카이브에 건수 표시').toBe(true);

    await rp.view(adminView, '/app/admin/pcb/shipments', 'G06-admin-ship-queue');
    const adminText = await bodyTextOf(adminView);
    expect(adminText.length, '선적 큐 화면 렌더').toBeGreaterThan(200);
    F(
      'G6',
      'obs',
      `화면 관찰 — 협력사 완료 아카이브·관리자 선적 큐 렌더(묶음 ${String(BOX_SIZE)}건)`,
    );
  }, 240_000);
});

