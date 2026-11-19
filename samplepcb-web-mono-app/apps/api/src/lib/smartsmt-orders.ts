import type { Prisma } from '@prisma/client';
import { applySmartsmtReview } from '@sp/api-contract';
import { prisma } from './prisma';
import { SMARTSMT_FILE_REF_TYPE } from './smartsmt';
import { smartsmtBaseUrl } from './smartsmt-pull';

// SmartSMT 의뢰 읽기 — 보관한 의뢰를 주인(회원 아이디)에게만 내준다 (docs/SMARTSMT_INTEGRATION.md §10).
// 두 곳이 쓴다: SmartSMT 서버가 부르는 읽기 주소(routes/smartsmt-orders.ts)와 고객 화면(routes/smt-orders.ts).
//
// 기준은 그 주문의 **마지막 견적**(관리자가 보고 확정하는 견적)이다. 원본 파일과 작업 상태는 그 견적에 없으면
// 같은 주문의 앞선 견적에서 찾는다 — 가져오기(pull)로 받은 견적에는 파일도 작업 상태도 없다.
//
// 주인 대조는 DB 조건(ownerMbId = owner)으로 한다. 주인이 다른 의뢰는 "없는 의뢰"와 구분해 알려 주지 않는다.

const LATEST_SELECT = {
  id: true,
  quoteId: true,
  receivedAt: true,
  currency: true,
  processes: true,
  files: true,
  finalTotal: true,
  finalEstimatedTotal: true,
  review: { select: { status: true, total: true } },
} satisfies Prisma.SpSmtQuoteSelect;
type LatestRow = Prisma.SpSmtQuoteGetPayload<{ select: typeof LATEST_SELECT }>;

