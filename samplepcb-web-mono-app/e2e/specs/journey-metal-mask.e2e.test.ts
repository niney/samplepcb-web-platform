// 메탈마스크(스텐실) 트랙 — EQ 왕복 대신 **고객문의사항 + 좌표파일**.
//
// 메탈마스크는 제조 확인 질의를 주고받을 것이 없다. 그래서 그 자리를 협력사가 문의사항을
// 적고 좌표파일을 올리는 것으로 대신하고, 관리자는 확인만 한다(사용자 결정 2026-08-16).
// 나머지 단계(생산·발송)는 전부 그대로다.
//
// 설계상 **status 5단계를 포크하지 않았다** — 칸의 개수·주체·순서가 같기 때문이다. 갈리는
// 것은 ①그 칸에서 무엇을 반드시 내야 하는가 ②뭐라고 부르는가, 둘뿐이다. 이 주행이 지키는
// 것도 그 경계다: 갈려야 할 것이 갈리는가, **안 갈려야 할 것이 안 갈리는가**.
//
// 표적:
//   ① **제출 게이트** — 좌표파일 없이는 못 넘어간다(서버가 판정). 고객문의사항은
//      **선택**이다(2026-08-17 필수 해제) — 없이도 넘어가고, 적으면 이력에 실린다.
//   ② **문의사항은 새 컬럼이 아니다** — eqHistory 의 note 에 실려 타임라인에 그대로 선다.
//   ③ **고객 열람은 확인 뒤에만** — 그 전엔 보완 요청으로 파일이 바뀔 수 있고, 반려된
//      좌표로 고객이 설비를 잡는 것이 이 기능의 최악이다.
//   ④ **통보는 없다** — 확인 요청도 메일도 만들지 않는다. 주문내역을 열면 거기 있다.
//   ⑤ **이름이 중립화된다** — 협력사가 붙인 원본 파일명이 고객에게 그대로 가면 공급망이
//      샌다(이 트랙이 내내 막아 온 축 — 여정 43호).
//   ⑥ **남의 것은 못 받는다** — 목록에 실렸다는 사실을 서버가 신뢰하지 않는다.
//   ⑦ **EQ 트랙은 안 흔들린다** — 표준 PCB 는 종전대로 첨부 없이도 승인요청이 된다.
//
// 실행: pnpm -F e2e vitest run journey-metal-mask  (PORTAL_E2E=1)
// 발주서는 시드로 직삽입한다(확인 축만 보는 주행이라 견적·주문 경로를 태울 이유가 없다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
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
  gotoApp,
  newSession,
  requireCustomerCreds,
  signJwt,
  snap,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const OWNER = '협력2';

interface StencilFixture {
  specId: bigint;
  projectName: string;
  mbId: string;
  odId: string;
}

