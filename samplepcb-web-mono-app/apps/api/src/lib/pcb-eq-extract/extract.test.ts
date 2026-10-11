import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { excelSerialToYmd, extractEqWorkbook, isDateFormat } from './extract';
import type { EqGold } from './probe-score';
import { EQ_EXTRACT_LIMITS } from './types';

// EQ 추출기(D20 P2) — 셀·병합·그림(앵커)·형식 판별·안전 상한. 실샘플은 .tmp(커밋 안 함)에 있을 때만 돈다.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '__fixtures__');
const REAL = path.resolve(HERE, '../../../../../../.tmp/EQ-L050AKM1001-SH136D2823C.xls');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const golds = readdirSync(FIX)
  .filter((f) => f.endsWith('.gold.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8')) as EqGold);

describe('날짜 서식·일련값', () => {
  it.each([
    ['[$-409]d/mmm/yyyy;@', true],
    ['yyyy-mm-dd', true],
    ['m/d/yy', true],
    ['0;[Red]0', false],
    ['0.000_ ', false],
    ['General', false],
    ['h:mm', false],
    ['@', false],
  ])('isDateFormat(%s) = %s', (z, want) => {
    expect(isDateFormat(z)).toBe(want);
  });
  it('46269 = 2026-09-04(1900 체계) · 1904 체계는 1462일 뒤', () => {
    expect(excelSerialToYmd(46269, false)).toBe('2026-09-04');
    expect(excelSerialToYmd(46269 - 1462, true)).toBe('2026-09-04');
  });
});

describe('합성 픽스처 — 정답의 그림 id 가 추출 결과에 있다', () => {
  it('픽스처가 13개 이상 있다', () => {
    expect(golds.length).toBeGreaterThanOrEqual(13);
  });
  it.each(golds.map((g) => [g.id, g] as const))('%s', (_id, gold) => {
    const buf = readFileSync(path.join(FIX, gold.file));
    expect(buf.length).toBeLessThanOrEqual(300 * 1024);
    const x = extractEqWorkbook(buf, gold.file);
    expect(x.warnings).toEqual([]);
    expect(x.sheets.length).toBeGreaterThan(0);
    const ids = new Set(x.images.map((i) => i.id));
    for (const item of gold.draft.items) for (const ref of item.figureRefs) expect(ids.has(ref)).toBe(true);
    for (const img of x.images) expect(img.data.subarray(0, 4).equals(PNG_SIG)).toBe(true);
    if (gold.file.endsWith('.xls')) expect(x.format).toBe('xls');
    if (gold.file.endsWith('.zip')) {
      expect(x.format).toBe('xlsx');
      expect(x.innerName).toMatch(/\.xlsx$/);
    }
  });
  it('xls(BIFF8) 의 서식 붙은 날짜 일련값을 YYYY-MM-DD 로 읽는다', () => {
    const x = extractEqWorkbook(readFileSync(path.join(FIX, 'j-legacy-xls.xls')), 'j.xls');
    const main = x.sheets[0];
    expect(main?.rows[7]?.[1]).toBe('2026-08-30');
    expect(main?.merges.length).toBeGreaterThan(0);
  });
  it('메인 시트에 앵커된 그림은 셀 위치를 안다(d: 질문 행 D열 · 로고 A1)', () => {
    const x = extractEqWorkbook(readFileSync(path.join(FIX, 'd-inline-figures.xlsx')), 'd.xlsx');
    expect(x.images.map((i) => i.anchor)).toEqual([
      { row: 0, col: 0 },
      { row: 5, col: 3 },
      { row: 7, col: 3 },
      { row: 8, col: 3 },
      { row: 11, col: 3 },
    ]);
  });
});

describe.skipIf(!existsSync(REAL))('실샘플 LHD .xls', () => {
  it('셀·병합·그림 5장(로고 + 图1·图2×2·图3)·날짜', () => {
    const t0 = performance.now();
    const x = extractEqWorkbook(readFileSync(REAL), 'real.xls');
    const ms = performance.now() - t0;
    expect(x.format).toBe('xls');
    expect(x.warnings).toEqual([]);
    expect(x.sheets.map((s) => s.name)).toEqual([
      '问 题 描 述', '图 1', '图 2', '图 3', '图 4', '图 5', '图 6', '图 7', '图 8', '图 9', '图 10', 'Sheet1',
    ]);
    expect(x.images.map((i) => `${i.id}@${i.sheetName}:${i.ext}`)).toEqual([
      'img-1@问 题 描 述:png',
      'img-2@图 1:png',
      'img-3@图 2:png',
      'img-4@图 2:png',
      'img-5@图 3:png',
    ]);
    expect(x.images[0]?.anchor).toEqual({ row: 0, col: 5 });
    const main = x.sheets[0];
    expect(main?.rows[7]?.slice(0, 3)).toEqual(['1', '2026-09-04', 'legend字符']);
    expect(main?.merges.length).toBe(133);
    expect(ms).toBeLessThan(2000);
  });
});

