import { describe, expect, it } from 'vitest';
import {
  AdminDevelopTasksPutBody,
  DEVELOP_DEFAULT_TASKS,
  DEVELOP_TASK_STATUSES,
  DEVELOP_TASK_STATUS_LABELS,
  developOverdueTaskCount,
  developProgressSummary,
  developTaskCoherent,
} from '@sp/api-contract/develop-c';

// 2026-09-10 개발(C)에 이식한 G 수행관리 규칙 — 제외(skipped) 행·지연 작업 수·상태↔진행률 정합·업무표 PUT 본문.
describe('develop-c tasks — G rules ported', () => {
  it('제외(skipped) 상태가 사전에 있고 라벨이 있다', () => {
    expect(DEVELOP_TASK_STATUSES).toContain('skipped');
    expect(DEVELOP_TASK_STATUS_LABELS.skipped).toBe('제외');
  });

  it('제외 행은 달성도 가중치·단계 판정에서 빠진다', () => {
    const base = [
      { phase: 'design' as const, status: 'done' as const, weightBp: 5000, progressPct: 100 },
      { phase: 'design' as const, status: 'skipped' as const, weightBp: 5000, progressPct: 0 },
      { phase: 'fabrication' as const, status: 'planned' as const, weightBp: 5000, progressPct: 0 },
    ];
    const s = developProgressSummary(base, true);
    // 제외 행을 빼면 design 100%(5000) + fabrication 0%(5000) → 50%. 제외 행을 셌다면 33% 였을 것.
    expect(s.progressPct).toBe(50);
    expect(s.phases.find((p) => p.phase === 'design')?.state).toBe('done');
    expect(s.currentPhase).toBe('fabrication');
    // 제외 행만 있는 단계는 업무 없는 단계로 본다.
    const onlySkipped = developProgressSummary([{ phase: 'assembly', status: 'skipped', weightBp: 1000, progressPct: 0 }], true);
    expect(onlySkipped.phases.find((p) => p.phase === 'assembly')?.taskCount).toBe(0);
    expect(onlySkipped.currentPhase).toBeNull();
  });

  it('지연 작업 수 = 완료일 경과 ∧ 미완료(제외·완료 제외)', () => {
    const today = '2026-09-10';
    expect(
      developOverdueTaskCount(
        [
          { status: 'in_progress', endOn: '2026-09-09' }, // 지연
          { status: 'planned', endOn: '2026-09-10' }, // 오늘은 아직
          { status: 'done', endOn: '2026-09-01' }, // 끝남
          { status: 'skipped', endOn: '2026-09-01' }, // 제외
          { status: 'delayed', endOn: null }, // 날짜 없음
          { status: 'on_hold', endOn: '2026-08-31' }, // 지연
        ],
        today,
      ),
    ).toBe(2);
  });

  it('완료 ⇔ 100% · 예정 ⇒ 0% 정합', () => {
    expect(developTaskCoherent({ status: 'done', progressPct: 100 })).toBe(true);
    expect(developTaskCoherent({ status: 'done', progressPct: 40 })).toBe(false);
    expect(developTaskCoherent({ status: 'in_progress', progressPct: 100 })).toBe(false);
    expect(developTaskCoherent({ status: 'planned', progressPct: 0 })).toBe(true);
    expect(developTaskCoherent({ status: 'planned', progressPct: 10 })).toBe(false);
    expect(developTaskCoherent({ status: 'skipped', progressPct: 30 })).toBe(true);
    expect(developTaskCoherent({ status: 'delayed', progressPct: 0 })).toBe(true);
  });

  it('업무표 PUT 본문 — taskId 기본 null, 정합 위반·중복 taskId·revision 문자열', () => {
    const ok = AdminDevelopTasksPutBody.safeParse({ tasks: [{ name: '회로 설계', phase: 'design' }], revision: 'abc' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.tasks[0]?.taskId).toBeNull();
      expect(ok.data.revision).toBe('abc');
    }
    const incoherent = AdminDevelopTasksPutBody.safeParse({ tasks: [{ name: 'x', phase: 'design', status: 'done', progressPct: 50 }] });
    expect(incoherent.success).toBe(false);
    const dup = AdminDevelopTasksPutBody.safeParse({
      tasks: [
        { taskId: 7, name: 'a', phase: 'design' },
        { taskId: 7, name: 'b', phase: 'design' },
      ],
    });
    expect(dup.success).toBe(false);
    // 기본 업무 15개는 그대로 통과한다(taskId null 포함).
    expect(AdminDevelopTasksPutBody.safeParse({ tasks: DEVELOP_DEFAULT_TASKS }).success).toBe(true);
  });
});
