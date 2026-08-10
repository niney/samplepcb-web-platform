// 5호 완주 여정 — A/S 재발주 회차: 완료된 원주문(해외 거버) 위에 케이스를 접수하고
// 협력2 수락 → 재발주 진행(회차 채번+원발주 조건 복사) → 회차 EQ·생산 → 회차 발송이
// **원발주 선적과 분리된 새 박스**(contextKey 회차 편입)로 나가는 것까지 잇는다.
// (docs/PCB_PARTNER_TRACK.md §9 P4.12 — "남은 것=여정 5호"의 그 완주.)
//
// 원주문 구간(R1a~R1c)은 여정 1호(journey-gerber-rfq)의 경로를 축약 재사용한다 —
// 탐색 어서션(기본값 회귀·게이트 재검·EQ 고객확인 등)은 1호 몫이라 생략하고 흐름만.
// A/S 는 완료 건 재생산이 전형이라 force-status 로 주문을 '완료'까지 올린 뒤 연다.
// 회차 발송은 requested→shipped 한 칸에서 멈춘다 — 전 구간은 원주문이 이미 걸었고,
// 이 여정의 목적은 **회차 축 분리**(케이스·발주·발송이 원주문과 섞이지 않는 것)다.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:as  (PORTAL_E2E=1 + JOURNEY=1)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(8040) + e2e/.env.e2e 고객 자격.
// **생성물은 정리하지 않는다** — 대장(ledger) 기록 후 cleanup-probe.mts(스펙 축 훑기).
// A/S 케이스는 스펙 FK cascade 로 스펙과 함께 소멸한다(첨부는 이 여정에선 안 만든다 —
// 만들었다면 sp_file refType 'sp_pcb_as_case' 로 확인·정리).
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

