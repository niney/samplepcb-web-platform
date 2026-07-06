// 거버 실파일 사전 이관 — 컷오버 창 밖에서 미리 돌리는 단계(계획 #9).
//
// 두 모드:
// ① --sideload (대량 정석): 파일서버(niney-file)의 pathToken 은 DB 발급이 아니라
//    **base64(encodeURIComponent(BASE_PATH 상대경로))** 이고, 다운로드도 그 경로를 그대로 읽는다
//    (upload-utils.ts encryptPath / hosting.ts downloadFileByPathToken 실측). 따라서 미러를
//    서버 `BASE_PATH/<MIGRATE_SIDELOAD_PREFIX>/` 로 rsync 해 **원본 날짜 폴더 구조를 보존**하고,
//    토큰은 여기서 직접 계산해 원장에 기록한다 — 업로드 API 를 타지 않으므로 "업로드일 폴더
//    한 곳에 수만 파일" 문제가 원천 소멸. (rsync 가 선행되어야 다운로드가 유효)
// ② API 업로드 (소량/증분): uploadFileByAnonymous — 요청당 1파일 제약(실측), 업로드일 폴더 저장.
//
// 실행: pnpm migrate:files [-- --sideload --limit=100 --concurrency=6 --relink]
//   --relink  이미 이관된 sp_order_spec(주문 선이관 후 파일 후이관 케이스)에 sp_file 행을 보충
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { closeLegacyPool, legacySelect } from '../../lib/legacy-db';
import { uploadToFileServer } from '../../lib/file-server';
import { mapGerberItem } from './lib/eav-mapper';
import { Ledger } from './lib/ledger';
import { G5Writer } from './lib/g5-writer';
import { asyncPool, asStr, chunk, legacyDate, resolveMigrateTmpDir, uuidV5 } from './lib/util';

interface UploadTargetLine {
  odId: string;
  ctId: string;
  quoteId: string;
  filePath: string;
}

function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.zip') return 'application/zip';
  if (ext === '.rar') return 'application/vnd.rar';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

async function collectTargets(limit: number): Promise<{ lines: UploadTargetLine[]; noFile: number }> {
  // 최신 주문부터 — 미러가 최근 구간(2022+)만 있을 때 사전 업로드 가치가 높은 쪽을 먼저 나른다.
  const rows = await legacySelect(
    `SELECT c.od_id, c.ct_id, c.it_id
       FROM g5_shop_cart c JOIN g5_shop_order o ON o.od_id = c.od_id
      WHERE c.it_id <> '' ORDER BY c.od_id DESC, c.ct_id`,
  );
  const lines: UploadTargetLine[] = [];
  let noFile = 0;
  for (const part of chunk(rows, 300)) {
    const itIds = [...new Set(part.map((r) => asStr(r.it_id)))];
    const items = await legacySelect(
      `SELECT * FROM g5_shop_item WHERE it_id IN (${itIds.map(() => '?').join(', ')})`,
      itIds,
    );
    const itemMap = new Map(items.map((i) => [asStr(i.it_id), i]));
    for (const r of part) {
      const item = itemMap.get(asStr(r.it_id));
      if (item === undefined) continue;
      const { filePath } = mapGerberItem(item);
      if (filePath === '') {
        noFile += 1;
        continue;
      }
      lines.push({
        odId: asStr(r.od_id),
        ctId: asStr(r.ct_id),
        quoteId: uuidV5(`${asStr(r.od_id)}:${asStr(r.ct_id)}`),
        filePath,
      });
      if (limit > 0 && lines.length >= limit) return { lines, noFile };
    }
  }
  return { lines, noFile };
}

/** 파일서버 upload-utils.ts encryptPath 와 동일 산식 — 변경 시 서버와 동기 필수. */
export function computePathToken(relativePath: string): string {
  return Buffer.from(encodeURIComponent(relativePath)).toString('base64');
}

