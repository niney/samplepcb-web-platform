import type { DiagramSpecType } from '@sp/api-contract';

type DiagramBlock = DiagramSpecType['blocks'][number];
type DiagramBlockType = DiagramBlock['type'];
type DiagramConnection = DiagramSpecType['connections'][number];
type Column = 0 | 1 | 2;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BlockLayout {
  block: DiagramBlock;
  rect: Rect;
}

interface GroupLayout {
  id: string;
  label: string;
  rect: Rect;
  blocks: BlockLayout[];
}

const CANVAS_WIDTH = 1400;
const COLUMN_WIDTH = 400;
const COLUMN_X = [60, 500, 940] as const;
const GROUP_GAP = 28;
const GROUP_HEADER_HEIGHT = 48;
const MIN_BLOCK_HEIGHT = 58;
const BLOCK_GAP = 10;
const BLOCK_INSET = 18;

const TYPE_COLORS: Record<DiagramBlockType, string> = {
  power: '#dbeafe',
  controller: '#ede9fe',
  communication: '#dcfce7',
  sensor: '#fef9c3',
  input: '#fef9c3',
  output: '#fef9c3',
  driver: '#fee2e2',
  storage: '#e0f2fe',
  debug: '#e0f2fe',
  ui: '#fef9c3',
  external: '#ffffff',
  mechanical: '#f3e8ff',
  protection: '#ffedd5',
  other: '#f1f5f9',
};

const TYPE_LABELS: Record<DiagramBlockType, string> = {
  power: 'POWER',
  controller: 'CONTROL',
  communication: 'COMMS',
  sensor: 'SENSOR',
  input: 'INPUT',
  output: 'OUTPUT',
  driver: 'DRIVER',
  storage: 'STORAGE',
  debug: 'DEBUG',
  ui: 'UI',
  external: 'EXTERNAL',
  mechanical: 'MECHANICAL',
  protection: 'PROTECTION',
  other: 'OTHER',
};

const TYPE_COLUMNS: Record<DiagramBlockType, Column> = {
  input: 0,
  sensor: 0,
  ui: 0,
  power: 1,
  controller: 1,
  communication: 1,
  driver: 1,
  storage: 1,
  debug: 1,
  protection: 1,
  other: 1,
  output: 2,
  external: 2,
  mechanical: 2,
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(value: string, maxChars: number, preferWords = true): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized === '') return [''];

  const lines: string[] = [];
  let rest = Array.from(normalized);
  while (rest.length > maxChars) {
    const candidate = rest.slice(0, maxChars);
    const spaceIndex = candidate.lastIndexOf(' ');
    const cut = preferWords && spaceIndex >= Math.floor(maxChars * 0.55) ? spaceIndex : maxChars;
    lines.push(rest.slice(0, cut).join('').trim());
    rest = rest.slice(cut);
    while (rest[0] === ' ') rest.shift();
  }
  lines.push(rest.join('').trim());
  return lines;
}

