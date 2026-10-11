// PCB EQ 용어집 — LLM 프롬프트와 프로빙 채점(용어집 준수)이 같은 표를 쓴다.
// src = 공장 원문(중국어·영어, 영어는 대소문자 무시) · ko = 고객 화면 기본 표기 · accept = 채점에서 허용하는 다른 표기.
import type { PcbEqItemCategoryType } from '@sp/api-contract';

export interface EqGlossaryEntry {
  src: readonly string[];
  ko: string;
  accept?: readonly string[];
}

export const EQ_GLOSSARY: readonly EqGlossaryEntry[] = [
  { src: ['阻焊桥', 'soldermask dam', 'solder mask dam', 'soldmask dam', 'S/M dam', 'solder dam'], ko: '솔더마스크 댐', accept: ['솔더마스크 브리지', '솔더 댐', '솔더 마스크 댐'] },
  { src: ['阻焊', '防焊', 'solder mask', 'soldermask', 'soldmask', 'solder resist'], ko: '솔더마스크', accept: ['솔더 마스크', '솔더레지스트', 'PSR'] },
  { src: ['字符', '丝印', 'legend', 'silkscreen', 'silk screen', 'silk-screen'], ko: '실크', accept: ['실크스크린', '문자 인쇄'] },
  { src: ['拼版', 'panelization', 'panelize'], ko: '패널', accept: ['배열', '판넬'] },
  { src: ['工艺边', 'process edge', 'break-away rail', 'breakaway rail', 'tooling rail'], ko: '레일', accept: ['공정 여백', '공정변', '공정 엣지'] },
  { src: ['钢网', 'stencil'], ko: '메탈마스크', accept: ['스텐실', '메탈 마스크'] },
  { src: ['开窗', 'S/M opening', 'solder mask opening'], ko: '오픈', accept: ['개구', '오프닝'] },
  { src: ['过孔', 'via hole', 'vias'], ko: '비아' },
  { src: ['塞孔', 'via plug', 'plugged', 'plugging', 'via filling'], ko: '홀 메움', accept: ['플러깅', '메움', '막음', '홀 충전', '필링'] },
  { src: ['阻抗', 'impedance'], ko: '임피던스' },
  { src: ['半孔', 'half hole', 'half-hole', 'castellated', 'castellation'], ko: '하프홀', accept: ['하프 홀', '캐슬레이션', '반홀'] },
  { src: ['焊盘', 'pad'], ko: '패드' },
  { src: ['板厚', 'board thickness'], ko: '보드 두께', accept: ['판 두께', '기판 두께', '두께'] },
  { src: ['铜厚', 'copper thickness'], ko: '동박 두께', accept: ['동 두께', '구리 두께', '동박'] },
  { src: ['沉金', 'ENIG', 'immersion gold'], ko: '무전해 금도금(ENIG)', accept: ['ENIG', '금도금', '무전해 금'] },
  { src: ['喷锡', 'HASL'], ko: 'HASL', accept: ['핫에어', '납도금', '주석 도금', '솔더 레벨링'] },
  { src: ['V-CUT', 'V割', 'V-score', 'V cut'], ko: 'V컷', accept: ['V-CUT', 'V 컷', '브이컷', 'V-컷'] },
  { src: ['邮票孔', 'stamp hole', 'mouse bite', 'mouse-bite'], ko: '스탬프 홀', accept: ['마우스 바이트', '스탬프홀'] },
  { src: ['层压结构', '叠层', '压合结构', 'stackup', 'stack-up', 'stack up'], ko: '적층 구조', accept: ['적층', '스택업'] },
  { src: ['外形', 'outline', 'profile'], ko: '외형' },
  { src: ['钻孔', 'drill'], ko: '드릴', accept: ['홀 가공', '천공'] },
  // 'trace' 는 넣지 않는다 — 'trace width'(선폭)·'impedance trace'(선로)에서 회로를 강요하게 된다.
  { src: ['线路', 'circuit pattern', 'circuit'], ko: '회로', accept: ['패턴', '배선', '선로'] },
  { src: ['线宽', 'line width', 'trace width'], ko: '선폭', accept: ['라인 폭', '배선 폭', '패턴 폭'] },
  { src: ['线距', 'line space', 'spacing'], ko: '간격', accept: ['선간', '이격'] },
  { src: ['孔径', 'hole size', 'hole diameter'], ko: '홀 크기', accept: ['홀 지름', '홀 직경', '구경', '홀 사이즈', '홀경'] },
  { src: ['金手指', 'gold finger'], ko: '골드 핑거', accept: ['금 핑거', '골드핑거'] },
  { src: ['斜边', 'bevel', 'chamfer'], ko: '베벨', accept: ['모따기', '면취'] },
  { src: ['周期', 'date code'], ko: '주기', accept: ['데이트 코드', '날짜 코드', '제조 주기', '생산 주기'] },
  { src: ['UL'], ko: 'UL', accept: [] },
  { src: ['原稿', 'original file', 'original design', 'original data'], ko: '원본', accept: ['원 설계', '원래 데이터', '원래 파일'] },
  { src: ['槽孔', 'slot'], ko: '슬롯', accept: ['장공', '장홀'] },
  { src: ['盲孔', 'blind via'], ko: '블라인드 비아', accept: ['블라인드비아'] },
  { src: ['埋孔', 'buried via'], ko: '베리드 비아', accept: ['매립 비아'] },
  { src: ['非金属化孔', 'NPTH'], ko: '무도금 홀(NPTH)', accept: ['NPTH', '비도금', '무도금'] },
  { src: ['板材', 'base material', 'laminate'], ko: '원자재', accept: ['기재', '원판', '소재', '라미네이트'] },
  { src: ['字高', 'character height', 'text height'], ko: '문자 높이', accept: ['글자 높이', '글자 크기', '문자 크기'] },
  { src: ['反字', 'mirror'], ko: '반전 문자', accept: ['거울', '미러', '뒤집힌', '반전'] },
  { src: ['锣板', 'routing'], ko: '라우팅', accept: ['라우터', '외형 가공'] },
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// 영어 src 는 낱말 머리 경계(pads·drilling 은 맞고 full 속 ul 은 아니다), 대문자 약어(UL·ENIG·V-CUT)는
// 대소문자까지 맞춘다. 한자는 그대로 포함 검사.
const srcMatcher = (s: string): ((text: string) => boolean) => {
  if (!/^[\x20-\x7e]+$/.test(s)) return (text) => text.includes(s);
  const acronym = /^[A-Z0-9\-/ ]+$/.test(s.trim());
  const re = new RegExp(`(?<![A-Za-z])${escapeRe(s.trim())}`, acronym ? '' : 'i');
  return (text) => re.test(text);
};
const MATCHERS = EQ_GLOSSARY.map((entry) => ({ entry, tests: entry.src.map(srcMatcher) }));

/** src 를 텍스트에서 찾는다. */
export const glossaryMatches = (text: string): EqGlossaryEntry[] =>
  MATCHERS.filter(({ tests }) => tests.some((t) => t(text))).map(({ entry }) => entry);

/** 한국어 문장이 그 용어를 지켰나 — ko 또는 accept 중 하나라도 들어 있으면 준수. */
export const glossaryHonored = (entry: EqGlossaryEntry, korean: string): boolean => {
  const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
  const target = norm(korean);
  return [entry.ko, ...(entry.accept ?? [])].some((t) => target.includes(norm(t)));
};

/** 프롬프트에 싣는 한 줄 목록. */
export const glossaryPromptLines = (): string =>
  EQ_GLOSSARY.map((e) => `${e.src.filter((s) => s.trim() !== '').slice(0, 3).join('/')} → ${e.ko}`).join('\n');

// ── 문항 유형 사전 ── 공장 '问题类型' 칸 문구(또는 질문 본문) → 계약 카테고리. 위에서부터 먼저 맞는 것.
export const EQ_CATEGORY_KEYWORDS: readonly [PcbEqItemCategoryType, RegExp][] = [
  ['impedance', /阻抗|impedance/i],
  ['soldermask_dam', /阻焊桥|防焊桥|s\/?m\s*dam|sold(?:er)?\s*mask\s*dam|soldmask dam|solder dam/i],
  ['stackup', /层压|叠层|压合|stack-?\s?up|lamination/i],
  ['marking', /标记|标识|ul\s*mark|周期|date code|marking|\bmark\b/i],
  ['legend', /字符|丝印|legend|silk/i],
  ['soldermask', /阻焊|防焊|绿油|sold(?:er)?\s*mask|soldmask|solder resist/i],
  ['via', /过孔|塞孔|盲孔|埋孔|via/i],
  ['pad', /焊盘|pad/i],
  ['drill', /钻孔|孔径|槽孔|drill|hole size|slot/i],
  ['panel', /拼版|工艺边|邮票孔|v-?cut|v割|panel|array|rail/i],
  ['outline', /外形|成型|锣|outline|profile|routing/i],
  ['surface_finish', /表面处理|沉金|喷锡|osp|沉银|沉锡|电金|enig|hasl|surface finish|finish/i],
  ['material', /板材|材料|基材|铜厚|板厚|tg\d|material|laminate|copper thickness|board thickness/i],
  ['circuit', /线路|线宽|线距|circuit|trace|line width|spacing/i],
  ['indication', /标注|说明|图纸|drawing|indication|spec/i],
  ['other', /其他|其它|other/i],
];

/** 유형 칸 문구 → 카테고리(못 찾으면 null). */
export function categoryFromText(text: string): PcbEqItemCategoryType | null {
  for (const [cat, re] of EQ_CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return null;
}
