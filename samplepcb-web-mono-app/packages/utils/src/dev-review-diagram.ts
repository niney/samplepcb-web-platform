import type { DevReviewDiagramIconType, DevReviewDiagramNodeType, DevReviewDiagramType } from '@sp/api-contract';

// ── 제안 시스템 구성도 결정적 SVG 렌더러 (docs/AI_DEV_REVIEW.md §12.3) ──────────
// 입력 → 메인 보드 → 출력·연동 3열 카드 고정 레이아웃. 프로토타입(samplepcb-development-review
// 목업)의 카드 언어를 옮겼다: 양옆은 밝은 패널에 아이콘 카드, 가운데는 다크 보드 카드 +
// 기능 칩 격자, 열 사이는 연결 라벨이 붙은 화살표. 같은 입력은 바이트 단위로 같은 SVG 를
// 내고 모든 사용자 문자열은 XML 이스케이프한다. 외부 리소스·스크립트 없음(CSP meta 내장).
// 뷰어(apps/market·apps/web DiagramViewer)는 `<svg width height>` 를 읽어 축소한다.

export const DEV_REVIEW_DIAGRAM_WIDTH = 1200;

const PAD = 28;
const SIDE_W = 300;
const GAP = 80;
const CENTER_W = DEV_REVIEW_DIAGRAM_WIDTH - PAD * 2 - SIDE_W * 2 - GAP * 2; // 384
const LEFT_X = PAD;
const CENTER_X = PAD + SIDE_W + GAP;
const RIGHT_X = CENTER_X + CENTER_W + GAP;

const PANEL_PAD = 16;
const PANEL_HEAD = 38;
const CARD_GAP = 10;
const CARD_H1 = 64; // 라벨 1줄
const CARD_H2 = 80; // 라벨 2줄
const BOARD_CARD_H = 76;
const CHIP_H = 36;
const CHIP_GAP = 8;

const LABEL_WRAP = 14; // 카드 라벨 줄 바꿈 글자 수(14px bold, 카드 폭 ~220px)
const DETAIL_MAX = 22; // 보충 한 줄 최대 글자(11px)
const CHIP_HALF_MAX = 11; // 이 길이까지는 반 폭 칩, 넘으면 전체 폭
const CHIP_MAX = 16;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const chars = (value: string): string[] => Array.from(value.replace(/\s+/g, ' ').trim());

// 최대 두 줄 — 넘치면 둘째 줄 끝을 말줄임한다(카드 높이가 정해져 있어야 결정적이다).
function wrapLabel(value: string, max: number): string[] {
  const all = chars(value);
  if (all.length <= max) return [all.join('')];
  const first = all.slice(0, max);
  const space = first.lastIndexOf(' ');
  const cut = space >= Math.floor(max * 0.5) ? space : max;
  const line1 = all.slice(0, cut).join('').trim();
  let rest = all.slice(cut);
  while (rest[0] === ' ') rest = rest.slice(1);
  const line2 = rest.length > max ? `${rest.slice(0, max - 1).join('').trim()}…` : rest.join('').trim();
  return line2 === '' ? [line1] : [line1, line2];
}

function clip(value: string, max: number): string {
  const all = chars(value);
  return all.length <= max ? all.join('') : `${all.slice(0, max - 1).join('').trim()}…`;
}

// 24×24 선 아이콘 — stroke 기반, currentColor.
const ICON_PATHS: Record<DevReviewDiagramIconType, string> = {
  sensor: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/>',
  signal: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  power: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  button: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/>',
  display: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  motor: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2"/>',
  relay: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="2.5"/>',
  wireless: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z"/>',
  pc: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
  device: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 2v5M15 2v5M9 17v5M15 17v5M2 9h5M2 15h5M17 9h5M17 15h5"/>',
  storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12a8 3 0 0 0 16 0V6M4 12a8 3 0 0 0 16 0"/>',
  other: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>',
};

function renderIcon(icon: DevReviewDiagramIconType, x: number, y: number, size: number, className: string): string {
  const scale = (size / 24).toFixed(3);
  return `<g class="${className}" transform="translate(${String(x)} ${String(y)}) scale(${scale})">${ICON_PATHS[icon]}</g>`;
}

