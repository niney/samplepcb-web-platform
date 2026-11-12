// 개발의뢰 출력물(16:9 장) e2e 픽스처 — **실전 규모**(로컬 #257 과 같은 크기: 시스템개발 6분야 · 명세 6/5/6/2/1/0 ·
// 검토 관찰 · 확인 사항 6 · 일정 8단계 · 도면 2장 · 업무 8행 · 문서 3건 · AI 추가 질문 6).
// 내용은 지어낸 제품이다(실제 의뢰 자료를 옮기지 않는다) — 글 길이와 개수만 실전에 맞췄다. 기존 여정 픽스처(분야 2 · 명세 3/2)는
// 장이 거의 비어 배분(단 쌓기 · 고르게 나누기 · 넘침 허용 · 표 이어 붙이기)이 한 번도 일어나지 않는다.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const DECK_AREAS = ['circuit', 'pcb', 'firmware', 'mech', 'app', 'server'] as const;

export const DECK_DESCRIPTION = [
  '• 공장 회전설비(모터·펌프·팬)에 붙여 진동과 표면 온도를 재고, 이상 징후를 무선으로 알리는 배터리 구동 센서 노드와 수집 게이트웨이의 기능검증용 통합 개발을 요청합니다.',
  '• 센서 노드는 3축 진동 가속도와 온도를 주기적으로 재어 저전력 무선으로 게이트웨이에 보내고, 임계값을 넘으면 즉시 알림을 보냅니다. 배터리 교체 없이 2년 이상 동작이 목표입니다.',
  '• 게이트웨이는 노드 30대까지 수신해 현장 PC 로 전달합니다. 현장 PC 용 수집 프로그램과 클라우드 서버는 이번 범위에 넣을지 아직 정하지 못했습니다.',
  '• 외함은 기존 양산품 외함을 참고용으로만 쓰고, 방진·방수 구조와 자석 부착 방식은 개발사 제안을 받고 싶습니다.',
].join('\n');

// 범위 답 셋(전문가에게 맡겨도 묻는 고정 질문) — 세부 질문 답변 표.
export const DECK_ANSWERS = [
  { code: 'system.product_design', choices: ['request'] },
  { code: 'system.mech_design', choices: ['modify'] },
  { code: 'system.software', choices: ['unknown'] },
];

// AI 추가 질문(§7.2.2) 저장분 — 선택지형 · 서술형 · '잘 모르겠음' · 미응답을 섞는다. 등록 payload 로는 못 넣어(서버가 잡에서
// 질문을 되읽는다) 의뢰 행에 직접 넣는다.
const opt = (pairs: [string, string][]): { code: string; label: string }[] => [...pairs.map(([code, label]) => ({ code, label })), { code: 'unknown', label: '잘 모르겠음' }];
export const DECK_AI_QUESTIONS = {
  version: 1,
  jobId: 'e2e-deck',
  model: 'e2e-model-hidden',
  generatedAt: '2026-11-12T01:00:00.000Z',
  understood: '공장 회전설비의 진동과 온도를 배터리로 2년 이상 재어 무선으로 모으는 센서 노드와 게이트웨이를 새로 만드는 의뢰로 이해했습니다.',
  questions: [
    { id: 'q1', question: '센서 노드는 한 현장에 몇 대쯤 설치하나요?', why: '무선 방식과 게이트웨이 수를 정하는 기준입니다.', options: opt([['lt10', '10대 이하'], ['lt30', '11~30대'], ['gt30', '30대 초과']]), answer: { choice: 'lt30', text: '' } },
    { id: 'q2', question: '노드와 게이트웨이 사이 거리는 어느 정도인가요?', why: '안테나와 무선 출력, 중계 필요 여부가 달라집니다.', options: opt([['near', '같은 실내 30m 이내'], ['mid', '건물 한 층 안'], ['far', '건물 사이·100m 이상']]), answer: { choice: 'mid', text: '철골 구조라 벽이 많습니다' } },
    { id: 'q3', question: '진동은 얼마나 자주 재서 보내면 되나요?', why: '배터리 수명과 데이터 양이 여기서 정해집니다.', options: [], answer: { choice: null, text: '평소 10분마다 요약값, 임계값을 넘으면 그 즉시 원본 2초 분량을 보내면 됩니다.' } },
    { id: 'q4', question: '설치 장소에 폭발 위험 구역(방폭)이 있나요?', why: '회로 보호와 외함 규격이 크게 달라집니다.', options: opt([['yes', '있음'], ['no', '없음']]), answer: { choice: 'unknown', text: '' } },
    { id: 'q5', question: '게이트웨이는 현장 PC 와 어떻게 연결하나요?', why: '유선 포트와 전원 구성이 달라집니다.', options: opt([['eth', '유선 랜'], ['usb', 'USB'], ['wifi', '무선 랜']]), answer: { choice: 'eth', text: '' } },
    { id: 'q6', question: '모은 데이터를 외부(클라우드)에서도 봐야 하나요?', why: '서버 개발이 이번 범위인지 정합니다.', options: opt([['yes', '필요'], ['no', '현장 PC 만']]), answer: null },
  ],
};

