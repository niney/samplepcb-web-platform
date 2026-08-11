// 여정 12호 — **관리자 대행 완주(포털 없는 협력사)**.
//
// 앞의 열한 편은 전부 협력사 토큰으로 포털을 두드렸다. 그런데 실무 협력사 상당수는
// **포털 계정이 없다** — 메일과 전화로 일한다. 그래서 D11 이 "관리자 만능 대행"
// (EQ·생산·선적을 관리자가 대신 민다)을 두었고, 재점검 #15 가 무계정 조직에 **대행
// 안내 메일**(포털 버튼을 실행 가능한 안내로 치환)을 붙였다. 대행만으로 **전 구간을
// 완주한 여정은 하나도 없었다** — 이 편이 그 빈칸이다.
//
// 협력사는 상설 픽스처 `e2e한국협력`(#9, KR/KRW, **연결 계정 0**). 계정이 없으니
// 협력사 토큰 자체를 만들 수 없다(getPartner().mbId === null 이 전제이자 첫 어서션).
// 전 구간을 관리자(A) 토큰으로만 민다:
//   RFQ 대리 회신(PUT admin .../rfqs/:id/reply) → EQ 파일 대행 업로드(admin .../eq-files)
//   → eq-request·production-start·production-complete 대행 전이 → 선적 담기·전이 대행
//   → 입고 확인까지.
//
// 이 여정의 **증거**는 둘이다(둘 다 DB 실측):
//   ① 대행 업로드의 `sp_file.uploadedBy = 'ADMIN'`
//   ② 대행 전이의 `sp_pcb_po.eqHistory[].byRole = 'ADMIN'` — 전 회차에 PARTNER 가 없다
// 그리고 **메일 대조**가 셋째 축이다: 무계정 조직엔 포털 버튼 대신 대행 안내(+문의처)가
// 가야 하고, 계정 있는 협력2 는 버튼을 유지해야 한다 — 같은 순간·같은 메일 종류로 나란히
// 세워야 "판정이 조직마다 갈린다"가 증명된다(발주서 도착 메일 2통 동시 발사).
//
// 국내(KR→KR) 3단계라 종점은 `RECEIVE_REQUIRED` 규칙을 지난다(2호와 같은 물류 골격,
// 다른 점은 **미는 손이 관리자 하나뿐**이라는 것). 포털은 한 번도 열지 않는다 — 계정이
// 없다는 것이 이 여정의 전제다.
//
// 단계(P1~P8)와 산출물 접두사는 같은 글자를 쓴다 — 스크린샷은 여정 공용 폴더
// (e2e/output/journey)에 쌓이므로 접두사가 겹치면 다른 편의 캡처를 덮어쓴다(X 는
// 11호가 쓴다). 이 편은 P 를 전용으로 쓴다.
//
// 실행: pnpm -F e2e journey:proxy  (PORTAL_E2E=1 + JOURNEY=1 — 거버·Mailpit 필요)
// 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts). **조직은 상설이라 지우지 않는다.**
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
  mailpitDelete,
  mailpitMessage,
  mailpitSearch,
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
/** 이 여정의 주인공 — 상설 픽스처(KR/KRW·연결 계정 없음, 여정 6호가 세웠다). */
const PROXY_ORG = 'e2e한국협력';
/** 대조군 — 연결 계정이 있는 조직(같은 메일 종류에서 포털 버튼이 유지돼야 한다). */
const CONTROL_ORG = '협력2';

/** 무계정 대행 안내 박스의 표식(pcb-rfq-email.ts proxyNoticeBox 의 공통 어미). */
const PROXY_MARK = '담당자가 대행합니다';
/** 대행 안내의 문의처 — g5_shop_default de_admin_info_email(getShopEstimateProfile). */
const INQUIRY_EMAIL = 'info@samplepcb.co.kr';

