import { describe, expect, it } from 'vitest';
import {
  PCB_PAYMENT_TERM_CUSTOM_DATE,
  PCB_PAYMENT_TERM_NET_7,
} from '@sp/api-contract';
import { kstDateStr } from './kst';
import { resolvePcbRemittanceDueOn } from './pcb-payment-terms';

describe('resolvePcbRemittanceDueOn', () => {
  it('NET 7 DAYS를 발주일의 KST 업무일 기준 7일 후로 확정한다', () => {
    const beforeMidnight = resolvePcbRemittanceDueOn({
      paymentTerms: PCB_PAYMENT_TERM_NET_7,
      requestedDueOn: '2099-01-01',
      issuedAt: new Date('2026-08-12T14:59:59.000Z'), // KST 2026-08-12 23:59:59
    });
    const afterMidnight = resolvePcbRemittanceDueOn({
      paymentTerms: PCB_PAYMENT_TERM_NET_7,
      requestedDueOn: null,
      issuedAt: new Date('2026-08-12T15:00:00.000Z'), // KST 2026-08-13 00:00:00
    });

    if (!beforeMidnight.ok || beforeMidnight.dueOn === null) throw new Error('NET 7 due missing');
    if (!afterMidnight.ok || afterMidnight.dueOn === null) throw new Error('NET 7 due missing');
    expect(kstDateStr(beforeMidnight.dueOn)).toBe('2026-08-19');
    expect(kstDateStr(afterMidnight.dueOn)).toBe('2026-08-20');
  });

  it('CUSTOM PAYMENT DATE는 명시 날짜를 KST 날짜로 박제한다', () => {
    const result = resolvePcbRemittanceDueOn({
      paymentTerms: PCB_PAYMENT_TERM_CUSTOM_DATE,
      requestedDueOn: '2026-08-28',
      issuedAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    if (!result.ok || result.dueOn === null) throw new Error('custom due missing');
    expect(result.dueOn.toISOString()).toBe('2026-08-27T15:00:00.000Z');
  });

  it('CUSTOM PAYMENT DATE의 날짜 누락을 거부하고 수정 생략은 기존값을 보존한다', () => {
    const missing = resolvePcbRemittanceDueOn({
      paymentTerms: PCB_PAYMENT_TERM_CUSTOM_DATE,
      requestedDueOn: null,
      issuedAt: new Date(),
    });
    const existing = new Date('2026-08-27T15:00:00.000Z');
    const preserved = resolvePcbRemittanceDueOn({
      paymentTerms: PCB_PAYMENT_TERM_CUSTOM_DATE,
      requestedDueOn: undefined,
      issuedAt: new Date(),
      existingDueOn: existing,
    });

    expect(missing).toEqual({ ok: false, error: 'REMITTANCE_DUE_REQUIRED' });
    expect(preserved).toEqual({ ok: true, dueOn: existing });
  });

  it('그 밖의 자유 결제조건은 예정일을 남기지 않는다', () => {
    expect(
      resolvePcbRemittanceDueOn({
        paymentTerms: '50% PRE-PAID',
        requestedDueOn: '2026-08-28',
        issuedAt: new Date(),
      }),
    ).toEqual({ ok: true, dueOn: null });
  });
});
