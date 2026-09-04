import { describe, expect, it } from 'vitest';
import {
  auditDevDiagramHtml,
  buildDevDiagramPrompt,
  devDiagramGate,
  isDevDiagramAcceptable,
  sanitizeDevDiagramHtml,
} from './dev-diagram';
import type { DevReviewSource } from './dev-review';

// 정밀 구성도(docs/AI_DEV_REVIEW.md §13.5) — 게이트·프롬프트 조립·살균·감사의 결정적 규칙.

const base: DevReviewSource = {
  title: '2채널 AC 히터 제어기',
  serviceAreas: ['circuit', 'firmware'],
  description: '2채널 AC 히터 제어기를 만들고 싶습니다. MCU 는 STM32H743ZIT6, 온습도 SHT31, 외부 RS-485 통신.',
  answers: [{ code: 'stage', choices: ['spec'] }],
  attachmentContext: '',
  attachmentFiles: [],
};

describe('devDiagramGate', () => {
  it('아이디어 단계(짧은 설명·첨부 없음)는 생략, 첨부 텍스트가 충분하면 통과', () => {
    expect(devDiagramGate({ ...base, answers: [{ code: 'stage', choices: ['idea'] }] }).ok).toBe(false);
    expect(devDiagramGate({ ...base, attachmentContext: 'x'.repeat(900) }).ok).toBe(true);
  });
  it('설계 단계(회로도 있음)면 짧은 첨부라도 통과', () => {
    expect(devDiagramGate({ ...base, answers: [{ code: 'stage', choices: ['schematic'] }], attachmentContext: 'netlist' }).ok).toBe(true);
    expect(devDiagramGate({ ...base, answers: [{ code: 'stage', choices: ['schematic'] }] }).ok).toBe(false); // 첨부 0
  });
});

describe('buildDevDiagramPrompt', () => {
  it('하드웨어만이면 블록도 규칙, 앱·서버가 있으면 토폴로지 규칙과 SVG 두 장 지시가 붙는다', () => {
    const hw = buildDevDiagramPrompt(base);
    expect(hw).toContain('[하드웨어 블록도 배치]');
    expect(hw).not.toContain('[시스템 토폴로지');
    expect(hw).toContain('SVG 한 장의 하드웨어');
    const mixed = buildDevDiagramPrompt({ ...base, serviceAreas: ['circuit', 'app', 'server'] });
    expect(mixed).toContain('[시스템 토폴로지(앱·서버 포함)]');
    expect(mixed).toContain('SVG 두 장');
    expect(mixed).toContain('앱 개발(app)');
    expect(mixed).toContain('서버 개발 검토사항');
  });
  it('분야 검토사항이 레지스트리에서 온다', () => {
    expect(buildDevDiagramPrompt(base)).toContain('펌웨어 개발(firmware)');
  });
});

describe('sanitizeDevDiagramHtml', () => {
  it('script·foreignObject·이벤트 속성·외부 URL 을 제거하고 CSP 메타를 심는다', () => {
    const raw = [
      '```html',
      '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="https://x/a.css"></head>',
      '<body onload="alert(1)"><script>alert(2)</script>',
      '<svg viewBox="0 0 10 10"><foreignObject><div>x</div></foreignObject><a href="#legend">L</a><rect onclick="x()"/></svg>',
      '<img src="https://evil/x.png"><style>body{background:url(https://evil/b.png)}</style></body></html>',
      '```',
    ].join('\n');
    const { html, stripped } = sanitizeDevDiagramHtml(raw);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('foreignObject');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('https://x/a.css');
    expect(html).not.toContain('https://evil');
    expect(html).toContain('href="#legend"'); // 내부 앵커는 유지
    expect(html).toContain('Content-Security-Policy');
    expect(html.startsWith('<!doctype html>')).toBe(true); // 코드 펜스 제거
    expect(stripped).toBeGreaterThanOrEqual(6);
  });
});

describe('auditDevDiagramHtml', () => {
  it('SVG 수·섹션 수·자료 밖 수치·품번·빠진 핵심 품번을 기록한다', () => {
    const html = '<html><body><h2>요약</h2><svg viewBox="0 0 10 10"><text>STM32H743ZIT6 12V ESP32-C3</text></svg><h2>확정된 구성</h2></body></html>';
    const audit = auditDevDiagramHtml(html, base, 0);
    expect(audit.svgCount).toBe(1);
    expect(audit.sectionCount).toBe(2);
    expect(audit.ungroundedTokens).toContain('12V'); // 자료에 없는 전압
    expect(audit.ungroundedTokens).toContain('ESP32-C3'); // 자료에 없는 품번
    expect(audit.ungroundedTokens).not.toContain('STM32H743ZIT6');
    expect(audit.requiredMissing).toContain('SHT31'); // 자료엔 있는데 도면엔 없음
    expect(isDevDiagramAcceptable(audit)).toBe(true);
    expect(isDevDiagramAcceptable({ ...audit, svgCount: 0 })).toBe(false);
  });
});
