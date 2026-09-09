import { describe, expect, it } from 'vitest';
import { WorkPlan, emptyWorkState, workDefaultTasks, workProgress, workPublishedVersion, workTimeline } from '@sp/api-contract';
import type { WorkCommandType, WorkContextType, WorkStateType } from '@sp/api-contract';
import { publicWorkState, reduceWorkflow } from './develop-workflow-domain';

const context = (patch: Partial<WorkContextType> = {}): WorkContextType => ({ title: '센서 보드', customer: '시험 고객', requestStatus: 'accepted', startedAt: null, contractReady: true, paymentReady: true, aiConsent: true, deliverablesLocked: true, quotes: [], ...patch });
const actor = { admin: true, now: '2026-09-09T00:00:00.000Z' };
function apply(state: WorkStateType, command: WorkCommandType, ctx = context(), admin = true): WorkStateType { return reduceWorkflow(state, command, ctx, { ...actor, admin }).state; }
function review(): WorkStateType {
  let state = apply(emptyWorkState(), { type: 'document.create', kind: 'review', id: 'review-1' });
  const doc = state.documents[0]; if (!doc?.draft) throw new Error('fixture');
  doc.draft.content.fields['주요 설계 결정'] = '회로도 Rev A';
  state = apply(state, { type: 'document.publish', id: doc.id });
  return state;
}
function gated(): WorkStateType {
  const state = review();
  state.plan.tasks = workDefaultTasks(['pcb']);
  const task = state.plan.tasks[0]; if (!task) throw new Error('fixture');
  task.approvalDocumentIds = ['review-1'];
  return state;
}

