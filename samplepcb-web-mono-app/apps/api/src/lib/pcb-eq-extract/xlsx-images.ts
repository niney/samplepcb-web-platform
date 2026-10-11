// .xlsx 그림 추출 — 셀은 SheetJS 가 읽고, 그림은 패키지(zip)의 DrawingML 을 직접 읽는다(exceljs 를 한 번 더
// 돌리지 않는다 — 통합문서를 두 번 해석하는 비용과 exceljs 의 양식 거부를 피한다). 세 경로:
//  ① 떠 있는 그림 — xl/drawings/drawingN.xml 의 twoCellAnchor/oneCellAnchor(from=왼쪽 위 셀)·absoluteAnchor
//  ② WPS '셀 안 그림' — xl/cellimages.xml + 셀 수식 =DISPIMG("ID_…",1) (중국 공장은 WPS 를 많이 쓴다)
//  ③ Excel 365 '셀에 배치' — xl/richData(rdrichvalue·richValueRel) + metadata.xml + 셀 vm 속성
// ②는 셀 수식이 필요해 extract.ts 가 SheetJS 셀과 함께 풀고, 여기서는 이름→그림 사전만 만든다.
import type { EqCellAnchor, EqImageExt } from './types';

export type ZipFiles = Record<string, Uint8Array>;

export interface XlsxPicture {
  sheetName: string;
  anchor: EqCellAnchor | null;
  ext: EqImageExt;
  data: Buffer;
}

const td = new TextDecoder('utf-8');

export const zipText = (files: ZipFiles, path: string): string | null => {
  const f = files[path];
  return f === undefined ? null : td.decode(f);
};

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`).exec(tag);
  return m?.[1] === undefined ? null : decodeXml(m[1]);
};

// 관계 대상 경로 해석 — 절대('/xl/…')·상대('../media/…') 모두.
export function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir === '' ? [] : baseDir.split('/');
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const relsOf = (path: string): string => `${dirOf(path)}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;

// 부품의 관계 사전 — rId → 해석된 경로.
export function readRels(files: ZipFiles, partPath: string): Map<string, string> {
  const xml = zipText(files, relsOf(partPath));
  const out = new Map<string, string>();
  if (xml === null) return out;
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    const mode = attr(m[0], 'TargetMode');
    if (id === null || target === null || mode === 'External') continue;
    out.set(id, resolvePartPath(dirOf(partPath), target));
  }
  return out;
}

export function extOfPath(path: string): EqImageExt {
  const e = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (e === 'png') return 'png';
  if (e === 'jpg' || e === 'jpeg' || e === 'jpe') return 'jpg';
  if (e === 'gif') return 'gif';
  if (e === 'webp') return 'webp';
  if (e === 'emf') return 'emf';
  if (e === 'wmf') return 'wmf';
  return 'bin';
}

export interface XlsxSheetPart {
  name: string;
  path: string;
}

// 통합문서 시트 순서 — SheetJS SheetNames 와 같은 순서(workbook.xml 의 <sheet> 순).
export function readSheetParts(files: ZipFiles): XlsxSheetPart[] {
  const wbPath = 'xl/workbook.xml';
  const xml = zipText(files, wbPath);
  if (xml === null) return [];
  const rels = readRels(files, wbPath);
  const out: XlsxSheetPart[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'id');
    const path = rid === null ? undefined : rels.get(rid);
    if (name !== null && path !== undefined) out.push({ name, path });
  }
  return out;
}

const XDR_FROM_RE =
  /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/;
const ANCHOR_RE = /<((?:\w+:)?)(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/\1\2>/g;
const BLIP_RE = /<(?:\w+:)?blip\b[^>]*?(?:\w+:)?embed="([^"]+)"/g;

// ① 떠 있는 그림.
export function readDrawingPictures(files: ZipFiles, sheet: XlsxSheetPart): { anchor: EqCellAnchor | null; path: string }[] {
  const sheetXml = zipText(files, sheet.path);
  if (sheetXml === null) return [];
  const sheetRels = readRels(files, sheet.path);
  const out: { anchor: EqCellAnchor | null; path: string }[] = [];
  for (const d of sheetXml.matchAll(/<(?:\w+:)?drawing\b[^>]*\/?>/g)) {
    const rid = attr(d[0], 'id');
    const drawingPath = rid === null ? undefined : sheetRels.get(rid);
    if (drawingPath === undefined) continue;
    const drawingXml = zipText(files, drawingPath);
    if (drawingXml === null) continue;
    const drawingRels = readRels(files, drawingPath);
    for (const a of drawingXml.matchAll(ANCHOR_RE)) {
      const kind = a[2];
      const inner = a[3] ?? '';
      let anchor: EqCellAnchor | null = null;
      if (kind !== 'absoluteAnchor') {
        const from = XDR_FROM_RE.exec(inner);
        if (from?.[1] !== undefined && from[2] !== undefined) {
          anchor = { col: Number(from[1]), row: Number(from[2]) };
        }
      }
      const seen = new Set<string>(); // mc:AlternateContent 의 Choice/Fallback 중복 방지
      for (const b of inner.matchAll(BLIP_RE)) {
        const embed = b[1];
        if (embed === undefined || seen.has(embed)) continue;
        seen.add(embed);
        const path = drawingRels.get(embed);
        if (path !== undefined && files[path] !== undefined) out.push({ anchor, path });
      }
    }
  }
  return out;
}