const fact = (text: string): { text: string; evidence: string } => ({ text, evidence: 'e2e' });
const spec = (item: string, text: string): { item: string; text: string; evidence: string } => ({ item, text, evidence: 'e2e' });

export const DECK_PHASES: [string, number, number, string, string, string][] = [
  ['요구사항 분석·현장 실측', 1, 2, '실측 리포트·회로 구성·전력 예산안', '대상 설비 1대 현장 접근', '현장 일정에 따라 착수가 달라집니다'],
  ['외함·기구 설계', 3, 4, '외함 도면·방수 구조안', '참고 외함 실물과 치수', '회로·기판 설계와 병행 진행 가능합니다'],
  ['회로 설계', 3, 4, '회로도·부품 목록(BOM)', '실측 기반 세부 사양 협의', ''],
  ['PCB 아트웍', 2, 3, '기판 도면·제작 파일(거버)', '외함 내부 치수 확정', ''],
  ['펌웨어 개발', 4, 6, '노드·게이트웨이 펌웨어 소스', '수집 프로그램과의 통신 규약 협의', '기판 제작 기간과 병행 진행 가능합니다'],
  ['PCB 제작·부품 조달·SMT', 2, 4, '실장 완료 기판(PCBA)', '회로·도면·BOM 완료', '기판 제작과 부품 수급에 외부 리드타임이 듭니다'],
  ['Bring-up·디버깅·보드 수정', 3, 5, '기능시험 결과·2차 수정 기판', '1차 기판 실장 완료', '기판 재제작 외부 리드타임이 포함됩니다'],
  ['현장 설치 시험·기능 검증', 2, 3, '현장 시험 결과·배터리 소모 실측', '외함 부품 제작·2차 기판 완료', '외함 부품 제작에 외부 리드타임이 듭니다'],
];
export const DECK_MIN_WEEKS = DECK_PHASES.reduce((s, p) => s + p[1], 0);
export const DECK_MAX_WEEKS = DECK_PHASES.reduce((s, p) => s + p[2], 0);

