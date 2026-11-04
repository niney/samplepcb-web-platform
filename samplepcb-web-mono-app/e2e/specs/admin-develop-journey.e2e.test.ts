// 관리자 「개발」 화면 여정 — 접수부터 완료까지 관리자 화면을 실제로 눌러 몰고, 고객 쪽 행동은 고객 API 로 낸다.
// 같은 스펙을 옛 화면과 리뉴얼 화면에서 돌린다(DEVELOP_ADMIN_UI=old|next, helpers/develop-admin.ts) — 옛 화면 green = 시나리오가
// 맞음, 새 화면 green = 동작이 같음. docs/DEVELOP_FLOW.md §4(상태 머신)·§5(견적)·§13(문서·업무표)·§14(큐·배지)·§14.1(왕복·이탈 가드).
//
//   1. 접수 큐(검색) → 메뉴 배지 = API counts.received → 행 클릭(from/lt/tab) → 「검토 시작」 → reviewing·담당자 = 나
//   2. 견적서 탭: 새 견적 → (새 화면) 인건비 기본값·빈 줄 + 직접비 추가 / (옛 화면) 행 추가 2줄 → 초안 저장 → 발송(확인) → quoted, 견적·계약 큐
//   3. 고객 수락(API) → 결제 대기 배지 → 마일스톤 수동 입금 확인 → in_progress, 진행 프로젝트 큐
//   4. 프로젝트 문서: 기본 업무 → 저장(11행) · 착수 문서(KO) 작성·저장·발송 → 회신 대기 배지 → 고객 결정(API) → 해소
//      + 이탈 가드(편집 중 「목록으로」 → 취소면 머묾, 나가기면 떠난 큐로)
//   5. 타임라인(?tab= 딥링크): 내부 진행 메모 · 고객 문의(API) → 문의·A/S 큐·미답변 배지 → 답변 → 해소
//   6. 납품(final) → 납품·검수 큐 → 고객 검수 확정(API) → completed
//   7. 큐 ↔ 상세 왕복: 검색어·페이지가 「목록으로」 뒤에도 남는다
//   8. (새 화면) 설정 — 인건비 기본값 칸·직무 검사·그대로 저장
//   9. (새 화면) 의뢰 내용 — 연락처 수정(완료 뒤에도)·형식 검사·고객/관리자 타임라인 기록
// 실행: PORTAL_E2E=1 [DEVELOP_ADMIN_UI=next] pnpm -F e2e e2e admin-develop-journey
// 사전 조건: sp-node(3333)·nginx(local-web)·sp-vue 가 떠 있을 것. 메일은 로컬 Mailpit 으로 간다(실발송 없음).
// 만든 의뢰는 afterAll 이 e2e 계정 단위로 지운다(공유 DB — 스스로 만들고 스스로 지운다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { computeDevelopQuoteBreakdown } from '@sp/api-contract';
import { RUN, closeBrowser, disconnectPrisma, mailpitSearch, newSession, snap } from '../helpers';
import type { E2eSession } from '../helpers';
import {
  DEVELOP_ADMIN_BASE,
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

  test('2. 견적서 — (새 화면: 인건비 기본값·빈 줄 + 직접비 추가·가산율·미리보기 / 옛 화면: 행 추가 2줄) → 초안 저장 → 발송(확인) → quoted', async () => {
    const page = s.page;
    await detailTab(page, '견적서').click();
    await page.getByRole('button', { name: '새 견적서', exact: true }).click();
    if (UI === 'next') {
      // 인건비(§5.1) — 일일 노임비 × 참여 일수. 설정의 인건비 기본값 첫 줄을 불러와 값이 복사되고 커서가 참여 일수로
      // 가는지 본 뒤(기본값이 없으면 빈 줄), 금액은 명시값으로 고친다(설정 값에 기대지 않는다).
      const presets: any[] = (await api.get('/api/admin/develop/settings')).json?.data?.laborPresets ?? [];
      if (presets.length > 0) {
        const p = presets[0];
        await page.getByTestId('quote-labor').getByRole('button', { name: '기본값에서 추가' }).click();
        await page.getByTestId('quote-preset-item').first().click();
        expect(await page.getByLabel('인건비 1 직무', { exact: true }).inputValue()).toBe(p.role);
        expect(await page.getByLabel('인건비 1 등급', { exact: true }).inputValue()).toBe(p.grade);
        expect(await page.getByLabel('인건비 1 담당 업무', { exact: true }).inputValue()).toBe(p.task);
        expect(await page.getByLabel('인건비 1 일일 노임비(원/일)', { exact: true }).inputValue()).toBe(p.dailyRate.toLocaleString('ko-KR'));
        await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toBe('인건비 1 참여 일수');
      } else {
        await page.getByRole('button', { name: '인건비 빈 줄 추가', exact: true }).click();
      }
      await page.getByLabel('인건비 1 직무', { exact: true }).fill('PM');
      await page.getByLabel('인건비 1 등급', { exact: true }).fill('특급');
      // 등급 칸 제안 = 특급 · 고급 · 중급 · 일반(사용자 지정 — 자유 글도 받는다)
      const gradeListId = await page.getByLabel('인건비 1 등급', { exact: true }).getAttribute('list');
      const gradeOptions = await page.locator(`datalist[id="${String(gradeListId)}"] option`).evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      expect(gradeOptions).toEqual(['특급', '고급', '중급', '일반']);
      await page.getByLabel('인건비 1 담당 업무', { exact: true }).fill('시스템 설계');
      await page.getByLabel('인건비 1 일일 노임비(원/일)', { exact: true }).fill('400000');
      await page.getByLabel('인건비 1 참여 일수', { exact: true }).fill('10');
      await page.getByRole('button', { name: '인건비 빈 줄 추가', exact: true }).click();
      await page.getByLabel('인건비 2 직무', { exact: true }).fill('펌웨어 개발');
      await page.getByLabel('인건비 2 등급', { exact: true }).fill('중급');
      await page.getByLabel('인건비 2 일일 노임비(원/일)', { exact: true }).fill('250000');
      await page.getByLabel('인건비 2 참여 일수', { exact: true }).fill('4');
      expect(await page.getByTestId('quote-labor-subtotal').textContent()).toBe('5,000,000원');
      // 직접비 — 「직접비 추가」(커서는 항목으로) → 항목·내용·단가·수량·단위(1,300,000 × 3회). 붙여넣기로 채우기는 뺐다.
      expect(await page.getByText('붙여넣기로 채우기').count()).toBe(0);
      await page.getByRole('button', { name: '직접비 추가', exact: true }).click();
      await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toBe('직접비 1 항목');
      await page.getByLabel('직접비 1 항목', { exact: true }).fill('PCB 제작');
      await page.getByLabel('직접비 1 내용', { exact: true }).fill('6층 빌드업');
      await page.getByLabel('직접비 1 단가(원)', { exact: true }).fill('1300000');
      await page.getByLabel('직접비 1 수량', { exact: true }).fill('3');
      await page.getByLabel('직접비 1 단위', { exact: true }).fill('회'); // 직접비 기본 단위는 '식'
      expect(await page.getByTestId('quote-direct-subtotal').textContent()).toBe('3,900,000원');
      await page.getByLabel('간접비 %', { exact: true }).fill('15');
      await page.getByLabel('제경비(일반관리비) %', { exact: true }).fill('5');
      await page.getByLabel('기업이윤 %', { exact: true }).fill('10');
      await page.getByLabel('수신 부서', { exact: true }).fill('연구소');
      await page.getByLabel('산출물', { exact: true }).fill('회로도\n펌웨어 소스');
      // 합계(가산 줄 이름에 비율) · 합계 띠 — 원가·마진 칸은 2026-11-04 저녁 뺐다
      expect(await page.getByTestId('quote-breakdown').textContent()).toContain('간접비 15%');
      expect(await page.getByTestId('quote-sticky-totals').textContent()).toContain('13,002,000원');
      expect(await page.getByText('원가', { exact: true }).count()).toBe(0);
      await snap(page, `admin-develop-${UI}-quote-editor`);
      // 미리보기 = 고객이 받는 1쪽(저장 전 폼 그대로)
      await page.getByRole('button', { name: '견적서 미리보기', exact: true }).click();
      const sheet = page.getByTestId('develop-quote-preview').getByTestId('develop-quote-sheet');
      await sheet.waitFor();
      // 8,900,000 → 간접비 1,335,000 → 제경비(10,235,000 × 5%) 511,000 → 이윤(10,746,000 × 10%) 1,074,000 → 공급가 11,820,000
      expect(await sheet.getByTestId('develop-quote-supply').textContent()).toBe('11,820,000');
      expect(await sheet.getByTestId('develop-quote-total').textContent()).toBe('13,002,000');
      expect(await sheet.getByText('15% (인건비+직접비)', { exact: true }).count()).toBe(1);
      expect(await sheet.getByText('10일', { exact: true }).count()).toBe(1);
      expect(await sheet.getByText('3회', { exact: true }).count()).toBe(1);
      expect(await sheet.getByText('연구소', { exact: true }).count()).toBe(1);
      // 1쪽 Remark 에 산출물(폼에서 적은 줄) · 별도 실비(설정 기본 문구가 복사돼 있다)
      expect(await sheet.getByText('회로도 · 펌웨어 소스', { exact: true }).count()).toBe(1);
      expect(await sheet.getByText('별도 실비', { exact: true }).count()).toBe(1);
      await snap(page, `admin-develop-${UI}-quote-preview`);
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached' });
    } else {
      // 옛 화면 — 한 줄 = 금액 한 덩어리(수량·단위 칸 없음)라 「행 추가」 줄은 직접비 1식으로 들어간다(붙여넣기는 뺐다)
      for (const [title, amount] of [['PCB 제작', '3000000'], ['부품 구매', '2000000']] as const) {
        await page.getByRole('button', { name: '행 추가', exact: true }).first().click();
        await page.getByPlaceholder('항목명', { exact: true }).last().fill(title);
        await page.getByPlaceholder('단가(원)', { exact: true }).last().fill(amount);
      }
    }
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
    if (UI === 'next') {
      // 저장 순서는 인건비 → 직접비, 인건비 단위는 '일'
      expect(q.items.map((i: any) => [i.category, i.title, i.unitPrice, i.qty, i.unit, i.amount])).toEqual([
        ['labor', 'PM', 400_000, 10, '일', 4_000_000],
        ['labor', '펌웨어 개발', 250_000, 4, '일', 1_000_000],
        ['direct', 'PCB 제작', 1_300_000, 3, '회', 3_900_000],
      ]);
      expect([q.indirectBp, q.overheadBp, q.profitBp, q.recipientDept]).toEqual([1500, 500, 1000, '연구소']);
      expect([q.breakdown.indirectAmount, q.breakdown.overheadAmount, q.breakdown.profitAmount, q.supplyAmount]).toEqual([1_335_000, 511_000, 1_074_000, 11_820_000]);
      expect(q.items.some((i: any) => 'costPrice' in i || 'vendor' in i), '원가 칸은 없다').toBe(false);
      expect(await page.getByRole('button', { name: '원가 고치기' }).count()).toBe(0);
    } else {
      // 옛 화면은 가산율 칸이 없다 — 새 견적은 설정 기본값을 복사하고, 금액은 서버가 같은 계약 함수로 맞춘다.
      expect(q.items.map((i: any) => [i.category, i.title, i.amount])).toEqual([
        ['direct', 'PCB 제작', 3_000_000],
        ['direct', '부품 구매', 2_000_000],
      ]);
      const b = computeDevelopQuoteBreakdown(q.items, { indirectBp: q.indirectBp, overheadBp: q.overheadBp, profitBp: q.profitBp }, q.vatMode);
      expect(q.supplyAmount).toBe(b.supplyAmount);
      // 옛 화면엔 가산율 칸이 없지만 가산 줄은 카드에 읽기 전용으로 보인다(비율 0 인 줄은 빠진다)
      const nonZero = [q.indirectBp, q.overheadBp, q.profitBp].filter((bp: number) => bp > 0).length;
      await expect.poll(async () => page.getByTestId('legacy-card-surcharge').count()).toBe(nonZero);
    }

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

  test('8. 설정 — 인건비 기본값(노임 단가표) 칸 · 직무 검사 · 그대로 저장하면 목록이 그대로', async () => {
    // 옛 설정 화면엔 이 칸이 없다 — 설정 저장은 보낸 칸만 고치므로 옛 화면에서 저장해도 기본값은 남는다(하네스가 본다).
    if (UI !== 'next') return;
    const page = s.page;
    const before: any[] = (await api.get('/api/admin/develop/settings')).json?.data?.laborPresets ?? [];
    await page.goto(`${DEVELOP_ADMIN_BASE}/settings?_t=${String(Date.now())}`);
    const card = page.getByTestId('develop-settings-labor-presets');
    await card.waitFor();
    await expect.poll(async () => card.getByTestId('develop-settings-preset-row').count()).toBe(before.length);
    if (before.length > 0) {
      expect(await card.getByLabel('1 직무', { exact: true }).inputValue()).toBe(before[0].role);
      expect(await card.getByLabel('1 일일 노임비(원/일)', { exact: true }).inputValue()).toBe(before[0].dailyRate.toLocaleString('ko-KR'));
    }
    // 빈 줄을 더하면 직무·노임비 검사가 저장을 막고, 그 줄을 지우면 풀린다
    const n = String(before.length + 1);
    await card.getByRole('button', { name: '줄 추가', exact: true }).click();
    await page.getByText(`인건비 기본값 ${n}번 줄의 직무를 채워 주세요.`, { exact: false }).first().waitFor();
    expect(await page.getByRole('button', { name: '저장', exact: true }).isDisabled()).toBe(true);
    await snap(page, `admin-develop-${UI}-settings-presets`);
    await card.getByRole('button', { name: `${n} 삭제`, exact: true }).click();
    await expect.poll(async () => page.getByRole('button', { name: '저장', exact: true }).isDisabled()).toBe(false);
    // 그대로 저장 — 저장 본문에 인건비 기본값이 실리고 목록이 그대로 돌아온다
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await saved('설정을 저장했습니다.');
    const after: any[] = (await api.get('/api/admin/develop/settings')).json?.data?.laborPresets ?? [];
    expect(after).toEqual(before);
  }, LONG);

  test('9. 의뢰 내용 — 연락처 수정(완료 뒤에도) · 형식 검사 · 고객 타임라인엔 바뀐 칸 이름만, 이전 값은 관리자만', async () => {
    // 옛 화면엔 연락처 수정이 없다(새 화면만). 이메일은 그대로 둔다 — 아래 Mailpit 확인이 이 주소로 센다.
    if (UI !== 'next') return;
    const page = s.page;
    const before = (await detail()).contact;
    await page.goto(`${developDetailPath(rid)}?_t=${String(Date.now())}`);
    await detailTab(page, '의뢰 내용').click();
    const box = page.getByTestId('develop-contact');
    await box.getByRole('button', { name: '연락처 수정', exact: true }).click();
    const dialog = page.getByTestId('develop-contact-dialog');
    await dialog.waitFor();
    expect(await dialog.getByRole('button', { name: '저장', exact: true }).isDisabled(), '바뀐 칸이 없으면 저장이 막힌다').toBe(true);
    await dialog.getByLabel('회사 (선택)', { exact: true }).fill('E2E연락처상사');
    await dialog.getByLabel('연락처', { exact: true }).fill('전화 없음');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await dialog.getByText('전화번호 형식이 아닙니다', { exact: false }).waitFor();
    await dialog.getByLabel('연락처', { exact: true }).fill('010-7777-8888');
    await dialog.getByLabel('연락 가능 시간 (선택)', { exact: true }).fill('평일 오전');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await saved('연락처를 고쳤습니다.');
    await expect.poll(async () => (await detail())?.contact?.phone).toBe('010-7777-8888');
    const after = (await detail()).contact;
    expect([after.name, after.company, after.email, after.hours]).toEqual([before.name, 'E2E연락처상사', before.email, '평일 오전']);
    await box.getByText('010-7777-8888', { exact: true }).waitFor();
    // 고객 타임라인엔 바뀐 칸 이름만 — 이전 값·관리자 기록은 고객 응답에 없다
    const LABELS: Record<string, string> = { name: '담당자 이름', company: '회사', phone: '연락처', email: '이메일', hours: '연락 가능 시간' };
    const labels = ['name', 'company', 'phone', 'email', 'hours'].filter((f) => before[f] !== after[f]).map((f) => LABELS[f]).join('·');
    const cust = (await customerApi.get(`/api/develop/requests/${String(rid)}`)).json.data;
    const custEv = cust.events.filter((e: any) => String(e.title).startsWith('담당자가 연락처를 수정했습니다'));
    expect(custEv.map((e: any) => e.title)).toEqual([`담당자가 연락처를 수정했습니다(${labels})`]);
    expect(JSON.stringify(custEv)).not.toContain(before.phone);
    expect(cust.events.some((e: any) => e.title === '연락처 변경 내역')).toBe(false);
    // 관리자 타임라인 — 내부 기록에 이전 → 이후
    await detailTab(page, '진행 타임라인').click();
    await page.getByText('연락처 변경 내역', { exact: true }).first().waitFor();
    expect(await page.getByText(`연락처: ${before.phone} → 010-7777-8888`, { exact: false }).count()).toBeGreaterThan(0);
    await snap(page, `admin-develop-${UI}-contact-timeline`);
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
