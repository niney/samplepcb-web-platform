// PCB EQ 합성 코퍼스 생성기(D20 P2, docs/PCB_EQ_AI_PROBE.md §코퍼스) — 사양 하나에서 **파일 + 정답(gold) JSON**
// 을 함께 만든다. 구조 정답(번호·유형·선택지 기호·의견필수·그림)은 구성상 확정이고, 한국어는 참조 번역이다.
// 그림 id 는 파일을 쓴 뒤 추출기로 다시 읽어 (시트, 앵커 셀) 로 맞춘다 — 추출기 자체의 자기 검사를 겸한다.
// 공장명·품번은 모두 지어낸 것이다(실샘플 파일·그 그림은 쓰지 않는다 — 고객 품번·공장 정보가 있다).
//
// 실행(apps/api): node --import tsx src/scripts/gen-pcb-eq-fixtures.ts
// 출력: src/lib/pcb-eq-extract/__fixtures__/<id>.<xlsx|xls|zip> + <id>.gold.json
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { PcbEqDraft, type PcbEqDraftType, type PcbEqItemCategoryType } from '@sp/api-contract';
import { extractEqWorkbook } from '../lib/pcb-eq-extract/extract';
import type { EqGold } from '../lib/pcb-eq-extract/probe-score';

const OUT_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../lib/pcb-eq-extract/__fixtures__');

type Cat = PcbEqItemCategoryType;

interface FxOption {
  key: string;
  orig: string;
  ko: string;
  rec?: true;
  req?: true;
}

interface FxItem {
  no: string;
  /** 공장 유형 칸 문구(없으면 빈 칸). */
  type?: string;
  cat: Cat;
  alt?: Cat[];
  orig: string;
  ko: string;
  opts: FxOption[];
  /** 그림 장수. */
  figs?: number;
  /** 첨부 칸 문구를 직접 지정(그림 시트 이름 대신). */
  attach?: string;
  /** 이전 회차 고객 답(개정판) — [기호, 의견]. */
  prev?: [string, string];
  date?: string;
}

// ── 단순 PNG(도형) — node:zlib 만으로 ───────────────────────────────────────

function makePng(seed: number, w = 160, h = 100): Buffer {
  const px = Buffer.alloc(w * h * 3);
  const put = (x: number, y: number, rgb: [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): void => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, rgb);
  };
  rect(0, 0, w, h, [235, 235, 235]);
  rect(10, 10, w - 10, h - 10, [20, 110, 50]); // 보드
  for (let k = 0; k < 4 + (seed % 5); k += 1) {
    const x = 20 + ((seed * 37 + k * 29) % (w - 50));
    const y = 18 + ((seed * 17 + k * 23) % (h - 40));
    rect(x, y, x + 10, y + 7, [220, 190, 60]); // 패드
  }
  for (let t = 0; t < 40; t += 1) put(30 + t + (seed % 20), 70 - Math.floor(t / 2), [220, 30, 30]); // 화살표
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 격자 시트 → xlsx(exceljs)·xls(SheetJS) ───────────────────────────────────

type CellVal = string | number | { date: string };

interface GridImage {
  row: number;
  col: number;
  png: Buffer;
  /** 이 그림이 속한 문항(null = 로고·도장 같은 무관 그림). */
  itemNo: string | null;
}

class GridSheet {
  readonly cells = new Map<string, { r: number; c: number; v: CellVal }>();
  readonly merges: [number, number, number, number][] = [];
  readonly images: GridImage[] = [];
  constructor(readonly name: string) {}
  set(r: number, c: number, v: CellVal | undefined | null): this {
    if (v === undefined || v === null || v === '') return this;
    this.cells.set(`${String(r)},${String(c)}`, { r, c, v });
    return this;
  }
  merge(r1: number, c1: number, r2: number, c2: number): this {
    if (r2 > r1 || c2 > c1) this.merges.push([r1, c1, r2, c2]);
    return this;
  }
  image(row: number, col: number, png: Buffer, itemNo: string | null): this {
    this.images.push({ row, col, png, itemNo });
    return this;
  }
}

const ymdToUtc = (ymd: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
};
const ymdToSerial = (ymd: string): number => Math.round((ymdToUtc(ymd).getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);

async function toXlsx(sheets: GridSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const { r, c, v } of s.cells.values()) {
      const cell = ws.getCell(r + 1, c + 1);
      if (typeof v === 'object') {
        cell.value = ymdToUtc(v.date);
        cell.numFmt = 'yyyy-mm-dd';
      } else {
        cell.value = v;
      }
    }
    for (const [r1, c1, r2, c2] of s.merges) ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
    for (const img of s.images) {
      // exceljs 타입의 Buffer 는 자체 선언(ArrayBuffer 확장)이라 Node Buffer 를 그대로 못 받는다 — 런타임은 Node Buffer 를 쓴다.
      const id = wb.addImage({ buffer: img.png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(id, { tl: { col: img.col, row: img.row }, ext: { width: 160, height: 100 } });
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function toXls(sheets: GridSheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxR = 0;
    let maxC = 0;
    for (const { r, c, v } of s.cells.values()) {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] =
        typeof v === 'object'
          ? { t: 'n', v: ymdToSerial(v.date), z: 'yyyy-mm-dd' }
          : typeof v === 'number'
            ? { t: 'n', v }
            : { t: 's', v };
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    ws['!merges'] = s.merges.map(([r1, c1, r2, c2]) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out: unknown = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
  if (!Buffer.isBuffer(out)) throw new Error('SheetJS biff8 write did not return a Buffer');
  return out;
}

// ── 양식 1: LHD 유사 이중언어(번호 블록 3줄 × 선택지 기호 열 + 문구 열, 그림 시트) ─────────────

interface LhdOptions {
  factory: string;
  title: string;
  custPn: string;
  facLabel: string;
  facPn: string;
  slots: string[];
  items: FxItem[];
  figSheet: (no: string) => string;
  typeList: boolean;
  logo: boolean;
  date: string;
  extraSheets?: GridSheet[];
}

const LHD_TYPES = [
  'impedance阻抗', 'mark标记', 'size of pads equal hole负焊盘', 'soldmask dam阻焊桥', 'circuit pattern线路',
  'via disposal过孔处理', 'soldmask阻焊', 'legend字符', 'drill钻孔', 'outline外形', 'indication标注', 'other其他', 'spec说明',
];

function buildLhd(o: LhdOptions): GridSheet[] {
  const main = new GridSheet('问 题 描 述');
  main.set(0, 0, '顾客型号(Customer P/N)：').merge(0, 0, 0, 1).set(0, 2, o.custPn).merge(0, 2, 0, 3);
  main.set(0, 5, o.title).merge(0, 5, 3, 13);
  main.set(1, 0, o.facLabel).merge(1, 0, 1, 1).set(1, 2, o.facPn).merge(1, 2, 1, 3);
  main.set(2, 0, '编写人Made by:').set(2, 2, 'WJ');
  main.set(3, 0, '审核人Checked by:');
  main.set(4, 0, "请顾客在黄色栏内回复(NOTE:Customer's answer in column yellow area)").merge(4, 0, 4, 3);
  main.set(5, 0, `${o.factory}工程师问题列表EQs from ${o.factory}`).merge(5, 0, 5, 7);
  main.set(5, 8, 'Answers from Customer').merge(5, 8, 5, 13);
  if (o.typeList) LHD_TYPES.forEach((t, i) => main.set(0, 51 + i, t));
  if (o.logo) main.image(0, 5, makePng(99, 120, 40), null);
  [
    '序号\n*', '日期                DD-MM-YYYY', '问题类型Types of Problems', '问题描述                Problem Description',
    '附件 Attachment', `${o.factory}工程建议          Recommendation /suggestion`, '', '附件 Attachments',
    '请选择答复Pls choose one option', '描述或备注Comments', '附件Attachment', '答复人Answered by', '审核人Checked by',
    '日期        DD-MM-YYYY',
  ].forEach((h, c) => main.set(6, c, h));
  main.merge(6, 5, 6, 6);
  const sheets: GridSheet[] = [main];
  const figSheets = new Map<string, GridSheet>();
  let figSeed = 1;
  o.slots.forEach((no, idx) => {
    const r = 7 + idx * 3;
    const item = o.items.find((it) => it.no === no);
    main.set(r, 0, Number(no));
    const figName = o.figSheet(no);
    const fig = new GridSheet(figName).set(0, 0, '返回问客主页');
    figSheets.set(no, fig);
    if (item === undefined) {
      main.set(r, 4, figName);
    } else {
      main.set(r, 1, { date: item.date ?? o.date }).set(r, 2, item.type ?? '').set(r, 3, item.orig);
      main.set(r, 4, item.attach ?? ((item.figs ?? 0) > 0 ? figName : ''));
      for (let k = 0; k < (item.figs ?? 0); k += 1) fig.image(1, 1 + k * 4, makePng(figSeed++), no);
      if (item.prev !== undefined) main.set(r, 8, item.prev[0]).set(r, 9, item.prev[1]).set(r, 11, 'Kim').set(r, 13, { date: o.date });
    }
    ['A', 'B', 'C'].forEach((key, k) => {
      main.set(r + k, 5, key);
      const opt = item?.opts.find((x) => x.key === key);
      if (opt !== undefined) main.set(r + k, 6, opt.orig);
    });
    for (const c of [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13]) main.merge(r, c, r + 2, c);
  });
  sheets.push(...figSheets.values(), ...(o.extraSheets ?? []));
  return sheets;
}

// ── 공통: 사양 → 정답 ─────────────────────────────────────────────────────────

interface Built {
  id: string;
  ext: 'xlsx' | 'xls' | 'zip';
  label: string;
  notes: string;
  header: PcbEqDraftType['header'];
  items: FxItem[];
  emptySlots: string[];
  sheets: GridSheet[];
  /** zip 안 경로(ext=zip 일 때). */
  zipInner?: string;
}

async function writeFixture(b: Built): Promise<{ file: string; bytes: number; images: number }> {
  const file = `${b.id}.${b.ext}`;
  let buf: Buffer;
  if (b.ext === 'xls') buf = toXls(b.sheets);
  else if (b.ext === 'xlsx') buf = await toXlsx(b.sheets);
  else {
    const inner = await toXlsx(b.sheets);
    buf = Buffer.from(
      zipSync({
        [b.zipInner ?? 'EQ/eq.xlsx']: new Uint8Array(inner),
        'readme.txt': strToU8('Gerber and EQ files for order HX-0928. Please reply within 24h.'),
      }),
    );
  }
  const extract = extractEqWorkbook(buf, file);
  if (extract.warnings.length > 0) console.warn(`  ! ${file}: ${extract.warnings.join(' / ')}`);
  // 그림 id — (시트, 앵커 셀) 로 맞춘다. xls 는 셀만 쓰므로 그림이 없다(정답도 []).
  const idFor = (sheet: string, img: GridImage): string | null =>
    extract.images.find((e) => e.sheetName === sheet && e.anchor?.row === img.row && e.anchor.col === img.col)?.id ?? null;
  const figureRefs = new Map<string, string[]>();
  if (b.ext !== 'xls') {
    for (const s of b.sheets) {
      for (const img of s.images) {
        const id = idFor(s.name, img);
        if (id === null) throw new Error(`${file}: 그림 ${s.name}@${String(img.row)},${String(img.col)} 를 추출기가 못 찾음`);
        if (img.itemNo !== null) figureRefs.set(img.itemNo, [...(figureRefs.get(img.itemNo) ?? []), id]);
      }
    }
  }
  const draft = PcbEqDraft.parse({
    header: b.header,
    items: b.items.map((it) => ({
      factoryNo: it.no,
      category: it.cat,
      question: it.ko,
      questionOrig: it.orig,
      options: it.opts.map((op) => ({
        key: op.key,
        label: op.ko,
        labelOrig: op.orig,
        recommended: op.rec === true,
        requiresComment: op.req === true,
      })),
      figureRefs: figureRefs.get(it.no) ?? [],
    })),
  });
  const gold: EqGold = {
    id: b.id,
    file,
    label: b.label,
    draft,
    categoryAlt: Object.fromEntries(b.items.filter((it) => it.alt !== undefined).map((it) => [it.no, it.alt ?? []])),
    emptySlots: b.emptySlots,
    notes: b.notes,
  };
  writeFileSync(path.join(OUT_DIR, file), buf);
  writeFileSync(path.join(OUT_DIR, `${b.id}.gold.json`), `${JSON.stringify(gold, null, 2)}\n`);
  return { file, bytes: buf.length, images: extract.images.length };
}

const B: FxOption = { key: 'B', orig: '请贵司指示Pls send your suggestion', ko: '직접 지시하겠습니다(의견 작성)', req: true };
const C: FxOption = { ...B, key: 'C' };

// ── (a) LHD 유사 이중언어 ─────────────────────────────────────────────────────

const A_ITEMS: FxItem[] = [
  {
    no: '1', type: 'soldmask dam阻焊桥', cat: 'soldermask_dam', figs: 1,
    orig: '如图1，U3处IC焊盘间距0.18mm，无法保留阻焊桥，我司建议开通窗处理，请确认？As fig1 shown, the pad spacing of U3 is 0.18mm, we can not keep the soldermask dam, we suggest to make gang opening, pls confirm.',
    ko: '그림 1과 같이 U3 의 IC 패드 간격이 0.18mm 라 솔더마스크 댐을 남길 수 없습니다. 제조사는 패드 사이를 한꺼번에 오픈(통 오픈)하기를 권합니다. 확인해 주시겠습니까?',
    opts: [{ key: 'A', orig: '接受开通窗Accept gang opening', ko: '통 오픈 처리 수용' }, B],
  },
  {
    no: '2', type: 'drill钻孔', cat: 'drill', figs: 1,
    orig: '如图2，最小孔径0.2mm与焊盘0.35mm，孔环仅0.075mm，我司建议孔径改为0.15mm，可以吗？As fig2 shown, the min hole size is 0.2mm with 0.35mm pad, the annular ring is only 0.075mm, can we change the hole size to 0.15mm?',
    ko: '그림 2와 같이 최소 홀 크기 0.2mm 에 패드 0.35mm 라 애뉼러 링이 0.075mm 밖에 되지 않습니다. 홀 크기를 0.15mm 로 바꿔도 될까요?',
    opts: [
      { key: 'A', orig: '同意改为0.15mm Agree to change to 0.15mm', ko: '0.15mm 로 변경에 동의' },
      { key: 'B', orig: '按原稿0.2mm制作，接受孔环偏小 Keep 0.2mm, accept small annular ring', ko: '원본대로 0.2mm 로 제작하고 작은 애뉼러 링을 수용' },
      C,
    ],
  },
  {
    no: '3', type: 'via disposal过孔处理', cat: 'via',
    orig: 'BGA下过孔距焊盘太近，我司建议过孔塞孔（树脂塞孔+电镀填平），是否接受？The vias under BGA are too close to pads, we suggest resin plugging and capping, is it acceptable?',
    ko: 'BGA 아래 비아가 패드에 너무 가깝습니다. 제조사는 비아를 레진으로 홀 메움(레진 플러깅 후 도금 평탄화)하기를 권합니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受树脂塞孔Accept resin plugging', ko: '레진 홀 메움 수용' },
      { key: 'B', orig: '过孔盖油即可 Just tent the vias with soldermask', ko: '비아를 솔더마스크로 덮기(텐팅)만 하면 됨' },
      C,
    ],
  },
  {
    no: '4', type: 'legend字符', cat: 'legend', figs: 2,
    orig: '如图4，部分字符线宽0.1mm、字高0.6mm，小于我司最小能力（线宽0.12mm/字高0.8mm），成品会模糊，请确认是否按比例加大？As fig4 shown, some legend line width 0.1mm and height 0.6mm are below our capability(0.12mm/0.8mm), shall we enlarge them proportionally?',
    ko: '그림 4와 같이 일부 실크 문자의 선폭이 0.1mm, 문자 높이가 0.6mm 로 제조사 최소 능력(선폭 0.12mm/문자 높이 0.8mm)보다 작아 완성품에서 흐릴 수 있습니다. 비율대로 키울까요?',
    opts: [
      { key: 'A', orig: '同意按比例加大Agree to enlarge', ko: '비율대로 확대에 동의' },
      { key: 'B', orig: '保持原样，接受字符模糊 Keep as is and accept blurry legend', ko: '원래대로 두고 실크가 흐린 것을 수용' },
    ],
  },
  {
    no: '5', type: 'impedance阻抗', cat: 'impedance',
    orig: '贵司要求单端50Ω±10%，按现有叠层计算线宽需调整为0.13mm，是否接受？You require 50ohm±10% single-ended impedance, per current stackup the trace width should be adjusted to 0.13mm, is it ok?',
    ko: '귀사 요구는 싱글엔드 50Ω±10% 임피던스인데, 현재 적층 구조로 계산하면 선폭을 0.13mm 로 조정해야 합니다. 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受调整线宽 Accept to adjust trace width', ko: '선폭 조정 수용' }, B],
  },
];

const fixtureA = (): Built => ({
  id: 'a-lhd-bilingual',
  ext: 'xlsx',
  label: '(a) LHD 유사 이중언어 · 선택지 세 줄(기호 열+문구 열) · 그림 시트 · 빈 슬롯 3',
  notes: '실샘플과 같은 열 배치. 공장 로고(F1)는 어느 문항에도 속하지 않는다.',
  header: { customerPartNo: 'SPB-2409-017', factoryPartNo: 'XD24A0915', issuedOn: '2026-09-12' },
  items: A_ITEMS,
  emptySlots: ['6', '7', '8'],
  sheets: buildLhd({
    factory: '鑫达', title: '                  XINDA CIRCUIT CO.   工程问题确认单(PCB EQs Form)', custPn: 'SPB-2409-017',
    facLabel: '鑫达内部型号(XD P/N):', facPn: 'XD24A0915 沉金板', slots: ['1', '2', '3', '4', '5', '6', '7', '8'],
    items: A_ITEMS, figSheet: (n) => `图 ${n}`, typeList: true, logo: true, date: '2026-09-12',
  }),
});

// ── (e) (a)의 개정판 v2 — 변경 1·신규 1·삭제 1 + 이전 회차 고객 답 ────────────────────────

const pick = (items: FxItem[], no: string): FxItem => {
  const it = items.find((x) => x.no === no);
  if (it === undefined) throw new Error(`문항 ${no} 없음`);
  return it;
};

const E_ITEMS: FxItem[] = [
  { ...pick(A_ITEMS, '1'), prev: ['A', '同意开通窗'] },
  {
    no: '2', type: 'drill钻孔', cat: 'drill', figs: 1, date: '2026-09-15', prev: ['C', '请保持0.2mm'],
    orig: '如图2，最小孔径0.2mm与焊盘0.35mm，按贵司回复保持0.2mm则孔环不足，我司建议孔径改为0.18mm、焊盘加大至0.4mm，可以吗？As fig2 shown, keeping 0.2mm hole per your reply leaves insufficient annular ring, we suggest 0.18mm hole and enlarge pad to 0.4mm, ok?',
    ko: '그림 2와 같이 최소 홀 크기 0.2mm 에 패드 0.35mm 입니다. 회신하신 대로 0.2mm 를 유지하면 애뉼러 링이 부족해, 홀 크기를 0.18mm 로 하고 패드를 0.4mm 로 키우기를 권합니다. 괜찮을까요?',
    opts: [{ key: 'A', orig: '同意0.18mm孔径并加大焊盘 Agree 0.18mm hole & enlarge pad', ko: '홀 크기 0.18mm 와 패드 확대에 동의' }, B],
  },
  { ...pick(A_ITEMS, '4'), prev: ['A', ''] },
  { ...pick(A_ITEMS, '5'), prev: ['A', 'OK'] },
  {
    no: '6', type: 'spec说明', cat: 'surface_finish', alt: ['indication'], figs: 1, date: '2026-09-15',
    orig: '沉金厚度贵司要求2u"，我司常规1u"，2u"需加收费用，是否接受？ENIG gold thickness 2u" required, our standard is 1u", 2u" costs extra, OK?',
    ko: '무전해 금도금(ENIG) 두께를 2u" 로 요구하셨는데 제조사 표준은 1u" 이며 2u" 는 추가 비용이 듭니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受加收费用 Accept extra cost', ko: '추가 비용 수용' },
      { key: 'B', orig: '改为1u" Change to 1u"', ko: '1u" 로 변경' },
      C,
    ],
  },
];

