// 결제 후 부품 확인 요청(D43) 메일 본문 — docs/SMARTBOM_PARTNER_RFQ.md §6.39.
//
// ⚠ 고객 메일에 선택 버튼을 넣지 않는다(PCB D16 관례): 메일 보안 게이트웨이가 링크를 미리 열어
//   GET 으로 결정이 나면 고객이 보기도 전에 선택된다. 링크는 주문 상세를 **열기만** 하고,
//   고르는 건 그 화면 안의 POST 다.
// ⚠ 협력사명·원가는 고객 메일에 쓰지 않는다(여정 43호). 품번·문제 유형·선택지 제목만.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const won = (n: number): string => Math.abs(n).toLocaleString('ko-KR');

/** 고객 결정 자리 — 주문 상세의 부품 확인 섹션(목록은 목록만, 결정은 한 곳). */
export const bomConfirmCustomerUrl = (odId: string, requestId: string | bigint): string =>
  `${WEB_BASE_URL}/shop/orderinquiryview.php?od_id=${encodeURIComponent(odId)}#bomc-${String(requestId)}`;

export const bomConfirmAdminCaseUrl = (quoteId: string | bigint): string =>
  `${WEB_BASE_URL}/app/admin/smartbom/cases/${String(quoteId)}?from=confirms`;

function shell(title: string, body: string, ctaLabel: string, ctaUrl: string, footer: string): string {
  return `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">${esc(title)}</div>
      ${body}
      <div style="padding-top:20px;">
        <a href="${esc(ctaUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(ctaLabel)}</a>
      </div>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">${esc(footer)}</td></tr>
  </table>
</div>`;
}

const cell = (label: string, value: string): string => `
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;vertical-align:top;">${esc(label)}</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${value}</td>
        </tr>`;

export interface BomConfirmMailIssue {
  issueTypeLabel: string;
  mpn: string;
  optionTitles: string[];
}

export interface BomConfirmRequestEmailParams {
  customerName: string;
  caseNo: string;
  quoteTitle: string;
  odId: string;
  requestId: string;
  dueOn: string | null; // 'YYYY-MM-DD'
  issues: BomConfirmMailIssue[];
}

export function buildBomConfirmRequestEmail(p: BomConfirmRequestEmailParams): { subject: string; html: string } {
  const name = p.customerName.trim() === '' ? '고객' : p.customerName;
  const rows = p.issues
    .map((issue) =>
      cell(
        issue.issueTypeLabel,
        `<b>${esc(issue.mpn)}</b><br><span style="color:#555;">제안: ${esc(issue.optionTitles.join(' · '))}</span>`,
      ))
    .join('');
  const body = `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(name)}님, 결제하신 부품 주문 중 확인이 필요한 부품이 있습니다.<br>
        아래 부품의 처리 방법을 골라 주시면 바로 조달을 이어가겠습니다.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${cell('주문 건', `${esc(p.quoteTitle)} <span style="color:#8593ab;">(${esc(p.caseNo)})</span>`)}
        ${rows}
        ${p.dueOn === null ? '' : cell('회신 기한', `<b>${esc(p.dueOn)}</b>`)}
      </table>
      <p style="margin:14px 0 0;font-size:12px;color:#8593ab;line-height:1.6;">
        선택은 마이페이지 › 확인 요청 › 부품 확인 또는 아래 버튼으로 연 주문 상세에서 하실 수 있습니다.
        회신이 늦어지면 해당 부품의 조달과 배송이 늦어질 수 있습니다.
      </p>`;
  return {
    subject: `[샘플피씨비] 부품 확인 요청 — ${p.quoteTitle}`,
    html: shell(
      '부품 확인이 필요합니다',
      body,
      '확인하고 회신하기',
      bomConfirmCustomerUrl(p.odId, p.requestId),
      '본 메일은 샘플피씨비 스마트 BOM 부품 확인 요청 알림입니다.',
    ),
  };
}

export interface BomConfirmAnsweredEmailParams {
  caseNo: string;
  quoteTitle: string;
  quoteId: string;
  customerName: string;
  byAdmin: boolean;
  choices: { mpn: string; optionTitle: string }[];
  netDelta: number;
  note: string | null;
}

/** 관리자 알림 — 고객이 골랐으니 적용·정산이 관리자 차례다. */
export function buildBomConfirmAnsweredEmail(p: BomConfirmAnsweredEmailParams): { subject: string; html: string } {
  const money = p.netDelta === 0
    ? '금액 변동 없음'
    : p.netDelta > 0
      ? `<b>${won(p.netDelta)}원 추가결제</b>`
      : `<b>${won(p.netDelta)}원 환불</b>`;
  const rows = p.choices.map((choice) => cell(choice.mpn, esc(choice.optionTitle))).join('');
  const body = `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.customerName === '' ? '고객' : p.customerName)}님의 부품 확인 요청 회신이 ${p.byAdmin ? '대리 기록되었습니다' : '도착했습니다'}.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${cell('Case', `${esc(p.quoteTitle)} <span style="color:#8593ab;">(${esc(p.caseNo)})</span>`)}
        ${rows}
        ${cell('정산', money)}
        ${p.note === null || p.note.trim() === '' ? '' : cell('고객 의견', esc(p.note))}
      </table>`;
  return {
    subject: `[스마트 BOM] 부품 확인 회신 — ${p.caseNo}`,
    html: shell(
      '부품 확인 회신 — 적용·정산이 필요합니다',
      body,
      'Case 열기',
      bomConfirmAdminCaseUrl(p.quoteId),
      '관리자 알림 — 고객 선택을 적용하고 정산을 마쳐 주세요.',
    ),
  };
}