export const DECK_REVIEW: any = {
  version: 4,
  brief: { serviceAreas: [...DECK_AREAS], answers: DECK_ANSWERS },
  summary: '공장 회전설비의 진동·온도를 배터리로 재어 무선으로 모으는 센서 노드와 게이트웨이의 기능검증용 통합 개발',
  requirements: [
    fact('3축 진동 가속도와 표면 온도를 주기 측정'),
    fact('배터리 교체 없이 2년 이상 동작하는 저전력 설계'),
    fact('임계값 초과 시 즉시 무선 알림과 원본 파형 전송'),
    fact('게이트웨이 한 대가 노드 30대까지 수신'),
    fact('방진·방수 외함과 자석 부착 구조는 개발사 제안'),
  ],
  areas: [
    {
      area: 'circuit',
      summary: '3축 가속도·온도 센싱과 저전력 무선, 1차 전지 전원을 담은 노드 회로와 게이트웨이 회로 설계',
      spec: [
        spec('측정·센싱', '3축 MEMS 가속도 센서 — 설비 진동 대역 측정, 임계값 인터럽트'),
        spec('측정·센싱', '접촉식 온도 센서 1채널 — 설비 표면 온도'),
        spec('통신', '저전력 무선으로 노드↔게이트웨이 양방향(요약값·원본 파형·설정)'),
        spec('통신', '게이트웨이↔현장 PC 유선 랜 연결'),
        spec('전원부', '노드는 1차 리튬 전지 구동, 측정·송신 구간만 깨어나는 구조'),
        spec('전원부', '게이트웨이는 어댑터 상시 전원'),
      ],
      observations: [
        fact('2년 동작 목표와 임계값 초과 시 원본 파형 전송이 함께 있어 평균 전류와 순간 송신 전류의 예산이 이 회로의 핵심입니다'),
        fact('무선 방식과 안테나가 설치 거리·철골 구조 답변에 달려 있어 현장 실측이 회로 확정의 출발점입니다'),
      ],
    },
    {
      area: 'pcb',
      summary: '노드 기판을 소형 외함에 맞춰 설계하고 게이트웨이 기판과 함께 시제품 수량 제작·조립',
      spec: [
        spec('기판 크기·외형', '노드 기판은 참고 외함 내부 치수 기준, 센서는 부착면 가까이 배치'),
        spec('배치·레이아웃', '무선 안테나와 센서 아날로그 영역 분리, 전지 접점 보강'),
        spec('층수·재질', '층수·재질은 개발사 제안으로 정함'),
        spec('제작 수량', '노드 10장·게이트웨이 2장 제작'),
        spec('조립·실장', '부품 조달과 SMT 조립까지 범위에 포함'),
      ],
      observations: [fact('진동을 재는 기판이라 센서 고정 방식과 기판 강성이 측정값에 직접 영향을 줍니다')],
    },
    {
      area: 'firmware',
      summary: '측정·요약·임계 판정·저전력 송신을 담은 노드 펌웨어와 30대 수신·전달을 담은 게이트웨이 펌웨어',
      spec: [
        spec('제어 동작', '주기 기상 → 측정 → 요약값 계산 → 송신 → 절전 기본 순서'),
        spec('제어 동작', '임계값 초과 인터럽트로 즉시 기상해 원본 2초 분량 전송'),
        spec('통신 처리', '게이트웨이가 노드 30대의 수신·재전송·시각 동기를 관리'),
        spec('데이터 저장', '송신 실패분은 노드에 보관했다가 다음 주기에 재전송'),
        spec('오류 복구', '전지 전압 저하·센서 이상·무선 두절을 상태값으로 보고'),
        spec('사용자 조작', '측정 주기·임계값을 게이트웨이를 통해 원격 변경'),
      ],
      observations: [
        fact('절전 구간이 수명의 대부분을 정하므로 기상 조건과 송신 횟수의 설계가 펌웨어의 중심입니다'),
        fact('30대가 같은 주기로 깨어나면 송신이 겹치므로 노드별 시각 분산이 필요합니다'),
      ],
    },
    {
      area: 'mech',
      summary: '참고 외함을 바탕으로 한 방진·방수 구조와 자석 부착부 제안, 시제품 외함 제작',
      spec: [spec('내부 구성품 배치', '센서가 설비 표면에 단단히 닿도록 부착면에 가깝게 배치'), spec('재질·제작 방식', '시제품 외함은 개발사 제안 방식으로 제작, 양산 금형은 이번 범위 밖')],
      observations: [fact('자석 부착 강도와 외함 강성이 진동 전달에 영향을 주어 기구와 측정 성능을 함께 검증해야 합니다')],
    },
    {
      area: 'app',
      summary: '현장 PC 수집 프로그램은 범위 미정, 본 개발은 게이트웨이가 내보내는 데이터 형식을 정의',
      spec: [spec('장치 연결 방식', '게이트웨이↔현장 PC 유선 랜으로 측정값·상태 전달')],
      observations: [fact('수집 프로그램을 누가 만드는지에 따라 게이트웨이 출력 형식의 협의 상대가 달라집니다')],
    },
    { area: 'server', summary: '고객 자료에 클라우드 서버 개발 내용이 정해져 있지 않습니다(현장 PC 까지만 확인)', spec: [], observations: [] },
  ],
  openQuestions: [
    { question: '자료 간 확인 필요: 노드 수량이 설명에는 30대, 시제품 계획에는 10대로 적혀 있습니다. 시제품 기준 수량은 몇 대인가요?', why: '기판 제작 수량과 현장 시험 규모, 견적 기준이 달라집니다.', area: 'general' },
    { question: '자료 간 확인 필요: 개발 분야에 앱·서버가 포함됐지만 설명은 수집 프로그램과 서버를 미정으로 적었습니다. 이번 범위에 넣나요?', why: '견적에 앱·서버 공정을 넣을지와 통신 규약 협의 상대가 정해집니다.', area: 'general' },
    { question: '대상 설비에 현장 접근해 실측할 수 있는 시기는 언제인가요?', why: '진동 대역과 설치 환경 실측이 센서·무선 사양 확정의 출발점입니다.', area: 'circuit', resolution: '상담 결과: 12월 첫 주 정기 보수 기간에 펌프 2대 실측 가능' },
    { question: '무선은 면허가 필요 없는 대역만 쓰면 되나요, 사내 무선망 규정이 따로 있나요?', why: '무선 방식 선택과 향후 인증 범위에 영향을 줍니다.', area: 'circuit' },
    { question: '임계값을 넘었을 때 알림은 게이트웨이까지만 전달하면 되나요, 현장 경광등·문자 연동도 필요한가요?', why: '게이트웨이 출력 회로와 펌웨어 범위가 달라집니다.', area: 'firmware' },
    { question: '측정 데이터는 노드·게이트웨이에 얼마 동안 보관해야 하나요?', why: '저장 용량과 메모리 구성, 재전송 설계에 필요합니다.', area: 'firmware' },
  ],
  checks: [],
  meta: { jobId: 'e2e-deck', model: 'e2e-model-hidden', promptVersion: 'dev-review.v5', inputHash: 'e2e-deck', generatedAt: '2026-11-12T01:00:00.000Z', attachmentFiles: ['설비_진동감시_요구사항_v2.docx'] },
  adminComment: '무선 방식은 현장 실측 뒤 두 가지 안으로 비교해 드리겠습니다. 배터리 2년 목표는 측정 주기 10분 기준으로 여유가 있습니다.',
  schedule: {
    phases: DECK_PHASES.map(([name, minWeeks, maxWeeks, output, prerequisite, note]) => ({ name, minWeeks, maxWeeks, output, prerequisite, note })),
    wishCode: null,
    assumptions: '현장 실측 접근·통신 규약 협의·고객 검토 회신이 지연 없이 진행되고, 기판 수정 1회·시제품 1회전을 기준으로 낸 예상입니다',
  },
};

