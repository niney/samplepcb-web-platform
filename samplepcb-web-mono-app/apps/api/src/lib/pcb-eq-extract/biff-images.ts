// .xls(BIFF8) 그림 추출 — SheetJS 는 셀만 읽으므로 그림은 Workbook 스트림을 직접 걷는다.
//  ① 전역 구간 MSODRAWINGGROUP(0xEB)+CONTINUE(0x3C) = OfficeArtDggContainer → BStore 의 FBSE 마다 BLIP 1장
//     (BStore 순번이 곧 pib — 1 기준)
//  ② 시트 구간(BOUNDSHEET.lbPlyPos 에서 시작) MSODRAWING(0xEC) 을 이어 붙인 OfficeArtDgContainer →
//     SpContainer 마다 FOPT 의 pib(0x0104) 와 ClientAnchor(0xF010) 의 왼쪽 위 셀
// 참고: [MS-XLS] 2.4.(29·170·171) · [MS-ODRAW] 2.2.(13·32·40·59·60). 2026-10-11 실샘플(LHD .xls) 실증 이식.
import { inflateSync } from 'node:zlib';
import type { EqCellAnchor, EqImageExt } from './types';

const REC_BOF = 0x0809;
const REC_EOF = 0x000a;
const REC_BOUNDSHEET = 0x0085;
const REC_FILEPASS = 0x002f;
const REC_MSODRAWINGGROUP = 0x00eb;
const REC_MSODRAWING = 0x00ec;
const REC_CONTINUE = 0x003c;

const OA_BSTORE = 0xf001;
const OA_SPGR = 0xf003;
const OA_SP = 0xf004;
const OA_FBSE = 0xf007;
const OA_FOPT = 0xf00b;
const OA_CHILD_ANCHOR = 0xf00f;
const OA_CLIENT_ANCHOR = 0xf010;
const OA_PROP_PIB = 0x0104;

export interface BiffPicture {
  sheetIndex: number;
  sheetName: string;
  anchor: EqCellAnchor | null;
  ext: EqImageExt;
  data: Buffer;
}

export interface BiffPictures {
  pictures: BiffPicture[];
  encrypted: boolean;
  warnings: string[];
}

interface BiffRecord {
  id: number;
  offset: number;
  body: Buffer;
}

function readRecords(stream: Buffer): BiffRecord[] {
  const out: BiffRecord[] = [];
  let i = 0;
  while (i + 4 <= stream.length) {
    const id = stream.readUInt16LE(i);
    const len = stream.readUInt16LE(i + 2);
    out.push({ id, offset: i, body: stream.subarray(i + 4, Math.min(i + 4 + len, stream.length)) });
    i += 4 + len;
  }
  return out;
}

interface OaRecord {
  ver: number;
  inst: number;
  type: number;
  bodyStart: number;
  bodyEnd: number;
}

// OfficeArt 레코드 머리(8바이트)를 읽어 [start,end) 안의 형제 레코드를 나열한다.
function oaChildren(buf: Buffer, start: number, end: number): OaRecord[] {
  const out: OaRecord[] = [];
  let off = start;
  while (off + 8 <= end) {
    const verInst = buf.readUInt16LE(off);
    const type = buf.readUInt16LE(off + 2);
    const len = buf.readUInt32LE(off + 4);
    const bodyStart = off + 8;
    const bodyEnd = Math.min(bodyStart + len, end);
    out.push({ ver: verInst & 0x0f, inst: verInst >> 4, type, bodyStart, bodyEnd });
    if (bodyStart + len > end) break; // 잘린 레코드 — 더 걷지 않는다
    off = bodyStart + len;
  }
  return out;
}

const isContainer = (r: OaRecord): boolean => r.ver === 0x0f;

const SIGNATURES: [EqImageExt, Buffer][] = [
  ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['jpg', Buffer.from([0xff, 0xd8, 0xff])],
];

