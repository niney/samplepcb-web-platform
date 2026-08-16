// 운송수단(항공/해상) 축(08-16) — 국제 발송의 "무엇으로 나르는가". mode(국내/국제)와
// 직교하며, 이 값 하나에서 **운송서류가 갈린다**(항공 AWB / 해상 B/L).
//
// 표적:
//   ① 해상 선적 요청이 박제되고 응답에 실리는가(transport='sea')
//   ② 첨부 종류가 응답에서 **접히지 않는가** — 구 toFileView 는 사전에 없는 종류를
//      전부 'invoice' 로 접어, 성적서만 올린 발송이 화면에서 "인보이스 ✓"로 보이고
//      [선적 요청]이 열린 뒤 서버가 409 로 막았다. 기존 회귀는 DB 를 직접 읽어
//      이 결함을 못 봤다 — 여기서는 **API 응답**을 본다.
//   ③ 해상 Case ID 갈래의 게이트는 AWB 가 아니라 B/L 이다(MISSING_BL_FILE)
//   ④ 운송수단을 바꾸면 앞서 적어 둔 운송회사·운송장이 서버에서 함께 비워지는가
//      (항공사명 + 해상 B/L 번호 같은 모순 방지)
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run pcb-transport
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  cleanupPcbPos,
  countPcbResidue,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const PARTNER_NAME = 'tester2협력'; // CN — 국제 체인
const DOMESTIC_PARTNER = '협력1'; // KR·KRW — 국내 체인(T4 의 mode 게이트 확인용)

const uploadShipFile = async (
  token: string,
  path: string,
  fileType: string,
  name: string,
): Promise<number> => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // xlsx/zip 매직
  const form = new FormData();
  form.set('fileType', fileType);
  form.set('file', new File([bytes], name));
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
};

