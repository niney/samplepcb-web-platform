// EQ 회신 첨부 — **관리자가 협력사에게 되돌려 보내는 파일**.
//
// 지금까지 EQ 첨부는 한 방향뿐이었다: 협력사가 질의서(eq)·작업 데이터(working)를 올리고
// 관리자가 본다. 반려는 **사유 문장 하나**만 돌려보낼 수 있어서, "이 부분을 이렇게 고쳐
// 달라"는 도면·마크업을 줄 방법이 메일 밖에 없었다. 그 반대 방향을 fileType 'reply' 로
// 세우고, 이 주행이 왕복 전체와 경계를 박제한다.
//
// 표적:
//   ① **승인요청 중에도 회신을 붙일 수 있다** — 협력사 산출물은 그때 잠기지만(EQ_LOCKED),
//      회신은 바로 그 순간(eq_requested)에 필요하다. 잠금이 종류별로 갈리는지 본다.
//   ② **협력사는 회신을 만들 수도 지울 수도 없다** — 방향이 뒤집히면 '관리자 회신' 칸에
//      자기 파일이 끼어들고, 받은 지시를 지워 반려 근거가 사라진다.
//   ③ **최신 판정이 오염되지 않는다** — isLatest 는 종류별이라 회신을 올려도 협력사의
//      최신 도면이 밀려나면 안 된다(밀려나면 관리자가 자기 파일을 보고 승인한다).
//   ④ **협력사가 받을 수 있다** — 포털 상세 응답에 회신이 실리고 다운로드가 열린다.
//   ⑤ **반려 메일이 첨부 사실을 알린다** — 파일은 붙이지 않고 "포털에서 받으라"고 한다.
//   ⑥ **왕복이 닫힌다** — 회신 → 보완 → 재요청 → 승인까지 한 바퀴.
//
// 실행: pnpm -F e2e vitest run journey-eq-reply  (PORTAL_E2E=1 — 거버·주문 불필요)
// 발주서는 시드로 직삽입한다(EQ 축만 보는 주행이라 견적·주문 경로를 태울 이유가 없다).
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
  getPrisma,
  gotoApp,
  mailpitMessage,
  mailpitSearch,
  newSession,
  pickFreeSpecs,
  signJwt,
  snap,
  type PartnerFixture,
} from '../helpers';

// 수주 조직(EQ 를 올리는 쪽). ⚠ **contactEmail 이 있는 조직이어야 한다** — 협력1은
// 수신처가 null 이라 반려 메일이 아예 발송되지 않고, E5 가 "메일이 안 온다"로 10초를
// 헛돈다(실측 2026-08-12). 메일 축을 보는 주행은 수신처부터 확인할 것.
const OWNER = '협력2';

