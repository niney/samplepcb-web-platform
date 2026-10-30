import { describe, expect, it } from 'vitest';
import {
  AiSettingsUpdate,
  DEVELOP_AREA_CUSTOM_PREFIX,
  DEVELOP_AREA_FOLLOWUP_LOCKED,
  DEVELOP_APP_SERVER_SCOPE_CODE,
  DEVELOP_REVERSE_RIGHTS_CODE,
  DevelopAiQuestions,
  developQuestion,
  developAreaCoveredKept,
  developAreaStateToAnswer,
  mergeDevelopAreaFollowup,
  refreshDevelopAreaAiMeta,
} from '@sp/api-contract';
import type { DevelopAreaFollowupResultType } from '@sp/api-contract';

// 개별 메뉴 AI 맞춤 질문(§7.2.4) — 위저드 상태 → 코드 답, 저장분(새 질문 + 메타), 'AI 가 채움 그대로' 판정.

const RESULT: DevelopAreaFollowupResultType = {
  version: 1,
  understood: '스마트 화분 컨트롤러',
  covered: [
    { area: 'circuit', base: 'circuit.type', choices: ['new'], note: '', evidence: "설명: '새로'" },
    { area: 'circuit', base: 'circuit.power', choices: ['battery_rechargeable', 'usb'], note: '18650', evidence: "설명: '18650'" },
  ],
  asked: [{ area: 'circuit', base: 'hw.comm', question: 'BLE 말고 더 필요한 통신이 있나요?', why: '', options: [] }],
  added: [{ id: 'q9', area: 'circuit', question: '크기 제한이 있나요?', why: '', options: [{ code: 'o1', label: '있음' }, { code: 'o2', label: '없음' }, { code: 'unknown', label: '잘 모르겠음' }] }],
  meta: { jobId: 'job-1', model: 'kimi-k3', promptVersion: 'v5', generatedAt: '2026-10-30T00:00:00.000Z', areas: ['circuit'], attachmentFiles: [] },
};

describe('developAreaStateToAnswer', () => {
  it("새 선택지는 'other' 로 모으고 라벨을 메모 앞에 붙인다", () => {
    const a = developAreaStateToAnswer({ choices: ['ble', `${DEVELOP_AREA_CUSTOM_PREFIX}전용 무선`], note: '433MHz' }, true);
    expect(a).toEqual({ choices: ['ble', 'other'], note: '전용 무선 / 433MHz' });
  });

  it("이미 'other' 를 골랐으면 한 번만, 새 선택지가 없으면 그대로", () => {
    expect(developAreaStateToAnswer({ choices: ['other', `${DEVELOP_AREA_CUSTOM_PREFIX}가`], note: '' }, true).choices).toEqual(['other']);
    expect(developAreaStateToAnswer({ choices: ['ble'], note: ' 메모 ' }, true)).toEqual({ choices: ['ble'], note: '메모' });
  });

  it("'기타'가 없는 질문이면 라벨만 메모로 남긴다", () => {
    expect(developAreaStateToAnswer({ choices: ['new', `${DEVELOP_AREA_CUSTOM_PREFIX}복각`], note: '' }, false)).toEqual({ choices: ['new'], note: '복각' });
  });
});

describe('AI 에 맡기지 않는 질문·추론 단계', () => {
  it('고정 질문 목록은 레지스트리의 범위·권리 확인·조건부 질문의 근거와 같다', () => {
    expect(DEVELOP_AREA_FOLLOWUP_LOCKED).toEqual([DEVELOP_APP_SERVER_SCOPE_CODE, DEVELOP_REVERSE_RIGHTS_CODE, 'reverse.work']);
    expect(developQuestion('reverse.firmware')?.showWhen?.code).toBe('reverse.work');
  });

  it('맞춤 질문 설정은 낮음·끔을 저장하지 못한다', () => {
    const body = (think: string) => ({ developAreaFollowup: { enabled: true, model: 'kimi-k3', think, extraInstructions: '' } });
    expect(AiSettingsUpdate.safeParse(body('low')).success).toBe(false);
    expect(AiSettingsUpdate.safeParse(body('off')).success).toBe(false);
    expect(AiSettingsUpdate.safeParse(body('medium')).success).toBe(true);
    expect(AiSettingsUpdate.safeParse(body('max')).success).toBe(true);
    // 다른 유스케이스는 그대로 낮음을 받는다
    expect(AiSettingsUpdate.safeParse({ developFollowup: { enabled: true, model: 'kimi-k3', think: 'low', extraInstructions: '' } }).success).toBe(true);
  });
});

describe('developAreaCoveredKept', () => {
  it('선택지 집합과 메모가 같으면 그대로다(순서는 안 본다)', () => {
    const covered = RESULT.covered[1];
    if (covered === undefined) throw new Error('fixture');
    expect(developAreaCoveredKept(covered, [{ code: 'circuit.power', choices: ['usb', 'battery_rechargeable'], note: '18650' }])).toBe(true);
    expect(developAreaCoveredKept(covered, [{ code: 'circuit.power', choices: ['usb'], note: '18650' }])).toBe(false);
    expect(developAreaCoveredKept(covered, [{ code: 'circuit.power', choices: ['usb', 'battery_rechargeable'], note: '다른 값' }])).toBe(false);
    expect(developAreaCoveredKept(covered, [])).toBe(false);
  });
});

describe('mergeDevelopAreaFollowup', () => {
  it('새 질문은 시스템개발 AI 질문과 같은 저장분으로, 채운 답·고쳐 물은 문장은 메타로', () => {
    const stored = mergeDevelopAreaFollowup(RESULT, [{ id: 'q9', choice: 'o1', text: '60x40mm' }, { id: 'zz', choice: 'o1', text: '' }], [
      { code: 'circuit.type', choices: ['new'] },
      { code: 'circuit.power', choices: ['usb'], note: '18650' },
    ]);
    expect(DevelopAiQuestions.safeParse(stored).success).toBe(true);
    expect(stored.jobId).toBe('job-1');
    expect(stored.questions).toEqual([{ ...RESULT.added[0], answer: { choice: 'o1', text: '60x40mm' } }]);
    expect(stored.area?.covered.map((c) => [c.base, c.kept])).toEqual([
      ['circuit.type', true],
      ['circuit.power', false],
    ]);
    expect(stored.area?.asked).toEqual([{ code: 'hw.comm', question: 'BLE 말고 더 필요한 통신이 있나요?' }]);
  });

  it('수정으로 답이 바뀌면 kept 를 다시 계산한다', () => {
    const stored = mergeDevelopAreaFollowup(RESULT, [], [{ code: 'circuit.type', choices: ['new'] }]);
    if (stored.area === undefined) throw new Error('meta');
    const next = refreshDevelopAreaAiMeta(stored.area, [{ code: 'circuit.type', choices: ['modify'] }]);
    expect(next.covered[0]?.kept).toBe(false);
  });
});
