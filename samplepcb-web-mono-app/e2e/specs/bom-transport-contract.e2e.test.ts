// BOM 선적 운송수단 축(08-16) — 계약·서버 정합의 read-only 확인.
//
// BOM 여정 e2e 는 nginx·web·parts-engine·고객 계정까지 요구하는 실주행이라 축 하나를
// 확인하려고 돌리기엔 무겁다. 여기서는 **이미 있는 실데이터** 위에서 두 가지만 본다:
//   ① 선적 워크큐 응답이 계약(BomShipmentView.transport)을 만족하는가 — Fastify 가
//      응답을 zod 로 직렬화하므로, 서버 매핑에 필드가 빠지면 이 GET 이 500 이 된다.
//      즉 200 자체가 "계약과 서버가 같은 모양"이라는 증거다.
//   ② 첨부 사전 확장(bill_of_lading)이 응답 파싱을 깨지 않는가 — 구 판정은 종류를
//      손으로 나열해 새 종류를 통째로 떨어뜨렸다(PCB 는 'invoice' 로 접기까지 했다).
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run bom-transport-contract
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, test } from 'vitest';
import { API_URL, RUN, api, disconnectPrisma, signJwt } from '../helpers';

describe.skipIf(!RUN)('BOM 선적 운송수단 — 계약·서버 정합(read-only)', () => {
  let A = '';

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
  }, 60_000);

  test('B1. 선적 워크큐 — 세 탭 모두 계약대로 직렬화된다(transport 포함)', async () => {
    // 모수가 0 이면 아래 루프가 한 번도 안 돌아 어서션이 공허해진다(여정 29호의 사촌).
    // 실제로 몇 건을 봤는지 세어 마지막에 검사한다.
    let seen = 0;
    for (const tab of ['admin_pending', 'active', 'received'] as const) {
      const res = await api(A, 'GET', `/api/admin/bom-shipments?tab=${tab}&page=1&pageSize=20`);
      expect(res.status, `${tab}: ${JSON.stringify(res.json).slice(0, 300)}`).toBe(200);
      const items: any[] = res.json?.data?.items ?? [];
      seen += items.length;
      for (const item of items) {
        // 필드 자체가 있어야 한다 — 없는 필드를 읽으면 기본값이 조용히 통과한다(여정 29호).
        expect(Object.hasOwn(item, 'transport'), `SH-${String(item.shipmentId)} 에 transport 키`).toBe(
          true,
        );
        expect(
          item.transport === null || item.transport === 'air' || item.transport === 'sea',
          `SH-${String(item.shipmentId)} transport=${String(item.transport)} 는 사전 값이거나 null`,
        ).toBe(true);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[bom-transport] 선적 ${String(seen)}건 검사`);
    expect(seen, '검사한 선적이 0건이면 이 테스트는 아무것도 증명하지 않는다').toBeGreaterThan(0);
  }, 120_000);

  test('B2. 첨부 종류 — 응답의 fileType 은 확장된 사전 안에 있다', async () => {
    const res = await api(A, 'GET', '/api/admin/bom-shipments?tab=active&page=1&pageSize=50');
    expect(res.status).toBe(200);
    const items: any[] = res.json?.data?.items ?? [];
    const kinds = new Set<string>();
    for (const item of items) for (const f of item.files ?? []) kinds.add(String(f.fileType));
    for (const kind of kinds) {
      expect(['invoice', 'airwaybill', 'bill_of_lading'], `알 수 없는 첨부 종류: ${kind}`).toContain(
        kind,
      );
    }
    // 구 데이터가 없어 집합이 비어도 B1 이 직렬화를 이미 확인한다 — 여기선 오염만 본다.
    expect(kinds.has('invoice') || kinds.size === 0, '기존 인보이스 첨부는 그대로 보인다').toBe(true);
  }, 120_000);

  test('B3. 정리 — prisma 연결 해제', async () => {
    await disconnectPrisma();
    expect(true).toBe(true);
  }, 30_000);
});
