import { describe, expect, it } from 'vitest';
import { mapGerberItem, normalizeMenu, resolveSubjKey } from './eav-mapper';

describe('resolveSubjKey — subj 문자열 기준 매핑(슬롯 무관)', () => {
  it('정본 키는 그대로 spec', () => {
    expect(resolveSubjKey('layers')).toEqual({ key: 'layers', kind: 'spec' });
    expect(resolveSubjKey('differentDesign')).toEqual({ key: 'differentDesign', kind: 'spec' });
  });

  it('별칭·오탈자 정규화(리포트 실측 목록)', () => {
    expect(resolveSubjKey('diffDesign')).toEqual({ key: 'differentDesign', kind: 'spec' });
    expect(resolveSubjKey('diff_design')).toEqual({ key: 'differentDesign', kind: 'spec' });
    expect(resolveSubjKey('impedence')).toEqual({ key: 'impedance', kind: 'spec' });
    expect(resolveSubjKey('Impedence')).toEqual({ key: 'impedance', kind: 'spec' });
    expect(resolveSubjKey('st_direction')).toEqual({ key: 'stencilSide', kind: 'spec' });
    expect(resolveSubjKey('stDirection')).toEqual({ key: 'stencilSide', kind: 'spec' });
    expect(resolveSubjKey('3mtape')).toEqual({ key: 'tape3m', kind: 'spec' });
    expect(resolveSubjKey('mixTrace')).toEqual({ key: 'minTraceSpacing', kind: 'spec' });
    expect(resolveSubjKey('kindpcb')).toEqual({ key: 'kindPcb', kind: 'spec' });
    expect(resolveSubjKey('electrop')).toEqual({ key: 'electroPolish', kind: 'spec' });
  });

  it('1세대(PascalCase/snake_case) 키 — 슬롯 세대 충돌의 해법', () => {
    expect(resolveSubjKey('Thickness')).toEqual({ key: 'pcbThickness', kind: 'spec' });
    expect(resolveSubjKey('FinishedCopper')).toEqual({ key: 'copperWeights', kind: 'spec' });
    expect(resolveSubjKey('MinTrackSpacing')).toEqual({ key: 'minTraceSpacing', kind: 'spec' });
    expect(resolveSubjKey('MinHoleSize')).toEqual({ key: 'minHole', kind: 'spec' });
    expect(resolveSubjKey('DesignInPanel')).toEqual({ key: 'panel', kind: 'spec' });
    expect(resolveSubjKey('FR4Tg')).toEqual({ key: 'fr4Tg', kind: 'spec' });
    expect(resolveSubjKey('Menu')).toEqual({ key: 'menu', kind: 'extract' });
  });

  it('추출 키(spec 본문 제외): menu/status/orderCategory/qty/filePath/eta + it_50 구표기 category', () => {
    expect(resolveSubjKey('menu')).toEqual({ key: 'menu', kind: 'extract' });
    expect(resolveSubjKey('filePath')).toEqual({ key: 'filePath', kind: 'extract' });
    expect(resolveSubjKey('file_path')).toEqual({ key: 'filePath', kind: 'extract' });
    expect(resolveSubjKey('orderCategory')).toEqual({ key: 'orderCategory', kind: 'extract' });
    expect(resolveSubjKey('category')).toEqual({ key: 'orderCategory', kind: 'extract' });
  });

  it('폐기 키(가격 산출물 등)와 미지 키', () => {
    expect(resolveSubjKey('totalPrice')?.kind).toBe('drop');
    expect(resolveSubjKey('total_price')?.kind).toBe('drop');
    expect(resolveSubjKey('ship_price')?.kind).toBe('drop');
    expect(resolveSubjKey('견적상태')?.kind).toBe('drop');
    expect(resolveSubjKey('프레임제작')).toBeNull(); // 수기 오염 → rawUnknown 격리
    expect(resolveSubjKey('')).toBeNull();
  });
});

