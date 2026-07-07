import type { AdminEstimateType } from '@sp/api-contract';

// ── 견적서 메일 본문 빌더 (PDF 없이 직접 임베드) ──────────────────────────────
// EstimateSheet.vue 와 같은 뷰모델(AdminEstimate)을 매체별로 렌더한 이메일 전용 버전.
// 이메일 클라이언트(Outlook 등)는 grid/flex/scoped CSS 를 신뢰성 있게 못 받으므로 table +
// inline style 로만 구성한다. Vue 자동 이스케이프가 없으므로 모든 동적 값은 esc() 로
// 수동 이스케이프한다(HTML 인젝션 차단). 금액은 서버가 이미 부가세 역산한 amounts 를 쓴다.

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// KRW 천단위 콤마(정수). toLocaleString 의 ICU 의존을 피해 결정적으로 포맷한다.
const won = (n: number): string => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

const ORDER_CATEGORY_LABEL: Record<AdminEstimateType['orderCategory'], string> = {
  sample: '샘플',
  mass: '양산',
};

// 사양 키 → 한글 라벨. sp-vue i18n(admin.quotes.specKeys)의 서버측 대응본 — 미등록 키는 원문
// 그대로 노출(계약 catchall). ⚠ ko.ts 의 specKeys 와 동기 유지(향후 공유 패키지 일원화 여지).
const KO_SPEC_LABELS: Record<string, string> = {
  length: '세로',
  width: '가로',
  layers: 'PCB층수',
  pcbThickness: 'PCB두께',
  material: 'PCB재료',
  panel: '배열',
  minTraceSpacing: '패턴폭/간격',
  minHole: '최소홀크기',
  solderMask: 'PCB색상',
  silkscreen: '실크색상',
  surfaceFinish: '표면마감',
  viaProcess: 'VIA가공',
  copperWeights: '동박두께',
  kindPcb: 'PCB선택',
  goldFingers: '골드핑거',
  finishedCopperAdvance: '내부동박두께',
  differentDesign: '파일갯수',
  impedance: '임피던스',
  etest: 'E-Test',
  halfHole: '반홀가공',
  stiffener: '보강판',
  tape3m: '3M Tape',
  framework: '프레임제작',
  stencilSide: '스텐실제작',
  stThickness: '스텐실두께',
  fiducial: '피듀셜',
  electroPolish: '전해연마',
  metalCore: '메탈코어위치',
  edgeRail: '자삽바',
  placeOfOrigin: '원산지',
  coordinate: '부품 좌표',
  size: '스텐실크기',
  sizeCustom: '스텐실크기(직접입력)',
  cutting: '컷팅',
  mqty: '원판수량',
  layersRigid: '층수',
  mat: '적층재료',
  surfaceFinishWeights: '표면마감두께',
  wvoltage: '내전압',
};

export interface EstimateEmail {
  subject: string;
  html: string;
}

