// PCB 인보이스 생성기 [엑셀 생성·첨부] — **첨부가 화면에 즉시 보이는가**
// (사용자 보고, 2026-08-14: "동작은 정상으로 보이는데 첨부 표시가 안 된다").
//
// 원인은 서버가 아니라 프론트였다: 모달에 주입한 attachXlsx 가 뮤테이션이 아니라
// **맨 API 호출**이라 vue-query 캐시가 안 깨졌다 — 파일은 붙는데 보드는 옛 응답을
// 그대로 그려 '✓ 첨부됨'도, ① 잠금 문구 해제도 새로고침해야 보였다.
//
// 그래서 이 편의 표적은 **DB 가 아니라 화면**이다. API 레벨로만 재면 결함이 있어도
// 늘 통과한다(파일은 실제로 저장되니까) — 새로고침 없이 카드가 바뀌는지를 본다.
//
// 실행: pnpm -F e2e pcb:invoice
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  gotoApp,
  newSession,
  num,
  pickFreeSpecs,
  signJwt,
  snap,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

// 인보이스·AWB 자리는 **국제 발송에만** 선다(서버도 국제에서만 첨부를 본다) — 보내는측
// 국가가 받는측(관리자=KR)과 달라야 mode='international'. 후보 중 비KR 조직을 쓴다.
const SENDER_CANDIDATES = ['tester2협력', '협력2', '협력1'] as const;

describe.skipIf(!RUN)('PCB 인보이스 생성기 — 엑셀 생성·첨부의 화면 반영', () => {
  let sender: PartnerFixture;
  let view: E2eSession;
  let P = '';
  let poId = 0;
  /** 카드 앵커 — 같은 화면의 다른 발송 카드에도 같은 문구의 버튼이 선다(진행 중 발송). */
  let shipmentId = 0;
  const createdPoIds: bigint[] = [];

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`);
    if (!health.ok) throw new Error('API가 실행 중이 아닙니다 — pnpm dev:api');

    // 보내는측 고르기 — 비KR + 연결계정 + **준비 중 박스 0개**. 남은 박스가 있으면
    // 보드에 [이 박스로 발송 준비] 버튼이 여러 개 서서 어느 것이 우리 것인지 못 가른다.
    const tried: string[] = [];
    for (const name of SENDER_CANDIDATES) {
      let p: PartnerFixture;
      try {
        p = await getPartner(name);
      } catch {
        tried.push(`${name}: 조직 없음`);
        continue;
      }
      if (p.mbId === null || p.country === null || p.country === 'KR') {
        tried.push(`${name}: 국가=${p.country ?? '없음'} 계정=${p.mbId ?? '없음'}`);
        continue;
      }
      const board = await api(signJwt({ mbId: p.mbId }), 'GET', '/api/partner/pcb-shipments');
      const boxes: any[] = board.json?.data?.boxes ?? [];
      if (boxes.length > 0) {
        tried.push(`${name}: 준비 중 박스 ${String(boxes.length)}개 잔재`);
        continue;
      }
      sender = p;
      break;
    }
    if (sender === undefined) {
      throw new Error(`쓸 수 있는 국제 협력사가 없습니다 — ${tried.join(' / ')}`);
    }
    P = signJwt({ mbId: sender.mbId as string });

    // destinationCountry=null = 관리자(샘플피씨비)행 — 보내는측 CN ≠ 받는측 KR 이라 국제.
    const [spec] = await pickFreeSpecs(1);
    const po = await createPcbPo({ specId: spec.id, partnerId: sender.id });
    createdPoIds.push(po.id);
    poId = num(po.id);

    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    const mine = (box.json?.data?.boxes ?? []).find((b: any) => b.poIds?.includes(poId));
    expect(mine, '담은 박스를 보드 응답에서 찾지 못했습니다').toBeTruthy();
    expect(mine.mode, '국제 모드가 아니면 인보이스 생성기 자리가 서지 않는다').toBe(
      'international',
    );
    expect(mine.files, '새 박스에 첨부가 이미 있으면 화면 판정이 오탐한다').toEqual([]);
    shipmentId = Number(mine.shipmentId);

    view = await newSession({ mbId: sender.mbId as string }, { partnerModule: 'pcb' });
  }, 120_000);

  afterAll(async () => {
    await view?.close();
    await closeBrowser();
    await cleanupPcbPos(createdPoIds);
    expect(await countPcbResidue(createdPoIds)).toEqual({
      pos: 0,
      shipments: 0,
      memberships: 0,
    });
    await disconnectPrisma();
  }, 60_000);

  test('[엑셀 생성·첨부] 직후, 새로고침 없이 카드가 첨부를 말한다', async () => {
    const { page } = view;
    await gotoApp(page, '/partner/pcb/ship');

    // 박스 → 카드 전개(체크리스트: ①인보이스 → ②발송 방식 → ③출고예정일).
    await page.getByText(`PO-${String(poId)}`).first().waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /이 박스로 발송 준비/ }).click();

    // 이 협력사에 진행 중 발송이 더 있으면 같은 문구의 버튼이 여럿 선다 — 카드는
    // 발송번호(SH-)로 특정한다(카드 루트에만 있는 앵커).
    const card = page.locator('section').filter({ hasText: `SH-${String(shipmentId)}` }).first();
    const lockNote = card.getByText('① 인보이스를 첨부해야 진행할 수 있습니다.');
    await lockNote.waitFor({ timeout: 15_000 });
    expect(await card.getByText('✓ 첨부됨').count(), '첨부 전인데 첨부됨 표시').toBe(0);

    // 생성기 → 엑셀 생성·첨부(서버 렌더 xlsx 를 그대로 Invoice 로 올린다).
    await card.getByRole('button', { name: /인보이스 생성기/ }).click();
    const attachBtn = page.getByRole('button', { name: '엑셀 생성·첨부' });
    await attachBtn.waitFor({ timeout: 20_000 });
    await attachBtn.click();

    // ── 표적: **새로고침 없이** 카드가 바뀐다 ──────────────────────────────
    // 첨부 성공 시 모달이 스스로 닫히므로, 닫힘만 보면 결함이 있어도 통과한다.
    // 카드의 두 표시(첨부됨 배지 · ① 잠금 해제)를 모두 확인해야 진짜 갱신이다.
    await card.getByText('✓ 첨부됨').waitFor({ timeout: 30_000 });
    await lockNote.waitFor({ state: 'detached', timeout: 15_000 });
    await snap(page, 'pcb-invoice-attach');

    // 서버에도 실제로 붙었는가(화면만 바뀌고 저장이 안 되는 반대 결함 차단).
    const detail = await api(P, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    const files: any[] = detail.json?.data?.shipment?.files ?? [];
    const invoice = files.find((f) => f.fileType === 'invoice');
    expect(invoice, `선적 첨부에 invoice 가 없다: ${JSON.stringify(files)}`).toBeTruthy();
    expect(String(invoice.name)).toMatch(/\.xlsx$/);
    expect(view.pageErrors, view.pageErrors.join(' / ')).toEqual([]);
  }, 120_000);
});
