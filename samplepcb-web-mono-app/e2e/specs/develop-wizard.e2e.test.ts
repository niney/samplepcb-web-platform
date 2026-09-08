// 개발의뢰 위저드 v2(docs/DEVELOP_FLOW.md §7.2.1) 브라우저 스모크 — 실 Vue(5177, nginx /develop/) + 실 Node API.
// 로그인은 /spcb/api/me 스텁(helpers/browser.ts). 두 여정:
//   ① 시스템개발 → 전문가 맡김 → 5스텝 완주 → 접수 → API 로 저장값 대조(전 분야 6·기구 포함·범위 답변 2)
//   ② 개별 견적(PCB+기구) → 3스텝 기구설계 서술 문항 → 접수 → 답변에 mech 서술이 남는다
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
  await s.page.getByRole('button', { name: /다음 단계/ }).click();
};

// 2스텝 공통 입력 — 제목·목적·단계·희망 시기(자유문)·예산.
async function fillDescribe(s: E2eSession, title: string): Promise<void> {
  await s.page.getByPlaceholder('예: 매장용 자동 음료 디스펜서 개발').fill(title);
  await s.page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill('[e2e] 여러 센서 값을 모아 설정 범위를 벗어나면 펌프를 자동 제어하는 장비. 스마트폰 상태 확인.');
  await s.page.getByRole('button', { name: '아이디어', exact: true }).click();
  await s.page.getByRole('button', { name: '시제품 완성', exact: true }).click();
  await s.page.getByPlaceholder('계약 후 3개월').fill('계약 후 3개월');
  await s.page.locator('select').first().selectOption({ label: '1천만~3천만원' });
  // AI 동의는 2스텝 업로드 존 아래(자료가 AI 로 나가는 시점 앞, §7.2.2).
  await s.page.getByText('입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다.').click();
}

// 5스텝 — 연락처 + 접수(동의는 2스텝에서 받았다).
async function fillReviewAndSubmit(s: E2eSession): Promise<void> {
  await s.page.getByPlaceholder('홍길동').fill('위저드 고객');
  await s.page.getByPlaceholder('010-0000-0000').fill('010-1234-5678');
  await s.page.getByPlaceholder('name@company.com').fill('e2e-develop-wizard@example.com');
  await s.page.getByRole('button', { name: '개발의뢰 접수' }).click();
  await s.page.getByText('개발의뢰가 접수되었습니다').waitFor({ timeout: 15_000 });
}

// develop.followup 유스케이스 토글 — AI 경로 테스트 전후로 켜고 원복한다(실 LLM 호출, FOLLOWUP_LLM=1 게이트).
async function setFollowupEnabled(enabled: boolean): Promise<boolean> {
  const prisma = getPrisma();
  const row = await prisma.spAiUsecase.findUnique({ where: { useCase: 'develop.followup' } });
  const prev: boolean = row?.enabled ?? false;
  if (row === null) {
    await prisma.spAiUsecase.create({ data: { useCase: 'develop.followup', enabled, model: 'kimi-k3', think: 'low', promptTemplate: '', extraInstructions: null } });
  } else {
    await prisma.spAiUsecase.update({ where: { useCase: 'develop.followup' }, data: { enabled } });
  }
  return prev;
}

