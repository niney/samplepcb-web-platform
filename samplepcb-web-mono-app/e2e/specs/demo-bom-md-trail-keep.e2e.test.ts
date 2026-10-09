// 흔적 주행 — BOM 외화 회신 + 마스터딜러 중개의 **열세 칸을 칸마다 멈춰 남긴다**(정리 없음 · 2026-10-09 사용자 요청).
//
// 한 견적은 한 상태에만 있을 수 있으므로, 칸마다 견적(Case)을 하나씩 새로 만들어 그 칸까지만 올리고
// 멈춘다. 주행이 끝나면 Case 열세 개가 "T01 견적요청 발송" 부터 "T13 송금 완료" 까지 각자의 자리에
// 서 있다 — 사람이 관리자 화면·협력사 포털(대리 접속)·고객 화면에서 칸마다 열어 볼 수 있다.
// 칸마다 스스로 검증하고(helpers/bom-md-flow.ts 의 expect), 화면을 찍고, 값·주소를 대장에 적는다.
//
// 대장: e2e/output/journey/trail-bom-md.html (칸별 한 일·볼 곳 링크·값·스크린샷)
// 실행: pnpm -F e2e demo:bom-md-trail
// 사전: nginx · API(3333) · 웹(5173) · Mailpit(8025). 고객은 데모 계정(e2e/.env.e2e 의 E2E_DEMO_CUSTOMER_ID/PW).
// 정리(원할 때 수동): 관리자 Case 상세의 [Case 강제 영구 삭제] — 제목이 「[BOM 흔적」으로 시작한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  BOM_MD_CHILDREN,
  BOM_MD_ORGS,
  BomMdCase,
  MAILPIT_URL,
  RUN,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  ensureBomMdStage,
  newPhpSession,
  newSession,
  num,
  outputDir,
  requireDemoCustomerCreds,
  type BomMdStage,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const DEMO = process.env.DEMO_KEEP === '1';
const STAMP = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

interface StepDef {
  title: string;
  /** 이 칸에서 한 일 */
  did: string;
  /** 화면에서 볼 것 */
  look: string[];
  /** 여기서 사람이 이어서 해 볼 수 있는 다음 칸 */
  next: string;
}