const fixtureE = (): Built => ({
  id: 'e-lhd-v2',
  ext: 'xlsx',
  label: '(e) (a)의 개정판 2차 — 2번 변경·3번 삭제(번호 결번)·6번 신규 + 이전 회차 고객 답(I·J 칸)',
  notes: '고객 답 칸(I·J·L·N)은 문항이 아니다 — 선택지·질문에 섞이면 오답. 번호 3 은 결번이라 채워 넣으면 안 된다.',
  header: { customerPartNo: 'SPB-2409-017', factoryPartNo: 'XD24A0915', issuedOn: '2026-09-15' },
  items: E_ITEMS,
  emptySlots: ['7', '8'],
  sheets: buildLhd({
    factory: '鑫达', title: '                  XINDA CIRCUIT CO.   工程问题确认单 第二次(PCB EQs Form 2nd)', custPn: 'SPB-2409-017',
    facLabel: '鑫达内部型号(XD P/N):', facPn: 'XD24A0915 沉金板', slots: ['1', '2', '4', '5', '6', '7', '8'],
    items: E_ITEMS, figSheet: (n) => `图 ${n}`, typeList: true, logo: true, date: '2026-09-15',
  }).map((s) => {
    // 개정판 표의 '작성일' — 원본 회차 문항의 날짜는 9/12, 변경·신규는 9/15. 머리 날짜는 표 위에 따로 적는다.
    if (s.name === '问 题 描 述') s.set(3, 2, '日期Date:').set(3, 3, { date: '2026-09-15' });
    return s;
  }),
});

// ── (f) 17문항 다양한 유형 ─────────────────────────────────────────────────────

