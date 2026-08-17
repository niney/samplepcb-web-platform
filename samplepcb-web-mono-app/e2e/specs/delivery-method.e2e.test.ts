// 배송방법(택배/퀵착불/방문수령/직배송) P1 회귀 — docs/DELIVERY_METHOD.md.
// 지키는 것: ① 비택배는 송장 없이 정상 배송 전이(정식 경로 — force-status 우회 제거의 근거)
// ② 그때 서버가 od_delivery_method + od_delivery_company 한글 라벨 병용·od_invoice='' 를 기록
// ③ 택배는 여전히 3필드 필수(행 미비=MISSING_INVOICE skip · 계약 refine=400)
// ④ force-status 배송도 같은 병용 규칙 ⑤ 읽기 계약(deliveryMethod)이 상세에 실린다.
// 픽스처는 e2e 소유 주문(9-접두 od_id)만 쓰고, 정리는 재고 앵커 관례(여정 26호)대로
// force-status '주문' 복원 → deleteOrderHard. 브라우저·메일 무접촉(API+DB 실측만).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  createG5OrderFixture,
  deleteOrderHard,
  disconnectPrisma,
  getPrisma,
  signJwt,
  type G5OrderFixture,
} from '../helpers';

const INVOICE_TIME = '2026-08-17 12:00:00';

async function setProdDone(odId: string): Promise<void> {
  // e2e 소유 픽스처 행만 — 생산완료(배송 직전)로 세워 정상 전이 가드를 통과시킨다.
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `UPDATE g5_shop_order SET od_status = '생산완료' WHERE od_id = ?`,
    odId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE g5_shop_cart SET ct_status = '생산완료' WHERE od_id = ?`,
    odId,
  );
}

interface DeliveryRow {
  status: string;
  method: string;
  company: string;
  invoice: string;
  invoiceTime: string;
}

async function readDelivery(odId: string): Promise<DeliveryRow> {
  const prisma = getPrisma();
  // od_invoice_time 은 DATE_FORMAT 으로 문자열화 — mysql2 raw 는 datetime 을 JS Date 로 돌려준다.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT od_status, od_delivery_method, od_delivery_company, od_invoice,
            DATE_FORMAT(od_invoice_time, '%Y-%m-%d %H:%i:%s') AS od_invoice_time
       FROM g5_shop_order WHERE od_id = ?`,
    odId,
  );
  const r = rows[0];
  if (r === undefined) throw new Error(`주문 없음: ${odId}`);
  return {
    status: String(r.od_status ?? ''),
    method: String(r.od_delivery_method ?? ''),
    company: String(r.od_delivery_company ?? ''),
    invoice: String(r.od_invoice ?? ''),
    invoiceTime: String(r.od_invoice_time ?? ''),
  };
}

