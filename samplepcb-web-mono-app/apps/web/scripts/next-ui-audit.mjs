// 관리자 리뉴얼(src/next) 일관성 점검 — @shadcn/lint 가 못 보는 "손으로 지은 공통 부품"을 찾는다.
//
// @shadcn/lint 는 토큰 사용과 shadcn 컴포넌트의 restyle 만 본다. 그래서 일반 div 에 토큰 색을 칠해
// 알림 상자·섹션 상자·접힘 토글을 화면마다 새로 지어도 통과한다(2026-10-06 통합 때 37·71곳 실측).
// 이 스크립트는 그런 반복을 키트로 되돌리게 하는 그물이다 — 규칙과 대신 쓸 것:
//   alert      bg-*-soft 바탕 + 테두리       → ui/alert  <Alert variant="info|warning|success|destructive" size="sm">
//   tint       bg-*-soft 바탕(테두리 없음)    → 섹션 안 띠는 common/NoticeBand, 짧은 표지는 ui/badge, 상자는 Alert
//   box        rounded-* border + p-*        → common/Panel(작은 상자) · common/SectionCard(섹션) · common/TableCard(표)
//   max-h      대화상자 높이 임의값           → common/DialogScrollBody
//   raw-control  <button>·<input type=radio|checkbox> → ui/button · ui/radio-group · ui/checkbox
//   heading    h2 에 text-base 이상           → 섹션 제목은 text-sm(SectionCard), 화면 제목은 PageHeader
//
// 불가피한 곳은 바로 윗줄에 `<!-- ui-audit-allow: 사유 -->`(템플릿) 또는 `// ui-audit-allow: 사유`.
// 키트 파일(KIT_FILES — 이 패턴을 감싸는 쪽)·업스트림(components/ui)·인쇄 문서(print/)는 검사하지 않는다.
//
// 사용: apps/web 에서 `node scripts/next-ui-audit.mjs` (pnpm lint:next 가 eslint 다음에 부른다).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'src/next';
const SKIP_DIRS = new Set(['ui', 'print', '__preview__', '__probe__']);
const KIT_FILES = new Set([
  'components/common/PageHeader.vue',
  'components/common/QueueTabs.vue',
  'components/common/SearchInput.vue',
  'components/common/TableCard.vue',
  'components/common/TableEmptyRow.vue',
  'components/common/RowCheckbox.vue',
  'components/common/ListPagination.vue',
  'components/common/SectionCard.vue',
  'components/common/Panel.vue',
  'components/common/DialogScrollBody.vue',
  'components/common/CustomerCell.vue',
  'components/common/SelectionBar.vue',
  'components/common/NoticeBand.vue',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path);
    } else if (name.endsWith('.vue') && !KIT_FILES.has(relative(ROOT, path).split(sep).join('/'))) {
      yield path;
    }
  }
}

const RULES = [
  {
    id: 'alert',
    test: (cls) => /\bbg-(info|warning|success|destructive)-soft\b/.test(cls) && /(^|\s)border(\s|$)/.test(cls),
    hint: '상태 알림 상자 → <Alert variant=… size="sm">',
  },
  {
    id: 'tint',
    test: (cls) => /\bbg-(info|warning|success|destructive)-soft\b/.test(cls) && !/(^|\s)border(\s|$)/.test(cls),
    hint: '색 바탕 띠·메모 → NoticeBand(섹션 띠)·Badge(짧은 표지)·Alert(상자)',
  },
  {
    id: 'box',
    test: (cls) => /\brounded-(md|lg|xl)\b/.test(cls) && /(^|\s)border(\s|$)/.test(cls) && /(^|\s)p[xy]?-\d/.test(cls),
    hint: '테두리 상자 → Panel·SectionCard·TableCard',
  },
  {
    id: 'max-h',
    test: (cls) => /\bmax-h-\[/.test(cls),
    hint: '대화상자 스크롤 높이 → DialogScrollBody',
  },
];

const findings = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const templateStart = lines.findIndex((line) => line.startsWith('<template'));
  if (templateStart === -1) continue;
  const allowed = (index) => /ui-audit-allow/.test(lines[index - 1] ?? '');
  const report = (index, id, hint) => {
    if (!allowed(index)) findings.push(`${relative('.', file).split(sep).join('/')}:${String(index + 1)}  [${id}] ${hint}`);
  };
  // 동적 class(:class="…", 여러 줄 포함)는 안의 문자열 조각('…'·`…`)을 하나씩 검사한다 — 삼항·배열로
  // 상태색을 얹는 곳(예: 값에 따라 칸 색을 바꾸는 결론 칸)이 정적 class 검사만으로는 빠진다.
  const template = lines.slice(templateStart).join('\n');
  for (const match of template.matchAll(/:class="([^"]*)"/g)) {
    const index = templateStart + template.slice(0, match.index).split('\n').length - 1;
    for (const piece of (match[1] ?? '').matchAll(/'([^']*)'|`([^`]*)`/g)) {
      const cls = piece[1] ?? piece[2] ?? '';
      for (const rule of RULES) if (rule.test(cls)) report(index, rule.id, rule.hint);
    }
  }
  for (let i = templateStart; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const match of line.matchAll(/(?<![:\w-])class="([^"]*)"/g)) {
      const cls = match[1] ?? '';
      for (const rule of RULES) if (rule.test(cls)) report(i, rule.id, rule.hint);
    }
    if (/<button\b/.test(line)) report(i, 'raw-control', '<button> → ui/button 의 <Button>');
    if (/<input\b[^>]*type="(radio|checkbox)"/.test(line) || (/<input\b/.test(line) && /type="(radio|checkbox)"/.test(lines[i + 1] ?? ''))) {
      report(i, 'raw-control', '<input type=radio|checkbox> → RadioGroup·Checkbox');
    }
    if (/<h2\b[^>]*class="[^"]*\btext-(base|lg|xl|2xl)\b/.test(line)) {
      report(i, 'heading', '섹션 제목은 text-sm(SectionCard) — 화면 제목이면 PageHeader');
    }
  }
}

if (findings.length === 0) {
  console.log('next-ui-audit: 0건');
} else {
  for (const finding of findings) console.log(finding);
  console.log(`next-ui-audit: ${String(findings.length)}건 — 키트로 바꾸거나 윗줄에 ui-audit-allow 사유를 단다`);
  process.exitCode = 1;
}
