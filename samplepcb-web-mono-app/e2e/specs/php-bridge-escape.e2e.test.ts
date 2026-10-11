// sp-php 브리지 입력 이스케이프 — 고객이 친 글자가 **그대로** sp-node 원장에 닿는가.
//
// 그누보드 common.php 는 $_POST·$_GET 전체에 addslashes 를 건다(G5_ESCAPE_FUNCTION =
// sql_escape_string — g5 SQL 문자열 조립용 방어). 브리지(spcb/api/*.php)가 그 값을 sp-node 로
// 그대로 실어 보내면 `'`·`"`·`\` 앞에 백슬래시가 붙은 채 sp_ 원장에 저장되고, 관리자 화면·
// 알림 메일·협력사 전달문까지 그 모양으로 나간다. sp-node 는 Prisma 바인딩이라 그 방어가
// 필요 없다 — 브리지는 **원문**을 넘겨야 한다(extend/sp_pcb_eq.extend.php sp_bridge_text).
//
// 표적(자유 입력을 sp-node 로 넘기는 브리지 넷 전부 — 실 PHP 경유, 폼 필드 그대로):
//   ① eq-decide           note        → sp_pcb_eq_review.decisionNote        (D16 승인·반려)
//   ② eq-answer           comment[id] → sp_pcb_eq_review_item.answerComment  (D20 문항형)
//   ③ bom-confirm-answer  note        → sp_bom_confirm_request.customerNote  (D43 부품 확인)
//   ④ claim-create        description → sp_pcb_claim.description             (A/S 접수, multipart)
//   ⑤ 길이 검사가 군더더기 백슬래시를 세지 않는다 — `'` 한 글자는 2자 사유가 아니다.
//   ⑥ 화면 — 저장된 글이 주문 상세에 친 그대로 보인다.
//
// 넣는 글: 홑·겹따옴표, 백슬래시 한 개, `C:\temp\new`(글자 그대로의 `\t`·`\n` — 한 번 더
// 되돌리면 사라진다), LF·CRLF 줄바꿈(브라우저 폼은 textarea 줄바꿈을 CRLF 로 보낸다), 한글·이모지.
//
// 실측(고치기 전, 2026-10-11): ①③④ 는 `it\'s \"A\" \\ 끝` / `C:\\temp\\new …` 로 저장됐다(줄바꿈·
// 한글·이모지는 그대로). ② 는 브리지가 이미 stripslashes 를 걸어 깨끗했고, ⑤ 는 `'` 가 `\'` 2자로
// 세어져 반려가 성립했다. 주문 상세는 get_text 가 `\'` 만 `'` 로 되돌려 `it's \"A\" \\ 끝` 으로 보였다
// — 홑따옴표만 넣어 보면 고객 화면에서는 멀쩡해 보인다(원장에는 `\'` 가 남는다).
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run php-bridge-escape
// 사전: nginx(local-web) · API(3333) · PHP(8888) · e2e/.env.e2e 고객 자격. 파일서버·거버 불필요.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주+견적)로 통째로 세우고 지운다(실주문 무접촉).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  MAILPIT_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countCartRows,
  countPcbResidue,
  createG5OrderFixture,
  createOrderSpec,
  createPcbPo,
  deleteOrderHard,
  disconnectPrisma,
  getPartner,
  getPrisma,
  mailpitDelete,
  mailpitSearch,
  newPhpSession,
  num,
  requireCustomerCreds,
  signJwt,
  type G5OrderFixture,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const OWNER = '협력2'; // 수주 조직(발주서 주인) — 이 주행은 협력사 화면을 열지 않는다

interface Stage {
  order: G5OrderFixture;
  specId: bigint;
  poId: bigint;
}