// BLIP 레코드(0xF01A~0xF02A) 하나 → 그림 바이트. 기준 recInstance 가 모두 짝수라 홀수면 UID 가 2개다.
function decodeBlip(buf: Buffer, rec: OaRecord): { ext: EqImageExt; data: Buffer } | null {
  const uidBytes = (rec.inst & 1) === 1 ? 32 : 16;
  const body = buf.subarray(rec.bodyStart, rec.bodyEnd);
  const raster = (ext: EqImageExt): { ext: EqImageExt; data: Buffer } => {
    const data = body.subarray(uidBytes + 1);
    const sig = SIGNATURES.find(([e]) => e === ext)?.[1];
    if (sig === undefined || data.subarray(0, sig.length).equals(sig)) return { ext, data };
    // 머리 계산이 어긋난 파일 — 서명을 찾아 맞춘다(스크래치 프로브 방식).
    const at = body.indexOf(sig);
    return { ext, data: at >= 0 ? body.subarray(at) : data };
  };
  switch (rec.type) {
    case 0xf01e:
      return raster('png');
    case 0xf01d:
    case 0xf02a:
      return raster('jpg');
    case 0xf01a:
    case 0xf01b: {
      // 메타파일 머리 34바이트(cbSize·rcBounds·ptSize·cbSave·compression·filter) 뒤가 데이터.
      const head = uidBytes;
      const compression = body[head + 32];
      const payload = body.subarray(head + 34);
      const ext: EqImageExt = rec.type === 0xf01a ? 'emf' : 'wmf';
      if (compression === 0x00) {
        try {
          return { ext, data: inflateSync(payload) };
        } catch {
          return { ext: 'bin', data: payload };
        }
      }
      return { ext, data: payload };
    }
    case 0xf01c:
    case 0xf01f:
    case 0xf029:
      return { ext: 'bin', data: body.subarray(uidBytes + 1) };
    default:
      return null;
  }
}

// BStore 항목 순서대로(pib = 인덱스+1) 그림을 꺼낸다. 항목은 FBSE(+내장 BLIP) 또는 BLIP 직접.
function readBStore(group: Buffer, warnings: string[]): ({ ext: EqImageExt; data: Buffer } | null)[] {
  const out: ({ ext: EqImageExt; data: Buffer } | null)[] = [];
  const findBStore = (start: number, end: number): OaRecord | null => {
    for (const r of oaChildren(group, start, end)) {
      if (r.type === OA_BSTORE) return r;
      if (isContainer(r)) {
        const inner = findBStore(r.bodyStart, r.bodyEnd);
        if (inner !== null) return inner;
      }
    }
    return null;
  };
  const bstore = findBStore(0, group.length);
  if (bstore === null) return out;
  for (const entry of oaChildren(group, bstore.bodyStart, bstore.bodyEnd)) {
    if (entry.type !== OA_FBSE) {
      out.push(decodeBlip(group, entry));
      continue;
    }
    const cbName = group[entry.bodyStart + 33] ?? 0;
    const blipStart = entry.bodyStart + 36 + cbName;
    const inner = oaChildren(group, blipStart, entry.bodyEnd)[0];
    if (inner === undefined) {
      warnings.push('xls: 그림 데이터가 통합문서 밖(지연 스트림)에 있어 꺼내지 못했습니다');
      out.push(null);
      continue;
    }
    out.push(decodeBlip(group, inner));
  }
  return out;
}

interface ShapeHit {
  pib: number;
  anchor: EqCellAnchor | null;
}

function readClientAnchor(buf: Buffer, r: OaRecord): EqCellAnchor | null {
  if (r.bodyEnd - r.bodyStart < 18) return null;
  return { col: buf.readUInt16LE(r.bodyStart + 2), row: buf.readUInt16LE(r.bodyStart + 6) };
}

// SpContainer 하나 — pib 와 앵커(ClientAnchor, 없으면 소속 그룹의 앵커).
function readShape(buf: Buffer, sp: OaRecord, groupAnchor: EqCellAnchor | null): ShapeHit & { ownAnchor: EqCellAnchor | null } {
  let pib = 0;
  let ownAnchor: EqCellAnchor | null = null;
  for (const r of oaChildren(buf, sp.bodyStart, sp.bodyEnd)) {
    if (r.type === OA_FOPT) {
      for (let k = 0; k < r.inst; k += 1) {
        const p = r.bodyStart + k * 6;
        if (p + 6 > r.bodyEnd) break;
        const opid = buf.readUInt16LE(p);
        if ((opid & 0x3fff) === OA_PROP_PIB && (opid & 0x8000) === 0) pib = buf.readUInt32LE(p + 2);
      }
    } else if (r.type === OA_CLIENT_ANCHOR) {
      ownAnchor = readClientAnchor(buf, r);
    } else if (r.type === OA_CHILD_ANCHOR) {
      // 그룹 안 자식 — 셀 좌표가 없다. 그룹 앵커를 쓴다.
    }
  }
  return { pib, anchor: ownAnchor ?? groupAnchor, ownAnchor };
}

