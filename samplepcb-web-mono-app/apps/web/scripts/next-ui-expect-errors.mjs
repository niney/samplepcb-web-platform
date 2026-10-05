// shadcn-vue 로 추가한 컴포넌트(src/next/components/ui)의 exactOptionalPropertyTypes 충돌을 표시한다.
//
// 우리 tsconfig 는 exactOptionalPropertyTypes 를 켜 두는데, shadcn-vue 컴포넌트는 Vue props
// (선택 prop = T | undefined)를 reka-ui 원시 컴포넌트에 그대로 v-bind 한다. reka-ui 의 prop 타입은
// undefined 를 명시적으로 받지 않아 파일마다 같은 오류(TS2379·TS2769)가 한 줄씩 난다. 런타임에는
// 문제가 없고(undefined 는 기본값으로 처리된다), 고치면 `shadcn-vue add --overwrite` 때 되돌아간다.
// 그래서 AGENTS.md 규칙("불가피하면 expect-error + 사유")대로 해당 줄 위에 사유 주석을 단다.
// reka-ui 가 타입을 고치면 expect-error 가 "쓰이지 않음" 오류로 바뀌어 지울 때를 알려 준다.
//
// 사용: shadcn-vue add 뒤에 `node scripts/next-ui-expect-errors.mjs` (apps/web 에서).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UI_DIR = 'src/next/components/ui/';
const REASON = 'exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs)';
const TARGET_CODES = new Set(['TS2379', 'TS2769']);

let output = '';
try {
  execSync('npx vue-tsc --noEmit', { stdio: 'pipe', encoding: 'utf8' });
} catch (error) {
  output = String(error.stdout ?? '');
}

const byFile = new Map();
for (const match of output.matchAll(/^(src\/[^(]+)\((\d+),(\d+)\): error (TS\d+)/gm)) {
  const [, file, line, , code] = match;
  if (!file.startsWith(UI_DIR) || !TARGET_CODES.has(code)) continue;
  const lines = byFile.get(file) ?? new Set();
  lines.add(Number(line));
  byFile.set(file, lines);
}

const others = [...output.matchAll(/^(src\/[^(]+)\(\d+,\d+\): error (TS\d+)/gm)].filter(
  ([, file, code]) => !(file.startsWith(UI_DIR) && TARGET_CODES.has(code)),
);

let inserted = 0;
for (const [file, lineSet] of byFile) {
  const path = resolve(file);
  const source = readFileSync(path, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const templateStart = lines.findIndex((text) => text.startsWith('<template'));
  for (const lineNo of [...lineSet].sort((a, b) => b - a)) {
    const index = lineNo - 1;
    const text = lines[index] ?? '';
    const indent = /^\s*/.exec(text)?.[0] ?? '';
    const inTemplate = templateStart !== -1 && index > templateStart;
    lines.splice(
      index,
      0,
      inTemplate ? `${indent}<!-- @vue-expect-error ${REASON} -->` : `${indent}// @ts-expect-error ${REASON}`,
    );
    inserted += 1;
  }
  writeFileSync(path, lines.join(eol));
}

console.log(`expect-error ${String(inserted)}곳 표시 (${String(byFile.size)}개 파일)`);
if (others.length > 0) {
  console.log(`대상 밖 타입 오류 ${String(others.length)}건 — 직접 확인 필요:`);
  for (const [line] of others.slice(0, 20)) console.log(`  ${line}`);
}
