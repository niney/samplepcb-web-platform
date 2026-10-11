import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PCB_EQ_ITEM_CATEGORIES, PcbEqDraft } from '@sp/api-contract';
import { categoryFromText, glossaryHonored, glossaryMatches } from './glossary';
import {
  EQ_PARSE_PROMPT_VERSION,
  buildEqParsePrompt,
  buildEqTranslatePrompt,
  coerceEqDraft,
  findDroppedFacts,
  mergeTranslation,
} from './prompt';
import { normNo, scoreEqDraft, type EqGold } from './probe-score';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(readFileSync(path.join(HERE, '__fixtures__', 'a-lhd-bilingual.gold.json'), 'utf8')) as EqGold;

describe('용어집·유형 사전', () => {
  it('영어는 낱말 머리 경계 — full 속 ul 은 UL 이 아니다', () => {
    expect(glossaryMatches('Do you need us add our full marking?').map((e) => e.ko)).not.toContain('UL');
    expect(glossaryMatches('add UL mark and date code').map((e) => e.ko)).toEqual(expect.arrayContaining(['UL', '주기']));
    expect(glossaryMatches('silkscreens on the pads').map((e) => e.ko)).toEqual(['실크', '패드']);
  });
  it('허용 표기도 준수로 친다', () => {
    const [entry] = glossaryMatches('钢网');
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(glossaryHonored(entry, '스텐실 파일')).toBe(true);
      expect(glossaryHonored(entry, '마스크 파일')).toBe(false);
    }
  });
  it.each([
    ['legend字符', 'legend'],
    ['soldmask dam阻焊桥', 'soldermask_dam'],
    ['soldmask阻焊', 'soldermask'],
    ['size of pads equal hole负焊盘', 'pad'],
    ['via disposal过孔处理', 'via'],
    ['mark标记', 'marking'],
    ['表面处理', 'surface_finish'],
    ['叠层', 'stackup'],
  ])('%s → %s', (text, cat) => {
    expect(categoryFromText(text)).toBe(cat);
  });
});

describe('프롬프트', () => {
  it('직렬화 입력·유형 16종·용어집을 싣는다', () => {
    const p = buildEqParsePrompt('R8 A:1 | D:测试');
    expect(EQ_PARSE_PROMPT_VERSION).toBe('eq-parse-v1');
    expect(p).toContain('R8 A:1 | D:测试');
    for (const c of PCB_EQ_ITEM_CATEGORIES) expect(p).toContain(`${c}=`);
    expect(p).toContain('阻焊桥/soldermask dam/solder mask dam → 솔더마스크 댐');
  });
  it('v2 는 열 문자·숫자 기호 규칙과 두 칸 질문 잇기를 보탠다(v1 은 그대로)', () => {
    const v1 = buildEqParsePrompt('X');
    const v2 = buildEqParsePrompt('X', 'eq-parse-v2');
    expect(v1).not.toContain('열 문자는 셀 위치일 뿐');
    expect(v2).toContain('열 문자는 셀 위치일 뿐 선택지 기호가 아니다');
    expect(v2).toContain('A·B 로 바꾸지 않는다');
    expect(v2).toContain('두 칸을 공백 하나로 이어');
  });
  it('번역만 프롬프트는 원문과 기호만 넘긴다(그림·의견필수는 템플릿 몫)', () => {
    const p = buildEqTranslatePrompt(gold.draft);
    expect(p).toContain('"labelOrig": "接受开通窗Accept gang opening"');
    expect(p).not.toContain('figureRefs');
  });
});