interface NodeCardLayout {
  node: DevReviewDiagramNodeType;
  labelLines: string[];
  height: number;
}

const layoutNode = (node: DevReviewDiagramNodeType): NodeCardLayout => {
  const labelLines = wrapLabel(node.label, LABEL_WRAP);
  return { node, labelLines, height: labelLines.length > 1 ? CARD_H2 : CARD_H1 };
};

const sideContentHeight = (cards: readonly NodeCardLayout[]): number =>
  cards.length === 0
    ? CARD_H1
    : cards.reduce((sum, c) => sum + c.height, 0) + (cards.length - 1) * CARD_GAP;

interface ChipLayout {
  text: string;
  full: boolean;
}

// 칩 격자 — 짧은 칩은 2열, 긴 칩은 전체 폭. 홀수로 남는 반 폭 칩은 그 줄에 혼자 놓인다.
function layoutChips(chips: readonly string[]): { rows: ChipLayout[][]; height: number } {
  const rows: ChipLayout[][] = [];
  let pending: ChipLayout | null = null;
  for (const raw of chips) {
    const text = clip(raw, CHIP_MAX);
    const full = chars(text).length > CHIP_HALF_MAX;
    if (full) {
      if (pending !== null) {
        rows.push([pending]);
        pending = null;
      }
      rows.push([{ text, full: true }]);
      continue;
    }
    if (pending === null) {
      pending = { text, full: false };
    } else {
      rows.push([pending, { text, full: false }]);
      pending = null;
    }
  }
  if (pending !== null) rows.push([pending]);
  const height = rows.length === 0 ? 0 : rows.length * CHIP_H + (rows.length - 1) * CHIP_GAP;
  return { rows, height };
}

function renderSidePanel(
  x: number,
  y: number,
  height: number,
  title: string,
  cards: readonly NodeCardLayout[],
  emptyText: string,
): string {
  const parts = [
    `<rect class="panel" x="${String(x)}" y="${String(y)}" width="${String(SIDE_W)}" height="${String(height)}" rx="16"/>`,
    `<text class="panel-title" x="${String(x + PANEL_PAD)}" y="${String(y + 25)}">${escapeXml(title)}</text>`,
  ];
  let cy = y + PANEL_HEAD + PANEL_PAD;
  const cardX = x + PANEL_PAD;
  const cardW = SIDE_W - PANEL_PAD * 2;
  if (cards.length === 0) {
    parts.push(
      `<rect class="card card-empty" x="${String(cardX)}" y="${String(cy)}" width="${String(cardW)}" height="${String(CARD_H1)}" rx="12"/>`,
      `<text class="card-empty-text" x="${String(cardX + cardW / 2)}" y="${String(cy + CARD_H1 / 2 + 4)}" text-anchor="middle">${escapeXml(emptyText)}</text>`,
    );
    return parts.join('');
  }
  for (const card of cards) {
    const iconCx = cardX + 14;
    const iconCy = cy + card.height / 2 - 18;
    const textX = cardX + 62;
    const firstY = card.labelLines.length > 1 ? cy + 26 : cy + (card.node.detail === '' ? 37 : 30);
    parts.push(
      `<rect class="card${card.node.tbd ? ' card-tbd' : ''}" x="${String(cardX)}" y="${String(cy)}" width="${String(cardW)}" height="${String(card.height)}" rx="12"/>`,
      `<rect class="icon-bg" x="${String(iconCx)}" y="${String(iconCy)}" width="36" height="36" rx="10"/>`,
      renderIcon(card.node.icon, iconCx + 8, iconCy + 8, 20, 'icon'),
    );
    if (card.node.tbd) parts.push(renderTbdPill(cardX + cardW - 44, cy + 8));
    card.labelLines.forEach((line, i) => {
      parts.push(
        `<text class="card-label" x="${String(textX)}" y="${String(firstY + i * 18)}">${escapeXml(line)}</text>`,
      );
    });
    if (card.node.detail !== '') {
      const detailY = firstY + (card.labelLines.length - 1) * 18 + 17;
      parts.push(
        `<text class="card-detail" x="${String(textX)}" y="${String(detailY)}">${escapeXml(clip(card.node.detail, DETAIL_MAX))}</text>`,
      );
    }
    cy += card.height + CARD_GAP;
  }
  return parts.join('');
}