const STEPS: readonly StepDef[] = [
  {
    title: '견적요청 발송',
    did: '관리자가 마스터딜러(달러)·위안 협력사·원화 협력사에 견적요청을 보냈다. 보내는 순간 협력사별 결제통화가 문서에 박제되고, 달러·위안 환율이 이 견적에 굳는다.',
    look: [
      '관리자 Case › 협력사 견적요청: 세 줄 모두 「요청 중」',
      '마스터딜러 포털 › 견적 요청: 단가(USD) 회신표 위에 「하위 협력사에 다시 요청」 영역',
    ],
    next: '마스터딜러 포털에서 하위 협력사 둘을 체크하고 「선택한 협력사에 요청 보내기」',
  },
  {
    title: '마스터딜러의 하위 재요청',
    did: '마스터딜러가 받은 견적요청을 자기 하위 협력사 둘(위안·달러)에 다시 요청했다. 하위는 계정이 없어 매직링크로 회신한다.',
    look: [
      '마스터딜러 포털 › 하위 표: 두 곳 「요청 중」, [회신 링크 복사]',
      '관리자 Case › 마스터딜러 줄 아래 「└ 하위 재요청 회신 0/2곳」',
      '하위 회신 페이지(로그인 없음): 「요청처 e2e부품중개상사」, 단가(CNY)',
      'Mailpit: 하위 가에게 간 견적요청 메일(요청 조직명 + 회신 버튼)',
    ],
    next: '하위 회신 링크를 열어 단가를 넣고 저장 / 위안·원화 협력사 포털에서 회신',
  },
  {
    title: '하위·직접 협력사 회신 도착',
    did: '하위 둘이 매직링크로, 위안·원화 협력사가 포털로 회신했다. 마스터딜러는 아직 회신 전이다.',
    look: [
      '마스터딜러 포털 › 하위 표: 「회신 완료」·통화별 합계, 회신표의 「공급 경로」에 하위 회신이 선택지로 뜬다',
      '관리자 Case › 위안·원화 협력사 「회신 완료」(위안은 ≈원화 병기), 마스터딜러는 「요청 중」+ 하위 회신 2/2곳',
    ],
    next: '마스터딜러 포털 회신표에서 품목마다 하위를 고르고 마진(%)을 넣어 「회신 저장」',
  },
  {
    title: '마스터딜러 회신 — 품목별 하위 선정 + 마진',
    did: '마스터딜러가 0번은 하위 가(위안)+10%, 1번은 하위 나(달러)+5%, 2번은 직접 단가로 회신했다. 위안→달러 환율은 고른 이 순간에 굳었다.',
    look: [
      '마스터딜러 포털 › 회신표: 「공급 경로 · 마진」 열, 하위를 고른 행의 단가는 산출값',
      '관리자 Case › [공급사 비교·선정]: 협력사 열의 통화 배지(USD·CNY), 환율 띠, 마스터딜러 칸의 근거 한 줄(하위·원가·환율·마진)',
    ],
    next: '관리자 비교표에서 품목별로 선정하고 「선정 적용」 (환율 띠에서 위안 환율을 직접 넣어 볼 수 있다)',
  },
  {
    title: '관리자 선정 — 외화를 원화로 박제',
    did: '관리자가 위안 환율을 직접 굳힌 뒤, 0~2번은 마스터딜러, 3번은 위안 협력사, 4번은 원화 협력사 회신으로 선정했다. 박제는 전부 원화이고 원본(통화·단가·환율)은 따로 남는다.',
    look: [
      '관리자 Case › 선정 공급사 카드 세 장·부품 합계(원화)',
      '관리자 Case › [공급사 비교·선정]: 환율 띠의 위안이 「직접 입력」, 선정한 칸에 「선정됨」',
      '관리자 품목 표 › 선정 구매 조건이 KRW 단가',
    ],
    next: '관리자 품목 확인 완료 → 「고객 회신 확정」',
  },
  {
    title: '고객 회신 확정',
    did: '관리자가 품목 확인을 마치고 확정가로 고객에게 회신했다. 견적요청은 하위 재요청까지 전부 마감됐다.',
    look: [
      '고객 화면(데모 고객 로그인) › 확정 견적·[주문하기] — 협력사 통화·환율은 어디에도 없다',
      '관리자 Case › 견적요청 「마감」, 하위 재요청도 「마감」',
      '마스터딜러 포털 › 「마감된 요청입니다(수정 불가)」',
    ],
    next: '데모 고객으로 로그인해 [주문하기] → 무통장 주문',
  },
  {
    title: '고객 주문·입금',
    did: '고객이 주문하고 관리자가 입금을 확인했다. 아직 발주서는 없다.',
    look: [
      '관리자 Case › 조달 발주: [발주서 생성] 활성',
      '[발주서 생성] 창: 외화 회신 선정 줄에 「($… 지급)」·「(¥… 지급)」 표기',
    ],
    next: '관리자 [발주서 생성]에서 세 협력사를 고르고 생성',
  },
  {
    title: '발주 발행 — 세 통화',
    did: '관리자가 마스터딜러(달러)·위안 협력사·원화 협력사에 발주서를 냈다. 외화 발주는 결제통화 금액이 정본이고 원화는 발행일 실제 환율의 회계값이다.',
    look: [
      '관리자 Case › 조달 발주: 원화 금액 아래 결제통화 금액·환율, 「└ 송금 미지급」',
      '마스터딜러 포털 › 발주 관리: 단가(USD)·USD 합계, 아래에 「하위 협력사 발주」(아직 안 보낸 하위 둘)',
      '위안 협력사 포털 › 발주서: 단가(CNY)',
    ],
    next: '마스터딜러 포털에서 「발주 확인」 → 「하위 발주서 보내기」',
  },
  {
    title: '하위 발주 발행',
    did: '마스터딜러가 자기 발주를 확인하고, 견적 때 정한 하위 둘에게 하위 발주서를 보냈다. 단가는 그때 굳힌 하위 회신가다.',
    look: [
      '마스터딜러 포털 › 하위 협력사 발주: 카드 두 장 「확인 대기」, [확인 처리(대행)]·[삭제], 「포털 계정 없음」',
      '관리자 Case › 마스터딜러 발주 줄 아래 「└ 하위 발주 2건」',
      'Mailpit: 하위 가에게 간 발주 메일(품목·수량·위안 금액)',
    ],
    next: '마스터딜러 포털에서 [확인 처리(대행)] → 택배사·송장을 넣고 [출고 처리(대행)]',
  },
  {
    title: '하위 확인·출고',
    did: '하위 가는 확인·출고(송장)까지, 하위 나는 확인까지 갔다. 계정이 없어 마스터딜러가 대신 찍었다.',
    look: [
      '마스터딜러 포털 › 하위 가 「출고됨」+ 송장·[수령 확인], 하위 나 「확인됨」+ 택배사·송장 입력칸',
      '마스터딜러 포털 › 「아직 받지 않은 발주가 2건」 안내',
      '관리자 Case › 하위 발주 줄: 상태와 송장번호',
    ],
    next: '마스터딜러 포털에서 [수령 확인]',
  },
  {
    title: '마스터딜러 수령',
    did: '하위 발주 둘 다 마스터딜러가 받았다. 샘플피씨비로 보낼 물건이 마스터딜러 손에 있다.',
    look: [
      '마스터딜러 포털 › 하위 발주 카드 둘 다 「수령 완료」, 되돌리기만 남는다',
      '관리자 Case › 하위 발주 2건 「수령 완료」',
    ],
    next: '마스터딜러 포털 › 출하 준비에서 샘플피씨비행 출하 / 관리자 [송금 기록]',
  },
  {
    title: '송금 일부 — 환차',
    did: '관리자가 마스터딜러 발주의 절반을 장부보다 30원 비싼 환율로 지급했다고 적었다. 그 차이가 환차로 드러난다.',
    look: [
      '관리자 Case › 「└ 송금 일부 지급 · 지급/잔액 · 환차 +…원」, [송금 기록]을 펼치면 기록 표',
      '마스터딜러 포털 › 발주서: 「입금 … / … · 잔액 …」(환차는 보이지 않는다)',
    ],
    next: '관리자 [송금 기록] › [잔액 채우기] → [송금 기록 추가]',
  },
  {
    title: '송금 완료',
    did: '마스터딜러 발주 잔금(환율을 비워 고시 환율로 기록)과 원화 발주 전액을 지급했다. 위안 발주는 미지급으로 남겼다.',
    look: [
      '관리자 Case › 마스터딜러 「지급 완료」+ 환차 합, 원화 발주 「지급 완료」(환율·환차 없음), 위안 발주 「미지급」',
      '위안 발주의 [송금 기록]에서 직접 금액·실제 환율을 넣어 환차를 만들어 볼 수 있다',
    ],
    next: '(끝) — 위안 발주 송금을 직접 적어 보기',
  },
];

