// 여정 34호 — **주문이 사라진 뒤의 견적**(앵커 정합).
//
// 서른세 편이 "앞으로 나아가는" 길을 봤다. 이 편은 **뒤에서 발이 빠지는** 경우다:
// 고객이 "주문 취소해 주세요" 하고 관리자가 미입금 주문을 지우면, 그 주문에 딸려 있던
// 견적(sp_order_spec)은 어떻게 되는가.
//
// 앵커는 셋으로 이어져 있다 — `sp_order_spec.ctId` → `g5_shop_cart.ct_id` → `od_id`.
// 주문 삭제는 cart 행을 **물리 삭제**하므로 가운데 고리가 끊긴다. 그때 견적관리 목록은
// "ctId 가 찍혔는데 cart 행이 없다"를 보고 **보관함으로 지연 반영**한다(lazy reconcile).
// 라우트 주석은 "운영자가 주문 cart 행을 지우는 예외가 있어도 소실되지 않고 보관함에
// 남는다"고 말한다 — 그 약속이 지켜지는지, 그리고 **거기서 되살릴 수 있는지**를 본다.
//
// 표적:
//   ① 삭제 뒤 견적이 **어디에 있는가** — 견적관리? 보관함? 아무 데도 없나?
//   ② 고객이 **다시 주문할 수 있는가** — 취소는 되돌릴 수 있어야 하는 종류의 일이다.
//   ③ 협력 트랙이 걸린 주문(결제 흔적)은 **삭제가 막히는가** — 발주를 고아로 만들면 안 된다.
//
// 실행: pnpm -F e2e journey:orphan  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  monoRoot,
  newPhpSession,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 34호 — 주문이 사라진 뒤의 견적', () => {
  const rp = createJourneyReport('findings-orphan', '여정 34호 앵커 정합 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let partner2: PartnerFixture;
  let A = '';
  let C = ''; // 고객 토큰(읽기·담기용 — 주문은 cartId 클레임이 필요해 화면으로 한다)

  /** 지워질 주문의 견적. */
  let doomedSpecId: number | null = null;
  /** 대조군 — 아무것도 하지 않은 순수 견적. 목록에서 "보이는 게 정상"의 기준선이다. */
  let controlSpecId: number | null = null;
  /** 협력 트랙이 걸린 견적(결제 흔적 있는 주문) — 삭제 가드 확인용. */
  let liveSpecId: number | null = null;
  let doomedOdId: string | null = null;
  let liveOdId: string | null = null;
  let livePoId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const specRow = async (id: number): Promise<any> =>
    getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(id) } });

  const cartRowCount = async (ctId: number): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM g5_shop_cart WHERE ct_id = ?`,
      ctId,
    );
    return Number(rows[0]?.n ?? 0);
  };

  const cartStatus = async (ctId: number): Promise<string> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT ct_status FROM g5_shop_cart WHERE ct_id = ?`,
      ctId,
    );
    return String(rows[0]?.ct_status ?? '(행 없음)');
  };

  const orderExists = async (odId: string): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    return Number(rows[0]?.n ?? 0);
  };

  /** 고객이 보는 목록 — 화면이 그대로 쓰는 응답이다({ data: { items } }). */
  const myProjects = async (status: 'active' | 'deleted'): Promise<any[]> => {
    const r = await api(C, 'GET', `/api/pcb-projects?status=${status}`);
    expect(r.status, `내 견적 목록(${status}): ${JSON.stringify(r.json)}`).toBe(200);
    return r.json?.data?.items ?? [];
  };

  /**
   * 고객 본인 토큰 — 로컬 서명(signJwt)엔 **cartId 클레임이 없다**(10호가 기록한 함정).
   * 담기·주문은 그 클레임을 세션 장바구니 키로 쓰므로 서명 토큰이면 NO_CART_ID 로 먼저
   * 끊겨 "막혔다"가 결함인지 검증 실수인지 구별되지 않는다. 화면이 실제로 쓰는 경로
   * (/spcb/api/me 세션→JWT 브리지)를 고객 세션 안에서 불러 진짜 토큰을 얻는다.
   */
  const customerToken = async (): Promise<string> => {
    const token: string = await customer.page.evaluate(() =>
      fetch('/spcb/api/me', { credentials: 'include' })
        .then((r) => r.json())
        .then((m: any) => String(m.token ?? '')),
    );
    expect(token, '고객 세션 토큰(/spcb/api/me)').not.toBe('');
    return token;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner2 = await getPartner('협력2');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('N1. 고객: 견적 3건 — 지울 것·대조군·협력 트랙이 걸릴 것', async () => {
    const made: number[] = [];
    for (const tag of ['지울주문', '대조군', '진행중'] as const) {
      const id = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 34호-${tag}] 앵커 정합 — 확인 후 정리 예정`,
        prefix: `N01-${tag}`,
      });
      made.push(id);
      ledger.push(`sp_order_spec #${String(id)} (${tag})`);
    }
    expect(new Set(made).size, '세 건이 서로 다르다').toBe(3);
    doomedSpecId = made[0] ?? null;
    controlSpecId = made[1] ?? null;
    liveSpecId = made[2] ?? null;
  }, 900_000);

  test('N2. 관리자: 두 건 가격 확정 → 각각 주문(하나는 결제까지)', async (ctx) => {
    if (doomedSpecId === null || liveSpecId === null) return ctx.skip();
    let liveRfqId: number | null = null;
    for (const specId of [doomedSpecId, liveSpecId]) {
      const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
        partnerIds: [num(partner2.id)],
      });
      expect(send.status, `RFQ: ${JSON.stringify(send.json)}`).toBe(200);
      const rfqId = (send.json?.data?.rfqs ?? [])[0]?.rfqId;
      const P = signJwt({ mbId: partner2.mbId ?? '', ttlSec: 3600 });
      expect(
        (await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
          price: 200,
          quotedDeliveryDate: '2026-08-28',
        })).status,
        '회신',
      ).toBe(200);
      const sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 300_000 },
      );
      expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
      if (specId === liveSpecId) liveRfqId = rfqId;
    }

    // 지울 주문 — 입금 전(od_status='주문')이라야 삭제 대상이 된다.
    const doomed = await placeOrderFromQuotes(customer, rp, {
      specId: doomedSpecId,
      step: 'N2',
      prefix: 'N02-doomed',
      buyerName: 'e2e앵커고객',
    });
    doomedOdId = doomed.odId;
    ledger.push(`g5_shop_order od_id=${doomedOdId} (지울 주문)`);

    // 진행 중 주문 — 입금·발주까지 가서 결제 흔적을 남긴다.
    const live = await placeOrderFromQuotes(customer, rp, {
      specId: liveSpecId,
      step: 'N2',
      prefix: 'N02-live',
      buyerName: 'e2e앵커고객',
    });
    liveOdId = live.odId;
    ledger.push(`g5_shop_order od_id=${liveOdId} (진행 중)`);
    expect(
      (await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [liveOdId],
        sendMail: false,
        sendSms: false,
      })).status,
      '입금확인',
    ).toBe(200);
    // ⚠ 견적행 발주는 **선정된 rfqId 를 넘겨야** 한다(RFQ_NOT_SELECTED 가드) — 빼면 200 인데
    //   pos 가 비어 돌아와 뒤 단계가 조용히 무너진다(1차 주행에서 실제로 그랬다).
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(liveSpecId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId: liveRfqId,
      exchangeRate: 1400,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    livePoId = (issue.json?.data?.pos ?? [])[0]?.poId ?? null;
    expect(livePoId, `발주서 행: ${JSON.stringify(issue.json?.data?.pos)}`).toBeTruthy();
    ledger.push(`sp_pcb_po #${String(livePoId)} (진행 중)`);
    F(
      'N2',
      'obs',
      `준비 — 지울 주문 ${doomedOdId}(미입금) · 진행 중 ${liveOdId}(입금+발주 #${String(livePoId)}) · ` +
        `대조군 견적 #${String(controlSpecId)}(주문 안 함)`,
    );
  }, 900_000);

  test('N3. 삭제 전 기준선 — 견적은 목록 어디에도 없고(주문됨) 대조군만 보인다', async (ctx) => {
    if (doomedSpecId === null || controlSpecId === null) return ctx.skip();
    const active = await myProjects('active');
    const ids = active.map((p: any) => Number(p.projectId ?? p.id));
    // 대조군(순수 견적)은 견적관리에 보인다 — 이 200 이 있어야 아래 "안 보인다"가 의미를 갖는다.
    expect(ids, '대조군은 견적관리에 있다').toContain(controlSpecId);
    // 주문한 건은 견적관리에서 빠진다(장바구니·주문내역 소관) — 설계상 정상이다.
    expect(ids, '주문한 건은 견적관리에 없다').not.toContain(doomedSpecId);
    F(
      'N3',
      'obs',
      `기준선 — 견적관리 ${String(active.length)}건에 대조군 #${String(controlSpecId)} 포함, ` +
        `주문한 #${String(doomedSpecId)} 미포함(주문내역 소관)`,
    );
  }, 180_000);

  test('N4. 관리자가 미입금 주문을 지운다 — 주문만 사라지고 카트 행은 흔적으로 남는다', async (ctx) => {
    if (doomedOdId === null || doomedSpecId === null) return ctx.skip();
    const before = await specRow(doomedSpecId);
    const ctId = Number(before?.ctId ?? 0);
    expect(ctId, '삭제 전 앵커(ctId)가 있다').toBeGreaterThan(0);
    expect(await cartRowCount(ctId), '삭제 전 cart 행 존재').toBe(1);

    const del = await api(A, 'POST', '/api/admin/orders/delete', { odIds: [doomedOdId] });
    expect(del.status, `주문 삭제: ${JSON.stringify(del.json)}`).toBe(200);
    expect(del.json?.data?.processed, '삭제 처리됨').toContain(doomedOdId);

    // ⚠ 여기가 이 편의 출발점이다 — 카트 행은 **지워지지 않는다**. 코어가 이력으로 남기며
    //   상태만 '삭제'가 된다. 그 행을 "주문됨"으로 세면 주문이 없는데 주문됨이 되어
    //   견적이 목록 어디에도 안 뜬다(1차 주행에서 실제로 그랬다).
    expect(await cartRowCount(ctId), '카트 행은 남는다(코어 이력 보존)').toBe(1);
    expect(await cartStatus(ctId), "카트 행 상태가 '삭제'로 바뀐다").toBe('삭제');
    expect(await orderExists(doomedOdId), '주문 헤더는 사라진다').toBe(0);

    const after = await specRow(doomedSpecId);
    F(
      'N4',
      'obs',
      `주문 삭제 실측 — od=${doomedOdId} 헤더 소멸(0행) · cart ct_id=${String(ctId)} 는 남고 ` +
        `상태 '삭제' · spec.ctId=${String(after?.ctId)} · spec.status=${String(after?.status)}`,
    );
  }, 300_000);

  test('N5. 그 견적은 어디로 갔나 — 견적관리·보관함 둘 다 본다', async (ctx) => {
    if (doomedSpecId === null || controlSpecId === null) return ctx.skip();
    // ⚠ 지연 반영(lazy reconcile)은 **active 목록을 조회할 때** 일어난다 — 먼저 그걸 부른다.
    const active = await myProjects('active');
    const activeIds = active.map((p: any) => Number(p.projectId ?? p.id));
    const archived = await myProjects('deleted');
    const archivedIds = archived.map((p: any) => Number(p.projectId ?? p.id));

    const where =
      activeIds.includes(doomedSpecId)
        ? '견적관리'
        : archivedIds.includes(doomedSpecId)
          ? '보관함'
          : '아무 데도 없음';
    const spec = await specRow(doomedSpecId);

    // 대조군은 그대로 있어야 한다 — 없으면 이 편의 조작이 남의 데이터까지 건드린 것이다.
    expect(activeIds, '대조군은 그대로 견적관리에').toContain(controlSpecId);

    // 거래만 취소된 것이고 견적은 유효하다 — **견적관리로 돌아와야** 다시 주문할 수 있다.
    // (보관함은 "사용자가 장바구니에서 뺀 것"의 자리이고, 거기엔 복원 경로가 없다.)
    expect(where, '주문이 삭제된 견적은 견적관리로 돌아온다').toBe('견적관리');
    // 앵커도 비워져야 한다 — 남아 있으면 담기가 다시 ALREADY_ORDERED 로 막힌다.
    expect(spec?.ctId ?? null, '앵커(ctId)가 비워진다').toBeNull();
    F(
      'N5',
      'obs',
      `삭제 뒤 위치 실측 — #${String(doomedSpecId)} 는 **${where}**(spec.status=` +
        `${String(spec?.status)} · ctId=${String(spec?.ctId)}) · 견적관리 ` +
        `${String(activeIds.length)}건 · 보관함 ${String(archivedIds.length)}건`,
    );
  }, 300_000);

  test('N6. 고객이 다시 주문할 수 있는가 — 취소는 되돌릴 수 있어야 한다', async (ctx) => {
    if (doomedSpecId === null) return ctx.skip();
    // 담기 = 재주문의 첫 걸음. 여기서 막히면 고객은 거버부터 다시 올려야 한다.
    // 화면이 쓰는 진짜 토큰으로 부른다 — 서명 토큰이면 cartId 가 없어 무엇이 막았는지 흐려진다.
    const cart = await api(
      await customerToken(),
      'POST',
      `/api/pcb-projects/${String(doomedSpecId)}/cart`,
      {},
    );
    const spec = await specRow(doomedSpecId);

    // 취소는 되돌릴 수 있어야 하는 종류의 일이다 — 여기서 막히면 거버부터 전부 다시다.
    expect(cart.status, `담기: ${JSON.stringify(cart.json)}`).toBe(200);

    // 화면에서도 그 견적이 견적관리에 서 있는지 눈으로 본다.
    await rp.view(customer, '/app/quotes', 'N06-quotes');
    await rp.shot(customer, 'N06-quotes');

    F(
      'N6',
      'obs',
      `재주문 실측 — 담기 200(다시 담긴다) · spec.status=${String(spec?.status)}. ` +
        `관리자가 고객 요청으로 주문을 지워도 같은 견적으로 다시 주문할 수 있다 ` +
        `(교정 전에는 ALREADY_ORDERED 로 막혀 거버 업로드부터 전부 다시였다).`,
    );
  }, 300_000);

  test('N7. 협력 트랙이 걸린 주문은 지워지지 않는다 — 발주를 고아로 만들지 않는다', async (ctx) => {
    if (liveOdId === null) return ctx.skip();
    const del = await api(A, 'POST', '/api/admin/orders/delete', { odIds: [liveOdId] });
    expect(del.status, `진행 중 주문 삭제 시도: ${JSON.stringify(del.json)}`).toBe(200);
    // 200 이지만 **처리되지 않아야** 한다(선택삭제는 건별 skip 으로 답한다).
    expect(del.json?.data?.processed, '결제 흔적 있는 주문은 삭제 안 됨').not.toContain(liveOdId);
    const skipped = (del.json?.data?.skipped ?? []).find((s: any) => s.odId === liveOdId);
    expect(skipped, 'skip 사유가 붙는다').toBeTruthy();

    // 발주가 살아 있는지 직접 확인 — 고아가 됐다면 여기가 비어야 한다.
    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(livePoId ?? 0) } });
    expect(po, '발주서 존속').toBeTruthy();
    F(
      'N7',
      'obs',
      `삭제 가드 실측 — 결제 흔적 있는 od=${liveOdId} 는 skip(${String(skipped?.reason)}) 되고 ` +
        `발주 #${String(livePoId)} 는 그대로다(협력 트랙이 고아가 되지 않는다).`,
    );
  }, 300_000);

  test('N8. 정리 준비 — 진행 중 주문 되돌리기', async (ctx) => {
    if (liveOdId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${liveOdId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('N8', 'obs', `정리 준비 — od=${liveOdId} '주문' 복귀. 나머지는 cleanup-probe 로.`);
  }, 180_000);
});
