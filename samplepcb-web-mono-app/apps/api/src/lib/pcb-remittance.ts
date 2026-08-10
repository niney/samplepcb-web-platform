import type { SpFile, SpPcbRemittance } from '@prisma/client';
import type {
  PcbRemittanceCreateBodyType,
  PcbRemittanceFileType,
  PcbRemittancePatchBodyType,
  PcbRemittanceStatusType,
  PcbRemittanceSummaryType,
  PcbRemittanceViewType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { roundPcbAmount } from './exchange-rate';
import { asPcbCurrency } from './pcb-rfq';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';

// ── PCB 송금 원장 코어(P3.11) — docs/PCB_PARTNER_TRACK.md D15 ────────────────
// 발주서 1:N 송금. 이 파일이 **잔액 계산의 단일 진실**이다 — 목록·상세·협력사별 집계·
// 협력사 포털이 모두 같은 함수를 쓴다(둘로 갈라지면 화면마다 다른 금액이 나온다).
//
// 통화: 송금 통화는 발주 통화로 강제한다(클라이언트가 못 정한다). 잔액을 같은 통화로만
// 빼기 위해서다. KRW 환산(krwAmount)은 **송금 시점의 실제 환율**로 따로 박제한다 —
// 발주 환율로 뭉개면 환차손익이 사라진다.

const REMITTANCE_REF_TYPE = 'sp_pcb_remittance';
const REMITTANCE_UPLOAD_SERVICE_TYPE = 'pcb_remittance';

const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);
const decNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** 통화별 비교 허용 오차 — Decimal(15,2) 이라 소수 2자리 밖은 잡음이다. */
const EPSILON = 0.005;

export const pcbRemittanceStatusOf = (
  poAmount: number,
  paidAmount: number,
): PcbRemittanceStatusType => {
  if (paidAmount <= EPSILON) return 'unpaid';
  if (paidAmount > poAmount + EPSILON) return 'over';
  if (paidAmount >= poAmount - EPSILON) return 'paid';
  return 'partial';
};

export const summarizePcbRemittances = (
  po: { currency: string; priceOriginal: unknown },
  rows: readonly Pick<SpPcbRemittance, 'amount' | 'remittedOn'>[],
): PcbRemittanceSummaryType => {
  const poAmount = Number(po.priceOriginal);
  const paidAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const currency = asPcbCurrency(po.currency);
  // 잔액도 통화 단위로 반올림한다(KRW 0자리·외화 2자리) — 화면이 그대로 찍는 값이다.
  const balance = roundPcbAmount(poAmount - paidAmount, currency);
  const last = rows.reduce<Date | null>(
    (acc, r) => (acc === null || r.remittedOn > acc ? r.remittedOn : acc),
    null,
  );
  return {
    currency,
    poAmount: roundPcbAmount(poAmount, currency),
    paidAmount: roundPcbAmount(paidAmount, currency),
    balance,
    status: pcbRemittanceStatusOf(poAmount, paidAmount),
    count: rows.length,
    lastRemittedOn: last === null ? null : last.toISOString(),
  };
};

const toFileView = (row: SpFile): PcbRemittanceFileType => ({
  fileId: Number(row.id),
  name: row.originFileName,
  size: Number(row.size),
  uploadedAt: row.writeDate.toISOString(),
});

export const toPcbRemittanceView = (
  row: SpPcbRemittance,
  files: readonly SpFile[],
): PcbRemittanceViewType => ({
  id: Number(row.id),
  poId: Number(row.poId),
  remittedOn: row.remittedOn.toISOString(),
  currency: row.currency,
  amount: Number(row.amount),
  exchangeRate: decNum(row.exchangeRate),
  krwAmount: row.krwAmount,
  memo: row.memo,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  files: files.map(toFileView),
});

/** 여러 송금 건의 증빙을 한 번에(목록 N+1 회피). */
export const loadRemittanceFiles = async (
  ids: readonly bigint[],
): Promise<Map<string, SpFile[]>> => {
  const map = new Map<string, SpFile[]>();
  if (ids.length === 0) return map;
  const rows = await prisma.spFile.findMany({
    where: { refType: REMITTANCE_REF_TYPE, refId: { in: [...ids] } },
    orderBy: { id: 'asc' },
  });
  for (const row of rows) {
    const key = row.refId.toString();
    const bucket = map.get(key) ?? [];
    bucket.push(row);
    map.set(key, bucket);
  }
  return map;
};

