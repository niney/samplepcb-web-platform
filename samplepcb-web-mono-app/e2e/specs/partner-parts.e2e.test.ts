// 협력사 보유 부품(docs/PARTNER_PARTS.md) — 업로드 → 미리보기 → 열 교정 → 반영 → 원장 →
// 관리자 뒤처리까지 API 레벨로 왕복한다.
//
// 이 기능의 정책은 "제한을 두지 않는다"(만료 없음·RFQ 제한 없음, 사용자 결정 2026-08-23)라
// 품질 비용이 전부 관리자에게 온다. 그래서 여기서 지켜야 할 계약은 두 갈래다:
//   ① **무유실** — 재고표의 어떤 셀도 조용히 사라지지 않고, 품번은 원문이 남으며,
//      잡음이 섞인 셀은 "하나를 고르지 않고" 대체 후보를 함께 색인한다.
//   ② **뒤처리 가능** — 관리자가 끄고·비우고·대신 올리는 길이 실제로 동작한다.
//
// 픽스처는 이 스펙이 통째로 만들고 지운다(상설 조직을 건드리지 않는다) — 이름에 검사
// 키워드를 넣지 않는 관례(오탐 2회)를 따라 조직명은 `e2e부품판매`.
//
// 실행: pnpm -F e2e e2e partner-parts   (PORTAL_E2E=1 · API + sp-engine 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  cleanupPartnerCatalog,
  disconnectPrisma,
  getPrisma,
  num,
  signJwt,
} from '../helpers';

const PARTNER_NAME = 'e2e부품판매';
const PARTNER_MB_ID = 'e2e-parts-owner';
const admin = (): string => signJwt({ mbId: 'e2e-admin', isAdmin: true });
const owner = (): string => signJwt({ mbId: PARTNER_MB_ID });

// 실제 브로커 재고표의 함정을 압축한 표본:
//  · `DS1307Z+T&R`     — BOM 추출기가 무플래그로 떨구던 접미(유실 금지의 회귀선)
//  · `PCA9575PW2, 118` — 콤마 뒤 NXP 포장 코드(수량이 아니다)
//  · `LM358D ST`       — 제조사 병기(제조사 열이 비어 있음)
//  · 제조사 없는 행     — 재고표의 절반이 이렇다(그래도 저장된다)
const STOCK_CSV = [
  'Parts No.,date Code,Brand,QTY.,price,Lead Time',
  'STM32F030F4P6,23+,ST,1200,$1.35,Stock',
  'DS1307Z+T&R,21+,Maxim,500,,Stock',
  '"PCA9575PW2, 118",22+,NXP,80,,Stock',
  'LM358D ST,22+,,40,,Stock',
  'ADUC7020BCPZ62I-R7,21+,,21000,,Stock',
].join('\n');

// 열 이름이 낯선 두 번째 회차 — 전체 교체(replace)와 열 역할 교정을 함께 본다.
const ODD_CSV = [
  '품번,보유,메이커',
  'TPS40170RGYR,300,TI',
  'SN74LVC1G32DCKR,900,TI',
].join('\n');

let partnerId: bigint;

const uploadCsv = async (
  token: string,
  path: string,
  csv: string,
  filename: string,
): Promise<{ status: number; json: any }> => {
  const form = new FormData();
  form.append('file', new File([csv], filename, { type: 'text/csv' }));
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없는 응답 */
  }
  return { status: res.status, json };
};

const cleanup = async (): Promise<void> => {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findFirst({ where: { name: PARTNER_NAME } });
  if (existing === null) return;
  const parts = await prisma.spPartnerPart.findMany({
    where: { partnerId: existing.id },
    select: { id: true },
  });
  if (parts.length > 0) {
    await prisma.spPartnerPartKey.deleteMany({
      where: { partId: { in: parts.map((p: { id: bigint }) => p.id) } },
    });
  }
  // 카탈로그 투영 흔적부터 치운다 — 라우트를 안 타므로 자동 동기화가 없다.
  await cleanupPartnerCatalog(existing.id);
  await prisma.spPartnerPart.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerPartUpload.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerMember.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartner.delete({ where: { id: existing.id } });
};

