import { describe, expect, it } from 'vitest';
import {
  DEVELOP_DEFAULT_TASKS,
  DEVELOP_DOC_TYPES,
  buildDevelopDocMailDraft,
  developDocContentEmpty,
  developDocContentIssues,
  developDocContentRows,
  developDocNo,
  developProgressSummary,
  emptyDevelopDocContent,
} from '@sp/api-contract';

// 계약 순수 함수(develop-docs.ts) — 문서 본문 검증·행 펼침·메일 초안·진행 요약. 서버·화면이 같은 규칙을 쓴다.
describe('develop-docs contract', () => {
  it('빈 본문은 스펙의 모든 키를 갖고 검증을 통과한다', () => {
    for (const type of DEVELOP_DOC_TYPES) {
      const content = emptyDevelopDocContent(type);
      expect(developDocContentIssues(type, content)).toEqual([]);
      expect(developDocContentEmpty(content)).toBe(type !== 'delivery_confirm'); // 납품확인서는 납품물 행이 미리 깔린다
    }
  });

  it('모르는 키·형태·옵션을 이슈로 낸다', () => {
    expect(developDocContentIssues('design_review', { stage: 'nope' })).toEqual(['OPTION:stage']);
    expect(developDocContentIssues('design_review', { foo: 'x' })).toEqual(['UNKNOWN_FIELD:foo']);
    expect(developDocContentIssues('kickoff', { meetingAt: 'yesterday' })).toEqual(['DATE:meetingAt']);
    expect(developDocContentIssues('kickoff', { meetingAt: '2026-09-10T14:00' })).toEqual([]);
    expect(developDocContentIssues('production_approval', { approvalScope: ['pcb_fab', 'pcb_fab'] })).toEqual(['DUPLICATE:approvalScope']);
    expect(developDocContentIssues('production_approval', { approvalScope: 'pcb_fab' })).toEqual(['TYPE:approvalScope']);
    expect(developDocContentIssues('test_report', { results: [{ item: 'x', result: 'maybe' }] })).toEqual(['OPTION:results.result']);
    expect(developDocContentIssues('test_report', { results: [{ bogus: 'x' }] })).toEqual(['UNKNOWN_COLUMN:results.bogus']);
    expect(developDocContentIssues('kickoff', { decisions: [{ item: 'a', dueOn: '2026-13-99x' }] })).toEqual(['DATE:decisions.dueOn']);
  });

  it('행 펼침 — 빈 값은 빼고 select·checklist·table 은 라벨로', () => {
    const rows = developDocContentRows('test_report', {
      sample: '  시제품 3대 ',
      purpose: '',
      results: [
        { item: '전원', criteria: '3.3V', result: 'pass', note: '' },
        { item: '', criteria: '', result: '', note: '' },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(['시제품 정보와 수량', '시험결과']);
    expect(rows[1]?.text).toBe('1. 시험항목: 전원 · 기준: 3.3V · 결과: 적합');
    const scope = developDocContentRows('production_approval', { approvalScope: ['pcb_fab', 'smt'] });
    expect(scope[0]?.text).toBe('PCB 제작 · SMT·수삽');
    const stage = developDocContentRows('design_review', { stage: 'pcb' });
    expect(stage[0]?.text).toBe('PCB설계');
  });

  it('메일 초안 — 승인형은 선택지, 공유형은 진행 안내', () => {
    const approval = buildDevelopDocMailDraft({
      type: 'design_review',
      docNo: developDocNo('design_review', 1),
      requestTitle: 'BLE 로거',
      customerName: '홍길동',
      customerCompany: '이투이랩',
      replyDueOn: '2026-09-20',
      content: { purpose: '회로 확정', stage: 'circuit' },
    });
    expect(approval.subject).toBe('[샘플피씨비] BLE 로거 중간 개발검토서 및 확인 요청');
    expect(approval.body).toContain('이투이랩 홍길동 담당자님, 안녕하세요.');
    expect(approval.body).toContain('중간 개발검토서(DR-01)');
    expect(approval.body).toContain('• 검토 단계: 회로설계');
    expect(approval.body).toContain('- 승인합니다');
    expect(approval.body).toContain('회신 요청일: 2026-09-20');
    const share = buildDevelopDocMailDraft({
      type: 'progress_report',
      docNo: 'PR-02',
      requestTitle: 'BLE 로거',
      customerName: '홍길동',
      customerCompany: null,
      replyDueOn: null,
      content: {},
    });
    expect(share.subject).toBe('[샘플피씨비] BLE 로거 정기 진행보고 안내');
    expect(share.body).toContain('홍길동 담당자님');
    expect(share.body).toContain('계획된 일정에 따라');
    expect(share.body).not.toContain('회신 요청일');
  });

  it('진행 요약 — 가중 달성도·현재 단계·7단계 상태', () => {
    const empty = developProgressSummary([], false);
    expect(empty.progressPct).toBe(0);
    expect(empty.currentPhase).toBeNull();
    expect(empty.phases.every((p) => p.state === 'todo')).toBe(true);
    expect(developProgressSummary([], true).phases[0]?.state).toBe('done');

    const tasks = DEVELOP_DEFAULT_TASKS.map((t, i) => ({
      phase: t.phase,
      status: i < 2 ? ('done' as const) : i < 4 ? ('in_progress' as const) : ('planned' as const),
      weightBp: t.weightBp,
      progressPct: i < 2 ? 100 : i === 2 ? 65 : i === 3 ? 35 : 0,
    }));
    const s = developProgressSummary(tasks, true);
    // 프로토타입 기본값(회로 65·펌웨어 35·선정 40 대신 0)과 같은 계산: Σw·p / Σw
    const w = tasks.reduce((a, t) => a + t.weightBp, 0);
    const expected = Math.round(tasks.reduce((a, t) => a + t.weightBp * t.progressPct, 0) / w);
    expect(s.progressPct).toBe(expected);
    expect(s.currentPhase).toBe('design');
    expect(s.phases.map((p) => p.state)).toEqual(['done', 'done', 'now', 'todo', 'todo', 'todo', 'todo']);
    expect(s.phases[1]?.progressPct).toBe(100);

    const allDone = developProgressSummary(tasks.map((t) => ({ ...t, status: 'done', progressPct: 100 })), true);
    expect(allDone.currentPhase).toBeNull();
    expect(allDone.progressPct).toBe(100);
    expect(allDone.phases.every((p) => p.state === 'done')).toBe(true);

    // 가중치 합 0 이면 단순 평균
    expect(developProgressSummary([{ phase: 'design', status: 'in_progress', weightBp: 0, progressPct: 50 }, { phase: 'design', status: 'planned', weightBp: 0, progressPct: 0 }], true).progressPct).toBe(25);
  });
});
