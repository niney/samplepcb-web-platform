// 마이그레이션 원장 — 멱등 재실행의 근거. 타깃 g5 가 MyISAM(트랜잭션 없음)이라
// "od 단위 완료 마커 + 자연키 존재검사"가 원자성의 대체 수단이다(계획 문서 §MyISAM).
// 파일 위치: <플랫폼 루트>/.tmp/migrate/ledger-<타깃DB>.json — 타깃 DB별 분리(리허설/컷오버 혼선 방지).
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FileLedgerEntry {
  pathToken?: string;
  uploadFileName?: string;
  originFileName?: string;
  size?: number;
  missing?: boolean; // 로컬 미러에 실파일 없음(스킵·리포트 대상)
  sourcePath?: string;
}

interface LedgerData {
  /** 완료된 주문 od_id → 1 (phase 02) */
  orders: Record<string, 1>;
  /** quoteId → 파일서버 업로드 결과 (upload-files.ts 가 기록, phase 02 가 소비) */
  files: Record<string, FileLedgerEntry>;
  /** phase 단위 완료 마커 (예: 'members', 'boards', 'misc') */
  phases: Record<string, 1>;
}

const EMPTY: LedgerData = { orders: {}, files: {}, phases: {} };

export class Ledger {
  private data: LedgerData = { orders: {}, files: {}, phases: {} };
  private dirty = 0;
  private constructor(private readonly filePath: string) {}

  static async open(dir: string, targetDbName: string): Promise<Ledger> {
    const ledger = new Ledger(path.join(dir, `ledger-${targetDbName}.json`));
    try {
      const raw = await readFile(ledger.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LedgerData>;
      ledger.data = {
        orders: parsed.orders ?? {},
        files: parsed.files ?? {},
        phases: parsed.phases ?? {},
      };
    } catch {
      ledger.data = structuredClone(EMPTY);
    }
    return ledger;
  }

  get path(): string {
    return this.filePath;
  }

  isOrderDone(odId: string): boolean {
    return this.data.orders[odId] === 1;
  }

  async markOrderDone(odId: string): Promise<void> {
    this.data.orders[odId] = 1;
    await this.bump();
  }

  orderDoneCount(): number {
    return Object.keys(this.data.orders).length;
  }

  isPhaseDone(phase: string): boolean {
    return this.data.phases[phase] === 1;
  }

  async markPhaseDone(phase: string): Promise<void> {
    this.data.phases[phase] = 1;
    await this.save();
  }

  fileEntry(quoteId: string): FileLedgerEntry | undefined {
    return this.data.files[quoteId];
  }

  async setFileEntry(quoteId: string, entry: FileLedgerEntry): Promise<void> {
    this.data.files[quoteId] = entry;
    await this.bump();
  }

  fileStats(): { uploaded: number; missing: number } {
    let uploaded = 0;
    let missing = 0;
    for (const e of Object.values(this.data.files)) {
      if (e.missing === true) missing += 1;
      else if (e.pathToken !== undefined) uploaded += 1;
    }
    return { uploaded, missing };
  }

  private async bump(): Promise<void> {
    this.dirty += 1;
    if (this.dirty >= 25) await this.save();
  }

  /** tmp 파일에 쓴 뒤 rename — 중단 시 원장 파손 방지. */
  async save(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await rename(tmp, this.filePath);
    this.dirty = 0;
  }
}
