import { describe, expect, it } from 'vitest';
import { diffProjectSnapshots } from './market-revision';
import type { MarketProjectSnapshotType } from './market-revision';

// 의뢰 수정 이력의 diff — 화면 문장과 major 판정이 여기서 나온다(docs/MARKET_FLOW.md §의뢰 수정·버전).

const base: MarketProjectSnapshotType = {
  title: '화분 물 주기 알림 장치',
  serviceAreas: ['circuit', 'pcb'],
  tools: { version: 1, byArea: {} },
  description: '화분 흙 습도를 재서 알려 주는 장치를 만들고 싶습니다.',
  answers: [
    { code: 'timeline', choices: ['m2_3'] },
    { code: 'target_stage', choices: ['prototype'] },
    { code: 'deliverable_scope', choices: ['source'] },
  ],
  budgetRange: 'r500_2000',
  ndaRequired: true,
  bidDeadlineAt: '2026-09-11T14:59:59.000Z',
  attachmentCount: 2,
};

describe('diffProjectSnapshots', () => {
  it('바뀐 값이 없으면 변경도 없다 — 빈 수정은 이력을 만들지 않는다', () => {
    const diff = diffProjectSnapshots(base, { ...base });
    expect(diff.changedFields).toEqual([]);
    expect(diff.major).toBe(false);
  });

  it('제목만 바뀌면 사소한 수정 — 입찰자 경고를 울리지 않는다', () => {
    const diff = diffProjectSnapshots(base, { ...base, title: '화분 물 주기 알림기' });
    expect(diff.changedFields).toEqual(['title']);
    expect(diff.major).toBe(false);
    expect(diff.changes[0]).toMatchObject({ label: '제목', before: base.title, after: '화분 물 주기 알림기' });
  });

  it('설명·분야·첨부는 중대한 수정', () => {
    expect(diffProjectSnapshots(base, { ...base, description: '다른 설명' }).major).toBe(true);
    expect(diffProjectSnapshots(base, { ...base, serviceAreas: ['circuit'] }).major).toBe(true);
    expect(diffProjectSnapshots(base, { ...base, attachmentCount: 3 }).major).toBe(true);
  });

  it('예산·NDA 는 이력에만 남는다', () => {
    const diff = diffProjectSnapshots(base, { ...base, budgetRange: 'over5000', ndaRequired: false });
    expect(diff.changedFields).toEqual(['budgetRange', 'ndaRequired']);
    expect(diff.major).toBe(false);
    // 코드가 아니라 사람이 읽는 라벨로 남는다
    expect(diff.changes[0]?.after).toBe('5,000만원 이상');
    expect(diff.changes[1]?.after).toBe('불필요');
  });

  it('답변은 바뀐 문항만 견준다', () => {
    const diff = diffProjectSnapshots(base, {
      ...base,
      answers: [
        { code: 'timeline', choices: ['m1'] },
        { code: 'target_stage', choices: ['prototype'] },
        { code: 'deliverable_scope', choices: ['source'] },
      ],
    });
    expect(diff.changedFields).toEqual(['answers']);
    expect(diff.major).toBe(true);
    // 안 바뀐 문항(목표 단계·인도 범위)은 문장에 없다
    expect(diff.changes[0]?.before).not.toContain('목표 단계');
    expect(diff.changes[0]?.before).not.toBe(diff.changes[0]?.after);
  });

  it('첨부는 개수만 담는다 — 파일명은 NDA 게이트 뒤에 있다', () => {
    const diff = diffProjectSnapshots(base, { ...base, attachmentCount: 4 });
    expect(diff.changes[0]).toMatchObject({ label: '첨부 자료', before: '2개', after: '4개' });
  });
});
