// 여정 22호 — **파일·첨부 권한 축**(누가 무엇을 받을 수 있는가).
//
// 파일은 트랙 전체에 흩어져 있다 — 거버 스펙(고객 도면)·EQ 첨부(협력사 제작 확인)·선적 서류
// (Invoice/AWB)·송금 증빙·A/S 첨부. 각각 **누가 올리고 누가 받을 수 있는지**가 다른데, 9호가
// 다룬 정보 격리는 화면·목록 축이었고 **다운로드 경계**는 얕게 봤다. 파일은 한 번 새면 되돌릴
// 수 없다 — 고객 도면이 남의 협력사에게 가면 그것으로 끝이다.
//
// 표적:
//   ① **남의 발주 첨부는 못 받는다** — 협력사 토큰으로 다른 조직의 EQ 첨부·스펙 파일을 요청.
//      목록에서 안 보이는 것과 **URL 을 알아도 못 받는 것**은 다른 문제다(id 는 순번이라 추측된다).
//   ② **종류별 1건 교체** — 같은 fileType 을 두 번 올리면 최신 1건만 남는다(누적되면 어느 것이
//      진짜인지 알 수 없다).
//   ③ **잠금 뒤에는 못 바꾼다** — 승인요청 후 EQ 첨부 교체·삭제가 막힌다(EQ_LOCKED).
//   ④ **고객은 공유된 것만 받는다** — EQ 확인 요청에 실린 첨부(sharedFileIds)는 받고,
//      공유되지 않은 것은 못 받는다.
//
// 실행: pnpm -F e2e journey:files  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 스크린샷 접두사는 **V** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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
  newSession,
  num,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');
const OWNER = '협력2'; // 발주를 받는 조직(파일 주인)
const OUTSIDER = '마스터딜러상사'; // 이 건과 무관한 조직(계정 있음 — 토큰을 만들 수 있다)