// ② WPS cellimages.xml — 그림 이름(ID_…) → 미디어 경로.
export function readWpsCellImages(files: ZipFiles): Map<string, string> {
  const out = new Map<string, string>();
  const path = Object.keys(files).find((p) => /^xl\/cellimages\.xml$/i.test(p));
  if (path === undefined) return out;
  const xml = zipText(files, path) ?? '';
  const rels = readRels(files, path);
  for (const m of xml.matchAll(/<(?:\w+:)?cellImage\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellImage>/g)) {
    const inner = m[1] ?? '';
    const nv = /<(?:\w+:)?cNvPr\b[^>]*>/.exec(inner);
    const name = nv === null ? null : attr(nv[0], 'name');
    const blip = /<(?:\w+:)?blip\b[^>]*?(?:\w+:)?embed="([^"]+)"/.exec(inner);
    const media = blip?.[1] === undefined ? undefined : rels.get(blip[1]);
    if (name !== null && media !== undefined) out.set(name, media);
  }
  return out;
}

// ③ Excel 365 셀 안 그림 — vm(1 기준) → valueMetadata → futureMetadata(rvb i) → rich value → richValueRel → 미디어.
export function readRichValueImages(files: ZipFiles): Map<number, string> {
  const out = new Map<number, string>();
  const rvXml = zipText(files, 'xl/richData/rdrichvalue.xml');
  const relXml = zipText(files, 'xl/richData/richValueRel.xml');
  const metaXml = zipText(files, 'xl/metadata.xml');
  if (rvXml === null || relXml === null || metaXml === null) return out;
  const relRels = readRels(files, 'xl/richData/richValueRel.xml');
  const relTargets = [...relXml.matchAll(/<(?:\w+:)?rel\b[^>]*\/?>/g)].map((m) => {
    const rid = attr(m[0], 'id');
    return rid === null ? undefined : relRels.get(rid);
  });
  const richValues = [...rvXml.matchAll(/<(?:\w+:)?rv\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rv>/g)].map((m) => {
    const first = /<(?:\w+:)?v\b[^>]*>([^<]*)</.exec(m[1] ?? '');
    return first?.[1] === undefined ? Number.NaN : Number(first[1]);
  });
  const futureBlock = /<(?:\w+:)?futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/(?:\w+:)?futureMetadata>/.exec(metaXml);
  const futureRvb = [...(futureBlock?.[1] ?? '').matchAll(/<(?:\w+:)?bk>([\s\S]*?)<\/(?:\w+:)?bk>/g)].map((m) => {
    const rvb = /<(?:\w+:)?rvb\b[^>]*\si="(\d+)"/.exec(m[1] ?? '');
    return rvb?.[1] === undefined ? Number.NaN : Number(rvb[1]);
  });
  const valueBlock = /<(?:\w+:)?valueMetadata\b[^>]*>([\s\S]*?)<\/(?:\w+:)?valueMetadata>/.exec(metaXml);
  const valueBks = [...(valueBlock?.[1] ?? '').matchAll(/<(?:\w+:)?bk>([\s\S]*?)<\/(?:\w+:)?bk>/g)];
  valueBks.forEach((m, idx) => {
    const rc = /<(?:\w+:)?rc\b[^>]*\sv="(\d+)"/.exec(m[1] ?? '');
    if (rc?.[1] === undefined) return;
    const rvIndex = futureRvb[Number(rc[1])];
    if (rvIndex === undefined || Number.isNaN(rvIndex)) return;
    const relIndex = richValues[rvIndex];
    if (relIndex === undefined || Number.isNaN(relIndex)) return;
    const media = relTargets[relIndex];
    if (media !== undefined) out.set(idx + 1, media);
  });
  return out;
}

const cellRefRe = /^([A-Z]+)(\d+)$/;
export function decodeCellRef(ref: string): EqCellAnchor | null {
  const m = cellRefRe.exec(ref);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

// 시트 XML 에서 vm 속성이 붙은 셀(Excel 365 셀 안 그림) — [셀, vm].
export function readVmCells(files: ZipFiles, sheet: XlsxSheetPart): { anchor: EqCellAnchor; vm: number }[] {
  const xml = zipText(files, sheet.path);
  if (!xml?.includes('vm="')) return [];
  const out: { anchor: EqCellAnchor; vm: number }[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?c\b[^>]*>/g)) {
    const vm = attr(m[0], 'vm');
    const r = attr(m[0], 'r');
    if (vm === null || r === null) continue;
    const anchor = decodeCellRef(r);
    if (anchor !== null) out.push({ anchor, vm: Number(vm) });
  }
  return out;
}
