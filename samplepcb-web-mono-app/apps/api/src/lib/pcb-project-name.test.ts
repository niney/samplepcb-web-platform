import { describe, expect, it } from 'vitest';
import { PCB_PROJECT_NAME_MAX, clampPcbProjectName } from '@sp/api-contract';

// 프로젝트명 절단(여정 36호) — 이름은 **고객이 올린 거버 파일명**이라 길이를 우리가 정할 수
// 없다. DB 에 맡기면 환경에 따라 조용히 잘리거나(비 strict) 500 으로 터진다(strict).
// 저장 전에 우리가 자르고, 잘린 사실이 보이게 말줄임표를 붙인다.
describe('clampPcbProjectName', () => {
  it('한계 이하는 그대로 둔다', () => {
    expect(clampPcbProjectName('arduino-uno.zip')).toBe('arduino-uno.zip');
    const exact = 'a'.repeat(PCB_PROJECT_NAME_MAX);
    expect(clampPcbProjectName(exact)).toBe(exact);
  });

  it('한계를 넘으면 자르되 **한계를 넘지 않는다**', () => {
    const out = clampPcbProjectName('a'.repeat(PCB_PROJECT_NAME_MAX + 50));
    expect(out.length).toBe(PCB_PROJECT_NAME_MAX);
  });

  // 잘렸다는 것이 보여야 한다 — 안 그러면 올린 사람은 이름이 바뀐 줄 모른다.
  it('잘린 이름은 말줄임표로 끝난다', () => {
    const out = clampPcbProjectName('b'.repeat(300));
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('bbb')).toBe(true);
  });

  it('빈 문자열은 그대로(계약이 min(1)로 따로 막는다)', () => {
    expect(clampPcbProjectName('')).toBe('');
  });

  // ⚠ 길이는 **문자 수**로 센다. 이모지는 JS 에서 2 코드유닛이라 바이트·코드포인트 기준과
  //   다르지만, 컬럼도 utf8mb4 문자 수 기준이라 이쪽이 맞다.
  it('이모지가 섞여도 한계를 넘지 않는다', () => {
    const out = clampPcbProjectName('🔧'.repeat(200));
    expect(out.length).toBeLessThanOrEqual(PCB_PROJECT_NAME_MAX);
  });
});
