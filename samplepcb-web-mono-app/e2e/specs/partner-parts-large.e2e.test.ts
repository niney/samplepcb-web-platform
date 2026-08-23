// 협력사 보유 부품 — **대형 재고표**(docs/PARTNER_PARTS.md).
//
// 작은 CSV 로만 검증했더니 실사용에서 곧바로 깨졌다(사용자 보고 2026-08-23):
// 12,175행 재고표의 엔진 결과 JSON 이 6.36MB 라 `previewJson` 에 통째로 넣는 순간
// **MySQL 패킷 한도로 연결이 끊겼다**("Server has closed the connection").
// BOM 견적의 "대형 후보 저장 내성"과 같은 계열 함정이고, 표본 크기 픽스처로는 절대
// 안 잡힌다. 그래서 이 스펙은 **크기 자체가 검사 대상**이다.
//
// 실행: pnpm -F e2e e2e partner-parts-large   (PORTAL_E2E=1 · API + sp-engine 필요)
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
  signJwt,
} from '../helpers';

const PARTNER_NAME = 'e2e대형재고';
const PARTNER_MB_ID = 'e2e-parts-large';
const owner = (): string => signJwt({ mbId: PARTNER_MB_ID, ttlSec: 3600 });

// 실물 브로커 재고표와 같은 규모(12,000행) — 함정을 재현하는 최소 조건은 **행 수**다.
// 잡음 셀도 섞어 대체 후보 키가 만 단위로 늘어나는 경로까지 함께 태운다.
const ROWS = 12_000;
const buildCsv = (): string => {
  const lines = ['Parts No.,date Code,Brand,QTY.,price,Lead Time'];
  for (let i = 0; i < ROWS; i += 1) {
    const brand = i % 2 === 0 ? 'TI' : '';
    if (i % 100 === 0) {
      lines.push(`"MPN-${String(i)}-PW2, 118",23+,${brand},${String(1000 + i)},,Stock`);
    } else {
      lines.push(`MPN-${String(i)}-ABC,23+,${brand},${String(1000 + i)},,Stock`);
    }
  }
  return lines.join('\n');
};

let partnerId: bigint;

const cleanup = async (): Promise<void> => {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findFirst({ where: { name: PARTNER_NAME } });
  if (existing === null) return;
  // 만 단위 행 — 청크로 지운다(견적 삭제에서 배운 P2028 함정).
  // 카탈로그 투영 흔적부터 치운다 — 라우트를 안 타므로 자동 동기화가 없다.
  await cleanupPartnerCatalog(existing.id);
  for (;;) {
    const batch = await prisma.spPartnerPart.findMany({
      where: { partnerId: existing.id },
      select: { id: true },
      take: 1000,
    });
    if (batch.length === 0) break;
    const ids = batch.map((p: { id: bigint }) => p.id);
    await prisma.spPartnerPartKey.deleteMany({ where: { partId: { in: ids } } });
    await prisma.spPartnerPart.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.spPartnerPartUpload.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerMember.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartner.delete({ where: { id: existing.id } });
};

describe.skipIf(!RUN)('협력사 보유 부품 — 대형 재고표', () => {
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
        capabilities: ['part_sale'],
        status: 'approved',
        members: { create: { mbId: PARTNER_MB_ID, role: 'owner' } },
      },
    });
    partnerId = created.id;
  }, 300_000);

  afterAll(async () => {
    await cleanup();
    await disconnectPrisma();
  }, 300_000);

  test('12,000행 업로드 → 미리보기 → 반영 → 원장·조회 키', async () => {
    const csv = buildCsv();
    const form = new FormData();
    form.append('file', new File([csv], 'large-stock.csv', { type: 'text/csv' }));
    const res = await fetch(`${API_URL}/api/partner/parts/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner()}` },
      body: form,
    });
    const json: any = await res.json();
    expect(res.status, JSON.stringify(json).slice(0, 500)).toBe(201);
    expect(json.data.upload.status).toBe('preview');
    expect(json.data.upload.stats.rowCount).toBe(ROWS);

    // 미리보기는 **표본만** 실어 보낸다 — 전량을 응답에 담으면 화면도 DB 도 견디지 못한다.
    expect(json.data.rows.length).toBe(json.data.rowSampleLimit);
    expect(json.data.rows.length).toBeLessThan(ROWS);

    // 저장된 스냅샷도 표본 크기여야 한다(이게 패킷 벽의 직접 원인이었다).
    const prisma = getPrisma();
    const stored = await prisma.spPartnerPartUpload.findUniqueOrThrow({
      where: { id: BigInt(json.data.upload.uploadId as number) },
      select: { previewJson: true, status: true, error: true },
    });
    expect(stored.status, stored.error ?? '').toBe('preview');
    const snapshotBytes = JSON.stringify(stored.previewJson).length;
    expect(snapshotBytes, `미리보기 스냅샷이 ${String(snapshotBytes)}B — 표본만 담아야 한다`)
      .toBeLessThan(1_000_000);

    // 커밋은 보관 원본을 다시 돌려 **전량**을 원장에 넣는다.
    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(json.data.upload.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status, JSON.stringify(commit.json).slice(0, 500)).toBe(200);
    expect(commit.json.data.affected).toBe(ROWS);

    expect(await prisma.spPartnerPart.count({ where: { partnerId } })).toBe(ROWS);
    // 조회 키 = 정본 + 콤마 뒤 포장 코드 대체 후보(120건)
    const keyCount = await prisma.spPartnerPartKey.count({ where: { partnerId } });
    expect(keyCount).toBe(ROWS + ROWS / 100);

    // 반영 뒤 스냅샷은 비운다(용량)
    const applied = await prisma.spPartnerPartUpload.findUniqueOrThrow({
      where: { id: BigInt(json.data.upload.uploadId as number) },
      select: { status: true, previewJson: true },
    });
    expect(applied.status).toBe('applied');
    expect(applied.previewJson).toBeNull();
  }, 600_000);
});