export const listPcbRemittances = async (poId: bigint): Promise<PcbRemittanceViewType[]> => {
  const rows = await prisma.spPcbRemittance.findMany({
    where: { poId },
    orderBy: [{ remittedOn: 'asc' }, { id: 'asc' }],
  });
  const files = await loadRemittanceFiles(rows.map((r) => r.id));
  return rows.map((r) => toPcbRemittanceView(r, files.get(r.id.toString()) ?? []));
};

// ⚠ sp_pcb_po.remittedAt 은 원장에서 파생하는 **캐시**다. 원장이 바뀔 때마다 여기서
//   다시 계산해 넣는다 — 목록·협력사 포털의 기존 표시가 그 컬럼을 읽기 때문이다.
//   원장을 거치지 않고 그 컬럼을 직접 쓰면 금액·잔액과 어긋난다.
export const syncPoRemittedAt = async (poId: bigint): Promise<void> => {
  const last = await prisma.spPcbRemittance.findFirst({
    where: { poId },
    orderBy: [{ remittedOn: 'desc' }, { id: 'desc' }],
    select: { remittedOn: true },
  });
  await prisma.spPcbPo.update({
    where: { id: poId },
    data: { remittedAt: last?.remittedOn ?? null },
  });
};

/** 외화면 실제 적용 환율로 KRW 를 박제한다. KRW 발주면 환율은 의미 없다. */
const krwFields = (
  currencyRaw: string,
  amount: number,
  exchangeRate: number | null | undefined,
): { exchangeRate: number | null; krwAmount: number | null } => {
  const currency = asPcbCurrency(currencyRaw);
  if (currency === 'KRW') return { exchangeRate: null, krwAmount: roundPcbAmount(amount, 'KRW') };
  if (exchangeRate === null || exchangeRate === undefined) {
    return { exchangeRate: null, krwAmount: null };
  }
  return { exchangeRate, krwAmount: roundPcbAmount(amount * exchangeRate, 'KRW') };
};

export type PcbRemittanceError = 'PO_NOT_FOUND' | 'REMITTANCE_NOT_FOUND';

export const createPcbRemittance = async (
  poId: bigint,
  body: PcbRemittanceCreateBodyType,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: PcbRemittanceError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const amount = roundPcbAmount(body.amount, asPcbCurrency(po.currency));
  await prisma.spPcbRemittance.create({
    data: {
      poId,
      remittedOn: parseKstDate(body.remittedOn),
      currency: po.currency, // 발주 통화 고정 — 클라이언트 값을 받지 않는다
      amount,
      ...krwFields(po.currency, amount, body.exchangeRate),
      memo: body.memo ?? null,
      createdBy: actorMbId,
    },
  });
  await syncPoRemittedAt(poId);
  return { ok: true };
};

export const patchPcbRemittance = async (
  poId: bigint,
  remittanceId: bigint,
  body: PcbRemittancePatchBodyType,
): Promise<{ ok: true } | { ok: false; error: PcbRemittanceError }> => {
  const row = await prisma.spPcbRemittance.findUnique({ where: { id: remittanceId } });
  if (row?.poId !== poId) return { ok: false, error: 'REMITTANCE_NOT_FOUND' };

  // 금액·환율은 어느 하나만 와도 KRW 환산을 다시 계산해야 한다(둘의 곱이므로).
  const nextAmount =
    body.amount === undefined
      ? Number(row.amount)
      : roundPcbAmount(body.amount, asPcbCurrency(row.currency));
  const nextRate =
    body.exchangeRate === undefined ? decNum(row.exchangeRate) : body.exchangeRate;
  const money =
    body.amount === undefined && body.exchangeRate === undefined
      ? {}
      : { amount: nextAmount, ...krwFields(row.currency, nextAmount, nextRate) };

  await prisma.spPcbRemittance.update({
    where: { id: remittanceId },
    data: {
      ...money,
      ...(body.remittedOn === undefined ? {} : { remittedOn: parseKstDate(body.remittedOn) }),
      ...(body.memo === undefined ? {} : { memo: body.memo }),
    },
  });
  await syncPoRemittedAt(poId);
  return { ok: true };
};

export const deletePcbRemittance = async (
  poId: bigint,
  remittanceId: bigint,
): Promise<{ ok: true } | { ok: false; error: PcbRemittanceError }> => {
  const row = await prisma.spPcbRemittance.findUnique({ where: { id: remittanceId } });
  if (row?.poId !== poId) return { ok: false, error: 'REMITTANCE_NOT_FOUND' };
  // 증빙 실파일 먼저 → DB(고아 파일 방지, file-server 관례).
  const files = await prisma.spFile.findMany({
    where: { refType: REMITTANCE_REF_TYPE, refId: remittanceId },
  });
  for (const f of files) await deleteFromFileServer(f.pathToken);
  await prisma.$transaction([
    prisma.spFile.deleteMany({ where: { refType: REMITTANCE_REF_TYPE, refId: remittanceId } }),
    prisma.spPcbRemittance.delete({ where: { id: remittanceId } }),
  ]);
  await syncPoRemittedAt(poId);
  return { ok: true };
};