describe.skipIf(!RUN)('sp-php 브리지 — 자유 입력이 addslashes 없이 sp-node 에 닿는다', () => {
  let owner: PartnerFixture;
  let customer: PhpLoginResult;
  let A = ''; // 관리자
  let C = ''; // 고객(주문자)
  let csrf = '';
  let mailpitUp = false;
  const startedAt = new Date();
  const token = `e2eesc${String(Date.now())}`; // Mailpit 검색·정리 키(공백 없는 한 낱말)

  const LINE1 = `it's "A" \\ 끝`; // 홑·겹따옴표 + 백슬래시 한 개
  const LINE2 = 'C:\\temp\\new — 한글·이모지 🙂'; // 글자 그대로의 \t·\n — 과되돌림 탐지
  const LINE3 = `셋째 줄 ${token}`;
  /** 1→2 는 LF, 2→3 은 CRLF(브라우저 폼이 보내는 모양). */
  const PROBE = `${LINE1}\n${LINE2}\r\n${LINE3}`;

  const orders: G5OrderFixture[] = [];
  const specIds: bigint[] = [];
  const poIds: bigint[] = [];
  let decide: Stage | undefined; // ① 문구형 회차
  let answer: Stage | undefined; // ② 문항형 회차
  let short: Stage | undefined; // ⑤ 짧은 사유
  let claim: Stage | undefined; // ④ 배송 완료 주문
  let bomOrder: G5OrderFixture | undefined; // ③
  let decideReviewId = 0;
  let shortReviewId = 0;
  let answerReviewId = 0;
  let answerItemId = 0;
  let bomQuoteId = 0n;
  let bomRequestId = 0n;
  let bomIssueId = 0n;

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** 주문+카트(+스펙+발주) 한 벌. od_id 가 Date.now() 기반이라 사이를 띄운다. */
  const makeOrder = async (label: string): Promise<G5OrderFixture> => {
    await sleep(5);
    const order = await createG5OrderFixture(customer.mbId, `e2e 브리지 ${label}`);
    orders.push(order);
    // 픽스처는 최신 실주문을 복사한다 — 수신처까지 따라오므로 비운다(알림이 남의 주소로 가지 않게).
    await getPrisma().$executeRawUnsafe(`UPDATE g5_shop_order SET od_email = '' WHERE od_id = ?`, order.odId);
    return order;
  };
  const makeStage = async (label: string, poStatus: string | null): Promise<Stage> => {
    const order = await makeOrder(label);
    const spec = await createOrderSpec({
      mbId: customer.mbId,
      ctId: order.ctId,
      projectName: `E2E-ESC-${token}-${label}.zip`,
      category: 'standard',
    });
    specIds.push(spec.id as bigint);
    let poId = 0n;
    if (poStatus !== null) {
      const po = await createPcbPo({ specId: spec.id as bigint, partnerId: owner.id, status: poStatus });
      poId = po.id as bigint;
      poIds.push(poId);
    }
    return { order, specId: spec.id as bigint, poId };
  };
  /** 문구형(D16) 확인 요청 — 실 관리자 경로로 만든다(가드·스키마 동반). */
  const makeMessageReview = async (stage: Stage): Promise<number> => {
    const created = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(stage.poId)}`, {
      message: `[E2E] 브리지 이스케이프 확인 (${token})`,
      sharedFileIds: [],
    });
    expect(created.status, `문구형 요청: ${JSON.stringify(created.json)}`).toBe(200);
    return num(created.json?.data?.reviews?.[0]?.id);
  };

  /** 브리지에 폼을 그대로 POST — 세션 쿠키는 로그인한 컨텍스트 것, 결과는 리다이렉트의 sp_msg·sp_tone. */
  const postBridge = async (
    name: string,
    body: { form?: Record<string, string>; multipart?: Record<string, string> },
  ): Promise<{ status: number; msg: string; tone: string }> => {
    const res = await customer.page.request.post(`${BASE_URL}/spcb/api/${name}`, { ...body, maxRedirects: 0 });
    const q = new URL(res.headers()['location'] ?? '', BASE_URL).searchParams;
    return { status: res.status(), msg: q.get('sp_msg') ?? '', tone: q.get('sp_tone') ?? '' };
  };
  /** 주문 상세를 **새 문서로** 열고 보이는 글자를 읽는다. */
  const orderText = async (odId: string): Promise<string> => {
    await customer.page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}&_t=${String(Date.now())}`, {
      waitUntil: 'networkidle',
    });
    return customer.page.evaluate(() => document.body.innerText);
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mailpitUp = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null))?.ok === true;

    const creds = requireCustomerCreds();
    owner = await getPartner(OWNER);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    const prisma = getPrisma();

    // ①⑤ 문구형 — 발주가 eq_requested 여야 요청이 열린다(생성 가드 NOT_EQ_REQUESTED).
    decide = await makeStage('decide', 'eq_requested');
    decideReviewId = await makeMessageReview(decide);
    short = await makeStage('short', 'eq_requested');
    shortReviewId = await makeMessageReview(short);

    // ② 문항형 — 초안 → 문항 1개(의견 필수 선택지 B) → 발송.
    answer = await makeStage('answer', 'eq_requested');
    const base = `/api/admin/pcb-eq-reviews/${String(answer.poId)}`;
    const draft = await api(A, 'POST', `${base}/drafts`, { sourceFileIds: [] });
    expect(draft.status, `초안: ${JSON.stringify(draft.json)}`).toBe(201);
    answerReviewId = Number(draft.json.data.review.id);
    const saved = await api(A, 'PUT', `${base}/${String(answerReviewId)}/draft`, {
      expectedVersion: 1,
      message: '',
      dueOn: '2099-12-31',
      items: [
        {
          factoryNo: '1',
          category: 'marking',
          question: `UL 마킹 위치를 알려 주세요. (${token})`,
          questionOrig: null,
          options: [
            { key: 'A', label: '제조사 제안대로', labelOrig: null, recommended: true, requiresComment: false },
            { key: 'B', label: '위치를 지정하겠습니다', labelOrig: null, recommended: false, requiresComment: true },
          ],
          figures: [],
          prevItemId: null,
          change: null,
        },
      ],
    });
    expect(saved.status, `저장: ${JSON.stringify(saved.json)}`).toBe(200);
    answerItemId = Number(saved.json.data.review.items[0].id);
    const sent = await api(A, 'POST', `${base}/${String(answerReviewId)}/send`, { expectedVersion: 2 });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);

    // ③ 부품 확인 요청 — 견적·요청·이슈를 직접 세운다(결제까지 태우는 여정 22호는 주문을 남긴다).
    //    선택지는 금액 변동 0(정산 원장이 생기지 않는다), 근거는 계약 BomConfirmEvidence 모양 그대로.
    bomOrder = await makeOrder('bom');
    const quote = await prisma.spBomQuote.create({
      data: { mbId: customer.mbId, title: `E2E-ESC-${token}-bom`, status: 'answered' },
    });
    bomQuoteId = quote.id as bigint;
    const option = (code: string, kind: string, title: string): Record<string, unknown> => ({
      code,
      kind,
      title,
      detail: null,
      priceDelta: 0,
      referenceDelta: null,
      replacement: null,
      moq: null,
      restock: null,
      price: null,
    });
    const request = await prisma.spBomConfirmRequest.create({
      data: {
        quoteId: bomQuoteId,
        mbId: customer.mbId,
        odId: bomOrder.odId,
        ctId: bomOrder.ctId,
        status: 'requested',
        message: `[E2E] 브리지 이스케이프 확인 (${token})`,
        requestedBy: 'e2e-admin',
        issues: {
          create: [
            {
              // 견적 행은 참조만(FK 없음) — 실견적 행과 겹치지 않는 값으로 둔다.
              quoteItemId: BigInt(`9${String(Date.now())}`),
              sortOrder: 0,
              issueType: 'quality_issue',
              status: 'pending',
              description: '[E2E] 외관 검사에서 변색이 보입니다.',
              evidence: {
                part: {
                  mpn: `E2E-ESC-${token}`,
                  manufacturerName: null,
                  description: null,
                  packageCode: null,
                  neededQty: 1,
                  orderQty: 1,
                  unitPriceKrw: null,
                  lineTotalKrw: null,
                  supplierLabel: null,
                  location: null,
                },
                observation: {
                  checkedAt: new Date().toISOString(),
                  sourceLabel: null,
                  stock: null,
                  moq: null,
                  leadTime: null,
                  note: null,
                  unitPriceKrw: null,
                },
              },
              options: [option('A', 'accept_as_is', '그대로 진행'), option('B', 'consult', '상담 요청')],
            },
          ],
        },
      },
      include: { issues: true },
    });
    bomRequestId = request.id as bigint;
    bomIssueId = request.issues[0].id as bigint;
    // 직삽입한 박제가 고객 DTO 로 직렬화되는지(모양이 틀리면 500) 먼저 확인한다.
    const listed = await api(C, 'GET', `/api/bom/confirms?odId=${bomOrder.odId}`);
    expect(listed.status, `부품 확인 조회: ${JSON.stringify(listed.json)}`).toBe(200);

    // ④ A/S — 접수는 배송·완료 주문만 받는다(NOT_DELIVERED). 픽스처 행만 완료로 바꾼다.
    claim = await makeStage('claim', null);
    await prisma.$executeRawUnsafe(`UPDATE g5_shop_order SET od_status = '완료' WHERE od_id = ?`, claim.order.odId);
    await prisma.$executeRawUnsafe(`UPDATE g5_shop_cart SET ct_status = '완료' WHERE od_id = ?`, claim.order.odId);

    // CSRF 토큰 — 화면의 실제 폼에서 읽는다(세션 비밀에 묶인 HMAC, 2시간 유효 → 네 브리지가 같이 쓴다).
    await customer.page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${decide.order.odId}`, {
      waitUntil: 'domcontentloaded',
    });
    csrf = await customer.page.locator(`#eq-${String(decideReviewId)} input[name=token]`).inputValue();
    expect(csrf.length, 'CSRF 토큰 hidden').toBeGreaterThan(10);
  }, 180_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (specIds.length > 0) {
      await prisma.spPcbClaim.deleteMany({ where: { specId: { in: specIds } } }); // events cascade
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: { in: specIds.map((id) => id.toString()) }, createdAt: { gte: startedAt } },
      });
    }
    await cleanupPcbPos(poIds); // 회차·문항·이벤트는 발주 cascade
    if (specIds.length > 0) await prisma.spOrderSpec.deleteMany({ where: { id: { in: specIds } } });
    if (bomQuoteId > 0n) {
      await prisma.spMailLog.deleteMany({ where: { refType: 'bom_quote', refId: bomQuoteId.toString() } });
      await prisma.spBomSettlement.deleteMany({ where: { quoteId: bomQuoteId } });
      await prisma.spBomQuote.deleteMany({ where: { id: bomQuoteId } }); // 요청·이슈·이벤트 cascade
    }
    for (const order of orders) await deleteOrderHard(order.odId);
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }
    await closeBrowser();

    const residue = await countPcbResidue(poIds);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spOrderSpec.count({ where: { id: { in: specIds } } }), '시드 스펙 잔재').toBe(0);
    expect(await prisma.spPcbClaim.count({ where: { specId: { in: specIds } } }), '접수 잔재').toBe(0);
    if (bomQuoteId > 0n) {
      expect(await prisma.spBomConfirmRequest.count({ where: { quoteId: bomQuoteId } }), '부품 확인 잔재').toBe(0);
    }
    for (const order of orders) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('B1. eq-decide — 반려 사유가 친 그대로 저장된다', async () => {
    const r = await postBridge('eq-decide', {
      form: {
        token: csrf,
        od_id: decide?.order.odId ?? '',
        review_id: String(decideReviewId),
        decision: 'reject',
        note: PROBE,
      },
    });
    expect(r, '브리지 응답').toMatchObject({ status: 302, tone: 'default' });
    expect(r.msg).toContain('반려했습니다');

    const row = await getPrisma().spPcbEqReview.findUnique({ where: { id: BigInt(decideReviewId) } });
    expect(row?.status).toBe('rejected');
    expect(row?.decisionNote, 'sp_pcb_eq_review.decisionNote').toBe(PROBE);
  });

  test('B2. eq-answer — 문항 의견이 친 그대로 저장된다', async () => {
    const before = await getPrisma().spPcbEqReview.findUnique({ where: { id: BigInt(answerReviewId) } });
    const r = await postBridge('eq-answer', {
      form: {
        token: csrf,
        od_id: answer?.order.odId ?? '',
        review_id: String(answerReviewId),
        version: String(before?.version ?? 0),
        [`answer[${String(answerItemId)}]`]: 'B',
        [`comment[${String(answerItemId)}]`]: PROBE,
        agree: '1',
      },
    });
    expect(r, '브리지 응답').toMatchObject({ status: 302, tone: 'success' });

    const item = await getPrisma().spPcbEqReviewItem.findUnique({ where: { id: BigInt(answerItemId) } });
    expect(item?.answerKey).toBe('B');
    expect(item?.answerComment, 'sp_pcb_eq_review_item.answerComment').toBe(PROBE);
  });

  test('B3. bom-confirm-answer — 요청 사항이 친 그대로 저장된다', async () => {
    const r = await postBridge('bom-confirm-answer', {
      form: {
        token: csrf,
        od_id: bomOrder?.odId ?? '',
        request_id: bomRequestId.toString(),
        version: '1',
        [`choice[${bomIssueId.toString()}]`]: 'A',
        note: PROBE,
      },
    });
    expect(r, '브리지 응답').toMatchObject({ status: 302, tone: 'success' });

    const row = await getPrisma().spBomConfirmRequest.findUnique({
      where: { id: bomRequestId },
      include: { issues: true },
    });
    expect(row?.status).toBe('answered');
    expect(row?.issues[0]?.chosenCode).toBe('A');
    expect(row?.customerNote, 'sp_bom_confirm_request.customerNote').toBe(PROBE);
  });

  test('B4. claim-create — 증상 설명이 친 그대로 저장된다(multipart)', async () => {
    const r = await postBridge('claim-create', {
      multipart: {
        token: csrf,
        od_id: claim?.order.odId ?? '',
        spec_id: (claim?.specId ?? 0n).toString(),
        kind: 'quality',
        affected_qty: '1',
        description: PROBE,
        requested_remedy: 'consult',
        acknowledge: '1',
      },
    });
    expect(r, '브리지 응답').toMatchObject({ status: 302, tone: 'success' });

    const row = await getPrisma().spPcbClaim.findFirst({ where: { specId: claim?.specId ?? 0n } });
    expect(row?.status).toBe('open');
    expect(row?.description, 'sp_pcb_claim.description').toBe(PROBE);
  });

  test("B5. 길이 검사는 친 글자를 센다 — `'` 한 글자는 반려 사유가 아니다", async () => {
    // addslashes 가 남아 있으면 `'` 가 `\'`(2자)로 세어져 최소 길이를 통과하고, 그대로 저장된다.
    const r = await postBridge('eq-decide', {
      form: {
        token: csrf,
        od_id: short?.order.odId ?? '',
        review_id: String(shortReviewId),
        decision: 'reject',
        note: "'",
      },
    });
    expect(r, '브리지 응답').toMatchObject({ status: 302, tone: 'danger' });
    expect(r.msg).toBe('반려 사유를 입력해 주세요.');

    const row = await getPrisma().spPcbEqReview.findUnique({ where: { id: BigInt(shortReviewId) } });
    expect(row?.status, '요청은 그대로 열려 있다').toBe('requested');
    expect(row?.decisionNote).toBeNull();
  });

  test('B6. 화면 — 주문 상세에 친 그대로 보인다(백슬래시 군더더기 없음)', async () => {
    const pages: [string, string | undefined][] = [
      ['반려 사유', decide?.order.odId],
      ['문항 의견', answer?.order.odId],
      ['부품 확인 요청 사항', bomOrder?.odId],
      ['A/S 증상 설명', claim?.order.odId],
    ];
    for (const [label, odId] of pages) {
      const text = await orderText(odId ?? '');
      expect(text, `${label} — 첫 줄`).toContain(LINE1);
      expect(text, `${label} — 글자 그대로의 역슬래시 경로`).toContain('C:\\temp\\new');
      expect(text, `${label} — 겹따옴표 앞 백슬래시`).not.toContain('\\"A\\"');
      expect(text, `${label} — 이모지`).toContain('🙂');
    }
  }, 120_000);
});
