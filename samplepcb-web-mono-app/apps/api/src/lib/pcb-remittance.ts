import type { FastifyBaseLogger } from 'fastify';
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
import { getPcbExchangeRate, roundPcbAmount } from './exchange-rate';
import { asPcbCurrency } from './pcb-rfq';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';
import { buildPcbRemittanceSettledEmail, pcbPriceText, sendPcbMail } from './pcb-rfq-email';
import { resolvePcbPortalCta } from './pcb-portal-cta';
import { kstDateStr } from './kst';

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

export type PcbRemittanceError =
  | 'PO_NOT_FOUND'
  | 'REMITTANCE_NOT_FOUND'
  | 'EXCHANGE_RATE_REQUIRED';

export const createPcbRemittance = async (
  poId: bigint,
  body: PcbRemittanceCreateBodyType,
  actorMbId: string,
): Promise<{ ok: true } | { ok: false; error: PcbRemittanceError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const currency = asPcbCurrency(po.currency);
  const amount = roundPcbAmount(body.amount, currency);
  let exchangeRate = body.exchangeRate;
  if (currency !== 'KRW' && exchangeRate === undefined) {
    // 자동 환율은 **오늘 송금**에만 안전하다. 과거·미래 날짜에 최신 캐시를 붙이면
    // '송금 시점 실제 환율'이라는 원장 의미가 깨지므로 그 경우는 명시 입력을 요구한다.
    if (body.remittedOn !== kstDateStr(new Date())) {
      return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
    }
    const daily = await getPcbExchangeRate(currency, 'KRW');
    if (daily === null) return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
    exchangeRate = daily.rate;
  }
  await prisma.spPcbRemittance.create({
    data: {
      poId,
      remittedOn: parseKstDate(body.remittedOn),
      currency: po.currency, // 발주 통화 고정 — 클라이언트 값을 받지 않는다
      amount,
      ...krwFields(po.currency, amount, exchangeRate),
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
  const nextRate = body.exchangeRate ?? decNum(row.exchangeRate);
  if (
    asPcbCurrency(row.currency) !== 'KRW' &&
    (body.amount !== undefined || body.exchangeRate !== undefined) &&
    nextRate === null
  ) {
    return { ok: false, error: 'EXCHANGE_RATE_REQUIRED' };
  }
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

// ── 완납 통지(여정 8호 결정) ─────────────────────────────────────────────────
// 관리자가 송금해도 협력사에는 포털 배지 말고 신호가 없었다. 그렇다고 **회차마다**
// 알리면 알림이 사실보다 앞선다 — 원장은 정정·삭제되는 기록이다(여정 30호 실측:
// 100→50 정정, 행 삭제까지). 그래서 **잔액이 0 이 된 순간 1회만** 보낸다. 잔액 0 은
// 워크큐를 가르는 경계이고, 협력사가 실제로 알고 싶은 지점도 그 하나다.
//
// "1회"는 **발주서당 1회**다 — 원장(sp_mail_log)에 발송 기록이 있으면 다시 보내지
// 않는다. 그래서 완납 뒤 정정으로 잔액이 되살아나고 다시 0 이 되어도 재통지하지 않는다:
// 이미 나간 메일은 되돌릴 수 없고 같은 문구를 두 번 보내면 협력사는 두 번 받았다고
// 여긴다. 그런 정정은 사람이 직접 알리는 편이 정확하다.

const SETTLED_MAIL_KIND = 'pcb_remit_settled';
const SETTLED_MAIL_REF_TYPE = 'pcb_po';

/**
 * 발주서별 통지 직렬화(여정 41호 교정).
 *
 * 중복 방지는 원장 조회("이미 sent 가 있나")로 하는데, **조회와 발송 사이**가 벌어지면 두
 * 요청이 나란히 "없다"를 보고 둘 다 보낸다 — 잔액을 0 으로 만드는 송금 두 건이 동시에 오면
 * 실제로 그렇게 됐다(협력사가 같은 안내를 두 번 받았다). 경리가 버튼을 두 번 누르는 일은
 * 드물지 않다.
 *
 * 같은 발주서의 통지 시도를 프로세스 안에서 한 줄로 세워 그 틈을 없앤다. 앞선 시도가 메일을
 * 보내고 원장에 남긴 뒤에야 다음 시도가 조회하므로 두 번째는 "이미 보냈다"를 본다.
 *
 * ⚠ 한계: **한 프로세스 안에서만** 유효하다. API 를 여러 인스턴스로 띄우면 인스턴스 간에는
 *   같은 틈이 남는다. 근본책은 원자적 claim(예: sp_pcb_po 에 통지 시각 컬럼을 두고
 *   `UPDATE ... WHERE id=? AND col IS NULL` 로 한 쪽만 이기게 하는 것)이고, 스키마 변경이
 *   따르므로 이월한다. 지금 구조(단일 API 프로세스)에서는 이 직렬화로 충분하다.
 */
const settleNoticeChain = new Map<string, Promise<void>>();

/**
 * 이 발주서가 방금 완납됐으면 수주 협력사에 1회 통지한다(아니면 아무것도 하지 않는다).
 * ⚠ 실패해도 throw 하지 않는다 — 원장이 정본이고 메일은 부수다. 송금 기록이 메일 때문에
 *   무산되면 안 된다.
 */
export const notifyPcbRemittanceSettled = async (
  log: FastifyBaseLogger,
  poId: bigint,
  actorMbId: string,
): Promise<void> => {
  // 같은 발주서의 시도를 한 줄로 세운다(위 주석 참조). 앞 시도의 실패가 뒤를 막지 않도록
  // 체인은 항상 이어 붙이고, 끝나면 자기 자리를 비운다.
  const key = poId.toString();
  const prev = settleNoticeChain.get(key) ?? Promise.resolve();
  const mine = prev
    .catch(() => undefined)
    .then(() => runSettledNotice(log, poId, actorMbId));
  settleNoticeChain.set(key, mine);
  void mine.finally(() => {
    if (settleNoticeChain.get(key) === mine) settleNoticeChain.delete(key);
  });
  return mine;
};

const runSettledNotice = async (
  log: FastifyBaseLogger,
  poId: bigint,
  actorMbId: string,
): Promise<void> => {
  try {
    const po = await prisma.spPcbPo.findUnique({
      where: { id: poId },
      include: { spec: { select: { projectName: true } }, partner: true },
    });
    if (po === null) return;

    const rows = await prisma.spPcbRemittance.findMany({
      where: { poId },
      select: { amount: true, remittedOn: true },
    });
    const summary = summarizePcbRemittances(po, rows);
    // 한 푼도 안 나갔으면 완납이 아니다 — 이 조건이 무상 A/S 회차(잔액을 0 으로 눕히는
    // 표시 규칙)가 완납 통지로 새는 것도 함께 막는다.
    if (summary.count === 0) return;
    if (summary.status !== 'paid' && summary.status !== 'over') return;

    // 이미 보냈으면 끝. 'sent' 만 센다 — 실패·스킵은 다시 시도할 여지를 남긴다.
    // ⚠ 확인-후-발송 사이의 레이스는 막지 않는다: 송금 기록은 사람이 한 건씩 하는 작업이라
    //   같은 발주서에 동시 두 요청이 들어올 일이 실질적으로 없다.
    const alreadySent = await prisma.spMailLog.count({
      where: {
        kind: SETTLED_MAIL_KIND,
        refType: SETTLED_MAIL_REF_TYPE,
        refId: poId.toString(),
        status: 'sent',
      },
    });
    if (alreadySent > 0) return;

    const portalCta = await resolvePcbPortalCta(po.partnerId);
    await sendPcbMail(
      log,
      po.partner.contactEmail,
      buildPcbRemittanceSettledEmail({
        partnerName: po.partner.name,
        projectName: po.spec.projectName,
        // 발주가가 아니라 **실제로 보낸 금액**이다(과지급이면 발주가보다 크다).
        amountText: pcbPriceText(summary.currency, summary.paidAmount, null, null),
        lastRemittedText:
          summary.lastRemittedOn === null ? null : kstDateStr(new Date(summary.lastRemittedOn)),
        count: summary.count,
        ...portalCta,
      }),
      {
        kind: SETTLED_MAIL_KIND,
        refType: SETTLED_MAIL_REF_TYPE,
        refId: poId,
        sentBy: actorMbId,
        params: {
          partnerName: po.partner.name,
          currency: summary.currency,
          paidAmount: summary.paidAmount,
          count: summary.count,
        },
      },
    );
  } catch (err) {
    log.error({ err, poId: poId.toString() }, 'pcb remittance settled notice failed');
  }
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

/** 원장의 **실지급 KRW**(송금 건 krwAmount 합)와 환율 미기입 건수를 발주서별로.
 *  협력사별 집계가 쓰던 '발주 회계 × 지급비율' 비례배분은 추정치라 환차가 사라진다 —
 *  같은 USD 300 이 화면에선 ₩414,000(발주 회계)인데 실제로 나간 돈은 ₩412,500 이었다.
 *  환율을 안 적은 건은 krwAmount 가 null 이라 합계에서 빠지므로 그 건수도 함께 센다
 *  (화면이 "일부 환율 미기입"을 밝히지 않으면 합계가 조용히 작아진다). */
export const loadRemittanceKrwPaid = async (
  pos: readonly { id: bigint }[],
): Promise<Map<string, { krwPaid: number; rateMissingCount: number }>> => {
  const map = new Map<string, { krwPaid: number; rateMissingCount: number }>();
  if (pos.length === 0) return map;
  const rows = await prisma.spPcbRemittance.findMany({
    where: { poId: { in: pos.map((p) => p.id) } },
    select: { poId: true, krwAmount: true },
  });
  for (const r of rows) {
    const key = r.poId.toString();
    const acc = map.get(key) ?? { krwPaid: 0, rateMissingCount: 0 };
    if (r.krwAmount === null) acc.rateMissingCount += 1;
    else acc.krwPaid += r.krwAmount;
    map.set(key, acc);
  }
  return map;
};

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