const F_ITEMS: FxItem[] = [
  {
    no: '1', type: 'impedance阻抗', cat: 'impedance', attach: '阻抗表',
    orig: '按贵司阻抗要求（见阻抗表），差分100Ω需将线宽/线距调整为0.1/0.12mm，是否接受？Per your impedance requirement (see impedance sheet), 100ohm differential needs width/space 0.1/0.12mm, OK?',
    ko: '요구하신 임피던스(임피던스 표 참고)에 맞추려면 차동 100Ω 선로의 선폭/간격을 0.1/0.12mm 로 조정해야 합니다. 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受调整 Accept', ko: '조정 수용' }, B],
  },
  {
    no: '2', type: 'stackup层压结构', cat: 'stackup', figs: 1,
    orig: '贵司要求板厚1.2mm 4层，我司常规叠层为1.6mm，按1.2mm调整叠层结构（见图1），是否接受？4-layer 1.2mm required, we adjust the stackup as fig1, OK?',
    ko: '4층 보드 두께 1.2mm 를 요구하셨는데 제조사 표준 적층은 1.6mm 입니다. 1.2mm 에 맞춰 적층 구조를 조정하려는데(그림 1 참고) 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '3', type: 'drill钻孔', cat: 'drill',
    orig: '孔到孔最小间距0.15mm，钻孔易断刀，建议移孔或合并，请确认。Min hole-to-hole 0.15mm may break drill bits, suggest to move or merge holes, pls confirm.',
    ko: '홀과 홀 사이 최소 간격이 0.15mm 라 드릴 비트가 부러지기 쉽습니다. 홀을 옮기거나 합치기를 권하니 확인해 주세요.',
    opts: [
      { key: 'A', orig: '允许移孔 Allow to move', ko: '홀 이동 허용' },
      { key: 'B', orig: '允许合并 Allow to merge', ko: '홀 합치기 허용' },
      C,
    ],
  },
  {
    no: '4', type: 'via disposal过孔处理', cat: 'via', figs: 1,
    orig: '过孔焊盘在BGA焊盘上（盘中孔），建议树脂塞孔后电镀填平(VIPPO)，需加收费用，是否接受？Via-in-pad on BGA, suggest VIPPO with extra cost, OK?',
    ko: 'BGA 패드 위에 비아가 있습니다(패드 내 비아). 레진으로 홀 메움 후 도금 평탄화(VIPPO)를 권하며 추가 비용이 듭니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受VIPPO及费用 Accept VIPPO & cost', ko: 'VIPPO 와 비용 수용' },
      { key: 'B', orig: '改为盖油塞孔 Change to soldermask plugging', ko: '솔더마스크 잉크 홀 메움으로 변경' },
    ],
  },
  {
    no: '5', type: 'soldmask dam阻焊桥', cat: 'soldermask_dam',
    orig: 'QFN焊盘间阻焊桥宽度0.07mm，小于最小0.08mm，无法保留阻焊桥，是否接受开通窗？S/M dam between QFN pads 0.07mm < min 0.08mm, accept gang opening?',
    ko: 'QFN 패드 사이 솔더마스크 댐 폭이 0.07mm 로 최소치 0.08mm 보다 작아 남길 수 없습니다. 통 오픈을 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '6', type: 'drill钻孔', cat: 'drill', alt: ['outline'],
    orig: '板边有半孔，需要加工半孔工艺，交期增加1天，是否接受？Castellated half holes on board edge need extra process, +1 day lead time, OK?',
    ko: '보드 가장자리에 하프홀이 있어 하프홀 공정이 추가되고 납기가 1일 늘어납니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '取消半孔 Cancel half holes', ko: '하프홀 취소' },
    ],
  },
  {
    no: '7', type: 'outline外形', cat: 'panel', alt: ['outline'], figs: 1,
    orig: '拼版方式贵司未注明，我司建议2x3拼版，V-CUT分板，工艺边5mm，是否接受？Panel not specified, we suggest 2x3 array with V-CUT and 5mm rails, OK?',
    ko: '패널 방식이 지정되어 있지 않습니다. 2x3 패널, V컷 분리, 레일(공정 여백) 5mm 를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '单片出货 Ship as single pcs', ko: '낱개(단품)로 출하' },
      C,
    ],
  },
  {
    no: '8', type: 'outline外形', cat: 'panel', alt: ['outline'],
    orig: '异形板无法V-CUT，建议用邮票孔连接，孔径0.5mm，是否接受？Irregular shape can not be V-cut, suggest stamp holes 0.5mm, OK?',
    ko: '비정형 보드라 V컷을 할 수 없습니다. 홀 크기 0.5mm 스탬프 홀로 연결하기를 권하는데 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '9', type: 'spec说明', cat: 'surface_finish', alt: ['indication'],
    orig: '沉金面积比例超过30%，建议改为沉金+OSP选择性处理以降低成本，是否接受？ENIG area > 30%, suggest selective ENIG+OSP to reduce cost, OK?',
    ko: '무전해 금도금(ENIG) 면적 비율이 30% 를 넘습니다. 비용을 줄이려면 ENIG+OSP 선택 처리로 바꾸기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '仍按全板沉金 Keep full ENIG', ko: '전면 ENIG 유지' },
    ],
  },
  {
    no: '10', type: 'circuit pattern线路', cat: 'circuit', alt: ['material'],
    orig: '贵司要求外层铜厚2oz，线宽0.15mm无法满足蚀刻，建议外层改为1oz或线宽加大至0.2mm？Outer copper 2oz with 0.15mm trace can not be etched, change to 1oz or widen trace to 0.2mm?',
    ko: '외층 동박 두께 2oz 를 요구하셨는데 선폭 0.15mm 로는 에칭할 수 없습니다. 외층을 1oz 로 바꾸거나 선폭을 0.2mm 로 키우기를 권합니다.',
    opts: [
      { key: 'A', orig: '改为1oz Change to 1oz', ko: '1oz 로 변경' },
      { key: 'B', orig: '线宽加大至0.2mm Widen to 0.2mm', ko: '선폭을 0.2mm 로 확대' },
      C,
    ],
  },
  {
    no: '11', type: 'other其他', cat: 'material', alt: ['other'],
    orig: '资料要求TG170板材，我司库存为TG150，使用TG170交期加3天，是否接受TG150？TG170 required, we have TG150 in stock, TG170 adds 3 days; accept TG150?',
    ko: '자료에는 TG170 원자재로 되어 있으나 제조사 재고는 TG150 이고 TG170 을 쓰면 납기가 3일 늘어납니다. TG150 을 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受TG150 Accept TG150', ko: 'TG150 수용' },
      { key: 'B', orig: '坚持TG170 Keep TG170', ko: 'TG170 유지' },
    ],
  },
  {
    no: '12', type: 'legend字符', cat: 'legend', figs: 2,
    orig: '顶层字符与焊盘重叠，我司将移开字符，无法移开的将削掉，是否接受？Top legend overlaps pads, we will move or clip it, OK?',
    ko: '윗면 실크가 패드와 겹칩니다. 제조사가 실크를 옮기고, 옮길 수 없는 것은 깎아내려 하는데 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '13', type: 'size of pads equal hole负焊盘', cat: 'pad',
    orig: 'SMD焊盘间距0.2mm，建议焊盘单边内缩0.02mm以避免短路，是否接受？SMD pad gap 0.2mm, suggest shrink pads 0.02mm per side, OK?',
    ko: 'SMD 패드 간격이 0.2mm 입니다. 쇼트를 막기 위해 패드를 한쪽 0.02mm 씩 줄이기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '保持原样 Keep as is', ko: '원래대로 유지' },
    ],
  },
  {
    no: '14', type: 'outline外形', cat: 'outline', figs: 1,
    orig: '外形图尺寸为50x30mm，Gerber外形层为50x31mm，以哪个为准？Drawing 50x30mm vs Gerber outline 50x31mm, which one?',
    ko: '외형 도면 치수는 50x30mm, 거버 외형 레이어는 50x31mm 입니다. 어느 쪽을 기준으로 할까요?',
    opts: [
      { key: 'A', orig: '以外形图为准 Follow drawing', ko: '외형 도면 기준' },
      { key: 'B', orig: '以Gerber为准 Follow Gerber', ko: '거버 기준' },
    ],
  },
  {
    no: '15', type: 'mark标记', cat: 'marking',
    orig: '是否需要在板上加UL标记及周期？Do you need UL mark and date code on the board?',
    ko: '보드에 UL 마크와 주기(데이트 코드)를 넣을까요?',
    opts: [
      { key: 'A', orig: '需要 Yes', ko: '넣음' },
      { key: 'B', orig: '不需要 No', ko: '넣지 않음' },
    ],
  },
  {
    no: '16', type: 'circuit pattern线路', cat: 'circuit',
    orig: '内层线路距板边0.2mm，锣板会露铜，建议内缩至0.3mm，是否接受？Inner layer traces 0.2mm from board edge, suggest pull back to 0.3mm, OK?',
    ko: '내층 회로가 보드 가장자리에서 0.2mm 라 라우팅 시 동박이 드러납니다. 0.3mm 안쪽으로 줄이기를 권하는데 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '17', type: 'other其他', cat: 'other', alt: ['drill'],
    orig: '贵司Gerber中有两个钻孔文件，我司按NC_DRILL.drl制作，请确认。Two drill files found, we will use NC_DRILL.drl, pls confirm.',
    ko: '거버에 드릴 파일이 두 개 있습니다. 제조사는 NC_DRILL.drl 기준으로 제작하려 하니 확인해 주세요.',
    opts: [{ key: 'A', orig: '确认 Confirm', ko: '확인' }, B],
  },
];

const fixtureF = (): Built => {
  const imp = new GridSheet('阻抗表');
  [
    ['层 Layer', '类型 Type', '要求 Target', '线宽 W(mm)', '线距 S(mm)', '参考层 Ref'],
    ['L1', '差分 Diff', '100Ω±10%', 0.1, 0.12, 'L2'],
    ['L1', '单端 SE', '50Ω±10%', 0.13, '', 'L2'],
    ['L4', '差分 Diff', '100Ω±10%', 0.1, 0.12, 'L3'],
  ].forEach((row, r) => {
    row.forEach((v, c) => imp.set(r, c, v));
  });
  return {
    id: 'f-many-types',
    ext: 'xlsx',
    label: '(f) 17문항 · 임피던스/적층/드릴/비아/댐/하프홀/V컷/스탬프홀/표면처리/동박/원자재/실크/패드/외형/마킹/회로/기타 · 참조 시트(阻抗表)',
    notes: '1번 첨부는 그림이 아니라 참조 시트(阻抗表) — figureRefs 는 []. 7·8번은 공장이 outline 으로 분류했지만 내용은 패널.',
    header: { customerPartNo: 'SPB-2410-033', factoryPartNo: 'BR8L2410-21', issuedOn: '2026-09-22' },
    items: F_ITEMS,
    emptySlots: ['18'],
    sheets: buildLhd({
      factory: '博睿', title: 'BORUI PCB CO. 工程问题确认单(PCB EQs Form)', custPn: 'SPB-2410-033', facLabel: '博睿内部型号(BR P/N):',
      facPn: 'BR8L2410-21', slots: Array.from({ length: 18 }, (_, i) => String(i + 1)), items: F_ITEMS,
      figSheet: (n) => `图 ${n}`, typeList: false, logo: false, date: '2026-09-22', extraSheets: [imp],
    }),
  };
};

// ── (h) zip 안 xlsx ───────────────────────────────────────────────────────────

const H_ITEMS: FxItem[] = [
  {
    no: '1', type: 'spec说明', cat: 'indication', alt: ['material', 'other'],
    orig: '贵司提供的Gerber与PDF图纸板厚不一致（1.0mm vs 0.8mm），我司按Gerber 1.0mm制作？Gerber(1.0mm) and PDF(0.8mm) thickness differ, we follow Gerber 1.0mm?',
    ko: '주신 거버와 PDF 도면의 보드 두께가 다릅니다(1.0mm 대 0.8mm). 거버 기준 1.0mm 로 제작할까요?',
    opts: [
      { key: 'A', orig: '按Gerber 1.0mm Follow Gerber', ko: '거버 기준 1.0mm' },
      { key: 'B', orig: '按PDF 0.8mm Follow PDF', ko: 'PDF 기준 0.8mm' },
    ],
  },
  {
    no: '2', type: 'soldmask阻焊', cat: 'soldermask', figs: 1,
    orig: '阻焊开窗文件中散热焊盘全开窗，是否需要做阻焊网格？The thermal pad is fully opened, do you need soldermask grid on it?',
    ko: '솔더마스크 오픈 파일에서 방열 패드가 전부 오픈되어 있습니다. 그 위에 솔더마스크 격자를 넣을까요?',
    opts: [
      { key: 'A', orig: '需要网格 Need grid', ko: '격자 필요' },
      { key: 'B', orig: '全开窗 Full opening', ko: '전체 오픈 유지' },
    ],
  },
  {
    no: '3', type: 'legend字符', cat: 'legend', figs: 1,
    orig: '字符颜色贵司未注明，我司按白色字符制作？Legend color not specified, we make white legend?',
    ko: '실크 색상이 지정되어 있지 않습니다. 흰색 실크로 제작할까요?',
    opts: [
      { key: 'A', orig: '白色 White', ko: '흰색' },
      { key: 'B', orig: '黑色 Black', ko: '검은색' },
      C,
    ],
  },
];

const fixtureH = (): Built => ({
  id: 'h-zip-xlsx',
  ext: 'zip',
  zipInner: 'EQ资料/HX-EQ-0928.xlsx',
  label: '(h) zip 안 xlsx(폴더 안·readme 동봉) · 그림 시트 이름 공백 없음(图1)',
  notes: '포털 EQ 첨부는 zip 이 흔하다 — 추출기가 안의 첫 통합문서를 고른다.',
  header: { customerPartNo: 'SPB-2409-208', factoryPartNo: 'HX4L0928', issuedOn: '2026-09-28' },
  items: H_ITEMS,
  emptySlots: ['4', '5', '6'],
  sheets: buildLhd({
    factory: '恒信', title: 'HENGXIN ELECTRONICS 工程问题确认单(EQ)', custPn: 'SPB-2409-208', facLabel: '恒信内部型号(HX P/N):',
    facPn: 'HX4L0928', slots: ['1', '2', '3', '4', '5', '6'], items: H_ITEMS, figSheet: (n) => `图${n}`, typeList: false,
    logo: false, date: '2026-09-28',
  }),
});

// ── (j) BIFF8 .xls(셀만) ───────────────────────────────────────────────────────

