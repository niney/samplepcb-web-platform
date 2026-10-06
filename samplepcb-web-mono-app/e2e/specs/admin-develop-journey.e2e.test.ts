// 관리자 「개발」 화면 여정 — 접수부터 완료까지 관리자 화면을 실제로 눌러 몰고, 고객 쪽 행동은 고객 API 로 낸다.
// 같은 스펙을 옛 화면과 리뉴얼 화면에서 돌린다(DEVELOP_ADMIN_UI=old|next, helpers/develop-admin.ts) — 옛 화면 green = 시나리오가
// 맞음, 새 화면 green = 동작이 같음. docs/DEVELOP_FLOW.md §4(상태 머신)·§5(견적)·§13(문서·업무표)·§14(큐·배지)·§14.1(왕복·이탈 가드).
//
//   1. 접수 큐(검색) → 메뉴 배지 = API counts.received → 행 클릭(from/lt/tab) → 「검토 시작」 → reviewing·담당자 = 나
//   2. 견적서 탭: 새 견적 → 붙여넣기 2줄 → 초안 저장 → 발송(확인) → quoted, 견적·계약 큐
//   3. 고객 수락(API) → 결제 대기 배지 → 마일스톤 수동 입금 확인 → in_progress, 진행 프로젝트 큐
//   4. 프로젝트 문서: 기본 업무 → 저장(11행) · 착수 문서(KO) 작성·저장·발송 → 회신 대기 배지 → 고객 결정(API) → 해소
//      + 이탈 가드(편집 중 「목록으로」 → 취소면 머묾, 나가기면 떠난 큐로)
//   5. 타임라인(?tab= 딥링크): 내부 진행 메모 · 고객 문의(API) → 문의·A/S 큐·미답변 배지 → 답변 → 해소
//   6. 납품(final) → 납품·검수 큐 → 고객 검수 확정(API) → completed
//   7. 큐 ↔ 상세 왕복: 검색어·페이지가 「목록으로」 뒤에도 남는다
// 실행: PORTAL_E2E=1 [DEVELOP_ADMIN_UI=next] pnpm -F e2e e2e admin-develop-journey
// 사전 조건: sp-node(3333)·nginx(local-web)·sp-vue 가 떠 있을 것. 메일은 로컬 Mailpit 으로 간다(실발송 없음).
// 만든 의뢰는 afterAll 이 e2e 계정 단위로 지운다(공유 DB — 스스로 만들고 스스로 지운다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { RUN, closeBrowser, disconnectPrisma, mailpitSearch, newSession, snap } from '../helpers';
import type { E2eSession } from '../helpers';
import {
  DEVELOP_ADMIN_UI,
  DEVELOP_UI_CONTACT_EMAIL,
  adminApi,
  answerConfirm,
  chooseOption,
  cleanupDevelopUi,
  createDevelopRequestAsCustomer,
  customerApi,
  detailTab,
  developAdminIdentity,
  developDetailPath,
  developQueuePath,
  developQueueRouteName,
  fillByLabel,
  hideViteOverlay,
  menuBadge,
  purgeDevelopUiMail,
  queueTab,
  scopeWith,
  searchQueue,
  setCheck,
} from '../helpers/develop-admin';

const UI = DEVELOP_ADMIN_UI;
const RUN_TAG = Date.now().toString(36);
const TITLE = `[e2e-ui] 개발 화면 여정 ${RUN_TAG}`;
const LONG = 180_000;

