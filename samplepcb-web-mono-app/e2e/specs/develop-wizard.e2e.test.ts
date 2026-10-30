// 개발의뢰 위저드 v2(docs/DEVELOP_FLOW.md §7.2.1) 브라우저 스모크 — 실 Vue(5177, nginx /develop/) + 실 Node API.
// 로그인은 /spcb/api/me 스텁(helpers/browser.ts). 두 여정:
//   ① 시스템개발 → 전문가 맡김 → 5스텝 완주 → 접수 → API 로 저장값 대조(전 분야 6·기구 포함·범위 답변 2)
//   ② 개별 메뉴(회로+펌웨어+역설계, 2026-10-30 메뉴 6장) → 3장 권유·통신 한 번·권리 확인 필수·조건부 문항 → 접수
//   ③ 개별 메뉴(펌웨어+앱 및 서버 → 서버만) → 제작 계획 건너뜀 → 접수 → 분야 = 펌웨어·서버, 시제품 제작 없음
// 실 LLM 경로 둘(FOLLOWUP_LLM=1): 시스템개발 AI 후속 질문 · 개별 메뉴 AI 맞춤 질문(§7.2.4). 그 밖의 여정은 두 유스케이스를 꺼 둔다.
// 만든 의뢰는 afterAll 이 지운다(공유 DB — 스스로 만들고 스스로 지운다). pageErrors 0 이 게이트.
// 실행: PORTAL_E2E=1 pnpm -F e2e e2e develop-wizard
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { API_URL, RUN, closeBrowser, disconnectPrisma, getPrisma, newSession, signJwt } from '../helpers';
import type { E2eSession } from '../helpers';

const MB = 'e2e-develop-wizard';
const identity = { mbId: MB, mbNick: '위저드고객' };

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
  } catch (e) {
    throw new Error(`${url} 도달 실패 — ${hint}\n(${e instanceof Error ? e.message : String(e)})`);
  }
}