describe('안전 — throw 대신 경고', () => {
  it('크기 상한 초과', () => {
    const x = extractEqWorkbook(Buffer.alloc(EQ_EXTRACT_LIMITS.maxInputBytes + 1), 'big.xlsx');
    expect(x.sheets).toEqual([]);
    expect(x.warnings[0]).toMatch(/MB/);
  });
  it('엑셀이 아닌 바이너리(PDF 등)', () => {
    const x = extractEqWorkbook(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]), 'a.pdf');
    expect(x.sheets).toEqual([]);
    expect(x.warnings.join()).toMatch(/바이너리/);
  });
  it('잘린 xlsx 는 경고로 끝난다', () => {
    const buf = readFileSync(path.join(FIX, 'a-lhd-bilingual.xlsx'));
    const x = extractEqWorkbook(buf.subarray(0, Math.floor(buf.length / 2)), 'cut.xlsx');
    expect(x.warnings.length).toBeGreaterThan(0);
  });
  it('통합문서가 없는 zip', () => {
    const zip = Buffer.from(zipSync({ 'readme.txt': strToU8('hi'), 'gerber/top.gbr': strToU8('G04*') }));
    const x = extractEqWorkbook(zip, 'gerber.zip');
    expect(x.sheets).toEqual([]);
    expect(x.warnings.join()).toMatch(/통합문서/);
  });
  it('CSV 로 내보낸 가짜 xls 는 셀만', () => {
    const x = extractEqWorkbook(Buffer.from('No,Description,Suggestion\n1,Hole too small,A.Accept B.Reject\n'), 'eq.xls');
    expect(x.format).toBe('other');
    expect(x.sheets[0]?.rows[1]?.[1]).toBe('Hole too small');
  });
});

// ── 셀 안 그림 두 갈래 — 실파일이 없어 exceljs 로 만든 통합문서에 부품을 덧붙여 재현한다 ──────────

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

async function baseWorkbook(formulaCell: boolean): Promise<Record<string, Uint8Array>> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('EQ');
  ws.getCell('A1').value = '序号';
  ws.getCell('B1').value = '图片';
  ws.getCell('A2').value = 1;
  ws.getCell('B2').value = formulaCell ? { formula: '_xlfn.DISPIMG("ID_TEST1",1)', result: '#NAME?' } : 'x';
  return unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));
}

describe('셀 안 그림', () => {
  it('WPS =DISPIMG("ID_…") + xl/cellimages.xml → 그 셀 앵커', async () => {
    const files = await baseWorkbook(true);
    files['xl/cellimages.xml'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="ID_TEST1" descr=""/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>',
    );
    files['xl/_rels/cellimages.xml.rels'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image9.png"/></Relationships>',
    );
    files['xl/media/image9.png'] = new Uint8Array(PNG_1PX);
    const x = extractEqWorkbook(Buffer.from(zipSync(files)), 'wps.xlsx');
    expect(x.images).toHaveLength(1);
    expect(x.images[0]).toMatchObject({ id: 'img-1', sheetName: 'EQ', anchor: { row: 1, col: 1 }, ext: 'png' });
    expect(x.sheets[0]?.rows[1]?.[1] ?? '').toBe('');
  });

  it('Excel 365 셀에 배치(vm → metadata → rich value → richValueRel)', async () => {
    const files = await baseWorkbook(false);
    const sheetPath = Object.keys(files).find((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)) ?? '';
    files[sheetPath] = strToU8(strFromU8(files[sheetPath] ?? new Uint8Array()).replace(/<c r="B2"/, '<c r="B2" vm="1"'));
    files['xl/metadata.xml'] = strToU8(
      '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata><valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>',
    );
    files['xl/richData/rdrichvalue.xml'] = strToU8(
      '<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><rv s="0"><v>0</v><v>5</v></rv></rvData>',
    );
    files['xl/richData/richValueRel.xml'] = strToU8(
      '<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rId1"/></richValueRels>',
    );
    files['xl/richData/_rels/richValueRel.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
    );
    files['xl/media/image1.png'] = new Uint8Array(PNG_1PX);
    const x = extractEqWorkbook(Buffer.from(zipSync(files)), 'excel365.xlsx');
    expect(x.images).toHaveLength(1);
    expect(x.images[0]).toMatchObject({ sheetName: 'EQ', anchor: { row: 1, col: 1 }, ext: 'png' });
  });
});