describe.skipIf(!RUN)('메탈마스크 — 고객문의사항 + 좌표파일로 EQ 를 대신한다', () => {
  let owner: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 협력사
  let C = ''; // 좌표파일을 볼 고객(= 스펙 소유자)
  let mm: StencilFixture;
  let orderFixture: G5OrderFixture | undefined;
  let poId = 0;
  let stdSpecId = 0n; // 회귀 대조용 표준(EQ 트랙) 스펙
  let stdPoId = 0;
  let coordFileId = 0;
  const seeded: bigint[] = [];
  const NOTE = '앞면만 도포합니다 — 스텐실 면 확인 부탁드립니다.';
  // 협력사 이름이 박힌 원본 파일명. 고객 화면에 이 문자열이 남으면 공급망이 새는 것이다.
  const RAW_COORD_NAME = '협력2제작소_좌표데이터_v3.xlsx';

  const upload = async (
    token: string,
    path: string,
    fileType: string,
    fileName: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    form.set('fileType', fileType);
    form.set(
      'file',
      new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer], fileName, {
        type: 'application/zip',
      }),
    );
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

  /** 고객 주문내역의 제작 진행 카드 — 이 스펙의 항목 하나. */
  const progressItem = async (token = C): Promise<any> => {
    const res = await api(token, 'GET', `/api/pcb-progress?odId=${encodeURIComponent(mm.odId)}`);
    expect(res.status, `진행 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.items ?? []).find((i: any) => i.specId === Number(mm.specId)) ?? null;
  };

  const submit = (note?: string): Promise<{ status: number; json: any }> =>
    api(
      P,
      'POST',
      `/api/partner/pcb-pos/${String(poId)}/eq-request`,
      note === undefined ? {} : { note },
    );

  beforeAll(async () => {
    const prisma = getPrisma();
    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });

    // 무대는 **통째로 만든다**(주문 + 카트행 + 스펙). 고객 열람 축은 od 가 배송·완료·
    // 취소가 아닐 때만 뜨는데, 실데이터의 metalMask 1,275건이 **전부 완료·취소**다
    // (협력 트랙 자체가 신규라 당연하다 — 실측 2026-08-16). 남의 실주문 상태를 잠깐
    // 바꿔 쓰는 건 공유 DB 에서 할 짓이 아니므로 e2e 소유 픽스처로 세운다.
    const customerId = requireCustomerCreds(1).id;
    const order = await createG5OrderFixture(customerId, 'e2e 메탈마스크');
    orderFixture = order;
    const spec = await createOrderSpec({
      mbId: customerId,
      ctId: order.ctId,
      projectName: `E2E-MM-${String(Date.now())}`,
      category: 'metalMask',
      // 거버가 metalMask 에 묻는 축(스텐실 면·두께) — 화면 요약이 이 키를 읽는다.
      specJson: { framework: '자체제작', stencilSide: '앞면', stThickness: '0.12T' },
    });
    mm = {
      specId: spec.id as bigint,
      projectName: String(spec.projectName),
      mbId: customerId,
      odId: order.odId,
    };
    C = signJwt({ mbId: mm.mbId, ttlSec: 3600 });

    const po = await createPcbPo({ specId: mm.specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);

    // 회귀 대조 — 같은 코드 경로를 타는 표준(EQ 트랙) 발주 하나(실스펙에서 고른다).
    const used = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
      (r: any) => r.specId,
    );
    const std = await prisma.spOrderSpec.findFirst({
      where: { category: 'standard', status: 'active', id: { notIn: used } },
      orderBy: { id: 'desc' },
    });
    if (std === null) throw new Error('여유 standard 스펙이 없습니다');
    stdSpecId = std.id;
    const stdPo = await createPcbPo({ specId: std.id, partnerId: owner.id, status: 'issued' });
    stdPoId = Number(stdPo.id);
    seeded.push(stdPo.id);
  });

  afterAll(async () => {
    const prisma = getPrisma();
    // 첨부는 PO 삭제로 안 지워진다(sp_file 은 refType/refId 로만 묶인다) — 직접 정리.
    const ids = [poId, stdPoId].filter((n) => n > 0).map((n) => BigInt(n));
    if (ids.length > 0) {
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: { in: ids } } });
    }
    await cleanupPcbPos(seeded);
    // 내가 만든 무대만 지운다 — 스펙 → 주문(카트 포함) 순(발주가 스펙을 참조한다).
    if (mm !== undefined) {
      await prisma.spOrderSpec.deleteMany({ where: { id: mm.specId } });
    }
    if (orderFixture !== undefined) await deleteOrderHard(orderFixture.odId);

    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    if (orderFixture !== undefined) {
      expect(await countCartRows(orderFixture.odId), '시드 카트 잔재').toBe(0);
    }
    await closeBrowser();
    await disconnectPrisma();
  });

  test('M1. 빈손으로는 확인 요청이 안 된다 — 좌표파일이 필수다(문의사항은 이제 안 막는다)', async () => {
    const res = await submit();
    expect(res.status, `빈 제출: ${JSON.stringify(res.json)}`).toBe(409);
    expect(res.json?.error).toBe('COORD_FILE_REQUIRED');
    expect(String(res.json?.message)).toContain('좌표파일');

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, '막혔으면 상태가 안 움직인다').toBe('issued');
  });

  test('M2. 문의사항을 적어도 좌표파일 없인 안 된다 — 다른 종류로는 대신 못 채운다', async () => {
    const res = await submit(NOTE);
    expect(res.status, `좌표 없는 제출: ${JSON.stringify(res.json)}`).toBe(409);
    expect(res.json?.error).toBe('COORD_FILE_REQUIRED');

    // **다른 종류로는 대신 못 채운다** — 종류를 만든 이유가 이 게이트다.
    // inquiry(문의 사진)도 마찬가지 — 문의에 곁들이는 사진이지 좌표가 아니다.
    const eqFile = await upload(P, `/api/partner/pcb-pos/${String(poId)}/eq-files`, 'eq', 'q.zip');
    expect(eqFile.status, 'eq 첨부 자체는 올라간다').toBe(200);
    const photo = await upload(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      'inquiry',
      'photo1.png',
    );
    expect(photo.status, '문의 사진 첨부 자체는 올라간다').toBe(200);
    const again = await submit(NOTE);
    expect(again.status, 'eq·inquiry 첨부는 좌표파일을 대신하지 못한다').toBe(409);
    expect(again.json?.error).toBe('COORD_FILE_REQUIRED');
  });

  test('M3. 협력사 화면 — 필수(좌표파일)와 선택(문의사항·사진)이 갈려 보인다', async () => {
    const up = await upload(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      'coord',
      RAW_COORD_NAME,
    );
    expect(up.status, `좌표파일 업로드: ${JSON.stringify(up.json)}`).toBe(200);

    // 제출 **전**(issued)에 본다 — 첨부·문의사항 칸이 열려 있는 유일한 구간이다.
    const session = await newSession({ mbId: owner.mbId ?? '', ttlSec: 3600 });
    try {
      await gotoApp(session.page, `/partner/pcb/pos/${String(poId)}`);
      await session.page.waitForLoadState('networkidle');
      const body = await session.page.locator('body').innerText();

      expect(body, '할 일이 한 문장으로 못박힌다').toContain('좌표파일을 올린 뒤 확인 요청');
      expect(body, '고객이 본다는 사실을 미리 알린다').toContain('고객도 주문내역에서');
      expect(body, '좌표파일이 붙은 것이 보인다').toContain('＋ 좌표파일 (1)');
      expect(body, '문의사항은 선택임을 밝힌다').toContain('고객문의사항 (선택)');
      expect(body, '문의 사진 칸이 열려 있다(M2 에서 1장 첨부)').toContain('＋ 문의 사진 (1)');
      // 스텐실에는 EQ 어휘가 안 나온다 — 스텝퍼 라벨까지.
      expect(body, '확인 요청 칸').toContain('확인 요청');
      expect(body, '확인 완료 칸').toContain('확인 완료');
      expect(body, 'EQ 승인요청 라벨은 없다').not.toContain('EQ 승인요청');
      // 업로드 버튼은 좌표파일·문의 사진뿐이다(EQ 질의서·Working 칸을 열지 않는다).
      expect(body, 'Working 업로드 칸은 없다').not.toContain('＋ Working 데이터');
      await snap(session.page, 'metal-mask-partner-submit');
    } finally {
      await session.context.close();
    }
  });

  test('M4. 좌표파일만으로 확인 요청이 넘어간다 — 문의사항은 선택이고, 적으면 이력에 남는다', async () => {
    // ① 무메모 제출이 통과한다(필수 해제의 서버 증명) — 취소 후 문의를 실어 다시 보낸다.
    //    취소(요청 취소)는 note 를 안 남기므로 반려 판정과 안 섞인다(15호 명세).
    const bare = await submit();
    expect(bare.status, `무메모 제출: ${JSON.stringify(bare.json)}`).toBe(200);
    const revert = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-revert`);
    expect(revert.status, `요청 취소: ${JSON.stringify(revert.json)}`).toBe(200);

    // ② 문의사항을 실은 제출 — 이력의 note 로 실린다.
    const res = await submit(NOTE);
    expect(res.status, `확인 요청: ${JSON.stringify(res.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, '확인 요청 상태(EQ 와 같은 칸)').toBe('eq_requested');
    // 새 컬럼이 아니라 전이 이력의 note — 타임라인이 이미 그리는 자리다.
    const history = (po?.eqHistory ?? []) as any[];
    const last = history[history.length - 1];
    expect(last?.toStatus, '마지막 전이').toBe('eq_requested');
    expect(last?.note, '고객문의사항이 이력에 실린다').toBe(NOTE);

    // 첨부는 이제 잠긴다(EQ 트랙과 같은 규칙) — 이 잠금이 고객 열람의 전제다.
    const locked = await upload(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      'coord',
      'late.xlsx',
    );
    expect(locked.status, '확인 요청 뒤에는 좌표파일도 잠긴다').toBe(409);
    expect(locked.json?.error).toBe('EQ_LOCKED');
  });

  test('M4.5 관리자 Case — 고객문의사항 본문이 행에서 읽히고, 버튼이 확인의 말을 쓴다', async () => {
    // 확인 완료를 결정하는 화면이 문의 본문을 안 보여 주면 이 트랙의 핑퐁은 빈 껍데기다
    // (2026-08-17 교정 — 종전엔 eqHistory 를 반려 판정에만 쓰고 본문은 버렸다).
    const session = await newSession({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    try {
      await gotoApp(session.page, `/admin/pcb/cases/${mm.specId.toString()}`);
      await session.page.waitForLoadState('networkidle');
      const body = await session.page.locator('body').innerText();

      expect(body, '패널 이름이 트랙을 입는다').toContain('발주서 · 고객문의사항');
      expect(body, '문의 본문이 행에 선다').toContain('앞면만 도포합니다');
      expect(body, '확인 완료 버튼').toContain('확인 완료');
      expect(body, '보완 요청 버튼(반려 아님)').toContain('보완 요청');
      // 사이드바 메뉴명(PCB 발주·EQ)은 전역이라 'EQ' 전면 부재는 못 재고, 행동 어휘만 잰다.
      expect(body, '스텐실 Case 에 EQ 승인 버튼은 없다').not.toContain('EQ 승인');
      expect(body, 'EQ 첨부 칸 이름도 트랙을 입는다').not.toContain('EQ 첨부');
      await snap(session.page, 'metal-mask-admin-case');
    } finally {
      await session.context.close();
    }
  });

  test('M5. 확인 전에는 고객에게 좌표파일이 안 보인다', async () => {
    const item = await progressItem();
    expect(item, '진행 카드는 뜬다(발주가 있으니)').toBeTruthy();
    expect(item.coordFile, '확인 전에는 파일이 없다').toBeNull();
    // EQ 라는 말이 메탈마스크 고객에게 나가지 않는다.
    expect(item.label, '스텐실 어휘').toBe('제작 전 확인 중');
    expect(String(item.label)).not.toContain('EQ');
  });

  test('M6. 관리자는 확인만 한다 — 같은 전이, 다른 이름', async () => {
    const res = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${mm.specId.toString()}/pos/${String(poId)}/eq-approve`,
    );
    expect(res.status, `확인 완료: ${JSON.stringify(res.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, 'EQ 트랙과 같은 칸으로 간다(라벨만 다르다)').toBe('eq_done');

    // 관리자 목록도 같은 트랙을 안다 — 배지 문구가 여기서 갈린다.
    const list = await api(A, 'GET', `/api/admin/pcb-projects/${mm.specId.toString()}/pos`);
    expect(list.status).toBe(200);
    const row = (list.json?.data?.pos ?? []).find((p: any) => p.poId === poId);
    expect(row?.track, '서버가 트랙을 실어 보낸다').toBe('stencil');
  });

  test('M7. 확인 뒤 — 고객이 통보 없이 내려받는다. 이름은 중립화된다', async () => {
    const item = await progressItem();
    expect(item.coordFile, '확인 뒤에는 좌표파일이 뜬다').toBeTruthy();
    coordFileId = Number(item.coordFile.fileId);

    // ⑤ 공급망 비노출 — 협력사가 붙인 원본 파일명이 고객 화면에 그대로 가면 안 된다.
    expect(item.coordFile.name, '중립 이름').toBe(`부품좌표_${mm.projectName}.xlsx`);
    expect(String(item.coordFile.name)).not.toContain('협력2');
    expect(JSON.stringify(item), '응답 어디에도 협력사명이 없다').not.toContain(OWNER);

    // ④ 통보 없음 — 확인 요청(D16) 행을 만들지 않는다. 고객 화면의 '제조 확인 요청'
    //    섹션은 그대로 비어 있어야 한다(요청도 결정도 없는 열람이다).
    const reviews = await api(
      C,
      'GET',
      `/api/pcb-eq-reviews?odId=${encodeURIComponent(mm.odId)}`,
    );
    expect(reviews.status).toBe(200);
    const mine = (reviews.json?.data?.reviews ?? []).filter(
      (r: any) => r.projectName === mm.projectName,
    );
    expect(mine.length, '좌표파일 공개는 확인 요청을 만들지 않는다').toBe(0);

    const res = await fetch(`${API_URL}/api/pcb-progress/coord-files/${String(coordFileId)}`, {
      headers: { authorization: `Bearer ${C}` },
    });
    expect(res.status, '고객 다운로드').toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition, '내려받는 파일명도 중립').toContain(
      encodeURIComponent(`부품좌표_${mm.projectName}.xlsx`),
    );
    expect(disposition).not.toContain(encodeURIComponent('협력2'));
  });

  test('M8. 남의 좌표파일은 못 받는다 — 목록에 실렸다는 사실을 서버가 안 믿는다', async () => {
    const stranger = signJwt({ mbId: 'e2e-not-the-owner', ttlSec: 600 });
    const res = await fetch(`${API_URL}/api/pcb-progress/coord-files/${String(coordFileId)}`, {
      headers: { authorization: `Bearer ${stranger}` },
    });
    expect(res.status, '소유자가 아니면 못 받는다').toBe(404);

    // 협력사 산출물(eq)은 이 창구로 새지 않는다 — 종류가 곧 공개 권한이다.
    const files = await getPrisma().spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId), fileType: 'eq' },
    });
    const eqFileId = files[0]?.id;
    expect(eqFileId, 'eq 첨부 존재').toBeTruthy();
    const leak = await fetch(
      `${API_URL}/api/pcb-progress/coord-files/${String(Number(eqFileId))}`,
      { headers: { authorization: `Bearer ${C}` } },
    );
    expect(leak.status, 'coord 아닌 첨부는 이 창구로 안 나간다').toBe(404);
  });

  test('M9. 회귀 — 표준(EQ) 트랙은 첨부·문의사항 없이도 종전대로 넘어간다', async () => {
    const res = await api(P, 'POST', `/api/partner/pcb-pos/${String(stdPoId)}/eq-request`);
    expect(res.status, `표준 승인요청: ${JSON.stringify(res.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(stdPoId) } });
    expect(po?.status, 'EQ 트랙은 게이트가 없다').toBe('eq_requested');
    const history = (po?.eqHistory ?? []) as any[];
    expect(history[history.length - 1]?.note, '메모 없는 전이는 note 가 비어 있다').toBeNull();

    const list = await api(A, 'GET', `/api/admin/pcb-projects/${stdSpecId.toString()}/pos`);
    const row = (list.json?.data?.pos ?? []).find((p: any) => p.poId === stdPoId);
    expect(row?.track, '표준은 EQ 트랙').toBe('eq');
  });
});