describe.skipIf(!RUN || !JOURNEY)('여정 5호 — A/S 재발주 회차 완주(탐색 주행)', () => {
  const rp = createJourneyReport('findings-as', '여정 5호 A/S 재발주 회차 탐색 주행 리포트');
  const { F, ledger, view } = rp;

  let customer: PhpLoginResult; // 실로그인(PHP+거버 — 원주문 구간)
  let adminView: E2eSession; // 관리자 화면 관찰용(스텁)
  let partnerView: E2eSession; // 파트너 화면 관찰용(스텁 협력2)
  let partner2: PartnerFixture; // 협력2(CN·USD) — 협력1 은 실데이터라 읽기 전용(쓰기 시드 금지)
  let A = ''; // 관리자 API 토큰
  let P = ''; // 협력2 API 토큰

  // 여정 상태 — 앞 단계가 만들면 뒷 단계가 쓴다(실패 시 ctx.skip)
  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let originPoId: number | null = null; // 원발주(round 0)
  let originShipmentId: string | null = null; // 원발주 발송 — R6 분리 검증의 비교 축
  let caseId: number | null = null; // A/S 케이스
  let roundPoId: number | null = null; // 회차 발주(round 1)

  // multipart 업로드(EQ 파일·선적 Invoice) — File 은 Node 20+ 글로벌
  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileField: string,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set(fileField, new File([bytes], fileName, { type: contentType }));
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

  /** EQ 파일 2종 → 승인요청(협력2) → 승인(관리자) → 생산 시작·완료. 원주문(round 0)과
   *  회차(round 1)가 같은 손놀림이라 공용화한다 — 갈라지면 한쪽만 고쳐진다(journey.ts 관례). */
  const runEqToProduced = async (spec: number, poId: number, tag: string): Promise<void> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // 최소 zip 헤더(더미)
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        'file',
        `${fileType}-${tag}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${tag} ${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req.status, `${tag} 승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec)}/pos/${String(poId)}/eq-approve`,
      {},
    );
    expect(ap.status, `${tag} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {});
    expect(st.status, `${tag} 생산 시작: ${JSON.stringify(st.json)}`).toBe(200);
    const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {});
    expect(done.status, `${tag} 생산 완료: ${JSON.stringify(done.json)}`).toBe(200);
  };

  /** 국제 requested 는 Invoice 첨부 필수 — 최소 PDF 를 invoice 슬롯에 업로드 */
  const uploadInvoice = async (poId: number, fileName: string): Promise<void> => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/shipment/files`,
      { fileType: 'invoice' },
      'file',
      fileName,
      pdf,
      'application/pdf',
    );
    expect(up.status, `invoice 첨부(${fileName}): ${JSON.stringify(up.json)}`).toBe(200);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds(); // 없으면 안내 throw

    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('R1a. 원주문 압축 — 거버 제출 → RFQ 발송 → 협력2 회신 → 선정+확정가', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정5] A/S 회차 — 확인 후 정리',
      prefix: 'R01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — A/S 여정 원주문)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId =
      (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner2.id))?.rfqId ??
      null;
    expect(rfqId, 'RFQ 행 생성').not.toBeNull();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → 협력2)`);

    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 300,
      quotedDeliveryDate: '2026-08-20',
      memo: '[여정5] 협력2 회신',
    });
    expect(reply.status, `협력2 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    // 환율 생략 = 당일 캐시 자동 — 미준비 로컬이면 400, 그때만 명시 환율 폴백(1호 S5 관례).
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 60_000 },
    );
    if (sel.status === 400) {
      F('R1', 'obs', `당일 환율 캐시 없음 — 명시 환율 폴백: ${JSON.stringify(sel.json)}`);
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 60_000 },
      );
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 240_000);

  test('R1b. 원주문 압축 — 주문 → 입금 → 발주(round 0)', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'R1b',
      prefix: 'R01',
      buyerName: 'e2e여정고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId,
    });
    expect(issue.status, `발주: ${JSON.stringify(issue.json)}`).toBe(200);
    originPoId =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner2.id))?.poId ??
      null;
    expect(originPoId, '원발주(round 0)').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(originPoId)} (협력2 — 원발주 round 0)`);
  }, 240_000);

  test('R1c. 원주문 압축 — EQ·생산 → 국제 발송 완주 → 입고 → 주문 완료', async (ctx) => {
    if (specId === null || originPoId === null || odId === null) return ctx.skip();
    await runEqToProduced(specId, originPoId, 'r0');

    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: originPoId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    await uploadInvoice(originPoId, 'invoice-as-origin.pdf');

    // 선적요청(협력2: 출고예정일) → 이후 단계는 관리자 만능 대행으로 소진(1호 S11 관례)
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(originPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(originPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'JRN5-R0-0810', trackingUrl: null },
      );
      if (adv.status !== 200) {
        expect(adv.json?.error, `발송 체인 중단: ${JSON.stringify(adv.json)}`).toBe('ALREADY_FINAL');
        break;
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(originPoId)}/shipment/receive`,
      { note: '[여정5] 원주문 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    // 원발주 발송 id 박제 — R6(회차 발송 분리)의 비교 축.
    const prisma = getPrisma();
    const link = await prisma.spPcbShipmentPo.findUnique({
      where: { poId: BigInt(originPoId) },
    });
    expect(link, '원발주 선적 멤버십').toBeTruthy();
    originShipmentId = String(link.shipmentId);
    ledger.push(`sp_pcb_shipment #${originShipmentId} (원발주 국제 발송 — done·received)`);

    // A/S 는 완료 건 재생산이 전형 — force-status 로 '완료'까지(임의 전이, 재고 앵커:
    // 정리 시 '주문'으로 되돌려 재고 복원 — cleanup-probe 가 밟는 경로).
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(fin.status, `완료 전이: ${JSON.stringify(fin.json)}`).toBe(200);
    F(
      'R1',
      'obs',
      `원주문 완주 — od=${odId} spec=${String(specId)} po=${String(originPoId)} (완료 상태에서 A/S 개시)`,
    );
  }, 240_000);

  test('R2. 관리자: A/S 후보 확인 → 케이스 접수(불량=무상 기본) → 포털 노출', async (ctx) => {
    if (specId === null || originPoId === null) return ctx.skip();
    const cand = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/as-candidates`);
    expect(cand.status, JSON.stringify(cand.json)).toBe(200);
    const c2 = (cand.json?.data?.candidates ?? []).find(
      (c: any) => c.partnerId === num(partner2.id),
    );
    expect(c2, '후보=협력2(원발주 보유)').toBeTruthy();
    expect(c2?.poId, '후보의 근거 발주 = round 0').toBe(originPoId);
    expect(c2?.parentPartnerId, '직거래 트랙').toBe(0);

    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(partner2.id),
      caseType: 'product_defect',
      description: '[여정5] 모서리 들뜸 불량 — 재생산 요청',
    });
    expect(create.status, `케이스 생성: ${JSON.stringify(create.json)}`).toBe(200);
    expect(create.json?.data?.asCase?.chargeType, '불량=무상 기본').toBe('free');
    expect(create.json?.data?.asCase?.status, '초안 시작').toBe('draft');
    caseId = create.json?.data?.asCase?.id ?? null;
    ledger.push(
      `sp_pcb_as_case #${String(caseId)} (spec ${String(specId)} → 협력2 — 스펙 FK cascade 소멸)`,
    );

    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/submit`, {});
    expect(submit.status, `접수: ${JSON.stringify(submit.json)}`).toBe(200);
    expect(submit.json?.data?.asCase?.status, '접수 상태').toBe('submitted');

    const plist = await api(P, 'GET', '/api/partner/pcb-as-cases');
    expect(plist.status, JSON.stringify(plist.json)).toBe(200);
    const mine = (plist.json?.data?.cases ?? []).find((c: any) => c.id === caseId);
    expect(mine?.status, '포털 목록 노출(submitted)').toBe('submitted');
  });

  test('R3. 협력2: 재생산 가능 회신(수락)', async (ctx) => {
    if (caseId === null) return ctx.skip();
    const accept = await api(P, 'POST', `/api/partner/pcb-as-cases/${String(caseId)}/accept`, {
      reason: '[여정5] 재생산 가능 — 무상 조건 수락',
    });
    expect(accept.status, `수락: ${JSON.stringify(accept.json)}`).toBe(200);
    expect(accept.json?.data?.asCase?.status, '수락 상태').toBe('accepted');
  });

  test('R4. 관리자: 재발주 진행 → 회차 발주 검증(조건 복사·EQ 초기화·납기 비움)', async (ctx) => {
    if (caseId === null || originPoId === null) return ctx.skip();
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/proceed`, {});
    expect(proceed.status, `진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    expect(proceed.json?.data?.reorderRound, '1차 회차 채번').toBe(1);
    roundPoId = proceed.json?.data?.poId ?? null;
    expect(roundPoId, 'proceed 응답 poId(딥링크)').not.toBeNull();
    expect(proceed.json?.data?.asCase?.status, '진행 종결').toBe('proceeded');
    ledger.push(`sp_pcb_po #${String(roundPoId)} (협력2 — A/S 1차 회차 발주)`);

    const prisma = getPrisma();
    const [origin, round] = await Promise.all([
      prisma.spPcbPo.findUnique({ where: { id: BigInt(originPoId) } }),
      prisma.spPcbPo.findUnique({ where: { id: BigInt(roundPoId ?? 0) } }),
    ]);
    expect(round?.reorderRound, '회차 1').toBe(1);
    expect(round?.status, '회차 발주 issued').toBe('issued');
    expect(String(round?.currency), '통화 원발주 동일').toBe(String(origin?.currency));
    expect(Number(round?.priceOriginal), '가격 원발주 동일').toBe(Number(origin?.priceOriginal));
    expect(round?.deliveryDate, '납기 비움(레거시 stale 교정)').toBeNull();
    expect(JSON.stringify(round?.eqHistory), 'EQ 이력 초기화').toBe('[]');
    F(
      'R4',
      'obs',
      `회차 발주 #${String(roundPoId)} — round 1·issued·${String(round?.currency)} ` +
        `${String(round?.priceOriginal)} 복사·납기 null`,
    );
  });

  test('R5. 회차 생산: EQ 완주 → 생산 완료', async (ctx) => {
    if (specId === null || roundPoId === null) return ctx.skip();
    await runEqToProduced(specId, roundPoId, 'r1');
  }, 120_000);

  test('R6. 회차 발송: 원발주와 분리된 새 박스 → Invoice → 선적요청 → 선적', async (ctx) => {
    if (specId === null || roundPoId === null || originShipmentId === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: roundPoId });
    expect(box.status, `회차 담기: ${JSON.stringify(box.json)}`).toBe(200);

    // 회차 분리 검증 — contextKey 에 회차(:r1)가 들어가므로 같은 받는측(관리자행)이어도
    // 원발주 박스와 합류하지 않고 새 발송이 생겨야 한다(발송 2건 + 서로 다른 id).
    const prisma = getPrisma();
    const link = await prisma.spPcbShipmentPo.findUnique({ where: { poId: BigInt(roundPoId) } });
    expect(link, '회차 발주 선적 멤버십').toBeTruthy();
    const roundShipmentId = String(link.shipmentId);
    expect(roundShipmentId, '원발주 발송과 다른 박스').not.toBe(originShipmentId);
    const shipCount = await prisma.spPcbShipment.count({ where: { specId: BigInt(specId) } });
    expect(shipCount, '스펙의 발송 2건(원주문+회차)').toBe(2);
    ledger.push(`sp_pcb_shipment #${roundShipmentId} (A/S 1차 — 원발주 #${originShipmentId} 와 분리)`);
    F(
      'R6',
      'obs',
      `회차 발송 분리 — shipment #${roundShipmentId} ≠ 원발주 #${originShipmentId} (contextKey r1 편입)`,
    );

    await uploadInvoice(roundPoId, 'invoice-as-round1.pdf');
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(roundPoId)}/shipment/advance`, {
      shipDate: '2026-08-14',
    });
    expect(reqd.status, `회차 선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);

    // requested→shipped 한 칸만 — shipped 진입 주체는 관리자(A 토큰, NOT_YOUR_TURN 함정).
    // 전 구간 완주는 원주문(R1c)이 이미 걸었다 — 여기 목적은 회차 축 분리다.
    const shipped = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(roundPoId)}/shipment/advance`,
      { carrier: 'DHL', trackingNumber: 'JRN5-R1-0810', trackingUrl: null },
    );
    expect(shipped.status, `회차 선적 전이: ${JSON.stringify(shipped.json)}`).toBe(200);

    const [ship1, ship2] = await Promise.all([
      prisma.spPcbShipment.findUnique({ where: { id: BigInt(originShipmentId) } }),
      prisma.spPcbShipment.findUnique({ where: { id: BigInt(roundShipmentId) } }),
    ]);
    expect(ship2?.status, '회차 발송 shipped 도달').toBe('shipped');
    expect(ship1?.status, '원발주 발송 최종 상태 유지(회차 전이 무간섭)').toBe('done');
  }, 120_000);

  test('R7. 화면 실측: 관리자 Case A/S 패널·포털 회차 발주 배지', async (ctx) => {
    if (specId === null || roundPoId === null) return ctx.skip();
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'R07-admin-case-as-panel');
    const adminBody: string = await adminView.page.evaluate(() => document.body.innerText);
    if (/A\/S\s*재발주/.test(adminBody)) {
      F('R7', 'obs', '관리자 Case 상세에 A/S 재발주 패널 노출 확인');
    } else {
      F('R7', 'ux', '관리자 Case 상세에서 A/S 재발주 패널 텍스트 미검출 — 스크린샷 확인 필요');
    }

    await view(
      partnerView,
      `/app/partner/pcb/pos/${String(roundPoId)}`,
      'R07-partner-round-po-as-badge',
    );
    const partnerBody: string = await partnerView.page.evaluate(() => document.body.innerText);
    if (/A\/S\s*1차/.test(partnerBody)) {
      F('R7', 'obs', '포털 회차 발주 상세에 A/S 1차 배지 노출 확인');
    } else {
      F('R7', 'ux', '포털 회차 발주 상세에서 A/S 1차 배지 미검출 — 스크린샷 확인 필요');
    }
    F(
      'R7',
      'obs',
      `완주 도달 — case=${String(caseId)} roundPo=${String(roundPoId)} (회차 선적 shipped 에서 종료)`,
    );
  });
});