describe('normalizeMenu — 오염 25종 정규화 + it_name 폴백', () => {
  it('대소문자·오탈자 변형', () => {
    expect(normalizeMenu('Standad', '')).toEqual({ category: 'standard', known: true });
    expect(normalizeMenu('ADVANCE', '')).toEqual({ category: 'advance', known: true });
    expect(normalizeMenu('Advenced', '')).toEqual({ category: 'advance', known: true });
    expect(normalizeMenu('metalMask/국내', '')).toEqual({ category: 'metalMask', known: true });
    expect(normalizeMenu('FPCB', '')).toEqual({ category: 'flexible', known: true });
    expect(normalizeMenu('Rigid-flexible', '')).toEqual({ category: 'flexible', known: true });
  });

  it('빈 menu(1세대) → it_name 접두 폴백', () => {
    expect(normalizeMenu('', 'standard_1608517056')).toEqual({ category: 'standard', known: true });
    expect(normalizeMenu('', 'Advance_1565002303')).toEqual({ category: 'advance', known: true });
  });

  it('정규화 불가(수기 오염)는 원본 유지 + known=false', () => {
    expect(normalizeMenu('RO4350B', 'RO4350B_123')).toEqual({ category: 'RO4350B', known: false });
    expect(normalizeMenu('', '')).toEqual({ category: 'unknown', known: false });
  });
});

describe('mapGerberItem — EAV 행 전체 변환', () => {
  const item: Record<string, unknown> = {
    it_id: '1608517056',
    it_name: 'standard_1608517056',
    it_stock_qty: 5,
    it_1_subj: 'length',
    it_1: '100',
    it_2_subj: 'filePath',
    it_2: '/gerber_files/20201221/mood.zip',
    it_3_subj: 'Thickness', // 1세대 키
    it_3: '1.6',
    it_6_subj: 'qty',
    it_6: '5',
    it_22_subj: 'menu',
    it_22: 'Standad',
    it_23_subj: 'status',
    it_23: 'order',
    it_25_subj: 'diffDesign', // 구키 별칭
    it_25: '1',
    it_42_subj: 'eta',
    it_42: '2020.12.28',
    it_44_subj: '프레임제작', // 수기 오염 — rawUnknown 으로
    it_44: '있음',
    it_45_subj: 'totalPrice', // 산출물 — 폐기
    it_45: '64,000원',
    it_50_subj: 'orderCategory',
    it_50: 'mass',
  };

  it('spec/추출/격리/폐기가 자리를 찾는다', () => {
    const m = mapGerberItem(item);
    expect(m.spec.length).toBe('100');
    expect(m.spec.pcbThickness).toBe('1.6');
    expect(m.spec.differentDesign).toBe('1');
    expect(m.spec.qty).toBe('5');
    expect(m.spec).not.toHaveProperty('totalPrice');
    expect(m.spec).not.toHaveProperty('menu');
    expect(m.rawUnknown).toEqual({ 프레임제작: '있음' });
    expect(m.category).toBe('standard');
    expect(m.categoryKnown).toBe(true);
    expect(m.orderCategory).toBe('mass');
    expect(m.orderCategoryExplicit).toBe(true);
    expect(m.qty).toBe(5);
    expect(m.filePath).toBe('/gerber_files/20201221/mood.zip');
    expect(m.eta).toBe('2020.12.28');
    expect(m.flow).toBe('order');
  });

  it('qty 폴백: spec 부재 시 it_stock_qty, 그것도 없으면 1', () => {
    const m = mapGerberItem({ it_name: 'standard_1', it_stock_qty: 30, it_22_subj: 'menu', it_22: 'standard' });
    expect(m.qty).toBe(30);
    const m2 = mapGerberItem({ it_name: 'standard_1' });
    expect(m2.qty).toBe(1);
  });

  it('orderCategory 빈값(도입 이전)은 기본 sample + 비명시 플래그', () => {
    const m = mapGerberItem({ it_name: 'standard_1' });
    expect(m.orderCategory).toBe('sample');
    expect(m.orderCategoryExplicit).toBe(false);
  });
});