describe.skipIf(!RUN)('협력사 보유 부품 — 업로드·원장·뒤처리', () => {
  beforeAll(async () => {
    const engine = await fetch(`${BOM_ENGINE_URL}/health`).catch(() => null);
    if (engine === null || !engine.ok) {
      throw new Error(`sp-engine(${BOM_ENGINE_URL}) 이 떠 있어야 합니다 — ./run.sh`);
    }
    await cleanup();
    const prisma = getPrisma();
    const created = await prisma.spPartner.create({
      data: {
        type: 'partner',
        name: PARTNER_NAME,
        country: 'KR',
        defaultCurrency: 'KRW',
        capabilities: ['bom_rfq', 'part_sale'],
        status: 'approved',
        members: { create: { mbId: PARTNER_MB_ID, role: 'owner' } },
      },
    });
    partnerId = created.id;
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await disconnectPrisma();
  }, 60_000);

  test('트랙 노출 — part_sale 이 access.tracks.parts 로 파생된다', async () => {
    const res = await api(owner(), 'GET', '/api/partner/access');
    expect(res.status).toBe(200);
    expect(res.json.data.tracks).toMatchObject({ bom: true, parts: true });
  });

  test('part_sale 없는 조직은 403 — requirePartner 만으로는 열리지 않는다', async () => {
    const prisma = getPrisma();
    await prisma.spPartner.update({
      where: { id: partnerId },
      data: { capabilities: ['bom_rfq'] },
    });
    const denied = await api(owner(), 'GET', '/api/partner/parts');
    expect(denied.status).toBe(403);
    await prisma.spPartner.update({
      where: { id: partnerId },
      data: { capabilities: ['bom_rfq', 'part_sale'] },
    });
    const allowed = await api(owner(), 'GET', '/api/partner/parts');
    expect(allowed.status).toBe(200);
  });

  test('업로드 → 미리보기: 열 역할을 읽고 원문을 보존한다', async () => {
    const res = await uploadCsv(owner(), '/api/partner/parts/uploads', STOCK_CSV, 'stock.csv');
    expect(res.status, JSON.stringify(res.json)).toBe(201);

    const { upload, rows } = res.json.data;
    expect(upload.status).toBe('preview');
    expect(upload.stats.rowCount).toBe(5);

    const roles = Object.fromEntries(
      upload.sheets[0].columns.map((c: any) => [c.rawHeader, c.role]),
    );
    // BOM 추출기가 버리는 열(재고·단가·납기·D/C)이 여기서는 정보다.
    expect(roles).toMatchObject({
      'Parts No.': 'part_number',
      'date Code': 'date_code',
      Brand: 'manufacturer',
      'QTY.': 'stock_qty',
      price: 'unit_price',
      'Lead Time': 'lead_time',
    });

    const byMpn = new Map(rows.map((r: any) => [r.mpn, r]));
    // ① 유실 금지 — `+T&R` 접미가 그대로 살아 있다
    const dallas: any = byMpn.get('DS1307Z+T&R');
    expect(dallas).toBeDefined();
    expect(dallas.mpnRaw).toBe('DS1307Z+T&R');
    expect(dallas.stockQty).toBe(500);

    // ② 하나를 고르지 않는다 — 정본은 원문, 잡음 제거본은 대체 후보로 함께 남는다
    const nxp: any = byMpn.get('PCA9575PW2, 118');
    expect(nxp.alternatives).toContain('PCA9575PW2');

    // ③ 제조사 병기 셀은 제조사로 회수하되 품번 원문은 유지
    const ti: any = byMpn.get('LM358D ST');
    expect(ti.manufacturer).toBe('ST');
    expect(ti.alternatives).toContain('LM358D');

    // ④ 통화 기호만 있어도 읽는다
    const stm: any = byMpn.get('STM32F030F4P6');
    expect(stm.unitPrice).toBe(1.35);
    expect(stm.currency).toBe('USD');
  }, 120_000);

  test('확인 대기 중에는 새 업로드를 막는다(어느 회차를 반영할지 모호해진다)', async () => {
    const second = await uploadCsv(owner(), '/api/partner/parts/uploads', ODD_CSV, 'odd.csv');
    expect(second.status).toBe(409);
  }, 60_000);

  test('반영 → 원장: 대체 후보까지 조회 키로 색인된다', async () => {
    const uploads = await api(owner(), 'GET', '/api/partner/parts/uploads');
    const pending = uploads.json.data.items.find((u: any) => u.status === 'preview');
    expect(pending).toBeDefined();

    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(pending.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data.affected).toBe(5);

    const list = await api(owner(), 'GET', '/api/partner/parts?pageSize=50');
    expect(list.json.data.total).toBe(5);

    // 조회 키 — 정본 1 + 대체 후보. `PCA9575PW2` 로도 걸려야 한다.
    const prisma = getPrisma();
    const keys = await prisma.spPartnerPartKey.findMany({
      where: { partnerId },
      select: { mpnNorm: true, kind: true },
    });
    expect(keys.some((k: { mpnNorm: string; kind: string }) => k.mpnNorm === 'PCA9575PW2' && k.kind === 'alternative')).toBe(true);
    expect(keys.some((k: { mpnNorm: string; kind: string }) => k.mpnNorm === 'DS1307ZTR' || k.mpnNorm === 'DS1307Z+T&R')).toBe(true);
    expect(keys.length).toBeGreaterThan(5);

    // 요약 — 만료를 두지 않는 대신 나이가 항상 계산된다
    const summary = await api(owner(), 'GET', '/api/partner/parts/summary');
    expect(summary.json.data.summary.activeCount).toBe(5);
    expect(summary.json.data.summary.ageDays).toBe(0);
    expect(summary.json.data.summary.stale).toBe(false);
  }, 120_000);

  test('열 역할 교정 → 엔진 재실행(화면이 셀을 재해석하지 않는다)', async () => {
    const uploaded = await uploadCsv(owner(), '/api/partner/parts/uploads', ODD_CSV, 'odd.csv');
    expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(201);
    const uploadId = uploaded.json.data.upload.uploadId as number;

    // '보유'(2열)를 재고가 아니라 무시로 돌리면 재고가 비어야 한다.
    const remapped = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(uploadId)}/remap`,
      { roleOverrides: [{ sheetIndex: 0, column1Based: 2, role: 'ignore' }] },
    );
    expect(remapped.status, JSON.stringify(remapped.json)).toBe(200);
    expect(remapped.json.data.rows[0].stockQty).toBeNull();
    // 무시한 열도 원문은 남는다(무유실)
    expect(remapped.json.data.upload.stats.withStock).toBe(0);

    // 되돌리면 다시 읽는다
    const restored = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(uploadId)}/remap`,
      { roleOverrides: [{ sheetIndex: 0, column1Based: 2, role: 'stock_qty' }] },
    );
    expect(restored.json.data.rows[0].stockQty).toBe(300);
  }, 180_000);

  test('전체 교체 — 새 회차가 이전 원장을 대체한다', async () => {
    const uploads = await api(owner(), 'GET', '/api/partner/parts/uploads');
    const pending = uploads.json.data.items.find((u: any) => u.status === 'preview');
    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(pending.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status).toBe(200);

    const list = await api(owner(), 'GET', '/api/partner/parts?pageSize=50');
    expect(list.json.data.total).toBe(2);
    expect(list.json.data.items.map((r: any) => r.mpn).sort()).toEqual([
      'SN74LVC1G32DCKR',
      'TPS40170RGYR',
    ]);

    // 이전 회차의 조회 키도 함께 사라진다(유령 키 금지)
    const prisma = getPrisma();
    const orphan = await prisma.spPartnerPartKey.count({
      where: { partnerId, mpnNorm: 'PCA9575PW2' },
    });
    expect(orphan).toBe(0);
  }, 120_000);

  test('낡음 기준일 — 운영 설정이 정본이고 요약이 그대로 따른다', async () => {
    const token = admin();
    const before = await api(token, 'GET', '/api/admin/partner-parts/config');
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    const original = before.json.data.staleAfterDays as number;

    // 만료를 두지 않으므로(P4) 이 값은 **삭제 기준이 아니라 표시 기준**이다.
    const saved = await api(token, 'PUT', '/api/admin/partner-parts/config', {
      staleAfterDays: 1,
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.data.staleAfterDays).toBe(1);

    const summary = await api(token, 'GET', '/api/admin/partner-parts/summary');
    expect(summary.json.data.staleAfterDays, '요약이 설정값을 그대로 쓴다').toBe(1);

    // 범위를 벗어난 값은 막는다(0일이면 모든 원장이 늘 낡음이 된다).
    const rejected = await api(token, 'PUT', '/api/admin/partner-parts/config', {
      staleAfterDays: 0,
    });
    expect(rejected.status).toBe(400);

    await api(token, 'PUT', '/api/admin/partner-parts/config', { staleAfterDays: original });
  }, 60_000);

  test('관리자 뒤처리 — 요약·끄기·켜기·행 삭제', async () => {
    const token = admin();
    const summary = await api(token, 'GET', '/api/admin/partner-parts/summary');
    expect(summary.status).toBe(200);
    const mine = summary.json.data.items.find((s: any) => s.partnerId === num(partnerId));
    expect(mine.activeCount).toBe(2);

    // 끄기 — 목록은 남고 활성만 내려간다(만료 대신 사람이 끄는 스위치)
    const off = await api(token, 'PATCH', `/api/admin/partner-parts/${String(partnerId)}/active`, {
      isActive: false,
    });
    expect(off.json.data.affected).toBe(2);
    const afterOff = await api(owner(), 'GET', '/api/partner/parts?pageSize=50');
    expect(afterOff.json.data.total).toBe(0);
    const prisma = getPrisma();
    expect(await prisma.spPartnerPart.count({ where: { partnerId } })).toBe(2);
    // 조회 키도 함께 꺼져야 주입에서 빠진다
    expect(await prisma.spPartnerPartKey.count({ where: { partnerId, isActive: true } })).toBe(0);

    const on = await api(token, 'PATCH', `/api/admin/partner-parts/${String(partnerId)}/active`, {
      isActive: true,
    });
    expect(on.json.data.affected).toBe(2);

    // 행 삭제
    const rows = await api(token, 'GET', `/api/admin/partner-parts?partnerId=${String(partnerId)}`);
    const victim = rows.json.data.items[0];
    const removed = await api(
      token,
      'DELETE',
      `/api/admin/partner-parts/row/${String(victim.partId)}`,
    );
    expect(removed.json.data.affected).toBe(1);
    expect(await prisma.spPartnerPartKey.count({ where: { partId: BigInt(victim.partId) } })).toBe(0);
  }, 120_000);

  test('관리자 대행 업로드 — 포털 계정 없이도 원장을 세운다', async () => {
    const token = admin();
    const uploaded = await uploadCsv(
      token,
      `/api/admin/partner-parts/${String(partnerId)}/uploads`,
      STOCK_CSV,
      'admin-stock.csv',
    );
    expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(201);
    expect(uploaded.json.data.upload.uploadedBy).toBe('ADMIN');

    const commit = await api(
      token,
      'POST',
      `/api/admin/partner-parts/uploads/${String(uploaded.json.data.upload.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.json.data.affected).toBe(5);

    const list = await api(token, 'GET', `/api/admin/partner-parts?partnerId=${String(partnerId)}`);
    expect(list.json.data.total).toBe(5);
    // 정렬 = 최신 회차 먼저 · 회차 안에서는 파일 순서 그대로(품번 사전순이 아니다).
    expect(list.json.data.items.map((r: any) => r.mpn)).toEqual([
      'STM32F030F4P6',
      'DS1307Z+T&R',
      'PCA9575PW2, 118',
      'LM358D ST',
      'ADUC7020BCPZ62I-R7',
    ]);
  }, 180_000);

  test('행 수정 — 품번을 고치면 조회 키도 따라간다', async () => {
    const prisma = getPrisma();
    // 직전 케이스(관리자 대행 업로드)가 STOCK_CSV 5행으로 원장을 다시 세워 두었다.
    const target = await prisma.spPartnerPart.findFirstOrThrow({
      where: { partnerId, mpn: 'ADUC7020BCPZ62I-R7' },
      select: { id: true, mpnRaw: true },
    });

    const res = await api(owner(), 'PATCH', `/api/partner/parts/${String(target.id)}`, {
      mpn: 'ADUC7020BCPZ62I',
      manufacturer: 'Analog Devices',
      stockQty: 999,
      dateCode: '25+',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.part.mpn).toBe('ADUC7020BCPZ62I');
    expect(res.json.data.part.stockQty).toBe(999);
    expect(res.json.data.part.editedAt).not.toBeNull();
    expect(res.json.data.part.editedBy).toBe(PARTNER_MB_ID);
    // 파일 원문은 건드리지 않는다 — 무엇을 고쳤는지가 두 값의 차이로 남는다.
    expect(res.json.data.part.mpnRaw).toBe(target.mpnRaw);
    expect(res.json.data.part.flags).toContain('manually_edited');

    // 조회 키가 새 품번으로 갈아 끼워졌는지 — 안 그러면 화면과 BOM 주입이 어긋난다.
    const keys = await prisma.spPartnerPartKey.findMany({
      where: { partId: target.id },
      select: { mpnNorm: true, kind: true },
    });
    expect(keys.map((k: { mpnNorm: string }) => k.mpnNorm)).toEqual(['ADUC7020BCPZ62I']);
    expect(keys[0]?.kind).toBe('canonical');
    // 옛 키는 남지 않는다(유령 키 금지).
    expect(
      await prisma.spPartnerPartKey.count({ where: { partnerId, mpnNorm: 'ADUC7020BCPZ62IR7' } }),
    ).toBe(0);

    // 빈 문자열은 '지움'(?? 로는 안 걸러진다).
    const cleared = await api(owner(), 'PATCH', `/api/partner/parts/${String(target.id)}`, {
      dateCode: '',
    });
    expect(cleared.json.data.part.dateCode).toBeNull();

    // 품번을 비우는 것은 막는다 — 조회 키가 사라진 행은 원장에서 유령이 된다.
    const rejected = await api(owner(), 'PATCH', `/api/partner/parts/${String(target.id)}`, {
      mpn: '   ',
    });
    expect(rejected.status).toBe(400);

    // 남의 행은 못 고친다(포털은 자기 원장만 — 존재조차 알리지 않는다).
    const foreign = await prisma.spPartnerPart.findFirst({
      where: { partnerId: { not: partnerId } },
      select: { id: true },
    });
    if (foreign !== null) {
      const denied = await api(owner(), 'PATCH', `/api/partner/parts/${String(foreign.id)}`, {
        stockQty: 1,
      });
      expect(denied.status).toBe(404);
    }
  }, 120_000);

  test('행 수정(관리자) — 협력사가 못 고칠 때 대신 바로잡는다', async () => {
    const prisma = getPrisma();
    const target = await prisma.spPartnerPart.findFirstOrThrow({
      where: { partnerId, mpn: 'LM358D ST' },
      select: { id: true },
    });
    const res = await api(admin(), 'PATCH', `/api/admin/partner-parts/row/${String(target.id)}`, {
      mpn: 'LM358D',
      manufacturer: 'STMicroelectronics',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.part.mpn).toBe('LM358D');
    expect(res.json.data.part.manufacturer).toBe('STMicroelectronics');
    expect(res.json.data.part.editedBy).toBe('e2e-admin');
    const keys = await prisma.spPartnerPartKey.findMany({
      where: { partId: target.id },
      select: { mpnNorm: true },
    });
    expect(keys.map((k: { mpnNorm: string }) => k.mpnNorm)).toEqual(['LM358D']);
  }, 120_000);

  test('견적 품목 × 보유 협력사 — 관리자만 이름을 본다', async () => {
    const prisma = getPrisma();
    // 이 스펙 소유 견적 하나를 세워 품목을 붙인다(상설 데이터를 건드리지 않는다).
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: PARTNER_MB_ID,
        title: 'e2e부품판매-보유확인',
        fileName: 'holders.csv',
        status: 'reviewing',
        buildStatus: 'ready',
      },
    });
    const [held, unheld] = await Promise.all([
      prisma.spBomQuoteItem.create({
        data: { quoteId: quote.id, rowIdx: 1, mpn: 'STM32F030F4P6', bomQty: 1, orderQty: 10 },
      }),
      prisma.spBomQuoteItem.create({
        data: { quoteId: quote.id, rowIdx: 2, mpn: 'NOBODY-HAS-THIS', bomQty: 1, orderQty: 10 },
      }),
    ]);

    // 원장을 다시 세운다(직전 케이스가 비웠다).
    const uploaded = await uploadCsv(
      admin(),
      `/api/admin/partner-parts/${String(partnerId)}/uploads`,
      STOCK_CSV,
      'holders-stock.csv',
    );
    await api(
      admin(),
      'POST',
      `/api/admin/partner-parts/uploads/${String(uploaded.json.data.upload.uploadId)}/commit`,
      { mode: 'replace' },
    );

    const res = await api(
      admin(),
      'GET',
      `/api/admin/bom-quotes/${String(quote.id)}/partner-stock`,
    );
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const holders = res.json.data.itemHolders[String(held.id)];
    expect(holders, '보유 협력사가 잡혀야 한다').toBeDefined();
    expect(holders[0].partnerName).toBe(PARTNER_NAME);
    expect(holders[0].stockQty).toBe(1200);
    expect(holders[0].rfqEligible, 'bom_rfq 트랙이 있으면 발송 대상').toBe(true);
    // 아무도 안 가진 행은 키 자체가 없다(화면이 빈 배열을 그리지 않게).
    expect(res.json.data.itemHolders[String(unheld.id)]).toBeUndefined();
    // 발송 모달용 역방향 색인
    expect(res.json.data.partnerItems[String(partnerId)]).toContain(String(held.id));

    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }, 180_000);

  test('회신 폼 프리필 — 내 보유 값만, 미회신 행에만', async () => {
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: PARTNER_MB_ID,
        title: 'e2e부품판매-프리필',
        fileName: 'prefill.csv',
        status: 'reviewing',
        buildStatus: 'ready',
      },
    });
    const item = await prisma.spBomQuoteItem.create({
      data: { quoteId: quote.id, rowIdx: 1, mpn: 'STM32F030F4P6', bomQty: 1, orderQty: 10 },
    });
    const rfq = await prisma.spBomRfq.create({
      data: {
        quoteId: quote.id,
        partnerId,
        status: 'requested',
        magicToken: 'e'.repeat(64),
        magicTokenAt: new Date(),
      },
    });

    const detail = await api(owner(), 'GET', `/api/partner/rfqs/${String(rfq.id)}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    const line = detail.json.data.items.find((r: any) => r.quoteItemId === String(item.id));
    expect(line.reply, '아직 회신 전').toBeNull();
    expect(line.myStock.stockQty).toBe(1200);
    expect(line.myStock.dateCode).toBe('23+');
    expect(line.myStock.leadTime).toBe('Stock');

    await prisma.spBomRfq.delete({ where: { id: rfq.id } });
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }, 120_000);

  test('원장 비우기 — 되돌릴 수 없는 정리', async () => {
    const token = admin();
    const cleared = await api(token, 'DELETE', `/api/admin/partner-parts/${String(partnerId)}`);
    expect(cleared.json.data.affected).toBe(5);

    const prisma = getPrisma();
    expect(await prisma.spPartnerPart.count({ where: { partnerId } })).toBe(0);
    expect(await prisma.spPartnerPartKey.count({ where: { partnerId } })).toBe(0);
  }, 120_000);
});