describe.skipIf(!RUN || !JOURNEY)('여정 12호 — 관리자 대행 완주(포털 없는 협력사)', () => {
  const rp = createJourneyReport('findings-admin-proxy', '여정 12호 관리자 대행 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let org: PartnerFixture; // e2e한국협력(무계정)
  let control: PartnerFixture; // 협력2(계정 있음)
  let proxyEmail = ''; // 무계정 조직의 알림 수신처 — Mailpit 검색 키
  let controlEmail = ''; // 대조군 수신처
  let A = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let controlPoId: number | null = null;
  let shipmentId: bigint | null = null;

  /** 이번 주행 시작 시각 — Mailpit 은 다른 주행분이 섞이므로 이 이후만 보고, 이후만 지운다. */
  let runStartedMs = 0;
  const seenMailIds = new Set<string>();

  // multipart 업로드(EQ 파일 대행) — File 은 Node 20+ 글로벌.
  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ status: number; json: any }> => {
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

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  // ── Mailpit — 같은 제목의 지난 주행분과 구분하려면 기준선(baseline)이 필요하다 ──
  const mailQuery = (to: string, subject: string): string => `to:"${to}" subject:"${subject}"`;
  const mailBaseline = async (to: string, subject: string): Promise<string | null> =>
    (await mailpitSearch(mailQuery(to, subject)))?.messages?.[0]?.ID ?? null;
  const waitMail = async (
    to: string,
    subject: string,
    baseline: string | null,
  ): Promise<{ ID: string; Subject: string; HTML: string } | null> => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const found = (await mailpitSearch(mailQuery(to, subject)))?.messages?.[0] ?? null;
      if (found !== null && found.ID !== baseline) {
        seenMailIds.add(String(found.ID));
        const body = await mailpitMessage(String(found.ID));
        return { ID: String(found.ID), Subject: String(body?.Subject ?? ''), HTML: String(body?.HTML ?? '') };
      }
    }
    return null;
  };

  /** 무계정 조직이 받아야 할 형태 — 대행 안내 + 문의처 mailto, 포털 링크 전무. */
  const expectProxyNotice = (html: string, label: string): void => {
    expect(html, `${label} — 대행 안내 문구`).toContain(PROXY_MARK);
    expect(html, `${label} — 문의처 mailto`).toContain(`mailto:${INQUIRY_EMAIL}`);
    // 포털 URL 이 하나라도 남아 있으면 "열어도 로그인에서 막히는 CTA"가 그대로다.
    expect(html.includes('/app/partner'), `${label} — 포털 링크 소거`).toBe(false);
  };

  const eqHistoryOf = async (id: number): Promise<any[]> => {
    const row = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(id) } });
    return Array.isArray(row?.eqHistory) ? row.eqHistory : [];
  };

  /** 고객 주문 상세의 '제작 진행 상황' 카드 문구 — 대행 진행을 고객이 그대로 따라오는지. */
  const customerProgressText = async (name: string): Promise<string> => {
    await rp.view(customer, `/shop/orderinquiryview.php?od_id=${odId ?? ''}`, name);
    return customer.page.evaluate(() => document.body.innerText);
  };

  const bodyTextOf = async (s: E2eSession): Promise<string> =>
    (await s.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    runStartedMs = Date.now();

    org = await getPartner(PROXY_ORG);
    control = await getPartner(CONTROL_ORG);
    proxyEmail = org.contactEmail ?? '';
    controlEmail = control.contactEmail ?? '';
    // 메일 대조가 이 여정의 축 하나라, 수신처가 비면 검증 자체가 성립하지 않는다.
    if (proxyEmail === '' || controlEmail === '') {
      throw new Error(
        `협력사 contactEmail 이 비어 있습니다 — ${PROXY_ORG}="${proxyEmail}" ${CONTROL_ORG}="${controlEmail}"`,
      );
    }
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    // 조직(#9)은 상설 픽스처 — 삭제하지 않는다. 문서 생성물만 대장으로 남긴다.
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('P1. 전제(계정 0) → 고객 거버 제출 → 무계정 조직에 RFQ 배정 → **관리자 대리 회신**', async () => {
    // ── 전제 — 이 조직엔 연결 계정이 없다. 협력사 토큰을 만들 방법 자체가 없으므로
    //    이후 전 구간이 관리자 토큰 하나로 흘러야 한다(그게 이 여정의 정의다).
    expect(org.country, `${PROXY_ORG} 국가(국내 경로 전제)`).toBe('KR');
    expect(org.mbId, `${PROXY_ORG} 연결 계정 없음(포털 토큰 불가)`).toBeNull();
    const prisma = getPrisma();
    const members = await prisma.spPartnerMember.count({ where: { partnerId: org.id } });
    expect(members, 'sp_partner_member 0건 — 대행 판정(resolvePcbPortalCta)의 입력').toBe(0);
    expect(control.mbId, `${CONTROL_ORG} 연결 계정 있음(대조군 전제)`).not.toBeNull();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 12호] 관리자 대행 완주 — 확인 후 정리 예정',
      prefix: 'P01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    // ── RFQ 배정 — 무계정 조직에도 견적요청은 나간다(정보 가치가 있다).
    const rfqBase = await mailBaseline(proxyEmail, 'PCB 견적요청');
    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(org.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(org.id));
    expect(row, 'RFQ 행 생성').toBeTruthy();
    rfqId = row.rfqId;
    expect(row.currency, '배정 박제 통화(KR 조직)').toBe('KRW');
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${PROXY_ORG})`);

    // ── 메일 ⓪(보너스 대조) — 견적요청만은 **무계정이어도 포털 안내가 아니다**.
    //    매직링크는 로그인 없이 실행되는 CTA 라 대행 치환 대상이 아니기 때문이다
    //    (admin-pcb-rfqs.ts: token 이 있으면 resolvePcbPortalCta 를 아예 안 부른다).
    const rfqMail = await waitMail(proxyEmail, 'PCB 견적요청', rfqBase);
    if (rfqMail === null) {
      F('P1', 'bug', '견적요청 메일 미수신(Mailpit) — 무계정 조직 발송 경로 확인 필요');
    } else {
      expect(rfqMail.HTML, '매직링크 CTA 유지').toContain('가입 없이 바로 회신하기');
      expect(rfqMail.HTML, '매직링크 URL').toContain('/app/pcb-rfq-reply/');
      expect(rfqMail.HTML.includes(PROXY_MARK), '매직링크가 있으면 대행 치환 안 함').toBe(false);
      F('P1', 'obs', '견적요청 메일 — 무계정이어도 매직링크(로그인 불필요 CTA)는 그대로 유지');
    }

    // ── 대리 회신 — 포털이 없으니 관리자가 협력사 자리에서 회신을 대신 넣는다.
    //    저장 경로는 포털·매직링크와 같은 코어(savePcbRfqReply)라 결과 형태가 같아야 한다.
    const reply = await api(
      A,
      'PUT',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/reply`,
      { price: 38_000, quotedDeliveryDate: '2026-08-21', memo: '[여정 12호] 전화 회신 대리 입력' },
    );
    expect(reply.status, `대리 회신: ${JSON.stringify(reply.json)}`).toBe(200);
    const saved = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId ?? 0) } });
    expect(saved?.status, '대리 회신 후 상태').toBe('quoted');
    expect(Number(saved?.priceOriginal ?? 0), '회신가 박제').toBe(38_000);
    expect(saved?.exchangeRate, 'KRW 는 환율 없음').toBeNull();
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'P01-case-proxy-replied');
    F('P1', 'obs', `대리 회신 완료 — rfq #${String(rfqId)} status=quoted ₩38,000(포털 미경유)`);
  }, 300_000);

  test('P2. 선정+확정가 → 주문 → 입금 → **발주 2장 동시 발행** → 발주서 메일 대조(무계정 ↔ 계정)', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    const prisma = getPrisma();

    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 55_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'P2',
      prefix: 'P02',
      buyerName: 'e2e대행고객',
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

    // ── 두 조직에 **같은 순간·같은 종류**의 메일을 쏜다. 대조가 성립하려면 프로젝트도
    //    시점도 같아야 한다 — 다르면 "조직 때문인지 상황 때문인지"를 못 가른다.
    const proxyBase = await mailBaseline(proxyEmail, 'PCB 발주서 도착');
    const ctrlBase = await mailBaseline(controlEmail, 'PCB 발주서 도착');

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(org.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(org.id));
    expect(po, '발주서 행').toBeTruthy();
    poId = po.poId;
    expect(Number(po.priceOriginal ?? 0), '발주가(대리 회신 프리필)').toBe(38_000);
    ledger.push(`sp_pcb_po #${String(poId)} (${PROXY_ORG} — 대행 트랙)`);

    // 대조군 발주서(협력2·USD) — 메일 대조가 끝나면 곧바로 취소한다(이 Case 의 진행에
    // 끼어들지 않게). 회신 견적이 없는 수동 발주라 환율이 필수다.
    const ctrlIssue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(control.id),
      priceOriginal: 30,
      exchangeRate: 1400,
    });
    expect(ctrlIssue.status, `대조군 발행: ${JSON.stringify(ctrlIssue.json)}`).toBe(200);
    controlPoId =
      (ctrlIssue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(control.id))?.poId ??
      null;
    expect(controlPoId, '대조군 발주서').not.toBeNull();

    // ── 메일 ① 발주서 도착 — 무계정: 대행 안내 / 계정 있음: 포털 버튼 유지 ──
    const proxyMail = await waitMail(proxyEmail, 'PCB 발주서 도착', proxyBase);
    expect(proxyMail, '무계정 조직 발주서 메일 수신').toBeTruthy();
    expectProxyNotice(proxyMail?.HTML ?? '', '발주서 도착(무계정)');
    expect(
      (proxyMail?.HTML ?? '').includes('파트너 포털에서 확인하기'),
      '무계정 — 포털 버튼 없음',
    ).toBe(false);
    expect(proxyMail?.HTML ?? '', '무계정 — 파일 전달 안내로 치환').toContain('샘플피씨비 담당자에게 전달');

    const ctrlMail = await waitMail(controlEmail, 'PCB 발주서 도착', ctrlBase);
    expect(ctrlMail, '대조군 발주서 메일 수신').toBeTruthy();
    expect(ctrlMail?.HTML ?? '', '대조군 — 포털 버튼 유지').toContain('파트너 포털에서 확인하기');
    expect((ctrlMail?.HTML ?? '').includes(PROXY_MARK), '대조군 — 대행 안내 없음').toBe(false);
    F(
      'P2',
      'obs',
      `발주서 도착 메일 대조 — ${PROXY_ORG}(계정0)=대행 안내+${INQUIRY_EMAIL} · ` +
        `${CONTROL_ORG}(계정1)=[파트너 포털에서 확인하기] 버튼 유지. 같은 건·같은 시점.`,
    );

    // 대조군 정리 — issued·하위/송금/발송 없음이라 발주 취소로 깨끗이 빠진다.
    const del = await api(
      A,
      'DELETE',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(controlPoId)}`,
    );
    expect(del.status, `대조군 발주 취소: ${JSON.stringify(del.json)}`).toBe(200);
    const ctrlLeft = await prisma.spPcbPo.count({ where: { id: BigInt(controlPoId ?? 0) } });
    expect(ctrlLeft, '대조군 발주서 잔재 0').toBe(0);
    controlPoId = null;
  }, 480_000);

  test('P3. EQ 대행 ① — 파일 대행 업로드(uploadedBy=ADMIN) + Case 대행 버튼 + 승인요청 대행(byRole=ADMIN)', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // 최소 zip 헤더(더미)

    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(A, `${base}/eq-files`, { fileType }, `${fileType}-proxy.zip`, bytes);
      expect(up.status, `${fileType} 대행 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    // ── 증거 ① — 협력사가 올린 것처럼 섞이면 대행 사실이 사라진다. 파일마다 ADMIN 이어야 한다.
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
      orderBy: { id: 'asc' },
    });
    expect(files.length, 'EQ 첨부 2건').toBe(2);
    expect(
      files.map((f: any) => `${String(f.fileType)}:${String(f.uploadedBy)}`),
      '대행 업로드 주체 박제',
    ).toEqual(['eq:ADMIN', 'working:ADMIN']);
    F('P3', 'obs', `대행 업로드 uploadedBy 실측 — ${files.map((f: any) => `${f.fileType}=${f.uploadedBy}`).join(' · ')}`);

    // ── P5 화면 — 발주접수(issued) 시점이 대행 버튼이 다 뜨는 유일한 순간이다.
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'P03-case-substitute-buttons');
    const caseBody = await bodyTextOf(adminView);
    expect(caseBody, 'Case — EQ 대행 업로드 버튼(eq)').toContain('⬆ eq');
    expect(caseBody, 'Case — EQ 대행 업로드 버튼(working)').toContain('⬆ working');
    expect(caseBody, 'Case — 전이 대행 버튼').toContain('EQ 요청 대행');
    expect(caseBody, 'Case — 대행 대상 조직 표기').toContain(PROXY_ORG);

    // ── 대행 전이 ①(협력사 몫) — 서버는 관리자를 막지 않되 이력에 ADMIN 을 남긴다.
    const req = await api(A, 'POST', `${base}/eq-request`, {});
    expect(req.status, `EQ 승인요청 대행: ${JSON.stringify(req.json)}`).toBe(200);
    const h1 = await eqHistoryOf(poId);
    expect(h1.at(-1)?.byRole, '승인요청 대행 주체').toBe('ADMIN');
    expect(h1.at(-1)?.fromStatus, '전이 시작').toBe('issued');
    expect(h1.at(-1)?.toStatus, '전이 도달').toBe('eq_requested');

    // 대행이라고 잠금이 느슨해지지는 않는다 — 승인요청 후 첨부 교체는 포털과 같은 규칙으로 막힌다.
    const locked = await apiForm(A, `${base}/eq-files`, { fileType: 'eq' }, 'eq-late.zip', bytes);
    expect(locked.status, `잠금 후 대행 업로드: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '대행에도 같은 잠금').toBe('EQ_LOCKED');

    // ── P6 고객 축 — 고객은 협력사가 누구인지·포털을 쓰는지 알 필요가 없다. 카드만 따라오면 된다.
    const progress1 = await customerProgressText('P03-customer-progress-eq');
    expect(progress1, '고객 진행 카드 — EQ').toContain('제조 확인(EQ) 진행 중');
    expect(progress1.includes(PROXY_ORG), '고객 화면에 협력사명 비노출').toBe(false);
  }, 180_000);

  test('P4. EQ 대행 ② — 승인(메일 대행 안내) → 생산 시작·완료 대행 + 발주·EQ 큐 화면', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    // 발주·EQ 워크큐(기본 탭 = EQ 승인 대기) — 대행 건도 관리자 차례로 정상 집계돼야 한다.
    await rp.view(adminView, '/app/admin/pcb/pos', 'P04-po-queue-eq-pending');
    const queue = await api(A, 'GET', '/api/admin/pcb-pos?tab=eq_pending&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const mine = (queue.json?.data?.items ?? []).find((i: any) => i.poId === poId);
    expect(mine, 'EQ 승인 대기 큐 진입').toBeTruthy();
    expect(mine?.partnerName, '큐 협력사명').toBe(PROXY_ORG);
    expect(mine?.adminTurn, '관리자 차례').toBe(true);

    // ── 메일 ② EQ 결정 — 무계정이면 "[생산 시작]을 포털에서" 가 아니라 "생산을 진행해 주세요".
    const eqBase = await mailBaseline(proxyEmail, 'PCB EQ 승인');
    const ap = await api(A, 'POST', `${base}/eq-approve`, {});
    expect(ap.status, `EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const eqMail = await waitMail(proxyEmail, 'PCB EQ 승인', eqBase);
    expect(eqMail, 'EQ 승인 메일 수신').toBeTruthy();
    expectProxyNotice(eqMail?.HTML ?? '', 'EQ 결정(무계정)');
    expect(eqMail?.HTML ?? '', '무계정 — 포털 문구 치환').toContain('생산을 진행해 주세요');
    expect((eqMail?.HTML ?? '').includes('발주서 바로 열기'), '무계정 — 발주 딥링크 버튼 없음').toBe(
      false,
    );

    const h2 = await eqHistoryOf(poId);
    expect(h2.at(-1)?.byRole, '승인 주체(관리자=ORDERER)').toBe('ADMIN');

    // 승인 직후 화면 — 다음 대행 버튼이 '생산 시작 대행'으로 바뀌어야 한다.
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'P04-case-production-substitute');
    expect(await bodyTextOf(adminView), 'Case — 생산 시작 대행 버튼').toContain('생산 시작 대행');

    // ── 대행 전이 ②③ — 생산 시작·완료. 협력사 자리를 관리자가 계속 민다.
    const start = await api(A, 'POST', `${base}/production-start`, {});
    expect(start.status, `생산 시작 대행: ${JSON.stringify(start.json)}`).toBe(200);
    const progressMid = await customerProgressText('P04-customer-progress-producing');
    expect(progressMid, '고객 진행 카드 — 생산').toContain('생산 진행 중');

    const done = await api(A, 'POST', `${base}/production-complete`, {});
    expect(done.status, `생산 완료 대행: ${JSON.stringify(done.json)}`).toBe(200);

    // ── 증거 ② — 회차 전체가 ADMIN 이다. PARTNER 가 한 칸이라도 섞이면 대행 완주가 아니다.
    const history = await eqHistoryOf(poId);
    expect(history.map((e: any) => `${String(e.fromStatus)}→${String(e.toStatus)}:${String(e.byRole)}`)).toEqual([
      'issued→eq_requested:ADMIN',
      'eq_requested→eq_done:ADMIN',
      'eq_done→producing:ADMIN',
      'producing→produced:ADMIN',
    ]);
    expect(
      history.some((e: any) => e.byRole !== 'ADMIN'),
      'EQ 이력에 협력사·MD 주체 없음',
    ).toBe(false);
    F(
      'P4',
      'obs',
      `EQ 이력 byRole 실측 — ${history.map((e: any) => `${String(e.toStatus)}:${String(e.byRole)}`).join(' · ')} (4/4 ADMIN)`,
    );

    const progress2 = await customerProgressText('P04-customer-progress-produced');
    expect(progress2, '고객 진행 카드 — 생산 완료').toContain('생산 완료 — 발송 준비 중');
  }, 240_000);

  test('P5. 선적 대행 — 담기 동선 관찰 → 배송 중 대행(국내 Invoice 불요) → 선적 차례 메일', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    // ── 담기(박스 확보) 동선 관찰 — 선적 큐는 "관리자는 Case 상세에서 대행할 수 있습니다"
    //    라고 안내한다. 그 안내가 가리키는 화면에 실제로 동선이 있는지 먼저 본다.
    await rp.view(adminView, '/app/admin/pcb/shipments', 'P05-ship-queue-to-ship');
    const shipQueueBody = await bodyTextOf(adminView);
    expect(shipQueueBody, '선적 큐 — 발송 대기 안내문').toContain('Case 상세에서 대행할 수 있습니다');
    // 모수는 API 로 확인한다 — 화면은 페이지네이션(20)이라 지난 주행 잔재가 많으면 밀린다.
    const toShip = await api(A, 'GET', '/api/admin/pcb-pos?tab=to_ship&page=1&pageSize=100');
    expect(
      (toShip.json?.data?.items ?? []).find((i: any) => i.poId === poId),
      '발송 대기(생산완료·미편성) 모수 진입',
    ).toBeTruthy();

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'P05-case-before-box');
    const caseBeforeBox = await bodyTextOf(adminView);
    expect(caseBeforeBox.includes('🚚 선적'), '발송 문서 전 — 선적 줄 없음').toBe(false);
    // ── 발송 시작(담기)을 **화면만으로** — 첫 주행이 박제한 결함을 닫은 자리다.
    //    계정 0 조직은 포털 [담기]를 누를 사람이 아예 없으므로, 관리자 Case 상세에 같은 일을
    //    하는 [발송 시작]이 있어야 한다(없으면 이 조직의 발송은 API 없이 영영 시작 불가).
    //    담기까지만 하고 멈추는 것이 정상이다 — 다음 단계의 필수값은 모드마다 다르고
    //    (국내=운송장 / 국제=출고예정일·Invoice), 그 모드는 담아 봐야 정해진다.
    const startBtn = adminView.page.getByRole('button', { name: '발송 시작' });
    expect(await startBtn.count(), 'Case 상세의 발송 시작 버튼').toBeGreaterThan(0);
    await startBtn.first().click();
    await adminView.page.getByRole('alertdialog').getByRole('button', { name: '확인' }).click();
    await adminView.page.getByText('🚚 선적').first().waitFor({ timeout: 15_000 });
    await rp.shot(adminView, 'P05-case-box-opened');
    const opened = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    expect(opened?.status, '화면 [발송 시작] — 박스만 열린다(전이는 아직)').toBe('preparing');
    expect(opened?.mode, '담기 시점에 모드가 정해진다(KR 조직 → 관리자 KR)').toBe('domestic');
    F(
      'P5',
      'obs',
      '발송 시작 대행 — Case 상세 [발송 시작] 1회로 박스 개설(preparing·domestic). ' +
        '포털 무접촉 · 협력사 [담기]와 같은 ensurePcbShipment 경로.',
    );

    // ── 전이 — 담긴 박스를 배송 중으로 민다.
    //    국내라 Invoice 첨부 없이 진행돼야 하고, 택배사·송장이 필수값이다.
    //    (기준선은 전이 **전에** 잡는다 — 이 조직엔 여정 6호가 보낸 같은 제목의 선적 메일이
    //     Mailpit 에 남아 있을 수 있어, 기준선 없이 최신 1통을 집으면 옛 메일을 잡는다.)
    const turnBase = await mailBaseline(proxyEmail, 'PCB 선적 진행');
    const adv = await api(A, 'POST', `${base}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber: 'KR-PROXY-0811',
    });
    expect(adv.status, `발송 대행(담기+배송 중): ${JSON.stringify(adv.json)}`).toBe(200);

    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    shipmentId = shipment?.id ?? null;
    expect(shipment?.mode, '국내 파생(KR 조직 → 관리자 KR)').toBe('domestic');
    expect(shipment?.receiverKind, '받는측').toBe('admin');
    expect(shipment?.status, '국내 체인 다음 단계').toBe('shipping');
    expect(shipment?.trackingNumber, '운송장 박제').toBe('KR-PROXY-0811');
    ledger.push(`sp_pcb_shipment #${String(shipmentId)} (po ${String(poId)} — domestic 대행)`);

    // 국내는 상업송장을 쓰지 않는다 — 대행이어도 같은 판정(첨부 없이 진행된 근거).
    const inv = await api(A, 'GET', `${base}/shipment/invoice`);
    expect(inv.status, `국내 상업송장 요청: ${JSON.stringify(inv.json)}`).toBe(409);
    expect(inv.json?.error, '국내 송장 미사용').toBe('DOMESTIC_INVOICE');
    const shipFiles = await prisma.spFile.count({
      where: { refType: 'sp_pcb_shipment', refId: shipmentId ?? 0n },
    });
    expect(shipFiles, '국내 발송 첨부 0건').toBe(0);

    // ── 메일 ③ 선적 차례 — 관리자 전이 통지가 무계정 조직엔 대행 안내로 간다.
    const turnMail = await waitMail(proxyEmail, 'PCB 선적 진행', turnBase);
    expect(turnMail, '선적 차례 메일 수신').toBeTruthy();
    expect(turnMail?.Subject ?? '', '선적 메일 제목(국내 단계 라벨)').toContain('배송 중');
    expectProxyNotice(turnMail?.HTML ?? '', '선적 차례(무계정)');
    expect((turnMail?.HTML ?? '').includes('파트너 포털 열기'), '무계정 — 포털 버튼 없음').toBe(false);

    const progress3 = await customerProgressText('P05-customer-progress-shipping');
    expect(progress3, '고객 진행 카드 — 운송').toContain('입고 운송 중');
    F('P5', 'obs', `선적 대행 — 담기+배송중 1회 호출(mode=domestic·Invoice 불요), 운송장 KR-PROXY-0811`);
  }, 240_000);

  test('P6. 입고 대행 — RECEIVE_REQUIRED 종점 규칙 → 입고 확인 → 입고 메일 → 큐·Case 화면', async (ctx) => {
    if (specId === null || poId === null || odId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    // 국내 종점은 [입고 확인] 하나로 닫힌다 — 전이만 따로 세우면 검수 시각이 비어
    // 다음 일(고객 배송 큐)이 안 열린다. 대행 트랙에서도 규칙은 같다.
    const advOnly = await api(A, 'POST', `${base}/shipment/advance`, {});
    expect(advOnly.status, `입고확인 없이 전이 시도: ${JSON.stringify(advOnly.json)}`).toBe(409);
    expect(advOnly.json?.error, '전이 거절 코드').toBe('RECEIVE_REQUIRED');

    const recvBase = await mailBaseline(proxyEmail, 'PCB 입고 확인');
    const recv = await api(A, 'POST', `${base}/shipment/receive`, {
      note: '[여정 12호] 대행 트랙 국내 입고',
    });
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const closed = await prisma.spPcbShipment.findFirst({ where: { id: shipmentId ?? 0n } });
    expect(closed?.status, '국내 체인 종점').toBe('delivered');
    expect(closed?.receivedAt, '검수 시각').not.toBeNull();

    // ── 메일 ④ 입고 확인 — 보내는측(무계정 조직)에게 대행 안내로.
    const recvMail = await waitMail(proxyEmail, 'PCB 입고 확인', recvBase);
    expect(recvMail, '입고 확인 메일 수신').toBeTruthy();
    expectProxyNotice(recvMail?.HTML ?? '', '입고 확인(무계정)');
    expect((recvMail?.HTML ?? '').includes('파트너 포털 열기'), '무계정 — 포털 버튼 없음').toBe(false);
    expect(recvMail?.HTML ?? '', '검수 메모 전달').toContain('대행 트랙 국내 입고');

    // 선적 큐 — 입고 완료 탭으로 넘어갔는지(대행 건이 큐에서 사라지지 않는지).
    const shipQueue = await api(A, 'GET', '/api/admin/pcb-shipments?tab=received&page=1&pageSize=100');
    expect(shipQueue.status, JSON.stringify(shipQueue.json)).toBe(200);
    const shipRow = (shipQueue.json?.data?.items ?? []).find(
      (i: any) => i.shipmentId === Number(shipmentId ?? 0n),
    );
    expect(shipRow, '입고 완료 탭 진입').toBeTruthy();
    expect(shipRow?.senderName, '보내는 조직').toBe(PROXY_ORG);
    await rp.view(adminView, '/app/admin/pcb/shipments', 'P06-ship-queue-received');

    // 고객 배송 큐 — 입고 신호가 잡혀야 다음(고객 발송)이 열린다. 직송이 아니므로 null.
    const orderQueue = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(odId)}&page=1&pageSize=20`,
    );
    const orderRow = (orderQueue.json?.data?.items ?? []).find((r: any) => r.odId === odId);
    expect(orderRow, '고객 배송 대기 큐 진입').toBeTruthy();
    expect(orderRow?.directShipCountry, '직송 아님').toBeNull();
    expect(Number(orderRow?.receivedPoCount ?? 0), '입고된 발주 수').toBe(1);

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'P06-case-received');
    const caseBody = await bodyTextOf(adminView);
    expect(caseBody, 'Case — 선적 줄(입고완료)').toContain('입고완료');
    expect(caseBody, 'Case — 국내 택배 표기').toContain('국내(택배)');

    const progress4 = await customerProgressText('P06-customer-progress-received');
    expect(progress4, '고객 진행 카드 — 입고').toContain('입고 완료 — 배송 준비 중');
    F(
      'P6',
      'obs',
      `입고 대행 — RECEIVE_REQUIRED 로 전이 단독 시도 거절(409) 후 [입고 확인] 1회로 종점 도달` +
        `(shipment #${String(shipmentId ?? 0n)} delivered·receivedAt 기록), 선적 큐 '입고 완료' 탭 진입 + ` +
        `고객 배송 큐(to_ship) 진입 — 대행 트랙도 종점 규칙이 같다.`,
    );
  }, 240_000);

  test('P7. 고객 축 완주 — 배송 → 완료 → 진행 카드 종료 + 주문내역 화면', async (ctx) => {
    if (odId === null) return ctx.skip();
    const prisma = getPrisma();

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: '우체국택배',
        invoiceNo: 'KR-PROXY-CUST-0811',
        invoiceTime: '2026-08-11 18:00:00',
      },
    });
    expect(ship.status, `배송 전이: ${JSON.stringify(ship.json)}`).toBe(200);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(fin.status, `완료 전이: ${JSON.stringify(fin.json)}`).toBe(200);

    // 배송·완료 이후엔 코어 배송정보가 정본 — 진행 카드는 사라진다(P4.13 규칙).
    const after = await customerProgressText('P07-customer-complete');
    expect(after.includes('제작 진행 상황'), '완료 이후 진행 카드 숨김').toBe(false);
    await rp.view(customer, '/shop/orderinquiry.php', 'P07-customer-order-list');

    const odRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(String(odRow[0]?.od_status ?? ''), '주문 종결').toBe('완료');
    expect(Number(odRow[0]?.od_misu ?? -1), '완주 후 미수금 0').toBe(0);
    F(
      'P7',
      'obs',
      `대행 완주 도달 — od=${odId} spec=${String(specId)} po=${String(poId)} (포털 무접촉·관리자 토큰 단일)`,
    );
  }, 180_000);

  test('P8. 대행 총괄 + Mailpit 정리(이번 주행분만)', async (ctx) => {
    if (poId === null) return ctx.skip();
    const prisma = getPrisma();

    // 총괄 — 이 여정이 남긴 대행 흔적을 한 번에 다시 읽는다(리포트에 그대로 실린다).
    const history = await eqHistoryOf(poId);
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
    });
    const adminSteps = history.filter((e: any) => e.byRole === 'ADMIN').length;
    expect(adminSteps, '대행 전이 4단계').toBe(4);
    expect(
      files.every((f: any) => f.uploadedBy === 'ADMIN'),
      '대행 업로드 전량 ADMIN',
    ).toBe(true);
    F(
      'P8',
      'obs',
      `대행 총괄 — EQ 전이 ${String(adminSteps)}/4 ADMIN · EQ 첨부 ${String(files.length)}건 전량 ADMIN · ` +
        `RFQ 대리 회신 1건 · 선적 담기·전이·입고 대행 3회(협력사 토큰 0회)`,
    );

    // ── Mailpit — 다른 주행분이 섞이므로 **이번 주행 시각 이후**의 두 수신자 메일만 지운다.
    const targets = [proxyEmail, controlEmail].filter((v) => v !== '');
    const doomed = new Set<string>(seenMailIds);
    for (const to of targets) {
      const found = (await mailpitSearch(`to:"${to}"`))?.messages ?? [];
      for (const m of found) {
        const created = new Date(String(m.Created ?? 0)).getTime();
        if (Number.isFinite(created) && created >= runStartedMs - 5_000) doomed.add(String(m.ID));
      }
    }
    await mailpitDelete([...doomed]);

    let leftover = 0;
    for (const to of targets) {
      const found = (await mailpitSearch(`to:"${to}"`))?.messages ?? [];
      leftover += found.filter(
        (m: any) => new Date(String(m.Created ?? 0)).getTime() >= runStartedMs - 5_000,
      ).length;
    }
    expect(leftover, '이번 주행 메일 잔재 0').toBe(0);
    F('P8', 'obs', `Mailpit 정리 — 이번 주행분 ${String(doomed.size)}통 삭제(다른 주행분 무접촉)`);
  }, 120_000);
});