describe.skipIf(!RUN)('PCB 운송수단(항공/해상)', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  const poIds: bigint[] = [];
  let poC: bigint | null = null; // 해상 직접 발송
  let poD: bigint | null = null; // 해상 Case ID 갈래
  let specC: bigint | null = null;
  let specD: bigint | null = null;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    const specs = await pickFreeSpecs(2);
    for (const spec of specs) {
      const po = await createPcbPo({
        specId: spec.id,
        partnerId: partner.id,
        status: 'produced',
        currency: 'USD',
        priceOriginal: 100,
      });
      poIds.push(po.id);
    }
    poC = poIds[0] ?? null;
    poD = poIds[1] ?? null;
    specC = specs[0]?.id ?? null;
    specD = specs[1]?.id ?? null;
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    if (specC !== null || specD !== null) {
      await getPrisma().spMailLog.deleteMany({
        where: {
          kind: { in: ['pcb_ship_caseref', 'pcb_ship_caseref_req', 'pcb_shipment_turn'] },
          refType: 'pcb_spec',
          refId: { in: [String(specC), String(specD)] },
        },
      });
    }
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재가 남았습니다').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('T1. 해상 선적 요청 — 수단 박제 + 첨부 종류가 응답에서 안 접힌다', async (ctx) => {
    if (poC === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poC) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);

    const base = `/api/partner/pcb-pos/${String(poC)}/shipment/files`;
    expect(await uploadShipFile(P, base, 'invoice', 'inv-c.xlsx'), 'Invoice 첨부').toBe(200);
    // 08-15 신설 종류 — 구 매핑은 이걸 'invoice' 로 접었다(②의 표적).
    expect(await uploadShipFile(P, base, 'test_report', 'tr-c.pdf'), 'TEST Report 첨부').toBe(200);
    // 08-16 신설 종류 — 사전 확장이 업로드 화이트리스트까지 열렸는가.
    expect(await uploadShipFile(P, base, 'bill_of_lading', 'bl-c.pdf'), 'B/L 첨부').toBe(200);

    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poC)}/shipment/advance`, {
      shipDate: '2026-08-25',
      transport: 'sea',
      carrier: 'Maersk',
      trackingNumber: 'BL-SEA-C-0001',
    });
    expect(adv.status, `해상 선적 요청: ${JSON.stringify(adv.json)}`).toBe(200);
    const view = adv.json?.data?.shipment ?? null;
    expect(view?.transport, '운송수단 박제').toBe('sea');
    expect(view?.carrier, '같은 요청의 운송회사는 살아남는다(초기화가 새 값을 덮지 않는다)').toBe(
      'Maersk',
    );
    expect(view?.trackingNumber, '같은 요청의 운송장도').toBe('BL-SEA-C-0001');

    // ② 접힘 회귀 — 세 종류가 각자 이름으로 와야 한다. 하나라도 'invoice' 로 접히면
    //    화면의 "① 인보이스 ✓ 첨부됨"이 거짓이 되고 [선적 요청]이 헛되이 열린다.
    const kinds: string[] = (view?.files ?? []).map((f: any) => String(f.fileType)).sort();
    expect(kinds, '첨부 = B/L + Invoice + TEST Report').toEqual([
      'bill_of_lading',
      'invoice',
      'test_report',
    ]);
  }, 120_000);

  test('T2. 운송수단 전환 — 되돌린 뒤 항공으로 바꾸면 운송회사·운송장이 비워진다', async (ctx) => {
    if (poC === null) return ctx.skip();
    const revert = await api(P, 'POST', `/api/partner/pcb-pos/${String(poC)}/shipment/revert`, {});
    expect(revert.status, `되돌리기: ${JSON.stringify(revert.json)}`).toBe(200);

    // 해상에서 항공으로 — 선사명(Maersk)·B/L 번호는 남의 수단 것이 되므로 서버가 지운다.
    // 화면 watch 와 같은 정리를 서버도 한다(관리자 프롬프트·재시도가 화면을 안 거친다).
    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poC)}/shipment/advance`, {
      shipDate: '2026-08-25',
      transport: 'air',
    });
    expect(adv.status, `항공 재요청: ${JSON.stringify(adv.json)}`).toBe(200);
    const view = adv.json?.data?.shipment ?? null;
    expect(view?.transport, '항공으로 바뀐다').toBe('air');
    expect(view?.carrier ?? null, '해상 선사명은 지워진다').toBeNull();
    expect(view?.trackingNumber ?? null, 'B/L 번호도 지워진다').toBeNull();
  }, 120_000);

  test('T3. 해상 Case ID 갈래 — 게이트가 AWB 가 아니라 B/L 을 본다', async (ctx) => {
    if (poD === null || specD === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poD) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    expect(
      await uploadShipFile(P, `/api/partner/pcb-pos/${String(poD)}/shipment/files`, 'invoice', 'inv-d.xlsx'),
      'Invoice 첨부',
    ).toBe(200);

    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poD)}/shipment/advance`, {
      shipDate: '2026-08-26',
      transport: 'sea',
      caseRefRequested: true,
      caseRefNote: '해상 콘솔로 보내주세요',
    });
    expect(req.status, `해상+Case ID 요청: ${JSON.stringify(req.json)}`).toBe(200);
    expect(req.json?.data?.shipment?.transport, '해상 박제').toBe('sea');

    const adminBase = `/api/admin/pcb-projects/${String(specD)}/pos/${String(poD)}/shipment/advance`;
    const fileBase = `/api/admin/pcb-projects/${String(specD)}/pos/${String(poD)}/shipment/files`;

    // AWB 를 올려도 해상 발송은 안 열린다 — 종류가 다르면 없는 것과 같다.
    expect(await uploadShipFile(A, fileBase, 'airwaybill', 'awb-d.pdf'), '관리자 AWB 첨부').toBe(200);
    const wrongDoc = await api(A, 'POST', adminBase, {
      carrier: 'HMM',
      trackingNumber: 'BL-SEA-D-0001',
      caseRef: 'KR-SEA-2026-0816-D',
    });
    expect(wrongDoc.status, JSON.stringify(wrongDoc.json)).toBe(409);
    expect(wrongDoc.json?.error, '해상 게이트는 B/L 을 요구한다').toBe('MISSING_BL_FILE');

    // B/L 을 올리면 열린다.
    expect(await uploadShipFile(A, fileBase, 'bill_of_lading', 'bl-d.pdf'), '관리자 B/L 첨부').toBe(200);
    const shipped = await api(A, 'POST', adminBase, {
      carrier: 'HMM',
      trackingNumber: 'BL-SEA-D-0001',
      caseRef: 'KR-SEA-2026-0816-D',
    });
    expect(shipped.status, `선적: ${JSON.stringify(shipped.json)}`).toBe(200);

    // 패널 응답은 발주(pos)와 선적(shipments)을 **나란히** 싣는다(AdminPcbPoListResponse)
    // — 선적은 발주 안에 중첩돼 있지 않다(묶음이 발주 여러 건을 가리키므로).
    const detail = await api(A, 'GET', `/api/admin/pcb-projects/${String(specD)}/pos`);
    const shipments: any[] = detail.json?.data?.shipments ?? [];
    const mine = shipments.find((s: any) => (s.poIds ?? []).includes(Number(poD)));
    expect(mine?.status, '실선적 진입').toBe('shipped');
    expect(mine?.transport, '수단은 그대로').toBe('sea');
    expect(mine?.carrier, '선사명 박제').toBe('HMM');
  }, 180_000);

  test('T4. 국내 체인 — 운송수단은 국제 전용이라 박히지 않는다', async (ctx) => {
    // 국내는 택배 체인(preparing→shipping→delivered)이라 해상/항공이 없다. 계약은
    // 필드를 막지 않으므로(같은 body 를 두 모드가 공유) **서버의 mode 게이트**가
    // 유일한 방어다 — 여기가 뚫리면 국내 발송에 'sea' 가 박혀 화면 라벨이 흔들린다.
    const kr = await getPartner(DOMESTIC_PARTNER);
    if (kr.mbId === null) return ctx.skip();
    expect(kr.country, `${DOMESTIC_PARTNER} 국가(국내 경로 전제)`).toBe('KR');
    const [spec] = await pickFreeSpecs(1);
    if (spec === undefined) return ctx.skip();
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: kr.id,
      status: 'produced',
      currency: 'KRW',
      priceOriginal: 100000,
    });
    poIds.push(po.id);
    const K = signJwt({ mbId: kr.mbId, ttlSec: 3600 });

    const box = await api(K, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(po.id) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    const adv = await api(K, 'POST', `/api/partner/pcb-pos/${String(po.id)}/shipment/advance`, {
      transport: 'sea',
      carrier: 'CJ대한통운',
      trackingNumber: 'KR-DOM-0001',
    });
    expect(adv.status, `국내 배송 중: ${JSON.stringify(adv.json)}`).toBe(200);
    const view = adv.json?.data?.shipment ?? null;
    expect(view?.mode, '국내 체인').toBe('domestic');
    expect(view?.transport ?? null, '국내엔 운송수단이 없다 — 서버가 버린다').toBeNull();
    expect(view?.carrier, '택배사는 그대로 저장된다').toBe('CJ대한통운');
  }, 120_000);
});
