// PCB Case QR — 합배송 박스의 PO별 라벨, 재인쇄 불변성, 권한·개인정보 경계,
// 박스 제외 무효화, 선적 입고 동기화를 API+DB로 함께 검증한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  cleanupPcbPos,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  num,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

describe.skipIf(!RUN)('PCB Case QR — 합배송 PO별 라벨·추적 원장', () => {
  let sender: PartnerFixture;
  let other: PartnerFixture;
  let P = '';
  let O = '';
  let A = '';
  let po1: any;
  let po2: any;
  let shipmentId = 0;
  const createdPoIds: bigint[] = [];

  const labels = (token: string, method: 'GET' | 'POST' = 'GET') =>
    api(token, method, `/api/partner/pcb-shipments/${String(shipmentId)}/labels` + (method === 'POST' ? '/print' : ''));

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`);
    if (!health.ok) throw new Error('API가 실행 중이 아닙니다 — pnpm dev:api');

    sender = await getPartner('협력2');
    other = await getPartner('협력1');
    if (sender.mbId === null || other.mbId === null || sender.country === null) {
      throw new Error('협력1·협력2 연결 계정과 협력2 국가가 필요합니다');
    }
    P = signJwt({ mbId: sender.mbId });
    O = signJwt({ mbId: other.mbId });
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });

    // 테스트 전용 쓰기 조직. 다른 실행 잔재가 있으면 오인 합배송을 피하려고 중단한다.
    const existing = await getPrisma().spPcbPo.count({ where: { partnerId: sender.id } });
    if (existing > 0) {
      throw new Error(`협력2에 기존 PCB PO ${String(existing)}건 — 잔재 확인 후 재실행하세요`);
    }

    const [spec1, spec2] = await pickFreeSpecs(2);
    po1 = await createPcbPo({
      specId: spec1.id,
      partnerId: sender.id,
      destinationCountry: sender.country,
    });
    createdPoIds.push(po1.id);
    po2 = await createPcbPo({
      specId: spec2.id,
      partnerId: sender.id,
      destinationCountry: sender.country,
    });
    createdPoIds.push(po2.id);

    const first = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po1.id) });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const second = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po2.id) });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    const box = second.json?.data?.boxes?.find((entry: any) =>
      entry.poIds?.includes(num(po1.id)),
    );
    expect(box?.poIds).toEqual(expect.arrayContaining([num(po1.id), num(po2.id)]));
    shipmentId = Number(box.shipmentId);
  }, 120_000);

  afterAll(async () => {
    if (createdPoIds.length > 0) {
      await getPrisma().spPcbPackage.deleteMany({ where: { poId: { in: createdPoIds } } });
      await cleanupPcbPos(createdPoIds);
      const [pos, memberships, packages] = await Promise.all([
        getPrisma().spPcbPo.count({ where: { id: { in: createdPoIds } } }),
        getPrisma().spPcbShipmentPo.count({ where: { poId: { in: createdPoIds } } }),
        getPrisma().spPcbPackage.count({ where: { poId: { in: createdPoIds } } }),
      ]);
      expect({ pos, memberships, packages }, 'PCB QR 시드 잔재').toEqual({
        pos: 0,
        memberships: 0,
        packages: 0,
      });
    }
    await disconnectPrisma();
  }, 120_000);

  test('1. 한 합배송 박스의 PO 2건에 QR 2개를 자동 발급하고 파트너 응답에서 고객·가격을 숨긴다', async () => {
    const response = await labels(P);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    expect(response.json.data.totalLabels).toBe(2);
    expect(response.json.data.packages.map((pkg: any) => pkg.poId)).toEqual(
      expect.arrayContaining([num(po1.id), num(po2.id)]),
    );
    const tokens = response.json.data.packages.map((pkg: any) => pkg.token);
    expect(new Set(tokens).size).toBe(2);
    expect(tokens.every((token: string) => /^[a-f0-9]{64}$/.test(token))).toBe(true);

    const serialized = JSON.stringify(response.json.data);
    expect(serialized).not.toContain('customerName');
    expect(serialized).not.toContain('mbId');
    expect(serialized).not.toContain('priceOriginal');

    const rows = await getPrisma().spPcbPackage.findMany({
      where: { shipmentId: BigInt(shipmentId) },
      include: { events: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row: any) => row.events.some((event: any) => event.eventType === 'created'))).toBe(true);
  });

  test('2. 다른 협력사·무인증은 라벨을 못 보고 관리자는 파트너 안전 목록을 볼 수 있다', async () => {
    const denied = await labels(O);
    expect(denied.status).toBe(404);
    const anonymous = await api(
      null,
      'GET',
      `/api/partner/pcb-shipments/${String(shipmentId)}/labels`,
    );
    expect(anonymous.status).toBeGreaterThanOrEqual(400);

    const admin = await api(
      A,
      'GET',
      `/api/admin/pcb-shipments/${String(shipmentId)}/labels`,
    );
    expect(admin.status, JSON.stringify(admin.json)).toBe(200);
    expect(admin.json.data.totalLabels).toBe(2);
    expect(JSON.stringify(admin.json.data)).not.toContain('customerName');
  });

  test('3. 재인쇄해도 token은 유지되고 인쇄 이벤트만 매회 누적된다', async () => {
    const before = await labels(P);
    const beforeTokens = new Map(
      before.json.data.packages.map((pkg: any) => [pkg.poId, pkg.token]),
    );
    const first = await labels(P, 'POST');
    const second = await labels(P, 'POST');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    for (const pkg of second.json.data.packages) {
      expect(pkg.token).toBe(beforeTokens.get(pkg.poId));
      expect(pkg.printedAt).not.toBeNull();
      expect(pkg.events.filter((event: any) => event.eventType === 'printed')).toHaveLength(2);
    }

    const scan = await api(
      A,
      'GET',
      `/api/admin/pcb-packages/${String(second.json.data.packages[0].token)}`,
    );
    expect(scan.status, JSON.stringify(scan.json)).toBe(200);
    expect(scan.json.data).toHaveProperty('customerName');
    expect(scan.json.data.shipment.shipmentId).toBe(shipmentId);
  });

  test('4. 박스 제외 시 QR을 무효화하고 재합류 시 같은 물리 건 token을 복구한다', async () => {
    const current = await labels(P);
    const target = current.json.data.packages.find((pkg: any) => pkg.poId === num(po2.id));
    expect(target).toBeTruthy();

    const detached = await api(
      P,
      'DELETE',
      `/api/partner/pcb-pos/${String(po2.id)}/shipment/membership`,
      {},
    );
    expect(detached.status, JSON.stringify(detached.json)).toBe(200);
    const voided = await api(A, 'GET', `/api/admin/pcb-packages/${String(target.token)}`);
    expect(voided.status).toBe(200);
    expect(voided.json.data.status).toBe('voided');
    expect(voided.json.data.events.at(-1)?.eventType).toBe('voided');

    const one = await labels(P);
    expect(one.json.data.totalLabels).toBe(1);
    const rejoined = await api(P, 'POST', '/api/partner/pcb-shipments/box', {
      poId: num(po2.id),
    });
    expect(rejoined.status).toBe(200);
    const two = await labels(P);
    const restored = two.json.data.packages.find((pkg: any) => pkg.poId === num(po2.id));
    expect(restored.token).toBe(target.token);
    expect(restored.status).toBe('prepared');
    expect(restored.events.filter((event: any) => event.eventType === 'created')).toHaveLength(2);
  });

  test('5. 선적 입고 확인이 현재 QR 전부를 received로 바꾸고 이력을 남긴다', async () => {
    const shipped = await api(
      P,
      'POST',
      `/api/partner/pcb-pos/${String(po1.id)}/shipment/advance`,
      { carrier: 'E2E Carrier', trackingNumber: 'PCB-QR-E2E' },
    );
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    expect(shipped.json.data.shipment.status).toBe('shipping');

    const received = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(po1.specId)}/pos/${String(po1.id)}/shipment/receive`,
      { note: 'PCB QR E2E 입고' },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);

    const after = await labels(P);
    expect(after.json.data.packages).toHaveLength(2);
    for (const pkg of after.json.data.packages) {
      expect(pkg.status).toBe('received');
      expect(pkg.receivedAt).not.toBeNull();
      expect(pkg.events.some((event: any) => event.eventType === 'received')).toBe(true);
      expect(pkg.events.every((event: any) => event.actorMbId === null)).toBe(true);
    }
  });
});