function renderBoardPanel(
  y: number,
  height: number,
  diagram: DevReviewDiagramType,
  chips: { rows: ChipLayout[][]; height: number },
): string {
  const x = CENTER_X;
  const innerX = x + PANEL_PAD;
  const innerW = CENTER_W - PANEL_PAD * 2;
  const parts = [
    `<rect class="board" x="${String(x)}" y="${String(y)}" width="${String(CENTER_W)}" height="${String(height)}" rx="16"/>`,
    `<text class="board-title" x="${String(innerX)}" y="${String(y + 25)}">${escapeXml(diagram.columns.board)}</text>`,
  ];
  const cardY = y + PANEL_HEAD + PANEL_PAD;
  const labelLines = wrapLabel(diagram.board.label, 16);
  const hasDetail = diagram.board.detail !== '';
  const firstY = labelLines.length > 1 ? cardY + 30 : hasDetail ? cardY + 34 : cardY + 43;
  parts.push(
    `<rect class="board-card${diagram.board.tbd ? ' board-card-tbd' : ''}" x="${String(innerX)}" y="${String(cardY)}" width="${String(innerW)}" height="${String(BOARD_CARD_H)}" rx="12"/>`,
    `<rect class="board-icon-bg" x="${String(innerX + 16)}" y="${String(cardY + 18)}" width="40" height="40" rx="10"/>`,
    renderIcon('chip', innerX + 24, cardY + 26, 24, 'board-icon'),
  );
  if (diagram.board.tbd) parts.push(renderTbdPill(innerX + innerW - 44, cardY + 8));
  labelLines.forEach((line, i) => {
    parts.push(
      `<text class="board-label" x="${String(innerX + 70)}" y="${String(firstY + i * 19)}">${escapeXml(line)}</text>`,
    );
  });
  if (hasDetail) {
    const detailY = firstY + (labelLines.length - 1) * 19 + 18;
    parts.push(
      `<text class="board-detail" x="${String(innerX + 70)}" y="${String(detailY)}">${escapeXml(clip(diagram.board.detail, 24))}</text>`,
    );
  }
  let cy = cardY + BOARD_CARD_H + 12;
  const halfW = (innerW - CHIP_GAP) / 2;
  for (const row of chips.rows) {
    row.forEach((chip, i) => {
      const w = chip.full ? innerW : halfW;
      const cx = innerX + (chip.full ? 0 : i * (halfW + CHIP_GAP));
      parts.push(
        `<rect class="chip" x="${String(cx)}" y="${String(cy)}" width="${String(w)}" height="${String(CHIP_H)}" rx="8"/>`,
        `<text class="chip-text" x="${String(cx + w / 2)}" y="${String(cy + 23)}" text-anchor="middle">${escapeXml(chip.text)}</text>`,
      );
    });
    cy += CHIP_H + CHIP_GAP;
  }
  return parts.join('');
}

// "미정" 표식 — 고객이 종류·방식을 정하지 않았다고 말한 카드(점선 테두리와 함께).
function renderTbdPill(x: number, y: number): string {
  return [
    `<rect class="tbd-pill" x="${String(x)}" y="${String(y)}" width="36" height="16" rx="8"/>`,
    `<text class="tbd-text" x="${String(x + 18)}" y="${String(y + 11.5)}" text-anchor="middle">미정</text>`,
  ].join('');
}

// 열 사이 화살표 — 수직 중앙, 라벨은 화살표 위.
function renderLink(x1: number, x2: number, y: number, label: string): string {
  const mid = (x1 + x2) / 2;
  const parts = [
    `<path class="link" d="M ${String(x1 + 6)} ${String(y)} H ${String(x2 - 10)}" marker-end="url(#arrow)"/>`,
  ];
  if (label !== '') {
    parts.push(
      `<text class="link-label" x="${String(mid)}" y="${String(y - 10)}" text-anchor="middle">${escapeXml(clip(label, 14))}</text>`,
    );
  }
  return parts.join('');
}