describe('coerceEqDraft — 지어내지 않는 가벼운 정리', () => {
  it('숫자 번호·모르는 유형·빈 선택지·선택지 없는 문항·모르는 그림 id', () => {
    const raw = {
      header: { customerPartNo: '', factoryPartNo: 'X1', issuedOn: null },
      items: [
        {
          factoryNo: 1,
          category: 'hole',
          question: '질문',
          questionOrig: '问题',
          options: [
            { key: 'A', label: '수용', labelOrig: '接受', recommended: false, requiresComment: false },
            { key: 'C', label: '', labelOrig: '', recommended: false, requiresComment: false },
          ],
          figureRefs: ['img-1', 'img-99'],
        },
        { factoryNo: '2', category: 'drill', question: '빈 선택지 문항', questionOrig: null, options: [], figureRefs: [] },
      ],
    };
    const { draft, report } = coerceEqDraft(raw, ['img-1']);
    expect(report.rawValid).toBe(false);
    expect(draft).not.toBeNull();
    expect(PcbEqDraft.safeParse(draft).success).toBe(true);
    expect(draft?.header.customerPartNo).toBeNull();
    expect(draft?.items).toHaveLength(1);
    expect(draft?.items[0]).toMatchObject({ factoryNo: '1', category: 'other', figureRefs: ['img-1'] });
    expect(draft?.items[0]?.options.map((o) => o.key)).toEqual(['A']);
    expect(report.fixes).toEqual(expect.arrayContaining(['번호 숫자→문자', '모르는 유형 hole→other', '빈 선택지 제거', '선택지 없는 문항 제거', '모르는 그림 id 제거']));
  });
  it('계약을 지킨 출력은 그대로 통과', () => {
    const { draft, report } = coerceEqDraft(gold.draft, ['img-1', 'img-2', 'img-3', 'img-4', 'img-5']);
    expect(report.rawValid).toBe(true);
    expect(draft).toEqual(gold.draft);
  });
});

describe('findDroppedFacts — 번역이 빠뜨린 수치·파일명', () => {
  const orig = "最小孔径0.2mm与焊盘0.35mm，按 'KM100_1025.zip' 制作，见图1。 Follow 'KM100_1025.zip', 2x3 array";
  it('다 있으면 빈 배열(한 자리 정수 图1·2x3 은 보지 않는다)', () => {
    expect(findDroppedFacts(orig, "최소 홀 크기 0.2mm, 패드 0.35mm 입니다. 'KM100_1025.zip' 기준으로 제작합니다(그림 참고).")).toEqual([]);
  });
  it('영문에만 있던 파일명·수치를 떨어뜨리면 잡는다', () => {
    expect(findDroppedFacts(orig, '최소 홀 크기 0.2mm 에 패드가 작습니다. 원본 기준으로 제작합니다.')).toEqual(['KM100_1025.zip', '0.35', '100', '1025']);
  });
});

describe('mergeTranslation — 구조는 템플릿, 문구만 번역', () => {
  it('질문·선택지 문구만 바뀐다', () => {
    const base = { ...gold.draft, items: gold.draft.items.map((it) => ({ ...it, question: it.questionOrig ?? '' })) };
    const { draft, translated } = mergeTranslation(base, {
      items: [{ factoryNo: '1', category: 'soldermask_dam', question: '번역된 질문', options: [{ key: 'A', label: '번역 A' }] }],
    });
    expect(translated).toBe(1);
    expect(draft.items[0]?.question).toBe('번역된 질문');
    expect(draft.items[0]?.options[0]?.label).toBe('번역 A');
    expect(draft.items[0]?.options[1]).toEqual(base.items[0]?.options[1]);
    expect(draft.items[1]).toEqual(base.items[1]);
  });
});

describe('scoreEqDraft', () => {
  const src = gold.draft.items.map((i) => `${i.questionOrig ?? ''} ${i.options.map((o) => o.labelOrig).join(' ')}`).join('\n');
  it('정답 자신은 100점', () => {
    const s = scoreEqDraft(gold, gold.draft, true, src);
    expect(s.total).toBe(100);
    expect([s.recall, s.precision, s.figureAcc, s.glossaryRate, s.headerAcc]).toEqual([1, 1, 1, 1, 1]);
  });
  it('문항 누락·빈 슬롯 포함·기호 오답·지어낸 원문을 잡는다', () => {
    const items = gold.draft.items.slice(1).map((it) => ({ ...it }));
    const first = items[0];
    if (first === undefined) throw new Error('fixture');
    items[0] = { ...first, options: first.options.map((o, i) => ({ ...o, key: i === 0 ? 'X' : o.key })) };
    items.push({ ...first, factoryNo: '7', questionOrig: '完全不同的捏造文本 completely invented text here' });
    const s = scoreEqDraft(gold, { header: gold.draft.header, items }, false, src);
    expect(s.recall).toBe(0.8);
    expect(s.emptySlotsDropped).toBe(false);
    expect(s.optionKeysAcc).toBeLessThan(1);
    expect(s.fabricated).toBe(1);
    expect(s.total).toBeLessThan(90);
  });
  it('계약 실패는 0점', () => {
    expect(scoreEqDraft(gold, null, false, src).total).toBe(0);
  });
  it('번호 정규화', () => {
    expect(['01', '2.0', ' eq-03 ', null].map(normNo)).toEqual(['1', '2', 'EQ-03', '']);
  });
});