function renderTextLines(
  lines: readonly string[],
  x: number,
  y: number,
  lineHeight: number,
  className: string,
  anchor: 'start' | 'middle' = 'start',
): string {
  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${String(x)}" dy="${index === 0 ? '0' : String(lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return `<text class="${className}" x="${String(x)}" y="${String(y)}" text-anchor="${anchor}">${spans}</text>`;
}

function blockLabel(block: DiagramBlock): string {
  const upper = block.label.toUpperCase();
  if (block.status === 'tbd' && !upper.includes('(TBD)')) return `${block.label} (TBD)`;
  if (block.status === 'option' && !upper.includes('(OPTION)')) return `${block.label} (Option)`;
  return block.label;
}

function preferredColumn(groupId: string, groupLabel: string, blocks: readonly DiagramBlock[]): Column {
  const name = `${groupId} ${groupLabel}`.toLowerCase();
  if (/external|cloud|output|actuator|mechanical|enclosure/.test(name)) return 2;
  if (/input|sensor|user|client|local.access|interface|\bui\b/.test(name)) return 0;
  if (/controller|core|application|server|api|data|power|storage|communication/.test(name)) return 1;

  const scores: [number, number, number] = [0, 0, 0];
  for (const block of blocks) scores[TYPE_COLUMNS[block.type]] += 1;
  const highest = Math.max(...scores);
  if (scores[0] === highest && scores[0] > scores[1]) return 0;
  if (scores[2] === highest && scores[2] > scores[1]) return 2;
  return 1;
}

function shortestColumn(heights: readonly number[]): Column {
  const min = Math.min(...heights);
  const index = heights.indexOf(min);
  return index === 0 || index === 2 ? index : 1;
}

function layoutGroups(spec: DiagramSpecType, startY: number): { groups: GroupLayout[]; bottom: number } {
  const columnHeights: [number, number, number] = [startY, startY, startY];
  const groups: GroupLayout[] = [];

  for (const group of spec.groups) {
    const blocks = spec.blocks.filter((block) => block.group === group.id);
    const blockHeights = blocks.map((block) =>
      Math.max(MIN_BLOCK_HEIGHT, 30 + wrapText(blockLabel(block), 40).length * 17),
    );
    const emptyHeight = MIN_BLOCK_HEIGHT;
    const contentHeight = blockHeights.length > 0
      ? blockHeights.reduce((sum, blockHeight) => sum + blockHeight, 0) +
        (blockHeights.length - 1) * BLOCK_GAP
      : emptyHeight;
    const height = GROUP_HEADER_HEIGHT + BLOCK_INSET + contentHeight;
    const preferred = preferredColumn(group.id, group.label, blocks);
    const shortest = shortestColumn(columnHeights);
    const column = columnHeights[preferred] > columnHeights[shortest] + Math.max(220, height * 0.45)
      ? shortest
      : preferred;
    const x = COLUMN_X[column];
    const y = columnHeights[column];
    let blockY = y + GROUP_HEADER_HEIGHT;
    const blockLayouts = blocks.map((block, index): BlockLayout => {
      const blockHeight = blockHeights[index] ?? MIN_BLOCK_HEIGHT;
      const result = {
        block,
        rect: {
          x: x + BLOCK_INSET,
          y: blockY,
          width: COLUMN_WIDTH - BLOCK_INSET * 2,
          height: blockHeight,
        },
      };
      blockY += blockHeight + BLOCK_GAP;
      return result;
    });
    groups.push({ id: group.id, label: group.label, rect: { x, y, width: COLUMN_WIDTH, height }, blocks: blockLayouts });
    columnHeights[column] = y + height + GROUP_GAP;
  }

  return { groups, bottom: Math.max(...columnHeights) };
}

function connectionPath(
  from: Rect,
  to: Rect,
  index: number,
  sameGroup: boolean,
): { d: string; labelX: number; labelY: number } {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;
  const horizontal = Math.abs(toCenterX - fromCenterX) >= Math.abs(toCenterY - fromCenterY);
  const laneOffset = ((index % 7) - 3) * 5;

  // 같은 열의 다른 그룹은 가운데 블록을 관통하지 않고 열 바깥 거터로 우회한다.
  if (!horizontal && !sameGroup && Math.abs(toCenterX - fromCenterX) < 2) {
    const routeRight = fromCenterX < CANVAS_WIDTH / 2;
    const startX = routeRight ? from.x + from.width : from.x;
    const endX = routeRight ? to.x + to.width : to.x;
    const laneX = startX + (routeRight ? 22 + laneOffset : -22 + laneOffset);
    return {
      d: `M ${String(startX)} ${String(fromCenterY)} H ${String(laneX)} V ${String(toCenterY)} H ${String(endX)}`,
      labelX: laneX + (routeRight ? 6 : -6),
      labelY: Math.round((fromCenterY + toCenterY) / 2) - 6,
    };
  }

  if (horizontal) {
    const forward = toCenterX >= fromCenterX;
    const startX = forward ? from.x + from.width : from.x;
    const endX = forward ? to.x : to.x + to.width;
    const middleX = Math.round((startX + endX) / 2 + laneOffset);
    return {
      d: `M ${String(startX)} ${String(fromCenterY)} H ${String(middleX)} V ${String(toCenterY)} H ${String(endX)}`,
      labelX: middleX + 6,
      labelY: Math.round((fromCenterY + toCenterY) / 2) - 6,
    };
  }

  const downward = toCenterY >= fromCenterY;
  const startY = downward ? from.y + from.height : from.y;
  const endY = downward ? to.y : to.y + to.height;
  const middleY = Math.round((startY + endY) / 2 + laneOffset);
  return {
    d: `M ${String(fromCenterX)} ${String(startY)} V ${String(middleY)} H ${String(toCenterX)} V ${String(endY)}`,
    labelX: Math.round((fromCenterX + toCenterX) / 2) + 6,
    labelY: middleY - 7,
  };
}

function renderGroupBackground(group: GroupLayout): string {
  const { x, y, width, height } = group.rect;
  const label = wrapText(group.label.toUpperCase(), 40, false);
  return [
    `<rect class="group-box" x="${String(x)}" y="${String(y)}" width="${String(width)}" height="${String(height)}" rx="14"/>`,
    `<rect class="group-head" x="${String(x)}" y="${String(y)}" width="${String(width)}" height="${String(GROUP_HEADER_HEIGHT)}" rx="14"/>`,
    `<path class="group-head-fill" d="M ${String(x)} ${String(y + 28)} H ${String(x + width)} V ${String(y + GROUP_HEADER_HEIGHT)} H ${String(x)} Z"/>`,
    renderTextLines(label, x + 18, y + 23, 16, 'group-label'),
  ].join('');
}

function renderBlock(layout: BlockLayout): string {
  const { block, rect } = layout;
  const label = wrapText(blockLabel(block), 40);
  const labelY = label.length === 1 ? rect.y + 35 : rect.y + 27;
  const statusClass = block.status === 'confirmed' ? 'status-confirmed' : block.status === 'tbd' ? 'status-tbd' : 'status-option';
  return [
    `<rect class="block" x="${String(rect.x)}" y="${String(rect.y)}" width="${String(rect.width)}" height="${String(rect.height)}" rx="10" fill="${TYPE_COLORS[block.type]}"/>`,
    renderTextLines(label, rect.x + 15, labelY, 17, 'block-label'),
    `<text class="block-type ${statusClass}" x="${String(rect.x + rect.width - 12)}" y="${String(rect.y + 17)}" text-anchor="end">${TYPE_LABELS[block.type]}</text>`,
  ].join('');
}

function renderConnection(
  connection: DiagramConnection,
  index: number,
  blockRects: ReadonlyMap<string, Rect>,
  blockGroups: ReadonlyMap<string, string>,
): string {
  const from = blockRects.get(connection.from);
  const to = blockRects.get(connection.to);
  if (from === undefined || to === undefined) return '';
  const path = connectionPath(
    from,
    to,
    index,
    blockGroups.get(connection.from) === blockGroups.get(connection.to),
  );
  const marker = connection.flow === 'power' ? 'arrow-power' : `arrow-${connection.flow}`;
  const flowClass = `connection-${connection.flow}`;
  const label = wrapText(connection.interface, 22);
  return [
    `<path class="connection ${flowClass}" d="${path.d}" marker-end="url(#${marker})"/>`,
    connection.interface === ''
      ? ''
      : renderTextLines(label, path.labelX, path.labelY, 12, 'connection-label'),
  ].join('');
}

interface PanelLayout {
  title: string;
  items: string[][];
  x: number;
  y: number;
  width: number;
  height: number;
}

function panelLayout(title: string, values: readonly string[], x: number, y: number): PanelLayout {
  const source = values.length > 0 ? values : ['등록된 항목 없음'];
  const items = source.map((value) => wrapText(value, 54));
  const contentHeight = items.reduce((sum, lines) => sum + Math.max(24, lines.length * 18 + 8), 0);
  return { title, items, x, y, width: 630, height: 58 + contentHeight };
}

function renderPanel(panel: PanelLayout): string {
  const parts = [
    `<rect class="panel" x="${String(panel.x)}" y="${String(panel.y)}" width="${String(panel.width)}" height="${String(panel.height)}" rx="14"/>`,
    `<text class="panel-title" x="${String(panel.x + 20)}" y="${String(panel.y + 32)}">${escapeXml(panel.title)}</text>`,
  ];
  let cursorY = panel.y + 62;
  for (const lines of panel.items) {
    parts.push(`<circle cx="${String(panel.x + 23)}" cy="${String(cursorY - 5)}" r="3.5" fill="#2563eb"/>`);
    parts.push(renderTextLines(lines, panel.x + 36, cursorY, 18, 'panel-item'));
    cursorY += Math.max(24, lines.length * 18 + 8);
  }
  return parts.join('');
}

/**
 * 검증·정규화된 DiagramSpec을 외부 리소스나 스크립트가 없는 단일 HTML/SVG로 렌더한다.
 * 같은 입력은 바이트 단위로 같은 결과를 내며, 모든 사용자 문자열은 XML 이스케이프한다.
 */
export function renderDiagramSpecHtml(spec: DiagramSpecType): string {
  const titleLines = wrapText(spec.project.name.toUpperCase(), 58);
  const summaryLines = wrapText(spec.project.summary, 100);
  const summaryY = 48 + (titleLines.length - 1) * 34 + 30;
  const metaY = summaryY + (summaryLines.length - 1) * 19 + 35;
  const layout = layoutGroups(spec, metaY + 22);
  const blockRects = new Map<string, Rect>();
  const blockGroups = new Map<string, string>();
  for (const group of layout.groups) {
    for (const block of group.blocks) {
      blockRects.set(block.block.id, block.rect);
      blockGroups.set(block.block.id, group.id);
    }
  }

  const panelsY = layout.bottom + 12;
  const constraints = panelLayout('PROJECT CONSTRAINTS', spec.constraints, 60, panelsY);
  const highlights = panelLayout('FEATURE HIGHLIGHTS', spec.feature_highlights, 710, panelsY);
  const panelsHeight = Math.max(constraints.height, highlights.height);
  const legendY = panelsY + panelsHeight + 24;
  const canvasHeight = legendY + 126;
  const groupBackgrounds = layout.groups.map(renderGroupBackground).join('');
  const connections = spec.connections
    .map((connection, index) => renderConnection(connection, index, blockRects, blockGroups))
    .join('');
  const blocks = layout.groups.flatMap((group) => group.blocks).map(renderBlock).join('');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeXml(spec.project.name)} 시스템 구성도</title>
  <style>
    html,body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,"Noto Sans KR",sans-serif}svg{display:block;background:#f8fafc}.title{font-size:30px;font-weight:800;fill:#0f172a;letter-spacing:.6px}.summary{font-size:14px;fill:#475569}.meta{font-size:11px;font-weight:700;fill:#64748b;letter-spacing:.8px}.group-box{fill:#fff;stroke:#94a3b8;stroke-width:1.5;stroke-dasharray:7 5}.group-head,.group-head-fill{fill:#eff6ff}.group-label{font-size:13px;font-weight:800;fill:#1d4ed8;letter-spacing:.7px}.block{stroke:#64748b;stroke-width:1.2}.block-label{font-size:14px;font-weight:700;fill:#0f172a}.block-type{font-size:8.5px;font-weight:800;letter-spacing:.5px}.status-confirmed{fill:#15803d}.status-tbd{fill:#b45309}.status-option{fill:#7e22ce}.connection{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.connection-power{stroke:#dc2626}.connection-data{stroke:#111827}.connection-control{stroke:#2563eb}.connection-feedback{stroke:#7c3aed;stroke-dasharray:7 4}.connection-label{font-size:10px;font-weight:700;fill:#334155;paint-order:stroke;stroke:#f8fafc;stroke-width:5px;stroke-linejoin:round}.panel{fill:#fff;stroke:#cbd5e1;stroke-width:1.2}.panel-title{font-size:14px;font-weight:800;fill:#1e3a8a;letter-spacing:.5px}.panel-item{font-size:12px;fill:#334155}.legend-title{font-size:12px;font-weight:800;fill:#334155}.legend-text{font-size:11px;fill:#475569}.footer{font-size:10px;fill:#94a3b8}
  </style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(CANVAS_WIDTH)}" height="${String(canvasHeight)}" viewBox="0 0 ${String(CANVAS_WIDTH)} ${String(canvasHeight)}" role="img" aria-labelledby="diagram-title diagram-desc">
  <title id="diagram-title">${escapeXml(spec.project.name)} 시스템 구성도</title>
  <desc id="diagram-desc">${escapeXml(spec.project.summary)}</desc>
  <defs>
    <marker id="arrow-power" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#dc2626"/></marker>
    <marker id="arrow-data" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#111827"/></marker>
    <marker id="arrow-control" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#2563eb"/></marker>
    <marker id="arrow-feedback" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#7c3aed"/></marker>
  </defs>
  ${renderTextLines(titleLines, CANVAS_WIDTH / 2, 48, 34, 'title', 'middle')}
  ${renderTextLines(summaryLines, CANVAS_WIDTH / 2, summaryY, 19, 'summary', 'middle')}
  <text class="meta" x="${String(CANVAS_WIDTH / 2)}" y="${String(metaY)}" text-anchor="middle">STAGE ${escapeXml(spec.project.stage || 'N/A')} · SERVICE ${escapeXml(spec.project.service_type || 'N/A')}</text>
  ${groupBackgrounds}
  ${connections}
  ${blocks}
  ${renderPanel(constraints)}
  ${renderPanel(highlights)}
  <rect class="panel" x="60" y="${String(legendY)}" width="1280" height="82" rx="14"/>
  <text class="legend-title" x="82" y="${String(legendY + 27)}">LEGEND</text>
  <rect x="158" y="${String(legendY + 14)}" width="34" height="18" rx="5" fill="#dbeafe" stroke="#64748b"/><text class="legend-text" x="201" y="${String(legendY + 28)}">전원</text>
  <rect x="260" y="${String(legendY + 14)}" width="34" height="18" rx="5" fill="#ede9fe" stroke="#64748b"/><text class="legend-text" x="303" y="${String(legendY + 28)}">제어</text>
  <rect x="362" y="${String(legendY + 14)}" width="34" height="18" rx="5" fill="#dcfce7" stroke="#64748b"/><text class="legend-text" x="405" y="${String(legendY + 28)}">통신</text>
  <rect x="464" y="${String(legendY + 14)}" width="34" height="18" rx="5" fill="#fef9c3" stroke="#64748b"/><text class="legend-text" x="507" y="${String(legendY + 28)}">입출력</text>
  <path d="M 650 ${String(legendY + 23)} H 704" class="connection connection-power" marker-end="url(#arrow-power)"/><text class="legend-text" x="718" y="${String(legendY + 28)}">전원 흐름</text>
  <path d="M 820 ${String(legendY + 23)} H 874" class="connection connection-data" marker-end="url(#arrow-data)"/><text class="legend-text" x="888" y="${String(legendY + 28)}">데이터</text>
  <path d="M 978 ${String(legendY + 23)} H 1032" class="connection connection-control" marker-end="url(#arrow-control)"/><text class="legend-text" x="1046" y="${String(legendY + 28)}">제어</text>
  <path d="M 1126 ${String(legendY + 23)} H 1180" class="connection connection-feedback" marker-end="url(#arrow-feedback)"/><text class="legend-text" x="1194" y="${String(legendY + 28)}">피드백</text>
  <text class="legend-text" x="82" y="${String(legendY + 59)}">상태: CONFIRMED=확정 · TBD=미확정 · OPTION=선택사항</text>
  <text class="footer" x="1338" y="${String(canvasHeight - 16)}" text-anchor="end">DiagramSpec deterministic renderer v1</text>
</svg>
</body>
</html>`;
}
