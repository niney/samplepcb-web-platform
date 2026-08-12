import {
  PCB_PAYMENT_TERM_CUSTOM_DATE,
  PCB_PAYMENT_TERM_NET_7,
} from '@sp/api-contract';
import { kstDateStr } from './kst';

const DAY_MS = 86_400_000;
const parseKstDate = (value: string): Date => new Date(`${value}T00:00:00+09:00`);

export type PcbRemittanceDueError = 'REMITTANCE_DUE_REQUIRED';

/**
 * 결제조건과 송금 예정일을 한 쌍으로 확정한다.
 *
 * - NET 7 DAYS: 클라이언트 날짜를 신뢰하지 않고 발주일(KST)+7일로 서버가 계산한다.
 * - CUSTOM PAYMENT DATE: 명시 날짜가 필수이며, 수정에서 생략되면 기존 날짜를 보존한다.
 * - 그 밖의 자유 결제조건: 예정일을 비운다(실제 송금일은 언제나 별도 원장에만 기록).
 */
export const resolvePcbRemittanceDueOn = (params: {
  paymentTerms: string | null;
  requestedDueOn: string | null | undefined;
  issuedAt: Date;
  existingDueOn?: Date | null;
}): { ok: true; dueOn: Date | null } | { ok: false; error: PcbRemittanceDueError } => {
  if (params.paymentTerms === PCB_PAYMENT_TERM_NET_7) {
    const dueDate = kstDateStr(new Date(params.issuedAt.getTime() + 7 * DAY_MS));
    return { ok: true, dueOn: parseKstDate(dueDate) };
  }

  if (params.paymentTerms === PCB_PAYMENT_TERM_CUSTOM_DATE) {
    const dueOn =
      params.requestedDueOn === undefined
        ? (params.existingDueOn ?? null)
        : params.requestedDueOn === null
          ? null
          : parseKstDate(params.requestedDueOn);
    return dueOn === null
      ? { ok: false, error: 'REMITTANCE_DUE_REQUIRED' }
      : { ok: true, dueOn };
  }

  return { ok: true, dueOn: null };
};