describe.skipIf(!RUN)('배송방법 P1 — 비택배 배송 전이·라벨 병용·택배 가드', () => {
  const admin = signJwt({ mbId: 'e2e-admin', isAdmin: true });
  const made: G5OrderFixture[] = [];
  let odPickup: string; // 방문수령으로 정상 전이
  let odForce: string; // MISSING_INVOICE skip 대조 → force-status 퀵착불
  let odParcel: string; // 택배 정상 경로 회귀

  beforeAll(async () => {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(
        `${API_URL} 도달 실패 — API 서버를 켜세요: pnpm dev:api\n(${e instanceof Error ? e.message : String(e)})`,
      );
    }
    // od_id 는 Date.now() 합성이라 동시 생성 시 충돌 — 순차로 만든다.
    const a = await createG5OrderFixture('e2e-dm', 'e2e-dm-a');
    const b = await createG5OrderFixture('e2e-dm', 'e2e-dm-b');
    const c = await createG5OrderFixture('e2e-dm', 'e2e-dm-c');
    made.push(a, b, c);
    odPickup = a.odId;
    odForce = b.odId;
    odParcel = c.odId;
  });

  afterAll(async () => {
    // 재고 앵커 관례(g5.ts 주석·여정 26호): '배송' 진입 건은 반드시 '주문' 복원(재고 원복) 후 삭제.
    for (const f of made) {
      await api(admin, 'PATCH', `/api/admin/orders/${f.odId}/force-status`, { target: '주문' });
      await deleteOrderHard(f.odId);
    }
    await disconnectPrisma();
  });

  test('T1 방문수령은 송장 없이 배송 전이되고, 택배 미비 행은 MISSING_INVOICE 로 skip', async () => {
    await setProdDone(odPickup);
    await setProdDone(odForce);

    // odForce 는 선택만 되고 delivery 행이 없다 — FE 수집 규칙 그대로(미비 행은 odIds 에만 남긴다).
    const r = await api(admin, 'PATCH', '/api/admin/orders/status', {
      target: '배송',
      odIds: [odPickup, odForce],
      delivery: [{ odId: odPickup, method: 'pickup', invoiceTime: INVOICE_TIME }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.data?.processed).toEqual([odPickup]);
    expect(r.json?.data?.skipped).toEqual([{ odId: odForce, reason: 'MISSING_INVOICE' }]);

    // 병용 기록 실측 — method 코드 + 한글 라벨, 송장은 빈 값(운영 관행 미러).
    const row = await readDelivery(odPickup);
    expect(row.status).toBe('배송');
    expect(row.method).toBe('pickup');
    expect(row.company).toBe('방문수령');
    expect(row.invoice).toBe('');
    expect(row.invoiceTime.startsWith('2026-08-17')).toBe(true);

    // skip 된 쪽은 무변화.
    const untouched = await readDelivery(odForce);
    expect(untouched.status).toBe('생산완료');
    expect(untouched.method).toBe('');
  });

  test('T2 택배인데 회사·송장 없는 delivery 행은 계약 refine 이 400 으로 거부', async () => {
    const r = await api(admin, 'PATCH', '/api/admin/orders/status', {
      target: '배송',
      odIds: [odForce],
      delivery: [{ odId: odForce, method: 'parcel', invoiceTime: INVOICE_TIME }],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    const after = await readDelivery(odForce);
    expect(after.status).toBe('생산완료'); // 거부는 무부수효과
  });

  test('T3 force-status 배송도 같은 병용 규칙 — 퀵서비스(착불)', async () => {
    const r = await api(admin, 'PATCH', `/api/admin/orders/${odForce}/force-status`, {
      target: '배송',
      delivery: { method: 'quick_cod', invoiceTime: INVOICE_TIME },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const row = await readDelivery(odForce);
    expect(row.status).toBe('배송');
    expect(row.method).toBe('quick_cod');
    expect(row.company).toBe('퀵배송(착불)');
    expect(row.invoice).toBe('');
  });

  test('T4 상세 읽기 계약에 deliveryMethod 가 실린다', async () => {
    const r = await api(admin, 'GET', `/api/admin/orders/${odPickup}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const order = r.json?.data?.order;
    expect(order?.deliveryMethod).toBe('pickup');
    expect(order?.deliveryCompany).toBe('방문수령');
    expect(order?.invoiceNo).toBeNull(); // '' → null 정규화
  });

  test('T5 택배 정상 경로 회귀 — method=parcel 이 기록되고 3필드가 그대로 실린다', async () => {
    await setProdDone(odParcel);
    const r = await api(admin, 'PATCH', '/api/admin/orders/status', {
      target: '배송',
      odIds: [odParcel],
      delivery: [
        {
          odId: odParcel,
          method: 'parcel',
          deliveryCompany: 'CJ대한통운',
          invoiceNo: '999900001111',
          invoiceTime: INVOICE_TIME,
        },
      ],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.data?.processed).toEqual([odParcel]);

    const row = await readDelivery(odParcel);
    expect(row.status).toBe('배송');
    expect(row.method).toBe('parcel');
    expect(row.company).toBe('CJ대한통운');
    expect(row.invoice).toBe('999900001111');
  });
});