describe('개발의뢰 수행관리 업무 규칙', () => {
  it('견적·착수금·필수자료가 모두 준비돼야 착수한다', () => {
    const state = emptyWorkState();
    expect(() => reduceWorkflow(state, { type: 'start' }, context(), actor)).toThrow('필수자료');
    state.materialsReady = true;
    for (const ctx of [context({ contractReady: false }), context({ paymentReady: false }), context({ requestStatus: 'received' })]) expect(() => reduceWorkflow(state, { type: 'start' }, ctx, actor)).toThrow();
    expect(reduceWorkflow(state, { type: 'start' }, context(), actor).effect).toBe('start');
  });
  it('고객은 계획과 준비 상태를 변경할 수 없다', () => {
    expect(() => apply(emptyWorkState(), { type: 'readiness.save', materialsReady: true, materialsNote: '' }, context(), false)).toThrow('고객은');
  });
  it('실제 날짜와 일수를 사용하고 제외 작업의 가중치를 빼서 계산한다', () => {
    const tasks = workDefaultTasks(['pcb']); const a = tasks[0]; const b = tasks[1]; if (!a || !b) throw new Error('fixture');
    a.start = '2026-09-01'; a.end = '2026-09-10'; a.progress = 100; a.status = 'completed'; a.weight = 25;
    b.start = '2026-10-01'; b.end = '2026-10-10'; b.progress = 0; b.weight = 75;
    for (const t of tasks.slice(2)) t.status = 'skipped';
    expect(workProgress(tasks)).toBe(25);
    expect(workTimeline(tasks)).toEqual({ start: '2026-09-01', end: '2026-10-10', days: 40 });
    b.status = 'skipped'; expect(workProgress(tasks)).toBe(100);
  });
  it('잘못된 날짜·역전 기간·완료 진행률을 거부한다', () => {
    const state = emptyWorkState(); state.plan.tasks = workDefaultTasks(['pcb']); const t = state.plan.tasks[0]; if (!t) throw new Error('fixture');
    t.start = '2026-02-30'; expect(WorkPlan.safeParse(state.plan).success).toBe(false);
    t.start = '2026-09-10'; t.end = '2026-09-01'; expect(WorkPlan.safeParse(state.plan).success).toBe(false);
    t.end = null; t.status = 'completed'; expect(WorkPlan.safeParse(state.plan).success).toBe(false);
  });
  it('선행 작업의 순환과 없는 참조를 거부한다', () => {
    const state = emptyWorkState(); const plan = { ...state.plan, tasks: workDefaultTasks(['pcb']) }; const a = plan.tasks[0]; const b = plan.tasks[1]; if (!a || !b) throw new Error('fixture');
    a.dependencies = [b.id]; b.dependencies = [a.id]; expect(() => apply(state, { type: 'plan.save', plan })).toThrow('순환');
    b.dependencies = ['absent']; expect(() => apply(state, { type: 'plan.save', plan })).toThrow('없거나');
  });
  it('연결한 문서의 승인 전에는 작업을 진행하지 못한다', () => {
    const state = gated(); const plan = structuredClone(state.plan); const t = plan.tasks[0]; if (!t) throw new Error('fixture'); t.status = 'in_progress'; t.progress = 20;
    expect(() => apply(state, { type: 'plan.save', plan }, context({ requestStatus: 'in_progress' }))).toThrow('고객 승인');
    const approved = apply(state, { type: 'document.decide', id: 'review-1', version: 1, decision: 'approved', note: '' }, context(), false);
    expect(apply(approved, { type: 'plan.save', plan }, context({ requestStatus: 'in_progress' })).plan.tasks[0]?.progress).toBe(20);
  });
  it('조건부 승인은 작업을 열지 않는다', () => {
    const state = apply(gated(), { type: 'document.decide', id: 'review-1', version: 1, decision: 'conditional', note: '전원부 확인 후' }, context(), false);
    const plan = structuredClone(state.plan); const t = plan.tasks[0]; if (!t) throw new Error('fixture'); t.status = 'in_progress';
    expect(() => apply(state, { type: 'plan.save', plan }, context({ requestStatus: 'in_progress' }))).toThrow('고객 승인');
  });
  it('새 버전 공개는 재승인을 요구하고 구버전 내용·응답을 유지한다', () => {
    let state = apply(review(), { type: 'document.decide', id: 'review-1', version: 1, decision: 'approved', note: '확인' }, context(), false);
    const doc = state.documents[0]; if (!doc?.draft) throw new Error('fixture'); doc.draft.content.fields['주요 설계 결정'] = '회로도 Rev B';
    state = apply(state, { type: 'document.publish', id: 'review-1' });
    expect(state.documents[0]?.versions[0]?.content.fields['주요 설계 결정']).toBe('회로도 Rev A');
    expect(state.documents[0]?.versions[0]?.decision?.decision).toBe('approved');
    expect(state.documents[0]?.versions[1]?.decision).toBeNull();
    expect(() => apply(state, { type: 'document.decide', id: 'review-1', version: 1, decision: 'approved', note: '' }, context(), false)).toThrow('최신');
  });
  it('같은 공개 버전에 대한 중복 응답과 관리자 대리 승인을 거부한다', () => {
    const command: WorkCommandType = { type: 'document.decide', id: 'review-1', version: 1, decision: 'approved', note: '' };
    const state = apply(review(), command, context(), false);
    expect(() => apply(state, command, context(), false)).toThrow('이미 응답');
    expect(() => apply(review(), command)).toThrow('고객 계정');
  });
  it('구버전을 작업본으로 복원해도 현재 공개본을 바꾸지 않는다', () => {
    const state = apply(review(), { type: 'document.restore', id: 'review-1', version: 1 });
    const doc = state.documents[0]; if (!doc?.draft) throw new Error('fixture'); doc.draft.content.fields['주요 설계 결정'] = '새 작업본';
    expect(workPublishedVersion(doc)?.content.fields['주요 설계 결정']).toBe('회로도 Rev A');
  });
  it('공개 상태에서 내부 메모·미공개 문서·내부 작업·고객 비공개 파일을 제거한다', () => {
    let state = review(); state.materialsNote = '내부 비밀'; state.plan.tasks = workDefaultTasks(['pcb']);
    const task = state.plan.tasks[0]; if (!task) throw new Error('fixture'); task.customerVisible = false;
    const second = state.plan.tasks[1]; if (!second) throw new Error('fixture'); second.assignee = '관리자 아이디'; second.note = '내부'; second.dependencies = [task.id];
    state.files.push({ fileId: 9, name: '내부.pdf', size: 1, locked: false });
    state = apply(state, { type: 'document.create', kind: 'report', id: 'private' });
    state = apply(state, { type: 'plan.publish' });
    const visible = publicWorkState(state, true);
    expect(visible.materialsNote).toBe(''); expect(visible.documents).toHaveLength(1); expect(visible.documents[0]?.draft).toBeNull(); expect(visible.files).toEqual([]);
    expect(visible.plan.tasks.some((t) => t.id === task.id)).toBe(false); expect(visible.plan.tasks[0]?.assignee).toBe(''); expect(visible.plan.tasks[0]?.dependencies).toEqual([]);
  });
  it('진행 기록이 있는 작업을 삭제하지 못한다', () => {
    const state = gated(); const task = state.plan.tasks[0]; if (!task) throw new Error('fixture'); task.progress = 20; task.status = 'in_progress';
    expect(() => apply(state, { type: 'plan.save', plan: { ...state.plan, tasks: [] } }, context({ requestStatus: 'in_progress' }))).toThrow('삭제 대신');
  });
  it('납품 문서 공개·승인·수정 요청을 기존 상태 전이에 연결한다', () => {
    let state = apply(emptyWorkState(), { type: 'document.create', kind: 'delivery', id: 'delivery' }, context({ requestStatus: 'in_progress' }));
    const published = reduceWorkflow(state, { type: 'document.publish', id: 'delivery' }, context({ requestStatus: 'in_progress' }), actor);
    expect(published.effect).toBe('deliver'); state = published.state;
    expect(reduceWorkflow(state, { type: 'document.decide', id: 'delivery', version: 1, decision: 'approved', note: '' }, context({ requestStatus: 'delivered' }), { ...actor, admin: false }).effect).toBe('confirm');
    expect(reduceWorkflow(state, { type: 'document.decide', id: 'delivery', version: 1, decision: 'changes', note: '수정해 주세요' }, context({ requestStatus: 'delivered' }), { ...actor, admin: false }).effect).toBe('changes');
  });
});