describe.skipIf(!RUN || !JOURNEY)('여정 22호 — 파일·첨부 권한 축', () => {
  const rp = createJourneyReport('findings-files', '여정 22호 파일 권한 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let owner: PartnerFixture;
  let outsider: PartnerFixture;
  let A = '';
  let P = ''; // 주인 조직 토큰
  let X = ''; // 무관한 조직 토큰
  let C = ''; // 고객 토큰

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let eqFileId: number | null = null;
  let specFileId: number | null = null;
  let reviewId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
  ): Promise<{ status: number; json: any }> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: 'application/zip' }));
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, json };
  };

  /** 다운로드는 파일 바이트를 주므로 상태 코드만 본다(본문은 JSON 이 아닐 수 있다). */
  const download = async (token: string, path: string): Promise<number> => {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.status;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    owner = await getPartner(OWNER);
    outsider = await getPartner(OUTSIDER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    if (outsider.mbId === null) throw new Error(`${OUTSIDER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    X = signJwt({ mbId: outsider.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('V1. 준비 — 발주 + EQ 첨부(주인 조직)', async () => {
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 22호] 파일 권한 검증 — 확인 후 정리 예정',
      prefix: 'V01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(owner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(owner.id))?.rfqId;
    ledger.push(`sp_pcb_rfq #${String(rfqId)}`);
    expect(
      (
        await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
          price: 70,
          quotedDeliveryDate: '2026-10-20',
        })
      ).status,
      '포털 회신',
    ).toBe(200);
    expect(
      (
        await api(
          A,
          'POST',
          `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
          { finalPrice: 130_000, exchangeRate: 1400 },
        )
      ).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'V1',
      prefix: 'V01',
      buyerName: 'e2e파일권한고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart`);
    expect(
      (
        await api(A, 'PATCH', '/api/admin/orders/status', {
          target: '입금',
          odIds: [odId],
          sendMail: false,
          sendSms: false,
        })
      ).status,
      '입금확인',
    ).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(owner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(owner.id))?.poId;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);

    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-v1.zip`,
      );
      expect(up.status, `${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const eqFiles = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId ?? 0) },
      orderBy: { id: 'asc' },
    });
    expect(eqFiles.length, 'EQ 첨부 2건').toBe(2);
    eqFileId = Number(eqFiles[0]?.id);

    const specFiles = await prisma.spFile.findMany({
      where: { refType: 'sp_order_spec', refId: BigInt(specId ?? 0) },
      orderBy: { id: 'asc' },
    });
    specFileId = specFiles.length > 0 ? Number(specFiles[0]?.id) : null;
    F(
      'V1',
      'obs',
      `준비 완료 — po=${String(poId)} · EQ 첨부 2건(대표 #${String(eqFileId)}) · ` +
        `스펙 파일 ${String(specFiles.length)}건(대표 #${String(specFileId)})`,
    );
  }, 600_000);

  test('V2. 남의 첨부는 URL 을 알아도 못 받는다', async (ctx) => {
    if (poId === null || eqFileId === null) return ctx.skip();

    // 주인은 받는다 — 이 200 이 있어야 아래 거절이 "권한 때문"임이 증명된다.
    expect(
      await download(P, `/api/partner/pcb-pos/${String(poId)}/eq-files/${String(eqFileId)}`),
      '주인 조직은 자기 EQ 첨부를 받는다',
    ).toBe(200);

    // 무관한 조직이 **같은 URL** 로 요청 — 목록에 안 보이는 것과 별개로 막혀야 한다
    // (파일 id 는 순번이라 추측 가능하다).
    const outsiderEq = await download(
      X,
      `/api/partner/pcb-pos/${String(poId)}/eq-files/${String(eqFileId)}`,
    );
    expect(outsiderEq >= 400, `남의 EQ 첨부 요청: ${String(outsiderEq)}`).toBe(true);

    // 스펙 파일(고객 도면)도 마찬가지 — 새면 되돌릴 수 없는 자산이다.
    if (specFileId !== null) {
      const outsiderSpec = await download(
        X,
        `/api/partner/pcb-pos/${String(poId)}/spec-files/${String(specFileId)}`,
      );
      expect(outsiderSpec >= 400, `남의 스펙 파일 요청: ${String(outsiderSpec)}`).toBe(true);
    }

    // 고객 토큰으로 협력사 경로를 두드려도 안 된다(역할이 다르다).
    const asCustomer = await download(
      C,
      `/api/partner/pcb-pos/${String(poId)}/eq-files/${String(eqFileId)}`,
    );
    expect(asCustomer >= 400, `고객 토큰의 협력사 경로: ${String(asCustomer)}`).toBe(true);
    F(
      'V2',
      'obs',
      `다운로드 경계 실측 — 주인 200 · 무관 조직 ${String(outsiderEq)} · 고객 토큰 ` +
        `${String(asCustomer)}(협력사 경로는 역할로 막힌다)`,
    );
  }, 300_000);

  // 이 편이 처음 잡았을 때는 "누적되는데 화면이 나열만 한다 → 옛 도면으로 승인한다"가 결함
  // 이었다. 결정(2026-08-11): **누적은 유지**하고(다층 보드처럼 여러 장 올리는 실무를 막지
  // 않는다·덮어쓰기는 되돌릴 수 없다) 대신 **최신을 갈라 보여 준다**. 그래서 지금 이 테스트가
  // 지키는 명세는 둘이다 — 파일은 남는다, 그리고 최신이 표시된다.
  test('V3. 같은 종류를 다시 올려도 남는다 — 대신 최신이 갈린다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const prisma = getPrisma();

    const before = await prisma.spFile.count({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
    });
    const again = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { fileType: 'eq' },
      'eq-v2.zip',
    );
    expect(again.status, `같은 종류 재업로드: ${JSON.stringify(again.json)}`).toBe(200);

    const after = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
      orderBy: { id: 'asc' },
    });
    const eqOnes = after.filter((f: any) => String(f.fileType) === 'eq');
    expect(after.length, 'EQ 첨부는 누적된다(결정: 지우지 않는다)').toBe(before + 1);
    expect(eqOnes.length, '같은 종류가 여러 건 공존').toBeGreaterThan(1);
    eqFileId = Number(eqOnes[eqOnes.length - 1]?.id);

    // 협력사 포털이 보는 응답 — 최신 판정이 여기 실려야 화면이 갈라 그린다.
    const detail = await api(P, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    expect(detail.status, `포털 상세: ${JSON.stringify(detail.json)}`).toBe(200);
    const files: any[] = detail.json?.data?.eq?.files ?? [];
    const latestEq = files.filter((f) => f.fileType === 'eq' && f.isLatest === true);
    expect(latestEq.length, 'eq 종류의 최신은 하나').toBe(1);
    expect(String(latestEq[0]?.name), '나중에 올린 것이 최신').toBe('eq-v2.zip');
    expect(files[0]?.isLatest, '최신이 목록 앞에 선다').toBe(true);

    F(
      'V3',
      'obs',
      `EQ 첨부 누적 + 최신 판정 실측(22호 결함의 결정판) — eq 종류 ${String(eqOnes.length)}건 공존` +
        `(${eqOnes.map((f: any) => String(f.originFileName)).join(', ')})하되 isLatest 는 ` +
        `'${String(latestEq[0]?.name)}' 하나뿐이고 목록 맨 앞에 선다. 파일을 지우지 않으므로 여러 장 ` +
        `올리는 실무가 살아 있고, 관리자·협력사 화면은 최신만 펼쳐 보여 옛 도면 오승인을 막는다.`,
    );
  }, 300_000);

  test('V4. 승인요청 뒤에는 잠긴다 — 교체도 삭제도', async (ctx) => {
    if (poId === null || eqFileId === null) return ctx.skip();

    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {})).status,
      'EQ 승인요청',
    ).toBe(200);

    const locked = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { fileType: 'eq' },
      'eq-late.zip',
    );
    expect(locked.status, `잠금 후 업로드: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '거절 코드').toBe('EQ_LOCKED');

    const del = await api(
      P,
      'DELETE',
      `/api/partner/pcb-pos/${String(poId)}/eq-files/${String(eqFileId)}`,
    );
    expect(del.status, `잠금 후 삭제: ${JSON.stringify(del.json)}`).toBe(409);
    F('V4', 'obs', `잠금 실측 — 승인요청 뒤 업로드·삭제 모두 409(검토 중인 서류가 바뀌면 안 된다)`);
  }, 300_000);

  test('V5. 고객은 공유된 것만 받는다', async (ctx) => {
    if (poId === null || eqFileId === null) return ctx.skip();
    const prisma = getPrisma();

    // 관리자가 EQ 첨부를 **골라** 고객 확인을 요청한다(sharedFileIds).
    const ask = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 22호] 이 도면으로 진행해도 될까요',
      sharedFileIds: [eqFileId],
    });
    expect(ask.status, `고객 확인 요청: ${JSON.stringify(ask.json)}`).toBe(200);
    const review = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'desc' },
    });
    reviewId = review === null ? null : Number(review.id);
    expect(reviewId, '리뷰 행').toBeTruthy();
    ledger.push(`sp_pcb_eq_review #${String(reviewId)}`);

    // 공유된 파일은 고객이 받는다.
    const shared = await download(
      C,
      `/api/pcb-eq-reviews/${String(reviewId)}/files/${String(eqFileId)}`,
    );
    expect(shared, '공유된 첨부는 고객이 받는다').toBe(200);

    // 공유되지 않은 파일(working)은 같은 경로로도 못 받는다 — 공유 목록이 곧 경계다.
    const others = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
    });
    const notShared = others.find((f: any) => Number(f.id) !== eqFileId);
    if (notShared !== undefined) {
      const blocked = await download(
        C,
        `/api/pcb-eq-reviews/${String(reviewId)}/files/${String(notShared.id)}`,
      );
      expect(blocked >= 400, `미공유 첨부 요청: ${String(blocked)}`).toBe(true);
      F(
        'V5',
        'obs',
        `공유 경계 실측 — 공유분 200 · 미공유분 ${String(blocked)}(같은 발주의 파일이어도 ` +
          `sharedFileIds 에 없으면 못 받는다)`,
      );
    } else {
      F('V5', 'obs', `공유분 200 — 미공유 대조군 없음(첨부가 1건뿐)`);
    }
  }, 300_000);

  test('V6. 정리 준비 — 주문 되돌리기(재고 복원)', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('V6', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 문서는 cleanup-probe 로.`);
  }, 180_000);
});