export function buildEstimateEmail(data: AdminEstimateType): EstimateEmail {
  const recipientName = (data.applicant?.name ?? '').trim() || (data.companyName ?? '').trim();
  const amt = data.amounts;

  const cellLabel =
    'padding:8px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;';
  const cellValue = 'padding:8px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;';
  const sumLabel =
    'padding:9px 12px;background:#eef4f8;color:#444;font-size:13px;text-align:center;border:1px solid #d9e2e8;';
  const sumValue =
    'padding:9px 12px;color:#222;font-size:14px;text-align:right;border:1px solid #d9e2e8;';

  // 발신처(공급자) — g5_shop_default 재사용(하드코딩 아님). 수신처 — 신청자/회사명.
  const c = data.company;
  const recipientRows = [
    ['회사명', data.companyName ?? ''],
    ['담당자', data.applicant?.name ?? ''],
    ['연락처', data.applicant?.phone ?? ''],
    ['이메일', data.applicant?.email ?? ''],
  ];
  const supplierRows = [
    ['상호', c.name],
    ['대표', c.owner],
    ['연락처', c.tel],
    ['주소', [c.zip, c.addr].filter((s) => s !== '').join(' ')],
  ];
  const infoCell = (rows: string[][], title: string): string => `
    <td style="vertical-align:top;padding:0 6px;width:50%;">
      <div style="font-size:12px;font-weight:700;color:#0090c8;margin:0 0 6px;">${esc(title)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="${cellLabel}width:64px;">${esc(k)}</td><td style="${cellValue}">${esc(v)}</td></tr>`,
          )
          .join('')}
      </table>
    </td>`;

  // 품목 — 신규 모델은 단일 품목행(항목 요약 + 수량). 사양요약(optionSummary)은 화면과 동일.
  const itemSpec = [ORDER_CATEGORY_LABEL[data.orderCategory], data.category]
    .filter((s) => s !== '')
    .join(' · ');
  const etaRow =
    data.eta !== null && data.eta.trim() !== ''
      ? `<tr><td style="${cellLabel}">예상 배송일</td><td style="${cellValue}">${esc(data.eta)}</td></tr>`
      : '';

  const amountsBlock = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:6px;">
      <tr><td style="${sumLabel}width:40%;">공급가합계</td><td style="${sumValue}">${esc(won(amt?.supply ?? 0))}</td></tr>
      <tr><td style="${sumLabel}">부가가치세(10%)</td><td style="${sumValue}">${esc(won(amt?.vat ?? 0))}</td></tr>
      <tr>
        <td style="${sumLabel}background:#0090c8;color:#fff;font-weight:700;">총합계</td>
        <td style="${sumValue}background:#f5f9fb;font-weight:700;font-size:16px;">${esc(won(amt?.total ?? 0))}</td>
      </tr>
    </table>`;

  const bankBlock =
    c.bankAccount.trim() !== ''
      ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f7f7f7;border-radius:6px;font-size:13px;color:#444;">
           <strong style="color:#0090c8;">결제계좌</strong> ${esc(c.bankAccount)}
         </p>`
      : '';

  // 상세 사양 — data.spec(_legacy 제거 완료)을 라벨링해 2열 표로(화면 "사양 전체"의 메일판).
  const specEntries: [string, string][] = Object.entries(data.spec)
    .filter(([, v]) => String(v).trim() !== '')
    .map(([k, v]): [string, string] => [KO_SPEC_LABELS[k] ?? k, String(v)]);
  const specLabelCell =
    'padding:7px 10px;background:#f3f6f9;color:#555;font-size:12px;white-space:nowrap;border:1px solid #e1e6ea;width:22%;';
  const specValueCell = 'padding:7px 10px;color:#222;font-size:12px;border:1px solid #e1e6ea;';
  const specCell = (e: [string, string] | undefined): string =>
    e === undefined
      ? `<td style="${specLabelCell}"></td><td style="${specValueCell}"></td>`
      : `<td style="${specLabelCell}">${esc(e[0])}</td><td style="${specValueCell}">${esc(e[1])}</td>`;
  const specRows: string[] = [];
  for (let i = 0; i < specEntries.length; i += 2) {
    specRows.push(`<tr>${specCell(specEntries[i])}${specCell(specEntries[i + 1])}</tr>`);
  }
  const specBlock =
    specEntries.length === 0
      ? ''
      : `
          <p style="margin:16px 0 6px;font-size:12px;font-weight:700;color:#0090c8;">상세 사양</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            ${specRows.join('')}
          </table>`;

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f4;font-family:'Noto Sans KR',Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#333;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f0f2f4;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e1e6ea;">
        <tr><td style="background:#0090c8;padding:22px 28px;">
          <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">견적서</div>
          <div style="color:#d6eefb;font-size:13px;margin-top:2px;">견적번호 ${esc(data.estimateNo)}</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#333;">
            ${esc(recipientName || '고객')}님, 요청하신 견적서를 보내드립니다.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;">
            <tr>${infoCell(recipientRows, '받는 곳')}${infoCell(supplierRows, '보내는 곳')}</tr>
          </table>

          <p style="margin:16px 0 6px;font-size:12px;color:#777;">
            견적일자 <strong style="color:#333;">${esc(data.issuedAt)}</strong>
            &nbsp;·&nbsp; 유효기간 <strong style="color:#333;">${esc(data.validUntil)}</strong>
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="${cellLabel}width:64px;text-align:center;">항목</td>
              <td style="${cellValue}">
                <strong style="color:#222;">${esc(data.projectName)}</strong>
                ${itemSpec !== '' ? `<span style="color:#888;font-size:12px;"> (${esc(itemSpec)})</span>` : ''}
                ${data.optionSummary.trim() !== '' ? `<div style="margin-top:3px;color:#666;font-size:12px;">${esc(data.optionSummary)}</div>` : ''}
              </td>
            </tr>
            <tr><td style="${cellLabel}text-align:center;">수량</td><td style="${cellValue}">${esc(data.qty)}</td></tr>
            ${etaRow}
          </table>

          ${specBlock}
          ${amountsBlock}
          ${bankBlock}
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #eee;color:#999;font-size:12px;line-height:20px;">
          ${esc(c.name || 'SamplePCB')}
          ${c.tel !== '' ? ` · T ${esc(c.tel)}` : ''}
          ${c.managerEmail !== '' ? ` · E ${esc(c.managerEmail)}` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `[SamplePCB] 견적서 (${data.estimateNo})`, html };
}