const J_ITEMS: FxItem[] = [
  {
    no: '1', type: 'spec说明', cat: 'surface_finish', alt: ['indication'],
    orig: '贵司要求OSP，板上有金手指，建议金手指电金+其余OSP，是否接受？OSP required but gold fingers exist, suggest hard gold on fingers + OSP elsewhere, OK?',
    ko: 'OSP 로 요청하셨으나 보드에 골드 핑거가 있습니다. 골드 핑거는 전해 금도금, 나머지는 OSP 로 하기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '全板OSP Full OSP', ko: '전면 OSP' },
      C,
    ],
  },
  {
    no: '2', type: 'drill钻孔', cat: 'drill',
    orig: '槽孔长宽比小于2:1，无法锣槽，建议改为钻孔连孔，是否接受？Slot aspect ratio < 2:1, suggest drilled slot by overlapping holes, OK?',
    ko: '슬롯의 길이:폭 비가 2:1 보다 작아 라우팅으로 가공할 수 없습니다. 드릴 홀을 겹쳐 뚫어 슬롯을 만들기를 권하는데 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受 Accept', ko: '수용' }, B],
  },
  {
    no: '3', type: 'via disposal过孔处理', cat: 'via',
    orig: '贵司未注明过孔处理方式，我司按过孔盖油制作，是否接受？Via treatment not specified, we will tent vias with soldermask, OK?',
    ko: '비아 처리 방식이 지정되어 있지 않아 비아를 솔더마스크로 덮어(텐팅) 제작하려 합니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受盖油 Accept tenting', ko: '텐팅 수용' },
      { key: 'B', orig: '过孔开窗 Open vias', ko: '비아 오픈' },
      { key: 'C', orig: '过孔塞油 Plug vias with ink', ko: '비아를 잉크로 메움' },
    ],
  },
  {
    no: '4', type: 'other其他', cat: 'other', alt: ['panel'],
    orig: '贵司订单数量50pcs，拼版后为54pcs，多出的4pcs是否一起出货？Order 50pcs, panel yields 54pcs, ship the extra 4pcs?',
    ko: '주문 수량은 50pcs 인데 패널로 만들면 54pcs 가 나옵니다. 남는 4pcs 도 함께 출하할까요?',
    opts: [
      { key: 'A', orig: '一起出货 Ship all', ko: '함께 출하' },
      { key: 'B', orig: '只出50pcs Ship 50pcs only', ko: '50pcs 만 출하' },
    ],
  },
];

const fixtureJ = (): Built => ({
  id: 'j-legacy-xls',
  ext: 'xls',
  label: '(j) BIFF8 .xls(SheetJS 로 쓴 셀만 — 그림 없음) · 날짜는 서식 붙은 일련값',
  notes: '그림 시트는 있지만 비어 있다 — 모든 문항 figureRefs=[]. 첨부 칸 "图 N" 을 보고 그림을 지어내면 오답.',
  header: { customerPartNo: 'SPB-2408-115', factoryPartNo: 'JL2408-77', issuedOn: '2026-08-30' },
  items: J_ITEMS,
  emptySlots: ['5', '6'],
  sheets: buildLhd({
    factory: '金利', title: 'JINLI PCB 工程问题确认单(PCB EQs Form)', custPn: 'SPB-2408-115', facLabel: '金利内部型号(JL P/N):',
    facPn: 'JL2408-77', slots: ['1', '2', '3', '4', '5', '6'],
    items: J_ITEMS.map((it) => ({ ...it, attach: `图 ${it.no}` })),
    figSheet: (n) => `图 ${n}`, typeList: false, logo: false, date: '2026-08-30',
  }),
});

// ── (b) 중국어 전용·열 순서 다름(번호|질문|유형|附图|选项|建议|客户回复|备注) ──────────────────

const B_ITEMS: FxItem[] = [
  {
    no: '1', type: '外形', cat: 'outline', alt: ['circuit'], figs: 1, attach: '见附图1',
    orig: '外形图中板边到线路距离仅0.15mm，锣板后可能露铜，建议线路内缩至0.25mm，是否同意？',
    ko: '외형 도면에서 보드 가장자리와 회로 사이 거리가 0.15mm 밖에 되지 않아 라우팅 후 동박이 드러날 수 있습니다. 회로를 0.25mm 안쪽으로 줄이기를 권하는데 동의하시겠습니까?',
    opts: [
      { key: 'A', orig: '同意内缩', ko: '안쪽으로 줄이기에 동의' },
      { key: 'B', orig: '不同意，按原稿制作，接受露铜风险', ko: '동의하지 않음 — 원본대로 제작하고 동박 노출 위험을 수용' },
    ],
  },
  {
    no: '2', type: '表面处理', cat: 'surface_finish',
    orig: '贵司资料要求喷锡，但板上有0.4mm间距BGA，喷锡平整度不够，建议改为沉金，费用不变，是否接受？',
    ko: '자료에는 HASL 로 되어 있으나 보드에 0.4mm 피치 BGA 가 있어 HASL 로는 평탄도가 부족합니다. 비용 변동 없이 무전해 금도금(ENIG)으로 바꾸기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '改为沉金', ko: '무전해 금도금(ENIG)으로 변경' },
      { key: 'B', orig: '仍按喷锡制作', ko: '그대로 HASL 로 제작' },
      { key: 'C', orig: '其他（请注明）', ko: '기타(내용을 적어 주세요)', req: true },
    ],
  },
  {
    no: '3', type: '钻孔', cat: 'drill', figs: 1, attach: '见附图2',
    orig: '钻孔文件中有3个孔与外形重叠（见附图2），是否删除这3个孔？',
    ko: '드릴 파일에서 홀 3개가 외형과 겹칩니다(첨부 그림 2 참고). 이 홀 3개를 삭제할까요?',
    opts: [
      { key: 'A', orig: '删除', ko: '삭제' },
      { key: 'B', orig: '保留，做成半孔', ko: '남겨서 하프홀로 제작' },
    ],
  },
  {
    no: '4', type: '阻焊', cat: 'soldermask',
    orig: '阻焊文件缺少顶层，是否按焊盘单边开窗0.05mm制作？',
    ko: '솔더마스크 파일에 윗면(TOP)이 빠져 있습니다. 패드보다 한쪽 0.05mm 크게 오픈해서 제작할까요?',
    opts: [
      { key: 'A', orig: '同意', ko: '동의' },
      { key: 'B', orig: '贵司重新提供文件', ko: '파일을 다시 제공하겠습니다' },
    ],
  },
  {
    no: '5', type: '叠层', cat: 'stackup', attach: '叠层结构',
    orig: '6层板贵司未提供叠层，我司按常规叠层（见叠层结构）制作，板厚1.6mm，是否接受？',
    ko: '6층 보드인데 적층 구조를 주지 않으셨습니다. 제조사 표준 적층(시트 \'叠层结构\' 참고)으로 보드 두께 1.6mm 로 제작하려는데 수용하시겠습니까?',
    opts: [{ key: 'A', orig: '接受', ko: '수용' }, { key: 'B', orig: '请贵司指示', ko: '직접 지시하겠습니다(의견 작성)', req: true }],
  },
  {
    no: '6', type: '其他', cat: 'other', alt: ['drill'],
    orig: '资料中有两个版本的钻孔文件（V1、V2），请确认使用哪个版本？',
    ko: '자료에 드릴 파일이 두 버전(V1, V2) 있습니다. 어느 버전을 쓸지 확인해 주세요.',
    opts: [
      { key: 'A', orig: '使用V1', ko: 'V1 사용' },
      { key: 'B', orig: '使用V2', ko: 'V2 사용' },
    ],
  },
];

function fixtureB(): Built {
  const main = new GridSheet('工程确认');
  main.set(0, 0, '华强电路 工程问题确认单').merge(0, 0, 0, 7);
  main.set(1, 0, '客户编号：').set(1, 1, 'SPB-B-0921').set(1, 3, '本厂型号：').set(1, 4, 'HQ6L2409-03').set(1, 6, '日期：').set(1, 7, '2026/09/18');
  ['编号', '问题描述', '问题类别', '附图', '选项', '工程建议', '客户回复', '备注'].forEach((h, c) => main.set(3, c, h));
  let r = 4;
  let seed = 11;
  const sheets: GridSheet[] = [main];
  for (const it of B_ITEMS) {
    const n = it.opts.length;
    main.set(r, 0, Number(it.no)).set(r, 1, it.orig).set(r, 2, it.type ?? '').set(r, 3, it.attach ?? '');
    it.opts.forEach((op, k) => main.set(r + k, 4, op.key).set(r + k, 5, op.orig));
    for (const c of [0, 1, 2, 3, 6, 7]) main.merge(r, c, r + n - 1, c);
    if ((it.figs ?? 0) > 0) {
      const name = it.no === '1' ? '附图1' : '附图2';
      sheets.push(new GridSheet(name).set(0, 0, `${name}：`).image(1, 0, makePng(seed++), it.no));
    }
    r += n;
  }
  const stack = new GridSheet('叠层结构');
  [
    ['层', '材料', '厚度(mm)'], ['L1', '铜 1oz', 0.035], ['PP', '2116', 0.12], ['L2', '铜 1oz', 0.035], ['芯板', 'FR-4 TG150', 0.5],
    ['L3', '铜 1oz', 0.035], ['PP', '7628', 0.2], ['L4', '铜 1oz', 0.035], ['芯板', 'FR-4 TG150', 0.5], ['L5', '铜 1oz', 0.035],
    ['PP', '2116', 0.12], ['L6', '铜 1oz', 0.035], ['成品', '', 1.6],
  ].forEach((row, i) => {
    row.forEach((v, c) => stack.set(i, c, v));
  });
  sheets.push(stack);
  return {
    id: 'b-cn-only',
    ext: 'xlsx',
    label: '(b) 중국어 전용 · 열 순서 다름(질문이 유형 앞) · 선택지 줄 수 가변 · 附图 시트 · 참조 시트(叠层结构) · 머리 날짜 텍스트',
    notes: '번역 없이 중국어만 — 영어 단서가 없다. 2번 C(其他请注明)는 의견 필수.',
    header: { customerPartNo: 'SPB-B-0921', factoryPartNo: 'HQ6L2409-03', issuedOn: '2026-09-18' },
    items: B_ITEMS,
    emptySlots: [],
    sheets,
  };
}

// ── (c) 선택지를 한 셀에 'A.接受 B.按原稿' — 두 줄 머리글(중·영) ─────────────────────────

const C_ITEMS: FxItem[] = [
  {
    no: '1', type: '线路 circuit', cat: 'circuit',
    orig: '线路最小线宽/线距3.5/3.5mil，低于我司常规4/4mil，建议局部线宽补偿至4mil，是否接受？The min line width/spacing is 3.5/3.5mil, below our standard 4/4mil, we suggest local compensation to 4mil, OK?',
    ko: '회로 최소 선폭/간격이 3.5/3.5mil 로 제조사 표준 4/4mil 보다 작습니다. 일부 선폭을 4mil 로 보정하기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受补偿（推荐）Accept compensation (recommended)', ko: '보정 수용(권장)', rec: true },
      { key: 'B', orig: '按原稿制作，良率风险由贵司承担 Make as original, yield risk on customer', ko: '원본대로 제작(수율 위험은 저희가 부담합니다)' },
      { key: 'C', orig: '请贵司指示 Pls advise', ko: '직접 지시하겠습니다(의견 작성)', req: true },
    ],
  },
  {
    no: '2', type: '焊盘 pad', cat: 'pad', alt: ['soldermask'],
    orig: 'BGA焊盘直径0.25mm，阻焊开窗与焊盘1:1，建议开窗单边加大0.05mm？BGA pad dia. 0.25mm with 1:1 S/M opening, suggest enlarge opening 0.05mm per side?',
    ko: 'BGA 패드 지름이 0.25mm 이고 솔더마스크 오픈이 패드와 1:1 입니다. 오픈을 한쪽 0.05mm 씩 키우기를 권하는데 어떻게 할까요?',
    opts: [
      { key: 'A', orig: '同意 Agree', ko: '동의' },
      { key: 'B', orig: '不同意 Disagree', ko: '동의하지 않음' },
    ],
  },
  {
    no: '3', type: 'V-CUT', cat: 'panel',
    orig: '拼版V-CUT线距元件仅0.3mm，V-CUT可能伤及元件焊盘，建议改为邮票孔连接，是否接受？V-CUT line is only 0.3mm from components, suggest change to stamp holes, OK?',
    ko: '패널의 V컷 선과 부품의 간격이 0.3mm 밖에 되지 않아 V컷이 부품 패드를 손상시킬 수 있습니다. 스탬프 홀 연결로 바꾸기를 권하는데 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '改为邮票孔 Change to stamp holes', ko: '스탬프 홀로 변경' },
      { key: 'B', orig: '保持V-CUT Keep V-CUT', ko: 'V컷 유지' },
    ],
  },
  {
    no: '4', type: '标注 indication', cat: 'indication', alt: ['material'],
    orig: '图纸标注板厚1.6mm，但Gerber说明为1.0mm，请确认以哪个为准？Drawing says 1.6mm thickness but Gerber note says 1.0mm, which one is correct?',
    ko: '도면에는 보드 두께가 1.6mm 로 표기되어 있으나 거버 설명에는 1.0mm 로 되어 있습니다. 어느 쪽을 기준으로 할까요?',
    opts: [
      { key: 'A', orig: '1.6mm', ko: '1.6mm' },
      { key: 'B', orig: '1.0mm', ko: '1.0mm' },
    ],
  },
  {
    no: '5', type: '其他 other', cat: 'other',
    orig: '贵司未提供钢网文件，是否需要我司制作钢网？You did not provide stencil file, do you need us to make the stencil?',
    ko: '메탈마스크(스텐실) 파일을 주지 않으셨습니다. 제조사에서 메탈마스크를 제작할까요?',
    opts: [
      { key: 'A', orig: '需要 Yes', ko: '필요(제작)' },
      { key: 'B', orig: '不需要 No', ko: '필요 없음' },
    ],
  },
];

