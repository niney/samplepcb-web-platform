import { describe, expect, it } from 'vitest';
import { DiagramSpec, normalizeDiagramSpec } from '@sp/api-contract';
import { renderDiagramSpecHtml } from '@sp/utils';

const sampleSpec = normalizeDiagramSpec(DiagramSpec.parse({
  project: {
    name: 'Smart <Control> & Monitor',
    summary: '센서 입력과 API 서버를 연결하는 통합 시스템',
    stage: 'spec',
    service_type: 'full',
  },
  groups: [
    { id: 'input', label: 'USER & SENSOR INPUT' },
    { id: 'core', label: 'APPLICATION CORE' },
    { id: 'external', label: 'EXTERNAL SYSTEM' },
  ],
  blocks: [
    { id: 'sensor', group: 'input', type: 'sensor', label: '온도 <센서>', status: 'confirmed' },
    { id: 'app', group: 'core', type: 'controller', label: 'Control "Application"', status: 'tbd' },
    { id: 'api', group: 'external', type: 'external', label: 'Partner API', status: 'option' },
  ],
  connections: [
    { from: 'sensor', to: 'app', interface: 'I2C & GPIO', flow: 'data' },
    { from: 'app', to: 'api', interface: 'HTTPS', flow: 'control' },
  ],
  constraints: ['외부 문자열 <script>alert(1)</script> 실행 금지'],
  feature_highlights: ['동일 명세는 동일한 결과'],
  questions_missing: [{ topic: '보안', question: '인증 방식은?' }],
}));

describe('DiagramSpec 결정적 SVG 렌더러', () => {
  it('같은 입력을 바이트 단위로 같은 단일 HTML/SVG로 렌더한다', () => {
    const first = renderDiagramSpecHtml(sampleSpec);
    const second = renderDiagramSpecHtml(sampleSpec);

    expect(first).toBe(second);
    expect(first).toContain('<svg');
    expect(first).toContain('DiagramSpec deterministic renderer v1');
    expect(first).toContain('Content-Security-Policy');
    expect(first).not.toMatch(/<(?:img|script|link|iframe|object|embed)\b/i);
    expect(first).not.toMatch(/(?:href|src)=["']https?:/i);
  });

  it('모든 블록·연결·상태를 보존하고 사용자 문자열을 XML 이스케이프한다', () => {
    const html = renderDiagramSpecHtml(sampleSpec);

    expect(html).toContain('Smart &lt;Control&gt; &amp; Monitor');
    expect(html).toContain('온도 &lt;센서&gt;');
    expect(html).toContain('Control &quot;Application&quot; (TBD)');
    expect(html).toContain('Partner API (Option)');
    expect(html).toContain('I2C &amp; GPIO');
    expect(html).toContain('HTTPS');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('인증 방식은?');
    expect(html.match(/class="connection connection-/g)).toHaveLength(6); // 본문 2 + Legend 4
  });

  it('계약 최대 블록·연결에서도 저장 상한 이내의 유효한 좌표를 만든다', () => {
    const groups = Array.from({ length: 12 }, (_, index) => ({
      id: `group_${String(index)}`,
      label: `GROUP ${String(index)}`,
    }));
    const blocks = Array.from({ length: 80 }, (_, index) => ({
      id: `block_${String(index)}`,
      group: `group_${String(index % groups.length)}`,
      type: index % 2 === 0 ? 'controller' as const : 'external' as const,
      label: `Block ${String(index)} with a sufficiently descriptive label`,
      status: index % 3 === 0 ? 'tbd' as const : 'confirmed' as const,
    }));
    const connections = Array.from({ length: 160 }, (_, index) => ({
      from: `block_${String(index % blocks.length)}`,
      to: `block_${String((index + 1) % blocks.length)}`,
      interface: `IF-${String(index)}`,
      flow: index % 2 === 0 ? 'data' as const : 'power' as const,
    }));
    const maxSpec = DiagramSpec.parse({
      project: { name: 'Maximum Layout', summary: '', stage: '', service_type: '' },
      groups,
      blocks,
      connections,
      constraints: [],
      feature_highlights: [],
      questions_missing: [],
    });

    const html = renderDiagramSpecHtml(maxSpec);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(512_000);
    expect(html).not.toMatch(/(?:NaN|undefined)/);
    expect(html).not.toContain('…');
    expect(html.match(/class="block"/g)).toHaveLength(80);
    expect(html.match(/class="connection connection-/g)).toHaveLength(164); // 본문 160 + Legend 4
  });
});