describe.skipIf(!RUN)('개발의뢰 위저드 v2 — 브라우저 스모크', () => {
  const titles = { system: '[e2e] 위저드 v2 시스템개발', individual: '[e2e] 위저드 v2 개별 PCB+기구', ai: '[e2e] 위저드 v2 AI 질문' };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'API 서버를 켜세요: pnpm dev:api (127.0.0.1:3333)');
  });

  afterAll(async () => {
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
      await s.page.getByText('PCB설계', { exact: true }).first().click();
      await s.page.getByText('시스템개발', { exact: true }).first().click();
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
      // ④ 시제품 수량 미정 + 제작 범위 하나 → 제조 연계 확인이 열린다.
      await s.page.getByText('시제품과 생산 계획').waitFor();
      await s.page.getByText('수량 미정', { exact: true }).click();
      await s.page.getByText('PCB 제작', { exact: true }).click();
      await s.page.getByText('제조 연계 확인').waitFor();
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

  test('개별 견적 — PCB+기구 → 기구설계 서술 문항 → 답변 저장', async () => {
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('PCB설계', { exact: true }).first().click();
      await s.page.getByText('기구설계', { exact: true }).first().click();
      await next(s);
      await fillDescribe(s, titles.individual);
      // 개별 견적엔 후속 질문 방식이 없다.
      expect(await s.page.getByText('기술값을 묻지 않고').count()).toBe(0); // 후속 질문 방식 라디오(도움 카드 문구와 구분)
      await next(s);
      // ③ 분야 카드 둘 — 기구설계 서술 문항(text)은 textarea, 선택지 문항은 칩.
      await s.page.getByText('개별 개발 전문 질문').waitFor();
      await s.page.getByText('목표 외형 크기와 무게 제한을 알려주세요.').waitFor();
      await s.page.getByPlaceholder(/가로×세로×높이/).fill('80×50×30mm, 200g 이하');
      await s.page.getByRole('button', { name: '신규 설계', exact: true }).click();
      // 문항은 전부 펼쳐 나열(접기·희망 툴·자료 슬롯 없음, 2026-09-08 간소화) — PCB 설계 툴은 문항이다.
      expect(await s.page.getByText('주의가 필요한 신호와 배선 조건이 있나요?').isVisible()).toBe(true);
      expect(await s.page.getByText('더 자세히 답하기').count()).toBe(0);
      expect(await s.page.getByText('있으면 좋은 자료').count()).toBe(0);
      expect(await s.page.getByText('눌러서 펼치기').count()).toBe(0);
      await s.page.getByRole('button', { name: 'KiCad', exact: true }).click();
      await s.page.getByRole('button', { name: 'USB', exact: true }).click();
      await next(s);
      await s.page.getByText('제작 없음', { exact: true }).click();
      await next(s);
      await fillReviewAndSubmit(s);

      const d = await findByTitle(titles.individual);
      expect(d.requestMode).toBe('individual');
      expect(d.serviceAreas).toEqual(['pcb', 'mech']);
      const size = d.answers.find((a) => a.code === 'mech.size');
      expect(size?.choices).toEqual([]);
      expect(size?.note).toContain('80×50×30');
      expect(d.answers.find((a) => a.code === 'pcb.type')?.choices).toEqual(['new']);
      expect(d.answers.find((a) => a.code === 'pcb.signal')?.choices).toEqual(['usb']);
      expect(d.answers.find((a) => a.code === 'pcb.tool')?.choices).toEqual(['kicad']);
      expect(d.production?.prototype).toBe('none');
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });

  // 시스템개발 + "몇 가지 질문에 답하기" — 유스케이스가 꺼져 있으면(기본) 고정 서술 3문항으로 즉시 폴백한다.
  test('시스템개발 — AI 질문 유스케이스 꺼짐 → 고정 3문항 폴백', async () => {
    const prev = await setFollowupEnabled(false);
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('시스템개발', { exact: true }).first().click();
      await next(s);
      await fillDescribe(s, '[e2e] 위저드 v2 폴백');
      await next(s);
      await s.page.getByText('제품은 누가, 어디에서, 어떻게 사용하나요?').waitFor({ timeout: 15_000 });
      expect(await s.page.getByText('기본 질문').count()).toBeGreaterThan(0);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
      await setFollowupEnabled(prev);
    }
  });

  // 실 LLM 경로(kimi-k3, 10초 안팎) — FOLLOWUP_LLM=1 일 때만. 질문이 뜨고 답이 저장되는지까지 본다.
  test.skipIf(process.env.FOLLOWUP_LLM !== '1')('시스템개발 — AI 가 자료를 읽고 고른 질문 → 답 저장', async () => {
    const prev = await setFollowupEnabled(true);
    const s = await newSession(identity);
    try {
      await s.page.goto('/develop/request');
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      await s.page.getByText('시스템개발', { exact: true }).first().click();
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
      expect(await row.getByText('PCB + 기구').count()).toBeGreaterThan(0);

      await s.page.goto(`${web}/app/admin/develop/requests/${String(sys.requestId)}`);
      await s.page.getByText('시제품·생산 계획').first().waitFor({ timeout: 20_000 });
      expect(await s.page.getByText('전문가 맡김', { exact: false }).count()).toBeGreaterThan(0);
      expect(await s.page.getByText('시제품 수량 미정 · PCB 제작').count()).toBeGreaterThan(0);
      expect(await s.page.getByText('아이디어 → 시제품 완성').count()).toBeGreaterThan(0);

      await s.page.goto(`${web}/app/admin/develop/requests/${String(ind.requestId)}`);
      await s.page.getByText('목표 외형 크기와 무게 제한을 알려주세요.').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      expect(await s.page.getByText('80×50×30mm, 200g 이하').count()).toBeGreaterThan(0);
      expect(s.pageErrors).toEqual([]);
    } finally {
      await s.close();
    }
  });
});