// ── 구성도 — 도면 2장(1900×1200) + 앞뒤 글. 출력물은 도면만 싣고 글은 싣지 않는다 ────────────────────────────
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], stroke = '#2b5fb3', fill = '#fff'): string =>
  `<rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="3"/>` +
  `<text x="${String(x + w / 2)}" y="${String(y + 34)}" font-size="22" font-weight="700" text-anchor="middle">${esc(title)}</text>` +
  lines.map((l, i) => `<text x="${String(x + w / 2)}" y="${String(y + 64 + i * 24)}" font-size="16" text-anchor="middle" fill="#333">${esc(l)}</text>`).join('');
const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, color = '#333'): string =>
  `<line x1="${String(x1)}" y1="${String(y1)}" x2="${String(x2)}" y2="${String(y2)}" stroke="${color}" stroke-width="3" marker-end="url(#arr)"/>` +
  `<text x="${String((x1 + x2) / 2)}" y="${String((y1 + y2) / 2 - 10)}" font-size="15" text-anchor="middle" fill="${color}">${esc(label)}</text>`;
const note = (x: number, y: number, w: number, lines: string[]): string =>
  `<rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(24 + lines.length * 22)}" rx="6" fill="#fff8d6" stroke="#e0b400" stroke-width="2"/>` +
  lines.map((l, i) => `<text x="${String(x + 12)}" y="${String(y + 28 + i * 22)}" font-size="14" fill="#5b4a00">${esc(l)}</text>`).join('');
