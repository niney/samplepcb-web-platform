// 발송 참조번호(Case ID) 갈래(08-13 재편) — 체크(협력사, 선적 요청 동반) → 서류 처리
// (관리자: Case ID·운송장·AWB) → 협력사는 서류 확인 후 라벨링·인계.
//
// 표적:
//   ① 미체크 갈래는 현행 그대로다(협력사 선적 요청 → 관리자 선적) + 원산지증명원 업로드
//   ② 체크가 '선적 요청' 전이에 실려 박제되고 관리자 워크큐가 caseRefPending 으로 신호하는가
//   ③ 게이트 — 관리자 '선적'은 Case ID 없이 409, Case ID 있어도 AWB 없이 409,
//      협력사 '선적' 시도는 NOT_YOUR_TURN(주체는 §6.5 그대로 관리자)
//   ④ 관리자가 AWB 첨부 + Case ID·운송장 한 번에 입력 → 선적 완주, 값 박제,
//      발송 후 재요청은 CASE_REF_LOCKED
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run pcb-caseref
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

describe.skipIf(!RUN)('PCB 발송 참조번호(Case ID) 갈래', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  const poIds: bigint[] = [];
  let poA: bigint | null = null; // 미체크 갈래
  let poB: bigint | null = null; // 체크 갈래
  let specA: bigint | null = null;
  let specB: bigint | null = null;

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
    poA = poIds[0] ?? null;
    poB = poIds[1] ?? null;
    specA = specs[0]?.id ?? null;
    specB = specs[1]?.id ?? null;
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    if (specB !== null) {
      await getPrisma().spMailLog.deleteMany({
        where: {
          kind: { in: ['pcb_ship_caseref', 'pcb_ship_caseref_req', 'pcb_shipment_turn'] },
          refType: 'pcb_spec',
          refId: { in: [String(specA), String(specB)] },
        },
      });
    }
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재가 남았습니다').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('C1. 미체크 갈래 — 현행 그대로(협력사 요청 → 관리자 선적) + 원산지증명원', async (ctx) => {
    if (poA === null || specA === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poA) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);

    expect(
      await uploadShipFile(P, `/api/partner/pcb-pos/${String(poA)}/shipment/files`, 'invoice', 'inv-a.xlsx'),
      'Invoice 첨부',
    ).toBe(200);
    // 원산지증명원(옵션·국제 공통 — 08-13 결정 ③) — 새 파일 종류가 열려 있어야 한다.
    expect(
      await uploadShipFile(P, `/api/partner/pcb-pos/${String(poA)}/shipment/files`, 'origin_cert', 'co-a.pdf'),
      '원산지증명원 첨부',
    ).toBe(200);

    const reqAdv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poA)}/shipment/advance`, {
      shipDate: '2026-08-25',
    });
    expect(reqAdv.status, `선적 요청: ${JSON.stringify(reqAdv.json)}`).toBe(200);
    expect(reqAdv.json?.data?.shipment?.caseRefRequestedAt ?? null, '미체크 — 요청 없음').toBeNull();
    const files: any[] = reqAdv.json?.data?.shipment?.files ?? [];
    expect(files.some((f: any) => f.fileType === 'origin_cert'), 'C/O 가 파일 목록에').toBe(true);

    // 관리자 '선적' — 현행 그대로 트래킹만으로 통과(게이트 없음).
    const shipped = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specA)}/pos/${String(poA)}/shipment/advance`,
      { carrier: 'DHL', trackingNumber: 'CASEREF-PLAIN-1' },
    );
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
  }, 180_000);

  test('C2. 체크 갈래 — 선적 요청에 실려 박제 + 워크큐 신호', async (ctx) => {
    if (poB === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poB) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    expect(
      await uploadShipFile(P, `/api/partner/pcb-pos/${String(poB)}/shipment/files`, 'invoice', 'inv-b.xlsx'),
      'Invoice 첨부',
    ).toBe(200);

    const reqAdv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poB)}/shipment/advance`, {
      shipDate: '2026-08-26',
      caseRefRequested: true,
      caseRefNote: 'DHL 착불 계정번호가 필요합니다',
    });
    expect(reqAdv.status, `선적 요청+체크: ${JSON.stringify(reqAdv.json)}`).toBe(200);
    const view = reqAdv.json?.data?.shipment ?? null;
    expect(view?.caseRefRequestedAt, '체크 박제').not.toBeNull();
    expect(view?.caseRef ?? null, '값은 아직 없다').toBeNull();

    const q = await api(A, 'GET', '/api/admin/pcb-shipments?tab=pending&pageSize=50');
    const rows: any[] = q.json?.data?.items ?? [];
    const mine = rows.find((r: any) => Number(r.poId) === Number(poB));
    expect(mine?.caseRefPending, '큐 배지 신호').toBe(true);
    expect(mine?.adminTurn, '내 차례 합산').toBe(true);
  }, 120_000);

  test('C3. 게이트 — Case ID 없이 409 · AWB 없이 409 · 협력사는 차례 아님', async (ctx) => {
    if (poB === null || specB === null) return ctx.skip();
    const base = `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}/shipment/advance`;

    const noRef = await api(A, 'POST', base, { carrier: 'DHL', trackingNumber: 'CASEREF-GATE-B' });
    expect(noRef.status, JSON.stringify(noRef.json)).toBe(409);
    expect(noRef.json?.error).toBe('CASE_REF_REQUIRED');

    const noAwb = await api(A, 'POST', base, {
      carrier: 'DHL',
      trackingNumber: 'CASEREF-GATE-B',
      caseRef: 'KR-IMP-2026-0813-B',
    });
    expect(noAwb.status, JSON.stringify(noAwb.json)).toBe(409);
    expect(noAwb.json?.error).toBe('MISSING_AWB_FILE');

    // 주체는 §6.5 그대로 — 두 갈래 모두 '선적'은 관리자 몫(협력사 운송장 입력 회수).
    const partnerTry = await api(P, 'POST', `/api/partner/pcb-pos/${String(poB)}/shipment/advance`, {
      carrier: 'DHL',
      trackingNumber: 'CASEREF-GATE-B',
    });
    expect(partnerTry.status).toBe(409);
    expect(partnerTry.json?.error).toBe('NOT_YOUR_TURN');
  }, 120_000);

  test('C4. 관리자 서류 처리 — AWB 첨부 + Case ID·운송장 한 번에 → 선적 완주', async (ctx) => {
    if (poB === null || specB === null) return ctx.skip();
    expect(
      await uploadShipFile(
        A,
        `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}/shipment/files`,
        'airwaybill',
        'awb-b.pdf',
      ),
      '관리자 AWB 첨부',
    ).toBe(200);

    const shipped = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}/shipment/advance`,
      { carrier: 'DHL', trackingNumber: 'CASEREF-DONE-B', caseRef: 'KR-IMP-2026-0813-B' },
    );
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    const ships: any[] = shipped.json?.data?.shipments ?? [];
    const mine = ships.find((s: any) => (s.poIds ?? []).includes(Number(poB)));
    expect(String(mine?.status), '선적 진입').toBe('shipped');
    expect(mine?.caseRef, '값 박제').toBe('KR-IMP-2026-0813-B');
    expect(mine?.caseRefFilledAt, '입력 시각').not.toBeNull();

    // 큐 신호 해제 — 값이 박혔으니 pending 이 아니다.
    const q = await api(A, 'GET', '/api/admin/pcb-shipments?tab=all&pageSize=50');
    const row = (q.json?.data?.items ?? []).find((r: any) => Number(r.poId) === Number(poB));
    expect(row?.caseRefPending, '배지 해제').toBe(false);

    // 발송이 시작됐으니 재요청은 잠긴다(사후 요청 라우트의 위계 확인).
    const late = await api(P, 'POST', `/api/partner/pcb-pos/${String(poB)}/shipment/case-ref-request`, {});
    expect(late.status).toBe(409);
    expect(late.json?.error).toBe('CASE_REF_LOCKED');
  }, 120_000);
});