describe.skipIf(!RUN)(`관리자 개발 화면 여정 (${UI})`, () => {
  let s: E2eSession;
  let admin: Awaited<ReturnType<typeof developAdminIdentity>>;
  let api: ReturnType<typeof adminApi>;
  let rid = 0;
  let quoteId = 0;

  const detail = async (): Promise<any> => (await api.get(`/api/admin/develop/requests/${String(rid)}`)).json?.data;
  const listCounts = async (): Promise<any> =>
    (await api.get('/api/admin/develop/requests?page=1&pageSize=1&tab=all')).json?.data;
  const inSignal = async (tab: string, signal: string): Promise<boolean> => {
    const res = await api.get(`/api/admin/develop/requests?page=1&pageSize=100&tab=${tab}&signal=${signal}`);
    return (res.json?.data?.items ?? []).some((i: any) => i.requestId === rid);
  };
  /** 큐 화면을 열고 우리 의뢰로 좁힌다 — 행(제목)이 보일 때까지. */
  const openQueue = async (key: Parameters<typeof developQueuePath>[0]): Promise<void> => {
    await s.page.goto(`${developQueuePath(key)}?_t=${String(Date.now())}`);
    await searchQueue(s.page, TITLE);
    await s.page.getByText(TITLE, { exact: true }).first().waitFor();
  };
  /** 메뉴 배지가 API 값과 같아질 때까지(배지 쿼리는 따로 돈다). */
  const expectBadge = async (label: string, read: (d: any) => number): Promise<void> => {
    await expect
      .poll(async () => {
        const [badge, data] = await Promise.all([menuBadge(s.page, label), listCounts()]);
        return badge === read(data) ? 'ok' : `badge ${String(badge)} ≠ api ${String(read(data))}`;
      }, { timeout: 20_000 })
      .toBe('ok');
  };
  const saved = (text: string) => s.page.getByText(text).first().waitFor();

  beforeAll(async () => {
    await cleanupDevelopUi(); // 지난 실행의 잔여(중단된 실행) 정리
    await purgeDevelopUiMail();
    admin = await developAdminIdentity();
    api = adminApi(admin);
    rid = await createDevelopRequestAsCustomer(TITLE);
    s = await newSession(admin);
    await hideViteOverlay(s.context);
  });

  afterAll(async () => {
    if (s !== undefined) {
      if (s.pageErrors.length > 0) await snap(s.page, `admin-develop-${UI}-last`).catch(() => undefined);
      await s.close();
    }
    await closeBrowser();
    const left = await cleanupDevelopUi();
    const mails = await purgeDevelopUiMail();
    console.log(`[admin-develop-journey:${UI}] 정리 — e2e 계정 의뢰 잔여 ${String(left)}건 · 메일 ${String(mails)}통 삭제`);
    await disconnectPrisma();
  });

  test('1. 접수 큐 → 배지 → 상세(from·lt·tab) → 검토 시작', async () => {
    const page = s.page;
    await openQueue('intake');
    expect(page.url()).toContain('q=');
    await expectBadge('접수·검토', (d) => d.counts.received);

    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    const url = new URL(page.url());
    expect(url.pathname).toBe(developDetailPath(rid));
    expect(url.searchParams.get('from')).toBe(developQueueRouteName('intake'));
    expect(url.searchParams.get('lt')).toBe('intake');
    expect(url.searchParams.get('lq')).toBe(TITLE);
    expect(url.searchParams.get('tab')).toBe('review');
    await page.getByRole('heading', { level: 1, name: TITLE }).waitFor();
    expect(await detailTab(page, 'AI 검토서').getAttribute('aria-selected')).toBe('true');

    await page.getByRole('button', { name: '검토 시작', exact: true }).click();
    await expect.poll(async () => (await detail())?.status).toBe('reviewing');
    expect((await detail()).assigneeMbId).toBe(admin.mbId);
    await page.getByText('검토 중', { exact: true }).first().waitFor();
  }, LONG);

  test('2. 견적서 — 붙여넣기 2줄 → 초안 저장 → 발송(확인) → quoted', async () => {
    const page = s.page;
    await detailTab(page, '견적서').click();
    await page.getByRole('button', { name: '새 견적서', exact: true }).click();
    await page.getByPlaceholder(/H\/W 회로·PCB 설계/).fill('회로·PCB 설계 3,000,000원\n펌웨어 개발 2,000,000원');
    await page.getByRole('button', { name: '채우기', exact: true }).click();
    await saved('2줄을 항목으로 넣었습니다.');
    await page.getByRole('button', { name: '초안 저장', exact: true }).click();
    await saved('초안을 저장했습니다.');
    await expect.poll(async () => (await detail())?.quotes?.length ?? 0).toBe(1);

    await page.getByRole('button', { name: '발송', exact: true }).first().click();
    await answerConfirm(page, /이 내용으로 견적서를 보냅니다/, '발송');
    await expect.poll(async () => (await detail())?.status).toBe('quoted');
    const d = await detail();
    const q = d.quotes[0];
    quoteId = q.quoteId;
    expect(q.status).toBe('sent');
    expect(q.items.map((i: any) => [i.title, i.amount])).toEqual([
      ['회로·PCB 설계', 3_000_000],
      ['펌웨어 개발', 2_000_000],
    ]);
    expect(q.supplyAmount).toBe(5_000_000);

    await openQueue('contracts');
    await queueTab(page, '견적 발송').click();
    await page.getByText(TITLE, { exact: true }).first().waitFor();
  }, LONG);

  test('3. 고객 수락(API) → 결제 대기 배지 → 수동 입금 확인 → in_progress', async () => {
    const page = s.page;
    const accept = await customerApi.post(`/api/develop/requests/${String(rid)}/quotes/${String(quoteId)}/accept`, { agree: true, name: '이투이' });
    expect(accept.status, JSON.stringify(accept.json)).toBe(200);
    await expect.poll(async () => (await detail())?.status).toBe('accepted');

    await openQueue('contracts');
    await expectBadge('견적·계약', (d) => d.counts.accepted);
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('quotes');

    await page.getByRole('button', { name: '입금 확인(수동)', exact: true }).first().click();
    await answerConfirm(page, /오프라인 결제를 확인 처리합니다/, '확인');
    await expect.poll(async () => (await detail())?.status).toBe('in_progress');

    await openQueue('projects');
  }, LONG);

  test('4. 프로젝트 문서 — 업무표 기본 업무 저장 · 착수 문서 발송 → 회신 대기 → 고객 결정 → 해소 · 이탈 가드', async () => {
    const page = s.page;
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('documents');
    expect(new URL(page.url()).searchParams.get('from')).toBe(developQueueRouteName('projects'));

    // 업무표 — 비어 있으면 바로, 행이 있으면 「대체」 확인 뒤 기본 11행.
    await page.getByRole('button', { name: '기본 업무 불러오기', exact: true }).click();
    const replace = page.getByRole('button', { name: '대체', exact: true });
    if (await replace.isVisible().catch(() => false)) await replace.click();
    await scopeWith(page, /업무표/, '기본 업무 불러오기').getByRole('button', { name: '저장', exact: true }).click();
    await saved('업무표를 저장했습니다.');
    await expect.poll(async () => (await detail())?.progress?.tasks?.length ?? 0).toBe(11);

    // 착수 문서(KO) — 만들기 → 본문 → 저장 → 발송 준비 → 발송(확인).
    const docs = scopeWith(page, /프로젝트 문서|만든 문서/, '새 문서');
    await chooseOption(docs, '계약·개발착수 확인');
    await page.getByRole('button', { name: '새 문서', exact: true }).click();
    await expect.poll(async () => (await detail())?.documents?.length ?? 0).toBe(1);
    const doc0 = (await detail()).documents[0];
    expect(doc0.type).toBe('kickoff');
    const docNo: string = doc0.docNo;
    const card = scopeWith(page, docNo, '발송 준비');
    await fillByLabel(card, '개발 목적과 주요 기능', 'BLE 온습도 로거 v1 — 배터리 3개월, 앱 연동');
    await card.getByRole('button', { name: '저장', exact: true }).click();
    await saved('초안을 저장했습니다.');
    await expect.poll(async () => (await detail())?.documents?.[0]?.content?.goal ?? '').toContain('BLE 온습도 로거 v1');
    await card.getByRole('button', { name: '발송 준비', exact: true }).click();
    await scopeWith(page, `${docNo} 발송`, '발송').getByRole('button', { name: '발송', exact: true }).first().click();
    await answerConfirm(page, '이 내용으로 발송합니다.', '발송');
    await expect.poll(async () => (await detail())?.documents?.[0]?.status).toBe('sent');
    await expect.poll(() => inSignal('in_progress', 'docs_awaiting')).toBe(true);

    await openQueue('projects');
    await expectBadge('진행 프로젝트', (d) => d.signals.docsAwaiting);
    await page.getByText('회신 대기 1').first().waitFor();

    const decide = await customerApi.post(`/api/develop/requests/${String(rid)}/documents/${String(doc0.documentId)}/decide`, {
      decision: 'approved',
      name: '이투이',
    });
    expect(decide.status, JSON.stringify(decide.json)).toBe(200);
    await expect.poll(() => inSignal('in_progress', 'docs_awaiting')).toBe(false);
    await openQueue('projects');
    await expectBadge('진행 프로젝트', (d) => d.signals.docsAwaiting);

    // 이탈 가드 — 업무표를 건드린 채 「목록으로」: 취소면 머물고, 나가기면 떠난 큐(진행 프로젝트)로.
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    await page.getByRole('button', { name: '업무 추가', exact: true }).click();
    await page.getByRole('link', { name: /목록으로/ }).first().click();
    await answerConfirm(page, /저장하지 않은 내용이 있습니다/, '취소');
    expect(new URL(page.url()).pathname).toBe(developDetailPath(rid));
    await page.getByRole('link', { name: /목록으로/ }).first().click();
    await answerConfirm(page, /저장하지 않은 내용이 있습니다/, '나가기');
    await page.waitForURL((u) => u.pathname === developQueuePath('projects'));
    expect(new URL(page.url()).searchParams.get('q')).toBe(TITLE);
  }, LONG);

  test('5. 타임라인(?tab= 딥링크) — 내부 메모 · 고객 문의 → 문의·A/S 큐·배지 → 답변 → 해소', async () => {
    const page = s.page;
    await page.goto(`${developDetailPath(rid)}?tab=timeline`);
    await page.getByRole('heading', { level: 1, name: TITLE }).waitFor();
    expect(await detailTab(page, '진행 타임라인').getAttribute('aria-selected')).toBe('true');

    const composer = scopeWith(page, /진행 타임라인/, '등록');
    await composer.getByPlaceholder('내용', { exact: true }).fill('[e2e-ui] 내부 진행 메모 — 부품 리드타임 확인');
    await setCheck(composer, '고객에게 공개', false);
    await composer.getByRole('button', { name: '등록', exact: true }).click();
    await saved('기록을 등록했습니다.');
    await expect
      .poll(async () => (await detail())?.events?.some((e: any) => e.type === 'note' && e.visibleToCustomer === false && String(e.body).includes('부품 리드타임')))
      .toBe(true);

    const ask = await customerApi.postForm(`/api/develop/requests/${String(rid)}/comments`, { body: '[e2e-ui] 펌웨어 업데이트 방법이 궁금합니다', asRequest: false });
    expect(ask.status, JSON.stringify(ask.json)).toBe(200);
    await expect.poll(() => inSignal('all', 'inquiries_open')).toBe(true);

    await openQueue('inquiries');
    await expectBadge('문의·A/S', (d) => d.signals.inquiriesOpen);
    await page.getByText('미답변 1').first().waitFor();
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('timeline');

    const composer2 = scopeWith(page, /진행 타임라인/, '등록');
    await chooseOption(composer2, '문의');
    await composer2.getByPlaceholder('내용', { exact: true }).fill('[e2e-ui] 확인 후 연락드리겠습니다');
    await composer2.getByRole('button', { name: '등록', exact: true }).click();
    await saved('기록을 등록했습니다.');
    await expect.poll(() => inSignal('all', 'inquiries_open')).toBe(false);
  }, LONG);

  test('6. 납품(final) → 납품·검수 큐 → 고객 검수 확정(API) → completed', async () => {
    const page = s.page;
    const composer = scopeWith(page, /진행 타임라인/, '등록');
    await chooseOption(composer, '산출물');
    await setCheck(composer, '납품 (상태를 납품으로 바꿉니다)', true);
    await composer.getByPlaceholder('내용', { exact: true }).fill('[e2e-ui] 최종 산출물 — 회로도·거버·펌웨어');
    await composer.getByRole('button', { name: '등록', exact: true }).click();
    await saved('기록을 등록했습니다.');
    await expect.poll(async () => (await detail())?.status).toBe('delivered');

    await openQueue('deliveries');
    await expectBadge('납품·검수', (d) => d.counts.delivered);

    const cust = await customerApi.get(`/api/develop/requests/${String(rid)}`);
    const delivery = (cust.json?.data?.events ?? []).find((e: any) => e.type === 'deliverable');
    expect(delivery, '고객 상세에 납품 이벤트').toBeDefined();
    const confirm = await customerApi.post(`/api/develop/requests/${String(rid)}/deliveries/${String(delivery.eventId)}/confirm`, { note: '검수 완료' });
    expect(confirm.status, JSON.stringify(confirm.json)).toBe(200);
    await expect.poll(async () => (await detail())?.status).toBe('completed');

    // 프로세스 관찰(단언 아님): 잔금(on_delivery)이 미수인 채 완료되면 어느 큐가 그 미수를 보여 주는가.
    const done = await detail();
    const pending = (done.quotes ?? []).flatMap((q: any) => q.milestones ?? []).filter((m: any) => m.status === 'pending');
    const queues = ['intake', 'contract', 'in_progress', 'delivered'];
    const shownIn: string[] = [];
    for (const tab of queues) {
      const res = await api.get(`/api/admin/develop/requests?page=1&pageSize=100&tab=${tab}`);
      if ((res.json?.data?.items ?? []).some((i: any) => i.requestId === rid)) shownIn.push(tab);
    }
    const completedRow = (await api.get('/api/admin/develop/requests?page=1&pageSize=100&tab=completed')).json?.data?.items?.find(
      (i: any) => i.requestId === rid,
    );
    console.log(
      `[admin-develop-journey:${UI}] 완료 시점 미수 마일스톤 ${String(pending.length)}건(${pending.map((m: any) => `${String(m.title)} ${String(m.amount)}`).join(', ')}) · ` +
        `작업 큐 노출 [${shownIn.join(', ')}] · 완료 탭 ops.pendingAmount=${String(completedRow?.ops?.pendingAmount)}`,
    );

    await page.goto(`${developDetailPath(rid)}?_t=${String(Date.now())}`);
    await page.getByRole('heading', { level: 1, name: TITLE }).waitFor();
    await page.getByText('완료', { exact: true }).first().waitFor();
  }, LONG);

  test('7. 큐 ↔ 상세 왕복 — 검색어·페이지가 「목록으로」 뒤에도 남는다', async () => {
    const page = s.page;
    // 검색어: 전체 의뢰(완료 탭) → 상세 → 목록으로.
    await openQueue('requests');
    await queueTab(page, '완료').click();
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.waitForURL(/\/requests\/\d+/);
    expect(new URL(page.url()).searchParams.get('lt')).toBe('completed');
    await page.getByRole('link', { name: /목록으로/ }).first().click();
    await page.waitForURL((u) => u.pathname === developQueuePath('requests'));
    const back = new URL(page.url());
    expect(back.searchParams.get('q')).toBe(TITLE);
    expect(back.searchParams.get('tab')).toBe('completed');
    await page.getByText(TITLE, { exact: true }).first().waitFor();

    // 페이지: 전체 의뢰가 한 쪽(20건)을 넘어야 2쪽이 생긴다 — 모자라면 같은 e2e 계정으로 채움 의뢰를 만든다(정리 때 함께 지워진다).
    let all = await listCounts();
    for (let i = (all?.total ?? 0); i <= 20; i += 1) await createDevelopRequestAsCustomer(`[e2e-ui] 페이지 채움 ${RUN_TAG}-${String(i)}`);
    all = await listCounts();
    if ((all?.total ?? 0) > 20) {
      await page.goto(`${developQueuePath('requests')}?page=2`);
      // 칸이 둘 이상인 행만(빈 상태·불러오는 중 행은 colspan 한 칸).
      const firstRow = page.locator('tbody tr:has(td + td)').first();
      await firstRow.waitFor();
      await firstRow.click();
      await page.waitForURL(/\/requests\/\d+/);
      expect(new URL(page.url()).searchParams.get('lp')).toBe('2');
      await page.getByRole('link', { name: /목록으로/ }).first().click();
      await page.waitForURL((u) => u.pathname === developQueuePath('requests'));
      expect(new URL(page.url()).searchParams.get('page')).toBe('2');
    } else {
      console.log(`[admin-develop-journey:${UI}] 전체 의뢰 ${String(all?.total)}건 — 페이지 왕복은 건너뜀`);
    }
  }, LONG);

  test('메일(Mailpit) — 견적·결제·문서·납품 알림이 고객 주소로 나갔다', async () => {
    const found = await mailpitSearch(`to:${DEVELOP_UI_CONTACT_EMAIL}`).catch(() => null);
    if (found === null) {
      console.log(`[admin-develop-journey:${UI}] Mailpit 미가동 — 메일 확인 건너뜀`);
      return;
    }
    const subjects: string[] = (found.messages ?? []).map((m: any) => String(m.Subject));
    expect(subjects.length, subjects.join(' | ')).toBeGreaterThanOrEqual(4);
  });

  test('pageErrors 0', () => {
    expect(s.pageErrors).toEqual([]);
  });
});