export interface SmtOrderRow {
  orderId: string;
  /** 의뢰 이름 — header.title, 없으면 올린 파일 이름, 그것도 없으면 주문 번호. */
  title: string;
  processes: string[];
  quoteId: string;
  requestedAt: Date;
  /** 담당자가 확정했는가. 임시 저장은 확정이 아니다. */
  confirmed: boolean;
  /** 가견적 합계(부가세 포함) — 추정 합계, 없으면 받은 확정 합계. */
  estimatedTotal: number | null;
  /** 담당자가 확정한 합계(부가세 포함). 확정 전에는 null. */
  confirmedTotal: number | null;
  currency: string | null;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 견적의 파일 대조 결과(sp_smt_quote.files) 한 줄. */
const fileEntries = (value: Prisma.JsonValue | null): { part: string; name: string | null; sha256: string | null }[] =>
  Array.isArray(value)
    ? value.flatMap((entry) =>
        isObject(entry) && typeof entry.part === 'string'
          ? [{
              part: entry.part,
              name: typeof entry.name === 'string' ? entry.name : null,
              sha256: typeof entry.sha256 === 'string' ? entry.sha256 : null,
            }]
          : [],
      )
    : [];

/** 파일 이름에서 확장자를 뗀다(`board.zip` → `board`). 점으로 시작하는 이름은 그대로. */
const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

/** 의뢰 이름 — 보낸 이름이 없으면 제조 파일 묶음의 이름, 그다음 아무 파일의 이름, 그것도 없으면 주문 번호. */
export function smtOrderTitle(title: string | null, files: Prisma.JsonValue | null, orderId: string): string {
  if (title !== null && title.trim() !== '') return title.trim();
  const named = fileEntries(files).filter((file) => file.name !== null && file.name.trim() !== '');
  const pick = named.find((file) => file.part === 'gerber_archive') ?? named[0];
  return pick?.name === null || pick?.name === undefined ? orderId : stem(pick.name.trim());
}

const toNumber = (value: Prisma.Decimal | null | undefined): number | null =>
  value === null || value === undefined ? null : value.toNumber();

const toRow = (order: { orderId: string; title: string | null }, latest: LatestRow): SmtOrderRow => {
  const confirmed = latest.review?.status === 'confirmed';
  return {
    orderId: order.orderId,
    title: smtOrderTitle(order.title, latest.files, order.orderId),
    processes: Array.isArray(latest.processes)
      ? latest.processes.filter((item): item is string => typeof item === 'string')
      : [],
    quoteId: latest.quoteId,
    requestedAt: latest.receivedAt,
    confirmed,
    estimatedTotal: toNumber(latest.finalEstimatedTotal) ?? toNumber(latest.finalTotal),
    confirmedTotal: confirmed ? toNumber(latest.review?.total) : null,
    currency: latest.currency,
  };
};

/** 그 회원의 의뢰 목록 — 최근에 받은 것부터. */
export async function listSmtOrdersOf(
  owner: string,
  page: number,
  pageSize: number,
): Promise<{ total: number; items: SmtOrderRow[] }> {
  const where: Prisma.SpSmtOrderWhereInput = { ownerMbId: owner, latestQuoteId: { not: null } };
  const [rows, total] = await Promise.all([
    prisma.spSmtOrder.findMany({
      where,
      select: { orderId: true, title: true, latestQuote: { select: LATEST_SELECT } },
      orderBy: [{ lastReceivedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.spSmtOrder.count({ where }),
  ]);
  return {
    total,
    items: rows.flatMap((row) => (row.latestQuote === null ? [] : [toRow(row, row.latestQuote)])),
  };
}

/** 보관한 원본 파일 한 줄 — pathToken 은 응답에 싣지 않는다(파일서버 경유 내려받기에만 쓴다). */
export interface SmtOrderStoredFile {
  part: string;
  name: string;
  bytes: number;
  sha256: string | null;
  pathToken: string;
}

/**
 * 그 주문의 원본 파일 — 파일을 실제로 보관하고 있는 가장 최근 견적의 것.
 * 가져오기로 받은 견적에는 파일이 없으므로, 마지막 견적에 없으면 앞선 견적(고객이 보낸 것)에서 찾는다.
 */
async function storedFilesOf(orderRefId: bigint): Promise<SmtOrderStoredFile[]> {
  const quotes = await prisma.spSmtQuote.findMany({
    where: { orderRefId },
    orderBy: { id: 'desc' },
    take: 50,
    select: { id: true, files: true },
  });
  if (quotes.length === 0) return [];
  const stored = await prisma.spFile.findMany({
    where: { refType: SMARTSMT_FILE_REF_TYPE, refId: { in: quotes.map((quote) => quote.id) } },
    orderBy: { id: 'asc' },
    select: { refId: true, slot: true, originFileName: true, size: true, pathToken: true },
  });
  const holder = quotes.find((quote) => stored.some((file) => file.refId === quote.id));
  if (holder === undefined) return [];
  const checks = fileEntries(holder.files);
  return stored.flatMap((file) =>
    file.refId === holder.id && file.slot !== null
      ? [{
          part: file.slot,
          name: file.originFileName,
          bytes: Number(file.size),
          sha256: checks.find((check) => check.part === file.slot)?.sha256 ?? null,
          pathToken: file.pathToken,
        }]
      : [],
  );
}

export interface SmtOrderDetail {
  row: SmtOrderRow;
  /** 받은 견적서 그대로. 읽지 못하면 빈 객체. */
  envelope: JsonObject;
  /** 확정 금액을 채운 견적서. 확정 전에는 null. */
  confirmedEnvelope: JsonObject | null;
  confirmedAt: Date | null;
  customerNote: string;
  /** 받은 작업 상태 그대로(JSON 으로 읽히면 그 값, 아니면 글자). 없으면 null. */
  state: unknown;
  files: SmtOrderStoredFile[];
}

const toAmounts = (value: Prisma.JsonValue): Record<string, number> =>
  isObject(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
    : {};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** 그 회원의 의뢰 한 건. 없거나 주인이 다르면 null. */
export async function loadSmtOrderOf(owner: string, orderId: string): Promise<SmtOrderDetail | null> {
  const order = await prisma.spSmtOrder.findFirst({
    where: { orderId, ownerMbId: owner },
    select: {
      id: true,
      orderId: true,
      title: true,
      latestQuote: { select: { ...LATEST_SELECT, envelope: true, state: true, review: true } },
    },
  });
  const latest = order?.latestQuote ?? null;
  if (order === null || latest === null) return null;

  const parsed = parseJson(latest.envelope);
  const envelope: JsonObject = isObject(parsed) ? parsed : {};
  // 확정한 것만 밖에 내보낸다 — 임시 저장(draft)은 담당자가 고치는 중이다.
  const review = latest.review !== null && latest.review.status === 'confirmed' ? latest.review : null;

  // 작업 상태 — 마지막 견적에 없으면 같은 주문에서 가장 최근에 받은 것.
  let stateText = latest.state;
  if (stateText === null) {
    const earlier = await prisma.spSmtQuote.findFirst({
      where: { orderRefId: order.id, state: { not: null } },
      orderBy: { id: 'desc' },
      select: { state: true },
    });
    stateText = earlier?.state ?? null;
  }
  const stateJson = stateText === null ? undefined : parseJson(stateText);

  return {
    row: toRow(order, latest),
    envelope,
    confirmedEnvelope:
      review !== null
        ? applySmartsmtReview(envelope, {
            lineAmounts: toAmounts(review.lineAmounts),
            blockAmounts: toAmounts(review.blockAmounts),
            customerNote: review.customerNote ?? '',
            reviewedAt: (review.confirmedAt ?? review.updatedAt).toISOString(),
          })
        : null,
    confirmedAt: review === null ? null : (review.confirmedAt ?? review.updatedAt),
    customerNote: review?.customerNote ?? '',
    state: stateText === null ? null : stateJson === undefined ? stateText : stateJson,
    files: await storedFilesOf(order.id),
  };
}

/**
 * 고객이 SmartSMT 화면에서 그 의뢰를 여는 주소. 견적관리의 SMT 행이 건다.
 * `SMARTSMT_OPEN_URL_TEMPLATE`(`{order_id}` 자리 포함)이 있으면 그것을, 없으면 SmartSMT 의 견적서 화면
 * (`{SMARTSMT_BASE_URL}/quote?order=…`)을 쓴다 — SmartSMT 가 "열기 주소"를 만들면 설정만 바꾼다.
 */
export function smartsmtOpenUrl(orderId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const template = (env.SMARTSMT_OPEN_URL_TEMPLATE ?? '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(template) && template.includes('{order_id}')) {
    return template.replaceAll('{order_id}', encodeURIComponent(orderId));
  }
  const base = smartsmtBaseUrl(env);
  return base === null ? null : `${base}/quote?order=${encodeURIComponent(orderId)}`;
}
