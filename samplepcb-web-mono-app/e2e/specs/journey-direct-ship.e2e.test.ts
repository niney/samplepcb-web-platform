// 여정 6호 — **직송(destinationCountry) 3종**: 발주의 직송지 축이 물류 모드·박스·큐 판정에
// 어떻게 작용하는지 국가 매트릭스의 남은 칸을 밟는다. 직송은 "관리자 소재(KR) 대신 그 나라가
// 받는 곳"이 되는 스위치(D5)로, 받는측(확인 주체)은 여전히 admin 이다(resolvePcbShipContext).
//
//   ① 협력2(CN) 발주 직송 CN → **domestic**(CN→CN — 직송이 만드는 비KR 국내) 3단계 완주
//   ② 협력2(CN) 발주 직송 VN → **international**(CN→VN — 양끝 비KR 국제) Invoice 요구 확인
//   ③ e2e한국협력(KR) 발주 직송 CN → **international**(KR→CN) — 신규 상설 조직·관리자 대행
//
// 핵심 검증 셋:
//   - 모드 = f(발송자국가, 직송지) 파생 실증(①②③이 세 조합을 나눠 밟는다)
//   - 박스 contextKey 의 직송지 축 분리 — ①②는 같은 협력2인데 직송지가 달라 **다른 박스**
//   - **직송 건의 고객 배송 큐(admin pcb-orders to_ship) 전용 종결 동선**(정책 확정 08-10) —
//     직송은 od 종결 창구가 이 큐뿐이라 남기되 directShipCountry 로 구분: 행 '직송 {국가}'
//     배지 + [직송 완료](운송장 없이 confirmDialog → force-status '완료') 실행까지(J3·J6)
//   - **직송 국제 어휘** — pcbShipmentStatusLabel 표시층 치환('국내도착'→'현지도착', J2)
//
// e2e한국협력 은 idempotent 상설 조직으로 남긴다(연결 계정·관계 없음 — 관리자 대행 전용).
// 근거는 J5 가 실측한다: 삭제 API(DELETE /api/admin/partners/:id)는 존재하나 살아 있는
// PCB 문서의 FK(RESTRICT)에 막히고, 여정 관례(생성물은 리포트 검토 후 수동 정리)상
// afterAll 시점엔 문서가 남아 있어 삭제 경로가 성립하지 않는다.
//
// 실행: pnpm -F e2e journey:direct  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts 스펙 축 훑기 — 상설 무접촉).
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
const KR_ORG_NAME = 'e2e한국협력'; // KR·KRW — 이 여정이 세우는 상설 조직(계정·관계 없음)