function fixtureC(): Built {
  const main = new GridSheet('EQ');
  main.set(0, 0, 'Customer P/N: CP-7781-R2');
  main.set(1, 0, 'Factory P/N: JX-2409-118').set(1, 3, 'Date: 2026-09-20');
  ['序号', '问题类型', '问题描述', '建议方案', '客户选择', '客户备注'].forEach((h, c) => main.set(3, c, h));
  ['No.', 'Type', 'Description', 'Suggestion', 'Customer Choice', 'Remarks'].forEach((h, c) => main.set(4, c, h));
  C_ITEMS.forEach((it, i) => {
    const r = 5 + i;
    // 2번은 같은 줄 공백 구분('A、… B、…'), 4번은 '.'+공백, 나머지는 줄바꿈 구분.
    const optText =
      it.no === '2'
        ? it.opts.map((o) => `${o.key}、${o.orig}`).join('  ')
        : it.no === '4'
          ? it.opts.map((o) => `${o.key}.${o.orig}`).join(' ')
          : it.opts.map((o) => `${o.key}.${o.orig}`).join('\n');
    main.set(r, 0, Number(it.no)).set(r, 1, it.type ?? '').set(r, 2, it.orig).set(r, 3, optText);
  });
  return {
    id: 'c-inline-options',
    ext: 'xlsx',
    label: '(c) 선택지 한 셀(A.… ⏎ B.… / A、… B、…) · 두 줄 머리글(중+영) · 머리 정보 "라벨: 값" 한 셀 · 권장 표시(推荐) 1건',
    notes: '1번 A 만 recommended=true(원문에 推荐/recommended). 그림 없음.',
    header: { customerPartNo: 'CP-7781-R2', factoryPartNo: 'JX-2409-118', issuedOn: '2026-09-20' },
    items: C_ITEMS,
    emptySlots: [],
    sheets: [main],
  };
}

// ── (d) 그림을 메인 시트 질문 행 옆에 앵커 · 선택지가 열마다(方案A|方案B) ─────────────────────

const D_ITEMS: FxItem[] = [
  {
    no: '1', type: '孔 Hole', cat: 'drill', figs: 1,
    orig: 'NPTH孔径3.0mm与周围铜皮距离仅0.1mm，建议铜皮避让0.3mm。NPTH hole 3.0mm is only 0.1mm from copper, suggest to clear copper 0.3mm.',
    ko: '홀 크기 3.0mm 인 무도금 홀(NPTH)이 주변 동박과 0.1mm 밖에 떨어져 있지 않습니다. 동박을 0.3mm 이격시키기를 권합니다.',
    opts: [
      { key: 'A', orig: '同意避让 Agree to clear copper', ko: '동박 이격에 동의' },
      { key: 'B', orig: '保持原样 Keep as is', ko: '원래대로 유지' },
    ],
  },
  {
    no: '2', type: '半孔 Half hole', cat: 'drill', alt: ['outline'], figs: 2,
    orig: '板边半孔直径0.6mm，最小能力0.5mm可做，但半孔需要额外加收工程费，是否继续？Castellated holes 0.6mm on board edge are OK, but extra charge applies, continue?',
    ko: '보드 가장자리 하프홀 지름 0.6mm 는 제작 가능(최소 0.5mm)하지만 하프홀은 추가 공정비가 붙습니다. 계속 진행할까요?',
    opts: [
      { key: 'A', orig: '继续制作 Continue', ko: '계속 제작' },
      { key: 'B', orig: '取消半孔 Cancel castellated holes', ko: '하프홀 취소' },
    ],
  },
  {
    no: '3', type: '阻焊 Solder mask', cat: 'soldermask',
    orig: '阻焊颜色资料为哑光黑，交期需增加2天，是否接受？Matte black solder mask needs 2 more days lead time, OK?',
    ko: '솔더마스크 색상이 무광 검정으로 되어 있어 납기가 2일 늘어납니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '改为亮光绿 Change to glossy green', ko: '유광 녹색으로 변경' },
    ],
  },
  {
    no: '4', type: '金手指 Gold finger', cat: 'surface_finish', alt: ['outline', 'pad'], figs: 1,
    orig: '金手指需要斜边30°，资料未注明斜边深度，我司按常规1.0mm制作？Gold fingers need 30° bevel, depth not specified, we will make 1.0mm as default?',
    ko: '골드 핑거에 30° 베벨이 필요한데 자료에 베벨 깊이가 없습니다. 제조사 표준인 1.0mm 로 제작할까요?',
    opts: [
      { key: 'A', orig: '按常规 Default 1.0mm', ko: '표준대로(1.0mm)' },
      { key: 'B', orig: '请贵司指示 Pls advise', ko: '직접 지시하겠습니다(의견 작성)', req: true },
    ],
  },
];

function fixtureD(): Built {
  const main = new GridSheet('EQ List');
  main.set(0, 1, 'ROCKET PCB Engineering Question 工程问客').merge(0, 1, 0, 6);
  main.image(0, 0, makePng(77, 60, 40), null); // 공장 로고(무관)
  main.set(1, 1, 'Customer P/N').set(1, 2, 'SPB-D-3304').set(1, 4, 'Our P/N').set(1, 5, 'RK2410-0042');
  main.set(2, 1, 'Date').set(2, 2, { date: '2026-10-02' });
  ['Item', '问题类型 Category', '问题描述 Description', '图片 Picture', '方案A Option A', '方案B Option B', '客户回复 Reply'].forEach((h, c) => main.set(4, c, h));
  let seed = 31;
  D_ITEMS.forEach((it, i) => {
    const r = 5 + i * 2;
    main.set(r, 0, Number(it.no)).set(r, 1, it.type ?? '').set(r, 2, it.orig);
    it.opts.forEach((op, k) => main.set(r, 4 + k, op.orig));
    for (const c of [0, 1, 2, 4, 5, 6]) main.merge(r, c, r + 1, c);
    for (let k = 0; k < (it.figs ?? 0); k += 1) main.image(r + k, 3, makePng(seed++), it.no);
  });
  return {
    id: 'd-inline-figures',
    ext: 'xlsx',
    label: '(d) 그림이 메인 시트 질문 행 옆(D열)에 앵커 · 선택지가 열마다(方案A|方案B) · 로고 A1',
    notes: '그림 시트가 없다 — 행 위치로 문항을 정해야 한다. 2번은 그림 2장(두 행에 걸침). 로고는 무관.',
    header: { customerPartNo: 'SPB-D-3304', factoryPartNo: 'RK2410-0042', issuedOn: '2026-10-02' },
    items: D_ITEMS,
    emptySlots: [],
    sheets: [main],
  };
}

// ── (g) 영어 전용 ──────────────────────────────────────────────────────────────

const G_ITEMS: FxItem[] = [
  {
    no: 'EQ-01', type: 'Solder Mask', cat: 'soldermask_dam', alt: ['soldermask'],
    orig: 'Solder mask dams between U5 pins are 0.06mm, below our minimum 0.08mm. We propose gang relief (one opening for the whole row).',
    ko: 'U5 핀 사이 솔더마스크 댐이 0.06mm 로 제조사 최소치 0.08mm 보다 작습니다. 한 줄 전체를 하나로 오픈(통 오픈)하기를 제안합니다.',
    opts: [
      { key: '1', orig: 'Accept gang relief', ko: '통 오픈 수용' },
      { key: '2', orig: 'Keep individual dams and accept bridging risk', ko: '개별 댐을 유지하고 브리지 위험을 수용' },
    ],
  },
  {
    no: 'EQ-02', type: 'Drilling', cat: 'drill',
    orig: 'Drill file contains 0.15mm holes; our minimum mechanical drill is 0.2mm. Please choose:',
    ko: '드릴 파일에 0.15mm 홀이 있는데 제조사 기계 드릴 최소치는 0.2mm 입니다. 선택해 주세요.',
    opts: [
      { key: '1', orig: 'Enlarge to 0.2mm', ko: '0.2mm 로 확대' },
      { key: '2', orig: 'Use laser drilling (extra cost)', ko: '레이저 드릴 사용(추가 비용)' },
      { key: '3', orig: 'Other, please specify', ko: '기타(내용을 적어 주세요)', req: true },
    ],
  },
  {
    no: 'EQ-03', type: 'Stack-up', cat: 'stackup', figs: 1,
    orig: 'No stack-up was provided for this 4-layer 1.6mm board. We will use our standard stack-up (see Fig.1).',
    ko: '4층 1.6mm 보드인데 적층 구조를 받지 못했습니다. 제조사 표준 적층 구조(그림 1 참고)를 적용하겠습니다.',
    opts: [
      { key: '1', orig: 'Accept standard stack-up', ko: '표준 적층 구조 수용' },
      { key: '2', orig: 'Customer will provide stack-up', ko: '적층 구조를 제공하겠습니다' },
    ],
  },
  {
    no: 'EQ-04', type: 'Marking', cat: 'marking', alt: ['legend'],
    orig: 'Do you allow us to add UL mark, date code (WWYY) and our logo on the bottom silkscreen?',
    ko: '뒷면 실크에 UL 마크, 주기(WWYY), 제조사 로고를 넣어도 될까요?',
    opts: [
      { key: '1', orig: 'Yes, add all', ko: '예, 모두 추가' },
      { key: '2', orig: 'Add UL mark and date code only', ko: 'UL 마크와 주기만 추가' },
      { key: '3', orig: 'No marking', ko: '마킹 없음' },
    ],
  },
  {
    no: 'EQ-05', type: 'Panel', cat: 'panel', figs: 1,
    orig: 'Panel drawing shows 3x4 array, but the breakaway rails are not defined. We propose 5mm rails on two long sides with 3 fiducials and 4 tooling holes (Fig.2).',
    ko: '패널 도면은 3x4 배열인데 분리 레일이 정의되어 있지 않습니다. 긴 두 변에 5mm 레일과 피듀셜 3개, 툴링 홀 4개를 두기를 제안합니다(그림 2).',
    opts: [
      { key: '1', orig: 'Accept', ko: '수용' },
      { key: '2', orig: 'Please advise', ko: '직접 지시하겠습니다(의견 작성)', req: true },
    ],
  },
];

function fixtureG(): Built {
  const main = new GridSheet('Engineering Query');
  main.set(0, 0, 'ENGINEERING QUERY (EQ)').merge(0, 0, 0, 5);
  main.set(1, 0, 'Customer Part No.:').set(1, 1, 'SPB-G-5521').set(1, 3, 'Our Job No.:').set(1, 4, 'EB-26-0937');
  main.set(2, 0, 'Issue Date:').set(2, 1, '2026-09-25');
  ['EQ No.', 'Category', 'Query', 'Proposal', 'Customer Decision', 'Customer Comments'].forEach((h, c) => main.set(4, c, h));
  const sheets: GridSheet[] = [main];
  let r = 5;
  let fig = 1;
  for (const it of G_ITEMS) {
    const n = it.opts.length;
    main.set(r, 0, it.no).set(r, 1, it.type ?? '').set(r, 2, it.orig);
    it.opts.forEach((op, k) => main.set(r + k, 3, `Option ${op.key}: ${op.orig}`));
    for (const c of [0, 1, 2, 4, 5]) main.merge(r, c, r + n - 1, c);
    if ((it.figs ?? 0) > 0) {
      sheets.push(new GridSheet(`Fig${String(fig)}`).set(0, 0, `Fig.${String(fig)}`).image(1, 0, makePng(50 + fig), it.no));
      fig += 1;
    }
    r += n;
  }
  return {
    id: 'g-english-only',
    ext: 'xlsx',
    label: '(g) 영어 전용 · 번호 EQ-01 · 선택지 기호 숫자("Option 1: …") · 그림 시트 Fig1/Fig2(질문 본문이 Fig.N 으로 부름)',
    notes: '선택지 key 는 "1","2","3"(원문 기호 그대로) — A/B 로 바꾸면 오답. 첨부 칸이 없어 그림은 본문 Fig.N 으로 잇는다.',
    header: { customerPartNo: 'SPB-G-5521', factoryPartNo: 'EB-26-0937', issuedOn: '2026-09-25' },
    items: G_ITEMS,
    emptySlots: [],
    sheets,
  };
}