/**
 * 검증된 DevReviewDiagram 을 외부 리소스·스크립트가 없는 단일 HTML/SVG 로 렌더한다.
 * 같은 입력은 바이트 단위로 같은 결과를 낸다.
 */
export function renderDevReviewDiagramHtml(diagram: DevReviewDiagramType): string {
  const inputs = diagram.inputs.map(layoutNode);
  const outputs = diagram.outputs.map(layoutNode);
  const chips = layoutChips(diagram.board.chips);
  const sideH = Math.max(sideContentHeight(inputs), sideContentHeight(outputs));
  const boardContentH = BOARD_CARD_H + (chips.height > 0 ? 12 + chips.height : 0);
  const panelH = PANEL_HEAD + PANEL_PAD + Math.max(sideH, boardContentH) + PANEL_PAD;
  const top = PAD;
  const canvasH = top + panelH + PAD;
  const linkY = top + PANEL_HEAD + PANEL_PAD + CARD_H1 / 2;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>제안 시스템 구성도</title>
  <style>
    html,body{margin:0;background:#fff;color:#14243e;font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",Arial,sans-serif}svg{display:block;background:#fff}.panel{fill:#f5f7fb;stroke:#e4eaf3;stroke-width:1.5}.panel-title{font-size:12px;font-weight:800;fill:#52627d;letter-spacing:.2px}.card{fill:#fff;stroke:#e4eaf3;stroke-width:1.2}.card-empty{stroke-dasharray:6 4;fill:#fbfcfe}.card-empty-text{font-size:12px;fill:#8593ab}.icon-bg{fill:#eef2f8}.icon{fill:none;stroke:#14243e;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.card-label{font-size:14px;font-weight:700;fill:#14243e}.card-detail{font-size:11px;fill:#8593ab}.board{fill:#0c1b33}.board-title{font-size:12px;font-weight:800;fill:#a9bad4;letter-spacing:.2px}.board-card{fill:#16283f;stroke:#1f3550;stroke-width:1}.board-icon-bg{fill:#10b981}.board-icon{fill:none;stroke:#ffffff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.board-label{font-size:15px;font-weight:800;fill:#f2f6fc}.board-detail{font-size:11px;fill:#a9bad4}.chip{fill:#102138;stroke:#1f3550;stroke-width:1}.chip-text{font-size:12px;font-weight:600;fill:#f2f6fc}.link{fill:none;stroke:#8593ab;stroke-width:1.6;stroke-linecap:round}.link-label{font-size:11px;font-weight:800;fill:#0f9f6e}.card-tbd{stroke:#d29a2b;stroke-dasharray:5 4}.board-card-tbd{stroke:#d29a2b;stroke-dasharray:5 4}.tbd-pill{fill:#fdf3d7}.tbd-text{font-size:9.5px;font-weight:800;fill:#9a6a00}.footer{font-size:10px;fill:#c3cddd}
  </style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(DEV_REVIEW_DIAGRAM_WIDTH)}" height="${String(canvasH)}" viewBox="0 0 ${String(DEV_REVIEW_DIAGRAM_WIDTH)} ${String(canvasH)}" role="img" aria-label="제안 시스템 구성도">
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#8593ab"/></marker>
  </defs>
  ${renderSidePanel(LEFT_X, top, panelH, diagram.columns.inputs, inputs, '해당 없음')}
  ${renderLink(LEFT_X + SIDE_W, CENTER_X, linkY, diagram.linkIn)}
  ${renderBoardPanel(top, panelH, diagram, chips)}
  ${renderLink(CENTER_X + CENTER_W, RIGHT_X, linkY, diagram.linkOut)}
  ${renderSidePanel(RIGHT_X, top, panelH, diagram.columns.outputs, outputs, '해당 없음')}
  <text class="footer" x="${String(DEV_REVIEW_DIAGRAM_WIDTH - PAD)}" y="${String(canvasH - 10)}" text-anchor="end">dev-review diagram renderer v2</text>
</svg>
</body>
</html>`;
}
