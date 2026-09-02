import { describe, expect, it } from 'vitest';
import { DevReviewDiagram } from '@sp/api-contract';
import type { DevReviewDiagramType, MarketDevReviewType } from '@sp/api-contract';
import { DEV_REVIEW_DIAGRAM_WIDTH, renderDevReviewDiagramHtml } from './dev-review-diagram';
import { buildDevReviewView } from './dev-review-view';

// 제안 시스템 구성도 렌더러(docs/AI_DEV_REVIEW.md §12.4) — 결정적·이스케이프·크기 규약.

const diagram: DevReviewDiagramType = DevReviewDiagram.parse({
  columns: { inputs: '현장 입력', board: '제어 보드', outputs: '연동' },
  inputs: [
    { label: '온도 센서 <script>', detail: '온도 & 습도', icon: 'sensor' },
    { label: '아주 긴 라벨 이름을 가진 입력 카드 테스트', detail: '', icon: 'signal' },
  ],
  board: { label: '메인 컨트롤러', detail: '제어·통신', chips: ['전원 변환', '데이터 처리', '무선 통신 모듈 인터페이스'] },
  outputs: [{ label: '스마트폰 앱', detail: '설정·기록', icon: 'phone' }],
  linkIn: 'I2C',
  linkOut: 'BLE',
  notes: { flow: '', design: '', extension: '' },
});

describe('renderDevReviewDiagramHtml', () => {
  it('같은 입력은 같은 SVG 를 내고, 뷰어가 읽는 width/height 속성을 가진다', () => {
    const a = renderDevReviewDiagramHtml(diagram);
    const b = renderDevReviewDiagramHtml(diagram);
    expect(a).toBe(b);
    const m = /<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(a);
    expect(Number(m?.[1])).toBe(DEV_REVIEW_DIAGRAM_WIDTH);
    expect(Number(m?.[2])).toBeGreaterThan(200);
  });

  it('사용자 문자열을 XML 이스케이프하고 스크립트·외부 리소스가 없다', () => {
    const html = renderDevReviewDiagramHtml(diagram);
    expect(html).toContain('온도 센서 &lt;script&gt;');
    expect(html).toContain('온도 &amp; 습도');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\ssrc=|href=|url\((?!#)/); // url(#arrow) 마커 참조는 내부
    expect(html).toContain("default-src 'none'");
  });

  it('열 이름·연결 라벨·칩을 그리고, 긴 라벨은 두 줄로 접는다', () => {
    const html = renderDevReviewDiagramHtml(diagram);
    expect(html).toContain('현장 입력');
    expect(html).toContain('>I2C<');
    expect(html).toContain('>BLE<');
    expect(html).toContain('무선 통신 모듈 인터페이스');
    expect(html).toContain('아주 긴 라벨 이름을');
  });

  it('고객이 미정이라고 말한 카드는 점선 테두리와 "미정" 표식을 얻는다', () => {
    const html = renderDevReviewDiagramHtml({
      ...diagram,
      inputs: [{ label: '온습도 센서', detail: '종류는 제안 받고 싶음', icon: 'sensor', tbd: true }],
      board: { ...diagram.board, tbd: true },
    });
    expect(html.match(/class="card card-tbd"/g)).toHaveLength(1);
    expect(html).toContain('class="board-card board-card-tbd"');
    expect(html.match(/>미정</g)).toHaveLength(2);
    expect(renderDevReviewDiagramHtml(diagram)).not.toContain('미정');
  });

  it('빈 열은 "해당 없음" 카드 하나로 채운다', () => {
    const html = renderDevReviewDiagramHtml({ ...diagram, inputs: [], outputs: [] });
    expect(html.match(/해당 없음/g)).toHaveLength(2);
  });
});

describe('buildDevReviewView', () => {
  const review: MarketDevReviewType = {
    version: 2,
    brief: {
      serviceAreas: ['firmware', 'circuit'],
      answers: [
        { code: 'stage', choices: ['idea'] },
        { code: 'quantity', choices: ['unknown'] },
      ],
    },
    summary: '요약',
    requirements: [{ text: '요구 1', evidence: '근거' }],
    diagram,
    areas: [
      { area: 'circuit', summary: '회로', spec: [{ item: '전원부', text: '12V', evidence: '12V' }] },
      { area: 'firmware', summary: '', spec: [] },
    ],
    openQuestions: [{ question: '전원은?', why: '' }],
    meta: { jobId: 'j', model: 'm', promptVersion: 'dev-review.v2', inputHash: 'h', generatedAt: '2026-09-02T00:00:00.000Z', attachmentFiles: [] },
  };

  it('분야 순서를 사전 순으로 정렬하고 작업 항목·단계를 분야로 필터한다', () => {
    const view = buildDevReviewView(review);
    expect(view.areaBadge).toBe('회로 + 펌웨어');
    expect(view.workItems.map((w) => w.label)).toEqual(['회로 설계', '펌웨어 개발']);
    expect(view.phases.map((p) => p.key)).toEqual(['requirements', 'circuit', 'firmware', 'verification']);
    expect(view.briefRows.map((r) => [r.label, r.unknown])).toEqual([['현재 상태', false], ['수량', true]]);
    expect(view.factCount).toBe(2);
  });
});