describe.skipIf(!RUN)('EQ 회신 첨부 — 관리자 → 협력사 역방향', () => {
  let owner: PartnerFixture;
  let A = ''; // 관리자 토큰
  let P = ''; // 협력사 토큰
  let specId = 0n;
  let poId = 0;
  const seeded: bigint[] = [];

  /** multipart 업로드 — 내용은 검증 대상이 아니라 4바이트 zip 시그니처면 충분하다. */
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

  const download = async (token: string, path: string): Promise<number> =>
    (await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${token}` } })).status;

  const adminEqPath = (suffix = ''): string =>
    `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-files${suffix}`;
  const partnerEqPath = (suffix = ''): string =>
    `/api/partner/pcb-pos/${String(poId)}/eq-files${suffix}`;

  /** 협력사가 보는 상세의 EQ 첨부 목록. */
  const partnerFiles = async (): Promise<any[]> => {
    const res = await api(P, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    expect(res.status, '협력사 상세 조회').toBe(200);
    return res.json?.data?.eq?.files ?? [];
  };

  beforeAll(async () => {
    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });

    const [spec] = await pickFreeSpecs(1);
    specId = spec.id as bigint;
    // 발주접수(issued)에서 시작한다 — 협력사가 첨부를 올릴 수 있는 유일한 구간.
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);
  });

  afterAll(async () => {
    // 첨부는 PO 삭제로 지워지지 않는다(sp_file 은 refType/refId 로만 묶인다) — 직접 정리.
    if (poId > 0) {
      await getPrisma().spFile.deleteMany({
        where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
      });
    }
    await cleanupPcbPos(seeded);
    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  });

  test('E1. 협력사가 EQ·Working 을 올리고 승인요청한다', async () => {
    for (const fileType of ['eq', 'working'] as const) {
      const up = await upload(P, partnerEqPath(), fileType, `${fileType}-v1.zip`);
      expect(up.status, `${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const advance = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(advance.status, `승인요청: ${JSON.stringify(advance.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, '승인요청 상태').toBe('eq_requested');
  });

  test('E2. 승인요청 중 — 협력사 산출물은 잠기고 관리자 회신은 열린다', async () => {
    // 협력사 산출물은 이 구간에서 바뀌면 안 된다(무엇을 보고 승인했는지가 사라진다).
    const locked = await upload(A, adminEqPath(), 'working', 'working-v2.zip');
    expect(locked.status, '승인요청 중 협력사 산출물 업로드는 잠김').toBe(409);
    expect(locked.json?.error).toBe('EQ_LOCKED');

    // 회신은 **바로 이 순간** 필요하다 — 받아 보고 "고쳐 달라"고 말하는 자리다.
    const reply = await upload(A, adminEqPath(), 'reply', 'markup-v1.zip');
    expect(reply.status, `회신 첨부 업로드: ${JSON.stringify(reply.json)}`).toBe(200);
  });

  test('E3. 최신 판정이 종류별로 갈린다 — 회신이 협력사 도면을 밀어내지 않는다', async () => {
    const files = await partnerFiles();
    const latestOf = (t: string): any => files.find((f) => f.fileType === t && f.isLatest);
    expect(latestOf('eq')?.name, 'eq 최신은 협력사 것 그대로').toBe('eq-v1.zip');
    expect(latestOf('working')?.name, 'working 최신은 협력사 것 그대로').toBe('working-v1.zip');
    expect(latestOf('reply')?.name, '회신도 자기 종류 안에서 최신').toBe('markup-v1.zip');
    expect(
      files.filter((f) => f.fileType === 'reply')[0]?.uploadedBy,
      '회신은 관리자가 올린 것으로 남는다',
    ).toBe('ADMIN');
  });

  test('E4. 협력사는 회신을 만들 수도 지울 수도 없다', async () => {
    const forged = await upload(P, partnerEqPath(), 'reply', 'fake-reply.zip');
    expect(forged.status, '협력사의 회신 업로드는 거부').toBe(400);
    expect(String(forged.json?.message)).toContain('관리자만');

    const files = await partnerFiles();
    const replyId = files.find((f) => f.fileType === 'reply')?.fileId as number;
    expect(replyId, '회신 파일 id').toBeTruthy();

    const del = await api(P, 'DELETE', partnerEqPath(`/${String(replyId)}`));
    expect(del.status, '협력사의 회신 삭제는 거부').toBe(409);
    expect(del.json?.error).toBe('REPLY_READONLY');

    // 거부가 "권한 때문"임을 보이려면 받을 수는 있어야 한다(읽기는 열려 있다).
    expect(
      await download(P, partnerEqPath(`/${String(replyId)}`)),
      '협력사는 회신을 내려받을 수 있다',
    ).toBe(200);
  });

  test('E5. 반려 — 메일이 첨부 사실을 알린다(파일은 붙이지 않는다)', async () => {
    // 공백 없는 고유 토큰 — Mailpit 검색은 공백을 AND 로 쪼개므로 한 낱말이 안전하고,
    // 주행마다 달라야 **이번** 메일을 집는다(고정 문구로 찾으면 과거 메일이 통과시킨다).
    const token = `e2e-eqreply-${String(Date.now())}`;
    const reason = `실크 위치를 좌측으로 옮겨 주세요 (${token})`;
    const rejected = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`,
      { reason },
    );
    expect(rejected.status, `반려: ${JSON.stringify(rejected.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, '반려는 발주접수로 되돌린다').toBe('issued');

    // 메일은 비동기(void sendPcbMail)라 **폴링**한다 — 고정 대기는 느린 날 거짓 실패,
    // 빠른 날 과거 메일 오검출을 부른다.
    let hit: any = null;
    for (let i = 0; i < 20 && hit === null; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      hit = ((await mailpitSearch(token))?.messages ?? [])[0] ?? null;
    }
    expect(hit, '이번 반려 메일 수신(10초 내)').toBeTruthy();

    const full = await mailpitMessage(String(hit.ID));
    const html = String(full?.HTML ?? '');
    expect(html).toContain(reason); // 사유가 그대로 나간다(대외 문구)
    // 핵심 — 파일은 붙이지 않고 "포털에서 받으라"고 말한다.
    expect(html, '첨부 건수 안내').toContain('수정 지시 첨부');
    expect(html, '회신 1건').toContain('<b>1건</b>');
    expect(html, '받는 경로 안내').toContain('관리자 회신');
    expect(full?.Attachments?.length ?? 0, '메일에 파일을 붙이지는 않는다').toBe(0);
  });

  test('E6. 협력사 화면 — 반려가 대화 한 줄기로 읽힌다', async () => {
    // API 가 옳아도 협력사가 **화면에서** 못 읽으면 왕복이 늘어난다. 반려 직후 상태(issued)
    // 에서 포털 상세를 열어 타임라인·지금 할 일·회신 첨부가 실제로 보이는지 확인한다.
    const session = await newSession({ mbId: owner.mbId ?? '', ttlSec: 3600 });
    try {
      await gotoApp(session.page, `/partner/pcb/pos/${String(poId)}`);
      await session.page.waitForLoadState('networkidle');
      const body = await session.page.locator('body').innerText();

      expect(body, '반려가 타임라인에 선다').toContain('EQ 반려');
      expect(body, '사유가 그대로 보인다').toContain('실크 위치를 좌측으로');
      expect(body, '지금 할 일이 못박힌다').toContain('보완 파일을 올리고 다시 승인요청');
      expect(body, '관리자 회신 첨부가 대화에 붙는다').toContain('markup-v1.zip');
      expect(body, '받은 자료임을 라벨이 말한다').toContain('수정 지시');
      // 내가 올린 것도 같은 축에 — 순서가 한 줄기여야 흐름이 읽힌다.
      expect(body, '내 첨부도 타임라인에').toContain('eq-v1.zip');
      await snap(session.page, 'eq-reply-partner-timeline');
    } finally {
      await session.context.close();
    }
  });

  test('E7. 왕복이 닫힌다 — 보완 → 재요청 → 승인', async () => {
    // 반려로 issued 가 됐으니 협력사 첨부가 다시 열린다(보완분).
    const fix = await upload(P, partnerEqPath(), 'working', 'working-v2-fixed.zip');
    expect(fix.status, `보완 업로드: ${JSON.stringify(fix.json)}`).toBe(200);

    const files = await partnerFiles();
    const workingLatest = files.find((f) => f.fileType === 'working' && f.isLatest);
    expect(workingLatest?.name, '보완분이 최신이 된다').toBe('working-v2-fixed.zip');
    expect(workingLatest?.afterReject, '반려 뒤 올라온 보완분으로 표시된다').toBe(true);
    // 회신은 반려 뒤에도 그대로 남는다 — 근거 서류다.
    expect(files.some((f) => f.fileType === 'reply'), '회신은 왕복 뒤에도 남는다').toBe(true);

    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(again.status, `재승인요청: ${JSON.stringify(again.json)}`).toBe(200);

    const approve = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-approve`,
    );
    expect(approve.status, `EQ 승인: ${JSON.stringify(approve.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(po?.status, 'EQ 완료').toBe('eq_done');

    // 생산 구간에서는 회신도 닫힌다 — 근거 서류가 뒤늦게 바뀌면 안 된다.
    const late = await upload(A, adminEqPath(), 'reply', 'too-late.zip');
    expect(late.status, '승인 뒤 회신 첨부는 잠김').toBe(409);
  });
});