async function main(): Promise<void> {
  // pnpm run 이 '--' 구분 토큰까지 전달하므로 걸러낸다(파싱 시 위치 인자 오인 방지)
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: 'string', default: '0' },
      concurrency: { type: 'string', default: '6' },
      relink: { type: 'boolean', default: false },
      sideload: { type: 'boolean', default: false },
    },
  });
  const limit = Math.trunc(Number(values.limit));
  const concurrency = Math.max(1, Math.min(10, Math.trunc(Number(values.concurrency))));
  const mirrorDir = process.env.MIGRATE_LEGACY_FILES_DIR;
  const serviceType = process.env.FILE_SERVICE_TYPE ?? 'gerber';

  const g5 = new G5Writer();
  const tmpDir = await resolveMigrateTmpDir();
  const ledger = await Ledger.open(tmpDir, g5.dbName);

  try {
    const { lines, noFile } = await collectTargets(limit);
    console.log(
      `업로드 대상 라인 ${String(lines.length)}건 (filePath 없음 ${String(noFile)}건 · serviceType=${serviceType})`,
    );
    if (mirrorDir === undefined || mirrorDir === '') {
      console.log('MIGRATE_LEGACY_FILES_DIR 미설정 — 업로드 생략(원장/리링크만 가능).');
    } else if (values.sideload) {
      // ① 사이드로드: 서버에 rsync 된 미러의 상대경로로 pathToken 을 직접 계산(네트워크 0회).
      const prefix = (process.env.MIGRATE_SIDELOAD_PREFIX ?? 'gerber-legacy').replace(/\/+$/, '');
      const pending = lines.filter((l) => ledger.fileEntry(l.quoteId)?.pathToken === undefined);
      console.log(
        `사이드로드 ${String(pending.length)}건 — 서버 BASE_PATH/${prefix}/ 기준 토큰 계산(⚠ rsync 선행 필요)`,
      );
      let ok = 0;
      let missing = 0;
      for (const line of pending) {
        const rel = line.filePath.replace(/^\/?gerber_files\//, '').replace(/^\/+/, '');
        try {
          const st = await stat(path.join(mirrorDir, rel));
          const serverRel = `${prefix}/${rel.replace(/\\/g, '/')}`;
          await ledger.setFileEntry(line.quoteId, {
            pathToken: computePathToken(serverRel),
            uploadFileName: path.basename(rel),
            originFileName: path.basename(rel),
            size: st.size,
            sourcePath: line.filePath,
          });
          ok += 1;
        } catch {
          await ledger.setFileEntry(line.quoteId, { missing: true, sourcePath: line.filePath });
          missing += 1;
        }
      }
      await ledger.save();
      console.log(`사이드로드 완료 ${String(ok)} · 로컬 누락 ${String(missing)}`);
    } else {
      // ② API 업로드(소량/증분) — pathToken 이 없으면(미기록 + 과거 missing) 재시도 대상.
      //    missing 은 "그때 없었음"일 뿐, 미러 보강 후 재실행만으로 업로드로 승격(멱등).
      const pending = lines.filter((l) => ledger.fileEntry(l.quoteId)?.pathToken === undefined);
      console.log(`미업로드 ${String(pending.length)}건 업로드 시작 (동시성 ${String(concurrency)})`);
      let ok = 0;
      let missing = 0;
      let failed = 0;
      await asyncPool(pending, concurrency, async (line, idx) => {
        const rel = line.filePath.replace(/^\/?gerber_files\//, '').replace(/^\/+/, '');
        const local = path.join(mirrorDir, rel);
        let buffer: Buffer;
        try {
          buffer = await readFile(local);
        } catch {
          await ledger.setFileEntry(line.quoteId, { missing: true, sourcePath: line.filePath });
          missing += 1;
          return;
        }
        const filename = path.basename(rel);
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const [uploaded] = await uploadToFileServer(
              [{ buffer, filename, mimetype: mimeOf(filename) }],
              serviceType,
            );
            if (uploaded === undefined) throw new Error('빈 업로드 응답');
            await ledger.setFileEntry(line.quoteId, {
              pathToken: uploaded.pathToken,
              uploadFileName: uploaded.uploadFileName,
              originFileName: uploaded.originFileName,
              size: uploaded.size,
              sourcePath: line.filePath,
            });
            ok += 1;
            break;
          } catch (err) {
            if (attempt === 3) {
              failed += 1;
              console.log(`  ✗ 업로드 실패(3회): ${line.filePath} — ${String(err)}`);
            } else {
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
        }
        if ((idx + 1) % 100 === 0) console.log(`  … ${String(idx + 1)}/${String(pending.length)}`);
      });
      await ledger.save();
      console.log(`업로드 완료 ${String(ok)} · 로컬 누락 ${String(missing)} · 실패 ${String(failed)}`);
    }

    const stats = ledger.fileStats();
    console.log(`원장 누계: 업로드 ${String(stats.uploaded)} · 누락 ${String(stats.missing)}`);

    // ── 선이관 spec 에 sp_file 보충(--relink) ──
    if (values.relink) {
      const prisma = new PrismaClient();
      try {
        let linked = 0;
        for (const line of lines) {
          const entry = ledger.fileEntry(line.quoteId);
          if (entry?.pathToken === undefined) continue;
          const spec = await prisma.spOrderSpec.findFirst({
            where: { quoteId: line.quoteId },
            select: { id: true, createdAt: true },
          });
          if (spec === null) continue;
          const exists = await prisma.spFile.findFirst({
            where: { refType: 'sp_order_spec', refId: spec.id, fileType: 'gerber' },
            select: { id: true },
          });
          if (exists !== null) continue;
          await prisma.spFile.create({
            data: {
              refType: 'sp_order_spec',
              refId: spec.id,
              uploadFileName: entry.uploadFileName ?? path.basename(line.filePath),
              originFileName: entry.originFileName ?? path.basename(line.filePath),
              pathToken: entry.pathToken,
              size: BigInt(entry.size ?? 0),
              writeDate: legacyDate(null, spec.createdAt),
              fileType: 'gerber',
            },
          });
          linked += 1;
        }
        console.log(`sp_file 보충(relink): ${String(linked)}건`);
      } finally {
        await prisma.$disconnect();
      }
    }
  } finally {
    await ledger.save();
    await Promise.allSettled([g5.end(), closeLegacyPool()]);
  }
}

await main();
