// KST 날짜 표시 — 서버 `apps/api/src/lib/kst.ts`(kstDateStr)의 클라이언트 짝.
//
// ⚠ 왜 필요한가(2026-08-05 실측 결함): 납기·출고예정일 같은 **날짜 전용** 필드는 서버가
// `new Date('YYYY-MM-DDT00:00:00+09:00')` 로 KST 자정에 앵커해 저장한다(pcb-po.ts /
// pcb-rfq.ts `parseKstDate`, BOM 동일 관례). 그 인스턴트의 ISO 문자열은 UTC 기준
// 전날 15:00 이므로, 화면이 `iso.slice(0, 10)` 으로 자르면 **하루 앞당겨 보인다**.
//   저장 2026-08-19T15:00Z(=KST 08-20) → slice → '2026-08-19'
// 표시만 틀리는 게 아니라, 발주 모달이 그 값을 날짜 입력에 프리필하므로 저장할 때마다
// 실제 납기가 하루씩 앞당겨진다(RFQ 08-21 → 발주 08-20 → 재발주 08-19 …).
//
// 타임스탬프(발행일·회신일·입고일 등)에도 같은 함수를 쓴다 — 인스턴트를 KST 달력
// 날짜로 옮기는 것이 한국 업무 화면의 정답이고, UTC 슬라이스는 KST 00~09시 사건을
// 전날로 표시하는 같은 결함을 낸다.

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** ISO 인스턴트 → KST 'YYYY-MM-DD'. 잘못된 값이면 null 취급. */
export function kstDateOnly(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 표시용 — 값이 없으면 대시(기본 '—'). 목록·상세의 날짜 칸에 그대로 쓴다. */
export function fmtKstDate(iso: string | null | undefined, fallback = '—'): string {
  return kstDateOnly(iso) ?? fallback;
}

/** `<input type="date">` 프리필용 — 값이 없으면 빈 문자열(서버 왕복이 하루 밀리지 않게). */
export function kstDateInput(iso: string | null | undefined): string {
  return kstDateOnly(iso) ?? '';
}

/** KST 기준 오늘 'YYYY-MM-DD' — 납기 지연 판정 등 날짜 비교의 기준값. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