// ── (i) 지저분한 양식 — 두 줄 병합 머리글·빈 줄·빈 슬롯·빈 선택지·자리표시 '/'·꼬리 비고 ────────

const I_ITEMS: FxItem[] = [
  {
    no: '1', type: '阻焊 soldermask', cat: 'soldermask_dam', alt: ['soldermask'],
    orig: '绿油桥：0805封装焊盘间距过小，阻焊桥无法保留，按开通窗制作，请知悉。S/M bridge between 0805 pads cannot be kept, we will open them together, pls note.',
    ko: '솔더마스크 댐(绿油桥): 0805 패키지 패드 간격이 너무 좁아 솔더마스크 댐을 남길 수 없으므로 통 오픈으로 제작하겠습니다. 참고해 주세요.',
    opts: [
      { key: 'A', orig: '知悉接受 Noted & accept', ko: '확인·수용' },
      { key: 'C', orig: '请贵司指示 Pls advise', ko: '직접 지시하겠습니다(의견 작성)', req: true },
    ],
  },
  {
    no: '4', type: '钻孔 drill', cat: 'drill',
    orig: '钻孔图与钻孔文件孔数不符（图纸126个，文件124个），以钻孔文件为准？Hole count mismatch (drawing 126 vs drill file 124), follow drill file?',
    ko: '드릴 도면과 드릴 파일의 홀 수가 다릅니다(도면 126개, 파일 124개). 드릴 파일 기준으로 할까요?',
    opts: [
      { key: 'A', orig: '以钻孔文件为准 Follow drill file', ko: '드릴 파일 기준' },
      { key: 'B', orig: '以钻孔图为准 Follow drawing', ko: '드릴 도면 기준' },
      { key: 'C', orig: '请贵司指示 Pls advise', ko: '직접 지시하겠습니다(의견 작성)', req: true },
    ],
  },
  {
    no: '7', cat: 'impedance',
    orig: '贵司要求阻抗控制但未提供阻抗线位置，请标示需控阻抗的线路或确认不做阻抗。Impedance control required but no impedance traces indicated, please mark them or confirm no impedance control.',
    ko: '임피던스 제어를 요구하셨으나 임피던스 대상 선로 위치가 없습니다. 임피던스를 제어할 회로를 표시해 주시거나, 임피던스 제어를 하지 않는 것으로 확인해 주세요.',
    opts: [
      { key: 'A', orig: '我司补充资料 We will provide', ko: '자료를 보완해 제공하겠습니다' },
      { key: 'B', orig: '不做阻抗控制 No impedance control', ko: '임피던스 제어 안 함' },
    ],
  },
];

function fixtureI(): Built {
  const main = new GridSheet('Sheet1');
  main.set(0, 0, '恒达多层线路板 工程确认(EQ)').merge(0, 0, 1, 9);
  main.set(2, 0, '客户料号 Customer P/N：SPB-I-0610').merge(2, 0, 2, 3);
  main.set(2, 4, '我司型号：HD-10L-2409-6').merge(2, 4, 2, 7);
  main.image(0, 9, makePng(88, 80, 80), null); // 도장(무관)
  // 두 줄 병합 머리글
  main.set(4, 0, '序号 No.').merge(4, 0, 5, 0);
  main.set(4, 1, '日期 Date').merge(4, 1, 5, 1);
  main.set(4, 2, '问题 Problem').merge(4, 2, 4, 3);
  main.set(5, 2, '类型 Type').set(5, 3, '描述 Description');
  main.set(4, 4, '建议 Suggestion').merge(4, 4, 4, 5);
  main.set(5, 4, '选项 Opt').set(5, 5, '内容 Content');
  main.set(4, 6, '客户答复 Customer reply').merge(4, 6, 4, 7);
  main.set(5, 6, '选择 Choice').set(5, 7, '备注 Remark');
  let r = 6;
  for (let slot = 1; slot <= 12; slot += 1) {
    const no = String(slot);
    const it = I_ITEMS.find((x) => x.no === no);
    main.set(r, 0, slot);
    if (slot === 2) main.set(r, 2, '钻孔 drill'); // 유형만 있고 질문 없음 → 빈 슬롯
    if (slot === 5) main.set(r, 3, '/'); // 자리표시 → 빈 슬롯
    if (it !== undefined) {
      main.set(r, 1, { date: '2026-09-10' }).set(r, 2, it.type ?? '').set(r, 3, it.orig);
      if (slot === 4) main.set(r + 2, 8, '已核对');
    }
    const rows = slot === 7 ? 4 : 3; // 7번은 선택지 칸이 4줄(마지막 둘은 빈)
    ['A', 'B', 'C', 'D'].slice(0, rows).forEach((key, k) => {
      main.set(r + k, 4, key);
      const op = it?.opts.find((o) => o.key === key);
      if (op !== undefined) main.set(r + k, 5, op.orig);
    });
    for (const c of [0, 1, 2, 3, 6, 7]) main.merge(r, c, r + rows - 1, c);
    r += rows + (slot % 3 === 0 ? 1 : 0); // 세 슬롯마다 빈 줄
  }
  main.set(r + 1, 0, '备注：请于24小时内回复，否则按我司建议制作。Note: pls reply within 24h, otherwise we will follow our suggestion.').merge(r + 1, 0, r + 1, 7);
  return {
    id: 'i-messy',
    ext: 'xlsx',
    label: '(i) 지저분한 양식 — 두 줄 병합 머리글 · 슬롯 12 중 실질 3 · 유형만 있는 슬롯 · "/" 자리표시 · 빈 선택지(B 빈칸→A·C) · 빈 줄 · 꼬리 비고 · 무관 도장 그림',
    notes: '1번은 B 가 비어 A·C 만 — 기호를 A·B 로 다시 매기면 오답. 7번은 유형 칸이 비어 본문으로 유형을 정한다. 꼬리 비고는 문항이 아니다.',
    header: { customerPartNo: 'SPB-I-0610', factoryPartNo: 'HD-10L-2409-6', issuedOn: '2026-09-10' },
    items: I_ITEMS,
    emptySlots: ['2', '3', '5', '6', '8', '9', '10', '11', '12'],
    sheets: [main],
  };
}

// ── 홀드아웃(k·l·m) — 템플릿 파서 v1 을 고정한 **뒤에** 작성했다. 파서를 이 양식에 맞춰 고치지 않는다
//    (a~j 는 파서와 함께 만들어져 파서에 유리하다 — 보고서가 둘을 나눠 적는다). ─────────────────────

const K_ITEMS: FxItem[] = [
  {
    no: '1', type: '阻焊', cat: 'soldermask',
    orig: 'BGA区域阻焊开窗单边仅0.025mm，生产无法保证对位，建议开窗单边加大至0.05mm。',
    ko: 'BGA 영역의 솔더마스크 오픈이 한쪽 0.025mm 밖에 되지 않아 생산 시 정합을 보장할 수 없습니다. 오픈을 한쪽 0.05mm 로 키우기를 권합니다.',
    opts: [
      { key: 'A', orig: '同意加大开窗', ko: '오픈 확대에 동의' },
      { key: 'B', orig: '按原稿制作，接受阻焊上焊盘风险', ko: '원본대로 제작하고 솔더마스크가 패드에 올라오는 위험을 수용' },
    ],
  },
  {
    no: '2', type: '钻孔', cat: 'drill', alt: ['via'],
    orig: '孔径0.3mm的过孔共2865个，孔密度较高，建议部分过孔改为0.35mm以提高良率。',
    ko: '홀 크기 0.3mm 비아가 2,865개로 홀 밀도가 높습니다. 수율을 높이려면 일부 비아를 0.35mm 로 바꾸기를 권합니다.',
    opts: [
      { key: 'A', orig: '同意', ko: '동의' },
      { key: 'B', orig: '不同意', ko: '동의하지 않음' },
      { key: 'C', orig: '其他：____', ko: '기타(내용을 적어 주세요)', req: true },
    ],
  },
  {
    no: '3', type: '外形', cat: 'outline', figs: 1,
    orig: '外形公差贵司要求±0.05mm，我司CNC能力为±0.1mm，是否接受±0.1mm？',
    ko: '외형 공차를 ±0.05mm 로 요구하셨으나 제조사 CNC 능력은 ±0.1mm 입니다. ±0.1mm 를 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受±0.1mm', ko: '±0.1mm 수용' },
      { key: 'B', orig: '要求±0.05mm（需改冲模，费用另计）', ko: '±0.05mm 요구(금형 변경 필요, 비용 별도)' },
    ],
  },
  {
    no: '4', type: '标记', cat: 'marking', alt: ['legend'],
    orig: '是否需要在板上丝印我司LOGO及生产周期（如2441）？',
    ko: '보드에 제조사 로고와 생산 주기(예: 2441)를 실크로 넣을까요?',
    opts: [
      { key: 'A', orig: '需要', ko: '넣음' },
      { key: 'B', orig: '不需要', ko: '넣지 않음' },
      { key: 'C', orig: '只加周期', ko: '주기만 넣음' },
    ],
  },
];

function fixtureK(): Built {
  const main = new GridSheet('EQ确认');
  main.set(0, 0, '工程确认单 Engineering Confirmation').merge(0, 0, 0, 5);
  main.set(1, 0, '客户型号: SPB-K-1187').set(1, 2, '厂内编号: TS-2410-0315').set(1, 4, '发出日期: 2026-10-05');
  let r = 3;
  let seed = 61;
  for (const it of K_ITEMS) {
    main.set(r, 0, `【问题${it.no}】 类别：${it.type ?? ''}`);
    main.set(r + 1, 0, `问题：${it.orig}`).merge(r + 1, 0, r + 1, 4);
    main.set(r + 2, 0, `建议：${it.opts.map((o) => `${o.key}. ${o.orig}`).join('   ')}`).merge(r + 2, 0, r + 2, 4);
    main.set(r + 3, 0, '客户回复：');
    if ((it.figs ?? 0) > 0) main.image(r + 1, 5, makePng(seed++), it.no);
    r += 5;
  }
  return {
    id: 'k-vertical-cards',
    ext: 'xlsx',
    label: '(k·홀드아웃) 머리글 표가 없는 세로 카드형 — 【问题N】/问题：/建议：A. … B. … 가 한 셀씩 · 그림은 카드 옆',
    notes: 'questionOrig 는 "问题：" 뒤 본문(라벨 제외)을 정답으로 친다(유사도 채점). 템플릿 파서 v1 은 머리글이 없어 실패가 정상.',
    header: { customerPartNo: 'SPB-K-1187', factoryPartNo: 'TS-2410-0315', issuedOn: '2026-10-05' },
    items: K_ITEMS,
    emptySlots: [],
    sheets: [main],
  };
}

const L_ITEMS: FxItem[] = [
  {
    no: 'Q1', type: '防焊', cat: 'soldermask',
    orig: '防焊顏色要求為藍色，本廠藍色防焊需加2天製程，是否同意交期延後？',
    ko: '솔더마스크 색상을 파란색으로 요구하셨는데 제조사는 파란색 솔더마스크에 공정이 2일 더 걸립니다. 납기 연장에 동의하시겠습니까?',
    opts: [
      { key: 'A', orig: '同意延後', ko: '납기 연장에 동의' },
      { key: 'B', orig: '改為綠色防焊，交期不變', ko: '녹색 솔더마스크로 변경(납기 유지)' },
    ],
  },
  {
    no: 'Q2', type: '鑽孔', cat: 'drill',
    orig: '鑽孔檔與鑽孔圖孔徑不符（0.8mm vs 0.9mm），請確認以何者為準？',
    ko: '드릴 파일과 드릴 도면의 홀 크기가 다릅니다(0.8mm 대 0.9mm). 어느 쪽을 기준으로 할까요?',
    opts: [
      { key: 'A', orig: '依鑽孔檔 0.8mm', ko: '드릴 파일 기준 0.8mm' },
      { key: 'B', orig: '依鑽孔圖 0.9mm', ko: '드릴 도면 기준 0.9mm' },
    ],
  },
  {
    no: 'Q3', type: '成型', cat: 'outline',
    orig: '板邊有內凹圓角R0.2mm，銑刀最小R0.4mm，是否同意修改為R0.4mm？',
    ko: '보드 가장자리에 R0.2mm 안쪽 라운드가 있는데 라우터 비트 최소치는 R0.4mm 입니다. R0.4mm 로 바꾸는 데 동의하시겠습니까?',
    opts: [
      { key: 'A', orig: '同意', ko: '동의' },
      { key: 'B', orig: '不同意，請另行告知', ko: '동의하지 않음(따로 알려 주세요)', req: true },
    ],
  },
  {
    no: 'Q4', type: '文字', cat: 'legend', figs: 1,
    orig: '文字面有一處反字（見圖一），是否需要修正為正字？',
    ko: '실크 면에 반전 문자가 한 곳 있습니다(그림 1 참고). 정방향 문자로 고칠까요?',
    opts: [
      { key: 'A', orig: '修正', ko: '수정' },
      { key: 'B', orig: '依原稿', ko: '원본대로' },
    ],
  },
];