async function apiGet(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${signJwt(identity)}` } });
  return { status: res.status, json: await res.json() };
}

interface DetailLite {
  requestId: number;
  title: string;
  requestMode: string;
  serviceAreas: string[];
  expertDelegate: boolean;
  answers: { code: string; choices: string[]; note?: string }[];
  production: { prototype: string; prototypeQty: number | null; scopes: string[] } | null;
  currentStage: string | null;
  targetStage: string | null;
  wishNote: string | null;
}

async function findByTitle(title: string): Promise<DetailLite> {
  const list = (await apiGet('/api/develop/my/requests?pageSize=50')).json as { data: { items: { requestId: number; title: string }[] } };
  const hit = list.data.items.find((i) => i.title === title);
  if (hit === undefined) throw new Error(`의뢰를 못 찾음: ${title}`);
  const detail = (await apiGet(`/api/develop/requests/${String(hit.requestId)}`)).json as { data: DetailLite };
  return detail.data;
}

const next = async (s: E2eSession): Promise<void> => {
  await s.page.getByRole('button', { name: /^NEXT/ }).click();
};

// 2스텝 공통 입력 — 제목·목적·단계·희망 시기(자유문)·예산.
async function fillDescribe(s: E2eSession, title: string): Promise<void> {
  await s.page.getByPlaceholder('의뢰 제목을 입력하세요.').fill(title);
  await s.page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill('[e2e] 여러 센서 값을 모아 설정 범위를 벗어나면 펌프를 자동 제어하는 장비. 스마트폰 상태 확인.');
  await s.page.getByRole('button', { name: '아이디어', exact: true }).click();
  await s.page.getByRole('button', { name: '시제품 완성', exact: true }).click();
  await s.page.getByLabel('희망 기간', { exact: true }).fill('계약 후 3개월');
  await s.page.locator('select').first().selectOption({ label: '1천만~3천만원' });
  // AI 동의는 2스텝 업로드 존 아래(자료가 AI 로 나가는 시점 앞, §7.2.2).
  await s.page.getByText('입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다.').click();
}

// 5스텝 — 연락처 + 접수(동의는 2스텝에서 받았다).
async function fillReviewAndSubmit(s: E2eSession): Promise<void> {
  await s.page.getByPlaceholder('홍길동').fill('위저드 고객');
  await s.page.getByPlaceholder('010-0000-0000').fill('010-1234-5678');
  await s.page.getByPlaceholder('name@company.com').fill('e2e-develop-wizard@example.com');
  await s.page.getByRole('button', { name: /^DONE/ }).click();
  await s.page.getByText('개발의뢰가 접수되었습니다').waitFor({ timeout: 15_000 });
}

// 위저드 3스텝 AI 유스케이스 토글 — AI 경로 테스트 전후로 켜고 원복한다(실 LLM 호출, FOLLOWUP_LLM=1 게이트).
type WizardAiUsecase = 'develop.followup' | 'develop.area-followup';
async function setUsecaseEnabled(useCase: WizardAiUsecase, enabled: boolean): Promise<boolean> {
  const prisma = getPrisma();
  const row = await prisma.spAiUsecase.findUnique({ where: { useCase } });
  const prev: boolean = row?.enabled ?? false;
  if (row === null) {
    await prisma.spAiUsecase.create({ data: { useCase, enabled, model: 'kimi-k3', think: 'low', promptTemplate: '', extraInstructions: null } });
  } else {
    await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled } });
  }
  return prev;
}
const setFollowupEnabled = (enabled: boolean): Promise<boolean> => setUsecaseEnabled('develop.followup', enabled);

describe.skipIf(!RUN)('개발의뢰 위저드 v2 — 브라우저 스모크', () => {
  const titles = {
    system: '[e2e] 위저드 v2 시스템개발',
    individual: '[e2e] 위저드 v2 개별 회로+펌웨어+역설계',
    software: '[e2e] 위저드 v2 개별 펌웨어+서버',
    ai: '[e2e] 위저드 v2 AI 질문',
    areaAi: '[e2e] 위저드 v2 개별 AI 맞춤 질문',
  };
  // 개별 메뉴 여정이 실 LLM 을 부르지 않게 맞춤 질문을 꺼 두고 끝나면 원복한다.
  let areaPrev = false;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'API 서버를 켜세요: pnpm dev:api (127.0.0.1:3333)');
    areaPrev = await setUsecaseEnabled('develop.area-followup', false);
  });

  afterAll(async () => {
    await setUsecaseEnabled('develop.area-followup', areaPrev);
    const prisma = getPrisma();
    await prisma.spDevelopRequest.deleteMany({ where: { mbId: MB } });
    await disconnectPrisma();
    await closeBrowser();
  });

  test('시스템개발 — 메뉴 배타·후속 질문 맡김·제작 계획·접수', async () => {
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      // ① 시스템개발을 고르면 개별 카드가 풀린다.
      await s.page.getByText('PCB 설계', { exact: true }).first().click();
      await s.page.getByText('시스템 개발', { exact: true }).first().click();
      await next(s);
      // ② 후속 질문 방식은 시스템개발일 때만 보인다 → 전문가에게 맡김.
      await s.page.getByText('의뢰 내용을 알려주세요').waitFor();
      await fillDescribe(s, titles.system);
      await s.page.getByText('전문가에게 맡김', { exact: false }).first().click();
      await next(s);
      // ③ 맡김 박스 + 디자인·기구 범위 2문항. 외부 업체 메모는 해당 선택에서만 보인다.
      await s.page.getByText('전문가 검토로 접수합니다').waitFor();
      await s.page.getByText('제품 외관·기구 개발 범위').waitFor();
      expect(await s.page.locator('textarea').count()).toBe(0);
      expect(await s.page.getByText('제품디자인·기구설계 업무를 어떤 방식으로 진행할까요?').count()).toBe(0);
      const vendorNote = s.page.getByPlaceholder('업체가 맡는 범위와 자료 전달 예정 시기 (선택)');
      expect(await vendorNote.count()).toBe(0);
      await s.page.getByRole('button', { name: '다른 업체가 진행 중·진행 예정', exact: true }).first().click();
      await vendorNote.fill('외관 디자인 담당, 다음 달 도면 전달');
      // 외부 업체에서 수정 의뢰로 바꾸면 감춘 메모가 저장되지 않는다.
      await s.page.getByRole('button', { name: '기존 디자인을 바탕으로 샘플피씨비에 수정 의뢰', exact: true }).click();
      expect(await vendorNote.count()).toBe(0);
      await s.page.getByRole('button', { name: '다른 업체가 진행 중·진행 예정', exact: true }).nth(1).click();
      await vendorNote.fill('기구설계 업체, 10월 초 도면 전달');
      await next(s);
      // ④ 시제품 수량 미정 + 제작 범위 하나 → 자재 조달·납품 형태 선택이 열린다.
      await s.page.getByRole('heading', { name: '시제품과 생산 계획' }).waitFor();
      await s.page.getByText('수량 미정', { exact: true }).click();
      await s.page.getByText('PCB 제작', { exact: true }).click();
      await s.page.getByText('자재 조달 방식', { exact: true }).waitFor();
      await next(s);
      // ⑤ 요약에 메뉴·단계·계획이 보이고 접수된다.
      await s.page.getByText('입력 내용을 확인해 주세요').waitFor();
      expect(await s.page.getByText('아이디어 → 시제품 완성').count()).toBeGreaterThan(0);
      await fillReviewAndSubmit(s);

      const d = await findByTitle(titles.system);
      expect(d.requestMode).toBe('system');
      expect(d.serviceAreas).toHaveLength(6);
      expect(d.serviceAreas).toContain('mech');
      expect(d.expertDelegate).toBe(true);
      expect(d.answers).toEqual([
        { code: 'system.product_design', choices: ['modify'] },
        { code: 'system.mech_design', choices: ['other_vendor'], note: '기구설계 업체, 10월 초 도면 전달' },
      ]);
      expect(d.production?.prototype).toBe('undecided');
      expect(d.production?.scopes).toEqual(['pcb_fab']);
      expect(d.currentStage).toBe('idea');
      expect(d.targetStage).toBe('prototype_done');
      expect(d.wishNote).toBe('계약 후 3개월');
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('개별 메뉴 — 회로+펌웨어+역설계 → 3장 권유·통신 한 번·권리 확인 필수·조건부 문항', async () => {
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByRole('button', { name: /^회로 설계/ }).click();
      await s.page.getByRole('button', { name: /^펌웨어 개발/ }).click();
      expect(await s.page.getByRole('button', { name: '시스템 개발로 바꾸기' }).count()).toBe(0);
      await s.page.getByRole('button', { name: /^역설계/ }).click();
      // 3장부터 시스템 개발 권유(고르지 않아도 진행).
      await s.page.getByRole('button', { name: '시스템 개발로 바꾸기' }).waitFor();
      await next(s);
      await fillDescribe(s, titles.individual);
      // 개별 견적엔 후속 질문 방식이 없다.
      expect(await s.page.getByText('기술값을 묻지 않고').count()).toBe(0);
      await next(s);
      // ③ 카드 셋 = 묶음 셋. 회로·펌웨어 공유 통신 문항은 한 번만, 역설계 묶음엔 권리 안내.
      await s.page.getByText('개별 개발 전문 질문').waitFor();
      expect(await s.page.getByText('어떤 통신 기능이 필요한가요?').count()).toBe(1);
      expect(await s.page.getByText('잠긴 칩의 프로그램은 추출하지 않습니다', { exact: false }).count()).toBeGreaterThan(0);
      // 권리 확인 없이 다음 → 막힌다.
      await next(s);
      await s.page.getByText("'권리 확인' 질문에 답해 주세요.").waitFor();
      await s.page.getByRole('button', { name: '자사 제품이며 관련 권리 보유', exact: true }).click();
      await s.page.getByPlaceholder(/입력값 → 판단 조건/).fill('[e2e] 온도 3점 → 임계 초과 → 밸브 닫기');
      await s.page.getByRole('button', { name: 'BLE', exact: true }).click();
      // 조건부 — '펌웨어 추출'을 고를 때만 추출 자료 문항이 나온다. 답한 뒤 선택을 빼면 그 답은 접수에 안 실린다.
      expect(await s.page.getByText('펌웨어 추출 관련 자료가 있나요?').count()).toBe(0);
      await s.page.getByRole('button', { name: '펌웨어 추출', exact: true }).click();
      await s.page.getByText('펌웨어 추출 관련 자료가 있나요?').waitFor();
      await s.page.getByRole('button', { name: 'MCU·메모리 부품명을 알고 있음', exact: true }).click();
      await s.page.getByRole('button', { name: '펌웨어 추출', exact: true }).click();
      expect(await s.page.getByText('펌웨어 추출 관련 자료가 있나요?').count()).toBe(0);
      await s.page.getByRole('button', { name: '회로도 작성', exact: true }).click();
      await next(s);
      // ④ 회로·역설계가 있으니 제작 계획을 묻는다.
      await s.page.getByText('제작 없음', { exact: true }).click();
      await next(s);
      await fillReviewAndSubmit(s);

      const d = await findByTitle(titles.individual);
      expect(d.requestMode).toBe('individual');
      expect(d.serviceAreas).toEqual(['circuit', 'firmware', 'reverse']);
      expect(d.answers.find((a) => a.code === 'hw.comm')?.choices).toEqual(['ble']);
      expect(d.answers.find((a) => a.code === 'reverse.rights')?.choices).toEqual(['own']);
      expect(d.answers.find((a) => a.code === 'reverse.work')?.choices).toEqual(['schematic']);
      expect(d.answers.some((a) => a.code === 'reverse.firmware')).toBe(false);
      expect(d.answers.find((a) => a.code === 'firmware.flow')?.note).toContain('밸브 닫기');
      expect(d.currentStage).toBe('idea');
      expect(d.production?.prototype).toBe('none');
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('개별 메뉴 — 펌웨어+앱 및 서버(서버만) → 제작 계획 건너뜀', async () => {
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByRole('button', { name: /^펌웨어 개발/ }).click();
      await s.page.getByRole('button', { name: /^앱 및 서버 개발/ }).click();
      await next(s);
      await fillDescribe(s, titles.software);
      await next(s);
      // ③ '앱 및 서버'는 '앱과 서버 모두'로 시작 — '서버만'으로 줄이면 앱 질문이 사라진다.
      await s.page.getByText('어디까지 개발이 필요하신가요?').waitFor();
      expect(await s.page.getByRole('button', { name: '앱과 서버 모두', exact: true }).getAttribute('aria-pressed')).toBe('true');
      expect(await s.page.getByText('어떤 플랫폼에서 사용할 앱인가요?').count()).toBe(1);
      await s.page.getByRole('button', { name: '서버만', exact: true }).click();
      expect(await s.page.getByText('어떤 플랫폼에서 사용할 앱인가요?').count()).toBe(0);
      await s.page.getByText('서버에서 어떤 기능이 필요한가요?').waitFor();
      await s.page.getByRole('button', { name: 'MQTT', exact: true }).click();
      await next(s);
      // ④ 없이 바로 검토·접수(만들 하드웨어가 없다). 요약에 시제품·제조 블록도 없다.
      await s.page.getByText('입력 내용을 확인해 주세요').waitFor();
      expect(await s.page.getByText('시제품·제조', { exact: true }).count()).toBe(0);
      await fillReviewAndSubmit(s);

      const d = await findByTitle(titles.software);
      expect(d.serviceAreas).toEqual(['firmware', 'server']);
      expect(d.answers.find((a) => a.code === 'appserver.scope')?.choices).toEqual(['server']);
      expect(d.answers.find((a) => a.code === 'server.protocol')?.choices).toEqual(['mqtt']);
      expect(d.production?.prototype).toBe('none');
      expect(d.production?.scopes).toEqual([]);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // 시스템개발 + "몇 가지 질문에 답하기" — 유스케이스가 꺼져 있으면(기본) 고정 문항(분석 후 추가 확인)으로 즉시 폴백한다.
  test('시스템개발 — AI 질문 유스케이스 꺼짐 → 고정 문항 폴백', async () => {
    const prev = await setFollowupEnabled(false);
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('시스템 개발', { exact: true }).first().click();
      await next(s);
      await fillDescribe(s, '[e2e] 위저드 v2 폴백');
      await next(s);
      await s.page.getByText('제품이 어떤 동작을 해야 하나요?').waitFor({ timeout: 15_000 });
      expect(await s.page.getByText('제품의 입력 전원은 어떻게 준비할까요?').count()).toBe(1);
      expect(await s.page.getByText('기본 질문').count()).toBeGreaterThan(0);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
      await setFollowupEnabled(prev);
    }
  });

  // 내 의뢰(피그마 00-2, 2026-10-22) — 위에서 접수한 건이 표 행으로: 분야 표기·접수일(YY.MM.DD)·상태 칩·'진행 상태' 버튼,
  // 할 일이 없으니 검정 할 일 버튼은 없다. 행 빈 곳을 눌러도 상세로 간다(제목 링크를 행 전체로 늘림).
  test('내 의뢰 — 접수한 의뢰가 표 행으로, 행 클릭 → 상세', async () => {
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/me');
      const row = s.page.locator('main li', { hasText: titles.individual });
      await row.waitFor({ timeout: 15_000 });
      expect(await row.getByText('회로 + 펌웨어 + 역설계', { exact: true }).count()).toBe(1);
      expect(await row.getByText(/^접수 \d{2}\.\d{2}\.\d{2}$/).count()).toBe(1);
      expect(await row.getByText('접수됨', { exact: true }).count()).toBe(1);
      expect(await row.getByRole('link', { name: '진행 상태' }).count()).toBe(1);
      expect(await row.locator('a.bg-\\[\\#1b2b39\\]').count()).toBe(0);
      const sysRow = s.page.locator('main li', { hasText: titles.system });
      expect(await sysRow.getByText('시스템 개발', { exact: true }).count()).toBe(1);
      await sysRow.click({ position: { x: 700, y: 60 } });
      await s.page.waitForURL(/\/develop\/requests\/\d+$/);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // 의뢰 상세(피그마 00-3 탭형, 2026-10-22) — 탭이 한 번에 한 섹션을 보이고 번호 제목이 붙는다. 탭은 주소 해시와 맞물려
  // 해시로 바로 들어오면 그 탭이 열린다. 첨부가 없으면 첨부 탭이 없다.
  test('의뢰 상세 — 탭 전환·해시 진입·빈 상태', async () => {
    const s = await newSession(identity);
    try {
      const { requestId } = await findByTitle(titles.individual);
      await s.page.goto(`/develop/requests/${String(requestId)}`);
      const tabs = s.page.locator('nav[aria-label="의뢰 상세 탭"] button');
      await tabs.first().waitFor();
      expect((await tabs.allTextContents()).map((t) => t.trim())).toEqual(['상세 의뢰 내용', 'AI 사전 검토서', '견적서', '진행 현황·문서', '진행·문의']);
      await s.page.getByRole('heading', { name: '1. 상세 의뢰 내용' }).waitFor();
      await s.page.getByRole('tab', { name: '진행·문의' }).click();
      await s.page.getByRole('heading', { name: '5. 진행 · 문의' }).waitFor();
      expect(new URL(s.page.url()).hash).toBe('#timeline');
      expect(await s.page.getByText('진행 사항', { exact: true }).count()).toBe(1);
      // 해시로 바로 — 견적서 탭(아직 없음 안내)
      await s.page.goto(`/develop/requests/${String(requestId)}#quotes`);
      await s.page.getByRole('heading', { name: '3. 견적서' }).waitFor();
      expect(await s.page.getByText('아직 견적서가 없습니다').count()).toBe(1);
      expect(await s.page.getByRole('tab', { name: '견적서' }).getAttribute('aria-selected')).toBe('true');
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // 랜딩(피그마 00-1, 2026-10-21) 분야 카드 → 위저드 1스텝이 그 메뉴를 고른 채 열린다(?menu=<code>).
  test('랜딩 분야 카드 — 메뉴를 고른 채 위저드 진입', async () => {
    const s = await newSession(identity);
    try {
      // 분야 카드(PCB 설계) → 개별 견적 PCB 설계 선택(2026-10 히어로 교체로 히어로 카드는 없어졌다)
      await s.page.goto('/develop/');
      await s.page.getByRole('link', { name: /PCB 설계/ }).first().click();
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(new URL(s.page.url()).searchParams.get('menu')).toBe('pcb');
      expect(await s.page.getByRole('button', { name: /^PCB 설계/ }).getAttribute('aria-pressed')).toBe('true');
      expect(await s.page.getByRole('button', { name: /^시스템 개발/ }).getAttribute('aria-pressed')).toBe('false');
      // 개발 분야 섹션의 첫 카드 → 시스템 개발 선택
      await s.page.goto('/develop/');
      await s.page.locator('#areas ~ ul a').first().click();
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(new URL(s.page.url()).searchParams.get('menu')).toBe('system');
      expect(await s.page.getByRole('button', { name: /^시스템 개발/ }).getAttribute('aria-pressed')).toBe('true');
      // 옛 랜딩 카드(기구·앱·서버 따로) — 기구는 시스템 개발로, 앱은 '앱 및 서버' 카드로 연다(랜딩 개편은 디자이너 확인 뒤).
      await s.page.goto('/develop/request?menu=mech');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(await s.page.getByRole('button', { name: /^시스템 개발/ }).getAttribute('aria-pressed')).toBe('true');
      await s.page.goto('/develop/request?menu=app');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(await s.page.getByRole('button', { name: /^앱 및 서버 개발/ }).getAttribute('aria-pressed')).toBe('true');
      // 모르는 코드는 무시 — 아무것도 고르지 않은 채 연다.
      await s.page.goto('/develop/request?menu=unknown');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(await s.page.locator('button[aria-pressed="true"]').count()).toBe(0);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // 실 LLM 경로(kimi-k3, 10초 안팎) — FOLLOWUP_LLM=1 일 때만. 질문이 뜨고 답이 저장되는지까지 본다.
  test.skipIf(process.env.FOLLOWUP_LLM !== '1')('시스템개발 — AI 가 자료를 읽고 고른 질문 → 답 저장', async () => {
    const prev = await setFollowupEnabled(true);
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('시스템 개발', { exact: true }).first().click();
      await next(s);
      await fillDescribe(s, titles.ai);
      await s.page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill(
        '[e2e] 매장용 자동 음료 디스펜서. 4종 음료를 정해진 양만큼 따르고, 스마트폰 앱에서 남은 양과 판매 횟수를 확인합니다. 실내 카운터, 콘센트 전원. 케이스 3D 파일은 이미 있습니다.',
      );
      await next(s);
      // 진행 패널 → 질문. 5분 안에 끝나야 한다.
      await s.page.getByText('AI 가 이해한 내용', { exact: false }).waitFor({ timeout: 300_000 });
      const chips = s.page.getByRole('button', { name: '잘 모르겠음', exact: true });
      expect(await chips.count()).toBeGreaterThan(0);
      await chips.first().click();
      await next(s);
      await s.page.getByText('수량 미정', { exact: true }).click();
      await next(s);
      await fillReviewAndSubmit(s);
      const d = (await apiGet(`/api/develop/requests/${String((await findByTitle(titles.ai)).requestId)}`)).json as {
        data: { aiQuestions: { questions: { answer: { choice: string | null } | null }[] } | null };
      };
      expect(d.data.aiQuestions).not.toBeNull();
      expect(d.data.aiQuestions?.questions.some((q) => q.answer?.choice === 'unknown')).toBe(true);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
      await setFollowupEnabled(prev);
    }
  });

  // 실 LLM 경로 — 개별 메뉴 AI 맞춤 질문(§7.2.4). 자세한 설명이면 기본 질문 대부분을 근거와 함께 채운다('AI 가 채움').
  test.skipIf(process.env.FOLLOWUP_LLM !== '1')('개별 메뉴 — AI 가 자료에서 채운 답·고쳐 물은 질문 → 코드 답 저장', async () => {
    await setUsecaseEnabled('develop.area-followup', true);
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('회로 설계', { exact: true }).first().click();
      await next(s);
      await fillDescribe(s, titles.areaAi);
      await s.page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill(
        '[e2e] 스마트 화분 컨트롤러를 새로 만들려고 합니다. 토양 수분 센서와 조도 센서 값을 읽어 물이 부족하면 DC 5V 워터펌프를 돌립니다. ' +
          '1.3인치 OLED 와 버튼 2개, 18650 충전식 배터리(USB-C 충전), 스마트폰과 BLE 연결. 국내 판매라 KC 인증 필요. 결과물은 Altium 원본·PDF·BOM.',
      );
      await next(s);
      await s.page.getByText('AI 가 이해한 내용', { exact: false }).waitFor({ timeout: 300_000 });
      expect(await s.page.getByText('AI 가 채움', { exact: true }).count()).toBeGreaterThan(0);
      await s.page.screenshot({ path: `${process.env.E2E_SHOT_DIR ?? '.'}/develop-area-followup-step3.png` }).catch(() => undefined);
      await next(s);
      await s.page.getByText('수량 미정', { exact: true }).click();
      await next(s);
      await fillReviewAndSubmit(s);
      const d = (await apiGet(`/api/develop/requests/${String((await findByTitle(titles.areaAi)).requestId)}`)).json as {
        data: { answers: { code: string }[]; aiQuestions: { area?: { covered: { base: string; kept: boolean }[] } } | null };
      };
      const covered = d.data.aiQuestions?.area?.covered ?? [];
      expect(covered.length).toBeGreaterThan(0);
      // 채운 답은 그대로 두었으니 전부 kept, 그리고 코드 답으로 저장돼 있다.
      expect(covered.every((c) => c.kept)).toBe(true);
      expect(covered.every((c) => d.data.answers.some((a) => a.code === c.base))).toBe(true);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
      await setUsecaseEnabled('develop.area-followup', false);
    }
  });

  // 관리자 워크큐·상세 — 위 두 건이 의뢰 방식 칩·분야 배지·시제품 계획·전문가 맡김 배지로 보인다.
  // sp-vue 는 5174 직결(5173 은 다른 프로젝트 vite 가 점유할 수 있다 — 메모리 관례).
  test('관리자 — 워크큐 칩·상세 의뢰 내용(시스템개발·전문가 맡김·시제품 계획)', async () => {
    const web = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:5174';
    const sys = await findByTitle(titles.system);
    const ind = await findByTitle(titles.individual);
    const s = await newSession({ mbId: 'e2e-develop-admin', mbNick: '관리자', isAdmin: true });
    try {
      await s.page.goto(`${web}/app/admin/develop/requests?tab=received&q=%5Be2e%5D%20%EC%9C%84%EC%A0%80%EB%93%9C`);
      await s.page.getByText(titles.system).first().waitFor({ timeout: 20_000 });
      const row = s.page.locator('tr', { hasText: titles.individual });
      expect(await row.getByText('개별 견적').count()).toBeGreaterThan(0);
      expect(await row.getByText('회로 + 펌웨어 + 역설계').count()).toBeGreaterThan(0);
      expect(await row.getByText('권리 확인 필요').count()).toBe(0); // 자사 제품 — 신호 없음

      await s.page.goto(`${web}/app/admin/develop/requests/${String(sys.requestId)}`);
      await s.page.getByText('시제품·생산 계획').first().waitFor({ timeout: 20_000 });
      expect(await s.page.getByText('전문가 맡김', { exact: false }).count()).toBeGreaterThan(0);
      expect(await s.page.getByText('시제품 수량 미정 · PCB 제작').count()).toBeGreaterThan(0);
      expect(await s.page.getByText('아이디어 → 시제품 완성').count()).toBeGreaterThan(0);

      await s.page.goto(`${web}/app/admin/develop/requests/${String(ind.requestId)}`);
      await s.page.getByText('[e2e] 온도 3점 → 임계 초과 → 밸브 닫기').first().waitFor({ timeout: 20_000 });
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });
});