interface Shot {
  label: string;
  file: string;
}

interface TrailEntry {
  no: number;
  def: StepDef;
  flow: BomMdCase;
  facts: string[];
  shots: Shot[];
}

const tag = (no: number): string => `T${String(no).padStart(2, '0')}`;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(
      `${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

describe.skipIf(!RUN || !DEMO)('흔적 주행 — BOM 외화 회신 + 마스터딜러 중개 열세 칸', () => {
  const rp = createJourneyReport('findings-bom-md-trail', 'BOM 외화·마스터딜러 흔적 주행 리포트');
  const { ledger } = rp;
  const trail: TrailEntry[] = [];

  let stage: BomMdStage;
  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let mdView: E2eSession;
  let cnyView: E2eSession;
  let publicView: E2eSession;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    stage = await ensureBomMdStage();
    customer = await newPhpSession(requireDemoCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mdView = await newSession({ mbId: stage.md.mbId ?? '' }, { partnerModule: 'bom' });
    cnyView = await newSession({ mbId: stage.cny.mbId ?? '' }, { partnerModule: 'bom' });
    publicView = await newSession(null);
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(mdView, '마스터딜러');
    rp.watchHttp(cnyView, '위안 협력사');
  }, 240_000);

  afterAll(async () => {
    writeIndex();
    rp.write({ 고객: customer, 관리자: adminView, 마스터딜러: mdView, 위안협력사: cnyView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  // ── 볼 곳 주소 — 관리자 계정으로 열면 협력사 포털은 대리 접속(actAs)으로 들어간다 ──
  const adminCaseUrl = (flow: BomMdCase): string => `${BASE_URL}/app/admin/smartbom/cases/${flow.quoteId}`;
  const portalUrl = (path: string, partnerId: bigint | number): string =>
    `${BASE_URL}/app/partner/${path}?actAs=${String(num(partnerId))}`;

  /** 화면을 찍는다 — 필수 문구가 안 보이면 그 칸이 실패한다(깨진 화면을 흔적으로 남기지 않는다). */
  const capture = async (no: number, flow: BomMdCase): Promise<Shot[]> => {
    const shots: Shot[] = [];
    const t = tag(no);
    const add = async (
      label: string,
      session: { page: any },
      path: string,
      name: string,
      texts: string[],
    ): Promise<void> => {
      await rp.assertView(session, path, `trail-${t}-${name}`, texts);
      shots.push({ label, file: `trail-${t}-${name}.png` });
    };
    const shotNow = async (label: string, session: { page: any }, name: string): Promise<void> => {
      await rp.shot(session, `trail-${t}-${name}`);
      shots.push({ label, file: `trail-${t}-${name}.png` });
    };

    // 관리자 Case — 모든 칸.
    await add('관리자 Case', adminView, `/app/admin/smartbom/cases/${flow.quoteId}`, 'admin-case', [
      flow.title,
      BOM_MD_ORGS.md.orgName,
    ]);

    // 관리자 [공급사 비교·선정] — 회신이 모이고 아직 검토 중인 칸(04·05).
    if (no === 4 || no === 5) {
      const page = adminView.page;
      await page.getByRole('button', { name: '공급사 비교·선정', exact: true }).click();
      await page.getByText('협력사 외화 환율(이 견적에 고정)').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await shotNow('관리자 공급사 비교·선정', adminView, 'admin-compare');
    }
    // 관리자 [발주서 생성] 창 — 입금 뒤 발주 전(07).
    if (no === 7) {
      const page = adminView.page;
      await page.getByRole('button', { name: '발주서 생성', exact: true }).click();
      await page.getByText('지급)').first().waitFor({ timeout: 30_000 });
      await shotNow('관리자 발주서 생성 창', adminView, 'admin-po-create');
    }
    // 관리자 송금 기록 펼침 — 12·13.
    if (no >= 12) {
      const page = adminView.page;
      await page.locator('[data-testid="bom-po-extras"]').first().getByRole('button', { name: '송금 기록', exact: true }).click();
      await page.locator('[data-testid="bom-remittance-editor"]').first().getByRole('button', { name: '송금 기록 추가' }).waitFor({ timeout: 30_000 });
      await shotNow('관리자 송금 기록', adminView, 'admin-remittance');
    }

    // 마스터딜러 포털 — 발주 전에는 견적요청, 발주 뒤에는 발주서.
    if (no < 8) {
      await add('마스터딜러 포털 · 견적요청', mdView, `/app/partner/bom/rfqs/${String(flow.mdRfqId)}`, 'md-rfq', [
        flow.title,
        no >= 6 ? '마감된 견적 요청입니다' : '하위 협력사에 다시 요청',
      ]);
    } else {
      await add('마스터딜러 포털 · 발주서', mdView, `/app/partner/bom/pos/${String(flow.mdPoId)}`, 'md-po', [
        flow.title,
        '하위 협력사 발주',
      ]);
      await add('위안 협력사 포털 · 발주서', cnyView, `/app/partner/bom/pos/${String(flow.cnyPoId)}`, 'cny-po', [
        flow.title,
        '단가(CNY)',
      ]);
    }

    // 하위 회신 페이지(무로그인) — 재요청이 살아 있는 칸(02~05).
    if (no >= 2 && no <= 5 && flow.childA !== null) {
      await add('하위 회신 페이지(로그인 없음)', publicView, `/app/rfq-reply/${flow.childA.magicToken}`, 'child-reply', [
        flow.title,
        BOM_MD_ORGS.md.orgName,
        '단가(CNY)',
      ]);
    }

    // 고객 화면 — 회신 확정 뒤.
    if (no >= 6) {
      await add('고객 화면', customer, `/app/bom/${flow.quoteId}`, 'customer', [flow.title]);
    }
    return shots;
  };

  for (const [index, def] of STEPS.entries()) {
    const no = index + 1;
    test(
      `${tag(no)}. ${def.title} — 여기서 멈춘다`,
      async () => {
        const title = `[BOM 흔적 ${tag(no)}] ${def.title} · ${STAMP}`;
        const flow = await BomMdCase.seed(
          stage,
          customer.mbId,
          title,
          `[흔적 주행 ${STAMP}] ${tag(no)} 「${def.title}」까지 진행하고 멈춘 Case 입니다. 다음 칸: ${def.next}`,
        );
        const facts = await flow.advanceTo(no, { customer, rp, prefix: `trail-${tag(no)}-order` });
        const shots = await capture(no, flow);
        trail.push({ no, def, flow, facts: facts[facts.length - 1] ?? [], shots });
        ledger.push(
          `${tag(no)} ${def.title} — sp_bom_quote #${flow.quoteId}${flow.odId === '' ? '' : ` · 주문 ${flow.odId}`}${
            flow.mdPoId === 0 ? '' : ` · 발주 #${String(flow.mdPoId)}/#${String(flow.cnyPoId)}/#${String(flow.krwPoId)}`
          }`,
        );
      },
      420_000,
    );
  }

  // ── 대장(HTML) — 칸별 한 일·볼 곳·값·스크린샷 ───────────────────────────────
  function writeIndex(): void {
    if (trail.length === 0) return;
    const link = (href: string, text: string): string =>
      `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
    const linksOf = (entry: TrailEntry): string[] => {
      const { flow, no } = entry;
      const links = [link(adminCaseUrl(flow), '관리자 Case')];
      links.push(
        no < 8
          ? link(portalUrl(`bom/rfqs/${String(flow.mdRfqId)}`, stage.md.id), '마스터딜러 포털 · 견적요청(대리 접속)')
          : link(portalUrl(`bom/pos/${String(flow.mdPoId)}`, stage.md.id), '마스터딜러 포털 · 발주서(대리 접속)'),
      );
      links.push(
        no < 8
          ? link(portalUrl(`bom/rfqs/${String(flow.cnyRfqId)}`, stage.cny.id), '위안 협력사 포털(대리 접속)')
          : link(portalUrl(`bom/pos/${String(flow.cnyPoId)}`, stage.cny.id), '위안 협력사 포털 · 발주서(대리 접속)'),
      );
      links.push(
        no < 8
          ? link(portalUrl(`bom/rfqs/${String(flow.krwRfqId)}`, stage.krw.id), '원화 협력사 포털(대리 접속)')
          : link(portalUrl(`bom/pos/${String(flow.krwPoId)}`, stage.krw.id), '원화 협력사 포털 · 발주서(대리 접속)'),
      );
      if (flow.childA !== null && flow.childB !== null) {
        links.push(link(`${BASE_URL}/app/rfq-reply/${flow.childA.magicToken}`, '하위 가 회신 페이지(로그인 없음)'));
        links.push(link(`${BASE_URL}/app/rfq-reply/${flow.childB.magicToken}`, '하위 나 회신 페이지(로그인 없음)'));
      }
      if (no >= 9) {
        links.push(link(portalUrl('bom/pos', stage.childAId), '하위 가 포털 · 받은 발주(대리 접속)'));
      }
      if (no >= 6) links.push(link(`${BASE_URL}/app/bom/${flow.quoteId}`, '고객 화면(데모 고객 로그인)'));
      return links;
    };

    const sections = trail
      .map(
        (entry) => `
<section id="${tag(entry.no)}">
  <h2><span class="no">${tag(entry.no)}</span> ${esc(entry.def.title)}</h2>
  <p class="did">${esc(entry.def.did)}</p>
  <div class="cols">
    <div>
      <h3>볼 곳</h3>
      <ul>${entry.def.look.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="links">${linksOf(entry).join(' · ')}</p>
    </div>
    <div>
      <h3>이 칸에서 나온 값</h3>
      <ul class="facts">${entry.facts.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="ids">견적 #${esc(entry.flow.quoteId)}${entry.flow.odId === '' ? '' : ` · 주문 ${esc(entry.flow.odId)}`}${
        entry.flow.mdPoId === 0 ? '' : ` · 발주 #${String(entry.flow.mdPoId)}`
      }${entry.flow.mdPoA === 0 ? '' : ` · 하위 발주 #${String(entry.flow.mdPoA)}·#${String(entry.flow.mdPoB)}`}</p>
      <p class="next"><b>이어서 해 볼 것</b> — ${esc(entry.def.next)}</p>
    </div>
  </div>
  <div class="shots">${entry.shots
    .map(
      (shot) =>
        `<figure><a href="${esc(shot.file)}" target="_blank"><img src="${esc(shot.file)}" alt="${esc(shot.label)}" loading="lazy"></a><figcaption>${esc(shot.label)}</figcaption></figure>`,
    )
    .join('')}</div>