function fixtureL(): Built {
  const main = new GridSheet('工程確認單');
  main.set(0, 0, '台灣精密電路 工程確認單').merge(0, 0, 0, 4);
  main.set(1, 0, '客戶料號：SPB-L-0427').set(1, 2, '本廠料號：TW-2410-1168').set(1, 4, '日期：2026/10/07');
  ['項次', '問題類別', '問題說明', '本廠建議（請勾選）', '客戶確認'].forEach((h, c) => main.set(3, c, h));
  const sheets: GridSheet[] = [main];
  L_ITEMS.forEach((it, i) => {
    const r = 4 + i;
    main.set(r, 0, it.no).set(r, 1, it.type ?? '').set(r, 2, it.orig).set(r, 3, it.opts.map((o) => `□ ${o.orig}`).join('\n'));
    if ((it.figs ?? 0) > 0) sheets.push(new GridSheet('圖一').image(0, 0, makePng(71), it.no));
  });
  return {
    id: 'l-traditional-checkbox',
    ext: 'xlsx',
    label: '(l·홀드아웃) 대만 번체 전용 · 선택지가 체크박스(□ …)라 기호 없음 · 번호 Q1 · 그림 시트 "圖一"(한자 숫자, 본문 見圖一)',
    notes: '원문에 기호가 없으므로 규칙상 key 는 A·B 순. 번체 머리글(項次/問題說明)은 템플릿 v1 사전에 없다.',
    header: { customerPartNo: 'SPB-L-0427', factoryPartNo: 'TW-2410-1168', issuedOn: '2026-10-07' },
    items: L_ITEMS,
    emptySlots: [],
    sheets,
  };
}

const M_ITEMS: FxItem[] = [
  {
    no: '1', type: 'Impedance', cat: 'impedance', figs: 1,
    orig: '阻抗线经过分割平面（见图），无法保证阻抗连续，建议补铜或改走线。The impedance trace crosses a split plane (see picture), we can not guarantee impedance continuity; suggest adding copper or rerouting.',
    ko: '임피던스 선로가 분할된 플레인을 가로지릅니다(그림 참고). 임피던스 연속성을 보장할 수 없어 동박 보강 또는 배선 변경을 권합니다.',
    opts: [
      { key: 'A', orig: '同意补铜 Agree to add copper', ko: '동박 보강에 동의' },
      { key: 'B', orig: '贵司修改设计 Customer will modify design', ko: '설계를 수정하겠습니다' },
      { key: 'C', orig: '接受阻抗偏差 Accept impedance deviation', ko: '임피던스 편차 수용' },
    ],
  },
  {
    no: '2', type: 'Via', cat: 'via', alt: ['drill'], figs: 1,
    orig: '盲孔L1-L2孔径0.1mm，需激光钻孔，费用增加约15%，是否接受？Blind via L1-L2 0.1mm needs laser drilling, about 15% extra cost, OK?',
    ko: 'L1-L2 블라인드 비아의 홀 크기가 0.1mm 라 레이저 드릴이 필요하며 비용이 약 15% 늘어납니다. 수용하시겠습니까?',
    opts: [
      { key: 'A', orig: '接受 Accept', ko: '수용' },
      { key: 'B', orig: '改为通孔 Change to through holes', ko: '관통 홀로 변경' },
    ],
  },
  {
    no: '3', type: 'Copper', cat: 'material', alt: ['stackup'],
    orig: '内层铜厚资料为2oz，但叠层图为1oz，以哪个为准？Inner copper 2oz in notes but 1oz in stackup drawing, which one?',
    ko: '내층 동박 두께가 설명에는 2oz, 적층 구조도에는 1oz 로 되어 있습니다. 어느 쪽을 기준으로 할까요?',
    opts: [
      { key: 'A', orig: '2oz', ko: '2oz' },
      { key: 'B', orig: '1oz', ko: '1oz' },
    ],
  },
];

function fixtureM(): Built {
  const index = new GridSheet('目录 Index');
  index.set(0, 0, 'MINGXIN PCB  EQ 工程问客').merge(0, 0, 0, 3);
  index.set(1, 0, 'Customer P/N: SPB-M-0902').set(1, 2, 'Factory P/N: MX-6L-0902');
  index.set(2, 0, 'Date: 2026-10-09');
  ['No.', 'Item', 'Sheet', 'Status'].forEach((h, c) => index.set(4, c, h));
  const sheets: GridSheet[] = [index];
  let seed = 81;
  M_ITEMS.forEach((it, i) => {
    index.set(5 + i, 0, Number(it.no)).set(5 + i, 1, it.type ?? '').set(5 + i, 2, `EQ${it.no}`).set(5 + i, 3, 'Open');
    const s = new GridSheet(`EQ${it.no}`);
    s.set(0, 0, `EQ${it.no} — ${it.type ?? ''}`);
    s.set(1, 0, '问题描述 Description:').set(1, 1, it.orig).merge(1, 1, 1, 6);
    if ((it.figs ?? 0) > 0) s.set(2, 0, '图片 Picture:').image(2, 1, makePng(seed++), it.no);
    s.set(8, 0, '建议 Proposal:');
    it.opts.forEach((o, k) => s.set(8 + k, 1, `${o.key}. ${o.orig}`));
    s.set(12, 0, '客户选择 Customer choice:');
    sheets.push(s);
  });
  return {
    id: 'm-sheet-per-item',
    ext: 'xlsx',
    label: '(m·홀드아웃) 목차 시트 + 문항마다 시트 하나(EQ1·EQ2·EQ3) — 질문·그림·선택지가 각 시트에',
    notes: '번호는 목차의 No.(1·2·3)를 정답으로 친다("EQ1" 이면 원문 유사도로 짝짓는다). 메인 시트가 목차라 문항 시트를 "보조 시트" 로 잘라 읽으면 놓친다.',
    header: { customerPartNo: 'SPB-M-0902', factoryPartNo: 'MX-6L-0902', issuedOn: '2026-10-09' },
    items: M_ITEMS,
    emptySlots: [],
    sheets,
  };
}

// ── (n·난도) 1단 포화(구조 98~100) 뒤 리드 지시로 추가 — 23문항·질문이 중/영 두 칸·선택지 한 셀 중영 혼용(구분자
//    제각각)·빈 슬롯이 실문항 사이에·하위 번호(12.1)·구획 줄·병합 엉킴·메인 시트 앵커 그림+그림 시트 혼합. 템플릿 v1 고정 뒤 작성.

interface NItem {
  no: string;
  type: string;
  cat: Cat;
  alt?: Cat[];
  cn: string;
  en: string;
  ko: string;
  /** [기호, 중국어, 영어, 한국어, 표시] — 표시 r=권장·c=의견필수. */
  opts: [string, string, string, string, ('r' | 'c')?][];
  sep: 'colon' | 'paren' | 'wrap' | 'dash';
  rows?: number;
  fig?: 'main' | 'sheet';
}

