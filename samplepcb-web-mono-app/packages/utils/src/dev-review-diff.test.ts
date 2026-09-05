import { describe, expect, it } from 'vitest';
import type { MarketDevReviewType } from '@sp/api-contract';
import { diffDevReview, diffWords } from './dev-review-diff';

// 검토서 구조 비교(docs/DEVELOP_FLOW.md §6.2) — 항목 단위 added/removed/changed.
const base = (): MarketDevReviewType => ({
  version: 4,
  brief: { serviceAreas: ['circuit'], answers: [] },
  summary: 'BLE 온습도 로거',
  requirements: [
    { text: 'BLE 5.0 광고 주기 1초', evidence: 'e' },
    { text: '배터리 구동', evidence: 'e' },
  ],
  areas: [
    {
      area: 'circuit',
      summary: '회로 한 줄',
      spec: [
        { item: '전원', text: '리튬 3.7V', evidence: 'e' },
        { item: '통신', text: 'BLE 5.0', evidence: 'e' },
      ],
      observations: [{ text: '관찰 하나', evidence: 'e' }],
    },
  ],
  openQuestions: [{ question: '외장은 정해졌나요?', why: '안테나', area: 'circuit', resolution: null }],
  checks: [],
  meta: { jobId: 'j', model: 'm', promptVersion: 'v', inputHash: 'h', generatedAt: '2026-09-05T00:00:00.000Z', attachmentFiles: [] },
  adminComment: null,
  schedule: {
    phases: [
      { name: '회로 설계', minWeeks: 2, maxWeeks: 3, output: '회로도', prerequisite: '', note: '' },
      { name: '시제품 제작', minWeeks: 3, maxWeeks: 5, output: '시제품', prerequisite: '', note: '' },
    ],
    wishCode: 'm2_3',
    assumptions: '',
  },
});

describe('diffDevReview', () => {
  it('같은 판이면 비어 있다(meta 만 달라도)', () => {
    const b = base();
    b.meta = { ...b.meta, editedAt: '2026-09-06T00:00:00.000Z', editedBy: 'admin', generatedAt: '2026-09-06T00:00:00.000Z' };
    const d = diffDevReview(base(), b);
    expect(d.isEmpty).toBe(true);
    expect(d.changedSections).toEqual([]);
  });

  it('요구사항 추가·삭제를 text 로 짝지어 잡는다', () => {
    const b = base();
    b.requirements = [{ text: 'BLE 5.0 광고 주기 1초', evidence: 'e' }, { text: '방수 IP67', evidence: 'e' }];
    const d = diffDevReview(base(), b);
    expect(d.entries.filter((e) => e.section === 'requirements')).toEqual([
      { section: 'requirements', label: '요구사항', op: 'added', before: null, after: '방수 IP67' },
      { section: 'requirements', label: '요구사항', op: 'removed', before: '배터리 구동', after: null },
    ]);
  });

  it('명세 행은 item 으로 짝지어 문장 변경을 잡고, 분야 추가는 통째로 나온다', () => {
    const b = base();
    b.areas[0]!.spec[0] = { item: '전원', text: '리튬 3.7V 2000mAh', evidence: 'e' };
    b.areas.push({ area: 'firmware', summary: '펌웨어 한 줄', spec: [{ item: 'RTOS', text: 'Zephyr', evidence: 'e' }], observations: [] });
    const d = diffDevReview(base(), b);
    const areas = d.entries.filter((e) => e.section === 'areas');
    expect(areas).toContainEqual({ section: 'areas', label: '회로 개발 › 명세 › 전원', op: 'changed', before: '리튬 3.7V', after: '리튬 3.7V 2000mAh' });
    expect(areas.some((e) => e.label.endsWith('› 분야') && e.op === 'added')).toBe(true);
    expect(areas).toContainEqual({ section: 'areas', label: expect.stringContaining('› 명세 › RTOS') as string, op: 'added', before: null, after: 'Zephyr' });
  });

  it('상의 항목은 question 으로 짝지어 확인 결과 변화를 changed 로 낸다', () => {
    const b = base();
    b.openQuestions[0]!.resolution = '상담 결과: 3D 프린팅 외장';
    const d = diffDevReview(base(), b);
    expect(d.entries).toEqual([
      { section: 'openQuestions', label: '상의 항목 1 › 확인 결과', op: 'added', before: null, after: '상담 결과: 3D 프린팅 외장' },
    ]);
  });

  it('일정은 name 으로 짝지어 기간 변경·단계 추가를 잡고, 한쪽만 일정이 있으면 단계 전부가 나온다', () => {
    const b = base();
    b.schedule!.phases[1] = { ...b.schedule!.phases[1]!, minWeeks: 4, maxWeeks: 6 };
    b.schedule!.phases.push({ name: '펌웨어 1차', minWeeks: 2, maxWeeks: 4, output: '', prerequisite: '', note: '' });
    const d = diffDevReview(base(), b);
    expect(d.entries.filter((e) => e.section === 'schedule')).toEqual([
      { section: 'schedule', label: '일정 › 시제품 제작 › 기간', op: 'changed', before: '3~5주', after: '4~6주' },
      { section: 'schedule', label: '일정 › 펌웨어 1차', op: 'added', before: null, after: '2~4주' },
    ]);
    const none = base();
    none.schedule = null;
    const d2 = diffDevReview(none, base());
    expect(d2.entries.filter((e) => e.section === 'schedule' && e.op === 'added')).toHaveLength(3); // 단계 2 + 희망 시점
    expect(d2.changedSections).toEqual(['schedule']);
  });

  it('요약·담당자 의견은 단일 텍스트 changed 이고 changedSections 가 섹션 순서대로 모인다', () => {
    const b = base();
    b.summary = 'BLE 온습도 로거 v2';
    b.adminComment = '배터리 목표를 먼저';
    const d = diffDevReview(base(), b);
    expect(d.changedSections).toEqual(['summary', 'adminComment']);
    expect(d.entries[0]).toEqual({ section: 'summary', label: '요약', op: 'changed', before: 'BLE 온습도 로거', after: 'BLE 온습도 로거 v2' });
  });
});

describe('diffWords', () => {
  it('같은 문장은 same 하나', () => {
    expect(diffWords('리튬 3.7V', '리튬 3.7V')).toEqual([{ text: '리튬 3.7V', op: 'same' }]);
  });
  it('끝에 붙인 단어는 added 로, 바뀐 단어는 removed+added 로', () => {
    expect(diffWords('리튬 3.7V', '리튬 3.7V 2000mAh')).toEqual([
      { text: '리튬 3.7V', op: 'same' },
      { text: ' 2000mAh', op: 'added' },
    ]);
    const r = diffWords('주기 1초 광고', '주기 2초 광고');
    expect(r.map((t) => t.op)).toEqual(['same', 'removed', 'added', 'same']);
  });
  it('빈 문자열 양쪽을 견딘다', () => {
    expect(diffWords('', 'abc')).toEqual([{ text: 'abc', op: 'added' }]);
    expect(diffWords('abc', '')).toEqual([{ text: 'abc', op: 'removed' }]);
  });
});
