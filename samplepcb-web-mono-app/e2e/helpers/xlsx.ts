import { inflateRawSync } from 'node:zlib';
import { API_URL } from './env';

// xlsx 를 **의존성 없이** 읽는다 — e2e 는 "내려받은 파일에 그 글자가 들어 있는가"만 보면 된다(칸 위치·서식은
// 서버 단위 테스트가 ExcelJS 로 다시 읽어 확인한다). xlsx 는 zip 이고 글자는 xml 안에 있다.
// ⚠ ExcelJS 는 스트리밍으로 써서 로컬 헤더의 크기가 0 이다(data descriptor) — 중앙 디렉터리에서 크기를 읽는다.

const u16 = (b: Buffer, at: number): number => b.readUInt16LE(at);
const u32 = (b: Buffer, at: number): number => b.readUInt32LE(at);

/** zip 의 xml 항목들을 풀어 이름 → 내용. */
export function unzipXml(zip: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 이 아닙니다(끝 표식 없음)');
  const count = u16(zip, eocd + 10);
  let at = u32(zip, eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (u32(zip, at) !== 0x02014b50) throw new Error('zip 중앙 디렉터리가 깨졌습니다');
    const method = u16(zip, at + 10);
    const size = u32(zip, at + 20);
    const nameLen = u16(zip, at + 28);
    const extraLen = u16(zip, at + 30);
    const commentLen = u16(zip, at + 32);
    const local = u32(zip, at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith('.xml')) continue;
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const raw = zip.subarray(start, start + size);
    out.set(name, (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));
  }
  return out;
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');

/** 통합 문서의 글자(공유 문자열 + 시트) — 태그를 걷어 낸 한 덩어리. `toContain` 으로 본다. */
export function xlsxText(xlsx: Buffer): string {
  const files = unzipXml(xlsx);
  const parts = [...files.entries()]
    .filter(([name]) => name === 'xl/sharedStrings.xml' || name.startsWith('xl/worksheets/'))
    .map(([, xml]) => xml.replace(/<\/(t|si|row)>/g, '\n').replace(/<[^>]+>/g, ''));
  return unescapeXml(parts.join('\n'));
}

export interface XlsxDownload {
  status: number;
  contentType: string;
  /** content-disposition 의 파일 이름(UTF-8 로 풀어서). 없으면 ''. */
  fileName: string;
  buffer: Buffer;
  /** 2xx 가 아니면 서버가 보낸 오류 코드(JSON 의 error) — 아니면 ''. */
  error: string;
}

/** 엑셀 내려받기 경로를 직접 부른다(Bearer). */
export async function fetchXlsx(token: string, path: string): Promise<XlsxDownload> {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await res.arrayBuffer());
  const disposition = res.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '';
  let error = '';
  if (!res.ok) {
    try {
      const json: unknown = JSON.parse(buffer.toString('utf8'));
      if (typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string') error = json.error;
    } catch {
      error = '';
    }
  }
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    fileName: encoded === '' ? '' : decodeURIComponent(encoded),
    buffer,
    error,
  };
}