const N_ITEMS: NItem[] = [
  { no: '1', type: '阻抗 Impedance', cat: 'impedance', sep: 'colon', cn: '差分阻抗90Ω±10%，按叠层计算线宽0.11mm/间距0.15mm，是否接受？', en: '90ohm diff impedance needs 0.11/0.15mm width/space per stackup, OK?', ko: '차동 임피던스 90Ω±10% 를 맞추려면 적층 구조 계산상 선폭 0.11mm/간격 0.15mm 가 필요합니다. 수용하시겠습니까?', opts: [['A', '接受', 'Accept', '수용'], ['B', '其他，请注明', 'Other, pls specify', '기타(내용을 적어 주세요)', 'c']] },
  { no: '2', type: '钻孔 Drill', cat: 'drill', sep: 'paren', cn: '最小钻孔0.15mm超出机械钻能力，改为0.2mm？', en: 'Min drill 0.15mm exceeds mechanical capability, change to 0.2mm?', ko: '최소 드릴 0.15mm 는 기계 드릴 능력을 넘습니다. 0.2mm 로 바꿀까요?', opts: [['A', '改为0.2mm', 'Change to 0.2mm', '0.2mm 로 변경'], ['B', '激光钻孔（加价）', 'Laser drill (extra cost)', '레이저 드릴(추가 비용)']] },
  { no: '3', type: '过孔 Via', cat: 'via', sep: 'wrap', rows: 2, cn: '过孔塞孔方式未注明，按阻焊塞孔制作？', en: 'Via plugging not specified, plug with solder mask?', ko: '비아 홀 메움 방식이 지정되어 있지 않습니다. 솔더마스크 잉크로 홀 메움 할까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '树脂塞孔', 'Resin plug', '레진 홀 메움'], ['C', '不塞孔', 'No plug', '홀 메움 안 함']] },
  { no: '5', type: '阻焊桥 S/M dam', cat: 'soldermask_dam', sep: 'colon', cn: 'IC脚间阻焊桥0.06mm无法保留，开通窗？', en: 'S/M dam 0.06mm between IC pins can not be kept, gang opening?', ko: 'IC 핀 사이 솔더마스크 댐 0.06mm 는 남길 수 없습니다. 통 오픈으로 할까요?', opts: [['A', '接受（建议）', 'Accept (recommended)', '수용(권장)', 'r'], ['B', '请贵司指示', 'Pls advise', '직접 지시하겠습니다(의견 작성)', 'c']] },
  { no: '6', type: '字符 Legend', cat: 'legend', sep: 'dash', cn: '字符上焊盘，削字符处理？', en: 'Legend on pads, clip the legend?', ko: '실크가 패드 위에 올라가 있습니다. 실크를 깎아낼까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '不同意', 'Disagree', '동의하지 않음']] },
  { no: '7', type: '焊盘 Pad', cat: 'pad', sep: 'colon', cn: 'BGA焊盘0.25mm偏小，补偿至0.28mm？', en: 'BGA pad 0.25mm is small, compensate to 0.28mm?', ko: 'BGA 패드 0.25mm 가 작습니다. 0.28mm 로 보정할까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '按原稿', 'As original', '원본대로']] },
  { no: '8', type: '外形 Outline', cat: 'outline', sep: 'colon', rows: 2, cn: '外形图无公差，按±0.15mm制作？', en: 'No tolerance on outline drawing, use ±0.15mm?', ko: '외형 도면에 공차가 없습니다. ±0.15mm 로 제작할까요?', opts: [['A', '接受', 'Accept', '수용'], ['B', '其他，请注明', 'Other, pls specify', '기타(내용을 적어 주세요)', 'c']] },
  { no: '10', type: '拼版 Panel', cat: 'panel', sep: 'paren', cn: '拼版尺寸超出我司最大尺寸，改为1x2拼版？', en: 'Panel size exceeds our max, change to 1x2 array?', ko: '패널 크기가 제조사 최대 크기를 넘습니다. 1x2 패널로 바꿀까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '单片', 'Single pcs', '낱개']] },
  { no: '11', type: '表面处理 Finish', cat: 'surface_finish', sep: 'colon', cn: '金手指与沉金同板，需电金+沉金两道工序，交期+2天？', en: 'Gold finger + ENIG on same board needs 2 processes, +2 days?', ko: '골드 핑거와 무전해 금도금(ENIG)이 한 보드에 있어 전해 금도금과 ENIG 두 공정이 필요하고 납기가 2일 늘어납니다. 수용하시겠습니까?', opts: [['A', '接受', 'Accept', '수용'], ['B', '全部沉金', 'All ENIG', '전부 ENIG']] },
  { no: '12.1', type: '材料 Material', cat: 'material', sep: 'colon', cn: '板材TG150无库存，改用TG170（价格不变）？', en: 'TG150 out of stock, use TG170 at same price?', ko: 'TG150 원자재 재고가 없습니다. 같은 가격에 TG170 으로 바꿀까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '等TG150', 'Wait for TG150', 'TG150 입고까지 대기']] },
  { no: '12.2', type: '材料 Material', cat: 'material', alt: ['stackup'], sep: 'colon', cn: '铜厚1oz与叠层图2oz不符，以哪个为准？', en: 'Copper 1oz vs stackup 2oz, which one?', ko: '동박 두께가 1oz 인데 적층도에는 2oz 로 되어 있습니다. 어느 쪽을 기준으로 할까요?', opts: [['A', '1oz', '', '1oz'], ['B', '2oz', '', '2oz']] },
  { no: '14', type: '线路 Circuit', cat: 'circuit', sep: 'wrap', cn: '线路距孔0.1mm，补偿后可能短路，建议移线？', en: 'Trace 0.1mm to hole, may short after compensation, move trace?', ko: '회로와 홀 사이가 0.1mm 라 보정 후 쇼트가 날 수 있습니다. 회로를 옮기기를 권하는데 어떻게 할까요?', opts: [['A', '同意移线', 'Agree', '회로 이동에 동의'], ['B', '保持', 'Keep', '그대로 유지']] },
  { no: '15', type: '标记 Marking', cat: 'marking', sep: 'colon', fig: 'sheet', cn: 'UL标记及周期加在底层字符？见附图3', en: 'Add UL mark & date code on bottom legend? see fig.3', ko: 'UL 마크와 주기를 뒷면 실크에 넣을까요? 첨부 그림 3 참고.', opts: [['A', '加', 'Add', '넣음'], ['B', '不加', 'No', '넣지 않음']] },
  { no: '16', type: '标注 Indication', cat: 'indication', alt: ['drill'], sep: 'paren', rows: 2, cn: '钻孔图孔数与钻带不符，以钻带为准？', en: 'Hole count on drill drawing differs from drill file, follow drill file?', ko: '드릴 도면의 홀 수가 드릴 파일과 다릅니다. 드릴 파일 기준으로 할까요?', opts: [['A', '以钻带为准', 'Follow drill file', '드릴 파일 기준'], ['B', '以钻孔图为准', 'Follow drawing', '드릴 도면 기준']] },
  { no: '18', type: '过孔 Via', cat: 'via', sep: 'colon', fig: 'main', cn: '盘中孔需电镀填平，加收费用？', en: 'Via-in-pad needs plating fill, extra charge?', ko: '패드 내 비아는 도금 평탄화가 필요하며 추가 비용이 듭니다. 수용하시겠습니까?', opts: [['A', '接受', 'Accept', '수용'], ['B', '移开过孔', 'Move vias out of pads', '비아를 패드 밖으로 이동']] },
  { no: '19', type: '阻焊 S/M', cat: 'soldermask', sep: 'dash', cn: '阻焊颜色哑黑，交期+1天？', en: 'Matte black solder mask, +1 day?', ko: '솔더마스크 색상이 무광 검정이라 납기가 1일 늘어납니다. 수용하시겠습니까?', opts: [['A', '接受', 'Accept', '수용'], ['B', '改亮黑', 'Glossy black', '유광 검정으로 변경']] },
  { no: '20', type: '外形 Outline', cat: 'outline', alt: ['drill'], sep: 'colon', fig: 'main', rows: 2, cn: '槽孔最小宽度0.5mm，锣刀最小0.6mm，加宽至0.6mm？', en: 'Min slot width 0.5mm, router min 0.6mm, widen to 0.6mm?', ko: '슬롯 최소 폭이 0.5mm 인데 라우터 비트 최소치는 0.6mm 입니다. 0.6mm 로 넓힐까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '改钻孔连孔', 'Use overlapping drill holes', '드릴 홀을 겹쳐 가공']] },
  { no: '22', type: '叠层 Stackup', cat: 'stackup', sep: 'colon', cn: '4层板未提供叠层，按常规1.6mm叠层？', en: 'No stackup for 4L, use standard 1.6mm?', ko: '4층 보드의 적층 구조가 없습니다. 제조사 표준 1.6mm 적층으로 할까요?', opts: [['A', '接受', 'Accept', '수용'], ['B', '贵司提供', 'Customer provides', '적층 구조를 제공하겠습니다']] },
  { no: '23', type: '其他 Other', cat: 'other', sep: 'wrap', cn: '贵司数量100pcs，交货可否多交2%？', en: 'Qty 100pcs, may we ship +2% overs?', ko: '수량 100pcs 인데 2% 여유분을 더 납품해도 될까요?', opts: [['A', '可以', 'OK', '가능'], ['B', '不可以', 'No', '불가']] },
  { no: '24', type: '其他 Other', cat: 'other', sep: 'colon', cn: 'Gerber文件名含空格，存档时改为下划线？', en: 'Gerber file names contain spaces, replace with underscores for archive?', ko: '거버 파일 이름에 공백이 있습니다. 보관할 때 밑줄로 바꿔도 될까요?', opts: [['A', '可以', 'OK', '가능'], ['B', '不可以', 'No', '불가']] },
  { no: '25', type: '字符 Legend', cat: 'legend', sep: 'paren', cn: '字符颜色白色，板色白色，看不清，改黑色字符？', en: 'White legend on white solder mask is unreadable, change to black legend?', ko: '솔더마스크가 흰색인데 실크도 흰색이라 잘 보이지 않습니다. 검은색 실크로 바꿀까요?', opts: [['A', '改黑色', 'Black', '검은색으로 변경'], ['B', '保持白色', 'Keep white', '흰색 유지']] },
  { no: '27', type: '焊盘 Pad', cat: 'pad', sep: 'colon', cn: '测试点焊盘0.5mm，需加大至0.8mm便于飞针？', en: 'Test pads 0.5mm, enlarge to 0.8mm for flying probe?', ko: '테스트 포인트 패드가 0.5mm 입니다. 플라잉 프로브 검사를 위해 0.8mm 로 키울까요?', opts: [['A', '同意', 'Agree', '동의'], ['B', '不同意', 'Disagree', '동의하지 않음']] },
  { no: '28', type: '钻孔 Drill', cat: 'drill', sep: 'wrap', cn: 'NPTH孔做PTH？', en: 'Make NPTH holes as PTH?', ko: '무도금 홀(NPTH)을 도금 홀(PTH)로 만들까요?', opts: [['A', '做PTH', 'Make PTH', 'PTH 로 제작'], ['B', '保持NPTH', 'Keep NPTH', 'NPTH 유지'], ['C', '其他，请注明', 'Other, pls specify', '기타(내용을 적어 주세요)', 'c']] },
];
const N_EMPTY = ['4', '9', '13', '17', '21', '26'];

const nOptText = (o: NItem['opts'][number]): string => (o[2] === '' ? o[1] : `${o[1]}/${o[2]}`);
const nOptCell = (it: NItem): string => {
  const parts = it.opts.map((o) => {
    const t = nOptText(o);
    if (it.sep === 'paren') return `${o[0]}) ${t}`;
    if (it.sep === 'wrap') return `(${o[0]}) ${t}`;
    if (it.sep === 'dash') return `${o[0]}-${t}`;
    return `${o[0]}：${t}`;
  });
  return it.sep === 'wrap' ? parts.join('\n') : parts.join('  ');
};

function fixtureN(): { built: Built; items: FxItem[] } {
  const main = new GridSheet('EQ');
  main.set(0, 0, '晟泰电子 SUNTECH ELECTRONICS — 工程问题确认 Engineering Query').merge(0, 0, 0, 7);
  main.image(0, 7, makePng(91, 60, 60), null); // 회사 QR 같은 무관 그림
  main.set(1, 0, '客户型号 Customer P/N:').set(1, 2, 'SPB-N-1101').set(1, 3, '生产编号 Job No.:').set(1, 4, 'ST-2411-0088').set(1, 5, '日期 Date:').set(1, 6, '2026-10-10');
  ['No. 序号', '类型 Type', '问题描述（中文）', 'Description (English)', '图片 Pic', '工程建议 Suggestion', '客户回复 Reply', '备注 Remark'].forEach((h, c) => main.set(3, c, h));
  const slots = [...N_ITEMS.map((it) => it.no), ...N_EMPTY].sort((a, b) => Number(a) - Number(b));
  let r = 4;
  let seed = 101;
  const sheets: GridSheet[] = [main];
  for (const no of slots) {
    if (no === '12.1') {
      main.set(r, 2, '【板材相关 Material — 以下两项】').merge(r, 2, r, 5);
      r += 1;
    }
    if (no === '17') {
      main.set(r, 0, '—— 第二部分 Part 2 ——').merge(r, 0, r, 7);
      r += 1;
    }
    const it = N_ITEMS.find((x) => x.no === no);
    main.set(r, 0, no.includes('.') ? no : Number(no));
    if (it === undefined) {
      // 빈 슬롯 — 유형만, 또는 '/' 자리표시, 답 칸 '/'
      if (no === '4') main.set(r, 1, '钻孔 Drill');
      if (no === '9') main.set(r, 2, '/').set(r, 3, '/');
      main.set(r, 6, '/');
      r += 1;
      continue;
    }
    const rows = it.rows ?? 1;
    main.set(r, 1, it.type).set(r, 2, it.cn).set(r, 3, it.en).set(r, 5, nOptCell(it));
    if (Number(no) % 5 === 0) main.set(r, 7, '已核对');
    if (it.fig === 'main') main.image(r, 4, makePng(seed++), it.no);
    if (it.fig === 'sheet') {
      main.set(r, 4, '附图3');
      sheets.push(new GridSheet('附图3').set(0, 0, 'Fig.3 UL/周期位置').image(1, 0, makePng(seed++), it.no));
    }
    if (rows > 1) for (const c of [0, 1, 2, 3, 4, 5, 6, 7]) main.merge(r, c, r + rows - 1, c);
    r += rows;
  }
  main.set(r + 1, 0, '注：请在3个工作日内回复，逾期按我司建议制作。Note: reply within 3 working days.').merge(r + 1, 0, r + 1, 7);
  const items: FxItem[] = N_ITEMS.map((it) => ({
    no: it.no,
    type: it.type,
    cat: it.cat,
    ...(it.alt === undefined ? {} : { alt: it.alt }),
    orig: `${it.cn} ${it.en}`,
    ko: it.ko,
    opts: it.opts.map((o) => ({
      key: o[0],
      orig: nOptText(o),
      ko: o[3],
      ...(o[4] === 'r' ? { rec: true as const } : {}),
      ...(o[4] === 'c' ? { req: true as const } : {}),
    })),
  }));
  return {
    items,
    built: {
      id: 'n-hard-dense',
      ext: 'xlsx',
      label: '(n·난도) 23문항(하위 번호 12.1·12.2) · 질문이 중/영 두 칸 · 선택지 한 셀 중영 혼용(A：/A)/(A)/A- 제각각) · 빈 슬롯 6개가 실문항 사이 · 구획 줄 · 병합 섞임 · 앵커 그림+그림 시트 · 무관 그림',
      notes: 'questionOrig 정답은 "중문 영문"(두 칸을 공백으로) — 유사도 채점이라 이음 문자는 상관없다. 5번 A 만 권장(建议/recommended). 구획 줄(【…】·第二部分)은 문항이 아니다.',
      header: { customerPartNo: 'SPB-N-1101', factoryPartNo: 'ST-2411-0088', issuedOn: '2026-10-10' },
      items,
      emptySlots: N_EMPTY,
      sheets,
    },
  };
}

// ── 실행 ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) rmSync(path.join(OUT_DIR, f));
  const all = [
    fixtureA(), fixtureB(), fixtureC(), fixtureD(), fixtureE(), fixtureF(), fixtureG(), fixtureH(), fixtureI(), fixtureJ(),
    fixtureK(), fixtureL(), fixtureM(), fixtureN().built,
  ];
  for (const b of all) {
    const res = await writeFixture(b);
    console.log(`${res.file.padEnd(26)} ${String(Math.round(res.bytes / 1024)).padStart(4)}KB  문항 ${String(b.items.length).padStart(2)} · 빈 슬롯 ${String(b.emptySlots.length)} · 그림 ${String(res.images)}`);
    if (res.bytes > 300 * 1024) throw new Error(`${res.file} 가 300KB 를 넘는다`);
  }
}

await main();