const zone = (x: number, y: number, w: number, h: number, label: string, fill: string): string =>
  `<rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" fill="${fill}" stroke="#d0d5dc"/><text x="${String(x + 14)}" y="${String(y + 26)}" font-size="15" font-weight="700" fill="#555">${esc(label)}</text>`;
const frame = (title: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1900 1200"><defs><marker id="arr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#333"/></marker></defs>` +
  `<rect width="1900" height="1200" fill="#fff"/><text x="950" y="60" font-size="30" font-weight="700" text-anchor="middle">${esc(title)}</text>${body}</svg>`;

const TOPOLOGY = frame(
  '① 시스템 토폴로지 — 설비 진동·온도 감시 (노드 ↔ 게이트웨이 ↔ 현장 PC)',
  box(120, 380, 420, 220, '센서 노드 (개발 대상)', ['3축 진동·표면 온도 측정', '1차 전지 · 2년 이상 동작', '임계값 초과 즉시 알림', '설비당 1대 · 자석 부착'], '#2b5fb3', '#eef4ff') +
    box(740, 380, 420, 220, '게이트웨이 (개발 대상)', ['노드 30대까지 수신', '시각 동기 · 재전송 관리', '어댑터 상시 전원', '설정 원격 변경 전달'], '#2b5fb3', '#eef4ff') +
    box(1360, 380, 420, 220, '현장 PC 수집 프로그램', ['측정값·상태 수신·표시', '개발 주체 미정 (TBD)', '출력 형식 협의 필요'], '#777', '#f4f4f4') +
    box(1360, 760, 420, 150, '클라우드 서버 (TBD)', ['자료에 구성·연동 언급 없음', '범위 포함 여부 확인 필요'], '#aaa', '#fafafa') +
    box(120, 760, 420, 150, '대상 설비 (모터·펌프·팬)', ['회전설비 표면에 부착', '방폭 구역 여부 미확인'], '#777', '#f4f4f4') +
    arrow(540, 490, 740, 490, '저전력 무선 (방식 TBD)', '#1b6ef3') +
    arrow(1160, 490, 1360, 490, '유선 랜') +
    arrow(1570, 600, 1570, 760, '연동 여부 TBD', '#999') +
    arrow(330, 760, 330, 600, '진동·온도') +
    note(600, 660, 660, ['⚠ 자료 간 확인 필요 — 노드 수량 30대(설명) ↔ 시제품 10대(제작 계획)', '⚠ 수집 프로그램·서버 개발이 이번 범위인지 미정']) +
    `<rect x="120" y="1010" width="1660" height="110" rx="8" fill="#fff" stroke="#d0d5dc"/><text x="144" y="1044" font-size="16" font-weight="700">범례</text>` +
    `<text x="144" y="1078" font-size="15">파란 상자 = 이번 의뢰의 신규 개발 · 회색 상자 = 기존 또는 범위 미정 · 노란 메모 = 확인 필요 / 자료 충돌 · TBD = 설계 시 확정</text>`,
);
const HARDWARE = frame(
  '② 하드웨어 기능 블록도 — 센서 노드 (1차 전지 구동)',
  zone(80, 110, 480, 760, '입력 영역 (센서·조작)', '#f1f8f1') +
    zone(600, 110, 640, 760, '제어 영역', '#fffaf0') +
    zone(1280, 110, 540, 760, '통신·표시 영역', '#fdf1f1') +
    zone(80, 900, 1740, 150, '전원 영역 (1차 전지 → 보호 → 전원 분배)', '#f4f4f4') +
    box(120, 170, 400, 130, '3축 가속도 센서', ['진동 대역 측정 · 임계 인터럽트', '부품 TBD'], '#1d8a5b') +
    box(120, 330, 400, 130, '표면 온도 센서', ['접촉식 1채널', '방식 TBD'], '#1d8a5b') +
    box(120, 490, 400, 130, '설정 버튼·자석 스위치', ['현장 등록·초기화'], '#1d8a5b') +
    box(120, 650, 400, 130, '디버그 포트', ['Bring-up·시험용', '형태 TBD'], '#1d8a5b') +
    box(660, 250, 520, 420, 'MCU (무선 내장, 부품 TBD)', ['측정 주기 관리 · 절전', '요약값 계산 · 임계 판정', '송신·재전송 · 시각 동기', '전지 전압·센서 상태 감시', '설정값 보관'], '#b7791f') +
    box(1320, 170, 460, 150, '저전력 무선 (안테나)', ['방식·대역 TBD', '안테나 내장/외장 TBD'], '#c0392b') +
    box(1320, 360, 460, 130, '보조 저장 (Flash)', ['송신 실패분 보관', '용량 TBD'], '#c0392b') +
    box(1320, 530, 460, 130, '상태 LED', ['등록·송신·전지 저하 표시'], '#c0392b') +
    box(120, 940, 360, 90, '1차 리튬 전지', ['용량 TBD'], '#555') +
    box(560, 940, 360, 90, '역접속·과전류 보호', [], '#555') +
    box(1000, 940, 360, 90, '전원 분배·스위치', ['센서 전원 차단 제어'], '#555') +
    arrow(520, 235, 660, 330, '가속도 (SPI/I2C TBD)') +
    arrow(520, 395, 660, 420, '온도') +
    arrow(520, 555, 660, 520, 'GPIO') +
    arrow(520, 715, 660, 620, 'SWD/UART TBD') +
    arrow(1180, 330, 1320, 245, '무선 송수신', '#1b6ef3') +
    arrow(1180, 460, 1320, 425, 'SPI') +
    arrow(1180, 580, 1320, 595, 'GPIO') +
    arrow(480, 985, 560, 985, '') +
    arrow(920, 985, 1000, 985, '') +
    arrow(1180, 940, 920, 670, '전원', '#c0392b') +
    note(660, 700, 520, ['⚠ 평균 전류·순간 송신 전류 예산 검토 필요', '⚠ MCU·무선 부품은 현장 실측 뒤 확정']) +
    `<rect x="80" y="1080" width="1740" height="80" rx="8" fill="#fff" stroke="#d0d5dc"/><text x="104" y="1112" font-size="16" font-weight="700">범례</text>` +
    `<text x="104" y="1142" font-size="15">검은 화살표 = 데이터·제어 · 파란 화살표 = 무선 · 빨간 화살표 = 전원 · 노란 메모 = TBD·확인 필요 항목</text>`,
);

// 도면 앞뒤 글 — 출력물에 **없어야** 하는 문구(스펙이 not.toContain 으로 본다).
export const DECK_DIAGRAM_ONLY_TEXTS = ['요구사항 확인 요약', '확정된 구성', '미확정 항목', '고객 추가 확인사항', '회로 개발 검토사항', '무선 방식·대역·안테나 형태 (TBD)'];
export const DECK_DIAGRAM_CAPTIONS = [
  '① 시스템 토폴로지 — 노드와 게이트웨이 사이 무선, 게이트웨이와 현장 PC 사이 유선 랜만 선으로 표시했습니다.',
  '② 하드웨어 기능 블록도 — 노드 기준. MCU 를 가운데 두고 입력은 왼쪽, 통신·표시는 오른쪽, 전원은 아래에 두었습니다.',
];
export const DECK_DIAGRAM_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif}h2{color:#2945e8}</style></head><body>
<h1>설비 진동·온도 감시 — 시스템 토폴로지 및 하드웨어 기능 블록도</h1>
<h2>요구사항 확인 요약</h2><ul>
<li>목적: 공장 회전설비의 진동·온도를 배터리로 재어 무선으로 모으는 센서 노드와 게이트웨이의 기능검증용 통합 개발.</li>
<li>확정 기능: 3축 진동·표면 온도 측정, 저전력 무선, 임계값 초과 알림, 노드 30대 수신, 유선 랜 전달.</li>
<li>제외 범위: 양산 금형, 클라우드 서버 구성(미정).</li>
<li>미확정(TBD): MCU·무선 부품, 무선 방식·대역, 전지 용량, 안테나 형태, 저장 용량.</li></ul>
${TOPOLOGY}<p>${DECK_DIAGRAM_CAPTIONS[0] ?? ''}</p>
${HARDWARE}<p>${DECK_DIAGRAM_CAPTIONS[1] ?? ''}</p>
<h2>확정된 구성</h2><ul>
<li>HW: 3축 가속도·온도 센서, 무선 내장 MCU, 1차 전지 전원, 보조 저장, 상태 LED.</li>
<li>FW: 주기 측정·요약·임계 판정·저전력 송신, 게이트웨이의 30대 수신·시각 동기.</li>
<li>통신: 노드↔게이트웨이 저전력 무선, 게이트웨이↔현장 PC 유선 랜.</li></ul>
<h2>미확정 항목</h2><ul>
<li>MCU·무선 부품명 (TBD)</li><li>무선 방식·대역·안테나 형태 (TBD)</li><li>1차 전지 용량 (TBD)</li><li>보조 저장 용량·보관 기간 (TBD)</li><li>클라우드 서버 유무 (자료 없음)</li></ul>
<h2>고객 추가 확인사항</h2><ul>
<li>노드 수량 — 설명 30대 ↔ 시제품 계획 10대.</li><li>수집 프로그램·서버 개발 범위와 주체.</li><li>방폭 구역 설치 여부.</li></ul>
<h2>회로 개발 검토사항</h2><ul><li>평균 전류와 순간 송신 전류의 전력 예산 검토 후 전지 용량 확정.</li><li>센서 인터페이스(SPI/I2C)는 부품 선정 뒤 확정.</li></ul>
</body></html>`;

// ── 진행 현황 — 공유된 업무 8행 + 일정 3개(달성도는 서버가 계산) ──────────────────────────────────────────
const task = (name: string, phase: string, status: string, startOn: string, endOn: string, progressPct: number, note: string): any => ({
  taskId: null, name, phase, status, startOn, endOn, weightBp: 0, progressPct, note, visibleToCustomer: true,
});
export const DECK_TASKS = [
  task('요구사항 분석·현장 실측', 'design', 'done', '2026-11-16', '2026-11-27', 100, '대상 설비 현장 접근'),
  task('외함·기구 설계', 'design', 'done', '2026-11-30', '2026-12-25', 100, '참고 외함 실물과 치수'),
  task('회로 설계', 'design', 'in_progress', '2026-11-30', '2026-12-25', 60, '실측 기반 세부 사양 협의'),
  task('PCB 아트웍', 'design', 'planned', '2026-12-28', '2027-01-15', 0, '외함 내부 치수 확정'),
  task('펌웨어 개발', 'design', 'in_progress', '2026-12-28', '2027-02-05', 20, '수집 프로그램과의 통신 규약 협의'),
  task('PCB 제작·부품 조달·SMT', 'fabrication', 'planned', '2027-01-18', '2027-02-12', 0, '회로·도면·BOM 완료'),
  task('Bring-up·디버깅·보드 수정', 'assembly', 'planned', '2027-02-15', '2027-03-19', 0, '1차 기판 실장 완료'),
  task('현장 설치 시험·기능 검증', 'assembly', 'planned', '2027-03-22', '2027-04-09', 0, '외함 부품 제작·2차 기판 완료'),
];
export const DECK_SCHEDULE = { baseStartOn: '2026-11-16', plannedEndOn: '2027-04-09', expectedEndOn: '2027-04-23' };

export const DECK_QUOTE: any = {
  kind: 'initial',
  title: '설비 진동감시 센서 노드 개발 견적',
  vatMode: 'separate',
  durationDays: 150,
  scheduleNote: '착수 후 21주',
  deliverables: ['회로도', '거버', '펌웨어 소스', '외함 도면'],
  exclusions: 'PCB 제작비·부품비·외함 제작비 별도',
  terms: '표준 조건 e2e',
  warrantyDays: 180,
  reviewDays: 7,
  validUntil: '2099-12-31',
  note: null,
  internalNote: null,
  items: [
    { title: 'H/W 회로·PCB 설계', description: null, amount: 9_000_000, durationDays: 60 },
    { title: '펌웨어 개발', description: null, amount: 8_000_000, durationDays: 60 },
    { title: '외함·기구 설계', description: null, amount: 4_000_000, durationDays: 30 },
  ],
  milestones: [
    { title: '착수금', ratioBp: 5000, trigger: 'on_accept', unlocksDeliverables: false },
    { title: '잔금', ratioBp: 5000, trigger: 'on_delivery', unlocksDeliverables: true },
  ],
};