function walkShapes(buf: Buffer, start: number, end: number, groupAnchor: EqCellAnchor | null, hits: ShapeHit[]): void {
  for (const r of oaChildren(buf, start, end)) {
    if (r.type === OA_SPGR) {
      // 그룹의 첫 SpContainer 는 그룹 자신(앵커를 가진다) — 나머지 자식이 그 앵커를 물려받는다.
      const kids = oaChildren(buf, r.bodyStart, r.bodyEnd);
      let anchor = groupAnchor;
      kids.forEach((kid, idx) => {
        if (kid.type === OA_SP) {
          const shape = readShape(buf, kid, anchor);
          if (idx === 0) {
            anchor = shape.ownAnchor ?? anchor;
            if (shape.pib > 0) hits.push({ pib: shape.pib, anchor: shape.anchor });
          } else if (shape.pib > 0) {
            hits.push({ pib: shape.pib, anchor: shape.anchor });
          }
        } else if (kid.type === OA_SPGR) {
          walkShapes(buf, kid.bodyStart - 8, kid.bodyEnd, anchor, hits);
        }
      });
    } else if (r.type === OA_SP) {
      const shape = readShape(buf, r, groupAnchor);
      if (shape.pib > 0) hits.push({ pib: shape.pib, anchor: shape.anchor });
    } else if (isContainer(r)) {
      walkShapes(buf, r.bodyStart, r.bodyEnd, groupAnchor, hits);
    }
  }
}

interface SheetEntry {
  name: string;
  offset: number;
}

function readBoundSheet(body: Buffer): SheetEntry | null {
  if (body.length < 8) return null;
  const offset = body.readUInt32LE(0);
  const cch = body[6] ?? 0;
  const flag = body[7] ?? 0;
  const raw = body.subarray(8, 8 + ((flag & 1) === 1 ? cch * 2 : cch));
  return { offset, name: (flag & 1) === 1 ? raw.toString('utf16le') : raw.toString('latin1') };
}

/** Workbook 스트림(BIFF8) → 시트별 그림. 실패해도 throw 하지 않고 warnings 로 돌려준다. */
export function extractBiffPictures(workbookStream: Buffer, maxImages: number, maxImageBytes: number): BiffPictures {
  const warnings: string[] = [];
  const recs = readRecords(workbookStream);
  const sheets: SheetEntry[] = [];
  const groupParts: Buffer[] = [];
  let encrypted = false;
  let inGroup = false;
  // 전역 구간 = 첫 EOF 까지.
  for (const r of recs) {
    if (r.id === REC_EOF) break;
    if (r.id === REC_FILEPASS) encrypted = true;
    if (r.id === REC_BOUNDSHEET) {
      const s = readBoundSheet(r.body);
      if (s !== null) sheets.push(s);
    }
    if (r.id === REC_MSODRAWINGGROUP) {
      groupParts.push(r.body);
      inGroup = true;
    } else if (r.id === REC_CONTINUE && inGroup) {
      groupParts.push(r.body);
    } else {
      inGroup = false;
    }
  }
  if (encrypted) return { pictures: [], encrypted, warnings };
  if (groupParts.length === 0) return { pictures: [], encrypted, warnings };

  const group = Buffer.concat(groupParts);
  const blips = readBStore(group, warnings);

  const byOffset = new Map(recs.map((r, idx) => [r.offset, idx]));
  const pictures: BiffPicture[] = [];
  let dropped = 0;
  sheets.forEach((sheet, sheetIndex) => {
    const startIdx = byOffset.get(sheet.offset);
    if (startIdx === undefined || recs[startIdx]?.id !== REC_BOF) return;
    const parts: Buffer[] = [];
    let depth = 0;
    let inDrawing = false;
    for (let i = startIdx; i < recs.length; i += 1) {
      const r = recs[i];
      if (r === undefined) break;
      if (r.id === REC_BOF) depth += 1;
      else if (r.id === REC_EOF) {
        depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 1) continue; // 시트에 박힌 차트 하위 스트림은 건너뛴다
      if (r.id === REC_MSODRAWING) {
        parts.push(r.body);
        inDrawing = true;
      } else if (r.id === REC_CONTINUE && inDrawing) {
        parts.push(r.body);
      } else {
        inDrawing = false;
      }
    }
    if (parts.length === 0) return;
    const dg = Buffer.concat(parts);
    const hits: ShapeHit[] = [];
    walkShapes(dg, 0, dg.length, null, hits);
    for (const hit of hits) {
      const blip = blips[hit.pib - 1];
      if (blip === undefined || blip === null) continue;
      if (pictures.length >= maxImages) {
        dropped += 1;
        continue;
      }
      if (blip.data.length > maxImageBytes) {
        warnings.push(`xls: 시트 "${sheet.name}" 그림 ${String(blip.data.length)}B 가 상한을 넘어 버렸습니다`);
        continue;
      }
      pictures.push({ sheetIndex, sheetName: sheet.name, anchor: hit.anchor, ext: blip.ext, data: blip.data });
    }
  });
  if (dropped > 0) warnings.push(`그림 ${String(dropped)}장이 개수 상한(${String(maxImages)})을 넘어 버려졌습니다`);
  return { pictures, encrypted, warnings };
}
