import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiDirectory, databaseTarget } from '../../../lib/db-snapshot';
import { assertResetTargets, RESET_ANCHOR_ITEM_IDS, RESET_PRESERVED_TABLES, resetTableAction } from './reset-data-policy';
import type { ResetTargets } from './reset-data-policy';

function targets(): ResetTargets {
  const target = databaseTarget('mysql://test:password@127.0.0.1:3306/samplepcb');
  return { target, g5: { ...target }, runtime: { ...target }, runtimeG5: { ...target }, legacy: { ...target, database: 'legacy' } };
}

describe('업무 초기화 보존 정책', () => {
  it('현재 앱 설정 모델은 모두 보존 목록에 등록되어 있다', async () => {
    const schema = await readFile(join(apiDirectory, 'prisma/schema.prisma'), 'utf8');
    const settingModels = ['SpConfig', 'SpSeo', 'SpAiUsecase', 'SpMailTemplate'];
    for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const name = match[1] ?? '';
      if (!name.endsWith('Settings') && !settingModels.includes(name)) continue;
      const table = /@@map\("([^"]+)"\)/.exec(match[2] ?? '')?.[1];
      expect(table, name).toBeDefined();
      expect(resetTableAction(table ?? ''), name).toBe('preserve');
    }
  });

  it('설정·메뉴·배너·게시판 구조를 보존한다', () => {
    for (const table of Object.keys(RESET_PRESERVED_TABLES)) expect(resetTableAction(table)).toBe('preserve');
    expect(resetTableAction('g5_board')).toBe('preserve');
    expect(resetTableAction('g5_shop_banner')).toBe('preserve');
  });

  it('PCB·BOM·개발·마켓·회원과 관련 로그·자산을 모두 초기화한다', () => {
    for (const table of ['g5_member', 'g5_auth', 'g5_member_social_profiles', 'g5_member_auto_login', 'g5_point',
      'g5_memo', 'g5_shop_order_address', 'g5_shop_order', 'g5_shop_cart', 'g5_write_notice', 'g5_board_file',
      'sp_quote', 'sp_order_spec', 'sp_pcb_po', 'sp_bom_quote', 'sp_bom_quote_item', 'sp_part',
      'sp_develop_request', 'sp_develop_document', 'sp_market_expert', 'sp_market_contract',
      'sp_member_profile', 'sp_partner_member', 'sp_file', 'sp_mail_log', 'sp_ai_job']) {
      expect(resetTableAction(table), table).toBe('truncate');
    }
  });

  it('일반 상품을 지우면서 결제에 필요한 7개 앵커만 보존한다', () => {
    expect(resetTableAction('g5_shop_item')).toBe('anchors');
    expect(RESET_ANCHOR_ITEM_IDS).toHaveLength(7);
    expect(RESET_ANCHOR_ITEM_IDS).toContain('sp-bom-parts');
    expect(RESET_ANCHOR_ITEM_IDS).toContain('sp-market-svc');
    expect(RESET_ANCHOR_ITEM_IDS).toContain('sp-develop-svc');
  });

  it('분류하지 못한 테이블과 SQL 식별자 삽입을 거부한다', () => {
    expect(() => resetTableAction('external_config')).toThrow('분류');
    expect(() => resetTableAction('sp_future_settings')).toThrow('설정 테이블');
    expect(() => resetTableAction('g5_member`; DROP DATABASE samplepcb; --')).toThrow('테이블 이름');
  });
});

describe('초기화 대상 확인', () => {
  it('미리보기는 확인 인자가 없어도 허용한다', () => {
    expect(() => { assertResetTargets(targets(), false); }).not.toThrow();
  });

  it('실행은 정확한 대상 DB 이름을 요구한다', () => {
    expect(() => { assertResetTargets(targets(), true); }).toThrow('--confirm-database samplepcb');
    expect(() => { assertResetTargets(targets(), true, 'samplepcb_dev'); }).toThrow('--confirm-database samplepcb');
    expect(() => { assertResetTargets(targets(), true, 'samplepcb'); }).not.toThrow();
  });

  it('앱·이관의 DB가 다르면 이름이 같아도 호스트·포트 차이를 거부한다', () => {
    for (const field of ['g5', 'runtime', 'runtimeG5'] as const) {
      for (const change of [{ host: 'other-host' }, { port: 3307 }, { database: 'samplepcb_dev' }]) {
        const value = targets();
        value[field] = { ...value[field], ...change };
        expect(() => { assertResetTargets(value, false); }).toThrow('호스트·포트·DB');
      }
    }
  });

  it('레거시와 같은 이름의 DB와 시스템 DB는 거부한다', () => {
    const value = targets();
    value.legacy = { ...value.target, host: 'remote-legacy' };
    expect(() => { assertResetTargets(value, true, 'samplepcb'); }).toThrow('레거시');
    value.target = { ...value.target, database: 'mysql' };
    expect(() => { assertResetTargets(value, true, 'mysql'); }).toThrow('업무 DB');
  });
});