</section>`,
      )
      .join('\n');

    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BOM 외화·마스터딜러 흔적 대장</title>
<style>
  :root { --fg:#1b2434; --muted:#5d6b82; --line:#dfe5ee; --bg:#f6f8fb; --card:#fff; --accent:#0f766e; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 20px 80px; background:var(--bg); color:var(--fg); font:14px/1.6 'Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif; }
  main { max-width:1180px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .lede { color:var(--muted); margin:0 0 16px; }
  nav { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; }
  nav a { padding:3px 9px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--fg); text-decoration:none; font-size:12px; }
  table { border-collapse:collapse; width:100%; background:var(--card); border:1px solid var(--line); margin:0 0 20px; font-size:13px; }
  th, td { border-bottom:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
  th { background:#eef2f7; font-weight:600; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin:0 0 18px; }
  h2 { font-size:17px; margin:0 0 6px; }
  h3 { font-size:13px; margin:10px 0 4px; color:var(--muted); font-weight:600; }
  .no { display:inline-block; padding:1px 8px; border-radius:6px; background:var(--accent); color:#fff; font-size:13px; margin-right:6px; }
  .did { margin:0 0 6px; }
  .cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:4px 28px; }
  .cols > div { min-width:0; }
  ul { margin:0; padding-left:18px; }
  .facts li { font-variant-numeric:tabular-nums; }
  .links { margin:8px 0 0; font-size:12px; }
  .ids { margin:6px 0 0; color:var(--muted); font-size:12px; }
  .next { margin:6px 0 0; padding:6px 10px; background:#f0fdfa; border:1px solid #c7ebe5; border-radius:8px; font-size:13px; }
  a { color:#1d4ed8; }
  .shots { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; margin-top:14px; }
  figure { margin:0; }
  figure img { width:100%; height:190px; object-fit:cover; object-position:top; border:1px solid var(--line); border-radius:8px; display:block; }
  figcaption { font-size:12px; color:var(--muted); margin-top:3px; }
</style>
</head>
<body>
<main>
  <h1>BOM 외화 회신 + 마스터딜러 중개 — 흔적 대장</h1>
  <p class="lede">${esc(STAMP)} 주행 · 칸마다 Case 를 하나씩 멈춰 남겼습니다. 제목이 「[BOM 흔적 Txx]」로 시작합니다. 설계는 docs/SMARTBOM_PARTNER_RFQ.md §6.41~6.44.</p>

  <table>
    <tr><th>누가</th><th>조직</th><th>통화</th><th>어떻게 들어가나</th></tr>
    <tr><td>관리자</td><td>—</td><td>—</td><td>관리자 계정으로 로그인하면 아래 「대리 접속」 링크가 그 조직의 포털로 바로 들어갑니다.</td></tr>
    <tr><td>마스터딜러</td><td>${esc(BOM_MD_ORGS.md.orgName)}</td><td>USD</td><td>${link(portalUrl('bom', stage.md.id), '포털(대리 접속)')}</td></tr>
    <tr><td>하위 가 / 하위 나</td><td>${esc(BOM_MD_CHILDREN.a.name)} / ${esc(BOM_MD_CHILDREN.b.name)}</td><td>CNY / USD</td><td>계정 없음 — 견적 회신은 칸별 「회신 페이지」 링크, 발주는 ${link(portalUrl('bom/pos', stage.childAId), '하위 가 포털(대리 접속)')}</td></tr>
    <tr><td>위안 협력사</td><td>${esc(BOM_MD_ORGS.cny.orgName)}</td><td>CNY</td><td>${link(portalUrl('bom', stage.cny.id), '포털(대리 접속)')}</td></tr>
    <tr><td>원화 협력사</td><td>${esc(BOM_MD_ORGS.krw.orgName)}</td><td>KRW</td><td>${link(portalUrl('bom', stage.krw.id), '포털(대리 접속)')}</td></tr>
    <tr><td>고객</td><td>데모 고객(${esc(customer.mbId)})</td><td>KRW</td><td>그 계정으로 로그인 → ${link(`${BASE_URL}/app/bom`, '부품 견적')}</td></tr>
    <tr><td>메일</td><td colspan="3">${link(MAILPIT_URL, 'Mailpit')} — 견적요청·하위 재요청·발주·하위 발주 메일이 쌓여 있습니다.</td></tr>
  </table>

  <nav>${trail.map((entry) => `<a href="#${tag(entry.no)}">${tag(entry.no)} ${esc(entry.def.title)}</a>`).join('')}</nav>
${sections}
</main>
</body>
</html>`;
    mkdirSync(join(outputDir, 'journey'), { recursive: true });
    const file = join(outputDir, 'journey', 'trail-bom-md.html');
    writeFileSync(file, html, 'utf8');
    console.log(`\n흔적 대장: ${file}`);
  }
});
