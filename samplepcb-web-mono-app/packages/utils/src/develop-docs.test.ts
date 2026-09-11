import { describe, expect, it } from 'vitest';
import {
  DEVELOP_DEFAULT_TASKS,
  DEVELOP_DEFAULT_TASK_PLAN,
  DEVELOP_DOC_TYPES,
  DEVELOP_TASK_PHASES,
  buildDevelopDocMailDraft,
  developAutoScheduleDates,
  developDocContentEmpty,
  developDocContentIssues,
  developDocContentRows,
  developDocNo,
  developDocReadonlyKeys,
  developDocStatusLabel,
  developKickoffContractContent,
  developProgressSummary,
  developTaskWeights,
  emptyDevelopDocContent,
} from '@sp/api-contract';

// 계약 순수 함수(develop-docs.ts) — 문서 본문 검증·행 펼침·메일 초안·진행 요약. 서버·화면이 같은 규칙을 쓴다.
// 2026-09-11 간소화: 문서 5종·단계 6·기간 가중 달성도·계약 스냅샷·조건부 필드·자동배치.
describe('develop-docs contract', () => {
  it('문서 5종 — 빈 본문은 스펙의 모든 키를 갖고 검증을 통과한다', () => {
    expect([...DEVELOP_DOC_TYPES]).toEqual(['kickoff', 'stage_review', 'change_request', 'delivery_confirm', 'progress_report']);
    for (const type of DEVELOP_DOC_TYPES) {
      const content = emptyDevelopDocContent(type);
      expect(developDocContentIssues(type, content)).toEqual([]);
      expect(developDocContentEmpty(content)).toBe(type !== 'delivery_confirm'); // 납품확인서는 납품물 행이 미리 깔린다
    }
  });

  it('모르는 키·형태·옵션을 이슈로 낸다', () => {
    expect(developDocContentIssues('stage_review', { stage: 'nope' })).toEqual(['OPTION:stage']);
    expect(developDocContentIssues('stage_review', { foo: 'x' })).toEqual(['UNKNOWN_FIELD:foo']);
    expect(developDocContentIssues('kickoff', { meetingAt: 'yesterday' })).toEqual(['DATE:meetingAt']);
    expect(developDocContentIssues('kickoff', { meetingAt: '2026-09-10T14:00' })).toEqual([]);
    expect(developDocContentIssues('stage_review', { approvalScope: ['pcb_fab', 'pcb_fab'] })).toEqual(['DUPLICATE:approvalScope']);
    expect(developDocContentIssues('stage_review', { approvalScope: 'pcb_fab' })).toEqual(['TYPE:approvalScope']);
    expect(developDocContentIssues('delivery_confirm', { deliverables: [{ item: 'x', check: 'maybe' }] })).toEqual(['OPTION:deliverables.check']);
    expect(developDocContentIssues('delivery_confirm', { deliverables: [{ bogus: 'x' }] })).toEqual(['UNKNOWN_COLUMN:deliverables.bogus']);
    expect(developDocContentIssues('delivery_confirm', { warrantyTo: '2026-13-99x' })).toEqual(['DATE:warrantyTo']);
  });

  it('행 펼침 — 빈 값은 빼고 select·checklist·table 은 라벨로, 조건부 필드는 단계가 맞을 때만', () => {
    const rows = developDocContentRows('delivery_confirm', {
      result: '  계약 범위 전부 완료 ',
      remaining: '',
      deliverables: [
        { item: '회로·PCB 설계자료', fileName: 'v1.2', check: 'checked' },
        { item: '', fileName: '', check: '' },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(['개발 완료 결과', '최종 납품물과 파일 버전']);
    expect(rows[1]?.text).toBe('1. 납품물: 회로·PCB 설계자료 · 파일·제품명과 버전: v1.2 · 확인: 확인');
    // 제작 승인 범위는 제작 단계(fabrication·smt)에서만 행으로 나온다 — 설계 단계에서는 값이 있어도 숨는다.
    const scope = developDocContentRows('stage_review', { stage: 'fabrication', approvalScope: ['pcb_fab', 'smt'] });
    expect(scope.map((r) => r.key)).toEqual(['stage', 'approvalScope']);
    expect(scope[1]?.text).toBe('PCB 제작 · SMT·수삽');
    const hidden = developDocContentRows('stage_review', { stage: 'circuit', approvalScope: ['pcb_fab'] });
    expect(hidden.map((r) => r.key)).toEqual(['stage']);
    expect(hidden[0]?.text).toBe('회로설계');
  });

  it('계약 스냅샷(kickoff) — 수락 견적을 읽기 전용 본문으로, 견적이 없으면 빈 값', () => {
    expect(developDocReadonlyKeys('kickoff')).toEqual(['contractOn', 'contractNo', 'contractAmount', 'contractDuration', 'contractScope', 'contractDeliverables']);
    expect(developDocReadonlyKeys('stage_review')).toEqual([]);
    const snap = developKickoffContractContent({
      requestId: 12,
      quoteVersion: 2,
      acceptedOn: '2026-09-01',
      vatMode: 'separate',
      supplyAmount: 6_800_000,
      vatAmount: 680_000,
      totalAmount: 7_480_000,
      durationDays: 60,
      warrantyDays: 180,
      items: [{ title: 'H/W 회로·PCB 설계' }, { title: '펌웨어' }],
      deliverables: ['거버', '소스'],
    });
    expect(snap.contractNo).toBe('DEV-12-Q2');
    expect(snap.contractAmount).toBe('합계 7,480,000원 (공급가 6,800,000원 + VAT 680,000원)');
    expect(snap.contractDuration).toBe('60일 · 하자보수 180일');
    expect(snap.contractScope).toBe('1. H/W 회로·PCB 설계\n2. 펌웨어');
    expect(snap.contractDeliverables).toBe('거버\n소스');
    expect(developDocContentIssues('kickoff', { ...emptyDevelopDocContent('kickoff'), ...snap })).toEqual([]);
    expect(developKickoffContractContent(null).contractAmount).toBe('');
  });

  it('메일 초안 — 승인형은 종류별 선택지, 공유형은 진행 안내', () => {
    const approval = buildDevelopDocMailDraft({
      type: 'stage_review',
      docNo: developDocNo('stage_review', 1),
      requestTitle: 'BLE 로거',
      customerName: '홍길동',
      customerCompany: '이투이랩',
      replyDueOn: '2026-09-20',
      content: { doneWork: '회로 확정', stage: 'circuit' },
    });
    expect(approval.subject).toBe('[샘플피씨비] BLE 로거 단계별 검토·승인 및 확인 요청');
    expect(approval.body).toContain('이투이랩 홍길동 담당자님, 안녕하세요.');
    expect(approval.body).toContain('단계별 검토·승인(REV-01)');
    expect(approval.body).toContain('• 검토 단계: 회로설계');
    expect(approval.body).toContain('- 승인합니다');
    expect(approval.body).toContain('- 조건부 승인합니다');
    expect(approval.body).toContain('회신 요청일: 2026-09-20');
    // 변경요청·납품확인은 문안이 다른 선택지 — 메일도 같은 사전을 읽는다(2026-09-11 검토 모순 1).
    const cr = buildDevelopDocMailDraft({ type: 'change_request', docNo: 'CR-01', requestTitle: 'x', customerName: 'a', customerCompany: null, replyDueOn: null, content: {} });
    expect(cr.body).toContain('- 변경 적용 승인');
    expect(cr.body).toContain('- 기존 범위 유지');
    const dc = buildDevelopDocMailDraft({ type: 'delivery_confirm', docNo: 'DC-01', requestTitle: 'x', customerName: 'a', customerCompany: null, replyDueOn: null, content: {} });
    expect(dc.body).toContain('- 납품 승인');
    expect(dc.body).toContain('- 보완 후 승인');
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

  it('상태 라벨 — 공유형 sent 는 공유됨, 결정은 종류별 문안', () => {
    expect(developDocStatusLabel('stage_review', 'sent')).toBe('고객 확인 대기');
    expect(developDocStatusLabel('kickoff', 'sent')).toBe('고객 확인 대기');
    expect(developDocStatusLabel('progress_report', 'sent')).toBe('공유됨');
    expect(developDocStatusLabel('change_request', 'rejected')).toBe('기존 범위 유지');
    expect(developDocStatusLabel('delivery_confirm', 'changes_requested')).toBe('보완 후 승인');
    expect(developDocStatusLabel('kickoff', 'superseded')).toBe('이전 버전');
  });

  it('진행 요약 — 6단계·현재 단계·가중 달성도', () => {
    expect([...DEVELOP_TASK_PHASES]).toEqual(['contract', 'design', 'fabrication', 'assembly', 'certification', 'delivery']);
    const empty = developProgressSummary([], false);
    expect(empty.progressPct).toBe(0);
    expect(empty.currentPhase).toBeNull();
    expect(empty.phases.every((p) => p.state === 'todo')).toBe(true);
    expect(developProgressSummary([], true).phases[0]?.state).toBe('done');

    // 가중치를 적은 표는 그대로 가중 평균.
    const manual = [
      { phase: 'contract' as const, status: 'done' as const, weightBp: 1000, progressPct: 100 },
      { phase: 'design' as const, status: 'in_progress' as const, weightBp: 2000, progressPct: 50 },
      { phase: 'design' as const, status: 'planned' as const, weightBp: 1000, progressPct: 0 },
    ];
    const s = developProgressSummary(manual, true);
    expect(s.progressPct).toBe(50);
    expect(s.currentPhase).toBe('design');
    expect(s.phases.map((p) => p.state)).toEqual(['done', 'now', 'todo', 'todo', 'todo', 'todo']);

    // 업무가 없는 뒤 단계는 todo 로 남는다(기존 규칙) — 전 단계를 덮는 기본 업무로 전부 완료를 본다.
    const allDone = developProgressSummary(
      DEVELOP_DEFAULT_TASKS.map((t) => ({ phase: t.phase, status: 'done' as const, weightBp: 0, progressPct: 100 })),
      true,
    );
    expect(allDone.currentPhase).toBeNull();
    expect(allDone.progressPct).toBe(100);
    expect(allDone.phases.every((p) => p.state === 'done')).toBe(true);
  });

  it('달성도 — 가중치가 없으면 기간(일수)이 무게, 날짜도 없으면 단순 평균', () => {
    // 착수회의 1일(100%) + 펌웨어 18일(0%) = 단순 평균이면 50%, 기간 가중이면 5%.
    const dated = [
      { phase: 'contract' as const, status: 'done' as const, weightBp: 0, progressPct: 100, startOn: '2026-09-01', endOn: '2026-09-01' },
      { phase: 'design' as const, status: 'planned' as const, weightBp: 0, progressPct: 0, startOn: '2026-09-02', endOn: '2026-09-19' },
    ];
    expect(developTaskWeights(dated)).toEqual([1, 18]);
    expect(developProgressSummary(dated, true).progressPct).toBe(5);
    // 날짜 없는 행은 날짜 있는 행들의 평균 기간(여기선 (1+18)/2 → 10)으로.
    const mixed = [...dated, { phase: 'assembly' as const, status: 'in_progress' as const, weightBp: 0, progressPct: 50, startOn: null, endOn: null }];
    expect(developTaskWeights(mixed)).toEqual([1, 18, 10]);
    // 아무 행에도 날짜가 없으면 단순 평균.
    expect(
      developProgressSummary(
        [
          { phase: 'design', status: 'in_progress', weightBp: 0, progressPct: 50 },
          { phase: 'design', status: 'planned', weightBp: 0, progressPct: 0 },
        ],
        true,
      ).progressPct,
    ).toBe(25);
    // 제외 행은 무게에서 빠진다.
    const withSkipped = [...dated, { phase: 'design' as const, status: 'skipped' as const, weightBp: 0, progressPct: 0, startOn: '2026-09-01', endOn: '2026-12-31' }];
    expect(developProgressSummary(withSkipped, true).progressPct).toBe(5);
  });

  it('기본 업무 11개·착수일 기준 자동배치', () => {
    expect(DEVELOP_DEFAULT_TASKS).toHaveLength(11);
    expect(DEVELOP_DEFAULT_TASKS.every((t) => t.weightBp === 0)).toBe(true);
    expect(DEVELOP_DEFAULT_TASK_PLAN[0]).toMatchObject({ name: '개발착수회의', phase: 'contract', offsetDays: 0, durationDays: 1 });
    const dates = developAutoScheduleDates(DEVELOP_DEFAULT_TASKS, '2026-10-01');
    expect(dates[0]).toEqual({ startOn: '2026-10-01', endOn: '2026-10-01' });
    expect(dates[1]).toEqual({ startOn: '2026-10-02', endOn: '2026-10-13' }); // 회로설계 offset 1 · 12일
    expect(dates[10]).toEqual({ startOn: '2026-12-08', endOn: '2026-12-09' }); // 최종 납품 offset 68 · 2일
    // 이름이 기본 업무와 다른 행은 지금까지 가장 늦은 완료일 다음 날부터 5일.
    const custom = developAutoScheduleDates([{ name: '회로설계' }, { name: '고객 지급자재 확인' }], '2026-10-01');
    expect(custom[1]).toEqual({ startOn: '2026-10-14', endOn: '2026-10-18' });
    // 기본 이름과 안 맞는 첫 행은 착수일부터.
    expect(developAutoScheduleDates([{ name: '사전 조사' }], '2026-10-01')[0]).toEqual({ startOn: '2026-10-01', endOn: '2026-10-05' });
  });
});