// ── 증빙(이체 확인증) — sp_file refType 'sp_pcb_remittance' ───────────────────
export const uploadRemittanceFile = async (
  remittanceId: bigint,
  file: UploadTarget,
  uploadedBy: string,
): Promise<void> => {
  const [uploaded] = await uploadToFileServer([file], REMITTANCE_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('송금 증빙 업로드에 실패했습니다');
  await prisma.spFile.create({
    data: {
      refType: REMITTANCE_REF_TYPE,
      refId: remittanceId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType: 'receipt',
      uploadedBy,
    },
  });
};

export const deleteRemittanceFile = async (
  remittanceId: bigint,
  fileId: bigint,
): Promise<boolean> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return false;
  if (row.refType !== REMITTANCE_REF_TYPE || row.refId !== remittanceId) return false;
  await deleteFromFileServer(row.pathToken);
  await prisma.spFile.delete({ where: { id: row.id } });
  return true;
};

export const getRemittanceFileDownload = async (
  remittanceId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== REMITTANCE_REF_TYPE || row.refId !== remittanceId) return null;
  return { pathToken: row.pathToken, originFileName: row.originFileName };
};

// ── 무상(free) A/S 회차 — 지급·수금 집계 제외 판정 ───────────────────────────
// proceed 는 원발주를 그대로 복사한다(원가 회계) — 돈이 실제로 오가는지는 케이스의
// chargeType 이 정한다. 무상이면 그 회차 발주(reorderRound>0)는 잔액 0 취급이고,
// 유상(paid)은 현행 그대로다. 케이스와 발주는 (specId, reorderRound)로 만난다
// (회차는 스펙 단위 채번이라 이 쌍이 케이스를 유일하게 짚는다).

/** 무상 A/S 회차 키 집합 — `${specId}:${reorderRound}`. */
export const loadFreeAsRoundKeys = async (
  pos: readonly { specId: bigint; reorderRound: number }[],
): Promise<Set<string>> => {
  const rounds = pos.filter((p) => p.reorderRound > 0);
  if (rounds.length === 0) return new Set();
  const cases = await prisma.spPcbAsCase.findMany({
    where: {
      chargeType: 'free',
      reorderRound: { not: null },
      specId: { in: [...new Set(rounds.map((p) => p.specId.toString()))].map((v) => BigInt(v)) },
    },
    select: { specId: true, reorderRound: true },
  });
  return new Set(cases.map((c) => `${c.specId.toString()}:${String(c.reorderRound)}`));
};

/** 이 발주가 무상 A/S 회차인가 — loadFreeAsRoundKeys 결과로 판정. */
export const isFreeAsPo = (
  freeKeys: ReadonlySet<string>,
  po: { specId: bigint; reorderRound: number },
): boolean =>
  po.reorderRound > 0 && freeKeys.has(`${po.specId.toString()}:${String(po.reorderRound)}`);

/** 발주서 여러 건의 지급 요약을 한 번에(목록·집계의 N+1 회피). */
export const loadRemittanceSummaries = async (
  pos: readonly { id: bigint; currency: string; priceOriginal: unknown }[],
): Promise<Map<string, PcbRemittanceSummaryType>> => {
  const map = new Map<string, PcbRemittanceSummaryType>();
  if (pos.length === 0) return map;
  const rows = await prisma.spPcbRemittance.findMany({
    where: { poId: { in: pos.map((p) => p.id) } },
    select: { poId: true, amount: true, remittedOn: true },
  });
  const byPo = new Map<string, { amount: unknown; remittedOn: Date }[]>();
  for (const r of rows) {
    const key = r.poId.toString();
    const bucket = byPo.get(key) ?? [];
    bucket.push({ amount: r.amount, remittedOn: r.remittedOn });
    byPo.set(key, bucket);
  }
  for (const po of pos) {
    const key = po.id.toString();
    map.set(
      key,
      summarizePcbRemittances(po, (byPo.get(key) ?? []) as Pick<
        SpPcbRemittance,
        'amount' | 'remittedOn'
      >[]),
    );
  }
  return map;
};