describe.skipIf(!RUN || !JOURNEY)('여정 6호 — 직송 3종(직송지 축의 모드·박스·큐 판정)', () => {
  const rp = createJourneyReport('findings-direct', '여정 6호 직송 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession; // 협력2(tester2) 보드 관찰용
  let p2: PartnerFixture;
  let krOrgId: bigint | null = null;
  let A = '';
  let P2 = '';

  // 케이스 상태 — ① 협력2→CN(국내) ② 협력2→VN(국제) ③ e2e한국협력→CN(국제)
  let spec1: number | null = null;
  let od1: string | null = null;
  let po1: number | null = null;
  let ship1Id: bigint | null = null;
  let spec2: number | null = null;
  let od2: string | null = null;
  let po2: number | null = null;
  let ship2Id: bigint | null = null;
  let spec3: number | null = null;
  let od3: string | null = null;
  let po3: number | null = null;

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: contentType }));
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

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 거버 제출 → 확정가 → 주문 → 입금 — 세 케이스가 공유하는 앞단(직송의 관심사 밖). */
  const prepPaidSpec = async (
    step: string,
    prefix: string,
    finalPrice: number,
  ): Promise<{ specId: number; odId: string }> => {
    const specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: `[여정 6호 ${step}] 직송 매트릭스 — 확인 후 정리 예정`,
      prefix,
    });
    ledger.push(`sp_order_spec #${String(specId)} (${step})`);
    const price = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specId)}/price`, {
      finalPrice,
    });
    expect(price.status, `확정가: ${JSON.stringify(price.json)}`).toBe(200);
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step,
      prefix,
      buyerName: 'e2e직송고객',
    });
    ledger.push(`g5_shop_order od_id=${order.odId} (${step})`);
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [order.odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    return { specId, odId: order.odId };
  };

  /** 협력사 계정으로 EQ 완주(파일 2종 → 요청 → 관리자 승인 → 생산 시작·완료). */
  const completeEqAsPartner = async (token: string, specId: number, poId: number, tag: string) => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        token,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-${tag}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const [path, tk] of [
      [`/api/partner/pcb-pos/${String(poId)}/eq-request`, token],
      [`/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(poId)}/production-start`, token],
      [`/api/partner/pcb-pos/${String(poId)}/production-complete`, token],
    ] as const) {
      const r = await api(tk, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  };

  /** 관리자 대행 EQ 완주(D11 — 연결 계정 없는 조직용, 이력 byRole ADMIN). */
  const completeEqAsAdmin = async (specId: number, poId: number, tag: string) => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        A,
        `${base}/eq-files`,
        { fileType },
        `${fileType}-${tag}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}(대행): ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const path of [
      `${base}/eq-request`,
      `${base}/eq-approve`,
      `${base}/production-start`,
      `${base}/production-complete`,
    ]) {
      const r = await api(A, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    const prisma = getPrisma();

    p2 = await getPartner('협력2');
    if (p2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P2 = signJwt({ mbId: p2.mbId, ttlSec: 3600 });

    // ③용 상설 조직(idempotent — 있으면 재사용). 연결 계정·관계 없음: 협력사 조작은 전부
    // 관리자 대행 경로를 쓴다(EQ 대행 D11·선적 만능 대행 — 미온보딩 협력사 실무와 동형).
    let krOrg = await prisma.spPartner.findFirst({ where: { name: KR_ORG_NAME } });
    if (krOrg === null) {
      const created = await api(A, 'POST', '/api/admin/partners', {
        type: 'partner',
        name: KR_ORG_NAME,
        country: 'KR',
        defaultCurrency: 'KRW',
        capabilities: ['pcb_rfq'],
        contactName: 'e2e한국협력담당',
        contactEmail: 'e2ekr@test.local',
      });
      if (created.status !== 200) {
        throw new Error(`조직 생성 실패(${String(created.status)}): ${JSON.stringify(created.json)}`);
      }
      krOrg = await prisma.spPartner.findFirst({ where: { name: KR_ORG_NAME } });
      if (krOrg === null) throw new Error('조직 생성 직후 조회 실패');
      console.log(`  [setup] 조직 신설: #${String(krOrg.id)} ${KR_ORG_NAME} (KR/KRW·계정 없음)`);
    }
    krOrgId = krOrg.id;

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: p2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    // e2e한국협력 조직은 상설(J5 실측 근거) — 정리하지 않는다. 문서 생성물만 대장으로.
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('J1. 직송 ① 협력2→CN: 발주 직송지 CN → 담기 — 모드 domestic(비KR 국내) 파생', async () => {
    const prep = await prepPaidSpec('J1', 'J01', 60_000);
    spec1 = prep.specId;
    od1 = prep.odId;

    // 수동 발주(rfq 없이 조건 직접) + 직송지 CN — 외화(USD) 조직이라 회계 환율 명시.
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(spec1)}/pos`, {
      partnerId: num(p2.id),
      priceOriginal: 300,
      exchangeRate: 1400,
      destinationCountry: 'CN',
    });
    expect(issue.status, `직송 CN 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    po1 = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(p2.id))?.poId ?? null;
    expect(po1, '발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(po1)} (협력2·직송 CN)`);

    await completeEqAsPartner(P2, spec1, po1 ?? 0, 'direct1');
    const box = await api(P2, 'POST', '/api/partner/pcb-shipments/box', { poId: po1 });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);

    const prisma = getPrisma();
    const ship = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(po1 ?? 0) } } },
      orderBy: { id: 'desc' },
    });
    ship1Id = ship?.id ?? null;
    // 직송의 모드 파생 — 발송자 CN = 직송지 CN → **국내**(KR 이 전혀 안 끼는 domestic).
    expect(ship?.mode, '협력2(CN)→직송 CN 국내').toBe('domestic');
    expect(ship?.receiverKind, '직송도 확인 주체는 admin').toBe('admin');
    expect(ship?.receiverPartnerId, '받는 조직 없음').toBeNull();
    expect(ship?.destinationCountry, '직송지 박제').toBe('CN');
    ledger.push(`sp_pcb_shipment #${String(ship1Id)} (직송 CN — 국내)`);
    F('J1', 'obs', '직송 CN(협력2 CN발) — mode=domestic·receiverKind=admin·직송지 박제 확인');
  }, 480_000);

  test('J2. 직송 ② 협력2→VN: 국제 파생 + 같은 협력2인데 직송지 축으로 **다른 박스** + Invoice 요구', async (ctx) => {
    if (ship1Id === null) return ctx.skip();
    const prep = await prepPaidSpec('J2', 'J02', 60_000);
    spec2 = prep.specId;
    od2 = prep.odId;

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(spec2)}/pos`, {
      partnerId: num(p2.id),
      priceOriginal: 300,
      exchangeRate: 1400,
      destinationCountry: 'VN',
    });
    expect(issue.status, `직송 VN 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    po2 = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(p2.id))?.poId ?? null;
    expect(po2, '발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(po2)} (협력2·직송 VN)`);

    await completeEqAsPartner(P2, spec2, po2 ?? 0, 'direct2');
    const box = await api(P2, 'POST', '/api/partner/pcb-shipments/box', { poId: po2 });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);

    const prisma = getPrisma();
    const ship = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(po2 ?? 0) } } },
      orderBy: { id: 'desc' },
    });
    ship2Id = ship?.id ?? null;
    // 양끝이 다 비KR 인 국제 — CN발 VN행. 관리자 소재(KR)는 모드 계산에 안 낀다.
    expect(ship?.mode, '협력2(CN)→직송 VN 국제').toBe('international');
    expect(ship?.destinationCountry, '직송지 박제').toBe('VN');
    // 컨텍스트 분리 — 같은 협력2·같은 회차인데 직송지가 달라 ①의 박스에 합류하지 않는다.
    expect(ship2Id, '직송지 축으로 다른 박스').not.toBe(ship1Id);
    ledger.push(`sp_pcb_shipment #${String(ship2Id)} (직송 VN — 국제)`);

    // 보드에서 두 박스의 contextKey 가 직송지로 갈라져 보이는지(①은 아직 preparing).
    const board = await api(P2, 'GET', '/api/partner/pcb-shipments');
    expect(board.status, JSON.stringify(board.json)).toBe(200);
    const keys = (board.json?.data?.boxes ?? []).map((b: any) => b.contextKey);
    expect(keys, 'CN 박스 contextKey').toContain('admin:0:CN:r0');
    expect(keys, 'VN 박스 contextKey').toContain('admin:0:VN:r0');
    await rp.view(partnerView, '/app/partner/pcb/ship', 'J02-two-direct-boxes');

    // Invoice 요구가 모드 파생을 따르는지 — 국제(직송 VN)는 첨부 없이 선적요청 불가.
    const noInvoice = await api(P2, 'POST', `/api/partner/pcb-pos/${String(po2)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(noInvoice.status, `Invoice 없는 선적요청: ${JSON.stringify(noInvoice.json)}`).toBe(409);
    expect(noInvoice.json?.error, '국제 직송 Invoice 요구').toBe('MISSING_INVOICE_FILE');

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(
      P2,
      `/api/partner/pcb-pos/${String(po2)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-direct-vn.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(P2, 'POST', `/api/partner/pcb-pos/${String(po2)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    // 전이 두 칸째(선적 — AWB)는 관리자 차례. 여기까지만 밟고 멈춘다(완주는 ①의 몫).
    const shipped = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec2)}/pos/${String(po2)}/shipment/advance`,
      { carrier: 'DHL', trackingNumber: 'DIRECT-VN-AWB-0810' },
    );
    expect(shipped.status, `선적(AWB): ${JSON.stringify(shipped.json)}`).toBe(200);

    // ── 직송 국제 어휘(정책 확정 08-10) — 표시층 치환(pcbShipmentStatusLabel) 실화면:
    //    다음 전이가 arrived 인 지금이 관찰 적기다. 실물이 KR 에 안 오는 체인이라
    //    '국내도착'이 아니라 '현지도착'이어야 한다(코드·전이 사전은 BOM 공유 그대로).
    await rp.view(adminView, `/app/admin/pcb/cases/${String(spec2)}`, 'J02-case-vn-local-arrive');
    const caseBody: string = await adminView.page.evaluate(() => document.body.innerText);
    expect(caseBody, "Case 선적 행 다음 단계 버튼 = '현지도착 진행'").toContain('현지도착 진행');
    expect(caseBody.includes('국내도착'), '직송 국제 체인에서 국내도착 어휘 소거').toBe(false);
    await rp.view(partnerView, '/app/partner/pcb/ship', 'J02-portal-vn-local-arrive');
    // 어휘 검사는 **이 박스 카드 안**으로 좁힌다 — 보드는 이 협력사의 박스를 전부 그리므로,
    // 페이지 전체 텍스트를 훑으면 직송이 아닌 남의 박스(정상적으로 '국내도착'을 쓴다)를
    // 잡아 거짓 실패가 난다(2026-08-11 실측: 앞선 여정의 잔재 박스가 걸렸다).
    const vnCard: string = await partnerView.page.evaluate(() => {
      const card = [...document.querySelectorAll('section, article, div')].find(
        (el) =>
          el.textContent?.includes('직송 VN') === true &&
          el.querySelectorAll('section, article').length === 0,
      );
      return card?.textContent ?? '';
    });
    expect(vnCard, '직송 VN 박스 카드를 찾지 못함').toContain('직송 VN');
    expect(vnCard, '포털 발송 카드 스텝퍼 직송 국제 어휘').toContain('현지도착');
    expect(vnCard.includes('국내도착'), '포털 직송 카드에서 국내도착 어휘 소거').toBe(false);
    F(
      'J2',
      'obs',
      'CN→VN 국제 직송 — 다른 박스 분리·Invoice 요구·requested→shipped 2칸 + 현지도착 어휘(Case 버튼·포털 스텝퍼) 확인',
    );
  }, 480_000);

  test('J3. 직송 ① 국내 3단계 완주 → **고객 배송 큐 유지+직송 구분**(정책 확정 08-10)', async (ctx) => {
    if (po1 === null || spec1 === null || od1 === null) return ctx.skip();
    // 국내 3단계: 배송 중(협력2·택배사+송장) → 입고확인이 종점(RECEIVE_REQUIRED 확인).
    const adv = await api(P2, 'POST', `/api/partner/pcb-pos/${String(po1)}/shipment/advance`, {
      carrier: 'SF Express',
      trackingNumber: 'DIRECT-CN-0810',
    });
    expect(adv.status, `국내 발송(Invoice 불요): ${JSON.stringify(adv.json)}`).toBe(200);
    const advOnly = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec1)}/pos/${String(po1)}/shipment/advance`,
      {},
    );
    expect(advOnly.status, '입고확인 없는 delivered 전이').toBe(409);
    expect(advOnly.json?.error).toBe('RECEIVE_REQUIRED');
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec1)}/pos/${String(po1)}/shipment/receive`,
      { note: '[여정 6호] 직송 CN 도착 확인' },
    );
    expect(recv.status, `입고확인(직송 도착): ${JSON.stringify(recv.json)}`).toBe(200);
    const prisma = getPrisma();
    const closed = await prisma.spPcbShipment.findFirst({ where: { id: ship1Id ?? 0n } });
    expect(closed?.status, '입고확인이 국내 종점을 닫음').toBe('delivered');

    // ── 정책 확정(08-10) — 직송 건은 od 종결 창구가 이 큐뿐이라 **남기되 구분**한다:
    //    directShipCountry(최상위·최신 회차 발주의 직송지) 계약 확장이 행 배지('직송 CN')와
    //    [배송 처리]→[직송 완료] 분기의 근거다. J5 까지의 오판 박제를 새 동작으로 뒤집는다.
    const queue = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(od1)}&page=1&pageSize=20`,
    );
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const row = (queue.json?.data?.items ?? []).find((r: any) => r.odId === od1);
    expect(row, '직송 건 — 고객 배송 큐 유지(od 전용 종결 동선의 자리)').toBeTruthy();
    expect(row?.directShipCountry, '직송지 노출(계약 최소 확장)').toBe('CN');
    await rp.view(adminView, '/app/admin/pcb/shipments', 'J03-admin-shipping-direct');
    const queueBody: string = await adminView.page.evaluate(() => document.body.innerText);
    expect(queueBody, "고객 배송 행 '직송 CN' 배지").toContain('직송 CN');
    expect(queueBody, '[직송 완료] 버튼 노출(운송장 모달 대체)').toContain('직송 완료');
    F(
      'J3',
      'obs',
      `직송 건 고객 배송 큐 유지+구분 — od=${od1} directShipCountry=CN, ` +
        `행 배지·[직송 완료] 동선 노출 확인(실행은 J6). 구 '오판' 박제를 정책 확정 동작으로 뒤집음.`,
    );
    F('J3', 'obs', `직송 ① 국내 3단계 완주 — od=${od1} po=${String(po1)} (배송중→입고확인 종점)`);
  }, 240_000);

  test('J4. 직송 ③ e2e한국협력(KR)→CN: 국제 파생 — 계정 없는 조직의 관리자 대행 완주', async (ctx) => {
    if (krOrgId === null) return ctx.skip();
    const prep = await prepPaidSpec('J4', 'J04', 40_000);
    spec3 = prep.specId;
    od3 = prep.odId;

    // KRW 조직이라 환율 불요 — 직송지 CN 만 얹는다.
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(spec3)}/pos`, {
      partnerId: num(krOrgId),
      priceOriginal: 40_000,
      destinationCountry: 'CN',
    });
    expect(issue.status, `직송 CN 발주(KR 조직): ${JSON.stringify(issue.json)}`).toBe(200);
    po3 =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(krOrgId ?? 0n))?.poId ??
      null;
    expect(po3, '발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(po3)} (e2e한국협력·직송 CN)`);

    // 연결 계정이 없는 조직 — EQ 도 발송도 관리자 대행 경로로 완주한다(D11·만능 대행).
    await completeEqAsAdmin(spec3, po3 ?? 0, 'direct3');

    // 관리자 대행 첫 전이 — ensure 가 박스를 만들고, 국제라 Invoice 검사에 걸린다(생성은 유지).
    const noInvoice = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec3)}/pos/${String(po3)}/shipment/advance`,
      { shipDate: '2026-08-12' },
    );
    expect(noInvoice.status, `Invoice 없는 선적요청: ${JSON.stringify(noInvoice.json)}`).toBe(409);
    expect(noInvoice.json?.error, 'KR→CN 국제 Invoice 요구').toBe('MISSING_INVOICE_FILE');

    const prisma = getPrisma();
    const ship = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(po3 ?? 0) } } },
      orderBy: { id: 'desc' },
    });
    // KR발 CN행 — 발송자 KR 이어도 직송지가 비KR 이면 국제다(①의 대칭 조합).
    expect(ship?.mode, 'e2e한국협력(KR)→직송 CN 국제').toBe('international');
    expect(ship?.receiverKind, '확인 주체 admin').toBe('admin');
    expect(ship?.destinationCountry, '직송지 박제').toBe('CN');
    expect(ship?.id, '①의 CN 박스와 별개(보내는 조직 축)').not.toBe(ship1Id);
    ledger.push(`sp_pcb_shipment #${String(ship?.id)} (KR→CN 직송 — 국제)`);

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(
      A,
      `/api/admin/pcb-projects/${String(spec3)}/pos/${String(po3)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-direct-kr-cn.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice(대행): ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec3)}/pos/${String(po3)}/shipment/advance`,
      { shipDate: '2026-08-12' },
    );
    expect(reqd.status, `선적요청(대행): ${JSON.stringify(reqd.json)}`).toBe(200);
    F('J4', 'obs', 'KR→CN 직송 국제 — 관리자 대행(EQ·발송)으로 requested 도달, 모드·직송지 박제 확인');
  }, 480_000);

  test('J5. e2e한국협력 삭제 API — PCB 축 선제 가드 409 안내(교정 반영) → 상설 유지 근거', async (ctx) => {
    if (krOrgId === null || po3 === null) return ctx.skip();
    // (교정 08-10) 가드가 BOM RFQ 만 세던 결함 — PCB 축(sp_pcb_rfq·sp_pcb_po)도 선제
    // 409 PARTNER_HAS_PCB_DOCS 로 안내하고, 남는 FK P2003 도 같은 409 로 감싼다.
    // 살아 있는 PCB 발주 보유 조직은 이 안내로 막혀야 정상 — 성공하면 고아 발주 결함이다.
    const del = await api(A, 'DELETE', `/api/admin/partners/${String(num(krOrgId ?? 0n))}`);
    expect(del.status, `살아 있는 PCB 문서 보유 조직 삭제: ${JSON.stringify(del.json)}`).toBe(409);
    expect(del.json?.error, 'PCB 축 선제 가드').toBe('PARTNER_HAS_PCB_DOCS');
    expect(String(del.json?.message ?? ''), '정지 전환 안내 문구').toContain('정지');
    const prisma = getPrisma();
    const alive = await prisma.spPartner.count({ where: { id: krOrgId } });
    expect(alive, '조직 보존').toBe(1);
    F(
      'J5',
      'obs',
      `조직 삭제 가드 — HTTP 409 PARTNER_HAS_PCB_DOCS(선제 안내, P2003 500 결함 교정 확인). ` +
        `여정 관례상 afterAll 시점엔 문서가 남아 삭제 경로가 성립하지 않으므로 ${KR_ORG_NAME} 은 상설 유지.`,
    );
    void od2;
    void od3;
  }, 60_000);

  test('J6. [직송 완료] 실행(정책 확정 08-10) — 운송장 없이 완료 종결 + 고객 카드 숨김(#4)', async (ctx) => {
    if (od1 === null) return ctx.skip();
    // 직송 ①(CN→CN)은 J3 에서 입고확인(직송 도착)까지 갔고 od 는 아직 배송 전 —
    // 진행 카드가 떠야 하고, 어휘는 '직송 배송 완료'(자사 입고 어휘 아님)여야 한다.
    await rp.view(customer, `/shop/orderinquiryview.php?od_id=${od1}`, 'J06-customer-direct-received');
    const before: string = await customer.page.evaluate(() => document.body.innerText);
    expect(before, '진행 카드 직송 어휘(#6)').toContain('직송 배송 완료');
    expect(before.includes('입고 완료 — 배송 준비 중'), '자사 입고 어휘 미노출(#6)').toBe(false);

    // ── [직송 완료] 실행 — 고객 배송 큐의 전용 종결 동선: 운송장 입력 없이 confirmDialog
    //    → 코어 PATCH force-status '완료' 재사용(신규 라우트 없음, 재고 앵커는 완료 진입
    //    차감이라 보존 — cleanup 은 '주문' 복귀로 복원, 구 J6 의 '배송' 임의 전이를 대체).
    // 배송 필드 사전 스냅샷 — "운송장 없이"의 판정은 절대값이 아니라 **불변**이다
    // (od_delivery_company 컬럼 기본값이 '0'인 레거시 스키마 — 빈 문자열 가정 금지).
    const beforeQ = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(od1)}&page=1&pageSize=5`,
    );
    const beforeRow = (beforeQ.json?.data?.items ?? []).find((r: any) => r.odId === od1);
    expect(beforeRow, '직송 완료 전 — to_ship 큐 재확인').toBeTruthy();
    await rp.view(adminView, '/app/admin/pcb/shipments', 'J06-direct-complete-queue');
    const rowLoc = adminView.page.locator('tr', { hasText: od1 }).first();
    await rowLoc.getByRole('button', { name: '직송 완료' }).click();
    const dialog = adminView.page.locator('[role="alertdialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const dialogText: string = await dialog.innerText();
    expect(dialogText, '직송 완료 확인 문구(현지 수령 안내)').toContain('현지(CN)에서 수령');
    expect(dialogText, '완료 종결 안내').toContain('완료로 종결');
    await rp.shot(adminView, 'J06-direct-complete-confirm');
    await dialog.getByRole('button', { name: '확인' }).click();

    // od 종결 폴링 — 완료 도달 + 운송장 없이(택배사·송장 빈 값) 닫혔는지까지 본다.
    let odRow: any = null;
    for (let i = 0; i < 20; i += 1) {
      const q = await api(
        A,
        'GET',
        `/api/admin/pcb-orders?tab=all&q=${encodeURIComponent(od1)}&page=1&pageSize=5`,
      );
      odRow = (q.json?.data?.items ?? []).find((r: any) => r.odId === od1);
      if (odRow?.odStatus === '완료') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(odRow?.odStatus, '[직송 완료] → od 완료 종결').toBe('완료');
    expect(String(odRow?.deliveryCompany ?? ''), '운송장 없이 종결(택배사 불변)').toBe(
      String(beforeRow?.deliveryCompany ?? ''),
    );
    expect(String(odRow?.invoiceNo ?? ''), '운송장 없이 종결(송장 빈 값 유지)').toBe(
      String(beforeRow?.invoiceNo ?? ''),
    );
    expect(String(odRow?.invoiceNo ?? ''), '송장번호 미기록').toBe('');

    // 완료 전이 후에는 코어 배송정보가 정본 — 진행 카드 자체가 사라져야 한다(#4 —
    // 배송·완료·취소 동일 규칙).
    await rp.view(customer, `/shop/orderinquiryview.php?od_id=${od1}`, 'J06-customer-card-hidden');
    const after: string = await customer.page.evaluate(() => document.body.innerText);
    expect(after.includes('제작 진행 상황'), '완료 이후 진행 카드 숨김(#4)').toBe(false);
    F(
      'J6',
      'obs',
      `[직송 완료] 실행 — od=${od1} 운송장 없이 완료 종결(확인 문구·완료 도달·카드 숨김 관찰)`,
    );
  }, 180_000);
});
